// ui/src/pages/Project.jsx
import React from "react";
import { API_BASE, apiGet, apiPost, apiUpload } from "../api";
import RunArtifacts from "../components/RunArtifacts";
import RunLinks from "../components/runLinks";



// read ?id=... from URL if not passed as prop
function useProjectIdFromUrl(fallback) {
  const [id, setId] = React.useState(fallback || "");
  React.useEffect(() => {
    if (fallback) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const qid = sp.get("id") || "";
      if (qid) setId(qid);
    } catch {}
  }, [fallback]);
  return id || fallback || "";
}

export default function Project(props) {
  const projectId = useProjectIdFromUrl(props?.projectId);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [project, setProject] = React.useState(null);
  const [baseUrl, setBaseUrl] = React.useState("");
  const [steps, setSteps] = React.useState([]);
  const [uploadBusy, setUploadBusy] = React.useState(false);
  const [runBusy, setRunBusy] = React.useState(false);

  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const j = await apiGet(`/api/projects/${projectId}`);
        if (!cancelled) {
          setProject(j.project);
          setBaseUrl(j.project?.baseUrl || "");
          setSteps(j.project?.lastGeneratedSteps || []);
        }
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  async function saveBaseUrl() {
    try {
      setError("");
      await apiPost(`/api/projects/${projectId}/base-url`, { baseUrl });
      const j = await apiGet(`/api/projects/${projectId}`);
      setProject(j.project);
    } catch (e) {
      setError(String(e?.message || e));
    }
  }

  async function handleUploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadBusy(true);
      setError("");
      const j = await apiUpload(`/api/projects/${projectId}/upload-prd`, {
        file,
        extra: { baseUrl },
      });
      setSteps(j.steps || []);
      const pj = await apiGet(`/api/projects/${projectId}`);
      setProject(pj.project);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setUploadBusy(false);
      e.target.value = "";
    }
  }

  async function handleRun() {
    try {
      setRunBusy(true);
      setError("");
      const payload = steps?.length ? { steps, baseUrl } : { baseUrl };
      await apiPost(`/api/projects/${projectId}/run-web`, payload);
      const pj = await apiGet(`/api/projects/${projectId}`);
      setProject(pj.project);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setRunBusy(false);
    }
  }

  if (!projectId) return <div className="p-6 text-red-600">Missing project id (?id=…)</div>;
  if (loading) return <div className="p-6 text-sm text-gray-500">Loading project…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">Error: {error}</div>;
  if (!project) return <div className="p-6">Project not found.</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xl font-semibold">{project.name}</div>
          <div className="text-xs text-gray-500 break-all">ID: {project.id}</div>
        </div>
        <a
          href={`${API_BASE}/api/summary`}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline text-blue-600"
        >
          API health/summary
        </a>
      </header>

      <section className="space-y-2">
        <label className="text-sm font-medium">Base URL</label>
        <div className="flex gap-2">
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="https://example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <button
            onClick={saveBaseUrl}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            Save
          </button>
        </div>
        <div className="text-xs text-gray-500">Used by the test runner to resolve relative paths.</div>
      </section>

      <section className="space-y-2">
        <label className="text-sm font-medium">Upload PRD (PDF / DOCX / TXT / MD)</label>
        <input type="file" accept=".pdf,.docx,.txt,.md,.markdown" onChange={handleUploadFile} disabled={uploadBusy} />
        {uploadBusy && <div className="text-xs text-gray-500">Uploading & generating tests…</div>}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Generated Steps</h2>
          <button
            onClick={handleRun}
            disabled={runBusy}
            className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700"
          >
            {runBusy ? "Running…" : "Run Tests"}
          </button>
        </div>
        <pre className="mt-3 text-xs bg-gray-50 border rounded p-3 overflow-auto max-h-80">
          {JSON.stringify(steps, null, 2)}
        </pre>
      </section>

      {/* Artifacts viewer with fail highlight + links */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Latest Run</h2>
        <RunArtifacts projectId={project.id} />
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Artifacts (latest run)</h3>
        <RunLinks projectId={project.id}/>
      </section>
    </div>
  );
}
