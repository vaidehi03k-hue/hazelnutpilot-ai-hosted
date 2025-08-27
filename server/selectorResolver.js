import { normalizeStepKey, getSavedTokens, createLocatorFromToken } from './selectorRegistry.js'
async function firstVisible(loc){ try{ const l = loc.first(); if (await l.isVisible()) return l } catch{} return null }
function extractQuotedValue(step, fallback=''){ const m=(step||'').match(/"(.*?)"|'(.*?)'/); return m ? (m[1]||m[2]) : fallback }
function intentFromStep(step){ const s=(step||'').toLowerCase(); if (s.startsWith('go to')||s.startsWith('open ')) return 'goto'; if(s.startsWith('enter')||s.startsWith('fill'))return'fill'; if(s.includes('click'))return'click'; if(s.startsWith('assert')||s.includes('visible')||s.includes('expect'))return'assert'; return'auto' }
function cleanWords(step){ return (step||'').replace(/["']/g,'').trim() }
export async function resolveAction(page, stepObj, { db } = {}){
  const step = (stepObj.step||'').trim(); const intent = intentFromStep(step)
  const urlMatch = step.match(/https?:\/\/\S+/); if (intent==='goto' && urlMatch){ return { action:'goto', value:urlMatch[0] } }
  const current = page.url() || 'http://local.fake/'; const u = new URL(current); const hostname = u.hostname || 'local'; const pathname = u.pathname || '/'
  const stepKey = normalizeStepKey(step)
  const saved = db ? (getSavedTokens(db, hostname, pathname, stepKey) || []) : []
  for (const token of saved){ const loc = createLocatorFromToken(page, token); const ok = await firstVisible(loc); if (ok) return { action: intent==='auto'?'click':intent, locator: ok, tokenUsed: token, value: extractQuotedValue(step, stepObj.value) } }
  const words = cleanWords(step); let loc = null, tokenUsed = null
  loc = await firstVisible(page.getByLabel(words, { exact:true })) || await firstVisible(page.getByLabel(words, { exact:false })) ||
        await firstVisible(page.getByPlaceholder(words, { exact:true })) || await firstVisible(page.getByPlaceholder(words, { exact:false })) ||
        await firstVisible(page.getByRole('button', { name: words, exact:true })) || await firstVisible(page.getByRole('button', { name: words, exact:false })) ||
        await firstVisible(page.getByText(words, { exact:true })) || await firstVisible(page.getByText(words, { exact:false }))
  if (loc) tokenUsed = `label:${words}`
  if (!loc){
    const candidates = await page.$$eval('input,button,a,select,textarea,[role]', els => els.map(el => ({ tag: el.tagName.toLowerCase(), text: (el.innerText||'').trim().slice(0,50) })))
    if (candidates.length){ loc = page.locator(candidates[0].tag).first(); tokenUsed = `css:${candidates[0].tag}` }
  }
  if (!loc) throw new Error('Could not resolve locator for step: ' + step)
  const value = extractQuotedValue(step, stepObj.value)
  if (intent==='fill') return { action:'fill', locator: loc, value, tokenUsed }
  if (intent==='click' || intent==='auto') return { action:'click', locator: loc, tokenUsed }
  if (intent==='assert') return { action:'assert', locator: loc, tokenUsed, expect:'visible' }
  return { action:'click', locator: loc, tokenUsed }
}