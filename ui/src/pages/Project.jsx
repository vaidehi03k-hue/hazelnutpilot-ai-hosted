import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../api'
export default function Project(){
  const { id } = useParams()
  const [project, setProject] = useState(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [prdFile, setPrdFile] = useState(null)
  const [prdId, setPrdId] = useState(null)
  const [tests, setTests] = useState([])
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(()=>{ (async()=>{ const r=await api.get('/projects/' + id); setProject(r.data) })() },[id])
  async function uploadPRD(){
    if (!prdFile) return alert('Choose a PRD file first')
    const text = await prdFile.text()
    const r = await api.post('/projects/' + id + '/upload-prd', { text })
    setPrdId(r.data.prdId); alert('PRD uploaded.')
  }
  async function generateTests(){
    if (!prdId) return alert('Upload PRD first')
    if (!baseUrl) return alert('Enter Base URL')
    setMessage('Generating tests…')
    const r = await api.post('/projects/' + id + '/generate-tests', { prdId, baseUrl })
    setTests(r.data.tests || [])
    setMessage('Generated ' + (r.data.tests?.length || 0) + ' tests.')
  }
  async function runWeb(){
    if (!tests.length) return alert('Generate tests first')
    setRunning(true); setMessage('Running…')
    await api.post('/projects/' + id + '/run-web', { tests })
    const fresh = await api.get('/projects/' + id)
    setProject(fresh.data); setRunning(false); setMessage('Done.')
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{project?.name || 'Project'}</h1>
      <div className="bg-white rounded-2xl p-4 shadow space-y-3">
        <label className="block">
          <span className="text-sm text-slate-600">Base URL</span>
          <input value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://www.saucedemo.com/" className="mt-1 w-full rounded-xl border p-2" />
        </label>
        <label className="block">
          <span className="text-sm text-slate-600">Upload PRD (md/txt)</span>
          <input type="file" accept=".md,.txt" onChange={e=>setPrdFile(e.target.files[0])} className="mt-1" />
        </label>
        <div className="flex gap-3">
          <button onClick={uploadPRD} className="rounded-xl bg-slate-700 px-4 py-2 text-white hover:bg-slate-600">Upload PRD</button>
          <button onClick={generateTests} className="rounded-xl bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500">Generate Tests (AI)</button>
          <button onClick={runWeb} disabled={running} className="rounded-xl bg-emerald-600 px-4 py-2 text-white disabled:opacity-50">Run Web</button>
        </div>
        <div className="text-sm text-slate-600">{message}</div>
      </div>
      <div className="bg-white rounded-2xl p-4 shadow">
        <h2 className="font-semibold">Generated Tests</h2>
        <pre className="mt-3 text-xs overflow-auto bg-slate-50 p-3 rounded-xl border">{JSON.stringify(tests, null, 2)}</pre>
      </div>
      <div className="bg-white rounded-2xl p-4 shadow">
        <h2 className="font-semibold mb-2">Run History</h2>
        <div className="divide-y text-sm">
          {(project?.runs ?? []).map((r, idx) => (
            <div key={idx} className="py-2 flex items-center justify-between">
              <div>
                <div className="font-medium">{r.when}</div>
                <div className="text-slate-600">Pass: {r.pass} • Fail: {r.fail}</div>
              </div>
              <div className="flex gap-3">
                {r.screenshots?.length ? <a href={r.screenshots[0]} className="text-slate-600 hover:underline">Screenshot</a> : null}
              </div>
            </div>
          ))}
          {(!project?.runs || project.runs.length === 0) && <div className="py-6 text-center text-slate-500">No runs yet.</div>}
        </div>
      </div>
    </div>
  )
}