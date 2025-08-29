// server/ai.js
// Uses OpenRouter to turn PRD text into machine-friendly JSON test steps.
// If API key missing or parsing fails, returns a minimal fallback.

export async function generateTestsFromPrd({ baseUrl, prdText }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model  = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it:free';

  const prompt = `You are a QA test generator.
Read the PRD and output an array of JSON test steps.
Each step must be an object with keys:
- "step": one of [goto, click, fill, expectText, expectUrlContains]
- "target": string (URL for goto; human hint for element/text for others)
- "value": string (only for fill)
- "expect": string (optional, brief expectation)

Return ONLY a valid JSON array with no comments or prose.

Base URL: ${baseUrl || '(none)'}
PRD:
${prdText}
`;

  // Try OpenRouter first (if key provided)
  if (apiKey) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content?.trim() || '[]';

      let steps;
      try {
        steps = JSON.parse(text);
        if (!Array.isArray(steps)) {
          // handle shapes like { steps:[...] } or { data:[...] }
          steps = steps?.steps || steps?.data || [];
        }
      } catch {
        steps = [];
      }
      // Minimal sanity shape
      steps = steps.filter(s => s && typeof s === 'object' && s.step && s.target);
      if (steps.length) return steps;
    } catch {
      // fall through to fallback
    }
  }

  // Fallback minimal plan if AI unavailable or unparseable
  const safeBase = baseUrl || '';
  return [
    ...(safeBase ? [{ step: 'goto', target: safeBase }] : []),
    { step: 'expectText', target: 'Home' }
  ];
}
