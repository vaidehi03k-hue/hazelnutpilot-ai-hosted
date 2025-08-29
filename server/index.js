// server/index.js
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import { runWebTests } from './runWebTests.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------- simple file-backed DB ----------
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
app.use(bodyParser.json({ limit: '2mb' }));

// CORS (Vercel UI -> Render API)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // or restrict to your Vercel domain
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

// --------- projects API ----------
app.get('/api/projects', (_req, res) => {
  const db = loadDB();
  res.json({ ok: true, projects: db.projects.map(p => ({
    id: p.id, name: p.name, baseUrl: p.baseUrl, runs: p.runs?.length || 0, lastRunAt: p.lastRunAt || null
  })) });
});

app.post('/api/projects', (req, res) => {
  const { name, baseUrl } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const db = loadDB();
  const id = crypto.randomUUID?.() || String(Date.now());
  const project = { id, name, baseUrl: baseUrl || '', createdAt: new Date().toISOString(), runs: [] };
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

// Normalize many incoming shapes into array of steps
function normalizeSteps(payload) {
  let steps = payload?.steps ?? payload?.data ?? payload;
  if (typeof steps === 'string') {
    try { steps = JSON.parse(steps); } catch {}
  }
  if (!Array.isArray(steps)) return null;

  // If natural language, coerce to structured primitives
  return steps.map(s => {
    if (typeof s === 'object' && s.step) return s;
    const text = typeof s === 'string' ? s : (s?.step || '');
    const low = text.toLowerCase();

    if (/(^|\s)(go to|navigate to|open)\s+/i.test(text)) {
      const m = text.match(/(go to|navigate to|open)\s+([^\s"']+)/i);
      return { step: 'goto', target: m ? m[2] : '' };
    }
    if (/\b(fill|type|enter)\b/i.test(text)) {
      const value = text.match(/["“](.+?)["”]/)?.[1] || '';
      const hint  = (low.match(/\b(into|in|on)\b\s+(the )?(.+?)(?: field| input| box| area)?$/)?.[3] || '')
        .replace(/["']/g, '').trim();
      return { step: 'fill', target: hint || 'input', value };
    }
    if (/\b(click|press|tap)\b/i.test(text)) {
      const quoted = text.match(/"([^"]+)"/)?.[1];
      const hint = quoted || (low.replace(/^.*\b(click|press|tap)\b\s+/i, '')
        .replace(/\b(button|link|cta|icon)\b/g, '').trim());
      return { step: 'click', target: hint || 'submit' };
    }
    if (/url contains/i.test(text)) {
      const frag = text.match(/url contains\s+"?([^"]+)"?/i)?.[1] || '';
      return { step: 'expectUrlContains', target: frag };
    }
    if (/\b(verify|expect|see)\b/i.test(text)) {
      const t = text.match(/"([^"]+)"/)?.[1] || text.replace(/^(verify|expect|see)\s+/i,'').trim();
      return { step: 'expectText', target: t };
    }
    return { step: 'noop', target: text };
  });
}

// Run web tests and persist results to the project history
app.post('/api/projects/:id/run-web', async (req, res) => {
  try {
    const db = loadDB();
    const p = db.projects.find(x => x.id === req.params.id) || null;
    const steps = normalizeSteps(req.body);
    if (!Array.isArray(steps)) {
      return res.status(400).json({ ok: false, error: '"steps" must be an array' });
    }
    const baseUrl = req.body?.baseUrl ?? (steps[0]?.step === 'goto' ? steps[0].target : (p?.baseUrl || ''));

    const runId = crypto.randomUUID?.() || String(Date.now());
    const report = await runWebTests({ steps, baseUrl, runId });

    // persist (if project exists)
    if (p) {
      p.runs = p.runs || [];
      p.runs.unshift({
        id: runId,
        at: new Date().toISOString(),
        baseUrl,
        summary: report.summary,
        results: report.results,
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

// List runs for a project (for your UI Run History table)
app.get('/api/projects/:id/runs', (req, res) => {
  const db = loadDB();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'project not found' });
  res.json({ ok: true, runs: p.runs || [] });
});

// Dashboard summary (for health check & UI)
app.get('/api/summary', (_req, res) => {
  const db = loadDB();
  const projects = db.projects || [];
  const runs = projects.reduce((n, p) => n + (p.runs?.length || 0), 0);
  const passed = projects.reduce((n, p) => {
    return n + (p.runs?.reduce((m, r) => m + (r.summary?.passed || 0), 0) || 0);
  }, 0);
  const total = projects.reduce((n, p) => {
    return n + (p.runs?.reduce((m, r) => m + (r.summary?.total || 0), 0) || 0);
  }, 0);
  const passRate = total ? Math.round((passed / total) * 100) : 0;

  res.json({
    totals: { projects: projects.length, runs, passRate },
    projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      runs: p.runs?.length || 0,
      lastRunAt: p.lastRunAt || null
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
