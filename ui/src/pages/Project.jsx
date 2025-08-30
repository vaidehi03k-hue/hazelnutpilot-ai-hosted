import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api'

export default function Project(){
  const { id } = useParams()
  const [project, setProject] = useState(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [file, setFile] = useState(null)
  const [genLoading, setGenLoading] = useState(false)
  const [runLoading, setRunLoading] = useState(false)
  const [runs, setRuns] = useState([])

  async function fetchProject() {
    const r = await api.get('/projects/' + id)
    const p = r.data?.project || r.data
    setProject(p || null)
    setBaseUrl(p?.baseUrl || '')
  }

  async function fetchRuns() {
    const r = await api.get('/projects/' + id + '/runs')
    setRuns(r.data?.runs || [])
  }

  useEffect(()=>{ (async()=>{ 
    await fetchProject()
    await fetchRuns()
  })() }, [id])

  async function saveBase() {
    await api.post('/projects/' + id + '/base-url', { baseUrl })
    await fetchProject()
  }

  async function uploadPrdAndGenerate() {
    try {
      setGenLoading(true)
      if (!file) return alert('Pick a PRD file first')
      const fd = new FormData()
      fd.append('file', file)
      fd.append('baseUrl', baseUrl || '')
      const r = await api.post('/projects/' + id + '/upload-prd', fd, { headers: { 'Content-Type': 'multipart/form-data' }})
      if (!r.data?.ok) { alert('Generation failed'); return }
      alert('Tests generated from PRD')
      await fetchProject()
    } finally { setGenLoading(false) }
  }

  async function runWeb() {
    try {
      setRunLoading(true)
      // If project has lastGeneratedSteps, server will use them automatically
      const r = await api.post('/projects/' + id + '/run-web', { baseUrl })
      if (!r.data?.ok) { alert('Run failed to start'); return }
      // simple refresh of run history
      setTimeout(fetchRuns, 1200)
    } finally { setRunLoading(false) }
  }

  if (!project) return (
    <div className="p-6">
      <Link to="/" className="text-sm text-slate-600 hover:underline">← Back</Link>
      <h1 className="mt-2 text-2xl font-semibold">Project not found</h1>
    </div>
  )

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/" className="text-sm text-slate-600 hover:underline">← Back</Link>
          <h1 className="mt-2 text-2xl font-semibold">{project.name}</h1>
          <div className="text-slate-600 text-sm">ID: {project.id}</div>
        </div>
        <button onClick={runWeb} disabled={runLoading} className="rounded-lg border px-3 py-2 hover:bg-slate-50 disabled:opacity-50">
          {runLoading ? 'Running…' : 'Run tests'}
        </button>
      </div>

      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="text-lg font-medium">Base URL</h2>
        <div className="flex gap-2">
          <input className="flex-1 rounded-lg border px-3 py-2" placeholder="https://example.com" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} />
          <button className="rounded-lg bg-black text-white px-3 py-2" onClick={saveBase}>Save</button>
          {project.baseUrl ? <a href={project.baseUrl} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline px-3 py-2">Open</a> : null}
        </div>
      </section>

      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="text-lg font-medium">Upload PRD → Generate Tests (AI)</h2>
        <input type="file" accept=".pdf,.docx,.md,.txt" onChange={e=>setFile(e.target.files?.[0]||null)} />
        <button onClick={uploadPrdAndGenerate} disabled={genLoading} className="rounded-lg border px-3 py-2 hover:bg-slate-50 disabled:opacity-50">
          {genLoading ? 'Generating…' : 'Generate from PRD'}
        </button>
        <details className="bg-slate-50 rounded-lg p-3">
          <summary className="cursor-pointer font-medium">Last generated steps (raw)</summary>
          <pre className="text-xs overflow-auto">{JSON.stringify(project.lastGeneratedSteps || [], null, 2)}</pre>
        </details>
      </section>

      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="text-lg font-medium">Run History</h2>
        {runs.length === 0 ? (
          <div className="text-slate-600 text-sm">No runs yet.</div>
        ) : (
          <ul className="grid gap-3">
            {runs.map((r, idx) => (
              <li key={r.id || idx} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{new Date(r.at).toLocaleString()}</div>
                  <div className={r.summary?.failed ? 'text-red-700' : 'text-green-700'}>
                    {r.summary?.passed || 0} passed / {r.summary?.failed || 0} failed / {r.summary?.total || 0} total
                  </div>
                </div>
                {r.artifacts?.video ? (
                  <video src={r.artifacts.video} controls className="w-full rounded-lg border mt-2" />
                ) : null}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {(r.artifacts?.screenshots || []).map((s, i) => (
                    <img key={s+i} src={s} alt="step" className="w-full rounded border" />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}