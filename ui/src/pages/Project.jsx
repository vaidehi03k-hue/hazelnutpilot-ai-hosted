// ui/src/pages/Project.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api";

export default function Project() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [plans, setPlans] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [job, setJob] = useState(null); // latest run

  async function fetchProject() {
    const r = await api.get("/projects/" + id);
    const p = r.data?.project;
    setProject(p || null);
    setBaseUrl(p?.baseUrl || "");
  }

  async function fetchPlans() {
    const r = await api.get(`/projects/${id}/plans`);
    setPlans(r.data?.plans || []);
  }

  useEffect(() => {
    (async () => {
      try {
        await fetchProject();
        await fetchPlans();
      } catch (e) {
        console.error(e); alert("Failed to load project");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const title = useMemo(() => project?.name ? `Project: ${project.name}` : "Project", [project]);

  async function saveBaseUrl() {
    try {
      setSaving(true);
      await api.put("/projects/" + id, { baseUrl });
      await fetchProject();
    } catch (e) { console.error(e); alert("Failed to save Base URL"); }
    finally { setSaving(false); }
  }

  async function uploadPrd(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("baseUrl", baseUrl || "");
      const r = await api.post(`/projects/${id}/prd`, fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      if (!r.data?.ok) throw new Error(r.data?.error || "generation failed");
      await fetchPlans();
      alert("Test plan generated from PRD");
    } catch (err) {
      console.error(err);
      alert("Failed to generate tests from PRD");
    } finally {
      setUploading(false);
      e.target.value = ""; // reset file input
    }
  }

  async function runPlan(planId) {
    try {
      const r = await api.post(`/plans/${planId}/run`, { baseUrl });
      if (!r.data?.ok) throw new Error("Failed to start");
      const jobId = r.data.jobId;
      // simple polling
      const poll = async () => {
        const jr = await api.get(`/jobs/${jobId}`);
        setJob({ jobId, ...jr.data });
        if (jr.data.status === "running") setTimeout(poll, 1000);
      };
      await poll();
    } catch (e) {
      console.error(e);
      alert("Run failed to start");
    }
  }

  if (loading) return (
    <div className="p-6">
      <Link to="/" className="text-sm text-slate-600 hover:underline">← Back</Link>
      <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-slate-600">Loading…</p>
    </div>
  );

  if (!project) return (
    <div className="p-6">
      <Link to="/" className="text-sm text-slate-600 hover:underline">← Back</Link>
      <h1 className="mt-2 text-2xl font-semibold">Project not found</h1>
      <p className="mt-3 text-slate-600">We couldn’t load this project.</p>
    </div>
  );

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/" className="text-sm text-slate-600 hover:underline">← Back</Link>
          <h1 className="mt-2 text-2xl font-semibold">{project.name}</h1>
          <p className="text-slate-600">ID: {project.id}</p>
        </div>
      </div>

      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="text-lg font-medium">Base URL</h2>
        <input
          className="w-full rounded-lg border px-3 py-2"
          placeholder="https://example.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button
            disabled={saving}
            className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-50"
            onClick={saveBaseUrl}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {project.baseUrl ? (
            <a href={project.baseUrl} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">Open Base URL</a>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border p-4 space-y-4">
        <h2 className="text-lg font-medium">Upload PRD → Generate Tests (AI)</h2>
        <input type="file" accept=".pdf,.docx,.md,.txt" onChange={uploadPrd} disabled={uploading} />
        <p className="text-sm text-slate-600">
          {uploading ? "Generating test plan from PRD…" : "Supported: PDF, DOCX, MD, TXT"}
        </p>

        <div className="pt-3">
          <h3 className="font-medium mb-2">Generated Plans</h3>
          {plans.length === 0 ? (
            <div className="text-slate-600 text-sm">No plans yet.</div>
          ) : (
            <ul className="grid gap-3">
              {plans.map(p => (
                <li key={p.id} className="flex items-center justify-between rounded-xl border p-3">
                  <div className="space-y-1">
                    <div className="font-medium">{p.suiteName || p.fileName}</div>
                    <div className="text-xs text-slate-600">Plan ID: {p.id}</div>
                    <div className="text-xs text-slate-600">Created: {new Date(p.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-3 py-2 rounded-lg border hover:bg-slate-50" onClick={() => runPlan(p.id)}>Run</button>
                    <a className="text-sm text-slate-700 hover:underline" href={`/plans/${p.id}/plan.json`} target="_blank" rel="noreferrer">View JSON</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {job && (
        <section className="rounded-xl border p-4 space-y-3">
          <h2 className="text-lg font-medium">Latest Run</h2>
          <div className="text-sm">Status: <span className="font-medium">{job.status}</span></div>
          {job.artifacts?.video && (
            <video src={job.artifacts.video} controls className="w-full rounded-lg border" />
          )}
          <div className="grid grid-cols-2 gap-3">
            {(job.artifacts?.screenshots || []).map((s) => (
              <img key={s} alt="step" src={s} className="w-full rounded-lg border" />
            ))}
          </div>

          {job.results && (
            <details className="rounded-lg bg-slate-50 p-3">
              <summary className="cursor-pointer font-medium">Raw Results JSON</summary>
              <pre className="text-xs overflow-auto">{JSON.stringify(job.results, null, 2)}</pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
