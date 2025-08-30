// server/runWebTests.js
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { chromium } from 'playwright';

function joinUrl(base, rel) {
  if (!rel) return base || '/';
  if (rel.startsWith('http')) return rel;
  const b = (base || '').replace(/\/+$/, '');
  const r = rel.startsWith('/') ? rel : `/${rel}`;
  return b + r;
}

function asRegex(pat) {
  if (!pat) return /.*/;
  if (pat.startsWith('/') && pat.lastIndexOf('/') > 0) {
    const last = pat.lastIndexOf('/');
    const body = pat.slice(1, last);
    const flags = pat.slice(last + 1) || 'i';
    return new RegExp(body, flags);
  }
  return new RegExp(pat, 'i');
}

async function locatorFor(page, t) {
  if (!t) throw new Error('Missing target');
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

export async function runWebTests({ steps, baseUrl, runId }) {
  const outDir = path.join(process.cwd(), 'runs', runId);
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();

  const results = [];
  let passed = 0;

  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const stepNo = i + 1;
      const snap = path.join(outDir, `${String(stepNo).padStart(2, '0')}.png`);
      let status = 'ok';
      let error = null;

      try {
        switch (s.step) {
          case 'goto':
            await page.goto(joinUrl(baseUrl, s.target || '/'), { waitUntil: 'domcontentloaded' });
            break;

          case 'click':
            await (await locatorFor(page, s.target)).click();
            break;

          case 'fill':
            await (await locatorFor(page, s.target)).fill(String(s.value ?? ''));
            break;

          case 'press':
            await (await locatorFor(page, s.target)).press(String(s.key || 'Enter'));
            break;

          case 'select':
            await (await locatorFor(page, s.target)).selectOption(String(s.value));
            break;

          case 'check':
            await (await locatorFor(page, s.target)).check();
            break;

          case 'uncheck':
            await (await locatorFor(page, s.target)).uncheck();
            break;

          case 'waitForVisible':
            await (await locatorFor(page, s.target)).waitFor({ state: 'visible' });
            break;

          case 'assertText': {
            const loc = await locatorFor(page, s.target);
            await loc.waitFor({ state: 'visible' });
            const txt = await loc.innerText();
            const ok = asRegex(s.pattern).test(txt);
            if (!ok) throw new Error(`assertText failed: got "${txt}", expected ${s.pattern}`);
            break;
          }

          case 'assertVisible':
            await (await locatorFor(page, s.target)).waitFor({ state: 'visible' });
            break;

          case 'assertUrl': {
            const url = page.url();
            const ok = asRegex(s.pattern).test(url);
            if (!ok) throw new Error(`assertUrl failed: "${url}" !~ ${s.pattern}`);
            break;
          }

          case 'screenshot':
            // explicit capture point; we still take a screenshot below
            break;

          default:
            throw new Error(`Unknown step: ${s.step}`);
        }
      } catch (e) {
        status = 'error';
        error = String(e?.message || e);
      } finally {
        await page.screenshot({ path: snap, fullPage: false }).catch(() => {});
        results.push({ ...s, status, error, screenshot: path.basename(snap) });
        if (status === 'ok') passed += 1;
        if (status === 'error') break; // stop on first failure (change if you prefer)
      }
    }
  } finally {
    const v = await page.video();
    if (v) await v.saveAs(path.join(outDir, 'run.webm')).catch(() => {});
    await context.close();
    await browser.close();
  }

  return {
    summary: { total: results.length, passed, failed: results.length - passed },
    results,
    artifacts: {
      video: `/runs/${runId}/run.webm`,
      screenshots: results.map(r => `/runs/${runId}/${r.screenshot}`)
    }
  };
}
