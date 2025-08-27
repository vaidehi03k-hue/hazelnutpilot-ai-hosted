import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../api'
export default function Viewer(){
  const { token } = useParams()
  const [data, setData] = useState(null)
  useEffect(()=>{ (async()=>{ try{ const r=await api.get('/view/' + token); setData(r.data) } catch{ setData({ error:'Invalid token' }) } })() },[token])
  if (!data) return <div>Loading…</div>
  if (data.error) return <div className="text-red-600">{data.error}</div>
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{data.name} (Viewer)</h1>
      <div className="bg-white rounded-2xl p-4 shadow">
        <h2 className="font-semibold mb-2">Run History</h2>
        <div className="divide-y text-sm">
          {(data.runs ?? []).map((r, idx) => (
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
          {(!data?.runs || data.runs.length === 0) && <div className="py-6 text-center text-slate-500">No runs yet.</div>}
        </div>
      </div>
    </div>
  )
}