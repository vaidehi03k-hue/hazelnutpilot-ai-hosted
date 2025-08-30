// server/runWebTests.js
import * as path from "node:path";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";

// Block noisy third-party calls that often fail DNS in containers
const BLOCK_PATTERNS = [
  /optimizely\.com/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /hotjar\.com/i,
  /segment\.com/i,
  /mixpanel\.com/i,
  /cdn\.amplitude\.com/i,
];
const shouldBlock = (url) => BLOCK_PATTERNS.some((re) => re.test(url));

const joinUrl = (base, rel) => {
  if (!rel) return base || "/";
  if (rel.startsWith("http")) return rel;
  const b = (base || "").replace(/\/+$/, "");
  const r = rel.startsWith("/") ? rel : `/${rel}`;
  return b + r;
};

function asRegex(pat) {
  if (!pat) return /.*/i;
  if (pat instanceof RegExp) return pat;
  if (typeof pat === "string" && pat.startsWith("/") && pat.lastIndexOf("/") > 0) {
    const last = pat.lastIndexOf("/");
    const body = pat.slice(1, last);
    const flags = pat.slice(last + 1) || "i";
    return new RegExp(body, flags);
  }
  return new RegExp(String(pat), "i");
}

async function fileExists(p) { try { await fsp.access(p); return true; } catch { return false; } }
async function safeScreenshot(page, outPath) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.waitForTimeout(150);
      await page.screenshot({ path: outPath, type: "png" });
      if (await fileExists(outPath)) return true;
    } catch {}
  }
  return false;
}

async function locatorFor(page, t) {
  // allow page-level assert by passing string/regex
  if (typeof t === "string" || t instanceof RegExp) return page.getByText(asRegex(t));
  if (!t) throw new Error("Missing target");

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

  throw new Error("Unresolvable target: " + JSON.stringify(t));
}

export async function runWebTests({ steps, baseUrl, runId, maxRunMs = 120000 }) {
  const { chromium } = await import("playwright");

  const outDir = path.join(process.cwd(), "runs", runId);
  await fsp.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
  });

  // Block analytics/CDNs that fail in sandbox
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (shouldBlock(url)) return route.abort();
    return route.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);

  const logLines = [];
  const log = (m) => {
    const line = `[${new Date().toISOString()}] ${m}`;
    logLines.push(line);
    console.log(line);
  };

  page.on("console", (msg) => log(`console:${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => log(`pageerror: ${err?.message || err}`));
  page.on("requestfailed", (req) => {
    const u = req.url();
    if (shouldBlock(u)) return;
    log(`requestfailed: ${req.method()} ${u} -> ${req.failure()?.errorText}`);
  });
  page.on("dialog", async (d) => { try { await d.dismiss(); } catch {} });

  const results = [];
  let passed = 0;
  const abortAt = Date.now() + maxRunMs;

  let videoObj = null;

  try {
    for (let i = 0; i < steps.length; i++) {
      if (Date.now() > abortAt) {
        log("Global timeout reached; aborting run");
        results.push({ step: "timeout", status: "error", error: `Run exceeded ${maxRunMs}ms`, screenshot: null });
        break;
      }

      const s = steps[i];
      const n = i + 1;
      const snap = path.join(outDir, `${String(n).padStart(2, "0")}.png`);
      let status = "ok", error = null;

      try {
        switch (s.step) {
          case "goto": {
            const target = joinUrl(baseUrl, s.target || "/");
            log(`STEP ${n}: goto ${target}`);
            await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
            break;
          }
          case "click": {
            log(`STEP ${n}: click ${JSON.stringify(s.target)}`);
            const loc = await locatorFor(page, s.target);
            await loc.click({ timeout: 12000 });
            break;
          }
          case "fill": {
            log(`STEP ${n}: fill ${JSON.stringify(s.target)} value=${String(s.value ?? "")}`);
            const loc = await locatorFor(page, s.target);
            await loc.fill(String(s.value ?? ""), { timeout: 12000 });
            break;
          }
          case "press": {
            log(`STEP ${n}: press ${JSON.stringify(s.target)} key=${s.key || "Enter"}`);
            const loc = await locatorFor(page, s.target);
            await loc.press(String(s.key || "Enter"), { timeout: 12000 });
            break;
          }
          case "select": {
            log(`STEP ${n}: select ${JSON.stringify(s.target)} -> ${String(s.value)}`);
            const loc = await locatorFor(page, s.target);
            await loc.selectOption(String(s.value), { timeout: 12000 });
            break;
          }
          case "check": {
            log(`STEP ${n}: check ${JSON.stringify(s.target)}`);
            const loc = await locatorFor(page, s.target);
            await loc.check({ timeout: 12000 });
            break;
          }
          case "uncheck": {
            log(`STEP ${n}: uncheck ${JSON.stringify(s.target)}`);
            const loc = await locatorFor(page, s.target);
            await loc.uncheck({ timeout: 12000 });
            break;
          }
          case "waitForVisible": {
            log(`STEP ${n}: waitForVisible ${JSON.stringify(s.target)}`);
            const loc = await locatorFor(page, s.target);
            await loc.waitFor({ state: "visible", timeout: 12000 });
            break;
          }
          case "assertText": {
            const pattern = asRegex(s.pattern || s.target);
            log(`STEP ${n}: assertText (page) ~ ${pattern}`);
            const content = await page.locator("body").innerText({ timeout: 8000 });
            if (!pattern.test(content)) throw new Error(`assertText failed: pattern ${pattern} not found in page`);
            break;
          }
          case "assertVisible": {
            log(`STEP ${n}: assertVisible ${JSON.stringify(s.target)}`);
            const loc = await locatorFor(page, s.target);
            await loc.waitFor({ state: "visible", timeout: 12000 });
            break;
          }
          case "assertUrl": {
            const url = page.url();
            const pattern = asRegex(s.pattern);
            log(`STEP ${n}: assertUrl ~ ${s.pattern} on ${url}`);
            if (!pattern.test(url)) throw new Error(`assertUrl failed: "${url}" !~ ${s.pattern}`);
            break;
          }
          case "screenshot": {
            log(`STEP ${n}: screenshot`);
            break;
          }
          default:
            throw new Error(`Unknown step: ${s.step}`);
        }
      } catch (e) {
        status = "error";
        error = String(e?.message || e);
        log(`STEP ${n} FAILED: ${error}`);
      } finally {
        try { await safeScreenshot(page, snap); } catch {}
        results.push({ ...s, status, error, screenshot: path.basename(snap) });
        if (status === "ok") passed += 1;
        if (status === "error") break; // stop on first failure
      }

      if (!videoObj) {
        try { videoObj = page.video ? page.video() : null; } catch { videoObj = null; }
      }
    }
  } finally {
    try { await fsp.writeFile(path.join(outDir, "run.log"), logLines.join("\n")); } catch {}

    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    try {
      if (videoObj && videoObj.path) {
        const vp = await videoObj.path();
        const dest = path.join(outDir, "run.webm");
        await fsp.copyFile(vp, dest).catch(() => {});
      } else {
        const candidates = [];
        const walk = async (dir) => {
          const entries = await fsp.readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) await walk(p);
            else if (e.isFile() && p.toLowerCase().endsWith(".webm")) {
              const st = await fsp.stat(p).catch(() => null);
              candidates.push({ p, size: st?.size || 0 });
            }
          }
        };
        await walk(outDir);
        candidates.sort((a, b) => b.size - a.size);
        if (candidates[0]) {
          const dest = path.join(outDir, "run.webm");
          await fsp.copyFile(candidates[0].p, dest).catch(() => {});
        }
      }
    } catch {}
  }

  return {
    summary: { total: results.length, passed, failed: results.length - passed },
    results,
    artifacts: {
      video: `/runs/${runId}/run.webm`,
      screenshots: results.map((r) => `/runs/${runId}/${r.screenshot}`),
      log: `/runs/${runId}/run.log`,
    },
  };
}
