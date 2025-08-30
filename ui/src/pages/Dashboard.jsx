import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api'
import UICard from '../components/UICard'

export default function Dashboard(){
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const navigate = useNavigate()

  async function loadAll() {
    const s = await api.get('/summary')
    const p = await api.get('/projects')
    setSummary(s.data)
    setProjects(p.data?.projects || [])
  }

  useEffect(()=>{ (async()=>{ 
    try { await loadAll() } finally { setLoading(false) }
  })() },[])

  async function createProject(){
    const name = prompt('Project name?') || 'My Project'
    const r = await api.post('/projects', { name })
    const id = r.data?.project?.id
    if (!id) { alert('Failed to create project'); return }
    navigate('/project/' + id)
  }

  if (loading) {
    return <div className="p-6">Loading…</div>
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button onClick={createProject} className="rounded-xl bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500 shadow">+ New Project</button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <UICard title="Projects" value={summary?.totals?.projects ?? '-'} />
        <UICard title="Total Runs" value={summary?.totals?.runs ?? '-'} />
        <UICard title="Pass Rate" value={summary?.totals?.passRate ?? '-'} />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Projects</h2>
        {projects.length === 0 ? (
          <div className="text-slate-600">No projects yet. Click “New Project”.</div>
        ) : (
          <ul className="grid gap-3">
            {projects.map(p => (
              <li key={p.id} className="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <Link to={'/project/' + p.id} className="font-medium hover:underline">{p.name}</Link>
                  {p.baseUrl ? <div className="text-xs text-slate-600">Base URL: <code>{p.baseUrl}</code></div> : null}
                </div>
                <div className="text-sm">
                  <Link to={'/project/' + p.id} className="text-indigo-700 hover:underline">Open →</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}