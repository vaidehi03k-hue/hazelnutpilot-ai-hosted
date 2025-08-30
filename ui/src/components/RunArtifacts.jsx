// ui/src/components/RunArtifacts.jsx
import React from "react";
import { API_BASE } from "../api";

const fmtTarget = (t) =>
  typeof t === "string" ? t : t ? JSON.stringify(t) : "(none)";

export default function RunArtifacts({ projectId, runId: runIdProp }) {
  const apiHost = API_BASE;
  const [runs, setRuns] = React.useState([]);
  const [runId, setRunId] = React.useState(runIdProp || "");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [showOnlyFailed, setShowOnlyFailed] = React.useState(false);
  const [readyToLoadVideo, setReadyToLoadVideo] = React.useState(false);

  const latestRun = React.useMemo(() => {
    if (!runs?.length) return null;
    if (!runId) return runs[0];
    return runs.find((r) => r.id === runId) || runs[0];
  }, [runs, runId]);

  const base = latestRun ? `${apiHost}/runs/${latestRun.id}` : null;
  const poster = latestRun ? `${base}/01.png` : "";

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const res = await fetch(`${apiHost}/api/projects/${projectId}/runs`);
        const json = await res.json();
        if (json?.ok === false)
          throw new Error(json?.error || "Failed to load runs");
        const list = Array.isArray(json?.runs) ? json.runs : [];
        if (!list.length) throw new Error("No runs yet");
        if (!cancelled) {
          // newest should already be first; be defensive
          list.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
          setRuns(list);
          if (runIdProp) setRunId(runIdProp);
        }
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiHost, projectId, runIdProp]);

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading artifacts…</div>;
  if (error) return <div className="p-4 text-sm text-red-600">Error: {error}</div>;
  if (!latestRun) return <div className="p-4 text-sm">No run found.</div>;

  const results = latestRun.results || [];
  const summary = latestRun.summary || {
    total: results.length,
    passed: 0,
    failed: 0,
  };
  const firstFailIdx = results.findIndex((r) => r.status !== "ok");
  const firstFail = firstFailIdx >= 0 ? results[firstFailIdx] : null;
  const failedOnly = results.filter((r) => r.status !== "ok");
  const visibleRows = showOnlyFailed ? failedOnly : results;

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

          <a
            href={`${base}/run.log`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline text-blue-600"
          >
            Open run.log
          </a>
        </div>
      </div>

      {/* 🔴 Failed step details card */}
      {firstFail && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-red-800 font-semibold">
            Failed step #{firstFailIdx + 1}
          </div>
          <div className="mt-1 text-sm text-red-900/90">
            <div>
              <b>Action:</b> <code>{firstFail.step}</code>
            </div>
            <div className="mt-1">
              <b>Target:</b>{" "}
              <code className="break-all">{fmtTarget(firstFail.target)}</code>
            </div>
            {firstFail.error && (
              <div className="mt-1">
                <b>Error:</b> {firstFail.error}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-start gap-4">
            {firstFail.screenshot && (
              <a
                href={`${base}/${firstFail.screenshot}`}
                target="_blank"
                rel="noreferrer"
                className="block"
                title="Open full screenshot"
              >
                <img
                  src={`${base}/${firstFail.screenshot}`}
                  alt="Failed step screenshot"
                  className="w-72 h-auto rounded border"
                  loading="lazy"
                />
              </a>
            )}
            <div className="text-sm space-y-1">
              <a
                className="underline text-blue-600 block"
                href={`${base}/run.webm`}
                target="_blank"
                rel="noreferrer"
              >
                ▶︎ Open video
              </a>
              <a
                className="underline text-blue-600 block"
                href={`${base}/run.log`}
                target="_blank"
                rel="noreferrer"
              >
                📜 Open run.log
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Video (click to load to avoid heavy auto-load) */}
      <div className="rounded-xl overflow-hidden border">
        {!readyToLoadVideo ? (
          <button
            onClick={() => setReadyToLoadVideo(true)}
            className="w-full aspect-video flex items-center justify-center bg-slate-50 text-blue-700"
            title="Click to load video"
          >
            <div className="flex flex-col items-center gap-2">
              <img src={poster} alt="Video poster" className="h-32 w-auto rounded" />
              <span className="underline">Load & play video</span>
            </div>
          </button>
        ) : (
          <video
            controls
            preload="metadata"
            playsInline
            muted
            poster={poster}
            style={{ width: "100%", height: "auto", display: "block" }}
          >
            <source src={`${base}/run.webm`} type="video/webm" />
          </video>
        )}
      </div>
      <div className="text-sm">
        Video file:{" "}
        <a
          className="underline text-blue-600"
          href={`${base}/run.webm`}
          target="_blank"
          rel="noreferrer"
        >
          {`${base}/run.webm`}
        </a>
      </div>

      {/* Steps table with fail highlight */}
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
              const absoluteIndex = showOnlyFailed
                ? results.findIndex((x) => x === r)
                : idx;
              const isFail = r.status !== "ok";
              return (
                <tr
                  key={absoluteIndex}
                  data-row={absoluteIndex}
                  className={`border-b ${isFail ? "bg-red-50" : "hover:bg-gray-50"}`}
                  style={isFail ? { backgroundColor: "#fee2e2" } : undefined} // inline fallback if Tailwind missing
                >
                  <td className="py-2 pr-4 font-mono">{absoluteIndex + 1}</td>
                  <td className="py-2 pr-4 font-medium">{r.step}</td>
                  <td className="py-2 pr-4">
                    <code className="text-xs break-all">{fmtTarget(r.target)}</code>
                    {r.error && (
                      <div className="text-xs text-gray-500 mt-1">{r.error}</div>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {isFail ? (
                      <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">
                        fail
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-green-100 text-green-700">
                        ok
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {r.screenshot && (
                      <a
                        href={`${base}/${r.screenshot}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline text-blue-600"
                      >
                        {r.screenshot}
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Screenshot gallery */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {results.map((r, idx) => (
          <a key={idx} href={`${base}/${r.screenshot}`} target="_blank" rel="noreferrer">
            <img
              loading="lazy"
              src={`${base}/${r.screenshot}`}
              alt={`Step ${idx + 1}`}
              className="w-full h-auto rounded border"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          </a>
        ))}
      </div>
    </div>
  );
}
