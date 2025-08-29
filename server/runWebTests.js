// server/runWebTests.js
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const STEP_TIMEOUT = 8000;
const FIND_RETRIES = 2;
const RETRY_DELAY = 300;

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function normalizeUrl(url) {
  if (!url) return '';
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^www\./i.test(u)) return 'https://' + u;
  return 'https://' + u.replace(/^\/+/, '');
}
function cssEscape(s) { return String(s).replace(/(["\\])/g, '\\$1'); }

// accept structured OR natural language
function parseStep(raw) {
  if (raw && typeof raw === 'object' && raw.step) {
    const t = raw.step.toLowerCase();
    if (t === 'goto')              return { type: 'goto', url: normalizeUrl(raw.target), raw: JSON.stringify(raw) };
    if (t === 'fill')              return { type: 'fill', hint: raw.target || '', value: raw.value ?? '', raw: JSON.stringify(raw) };
    if (t === 'click')             return { type: 'click', hint: raw.target || '', raw: JSON.stringify(raw) };
    if (t === 'expecttext')        return { type: 'expectText', text: raw.target || '', raw: JSON.stringify(raw) };
    if (t === 'expecturlcontains') return { type: 'expectUrlContains', frag: raw.target || '', raw: JSON.stringify(raw) };
    return { type: 'noop', raw: JSON.stringify(raw) };
  }
  const step = typeof raw === 'string' ? raw : (raw?.step || '');
  const expect = typeof raw === 'object' ? (raw?.expect || '') : '';
  const s = String(step).trim();
  const low = s.toLowerCase();

  const goto = low.match(/\b(go to|navigate to|open)\b\s+([^\s"']+)/);
  if (goto) return { type: 'goto', url: normalizeUrl(goto[2]), raw: s };

  if (/\b(fill|type|enter)\b/.test(low)) {
    const value = (s.match(/"(.*?)"/) || [])[1] ?? '';
    const hint = (low.match(/\b(into|in|on)\b\s+(the )?(.+?)(?: field| input| box| area)?$/)?.[3] || '')
      .replace(/["']/g, '').trim();
    return { type: 'fill', value, hint, raw: s };
  }
  if (/\b(click|press|tap)\b/.test(low)) {
    const quoted = (s.match(/"([^"]+)"/) || [])[1];
    const hint = quoted || (low.match(/\b(click|press|tap)\b\s+(the )?(.+)$/)?.[3] || '')
      .replace(/\b(button|link|cta|icon)\b/g, '').trim();
    return { type: 'click', hint, raw: s };
  }
  const urlc = low.match(/url (contains|has)\s+"?([^"]+)"?/);
  if (urlc) return { type: 'expectUrlContains', frag: urlc[2], raw: s };

  const quotedText = (s.match(/"([^"]+)"/) || [])[1] || expect;
  if ((/\b(see|verify|expect)\b/.test(low) || expect) && quotedText) {
    return { type: 'expectText', text: quotedText, raw: s };
  }
  return { type: 'noop', raw: s };
}

async function filterExisting(cands) {
  const out = [];
  for (const c of cands) {
    try { if (await c.locator.count()) out.push(c); } catch {}
  }
  return out;
}
async function candidatesForFill(page, hint) {
  const c = [];
  if (hint) {
    c.push({ how: 'getByLabel',       locator: page.getByLabel(hint, { exact: false }).first() });
    c.push({ how: 'getByPlaceholder', locator: page.getByPlaceholder(hint, { exact: false }).first() });
  }
  c.push({ how: 'textInputs', locator: page.locator('input:not([type]),input[type="text"],textarea').first() });
  if (hint) {
    const fuzzy = [
      `input[name*="${cssEscape(hint)}" i]`,
      `input[id*="${cssEscape(hint)}" i]`,
      `[aria-label*="${cssEscape(hint)}" i]`,
      `[data-test*="${cssEscape(hint)}" i]`,
      `[data-qa*="${cssEscape(hint)}" i]`
    ].join(',');
    c.push({ how: 'fuzzyAttr', locator: page.locator(fuzzy).first() });
  }
  return filterExisting(c);
}
async function candidatesForClick(page, hint) {
  const c = [];
  if (hint) {
    c.push({ how: 'role=button(name)', locator: page.getByRole('button', { name: hint, exact: false }).first() });
    c.push({ how: 'role=link(name)',   locator: page.getByRole('link',   { name: hint, exact: false }).first() });
    c.push({ how: 'clickableText',     locator: page.locator(`button:has-text("${cssEscape(hint)}"),a:has-text("${cssEscape(hint)}"),[role=button]:has-text("${cssEscape(hint)}")`).first() });
  }
  c.push({ how: 'submit-ish', locator: page.locator('button[type=submit],input[type=submit]').first() });
  c.push({ how: 'any button', locator: page.locator('button,[role=button]').first() });
  return filterExisting(c);
}

// Optional AI tiebreaker
async function aiPick({ stepText, context, candidates }) {
  if (!process.env.USE_AI_TIEBREAKER) return null;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || candidates.length === 0) return null;

  const model = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it:free';
  const candSummaries = await Promise.all(candidates.map(async (c, i) => {
    const info = await c.locator.evaluate((node) => {
      const attrs = {};
      if (node.getAttributeNames) for (const a of node.getAttributeNames()) attrs[a] = node.getAttribute(a);
      return { tag: node.tagName?.toLowerCase?.() || 'node', attrs, text: (node.innerText || '').trim().slice(0, 120) };
    }).catch(() => ({ tag:'node', attrs:{}, text:'' }));
    return `#${i+1} [${c.how}] <${info.tag} ${Object.entries(info.attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}> text="${info.text}"`;
  }));

  const prompt = `Pick the correct DOM target for this step.
Step: "${stepText}"
Context: ${context}
Candidates:
${candSummaries.join('\n')}
Reply with just the number (e.g., "2"), or "none".`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role:'user', content: prompt }] })
  }).catch(()=>null);
  if (!res || !res.ok) return null;
  const j = await res.json().catch(()=>null);
  const raw = j?.choices?.[0]?.message?.content || '';
  const m = raw.match(/\b(\d+)\b/);
  const idx = m ? Number(m[1]) - 1 : -1;
  return (idx >= 0 && idx < candidates.length) ? candidates[idx] : null;
}

async function withRetries(fn, tries = FIND_RETRIES) {
  let last;
  for (let i=0;i<tries;i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise(r=>setTimeout(r, RETRY_DELAY)); }
  }
  throw last || new Error('retry exceeded');
}

export async function runWebTests({ steps, baseUrl, runId }) {
  if (!Array.isArray(steps)) throw new TypeError('"steps" must be an array');

  const runsRoot = path.join(process.cwd(), 'runs');
  const runDir   = path.join(runsRoot, runId || Date.now().toString());
  const shotsDir = path.join(runDir, 'screenshots');
  ensureDir(shotsDir);
  const logPath  = path.join(runDir, 'run.log');
  const log = (line) => fs.appendFileSync(logPath, line + '\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    recordVideo: { dir: runDir, size: { width: 1280, height: 800 } },
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const startUrl = normalizeUrl(baseUrl);
  if (startUrl) {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT }).catch(()=>{});
  }

  const results = [];
  let idx = 0;

  for (const raw of steps) {
    idx += 1;
    const s = parseStep(raw);
    let passed = true, error = null;

    try {
      if (s.type === 'goto') {
        await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
        await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT }).catch(()=>{});
      } else if (s.type === 'fill') {
        let cands = await withRetries(() => candidatesForFill(page, s.hint), FIND_RETRIES);
        let pick = cands[0] || null;
        if (!pick || cands.length > 1) {
          const ai = await aiPick({ stepText: s.raw, context: `url=${page.url()}`, candidates: cands });
          if (ai) pick = ai;
        }
        if (!pick) throw new Error(`Field not found (hint="${s.hint||''}")`);
        await pick.locator.scrollIntoViewIfNeeded();
        await pick.locator.fill(s.value ?? '', { timeout: STEP_TIMEOUT });
      } else if (s.type === 'click') {
        let cands = await withRetries(() => candidatesForClick(page, s.hint), FIND_RETRIES);
        let pick = cands[0] || null;
        if (!pick || cands.length > 1) {
          const ai = await aiPick({ stepText: s.raw, context: `url=${page.url()}`, candidates: cands });
          if (ai) pick = ai;
        }
        if (!pick) throw new Error(`Clickable not found (hint="${s.hint||''}")`);
        await pick.locator.scrollIntoViewIfNeeded();
        await pick.locator.click({ timeout: STEP_TIMEOUT });
        await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT }).catch(()=>{});
      } else if (s.type === 'expectUrlContains') {
        await page.waitForFunction((frag) => location.href.includes(frag), s.frag, { timeout: STEP_TIMEOUT });
      } else if (s.type === 'expectText') {
        const loc = page.getByText(s.text, { exact: false }).first();
        await loc.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
      }

      await page.waitForTimeout(120);
    } catch (e) {
      passed = false;
      error = String(e?.message || e);
      try {
        const html = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '');
        log(`STEP ${idx} FAIL: ${s.raw}\nERR: ${error}\nURL: ${page.url()}\nSNIPPET:\n${html}\n---`);
      } catch {
        log(`STEP ${idx} FAIL: ${s.raw}\nERR: ${error}\nURL: ${page.url()}\n---`);
      }
    }

    const shotPath = path.join(shotsDir, `step-${String(idx).padStart(2,'0')}.png`);
    try { await page.screenshot({ path: shotPath, fullPage: true }); } catch {}
    results.push({
      index: idx,
      step: s.raw,
      passed,
      error,
      screenshot: shotPath.replace(process.cwd() + '/', '')
    });
  }

  let video = null;
  try { video = (await page.video().path()).replace(process.cwd() + '/', ''); } catch {}
  await context.close();
  await browser.close();

  const passedCount = results.filter(r => r.passed).length;
  return { summary: { total: results.length, passed: passedCount, failed: results.length - passedCount, video }, results };
}
