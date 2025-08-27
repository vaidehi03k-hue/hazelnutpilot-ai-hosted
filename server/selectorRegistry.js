export function normalizeStepKey(step){
  return (step||'').toLowerCase().replace(/"[^"]*"|'[^']*'/g,'').replace(/\s+/g,' ').trim()||'__unknown__'
}
export function getSavedTokens(db, domain, path, stepKey){
  const d = db?.selectors?.[domain] || {}; const p = d[path] || {}; return p[stepKey] || []
}
export function saveSuccessfulToken(db, domain, path, stepKey, token){
  if (!token) return
  db.selectors ||= {}; db.selectors[domain] ||= {}; db.selectors[domain][path] ||= {}
  const list = db.selectors[domain][path][stepKey] ||= []; const idx = list.indexOf(token)
  if (idx >= 0) list.splice(idx,1); list.unshift(token)
}
export function createLocatorFromToken(page, token){
  if (token.startsWith('role:')){ const [, role, ...rest] = token.split(':'); return page.getByRole(role, { name: rest.join(':'), exact:false }) }
  if (token.startsWith('label:')) return page.getByLabel(token.slice(6), { exact:false })
  if (token.startsWith('placeholder:')) return page.getByPlaceholder(token.slice(12), { exact:false })
  if (token.startsWith('text:')) return page.getByText(token.slice(5), { exact:false })
  if (token.startsWith('testid:')) return page.getByTestId(token.slice(7))
  if (token.startsWith('css:')) return page.locator(token.slice(4))
  return null
}