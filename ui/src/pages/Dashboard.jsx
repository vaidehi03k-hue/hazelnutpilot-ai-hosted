import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api'
import UICard from '../components/UICard'
export default function Dashboard(){
  const [summary, setSummary] = useState(null)
  const navigate = useNavigate()
  useEffect(()=>{ (async()=>{ const r = await api.get('/summary'); setSummary(r.data) })() },[])
  async function createProject(){
    const name = prompt('Project name?') || 'My Project'
    const r = await api.post('/projects', { name })
    alert('Viewer link: /viewer/' + r.data.viewerToken)
    navigate('/project/' + r.data.id)
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button onClick={createProject} className="rounded-xl bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500 shadow">+ New Project</button>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <UICard title="Projects" value={summary?.totals?.projects ?? '-'} />
        <UICard title="Total Runs" value={summary?.totals?.runs ?? '-'} />
        <UICard title="Pass Rate" value={(summary?.totals?.passRate ?? 0) + '%'} />
      </div>
      <div className="bg-white rounded-2xl p-4 shadow">
        <div className="flex items-center justify-between mb-3"><h2 className="font-semibold">Projects</h2></div>
        <div className="divide-y">
          {(summary?.projects ?? []).map(p => (
            <div key={p.id} className="py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-slate-500">Last run: {p.latestRun?.when ?? '—'} | Pass: {p.latestRun?.pass ?? 0} | Fail: {p.latestRun?.fail ?? 0}</div>
              </div>
              <div className="flex gap-3">
                <Link to={'/project/' + p.id} className="text-indigo-600 hover:underline">Open →</Link>
                <Link to={'/viewer/' + p.viewerToken} className="text-slate-600 hover:underline">Viewer</Link>
              </div>
            </div>
          ))}
          {(!summary?.projects || summary.projects.length === 0) && <div className="py-6 text-center text-slate-500">No projects yet. Click “New Project”.</div>}
        </div>
      </div>
    </div>
  )
}