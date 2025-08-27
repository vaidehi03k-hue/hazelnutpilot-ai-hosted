// HOSTED: uses OpenRouter (cloud) via API key + free model by default
export async function generateTestsFromPrd({ baseUrl, prdText }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing on server');

  // ✅ Free by default; override with OPENROUTER_MODEL if you want
  const model = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it:free';

  const prompt = `You are a QA test generator. Read the PRD and produce an array of JSON test steps.
Each item must be an object with keys: "step" (string), "expect" (string). Only output a JSON array, nothing else.
Base URL: ${baseUrl}
PRD:
${prdText}
Return ONLY a JSON array of objects like:
[
  {"step": "Go to ${baseUrl}", "expect": "Page loads"},
  {"step": "Enter \\"user\\" into username", "expect": "Field filled"}
]`;

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
