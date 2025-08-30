// ui/src/pages/Dashboard.jsx
import React from "react";
import { API_BASE, apiGet, apiPost } from "../api";

export default function Dashboard() {
  const [projects, setProjects] = React.useState([]);
  const [totals, setTotals] = React.useState({ projects: 0, runs: 0, passRate: 0 });
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");

  // load summary + projects (matches your original dashboard)
  React.useEffect(() => {
    let off = false;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const s = await apiGet("/api/summary");   // { totals: {projects,runs,passRate}, projects:[...] }
        const p = await apiGet("/api/projects");  // { ok:true, projects:[...] }
        if (off) return;
        setTotals(s?.totals || { projects: 0, runs: 0, passRate: 0 });
        setProjects(Array.isArray(p?.projects) ? p.projects : []);
      } catch (e) {
        if (!off) setErr(String(e?.message || e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, []);

  async function createViaPrompt() {
    const name = window.prompt("Project name?")?.trim();
    if (!name) return;
    const baseUrl = window.prompt("Base URL (optional)?")?.trim() || "";

    try {
      const j = await apiPost("/api/projects", { name, baseUrl }); // server requires { name }
      const id = j?.project?.id;
      if (!id) throw new Error("API did not return a project id");
      // navigate exactly like your old UI did (pretty path)
      window.location.href = `/project/${id}`;
    } catch (e) {
      alert("Create failed: " + (e?.message || e));
    }
  }

  return (
    <div className="p-6">
      {/* top bar */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold">Dashboard</h1>
        <button
          onClick={createViaPrompt}
          className="border px-3 py-1 rounded hover:bg-gray-50"
          title="Create a new project"
        >
          + New Project
        </button>
      </div>

      {/* tiny debug line to confirm API host being used */}
      <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>API: {API_BASE}</div>

      {/* error banner */}
      {err && (
        <div className="mt-3 text-sm text-red-700 border border-red-200 bg-red-50 rounded p-3">
          {err}
        </div>
      )}

      {/* summary table – visually similar to your old one */}
      <div className="mt-6 border">
        <div className="border-b px-2 py-1">Projects</div>
        <div className="px-2 py-1">{totals.projects}</div>
      </div>
      <div className="border">
        <div className="border-b px-2 py-1">Total Runs</div>
        <div className="px-2 py-1">{totals.runs}</div>
      </div>
      <div className="border">
        <div className="border-b px-2 py-1">Pass Rate</div>
        <div className="px-2 py-1">{totals.passRate}%</div>
      </div>

      {/* project list (very close to your original table feel) */}
      <h2 className="mt-8 text-2xl font-serif font-semibold">Projects</h2>
      {loading ? (
        <div className="mt-2 text-sm text-gray-500">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="mt-2 text-sm">No projects yet. Click “New Project”.</div>
      ) : (
        <div className="mt-3 border">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b px-2 py-2">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-500">ID: {p.id}</div>
              </div>
              <div className="flex items-center gap-3">
                {p.baseUrl ? (
                  <a className="underline text-blue-600" href={p.baseUrl} target="_blank" rel="noreferrer">
                    Open base
                  </a>
                ) : (
                  <span className="text-xs text-gray-400">no base URL</span>
                )}
                <a
                  className="border px-2 py-1 rounded hover:bg-gray-50"
                  href={`/project/${p.id}`}
                >
                  Open
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
