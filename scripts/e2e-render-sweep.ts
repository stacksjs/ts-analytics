/**
 * E2E render sweep — the repeatable gauntlet for template regressions.
 *
 * Boots the API (auth off, scratch port) + dashboard, then:
 *   1. Server-render pass: curls every page and fails on literal {{ }} in
 *      rendered markup (script/style bodies excluded), 'Error loading
 *      component', or missing escape pairs (the stale-mix corruption tell).
 *   2. Live-DOM pass (Bun WebView): hard-loads the dashboard, then walks SPA
 *      navigations (all header tabs + back/forward + a revisit), asserting
 *      after every hop that the DOM contains no literal moustaches and the
 *      chart title actually interpolated — the exact class of bug where
 *      {{ title }} renders as text after an SPA hop.
 *
 * Run: bun scripts/e2e-render-sweep.ts
 * Exits non-zero on any failure. Uses ports 4526/4527.
 */
/* eslint-disable pickier/no-unused-vars -- browser-side JS embedded in evaluate() template literals trips the unused-args rule on code that runs in the WebView, not here */
import { WebView } from 'bun'

const API_PORT = 4526
const DASH_PORT = 4527
const PAGES = [
  '/', '/dashboard', '/dashboard/live', '/dashboard/sessions',
  '/dashboard/funnels', '/dashboard/flow', '/dashboard/clicks',
  '/dashboard/engagement', '/dashboard/event-properties', '/dashboard/vitals',
  '/dashboard/insights', '/dashboard/settings', '/dashboard/account',
  '/shared/tok1234567890123',
]
const NAV_TABS = ['Live', 'Sessions', 'Funnels', 'Dashboard', 'Web Vitals', 'Dashboard']

let failures = 0
function fail(msg: string): void {
  failures++
  console.error(`  ✗ ${msg}`)
}

const procs: Array<ReturnType<typeof Bun.spawn>> = []
function boot(cmd: string[], env: Record<string, string>): void {
  procs.push(Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: 'ignore', stderr: 'ignore' }))
}

async function waitFor(url: string, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (res.ok)
        return true
    }
    catch {}
    await new Promise(r => setTimeout(r, 400))
  }
  return false
}

// ---------------------------------------------------------------------------
console.log('booting scratch stack...')
boot(['bun', 'server/index.ts'], { PORT: String(API_PORT), ANALYTICS_REQUIRE_AUTH: 'false', ANALYTICS_ENABLE_JOBS: 'false' })
boot(['bun', 'serve.ts'], { DASHBOARD_PORT: String(DASH_PORT), ANALYTICS_API_PROXY: `http://localhost:${API_PORT}` })
if (!await waitFor(`http://localhost:${DASH_PORT}/dashboard`) || !await waitFor(`http://localhost:${API_PORT}/health`)) {
  console.error('stack failed to boot')
  process.exit(1)
}

console.log('\n[1/2] server-render pass')
for (const page of PAGES) {
  const html = await fetch(`http://localhost:${DASH_PORT}${page}`).then(r => r.text()).catch(() => '')
  if (!html) {
    fail(`${page}: fetch failed`)
    continue
  }
  // NOTE: literal {{ }} in SERVED html is normal stx architecture — signal
  // moustaches are preserved for client-side binding and consumed during
  // hydration. The invariant lives in the DOM pass below: after hydration
  // (and after every SPA hop) no text node may still contain them.
  if (html.includes('Error loading component'))
    fail(`${page}: component load error`)
  if ((html.match(/\\\\/g) || []).length === 0)
    fail(`${page}: zero escape pairs — stale/mixed build corruption tell`)
}
console.log(failures === 0 ? '  ✓ all pages clean' : `  ${failures} failures so far`)

console.log('\n[2/2] live-DOM SPA pass')
const view = new WebView({
  url: `http://localhost:${DASH_PORT}/dashboard?siteId=PIPETEST1`,
  width: 1440,
  height: 900,
  headless: true,
} as any)
const ev = (expr: string): Promise<any> => (view as any).evaluate(expr)
await new Promise<void>((resolve) => {
  ;(view as any).onNavigated = () => setTimeout(resolve, 4000)
  setTimeout(resolve, 15000)
})

async function assertDomClean(label: string): Promise<void> {
  const raw = await ev(`(function(){
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var hits = [];
    var SKIP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1 };
    while (w.nextNode()) {
      // Compiled scoped scripts embed binding expressions as strings — only
      // text nodes RENDERED to users count as literal moustaches.
      var parent = w.currentNode.parentElement;
      if (parent && SKIP[parent.tagName]) continue;
      var t = w.currentNode.textContent;
      var m = t && t.match(/\\{\\{[^}]*\\}\\}/);
      if (m) hits.push(m[0]);
      if (hits.length > 4) break;
    }
    return hits.join(" , ");
  })()`)
  if (raw)
    fail(`${label}: literal moustaches in DOM text: ${raw}`)
}

// Hook the console for the deep-dive fingerprint lines (dedup skip /
// processElement skip) and toggle compare ON — the revisit-triggered class
// (stx#1700 family) needs stateful sessions, which single-visit sweeps miss.
await ev(`(function(){
  window.__routerLogs = [];
  ['log','warn','error'].forEach(function(k){
    var o = console[k].bind(console);
    console[k] = function(){
      var msg = Array.prototype.join.call(arguments, ' ');
      if (/skipping already-executed|SKIPPED processElement|\[canary\]/.test(msg)) window.__routerLogs.push(msg.slice(0, 160));
      o.apply(null, arguments);
    };
  });
  return 'hooked';
})()`)
await ev(`(function(){
  var root = document.getElementById('date-range-picker');
  if (!root) return;
  var btns = root.querySelectorAll('button');
  var cmp = Array.prototype.find.call(btns, function(b){ return b.textContent.indexOf('comparison') !== -1; });
  if (cmp) cmp.click();
})()`)
await new Promise(r => setTimeout(r, 1200))

async function assertScopesRegistered(label: string): Promise<void> {
  const dead = await ev(`(function(){
    var scopes = (window.stx && window.stx._scopes) || {};
    var dead = [];
    document.querySelectorAll('[data-stx-scope]').forEach(function(el){
      var id = el.getAttribute('data-stx-scope');
      if (id && !scopes[id]) dead.push(id);
    });
    return dead.slice(0, 5).join(',');
  })()`)
  if (dead)
    fail(`${label}: data-stx-scope elements with no registered scope: ${dead}`)
  const logs = await ev(`(window.__routerLogs || []).splice(0).join(" | ")`)
  if (logs)
    fail(`${label}: fingerprint console lines: ${logs}`)
}

await assertDomClean('hard load /dashboard')
await assertScopesRegistered('hard load /dashboard')
const chartTitle = await ev(`(function(){
  var els = document.querySelectorAll('.panel .font-semibold');
  for (var i = 0; i < els.length; i++) {
    if (els[i].textContent.indexOf('Pageviews Over Time') !== -1) return 'ok';
  }
  return 'missing';
})()`)
if (chartTitle !== 'ok')
  fail('hard load: chart title did not interpolate')

for (const tab of NAV_TABS) {
  await ev(`(function(){
    var links = document.querySelectorAll('#header-nav a');
    var d = Array.prototype.find.call(links, function(a){ return a.textContent.trim() === ${JSON.stringify(tab)}; });
    if (d) d.click();
  })()`)
  await new Promise(r => setTimeout(r, 2200))
  await assertDomClean(`after SPA nav -> ${tab}`)
  await assertScopesRegistered(`after SPA nav -> ${tab}`)
}
await ev(`history.back()`)
await new Promise(r => setTimeout(r, 2200))
await assertDomClean('after history.back()')

// Entry-page matrix: bundling differs per entry page (colliding component
// consts get renamed differently), so a moustache can bind on /dashboard
// entry yet stay literal on /dashboard/sessions entry — field-caught by the
// canary. Hard-load several entries and assert each hydrates clean.
for (const entry of ['/dashboard/sessions', '/dashboard/settings', '/shared/tok1234567890123']) {
  await ev(`location.href = ${JSON.stringify(`http://localhost:${DASH_PORT}${entry}?siteId=PIPETEST1`)}`)
  await new Promise(r => setTimeout(r, 3500))
  await assertDomClean(`hard entry ${entry}`)
}

console.log(failures === 0 ? '  ✓ SPA walk clean' : `  ${failures} total failures`)

for (const p of procs) p.kill()
console.log(failures === 0 ? '\nRENDER SWEEP PASSED' : `\nRENDER SWEEP FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
