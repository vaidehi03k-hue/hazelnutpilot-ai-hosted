import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

// --------- utils ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function normalizeUrl(url) {
  if (!url) return '';
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  return 'https://' + u.replace(/^\/+/, '');
}

// --------- step parsing (generic; no login assumptions) ----------
/*
  Supported patterns (examples, case-insensitive):
  - Go to https://example.com
  - Navigate to www.example.com/page
  - Click "Add to Cart"
  - Click the checkout button
  - Enter "Vaidehi" into name field
  - Fill email with "me@example.com"
  - Type "qwerty" in search
  - Expect to see "Order Placed"
  - Verify text "Welcome"
  - URL contains "/inventory"
*/
function parseStep(raw) {
  const step = typeof raw === 'string' ? raw : (raw?.step || '');
  const expect = typeof raw === 'object' ? (raw?.expect || '') : '';
  const s = String(step).trim();
  const low = s.toLowerCase();

  // goto
  const goto = low.match(/\b(go to|navigate to|open)\b\s+([^\s"']+)/);
  if (goto) return { type: 'goto', url: normalizeUrl(goto[2]), raw: step, expect };

  // fill: value "..." + target hint (optional)
  if (/\b(fill|type|enter)\b/.test(low)) {
    const value = (s.match(/"(.*?)"/) || [])[1] ?? '';
    // try to extract a hint phrase (e.g., "into name field", "in search", "into the company input")
    const hint =
      (low.match(/\b(into|in|on)\b\s+(the )?(.+?)(?: field| input| box| area)?$/)?.[3] || '')
        .replace(/["']/g, '')
        .trim();
    return { type: 'fill', value, hint, raw: step, expect };
  }

  // click by quoted text or hint
  if (/\b(click|press|tap)\b/.test(low)) {
    const quoted = (s.match(/"([^"]+)"/) || [])[1];
    const hint = quoted || (low.match(/\b(click|press|tap)\b\s+(the )?(.+)$/)?.[3] || '')
      .replace(/\b(button|link|cta|icon)\b/g, '')
      .trim();
    return { type: 'click', hint, raw: step, expect };
  }

  // expect URL contains
  const urlc = low.match(/url (contains|has)\s+"?([^"]+)"?/);
  if (urlc) return { type: 'expectUrlContains', frag: urlc[2], raw: step, expect };

  // see / verify text "..."
  const quotedText = (s.match(/"([^"]+)"/) || [])[1];
  if ((/\b(see|verify|expect)\b/.test(low) || expect) && (quotedText || expect)) {
    return { type: 'expectText', text: quotedText || expect, raw: step, expect };
  }

  return { type: 'noop', raw: step, expect };
}

// --------- dynamic selector resolution ----------
async function candidatesForFill(page, hint) {
  const cands = [];

  // 1) By label / placeholder (best)
  if (hint) {
    cands.push({ how: 'getByLabel', locator: page.getByLabel(hint, { exact: false }).first() });
    cands.push({ how: 'getByPlaceholder', locator: page.getByPlaceholder(hint, { exact: false }).first() });
  }

  // 2) Generic text inputs
  cands.push({ how: 'textInputs', locator: page.locator('input:not([type]),input[type="text"],textarea').first() });

  // 3) Fuzzy attributes by hint
  if (hint) {
    const css = [
      `input[name*="${cssEscape(hint)}" i]`,
      `input[id*="${cssEscape(hint)}" i]`,
      `[aria-label*="${cssEscape(hint)}" i]`,
      `[data-test*="${cssEscape(hint)}" i]`,
      `[data-qa*="${cssEscape(hint)}" i]`
    ].join(',');
    cands.push({ how: 'fuzzyAttrs', locator: page.locator(css).first() });
  }

  return filterExisting(page, cands);
}

async function candidatesForClick(page, hint) {
  const cands = [];

  if (hint) {
    cands.push({ how: 'role=button(name)', locator: page.getByRole('button', { name: hint, exact: false }).first() });
    cands.push({ how: 'role=link(name)',   locator: page.getByRole('link',   { name: hint, exact: false }).first() });
    cands.push({ how: 'text on clickable', locator: page.locator(`button:has-text("${cssEscape(hint)}"),a:has-text("${cssEscape(hint)}"),[role=button]:has-text("${cssEscape(hint)}")`).first() });
  }

  // Generic primary actions
  cands.push({ how: 'submit-ish', locator: page.locator('button[type=submit],input[type=submit]').first() });
  cands.push({ how: 'any button', locator: page.locator('button,[role=button]').first() });

  return filterExisting(page, cands);
}

async function filterExisting(page, arr) {
  const out = [];
  for (const c of arr) {
    try { if (await c.locator.count()) out.push(c); } catch {}
  }
  return out;
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// --------- AI tie-breaker (optional) ----------
async function aiPick({ stepText, context, candidates }) {
  if (!process.env.USE_AI_TIEBREAKER) return null;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it:free';

  // Build a compact prompt: send innerText + attributes for each candidate
  const candSummaries = await Promise.all(candidates.map(async (c, i) => {
    const el = c.locator;
    const info = await el.evaluate((node) => {
      const attrs = {};
      for (const a of (node.getAttributeNames?.() || [])) attrs[a] = node.getAttribute(a);
      return {
        tag: node.tagName?.toLowerCase?.() || 'node',
        attrs,
        text: (node.innerText || '').trim().slice(0, 200),
      };
    }).catch(() => ({ tag:'node', attrs:{}, text:'' }));
    return `#${i+1} [${c.how}] <${info.tag} ${Object.entries(info.attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}> text="${info.text}"`;
  }));

  const prompt = `You are helping map a PRD step to the correct DOM element.
Page context: ${context}
Step: "${stepText}"
Candidates:
${candSummaries.join('\n')}
Pick the single best candidate by number only (e.g., "2"). If none match, reply "none".`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.0,
      messages: [{ role:'user', content: prompt }]
    })
  }).catch(()=>null);
  if (!res || !res.ok) return null;
  const j = await res.json().catch(()=>null);
  const raw = j?.choices?.[0]?.message?.content || '';
  const m = raw.match(/\b(\d+)\b/);
  if (!m) return null;
  const idx = Number(m[1]) - 1;
  if (idx < 0 || idx >= candidates.length) return null;
  return candidates[idx];
}

// --------- main runner ----------
export async function runWebTests({ steps, baseUrl, runId }) {
  const runsRoot = path.join(process.cwd(), 'runs');
  const runDir   = path.join(runsRoot, runId || Date.now().toString());
  const shotsDir = path.join(runDir, 'screenshots');
  ensureDir(shotsDir);

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

  // Go to base URL first (if provided)
  const startUrl = normalizeUrl(baseUrl);
  if (startUrl) await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

  const results = [];
  let idx = 0;

  for (const raw of steps) {
    idx += 1;
    const s = parseStep(raw);
    let passed = true, error = null;

    try {
      if (s.type === 'goto') {
        await page.goto(s.url, { waitUntil: 'domcontentloaded' });
      }

      else if (s.type === 'fill') {
        let cands = await candidatesForFill(page, s.hint);
        let pick = cands[0] || null;

        // If ambiguous or none, ask AI
        if ((!pick || cands.length > 1)) {
          const ai = await aiPick({
            stepText: s.raw,
            context: `url=${page.url()}`,
            candidates: cands
          });
          if (ai) pick = ai;
        }
        if (!pick) throw new Error(`Field not found (hint="${s.hint||''}")`);
        await pick.locator.fill(s.value ?? '');
      }

      else if (s.type === 'click') {
        let cands = await candidatesForClick(page, s.hint);
        let pick = cands[0] || null;

        if ((!pick || cands.length > 1)) {
          const ai = await aiPick({
            stepText: s.raw,
            context: `url=${page.url()}`,
            candidates: cands
          });
          if (ai) pick = ai;
        }
        if (!pick) throw new Error(`Clickable not found (hint="${s.hint||''}")`);
        await pick.locator.click();
      }

      else if (s.type === 'expectUrlContains') {
        const url = page.url();
        if (!url.includes(s.frag)) throw new Error(`URL "${url}" does not include "${s.frag}"`);
      }

      else if (s.type === 'expectText') {
        const loc = page.getByText(s.text, { exact: false }).first();
        if (!(await loc.count())) throw new Error(`Text "${s.text}" not found`);
      }

      // else noop
      await page.waitForTimeout(120);
    } catch (e) {
      passed = false;
      error = String(e?.message || e);
    }

    const shotPath = path.join(shotsDir, `step-${String(idx).padStart(2,'0')}.png`);
    try { await page.screenshot({ path: shotPath, fullPage: true }); } catch {}

    results.push({
      index: idx,
      step: s.raw,
      expect: s.expect || '',
      passed,
      error,
      screenshot: shotPath.replace(process.cwd() + '/', '')
    });
  }

  // video artifact
  let video = null;
  try { video = (await page.video().path()).replace(process.cwd() + '/', ''); } catch {}
  await context.close();
  await browser.close();

  const passedCount = results.filter(r => r.passed).length;
  return {
    summary: { total: results.length, passed: passedCount, failed: results.length - passedCount, video },
    results
  };
}
