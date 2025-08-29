// server/index.js
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import { runWebTests } from './runWebTests.js';
import { generateTestsFromPrd } from './ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------- tiny file-backed DB ----------
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE  = path.join(DATA_DIR, 'db.json');

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ projects: [] }, null, 2));
  }
}
function loadDB() {
  ensureData();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { projects: [] }; }
}
function saveDB(db) {
  ensureData();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// --------- app ----------
const app = express();
app.use(bodyParser.json({ limit: '4mb' }));

// allow raw text for certain routes (optional)
app.use('/api/projects/:id/upload-prd-text', express.text({ type: 'text/*', limit: '2mb' }));

// CORS (Vercel UI -> Render API)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // tighten to your Vercel origin if you want
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve run artifacts (screenshots/videos/logs)
app.use('/runs', express.static(path.join(process.cwd(), 'runs')));

// Friendly health & root
app.get('/', (_req, res) => res.type('text').send('HazelnutPilot AI API is live. See /api/health /api/summary'));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'hazelnutpilot-ai', time: new Date().toISOString() }));

// --------- Projects ----------
app.get('/api/projects', (_req, res) => {
  const db = loadDB();
  res.json({
    ok: true,
    projects: db.projects.map(p => ({
      id: p.id, name: p.name, baseUrl: p.baseUrl,
      runs: p.runs?.length || 0, lastRunAt: p.lastRunAt || null
    }))
  });
});

app.post('/api/projects', (req, res) => {
  const { name, baseUrl } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });

  const db = loadDB();
  const id = crypto.randomUUID?.() || String(Date.now());

  const project = {
    id, name, baseUrl: baseUrl || '',
    createdAt: new Date().toISOString(),
    lastPrdText: '', lastGeneratedSteps: [], runs: []
  };

  db.projects.unshift(project);
  saveDB(db);
  res.json({ ok: true, project });   // <-- important: project.id is here
});

app.get('/api/projects/:id', (req, res) => {
  const db = loadDB();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
  res.json({ ok: true, project: p });
});

// --------- PRD Upload + AI Generation ----------
// Accepts multipart file upload OR JSON with { prdText, baseUrl }
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/projects/:id/upload-prd', upload.single('file'), async (req, res) => {
  try {
    const db = loadDB();
    const p = db.projects.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });

    // Get PRD text either from uploaded file or JSON
    let prdText = '';
    if (req.file && req.file.buffer) {
      prdText = req.file.buffer.toString('utf8');
    } else {
      prdText = req.body?.prdText || '';
    }
    if (!prdText.trim()) return res.status(400).json({ ok: false, error: 'prdText or file required' });

    // Base URL preference: request > existing project
    const baseUrl = req.body?.baseUrl || p.baseUrl || '';

    // Generate steps with AI
    const steps = await generateTestsFromPrd({ baseUrl, prdText });

    // Persist PRD + steps
    p.lastPrdText = prdText;
    p.baseUrl = baseUrl || p.baseUrl;
    p.lastGeneratedSteps = steps;
    saveDB(db);

    res.json({ ok: true, projectId: p.id, baseUrl: p.baseUrl, steps });
  } catch (e) {
    console.error('upload-prd error:', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Optional: raw text upload (Content-Type: text/plain)
app.post('/api/projects/:id/upload-prd-text', async (req, res) => {
  try {
    const db = loadDB();
    const p = db.projects.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    const prdText = String(req.body || '').trim();
    if (!prdText) return res.status(400).json({ ok: false, error: 'text body required' });

    const baseUrl = p.baseUrl || '';
    const steps = await generateTestsFromPrd({ baseUrl, prdText });
    p.lastPrdText = prdText;
    p.lastGeneratedSteps = steps;
    saveDB(db);
    res.json({ ok: true, projectId: p.id, baseUrl: p.baseUrl, steps });
  } catch (e) {
    console.error('upload-prd-text error:', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Fetch last generated steps
app.get('/api/projects/:id/steps', (req, res) => {
  const db = loadDB();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
  res.json({ ok: true, steps: p.lastGeneratedSteps || [] });
});

// --------- Run Web Tests ----------
// Accepts { steps?, baseUrl? }. If steps missing, uses project's lastGeneratedSteps.
app.post('/api/projects/:id/run-web', async (req, res) => {
  try {
    const db = loadDB();
    const p = db.projects.find(x => x.id === req.params.id) || null;

    let steps = req.body?.steps ?? (p?.lastGeneratedSteps || []);
    if (typeof steps === 'string') {
      try { steps = JSON.parse(steps); } catch {}
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ ok: false, error: '"steps" must be a non-empty array' });
    }

    const baseUrl =
      req.body?.baseUrl ||
      (steps[0]?.step === 'goto' ? steps[0]?.target : '') ||
      (p?.baseUrl || '');

    const runId = crypto.randomUUID?.() || String(Date.now());
    const report = await runWebTests({ steps, baseUrl, runId });

    if (p) {
      p.runs = p.runs || [];
      p.runs.unshift({
        id: runId,
        at: new Date().toISOString(),
        baseUrl,
        summary: report.summary,
        results: report.results
      });
      p.lastRunAt = p.runs[0].at;
      saveDB(db);
    }

    res.json({ ok: true, runId, report });
  } catch (e) {
    console.error('run-web error:', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// List runs (for Run History table)
app.get('/api/projects/:id/runs', (req, res) => {
  const db = loadDB();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
  res.json({ ok: true, runs: p.runs || [] });
});

// Dashboard summary (also used for Health check)
app.get('/api/summary', (_req, res) => {
  const db = loadDB();
  const projects = db.projects || [];
  const runs = projects.reduce((n, p) => n + (p.runs?.length || 0), 0);
  const passed = projects.reduce((n, p) => n + (p.runs?.reduce((m, r) => m + (r.summary?.passed || 0), 0) || 0), 0);
  const total = projects.reduce((n, p) => n + (p.runs?.reduce((m, r) => m + (r.summary?.total || 0), 0) || 0), 0);
  const passRate = total ? Math.round((passed / total) * 100) : 0;

  res.json({
    totals: { projects: projects.length, runs, passRate },
    projects: projects.map(p => ({
      id: p.id, name: p.name, baseUrl: p.baseUrl,
      runs: p.runs?.length || 0, lastRunAt: p.lastRunAt || null
    }))
  });
});

// --------- start ----------
const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log('✅ Runner build: dynamic DOM + retries + video + screenshots');
  console.log(`API listening on :${PORT}`);
});

export default app;
