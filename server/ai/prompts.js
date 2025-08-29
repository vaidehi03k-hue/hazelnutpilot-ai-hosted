// server/ai/prompts.js
export function buildPrdPrompt({ prdText, project }) {
  return `
Project:
- id: ${project.id}
- name: ${project.name}
- baseUrl: ${project.baseUrl || "(not set)"}

PRD (verbatim text begins):
------------------------------------------------------------
${prdText}
------------------------------------------------------------
Instructions:
- Generate a comprehensive yet concise test plan JSON for the above project.
- Use {{project.baseUrl}} token where appropriate.
- Use variables for credentials/test data extracted from PRD.
- Prefer getByRole/getByLabel style targeting (role/name/label/text regex).
- Include at least one assertion per scenario.
ONLY OUTPUT THE JSON OBJECT — no backticks, no commentary.
`;
}
