// ui/src/api.js
export const API_BASE =
  import.meta.env.VITE_API_HOST?.replace(/\/+$/, "") || "http://localhost:4000";

export async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(j?.error || r.statusText);
  return j;
}

export async function apiPost(path, body = {}) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(j?.error || r.statusText);
  return j;
}

export async function apiUpload(path, { file, extra = {} } = {}) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  for (const [k, v] of Object.entries(extra)) {
    fd.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const r = await fetch(`${API_BASE}${path}`, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(j?.error || r.statusText);
  return j;
}

// default export shim so old code `import api from "../api"` still works
const api = { API_BASE, apiGet, apiPost, apiUpload };
export default api;
