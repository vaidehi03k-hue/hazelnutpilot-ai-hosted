// server/ai.js
// PRD → JSON steps via OpenRouter only (STRICT).
// If the provider fails or returns bad output, we throw (no local fallback).

// ----- config -----
const OR_KEY   = (process.env.OPENROUTER_API_KEY || '').trim();
const OR_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-70b-instruct';

// ----- helpers -----
function stripCodeFences(s = '') {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return m ? m[1] : s;
}
function sloppyJsonExtract(s = '') {
  // try raw
  try { return JSON.parse(s); } catch {}
  // try code fence
  try { return JSON.parse(stripCodeFences(s)); } catch {}
  // try array slice
  const i = s.indexOf('['), j = s.lastIndexOf(']');
  if (i !== -1 && j !== -1 && j > i) {
    try { return JSON.parse(s.slice(i, j + 1)); } catch {}
  }
  // try object with steps/data
  try {
    const obj = JSON.parse(s);
    if (Array.isArray(obj?.steps)) return obj.steps;
    if (Array.isArray(obj?.data))  return obj.data;
  } catch {}
  return null;
}
function asRegex(pat) {
  if (!pat) return null;
  if (typeof pat === 'string' && pat.startsWith('/') && pat.lastIndexOf('/') > 0) return pat;
  const esc = String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `/${esc}/i`;
}
function normalizeStep(s) {
  if (!s || typeof s !== 'object') return null;
  const out = { ...s };

  // step aliases → your runner verbs
  const alias = {
    navigate: 'goto', open: 'goto', go: 'goto',
    type: 'fill', input: 'fill',
    presskey: 'press', 'press-key': 'press',
    selectoption: 'select', 'select-option': 'select',
    checkbox: 'check', uncheckbox: 'uncheck',
    waitfor: 'waitForVisible', waitforvisible: 'waitForVisible',
    expecttext: 'assertText', expectvisible: 'assertVisible',
    expecturl: 'assertUrl', expecturlcontains: 'assertUrl'
  };
  const key = String(out.step || '').toLowerCase();
  out.step = alias[key] || out.step;

  // common field shorthands
  if (out.step === 'goto' && out.url && !out.target) out.target = out.url;
  if (out.step === 'fill' && out.text != null && out.value == null) out.value = out.text;
  if (out.regex && out.pattern == null) out.pattern = out.regex;

  // make assertUrl accept plain "contains"
  if (out.step === 'assertUrl' && out.contains && !out.pattern) out.pattern = asRegex(out.contains);
  if (out.step === 'assertUrl' && typeof out.pattern === 'string' && !out.pattern.startsWith('/')) {
    out.pattern = asRegex(out.pattern);
  }

  // treat "expect" as pattern/text when present
  if (out.expect && !out.pattern && !out.text) {
    if (out.step === 'assertUrl') out.pattern = asRegex(String(out.expect));
    else                         out.text    = String(out.expect);
  }

  if (!out.step) return null;
  return out;
}
function normalizeAll(steps) {
  return (steps || []).map(normalizeStep).filter(Boolean);
}
async function withBackoff(fn, tries = 3, baseMs = 600) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      const st = e?.status || 0;
      if (st && st < 500 && st !== 429) break; // don't retry client errors except 429
      const delay = baseMs * Math.pow(2, i) + Math.floor(Math.random() * 150);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ----- provider call -----
async function callOpenRouter({ baseUrl, prdText }) {
  if (!OR_KEY) {
    const err = new Error('OPENROUTER_API_KEY missing; cannot generate steps.');
    err.status = 401;
    throw err;
  }

  const sys = `Convert a PRD into a JSON array of UI test steps for a Playwright-like runner.
Each step must be one of:
- "goto" { target }
- "click" { target }
- "fill" { target, value }
- "press" { target, key }
- "select" { target, value }
- "check" { target }
- "uncheck" { target }
- "waitForVisible" { target }
- "assertText" { target? (string or locator), pattern? or text? }
- "assertVisible" { target }
- "assertUrl" { pattern }

Targets can be strings (for text matches) or one of:
{ "role": "link|button|textbox|...", "name": "/regex/i" } |
{ "label": "/regex/i" } | { "text": "/regex/i" } | { "css": "selector" }.

Return ONLY the raw JSON array (no prose).`;

  const user = `Base URL: ${baseUrl || '(none)'}\n\nPRD:\n${prdText}`;

  const exec = async () => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OR_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OR_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: sys },
          { role: 'user',   content: user }
        ]
      })
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      const err = new Error(`OpenRouter ${r.status}: ${txt.slice(0, 300)}`);
      err.status = r.status;
      throw err;
    }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || '[]';
    const parsed  = sloppyJsonExtract(content);
    if (!parsed) {
      const err = new Error('OpenRouter returned non-JSON content');
      err.status = 502;
      throw err;
    }
    const steps = Array.isArray(parsed) ? parsed
                : Array.isArray(parsed?.steps) ? parsed.steps
                : [];
    const norm = normalizeAll(steps);
    if (!norm.length) {
      const err = new Error('OpenRouter produced empty/invalid steps');
      err.status = 422;
      throw err;
    }
    return norm;
  };

  return withBackoff(exec, 3, 600);
}

// ----- main export -----
export async function generateTestsFromPrd({ baseUrl = '', prdText = '' }) {
  const steps = await callOpenRouter({ baseUrl, prdText });
  console.log('[AI] Using OpenRouter', OR_MODEL, `(${steps.length} steps)`);
  return steps;
}
