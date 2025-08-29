// server/ai/llm.js
import fs from "fs/promises";

export async function callLLM({ system, prompt }) {
  // ---- Replace this stub with your provider of choice. ----
  // Minimal stub so code runs: echoes a trivial plan if model is not configured.
  if (!process.env.OPENAI_API_KEY && !process.env.AZURE_OPENAI_API_KEY) {
    return {
      suiteName: "Sample (no-provider)",
      baseUrl: "{{project.baseUrl}}",
      variables: { validEmail: "qa@example.com", validPassword: "P@ssw0rd!" },
      scenarios: [
        {
          name: "Open home",
          steps: [
            { action: "navigate", url: "/" },
            { action: "assertVisible", target: { text: "/.+/" } }
          ]
        }
      ]
    };
  }

  // Example outline for OpenAI (Responses API) — implement for your stack:
  // import OpenAI from "openai";
  // const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // const resp = await client.responses.create({
  //   model: process.env.OPENAI_MODEL || "gpt-4.1",
  //   input: [
  //     { role: "system", content: system },
  //     { role: "user", content: prompt }
  //   ],
  //   response_format: { type: "json_object" }
  // });
  // const text = resp.output_text || resp.output[0].content[0].text;
  // return JSON.parse(text);

  throw new Error("LLM provider not configured — add your provider call in llm.js");
}

export const SYSTEM_PROMPT = `
You are a senior QA engineer. Convert a PRD into an executable web test plan JSON.
Strictly output a single JSON object matching this schema:

{
 "suiteName": string,
 "baseUrl": string, // can contain {{project.baseUrl}}
 "entities": object, // optional: users, products, etc. extracted from PRD
 "variables": object, // key-value strings
 "scenarios": [
   { "name": string,
     "steps": [
        // actions listed in README; prefer accessible targets:
        // { "action":"click","target":{"role":"button","name":"/Submit/i"} }
        // { "action":"fill","target":{"role":"textbox","label":"Email"}, "value":"..."}
     ]
   }
 ]
}

Guidelines:
- Derive actions only from PRD (no assumptions beyond it).
- Prefer role/label/name based locators; avoid CSS if not specified.
- Use relative URLs when appropriate; prepend with baseUrl at runtime.
- Use variables for any data values.
- Keep steps short and deterministic; add asserts after user-visible transitions.
- Do NOT include any explanation text, only JSON.
`;
