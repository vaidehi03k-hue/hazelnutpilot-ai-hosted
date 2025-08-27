// HOSTED: uses OpenRouter (cloud) via API key + free model by default
export async function generateTestsFromPrd({ baseUrl, prdText }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing on server');

  // ✅ Free by default; override with OPENROUTER_MODEL if you want
  const model = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it:free';

const prompt = `You are a QA test generator. 
Read the PRD and output an array of JSON test steps. 
Each step must be an object with keys:

- "step": short action in imperative form, one of [goto, click, fill, expectText, expectUrlContains].
- "target": (string) a human-readable hint for the DOM element, e.g. "username", "password", "login button", "checkout link".
- "value": (string, optional) only for fill steps.
- "expect": (string) what should be verified, if applicable.

Example:
[
 { "step": "goto", "target": "https://www.saucedemo.com", "expect": "login page loads" },
 { "step": "fill", "target": "username", "value": "standard_user", "expect": "field filled" },
 { "step": "fill", "target": "password", "value": "secret_sauce", "expect": "field filled" },
 { "step": "click", "target": "login button", "expect": "navigates to inventory" },
 { "step": "expectText", "target": "Products", "expect": "text appears" }
]

Base URL: ${baseUrl}
PRD:
${prdText}

Return ONLY valid JSON array (no commentary).`


  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // (Optional but recommended) Identify your app:
      // 'HTTP-Referer': 'https://your-app-domain.com',
      // 'X-Title': 'HazelnutPilot AI',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenRouter error ${res.status}: ${txt}`);
  }

  const j = await res.json();
  const raw = j?.choices?.[0]?.message?.content ?? '[]';

  // Be tolerant: grab JSON even if the model wraps it in prose or code fences
  const match = raw.match(/\[[\s\S]*\]/);
  const jsonText = match ? match[0] : raw.trim();

  try {
    const arr = JSON.parse(jsonText);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
