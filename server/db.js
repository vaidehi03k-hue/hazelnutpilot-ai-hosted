import fs from 'fs'
import path from 'path'
const DATA_PATH = path.join(process.cwd(), 'data.json')
const defaultData = { projects: [], prds: {}, selectors: {} }
export function loadDB(){
  try { const raw = fs.readFileSync(DATA_PATH, 'utf-8'); const j = JSON.parse(raw);
    if (!j.selectors) j.selectors = {}; if(!j.prds) j.prds = {}; if(!j.projects) j.projects = [];
    return j
  } catch { return structuredClone(defaultData) }
}
export function saveDB(db){
  try { fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2)) }
  catch(e){ console.error('Failed to save DB', e) }
}