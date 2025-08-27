import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { customAlphabet } from 'nanoid'
import { loadDB, saveDB } from './db.js'
import { runWebTests } from './runWebTests.js'
import { generateTestsFromPrd } from './ai.js'
const nanoid = customAlphabet('1234567890abcdef', 10)
const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))
const RUNS_DIR = path.join(process.cwd(), 'runs')
if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true })
app.use('/runs', express.static(RUNS_DIR))
let db = loadDB()
function getProjectById(id){ return db.projects.find(p => p.id === id) }
app.get('/api/summary', (req, res) => {
  const projects = db.projects.map(p => ({ id:p.id, name:p.name, viewerToken:p.viewerToken, latestRun: p.runs?.[p.runs.length-1] || null }))
  const totals = { projects: db.projects.length, runs: db.projects.reduce((s,p)=>s+(p.runs?.length||0),0) }
  const allRuns = db.projects.flatMap(p => p.runs || [])
  const passSum = allRuns.reduce((s,r)=>s+(r.pass||0),0); const failSum = allRuns.reduce((s,r)=>s+(r.fail||0),0)
  totals.passRate = (passSum+failSum) ? Math.round(passSum*100/(passSum+failSum)) : 0
  res.json({ totals, projects })
})
app.post('/api/projects', (req, res) => {
  const id = nanoid(); const viewerToken = nanoid()+nanoid()
  const project = { id, name: req.body.name || 'My Project', viewerToken, runs: [] }
  db.projects.push(project); saveDB(db); res.json(project)
})
app.get('/api/projects/:id', (req, res) => {
  const p = getProjectById(req.params.id); if (!p) return res.status(404).json({ error:'Project not found' }); res.json(p)
})
app.get('/api/view/:token', (req, res) => {
  const p = db.projects.find(x => x.viewerToken === req.params.token); if (!p) return res.status(404).json({ error:'Invalid token' })
  res.json({ name: p.name, runs: p.runs || [] })
})
app.post('/api/projects/:id/upload-prd', (req, res) => {
  const p = getProjectById(req.params.id); if (!p) return res.status(404).json({ error:'Project not found' })
  const prdId = nanoid(); db.prds[prdId] = { text: req.body.text || '' }; p.prdId = prdId; saveDB(db); res.json({ prdId })
})
app.post('/api/projects/:id/generate-tests', async (req, res) => {
  const p = getProjectById(req.params.id); if (!p) return res.status(404).json({ error:'Project not found' })
  const prd = db.prds[p.prdId]; const baseUrl = req.body.baseUrl || ''
  try {
    const tests = await generateTestsFromPrd({ baseUrl, prdText: prd?.text || '' })
    res.json({ tests })
  } catch(e){
    console.error(e); res.status(500).json({ error:'AI generation failed' })
  }
})
app.post('/api/projects/:id/run-web', async (req, res) => {
  const p = getProjectById(req.params.id); if (!p) return res.status(404).json({ error:'Project not found' })
  const tests = req.body.tests || []
  try {
    const result = await runWebTests(p.id, tests, { db })
    const when = new Date().toISOString().slice(0,19).replace('T',' ')
    const run = { when, pass: result.pass, fail: result.fail, screenshots: result.screenshots }
    p.runs = p.runs || []; p.runs.push(run); saveDB(db)
    res.json({ ok:true, run })
  } catch(e){
    console.error(e); res.status(500).json({ error:'Run failed' })
  }
})
const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log('HazelnutPilot AI server running on ' + PORT))