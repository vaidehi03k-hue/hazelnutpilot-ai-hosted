// server/index.js
import express from 'express';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import mammoth from 'mammoth';
import { createRequire } from 'node:module';
import { runWebTests } from './runWebTests.js';
import { generateTestsFromPrd } from './ai.js';

// ---- safer logging for any crash at startup/runtime
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

// pdf-parse via CJS to avoid its ESM test-file bug
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

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
app.use(express.json({ limit: '4mb' }));
app.use('/api/projects/:id/upload-prd-text', express.text({ type: 'text/*', limit: '2mb' }));

// CORS (Vercel UI -> Render API)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // lock to your Vercel URL if desired
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Ensure /runs exists & serve artifacts (videos/screenshots/logs)
const RUNS_DIR = path.join(process.cwd(), 'runs');
try { fs.mkdirSync(RUNS_DIR, { recursive: true }); } catch {}
app.use('/runs', express.static(RUNS_DIR));

// Friendly root & health
app.get('/', (_req, res) => res.type('text').send('HazelnutPilot AI API. See /api/health /api/summary'));
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, service: 'hazelnutpilot-ai', time: new Date().toISOString() })
);

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
  res.json({ ok: true, project });
});

app.get('/api/projects/:id', (req, res) => {
  const db = loadDB();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
  res.json({ ok: true, project: p });
});

// --------- Update Base URL ----------
app.post('/api/projects/:id/base-url', (req, res) => {
  try {
    const db = loadDB();
    const p = db.projects.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
    const baseUrl = req.body?.baseUrl || '';
    p.baseUrl = baseUrl;
    saveDB(db);
    res.json({ ok: true, project: p });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --------- PRD Upload + AI Generation ----------
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/projects/:id/upload-prd', upload.single('file'), async (req, res) => {
  try {
    const db = loadDB();
    const p = db.projects.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'project not found' });

    // Get PRD text either from uploaded file or JSON
    let prdText = '';
    if (req.file && req.file.buffer) {
      const ext = (req.file.originalname || '').toLowerCase();
      try {
        if (ext.endsWith('.pdf')) {
          const data = await pdfParse(req.file.buffer);
          prdText = data.text || '';
        } else if (ext.endsWith('.docx')) {
          const r = await mammoth.extractRawText({ buffer: req.file.buffer });
          prdText = r.value || '';
        } else {
          prdText = req.file.buffer.toString('utf8');
        }
      } catch {
        prdText = req.file.buffer.toString('utf8');
      }
    } else {
      prdText = req.body?.prdText || req.body?.text || '';
    }
    if (!prdText.trim()) return res.status(400).json({ ok: false, error: 'prdText or file required' });

    const baseUrl = req.body?.baseUrl || p.baseUrl || '';

    // Generate steps with AI (falls back to stub if no key)
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
app.post('/api/projects/:id/run-web', async (req, res) => {
  const startedAt = new Date().toISOString();
  console.log(`[run-web] START project=${req.params.id} at=${startedAt}`);
  try {
    const db = loadDB();
    const p = db.projects.find(x => x.id === req.params.id) || null;

    let steps = req.body?.steps ?? (p?.lastGeneratedSteps || []);
    if (typeof steps === 'string') { try { steps = JSON.parse(steps); } catch {} }
    if (!Array.isArray(steps) || steps.length === 0) {
      console.error('[run-web] no steps provided');
      return res.status(400).json({ ok: false, error: '"steps" must be a non-empty array' });
    }

    const baseUrl =
      req.body?.baseUrl ||
      (steps[0]?.step === 'goto' ? steps[0]?.target : '') ||
      (p?.baseUrl || '');

    if (!baseUrl) {
      console.error('[run-web] baseUrl missing');
      return res.status(400).json({ ok: false, error: 'baseUrl is required (in body or project)' });
    }

    const runId = crypto.randomUUID?.() || String(Date.now());
    console.log(`[run-web] LAUNCH steps=${steps.length} baseUrl=${baseUrl} runId=${runId}`);

    const report = await runWebTests({ steps, baseUrl, runId, maxRunMs: 120000 });
    console.log(`[run-web] DONE runId=${runId} summary=${JSON.stringify(report.summary)}`);

    if (p) {
      p.runs = p.runs || [];
      p.runs.unshift({
        id: runId,
        at: new Date().toISOString(),
        baseUrl,
        summary: report.summary,
        results: report.results,
        artifacts: report.artifacts   // video/screenshots/log for UI
      });
      p.lastRunAt = p.runs[0].at;
      saveDB(db);
    }

    return res.json({ ok: true, runId, report });
  } catch (e) {
    console.error('[run-web] ERROR', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Run history
app.get('/api/projects/:id/runs', (req, res) => {
  const db = loadDB();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
  res.json({ ok: true, runs: p.runs || [] });
});

// Dashboard summary
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
  console.log('✅ Runner ready: dynamic DOM + retries + video + screenshots');
  console.log(`API listening on :${PORT}`);
});

export default app;
