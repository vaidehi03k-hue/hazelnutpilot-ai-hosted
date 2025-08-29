// server/index.js
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { runWebTests } from './runWebTests.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json({ limit: '2mb' }));

// Serve run artifacts (screenshots/video/logs) so Vercel can show them
app.use('/runs', express.static(path.join(process.cwd(), 'runs')));

// Friendly root + health (for Render checks & quick manual testing)
app.get('/', (req, res) => {
  res.type('text').send('HazelnutPilot AI API is live. See /api/health');
});
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'hazelnutpilot-ai', time: new Date().toISOString() });
});

// --- UTIL: normalize any incoming “steps” shape into an array of step objects ---
function normalizeSteps(payload) {
  let steps = payload?.steps ?? payload?.data ?? payload;

  // If steps came as a JSON string
  if (typeof steps === 'string') {
    try { steps = JSON.parse(steps); } catch { /* leave as string */ }
  }
  if (!Array.isArray(steps)) return null;

  // Accept both structured & natural language; map NL to structured primitives
  return steps.map(s => {
    if (typeof s === 'object' && s.step) return s;     // already structured
    const text = typeof s === 'string' ? s : (s?.step || '');
    const low  = text.toLowerCase();

    // goto
    if (/(^|\s)(go to|navigate to|open)\s+/i.test(text)) {
      const m = text.match(/(go to|navigate to|open)\s+([^\s"']+)/i);
      return { step: 'goto', target: m ? m[2] : '' };
    }
    // fill (value “…”) into/in/on <hint>
    if (/\b(fill|type|enter)\b/i.test(text)) {
      const value = text.match(/["“](.+?)["”]/)?.[1] || '';
      const hint  = (low.match(/\b(into|in|on)\b\s+(the )?(.+?)(?: field| input| box| area)?$/)?.[3] || '')
        .replace(/["']/g, '').trim();
      return { step: 'fill', target: hint || 'input', value };
    }
    // click
    if (/\b(click|press|tap)\b/i.test(text)) {
      const quoted = text.match(/"([^"]+)"/)?.[1];
      const hint = quoted || (low.replace(/^.*\b(click|press|tap)\b\s+/i, '')
        .replace(/\b(button|link|cta|icon)\b/g, '')
        .trim());
      return { step: 'click', target: hint || 'submit' };
    }
    // expectUrlContains
    if (/url contains/i.test(text)) {
      const frag = text.match(/url contains\s+"?([^"]+)"?/i)?.[1] || '';
      return { step: 'expectUrlContains', target: frag };
    }
    // expectText
    if (/\b(verify|expect|see)\b/i.test(text)) {
      const t = text.match(/"([^"]+)"/)?.[1] || text.replace(/^(verify|expect|see)\s+/i,'').trim();
      return { step: 'expectText', target: t };
    }
    // fallback
    return { step: 'noop', target: text };
  });
}

// --- MAIN: run web tests for a project (ID is not used here but kept for API shape) ---
app.post('/api/projects/:id/run-web', async (req, res) => {
  try {
    const steps = normalizeSteps(req.body);
    if (!Array.isArray(steps)) {
      return res.status(400).json({
        ok: false,
        error: '"steps" must be an array',
        sample: [
          { "step": "goto", "target": "https://www.saucedemo.com/" },
          { "step": "fill", "target": "username", "value": "standard_user" },
          { "step": "fill", "target": "password", "value": "secret_sauce" },
          { "step": "click", "target": "login" },
          { "step": "expectUrlContains", "target": "/inventory" },
          { "step": "expectText", "target": "Products" }
        ]
      });
    }

    // prefer explicit baseUrl in body; else derive from first goto
    const baseUrl =
      req.body?.baseUrl ??
      (steps[0]?.step === 'goto' ? steps[0]?.target : '') ??
      '';

    const runId = String(Date.now());
    const report = await runWebTests({ steps, baseUrl, runId });
    res.json({ ok: true, runId, report });
  } catch (e) {
    console.error('run-web error:', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log('✅ Runner build: dynamic DOM + retries + video + screenshots');
  console.log(`API listening on :${PORT}`);
});

export default app;
