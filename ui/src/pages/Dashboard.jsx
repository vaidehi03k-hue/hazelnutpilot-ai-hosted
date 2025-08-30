// ui/src/pages/Dashboard.jsx
import React from "react";
import { API_BASE, apiGet, apiPost } from "../api";

export default function Dashboard() {
  const [projects, setProjects] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");

  const [name, setName] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    let off = false;
    (async () => {
      try {
        setErr("");
        setLoading(true);
        const j = await apiGet("/api/projects");
        if (!off) setProjects(j.projects || []);
      } catch (e) {
        if (!off) setErr(String(e?.message || e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, []);

  async function createProject(e) {
    e?.preventDefault?.();
    if (!name.trim()) {
      setErr("Please enter a project name.");
      return;
    }
    try {
      setCreating(true);
      setErr("");
      // server requires { name }, baseUrl is optional
      const j = await apiPost("/api/projects", { name: name.trim(), baseUrl: baseUrl.trim() });
      const p = j.project;
      if (!p?.id) throw new Error("API did not return a project id");
      // optional: refresh list
      setProjects(prev => [p, ...prev]);
      // redirect to the project page (your Project.jsx reads /project/<id> or ?id=)
      window.location.href = `/project?id=${p.id}`;
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <code className="text-xs text-gray-500">API: {API_BASE}</code>
      </header>

      {/* Error banner */}
      {err && (
        <div className="rounded border border-red-200 bg-red-50 text-red-800 p-3 text-sm">
          {err}
        </div>
      )}

      {/* Create new project */}
      <form onSubmit={createProject} className="rounded border p-4 bg-white space-y-3">
        <div className="text-lg font-semibold">New Project</div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Name *</label>
            <input
              className="w-full border rounded px-3 py-2"
              placeholder="e.g. Internet Demo"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Base URL (optional)</label>
            <input
              className="w-full border rounded px-3 py-2"
              placeholder="https://the-internet.herokuapp.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          {creating ? "Creating…" : "Create Project"}
        </button>
      </form>

      {/* Project list */}
      <section className="space-y-2">
        <div className="text-lg font-semibold">All Projects</div>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="text-sm text-gray-500">No projects yet.</div>
        ) : (
          <div className="border rounded overflow-hidden">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b bg-gray-50">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Base URL</th>
                  <th className="px-3 py-2">Runs</th>
                  <th className="px-3 py-2">Last Run</th>
                  <th className="px-3 py-2">Open</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2">
                      {p.baseUrl ? (
                        <a
                          className="underline text-blue-600"
                          href={p.baseUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {p.baseUrl}
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{p.runs ?? 0}</td>
                    <td className="px-3 py-2">
                      {p.lastRunAt ? new Date(p.lastRunAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        className="px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700"
                        href={`/project/${p.id}`}
                      >
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
