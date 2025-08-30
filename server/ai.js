// server/ai.js
// PRD → JSON steps via OpenRouter only (STRICT).
// Accepts both {step:"goto", target:"/"} and {"goto": "..."} shapes.

const OR_KEY   = (process.env.OPENROUTER_API_KEY || '').trim();
const OR_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

// ---------- helpers ----------
function stripCodeFences(s = '') {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return m ? m[1] : s;
}
function sloppyJsonExtract(s = '') {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(stripCodeFences(s)); } catch {}
  const i = s.indexOf('['), j = s.lastIndexOf(']');
  if (i !== -1 && j !== -1 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch {} }
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

// Turn {"goto":"..."} or {"assertVisible":{...}} into {step:"goto", target:...}
function explodeVerbObject(stepLike) {
  if (!stepLike || typeof stepLike !== 'object' || Array.isArray(stepLike)) return null;
  const keys = Object.keys(stepLike);
  if (keys.length !== 1) return null;
  const verb = keys[0];
  const payload = stepLike[verb];
  const out = { step: verb };

  // payload may be a string (URL/text) or an object (locator)
  if (typeof payload === 'string') {
    if (verb.toLowerCase().includes('url')) out.pattern = asRegex(payload);
    else if (verb.toLowerCase() === 'goto' || verb.toLowerCase() === 'navigate' || verb.toLowerCase() === 'open')
      out.target = payload;
    else
      out.target = payload; // string text targets are allowed for assertText/assertVisible
    return out;
  }
  if (payload && typeof payload === 'object') {
    // normalize common fields in payload into runner shape
    const tgt = payload.target || payload.selector || payload.locator || payload.targetText || payload.element || payload.query;
    if (tgt) out.target = tgt;
    if (payload.url && !out.target) out.target = payload.url;
    if (payload.value != null) out.value = payload.value;
    if (payload.input != null && out.value == null) out.value = payload.input;
    if (payload.text != null && out.value == null && (verb === 'fill' || verb === 'type' || verb === 'input')) out.value = payload.text;
    if (payload.contains && !out.pattern) out.pattern = asRegex(payload.contains);
    if (payload.regex && !out.pattern) out.pattern = payload.regex;
    if (payload.expect && !out.pattern && !payload.text) {
      if (verb.toLowerCase().includes('url')) out.pattern = asRegex(String(payload.expect));
      else out.text = String(payload.expect);
    }

    // If there was no explicit "target" but payload looks like a locator object (role/label/text/css)
    if (!out.target) {
      const possibleLocator = {};
      ['role','name','label','text','placeholder','testId','css','xpath'].forEach(k => {
        if (payload[k] != null) possibleLocator[k] = payload[k];
      });
      if (Object.keys(possibleLocator).length) out.target = possibleLocator;
    }
    return out;
  }
  return out;
}

// normalize to runner verbs/fields
function normalizeStep(s) {
  if (!s) return null;

  // 1) Handle {"goto":"..."} style
  if (!s.step && typeof s === 'object' && !Array.isArray(s)) {
    const exploded = explodeVerbObject(s);
    if (exploded) s = exploded;
  }

  if (!s || typeof s !== 'object') return null;
  const out = { ...s };

  // 2) Map action/type/op/name → step
  if (!out.step) out.step = out.action || out.type || out.op || out.name;

  // 3) Step aliases
  const alias = {
    navigate: 'goto', open: 'goto', go: 'goto',
    type: 'fill', input: 'fill', enter: 'fill',
    presskey: 'press', 'press-key': 'press',
    selectoption: 'select', 'select-option': 'select',
    checkbox: 'check', uncheckbox: 'uncheck',
    waitfor: 'waitForVisible', waitforvisible: 'waitForVisible',
    expecttext: 'assertText', expectvisible: 'assertVisible',
    expecturl: 'assertUrl', expecturlcontains: 'assertUrl'
  };
  const key = String(out.step || '').toLowerCase();
  out.step = alias[key] || out.step;

  // 4) Field shorthands
  if (out.step === 'goto' && out.url && !out.target) out.target = out.url;
  if (!out.target) out.target = out.selector || out.locator || out.targetText || out.element || out.query;
  if (out.input != null && out.value == null) out.value = out.input;
  if (out.text != null && out.value == null && out.step === 'fill') out.value = out.text;
  if (out.contains && !out.pattern) out.pattern = asRegex(out.contains);
  if (out.regex && !out.pattern) out.pattern = out.regex;
  if (out.expect && !out.pattern && !out.text) {
    if (out.step === 'assertUrl') out.pattern = asRegex(String(out.expect));
    else out.text = String(out.expect);
  }
  if (out.step === 'assertUrl' && typeof out.pattern === 'string' && !out.pattern.startsWith('/')) {
    out.pattern = asRegex(out.pattern);
  }

  return out.step ? out : null;
}

function normalizeAll(steps) {
  return (steps || [])
    .map(normalizeStep)
    .filter(Boolean);
}

async function withBackoff(fn, tries = 3, baseMs = 600) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      const st = e?.status || 0;
      if (st && st < 500 && st !== 429) break; // only retry 429/5xx
      const delay = baseMs * Math.pow(2, i) + Math.floor(Math.random() * 150);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ---------- provider call ----------
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

Targets can be strings (text match) or objects:
{ "role": "link|button|textbox|...", "name": "/regex/i" } |
{ "label": "/regex/i" } | { "text": "/regex/i" } | { "css": "selector" }.

Allowed output formats:
1) [{"step":"goto","target":"/"}, {"step":"assertText","target":"Welcome"}]
2) [{"goto":"/"}, {"assertText":"Welcome"}]
Return ONLY the JSON array (no prose, no code fences).`;

  const user = `Base URL: ${baseUrl || '(none)'}\n\nPRD:\n${prdText}`;

  const mkBody = (strictJson) => ({
    model: OR_MODEL,
    temperature: 0.2,
    ...(strictJson ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: sys },
      { role: 'user',   content: user }
    ]
  });

  const exec = async (strictJson) => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OR_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mkBody(strictJson))
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      const err = new Error(`OpenRouter ${r.status}: ${txt.slice(0, 400)}`);
      err.status = r.status;
      throw err;
    }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || '';
    const parsed  = sloppyJsonExtract(content);
    if (!parsed) {
      console.error('[AI] Non-JSON content snippet:', String(content).slice(0, 240));
      const err = new Error('OpenRouter returned non-JSON content');
      err.status = 502;
      throw err;
    }
    // Accept both shapes: array of steps or {steps:[...]}
    const rawSteps = Array.isArray(parsed) ? parsed
                   : Array.isArray(parsed?.steps) ? parsed.steps
                   : [];
    const norm = normalizeAll(rawSteps);
    if (!norm.length) {
      console.error('[AI] Parsed but empty/invalid steps snippet:', JSON.stringify(rawSteps).slice(0, 240));
      const err = new Error('OpenRouter produced empty/invalid steps');
      err.status = 422;
      throw err;
    }
    return norm;
  };

  // Try strict JSON first, then non-strict
  try {
    return await withBackoff(() => exec(true), 3, 600);
  } catch (e) {
    console.warn('[AI] Strict JSON mode failed, retrying without response_format:', e?.message || e);
    return await withBackoff(() => exec(false), 3, 600);
  }
}

// ---------- main ----------
export async function generateTestsFromPrd({ baseUrl = '', prdText = '' }) {
  const steps = await callOpenRouter({ baseUrl, prdText });
  console.log('[AI] Using OpenRouter', OR_MODEL, `(${steps.length} steps)`);
  return steps;
}
