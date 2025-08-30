// ui/src/api.js
// Reads VITE_API_HOST at build time. If missing, falls back to http://localhost:4000.
// Set VITE_API_HOST on Vercel to your Render URL (no trailing slash), e.g.
//   VITE_API_HOST=https://hazelnutpilot-ai-api.onrender.com

const fromEnv = (import.meta?.env?.VITE_API_HOST || "").trim().replace(/\/+$/, "");
export const API_BASE = fromEnv || "http://localhost:4000";

// One-time warning if we fell back to localhost in production-like hosts.
(() => {
  try {
    const host = typeof window !== "undefined" ? window.location.host : "";
    const onVercel = /\.vercel\.app$/i.test(host);
    const usingLocalhost = /^http:\/\/localhost:4000$/i.test(API_BASE);
    if (onVercel && usingLocalhost) {
      // eslint-disable-next-line no-console
      console.warn(
        "[api] API_BASE is localhost. Set Vercel env var VITE_API_HOST to your Render URL."
      );
    }
  } catch {}
})();

function makeUrl(path) {
  const p = String(path || "");
  return API_BASE + (p.startsWith("/") ? p : `/${p}`);
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function apiGet(path) {
  const res = await fetch(makeUrl(path));
  const json = await parseJsonSafe(res);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || res.statusText || "GET failed");
  }
  return json;
}

export async function apiPost(path, body = {}) {
  const res = await fetch(makeUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await parseJsonSafe(res);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || res.statusText || "POST failed");
  }
  return json;
}

export async function apiUpload(path, { file, extra = {} } = {}) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  for (const [k, v] of Object.entries(extra)) {
    fd.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(makeUrl(path), { method: "POST", body: fd });
  const json = await parseJsonSafe(res);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || res.statusText || "UPLOAD failed");
  }
  return json;
}

// Default export shim so both styles work:
//   import api from "../api"
//   import { API_BASE, apiGet, apiPost, apiUpload } from "../api"
const api = { API_BASE, apiGet, apiPost, apiUpload };
export default api;
