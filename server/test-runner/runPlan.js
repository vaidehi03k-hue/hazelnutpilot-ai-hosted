// server/test-runner/runPlan.js
import path from "path";
import fs from "fs/promises";
import { chromium } from "playwright";

function resolveUrl(baseUrl, url) {
  if (!url) return baseUrl || "/";
  if (url.startsWith("http")) return url;
  const base = (baseUrl || "").replace(/\/+$/, "");
  const rel = url.startsWith("/") ? url : `/${url}`;
  return base + rel;
}

function template(str, vars) {
  return String(str).replace(/\{\{(\w+(\.\w+)*)\}\}/g, (_, key) => {
    const parts = key.split(".");
    let val = vars;
    for (const p of parts) val = val?.[p];
    return val ?? "";
  });
}

async function resolveTarget(page, t) {
  // Prefer role/label/name/text; fallback to css/xpath if supplied
  if (!t) throw new Error("Missing target");
  if (t.role && (t.name || t.label)) {
    if (t.label) return page.getByRole(t.role, { name: new RegExp(t.label, "i") });
    if (t.name) return page.getByRole(t.role, { name: new RegExp(t.name, "i") });
  }
  if (t.label) return page.getByLabel(new RegExp(t.label, "i"));
  if (t.text) return page.getByText(new RegExp(t.text, "i"));
  if (t.placeholder) return page.getByPlaceholder(new RegExp(t.placeholder, "i"));
  if (t.testId) return page.getByTestId(t.testId);
  if (t.css) return page.locator(t.css);
  if (t.xpath) return page.locator(`xpath=${t.xpath}`);
  throw new Error("Unresolvable target: " + JSON.stringify(t));
}

export async function runPlan({ plan, project, jobDir }) {
  await fs.mkdir(jobDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: { dir: jobDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();

  const vars = { project, ...(plan.variables || {}), entities: plan.entities || {} };
  const results = { startedAt: new Date().toISOString(), scenarios: [] };

  try {
    for (const [i, sc] of (plan.scenarios || []).entries()) {
      const scRes = { name: sc.name, steps: [], passed: true };
      for (let j = 0; j < (sc.steps || []).length; j++) {
        const s = sc.steps[j];
        const stepId = `s${i + 1}-${j + 1}`;
        const stepFile = path.join(jobDir, `${stepId}.png`);
        try {
          switch (s.action) {
            case "navigate":
              await page.goto(resolveUrl(template(plan.baseUrl || project.baseUrl || "", vars), template(s.url || "/", vars)));
              break;
            case "click":
              await (await resolveTarget(page, s.target)).click();
              break;
            case "fill":
              await (await resolveTarget(page, s.target)).fill(template(s.value || "", vars));
              break;
            case "press":
              await (await resolveTarget(page, s.target)).press(s.key || "Enter");
              break;
            case "select":
              await (await resolveTarget(page, s.target)).selectOption(s.value);
              break;
            case "check":
              await (await resolveTarget(page, s.target)).check();
              break;
            case "uncheck":
              await (await resolveTarget(page, s.target)).uncheck();
              break;
            case "waitForUrl":
              await page.waitForURL(new RegExp(template(s.pattern, vars)));
              break;
            case "waitForVisible":
              await (await resolveTarget(page, s.target)).waitFor({ state: "visible" });
              break;
            case "assertText":
              await (await resolveTarget(page, s.target)).waitFor({ state: "visible" });
              {
                const txt = await (await resolveTarget(page, s.target)).innerText();
                const ok = new RegExp(s.pattern, "i").test(txt);
                if (!ok) throw new Error(`assertText failed: "${txt}" !~ ${s.pattern}`);
              }
              break;
            case "assertVisible":
              await (await resolveTarget(page, s.target)).waitFor({ state: "visible" });
              break;
            case "assertUrl":
              {
                const url = page.url();
                const ok = new RegExp(s.pattern).test(url);
                if (!ok) throw new Error(`assertUrl failed: "${url}" !~ ${s.pattern}`);
              }
              break;
            default:
              throw new Error("Unknown action: " + s.action);
          }
          await page.screenshot({ path: stepFile });
          scRes.steps.push({ ...s, status: "ok", screenshot: path.basename(stepFile) });
        } catch (err) {
          await page.screenshot({ path: stepFile });
          scRes.steps.push({ ...s, status: "error", error: String(err), screenshot: path.basename(stepFile) });
          scRes.passed = false;
          // continue to next step or break; choose strictness:
          break;
        }
      }
      results.scenarios.push(scRes);
    }
  } finally {
    const v = await page.video();
    if (v) await v.saveAs(path.join(jobDir, "run.webm"));
    await context.close();
    await browser.close();
  }

  results.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(jobDir, "results.json"), JSON.stringify(results, null, 2));
  return results;
}
