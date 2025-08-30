// ui/src/components/RunLinks.jsx
import React from "react";
import { API_BASE } from "../api";

export default function RunLinks({ projectId }) {
  const [runs, setRuns] = React.useState([]);
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!projectId) return;
    let off = false;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const r = await fetch(`${API_BASE}/api/projects/${projectId}/runs`);
        const j = await r.json();
        if (j?.ok === false) throw new Error(j?.error || "Failed to load runs");
        const list = Array.isArray(j?.runs) ? j.runs : [];
        // newest is first (server unshift) — but sort defensively by time desc
        list.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
        if (!off) setRuns(list);
      } catch (e) {
        if (!off) setErr(String(e?.message || e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [projectId]);

  if (loading) return <div style={{ fontSize: 12, color: "#555" }}>Loading run artifacts…</div>;
  if (err) return <div style={{ fontSize: 12, color: "#b00" }}>Error: {err}</div>;
  if (!runs.length) return <div style={{ fontSize: 12 }}>No runs yet.</div>;

  const latest = runs[0];
  const base = `${API_BASE}/runs/${latest.id}`;
  const firstFailIdx = (latest.results || []).findIndex(r => r.status !== "ok");

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Latest run:</strong> <code>{latest.id}</code>
        <div style={{ fontSize: 12, color: "#555" }}>
          {latest.summary?.passed ?? 0} passed / {latest.summary?.failed ?? 0} failed / {latest.summary?.total ?? 0} total
          {firstFailIdx >= 0 && (
            <> — first failure at step <strong>#{firstFailIdx + 1}</strong></>
          )}
        </div>
      </div>

      {/* Direct links */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <a href={`${base}/run.webm`} target="_blank" rel="noreferrer">▶️ Video (run.webm)</a>
        <a href={`${base}/run.log`} target="_blank" rel="noreferrer">📜 run.log</a>
        <a href={`${base}/01.png`} target="_blank" rel="noreferrer">🖼️ first screenshot</a>
      </div>

      {/* Simple inline video (optional; loads if present) */}
      <video
        controls
        preload="metadata"
        poster={`${base}/01.png`}
        style={{ width: "100%", maxWidth: 720, display: "block", marginBottom: 12 }}
        onError={() => console.warn("No video file; rely on links above.")}
      >
        <source src={`${base}/run.webm`} type="video/webm" />
      </video>

      {/* Screenshot links */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8 }}>
        {(latest.results || []).map((r, i) => (
          <a key={i} href={`${base}/${r.screenshot}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <img
              src={`${base}/${r.screenshot}`}
              alt={`Step ${i + 1}`}
              style={{ width: "100%", height: "auto", border: "1px solid #eee", borderRadius: 6 }}
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <div style={{ fontSize: 11, color: r.status === "ok" ? "#0a0" : "#b00" }}>
              #{i + 1} {r.step} {r.status !== "ok" ? " (failed)" : ""}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
