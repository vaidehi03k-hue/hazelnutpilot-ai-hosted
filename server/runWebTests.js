import { chromium, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { resolveAction } from './selectorResolver.js'
import { saveSuccessfulToken } from './selectorRegistry.js'
import { saveDB } from './db.js'
export async function runWebTests(projectId, tests, { db } = {}){
  const outDir = path.join(process.cwd(), 'runs', projectId + '-' + Date.now())
  fs.mkdirSync(outDir, { recursive: true })
  let pass = 0, fail = 0
  const browser = await chromium.launch({ headless: true,args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'], })
  const context = await browser.newContext()
  const page = await context.newPage()
  for (const t of (tests||[])){
    try{
      const act = await resolveAction(page, t, { db })
      if (act.action === 'goto')        await page.goto(act.value)
      else if (act.action === 'fill')   await act.locator.fill(act.value || '')
      else if (act.action === 'click')  await act.locator.click()
      else if (act.action === 'assert') await expect(act.locator).toBeVisible()
      if (db && act.tokenUsed){
        const { hostname, pathname } = new URL(page.url() || 'http://local.fake/')
        const stepKey = (t.step || '').toLowerCase().replace(/"[^"]*"|'[^']*'/g, '').replace(/\s+/g,' ').trim() || '__unknown__'
        saveSuccessfulToken(db, hostname, pathname, stepKey, act.tokenUsed); saveDB(db)
      }
      pass++
    }catch(e){
      fail++
      try { await page.screenshot({ path: path.join(outDir, 'fail-' + (pass+fail) + '.png'), fullPage: true }) } catch {}
      console.error('Step failed:', t.step, e?.message || e)
    }
  }
  await browser.close()
  const shots = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter(f => f.endsWith('.png')).map(f => '/runs/' + path.basename(outDir) + '/' + f) : []
  return { pass, fail, total: (tests||[]).length, screenshots: shots, outDir }
}