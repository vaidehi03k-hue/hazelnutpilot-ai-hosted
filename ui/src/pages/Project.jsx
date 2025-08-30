// ui/src/components/RunArtifacts.jsx
import React from "react";
import { API_BASE } from "../api";

const fmtTarget = (t) => (typeof t === "string" ? t : t ? JSON.stringify(t) : "(none)");

export default function RunArtifacts({ projectId, runId: runIdProp }) {
  const apiHost = API_BASE;
  const [runs, setRuns] = React.useState([]);
  const [runId, setRunId] = React.useState(runIdProp || "");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [showOnlyFailed, setShowOnlyFailed] = React.useState(false);

  const latestRun = React.useMemo(() => {
    if (!runs?.length) return null;
    if (!runId) return runs[0];
    return runs.find((r) => r.id === runId) || runs[0];
  }, [runs, runId]);

  const base = latestRun ? `${apiHost}/runs/${latestRun.id}` : null;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const res = await fetch(`${apiHost}/api/projects/${projectId}/runs`);
        const json = await res.json();
        if (json?.ok === false) throw new Error(json?.error || "Failed to load runs");
        const list = Array.isArray(json?.runs) ? json.runs : [];
        if (!list.length) throw new Error("No runs yet");
        list.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
        if (!cancelled) {
          setRuns(list);
          if (runIdProp) setRunId(runIdProp);
        }
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiHost, projectId, runIdProp]);

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading artifacts…</div>;
  if (error) return <div className="p-4 text-sm text-red-600">Error: {error}</div>;
  if (!latestRun) return <div className="p-4 text-sm">No run found.</div>;

  const results = latestRun.results || [];
  const summary = latestRun.summary || { total: results.length, passed: 0, failed: 0 };
  const firstFailIdx = results.findIndex((r) => r.status !== "ok");
  const firstFail = firstFailIdx >= 0 ? results[firstFailIdx] : null;
  const visibleRows = showOnlyFailed ? results.filter((r) => r.status !== "ok") : results;

  function jumpToFirstFailure() {
    if (firstFailIdx < 0) return;
    const el = document.querySelector(`[data-row="${firstFailIdx}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="space-y-6">
      {/* Summary + actions */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold">
            Run <span className="font-mono">{latestRun.id.slice(0, 8)}…</span>
          </div>
          <div className="text-sm text-gray-500">
            <span className="mr-3">{summary.passed} passed</span>
            <span className="mr-3">{summary.failed} failed</span>
            <span>total {summary.total}</span>
          </div>
          {firstFailIdx >= 0 && (
            <div className="text-sm text-red-700 mt-1">
              First failing step: <strong>#{firstFailIdx + 1}</strong>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={showOnlyFailed}
              onChange={(e) => setShowOnlyFailed(e.target.checked)}
            />
            Show only failures
          </label>

          <button
            onClick={jumpToFirstFailure}
            disabled={firstFailIdx < 0}
            className={`px-3 py-1.5 rounded text-sm ${
              firstFailIdx < 0
                ? "bg-gray-200 text-gray-400"
                : "bg-red-600 text-white hover:bg-red-700"
            }`}
            title="Scroll to the first failing row"
          >
            Jump to first failure
          </button>

          {/* 🔗 Only links that open in a new tab */}
          {base && (
            <>
              <a href={`${base}/run.webm`} target="_blank" rel="noreferrer" className="text-sm underline text-blue-600">
                runVideo
              </a>
              <a href={`${base}/run.log`} target="_blank" rel="noreferrer" className="text-sm underline text-blue-600">
                run.log
              </a>
              {firstFail?.screenshot && (
                <a
                  href={`${base}/${firstFail.screenshot}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline text-blue-600"
                >
                  failedScreenshot
                </a>
              )}
            </>
          )}
        </div>
      </div>

      {/* 🔴 Failed step details card (link to failed screenshot only) */}
      {firstFail ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-red-800 font-semibold">Failed step #{firstFailIdx + 1}</div>
          <div className="mt-1 text-sm text-red-900/90">
            <div><b>Action:</b> <code>{firstFail.step}</code></div>
            <div className="mt-1"><b>Target:</b> <code className="break-all">{fmtTarget(firstFail.target)}</code></div>
            {firstFail.error && <div className="mt-1"><b>Error:</b> {firstFail.error}</div>}
            {firstFail.screenshot && (
              <div className="mt-2">
                <a
                  href={`${base}/${firstFail.screenshot}`}
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
        <div className="text-sm text-green-700">All steps passed ✅ — see runVideo &amp; run.log links above.</div>
      )}

      {/* Steps table with fail highlight; only failed step shows a Shot link */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">#</th>
              <th className="py-2 pr-4">Step</th>
              <th className="py-2 pr-4">Target</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Shot</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, idx) => {
              const absoluteIndex = showOnlyFailed ? results.findIndex((x) => x === r) : idx;
              const isFail = r.status !== "ok";
              return (
                <tr
                  key={absoluteIndex}
                  data-row={absoluteIndex}
                  className={`border-b ${isFail ? "bg-red-50" : "hover:bg-gray-50"}`}
                  style={isFail ? { backgroundColor: "#fee2e2" } : undefined}
                >
                  <td className="py-2 pr-4 font-mono">{absoluteIndex + 1}</td>
                  <td className="py-2 pr-4 font-medium">{r.step}</td>
                  <td className="py-2 pr-4">
                    <code className="text-xs break-all">{fmtTarget(r.target)}</code>
                    {r.error && <div className="text-xs text-gray-500 mt-1">{r.error}</div>}
                  </td>
                  <td className="py-2 pr-4">
                    {isFail ? (
                      <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">fail</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-green-100 text-green-700">ok</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {/* Only show screenshot link for failed step */}
                    {isFail && r.screenshot && base && (
                      <a href={`${base}/${r.screenshot}`} target="_blank" rel="noreferrer" className="underline text-blue-600">
                        failedScreenshot
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* No gallery, no inline video — as requested */}
    </div>
  );
}
