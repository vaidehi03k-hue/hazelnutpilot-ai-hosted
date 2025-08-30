// server/runWebTests.js
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';

function joinUrl(base, rel) {
  if (!rel) return base || '/';
  if (rel.startsWith('http')) return rel;
  const b = (base || '').replace(/\/+$/, '');
  const r = rel.startsWith('/') ? rel : `/${rel}`;
  return b + r;
}

function asRegex(pat) {
  if (!pat) return /.*/;
  if (typeof pat === 'string' && pat.startsWith('/') && pat.lastIndexOf('/') > 0) {
    const last = pat.lastIndexOf('/');
    const body = pat.slice(1, last);
    const flags = pat.slice(last + 1) || 'i';
    return new RegExp(body, flags);
  }
  return new RegExp(pat, 'i');
}

async function locatorFor(page, t) {
  if (!t) throw new Error('Missing target');
  if (typeof t === 'string') return page.getByText(asRegex(t));       // NEW: allow plain string targets
  if (t.role && (t.name || t.label)) {
    if (t.label) return page.getByRole(t.role, { name: asRegex(t.label) });
    if (t.name)  return page.getByRole(t.role, { name: asRegex(t.name) });
  }
  if (t.label)       return page.getByLabel(asRegex(t.label));
  if (t.text)        return page.getByText(asRegex(t.text));
  if (t.placeholder) return page.getByPlaceholder(asRegex(t.placeholder));
  if (t.testId)      return page.getByTestId(t.testId);
  if (t.css)         return page.locator(t.css);
  if (t.xpath)       return page.locator(`xpath=${t.xpath}`);
  throw new Error('Unresolvable target: ' + JSON.stringify(t));
}

// Normalize step names & common field aliases
function normalizeStep(s) {
  const aliases = {
    navigate: 'goto', open: 'goto', go: 'goto',
    type: 'fill', input: 'fill',
    presskey: 'press', 'press-key': 'press',
    selectoption: 'select', 'select-option': 'select',
    checkbox: 'check', uncheckbox: 'uncheck',
    waitfor: 'waitForVisible', 'waitforvisible': 'waitForVisible',
    expecttext: 'assertText', expectvisible: 'assertVisible', expecturl: 'assertUrl'
  };
  const key = String(s.step || '').toLowerCase();
  if (aliases[key]) s.step = aliases[key];

  // Field shorthands
  if (s.step === 'goto' && s.url && !s.target) s.target = s.url;
  if (s.step === 'fill' && s.text != null && s.value == null) s.value = s.text;
  if (s.regex && s.pattern == null) s.pattern = s.regex;

  return s;
}

export async function runWebTests({ steps, baseUrl, runId, maxRunMs = 120000 }) {
  // lazy-load Playwright
  const { chromium } = await import('playwright');

  const outDir = path.join(process.cwd(), 'runs', runId);
  await fsp.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();

  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);

  const logLines = [];
  const log = m => {
    const line = `[${new Date().toISOString()}] ${m}`;
    logLines.push(line);
    console.log(line);
  };
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

      const s = normalizeStep({ ...steps[i] });
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

          case 'click':
            log(`STEP ${n}: click ${JSON.stringify(s.target)}`);
            await (await locatorFor(page, s.target)).click({ timeout: 10000 });
            break;

          case 'fill':
            log(`STEP ${n}: fill ${JSON.stringify(s.target)} value=${String(s.value ?? '')}`);
            await (await locatorFor(page, s.target)).fill(String(s.value ?? ''), { timeout: 10000 });
            break;

          case 'press':
            log(`STEP ${n}: press ${JSON.stringify(s.target)} key=${s.key || 'Enter'}`);
            await (await locatorFor(page, s.target)).press(String(s.key || 'Enter'), { timeout: 10000 });
            break;

          case 'select':
            log(`STEP ${n}: select ${JSON.stringify(s.target)} -> ${String(s.value)}`);
            await (await locatorFor(page, s.target)).selectOption(String(s.value), { timeout: 10000 });
            break;

          case 'check':
            log(`STEP ${n}: check ${JSON.stringify(s.target)}`);
            await (await locatorFor(page, s.target)).check({ timeout: 10000 });
            break;

          case 'uncheck':
            log(`STEP ${n}: uncheck ${JSON.stringify(s.target)}`);
            await (await locatorFor(page, s.target)).uncheck({ timeout: 10000 });
            break;

          case 'waitForVisible':
            log(`STEP ${n}: waitForVisible ${JSON.stringify(s.target)}`);
            await (await locatorFor(page, s.target)).waitFor({ state: 'visible', timeout: 10000 });
            break;

          case 'assertText': {
            // Flexible: allow string target, and/or infer pattern
            let tgt = s.target;
            let pat = s.pattern ?? s.text ?? (typeof tgt === 'string' ? tgt : undefined);
            if (typeof tgt === 'string') tgt = { text: tgt };
            // If only a pattern was provided, assert that some element with that text is visible
            if (!tgt && pat) {
              log(`STEP ${n}: assertText (page) ~ ${pat}`);
              await page.getByText(asRegex(pat)).waitFor({ state: 'visible', timeout: 10000 });
              break;
            }
            // If neither present, fail
            if (!tgt) throw new Error('assertText needs a target or pattern/text');
            if (!pat) pat = tgt.text || tgt.label || '';
            log(`STEP ${n}: assertText ${JSON.stringify(tgt)} ~ ${pat}`);
            const loc = await locatorFor(page, tgt);
            await loc.waitFor({ state: 'visible', timeout: 10000 });
            const txt = await loc.innerText();
            if (!asRegex(pat).test(txt)) throw new Error(`assertText failed: got "${txt}", expected ${pat}`);
            break;
          }

          case 'assertVisible': {
            // Allow string target
            const tgt = typeof s.target === 'string' ? { text: s.target } : s.target;
            log(`STEP ${n}: assertVisible ${JSON.stringify(tgt)}`);
            await (await locatorFor(page, tgt)).waitFor({ state: 'visible', timeout: 10000 });
            break;
          }

          case 'assertUrl': {
            const url = page.url();
            log(`STEP ${n}: assertUrl ~ ${s.pattern} on ${url}`);
            if (!asRegex(s.pattern).test(url)) throw new Error(`assertUrl failed: "${url}" !~ ${s.pattern}`);
            break;
          }

          case 'screenshot':
            log(`STEP ${n}: screenshot`);
            break;

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
    // save video
    try {
      const v = await (await context.pages())[0]?.video?.();
      if (v) await v.saveAs(path.join(outDir, 'run.webm'));
    } catch {}
    await context.close();
    await browser.close();
  }

  return {
    summary: { total: results.length, passed, failed: results.length - passed },
    results,
    artifacts: {
      video: `/runs/${runId}/run.webm`,
      screenshots: results.map(r => `/runs/${runId}/${r.screenshot}`),
      log: `/runs/${runId}/run.log`
    }
  };
}
