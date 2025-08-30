// ui/src/components/RunArtifacts.jsx
import React from "react";
import { API_BASE } from "../api";

const fmtTarget = (t) => (typeof t === "string" ? t : t ? JSON.stringify(t) : "(none)");

export default function RunArtifacts({ projectId }) {
  const [runs, setRuns] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const r = await fetch(`${API_BASE}/api/projects/${projectId}/runs`);
        const j = await r.json();
        if (j?.ok === false) throw new Error(j?.error || "Failed to load runs");
        const list = Array.isArray(j?.runs) ? j.runs : [];
        list.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
        if (!list.length) throw new Error("No runs yet");
        if (!cancelled) setRuns(list);
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) return <div className="p-3 text-sm text-gray-600">Loading run artifacts…</div>;
  if (error) return <div className="p-3 text-sm text-red-600">Error: {error}</div>;

  const latest = runs[0];
  const results = latest.results || [];
  const summary = latest.summary || { total: results.length, passed: 0, failed: 0 };
  const firstFailIdx = results.findIndex((r) => r.status !== "ok");
  const firstFail = firstFailIdx >= 0 ? results[firstFailIdx] : null;

  // All artifact links are built from the run id:
  const base = `${API_BASE}/runs/${latest.id}`;
  const videoHref = `${base}/run.webm`;
  const logHref = `${base}/run.log`;
  const failShotHref = firstFail?.screenshot ? `${base}/${firstFail.screenshot}` : "";

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div>
        <div className="text-lg font-semibold">
          Latest run <span className="font-mono">{latest.id.slice(0, 8)}…</span>
        </div>
        <div className="text-sm text-gray-600">
          {summary.passed} passed / {summary.failed} failed / {summary.total} total
        </div>
      </div>

      {/* Always show links (new tab) */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <a href={videoHref} target="_blank" rel="noreferrer" className="underline text-blue-600">
          runVideo
        </a>
        <a href={logHref} target="_blank" rel="noreferrer" className="underline text-blue-600">
          run.log
        </a>
        {firstFail && firstFail.screenshot && (
          <a href={failShotHref} target="_blank" rel="noreferrer" className="underline text-blue-600">
            failedScreenshot
          </a>
        )}
      </div>

      {/* Failed step details (only if any failed) */}
      {firstFail ? (
        <div className="rounded border border-red-200 bg-red-50 p-4">
          <div className="text-red-800 font-semibold">Failed step #{firstFailIdx + 1}</div>
          <div className="mt-1 text-sm text-red-900/90">
            <div><b>Action:</b> <code>{firstFail.step}</code></div>
            <div className="mt-1"><b>Target:</b> <code className="break-all">{fmtTarget(firstFail.target)}</code></div>
            {firstFail.error && <div className="mt-1"><b>Error:</b> {firstFail.error}</div>}
            {firstFail.screenshot && (
              <div className="mt-2">
                <a
                  href={failShotHref}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-blue-600"
                >
                  Open failedScreenshot
                </a>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-sm text-green-700">All steps passed ✅ — video and log links above.</div>
      )}
    </div>
  );
}
