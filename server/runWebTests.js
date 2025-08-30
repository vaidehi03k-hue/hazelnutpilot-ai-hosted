// server/runWebTests.js
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';

function isRegexString(s) {
  return typeof s === 'string' && s.startsWith('/') && s.lastIndexOf('/') > 0;
}
function asRegex(pat) {
  if (!pat) return /.*/i;
  if (pat instanceof RegExp) return pat;
  if (isRegexString(pat)) {
    const last = pat.lastIndexOf('/');
    const body = pat.slice(1, last);
    const flags = pat.slice(last + 1) || 'i';
    try { return new RegExp(body, flags); } catch { return new RegExp(body, 'i'); }
  }
  // plain string => fuzzy, case-insensitive
  const esc = String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(esc, 'i');
}

// When target is a string, treat it as a text locator by default
function normalizeTarget(t) {
  if (t == null) return null;
  if (typeof t === 'string') return { text: t };
  if (typeof t === 'object') {
    const out = { ...t };
    if (typeof out.text === 'string') out.text = out.text;   // regex string allowed
    if (typeof out.name === 'string') out.name = out.name;
    if (typeof out.label === 'string') out.label = out.label;
    return out;
  }
  return t;
}

async function locatorFor(page, t) {
  const tgt = normalizeTarget(t);
  if (!tgt) throw new Error('Missing target');

  // Role + name/label preferred
  if (tgt.role && (tgt.name || tgt.label)) {
    if (tgt.label) return page.getByRole(tgt.role, { name: asRegex(tgt.label) });
    if (tgt.name)  return page.getByRole(tgt.role, { name: asRegex(tgt.name) });
  }

  // Accessible-friendly fallbacks
  if (tgt.label)       return page.getByLabel(asRegex(tgt.label));
  if (tgt.text)        return page.getByText(asRegex(tgt.text));
  if (tgt.placeholder) return page.getByPlaceholder(asRegex(tgt.placeholder));
  if (tgt.testId)      return page.getByTestId(tgt.testId);

  // Direct selectors
  if (tgt.css)         return page.locator(tgt.css);
  if (tgt.xpath)       return page.locator(`xpath=${tgt.xpath}`);

  throw new Error('Unresolvable target: ' + JSON.stringify(t));
}

// Click with smart fallbacks on Playwright strict violations (multiple matches)
async function smartClick(page, t, timeout = 10000) {
  const tgt = normalizeTarget(t);
  try {
    const loc = await locatorFor(page, tgt);
    await loc.click({ timeout });
    return;
  } catch (e) {
    const msg = String(e?.message || e);
    const patt = (tgt?.text || tgt?.name || tgt?.label);
    // If multiple matches or strict violation, try role-based guesses, then first()
    if (/strict mode violation|resolved to \d+ elements/i.test(msg) && patt) {
      const rex = asRegex(patt);
      try { await page.getByRole('button', { name: rex }).first().click({ timeout }); return; } catch {}
      try { await page.getByRole('link',   { name: rex }).first().click({ timeout }); return; } catch {}
      try {
        const loc2 = await locatorFor(page, tgt);
        await loc2.first().click({ timeout });
        return;
      } catch {}
    }
    throw e;
  }
}

// Select option accepting value/label/index and plain strings ("Option 2" or "2")
async function smartSelect(page, t, value, timeout = 10000) {
  const loc = await locatorFor(page, t);
  let opt = value;
  if (typeof opt === 'string') {
    // Numeric-looking? treat as value; else treat as label
    if (/^\d+$/.test(opt.trim())) {
      // keep as string "2" (value)
    } else {
      opt = { label: opt }; // "Option 2" -> label
    }
  } else if (opt && typeof opt === 'object') {
    // pass through {value|label|index}
  }
  await loc.selectOption(opt, { timeout });
}

// Join base and relative
function joinUrl(base, rel) {
  if (!rel) return base || '/';
  if (rel.startsWith('http')) return rel;
  const b = (base || '').replace(/\/+$/, '');
  const r = rel.startsWith('/') ? rel : `/${rel}`;
  return b + r;
}

export async function runWebTests({ steps, baseUrl, runId, video = true, maxRunMs = 120000 }) {
  const { chromium } = await import('playwright'); // lazy-load

  const outDir = path.join(process.cwd(), 'runs', runId);
  await fsp.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    recordVideo: video ? { dir: outDir, size: { width: 1280, height: 720 } } : undefined
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);

  const logLines = [];
  const log = m => { const line = `[${new Date().toISOString()}] ${m}`; logLines.push(line); console.log(line); };
  page.on('console', msg => log(`console:${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => log(`pageerror: ${err?.message || err}`));
  page.on('requestfailed', req => log(`requestfailed: ${req.method()} ${req.url()} -> ${req.failure()?.errorText}`));
  page.on('dialog', async d => { try { await d.dismiss(); } catch {} });

  const results = [];
  let passed = 0;
  const abortAt = Date.now() + maxRunMs;

  try {
    for (let i = 0; i < steps.length; i++) {
      if (Date.now() > abortAt) {
        log('Global timeout reached; aborting run');
        results.push({ step: 'timeout', status: 'error', error: `Run exceeded ${maxRunMs}ms`, screenshot: null });
        break;
      }

      const s = { ...(steps[i] || {}) };
      const n = i + 1;
      const snap = path.join(outDir, `${String(n).padStart(2, '0')}.png`);
      let status = 'ok', error = null;

      try {
        switch (s.step) {
          case 'goto': {
            const url = joinUrl(baseUrl, s.target || '/');
            log(`STEP ${n}: goto ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            break;
          }
          case 'click': {
            log(`STEP ${n}: click ${JSON.stringify(s.target)}`);
            await smartClick(page, s.target, 10000);
            break;
          }
          case 'fill': {
            log(`STEP ${n}: fill ${JSON.stringify(s.target)} value=${String(s.value ?? '')}`);
            const loc = await locatorFor(page, s.target);
            await loc.fill(String(s.value ?? ''), { timeout: 10000 });
            break;
          }
          case 'press': {
            log(`STEP ${n}: press ${JSON.stringify(s.target)} key=${s.key || 'Enter'}`);
            const loc = await locatorFor(page, s.target);
            await loc.press(String(s.key || 'Enter'), { timeout: 10000 });
            break;
          }
          case 'select': {
            log(`STEP ${n}: select ${JSON.stringify(s.target)} -> ${JSON.stringify(s.value)}`);
            await smartSelect(page, s.target, s.value, 10000);
            break;
          }
          case 'check': {
            log(`STEP ${n}: check ${JSON.stringify(s.target)}`);
            const loc = await locatorFor(page, s.target);
            await loc.check({ timeout: 10000 });
            break;
          }
          case 'uncheck': {
            log(`STEP ${n}: uncheck ${JSON.stringify(s.target)}`);
            const loc = await locatorFor(page, s.target);
            await loc.uncheck({ timeout: 10000 });
            break;
          }
          case 'waitForVisible': {
            log(`STEP ${n}: waitForVisible ${JSON.stringify(s.target)}`);
            const loc = await locatorFor(page, s.target);
            await loc.waitFor({ state: 'visible', timeout: 10000 });
            break;
          }
          case 'assertText': {
            // Accept: target string (page-level text) OR target locator + pattern/text
            const patt = s.pattern ?? s.text ?? (typeof s.target === 'string' ? s.target : null);
            if (!s.target || typeof s.target === 'string') {
              log(`STEP ${n}: assertText (page) ~ ${patt}`);
              await page.getByText(asRegex(patt)).waitFor({ state: 'visible', timeout: 10000 });
            } else {
              log(`STEP ${n}: assertText ${JSON.stringify(s.target)} ~ ${patt}`);
              const loc = await locatorFor(page, s.target);
              await loc.waitFor({ state: 'visible', timeout: 10000 });
              const txt = await loc.innerText();
              if (!asRegex(patt).test(txt)) throw new Error(`assertText failed: got "${txt}", expected ${patt}`);
            }
            break;
          }
          case 'assertVisible': {
            const tgt = typeof s.target === 'string' ? { text: s.target } : s.target;
            log(`STEP ${n}: assertVisible ${JSON.stringify(tgt)}`);
            const loc = await locatorFor(page, tgt);
            await loc.waitFor({ state: 'visible', timeout: 10000 });
            break;
          }
          case 'assertUrl': {
            const patt = s.pattern || s.contains || '';
            const url = page.url();
            log(`STEP ${n}: assertUrl ~ ${patt} on ${url}`);
            const rx = isRegexString(patt) ? asRegex(patt) : asRegex(String(patt));
            if (!rx.test(url)) throw new Error(`assertUrl failed: "${url}" !~ ${patt}`);
            break;
          }
          case 'sleep': {
            const ms = Number(s.ms || s.duration || 1000);
            log(`STEP ${n}: sleep ${ms}ms`);
            await new Promise(r => setTimeout(r, ms));
            break;
          }
          case 'screenshot': {
            log(`STEP ${n}: screenshot`);
            break;
          }
          default:
            throw new Error(`Unknown step: ${s.step}`);
        }
      } catch (e) {
        status = 'error';
        error = String(e?.message || e);
        log(`STEP ${n} FAILED: ${error}`);
      } finally {
        try { await page.screenshot({ path: snap, fullPage: false }); } catch {}
        results.push({ ...s, status, error, screenshot: path.basename(snap) });
        if (status === 'ok') passed += 1;
        if (status === 'error') break; // stop on first failure
      }
    }
  } finally {
    try { await fsp.writeFile(path.join(outDir, 'run.log'), logLines.join('\n')); } catch {}

    let videoHandle = null;
    if (video) {
      try { videoHandle = (await context.pages())[0]?.video?.(); } catch {}
    }
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
    if (video && videoHandle) {
      const save = (async () => { try { await videoHandle.saveAs(path.join(outDir, 'run.webm')); } catch {} })();
      await Promise.race([save, new Promise(r => setTimeout(r, 3000))]); // don't block response forever
    }
  }

  return {
    summary: { total: results.length, passed, failed: results.length - passed },
    results,
    artifacts: {
      video: video ? `/runs/${runId}/run.webm` : null,
      screenshots: results.map(r => `/runs/${runId}/${r.screenshot}`),
      log: `/runs/${runId}/run.log`
    }
  };
}
