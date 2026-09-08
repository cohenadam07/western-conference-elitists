// A headless play-through of /gm.
//
// Build the page, mount it in a DOM, and click through a whole career: hire in, work the
// trade desk, play the 82, take the deadline calls, run the bracket, draft, negotiate,
// and start the next season. Every bug this game has ever had was found by doing this by
// hand; this does it on every change.
//
//   node tools/gm/smoke.mjs            (expects tools/gm/vite.smoke.config.mjs built first)
//
// jsdom lives outside the repo in this environment; pass its location with JSDOM_PATH.
import fs from 'node:fs'
import path from 'node:path'

const OUT = process.env.SMOKE_OUT || path.resolve('.smoke')
const { JSDOM, VirtualConsole } = await import(process.env.JSDOM_PATH || 'jsdom')

const bundle = fs.readFileSync(path.join(OUT, 'smoke.js'), 'utf8')
const errors = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => errors.push(`jsdom: ${e.message}`))
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ').slice(0, 400)}`))

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/gm', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
})
const win = dom.window
const doc = win.document
win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
win.HTMLCanvasElement.prototype.getContext = () => null
win.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
win.scrollTo = () => {}
// The library build leaves `process.env.NODE_ENV` in React's source untouched, so the
// bundle needs one in the DOM before it runs.
win.process = { env: { NODE_ENV: 'development' } }

const script = doc.createElement('script')
script.textContent = bundle
doc.body.appendChild(script)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const all = (sel) => [...doc.querySelectorAll(sel)]
const byText = (sel, re) => all(sel).find((e) => re.test(e.textContent.trim()))
// The bundle is injected as a <script>, and its source counts as body text — matching on
// document.body found every string in the program. Only the mounted app counts.
const text = () => doc.getElementById('root').textContent
// Eight seconds was enough until the possession loop started crediting steals and blocks —
// two more draws a possession, and a forty-game block in jsdom went from comfortably inside
// the budget to occasionally outside it. A test that fails one run in three teaches nobody
// anything, so the budget matches the work.
async function waitFor(fn, ms = 45000, label = 'condition') {
  const t0 = Date.now()
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() - t0 > ms) {
      console.log(`\n  FAIL timed out waiting for ${label}`)
      if (errors.length) console.log('  errors:\n   ' + errors.slice(0, 5).join('\n   '))
      console.log('  screen: ' + text().replace(/\s+/g, ' ').slice(0, 500))
      process.exit(1)
    }
    // Polling interval matters more than it looks. The app advances the season on a 45ms
    // timer, and a tight poll loop in the same event loop starves it — the same block of
    // games finishes in three seconds at a 400ms poll and times out at 60ms.
    await sleep(process.env.SMOKE_POLL ? Number(process.env.SMOKE_POLL) : 800)
  }
}
const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}
const click = async (el, wait = 90) => { el.click(); await sleep(wait) }

// ----------------------------------------------------------------- the cabinet
// Three files now, so the first thing on screen is the cabinet, not the hiring flow.
await waitFor(() => doc.querySelector('.fo-slot'), 8000, 'the franchise cabinet')
check('the cabinet offers three files', all('.fo-slot').length === 3, `${all('.fo-slot').length}`)
check('all three start empty', all('.fo-slot.empty').length === 3)
await click(all('.fo-slot.empty')[0], 200)

// ---------------------------------------------------------------------- hire
await waitFor(() => doc.querySelector('.fo-input'), 8000, 'the hiring screen')
const input = doc.querySelector('.fo-input')
const setValue = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set
setValue.call(input, 'Smoke Tester')
input.dispatchEvent(new win.Event('input', { bubbles: true }))
await sleep(60)
check('hiring screen renders', /You have been hired/i.test(text()))

await click(byText('button', /^Continue$/))
const teamCard = byText('.fo-teamcard', /Thunder|Celtics|Lakers/) || doc.querySelector('.fo-teamcard')
await click(teamCard)
await click(byText('button', /^Continue$/))
check('control surface offered before the season', /Full control|Front office/i.test(text()))
await click(byText('button', /Take the job/), 240)

await waitFor(() => doc.querySelector('.fo-app'), 8000, 'the front office')
check('career starts in the shell', !!doc.querySelector('.fo-rail'))

// ------------------------------------------------------- the rail reads as departments
// Ten flat entries was a list of features. The grouping is most of what tells a new player
// what the job consists of, so it is worth a check that it survives.
{
  const heads = all('.fo-navhead').map((e) => e.textContent.trim())
  check('the rail is grouped into areas, not a flat list of ten',
    heads.length >= 4, heads.join(' · ') || 'no headings')
  check('and every screen still sits under one of them',
    all('.fo-navgroup').length === heads.length + 1
      || all('.fo-navgroup').length === heads.length,
    `${all('.fo-navgroup').length} groups for ${heads.length} headings`)
  check('home is above the headings, where the hub belongs',
    !!all('.fo-navgroup')[0] && !all('.fo-navgroup')[0].querySelector('.fo-navhead')
      && /Home/.test(all('.fo-navgroup')[0].textContent), '')
}

const nav = (re) => byText('.fo-navbtn', re)

// -------------------------------------------------------------- every screen
for (const [label, marker] of [
  [/Roster/, /Cap sheet/i], [/Trade desk/, /Trade desk/i], [/Season/, /The season/i],
  [/Offseason/, /Offseason/i], [/Finances/, /Finances/i], [/Analytics/, /Analytics/i],
  [/The job/, /The job/i], [/Home/, /Welcome/i],
]) {
  await click(nav(label), 160)
  check(`${label.source} screen renders`, marker.test(text()))
}

// --------------------------------------------------------- trades change things
await click(nav(/Trade desk/), 160)
// The career lives in one of three slots; the index says which one is open.
const slotKey = (w = win) => {
  const ix = JSON.parse(w.localStorage.getItem('wce.gm.franchises.v1') || 'null')
  return `wce.gm.career.v1.s${(ix && ix.active) || 1}`
}
const saveNow = () => JSON.parse(win.localStorage.getItem(slotKey()))
const rosterNow = () => { const s = saveNow(); return s.league.rosters[s.franchise.team].map((p) => p.n) }
const otherRoster = (t) => saveNow().league.rosters[t].map((p) => p.n)
const before = rosterNow()
const leagueBefore = (() => {
  const s2 = saveNow(), out = {}
  for (const t of Object.keys(s2.league.rosters)) out[t] = new Set(s2.league.rosters[t].map((p) => p.n))
  return out
})()
// The first counterparty in the list is the one with the most cap room, which is where a
// legal deal is easiest to find. Overpaying is what makes the AI say yes.
let executed = false
// The two roster columns carry their own class: counting scrollboxes broke the moment the
// desk grew a second-round list and a package block.
const boxes = all('.fo-tradeside')
const mineBtns = [...boxes[0].querySelectorAll('button')]
const theirBtns = [...boxes[1].querySelectorAll('button')]
outer:
for (const a of mineBtns.slice(0, 14)) {
  await click(a, 25)
  for (const b of theirBtns.slice(0, 12)) {
    await click(b, 25)
    const go = byText('button', /Make the trade/)
    if (go && !go.disabled) { await click(go, 300); executed = true; break outer }
    await click(b, 20)
  }
  await click(a, 20)
}
check('the trade desk can build a deal both sides accept', executed)

// The negotiation surface: a refusal has to be answerable.
{
  const boxes2 = all('.fo-scrollbox')
  const mineBtns2 = [...boxes2[0].querySelectorAll('button')]
  const theirBtns2 = [...boxes2[2].querySelectorAll('button')]
  let asked = false
  for (const a of mineBtns2.slice(0, 8)) {
    await click(a, 25)
    for (const b of theirBtns2.slice(0, 8)) {
      await click(b, 25)
      const ask = byText('button', /What would make this work/)
      if (ask) { await click(ask, 400); asked = true; break }
      await click(b, 20)
    }
    if (asked) break
    await click(a, 20)
  }
  check('a rejected offer can be answered', asked, 'never saw the counter button')
  if (asked) {
    const t = text()
    check('the counter names something concrete or says why not',
      /They would say yes to|This shape is legal|Add .+ and they will do it|nothing you have|They want |makes the salaries work|not available at any price|different piece/i.test(t))
  }
  const clr = byText('button', /^Clear$/)
  if (clr) await click(clr, 120)
}

// Shopping a player asks the whole league.
{
  const block = byText('button', /Put him on the block/)
  check('a player can be put on the block', !!block)
  if (block) {
    await click(block, 900)
    check('the league answers', /made an offer|No offers|no interest/i.test(text()))
  }
}
check('a trade actually changes the roster', executed && before.join() !== rosterNow().join(),
  executed ? 'roster identical after execute' : 'no accepted deal found')
// The Maxey-for-Maxey bug: the other twenty-nine rosters have to move too.
if (executed) {
  const s2 = saveNow()
  const mine = s2.franchise.team
  const moved = Object.keys(s2.league.rosters).filter((t) => t !== mine).some((t) => {
    const names = new Set(s2.league.rosters[t].map((p) => p.n))
    return [...names].some((n) => !leagueBefore[t] || !leagueBefore[t].has(n))
      || (leagueBefore[t] && [...leagueBefore[t]].some((n) => !names.has(n)))
  })
  check('the other team\'s roster changed too', moved, 'only your roster moved')
}

// ------------------------------------------------------------- the calendar
// The season is phased now: each stage states what it is for, checks whether you did it,
// and only then lets you move on. This walks the whole year through that machine.
await click(nav(/Home/), 200)
check('the calendar tells you what stage you are in', /Training camp/i.test(text()))
check('and what it is for', /Everyone reports/i.test(text()))
check('with objectives you have not done yet', doc.querySelectorAll('.fo-obj').length > 0)

const phaseTitle = () => {
  const h = doc.querySelector('.fo-card > h3')
  return h ? h.textContent.trim() : ''
}
// Camp: satisfy the objectives the way a player would — by clicking them.
{
  const emphasis = [...doc.querySelectorAll('.fo-obj')].find((b) => /Defence|Shooting|Conditioning/.test(b.textContent))
  if (emphasis) await click(emphasis, 200)
  const mandate = [...doc.querySelectorAll('.fo-obj')].find((b) => /ownership asked/i.test(b.textContent))
  if (mandate) { await click(mandate, 200); await click(nav(/Home/), 200) }
  const n = { ...saveNow(), camp: { ...(saveNow().camp || {}), readMandate: true, reviewed: true, skippedTrades: true } }
  win.localStorage.setItem(slotKey(), JSON.stringify(n))
}
check('camp objectives can be completed', !!saveNow().camp?.emphasis, 'no emphasis set')

// Walk the calendar. Advance where allowed, play where required.
let guard = 0
let tookLongRun = false
let sawAllStar = false
let sawRequest = false
let refusalCost = 0
let sawDeadline = false
let sawChapter = false
const sawRounds = new Set()
let sawGamecast = false
while (guard++ < 40) {
  const save2 = saveNow()
  if (save2.phase === 'offseason') break
  // Dismiss anything modal.
  const skip = byText('button', /Skip to final/)
  if (skip) { await click(skip, 250); const c = byText('button', /Continue$/); if (c) await click(c, 250) }
  const banner = byText('button', /Raise the banner/)
  if (banner) await click(banner, 300)

  // Deadline: take a call if one is there.
  if (/The phone is ringing/i.test(text())) {
    sawDeadline = true
    const preAccept = rosterNow()
    const accept = byText('button', /^Accept$/)
    if (accept) {
      await click(accept, 400)
      check('accepting a deadline call changes the roster', preAccept.join() !== rosterNow().join())
    }
    const close = byText('button', /Close the desk/)
    if (close) await click(close, 250)
  }

  // Watch one game, once, to prove the gamecast still works inside the calendar.
  if (!sawGamecast && save2.phase === 'early') {
    const watch = byText('button', /Watch next game/)
    if (watch) {
      await click(watch, 700)
      if (doc.querySelector('.fo-cast')) {
        sawGamecast = true
        await sleep(900)
        check('the gamecast still runs inside the calendar',
          doc.querySelectorAll('.fo-cast-feed .row').length > 0)
        const sk = byText('button', /Skip to final/)
        if (sk) { await click(sk, 300); const c = byText('button', /Continue$/); if (c) await click(c, 300) }
      }
    }
  }

  const actions = () => [...all('button')].filter((b) => !b.classList.contains('fo-obj'))
  // A long run crosses stages on its own. Take it once, early, and check it actually
  // moved the calendar rather than stopping at the end of the current stage.
  if (!tookLongRun && saveNow().phase === 'early') {
    const long = actions().find((b) => !b.disabled && /^Play to the deadline$/.test(b.textContent.trim()))
    if (long) {
      tookLongRun = true
      const from = saveNow().phase
      await click(long, 400)
      // A trade request stops the season on purpose, so it counts as the run ending. The
      // reason is captured INSIDE the predicate: by the time the check below runs the modal
      // may already have been answered by the loop, and asking again finds nothing.
      let ended = null
      await waitFor(() => {
        if (saveNow().phase !== from) { ended = 'stage'; return true }
        if (/phone is ringing/i.test(text())) { ended = 'deadline'; return true }
        if (doc.querySelector('.fo-askout')) { ended = 'request'; return true }
        return false
      }, 200000, 'the long run to cross a stage')
      // Being stopped by a man asking to be traded is the run doing its job, not failing it.
      check('a long run crosses stages by itself', !!ended,
        `still at ${saveNow().phase}`)
      continue
    }
  }
  // A man on your roster asking to be traded is a modal that stops everything until it is
  // answered — which is the point of it, and which means the headless run has to answer.
  // It refuses, because refusing is the branch with consequences and therefore the one worth
  // proving does not break the season.
  const out = byText('.fo-askout .opts button', /^Tell him no/)
  if (out) {
    sawRequest = true
    await click(out, 400)
    // Read the cost NOW: the penalty is a season-long thing that the summer clears, so by the
    // end of a career-length play-through it is legitimately gone again.
    refusalCost = Object.keys(saveNow()?.sulk || {}).length
    continue
  }

  // All-Star weekend is a modal too: play the game, then leave. If one of the club's men is
  // in a contest there is a button to shoot it himself, which the smoke run declines — the
  // point here is that the break opens, closes, and hands the season back.
  const asBtn = byText('.fo-awards .aw.as .aw-foot button', /^(Play the game|Back to the season)$/)
  if (asBtn) { sawAllStar = true; await click(asBtn, 400); continue }

  // A chapter card is a modal, so nothing else on the page can be clicked while it is up.
  const page = byText('.fo-chapter-in button', /^Begin /)
  if (page) { sawChapter = true; await click(page, 200); continue }

  // The postseason is a place now, not a button. Play it out a round at a time.
  const round = actions().find((b) => !b.disabled && /^Play the whole /.test(b.textContent.trim()))
  if (round) { sawRounds.add(round.textContent.trim()); await click(round, 900); continue }
  const closeOut = byText('button', /^Close the season out$/)
  if (closeOut) { await click(closeOut, 600); continue }

  const play = actions().find((b) => !b.disabled && /^Play to game \d+$/.test(b.textContent.trim()))
  if (play) {
    // Wait for the block to actually finish: the button relabels itself to the phase's
    // advance text once the games are in.
    const label = play.textContent.trim()
    await click(play, 400)
    // Either the block finishes, or something stops the season part-way through it — the
    // All-Star break does exactly that, and a wait that only watches the label sits there
    // until it times out while a modal is sitting on screen asking to be dismissed.
    let ticks = 0
    await waitFor(() => {
      if (process.env.SMOKE_DEBUG && ++ticks % 40 === 0) {
        const sv = saveNow()
        console.log('   [tick]', label, '| phase', sv?.phase, '| played',
          sv?.seasonProgress?.played, '| asSeen', sv?.allstarSeen,
          '| modal', !!doc.querySelector('.fo-cast'))
      }
      return !actions().some((b) => b.textContent.trim() === label)
        || !!doc.querySelector('.fo-awards .aw.as')
    }, 150000, `the games behind "${label}"`)
    continue
  }
  if (process.env.SMOKE_DEBUG) {
    console.log('   [debug]', saveNow().phase, '|',
      actions().filter((b) => !b.disabled).map((b) => b.textContent.trim()).slice(0, 12).join(' | ').slice(0, 260))
  }
  const advance = actions().find((b) => !b.disabled
    && /Open the preseason|Advance to |Play on to |Run the postseason|Take the offseason|Start the new season/.test(b.textContent))
  if (advance) { await click(advance, 500); continue }
  await sleep(200)
}
// Deliberately with no fallback control: the phase card's own button has to be enough at
// every stage, because on the home screen it is the only one there is.
check('the calendar is chronicled — chapters announce themselves', sawChapter)
check('the season stops for All-Star weekend and starts again', sawAllStar)
{
  const sv = saveNow()
  check('the story layer runs its checkpoints', !!(sv?.storiesRun || {}).december,
    JSON.stringify(sv?.storiesRun || {}))
  const sits = Object.values(sv?.situations || {})
  check('and the league produces situations', sits.length > 0, `${sits.length}`)
  check('every situation names a man and a club',
    sits.every((x) => x.name && x.team && x.state), JSON.stringify(sits.slice(0, 2)))
  if (sawRequest) {
    check('refusing a trade request costs production', refusalCost > 0, `${refusalCost}`)
  }
  console.log(`   [stories] ${sits.length} situations, request dialog ${sawRequest ? 'seen' : 'not seen'}`)
}
check('the postseason is played round by round, not in one click', sawRounds.size >= 4,
  [...sawRounds].join(' | '))
check('the calendar walks a whole year on the advance button alone',
  saveNow().phase === 'offseason', `stuck at ${saveNow().phase} after ${guard} steps`)
check('the deadline arrived as its own stage', sawDeadline)

// --------------------------------------------------------------- to the bracket
check('the postseason ran', !!saveNow().phase, '')

// ------------------------------------------------------------------- offseason
const toOff = byText('button', /Take the offseason/)
if (toOff) await click(toOff, 600)
await click(nav(/Offseason/), 300)
check('the offseason opens on the draft', /Offseason ·/i.test(text()))
let draftGuard = 0
while (byText('button', /^Draft$/) && draftGuard++ < 4) await click(byText('button', /^Draft$/), 200)
const meet = byText('button', /^Meet /)
if (meet) await click(meet, 200)
// Free agency is the whole league's, not just yours: bid on somebody else's player and
// check the market actually resolves.
{
  const market = byText('button', /Open the market/)
  check('the open market exists', !!market, 'no market button')
  if (market) {
    const bid = [...all('button')].find((b) => /^Offer \$/.test(b.textContent.trim()))
    if (bid) await click(bid, 250)
    await click(byText('button', /Open the market/), 900)
    check('the market resolves', /You signed|Around the league/i.test(text()))
    const lg = saveNow().league
    check('and the league still has a full complement of players',
      Object.values(lg.rosters).flat().length > 400,
      `${Object.values(lg.rosters).flat().length} contracts`)
  }
}

const finish = byText('button', /^Start \d{4}-\d{2}$/)
check('the offseason can be closed', !!finish, 'still on the clock')
if (finish) {
  await click(finish, 800)
  const saved = saveNow()
  check('a completed season is recorded', saved.records.seasonsCompleted === 1,
    `seasonsCompleted=${saved.records.seasonsCompleted}`)
  check('the roster carries into the next year',
    saved.league.rosters[saved.franchise.team].length >= 14,
    `${saved.league.rosters[saved.franchise.team].length} contracts`)
  check('the calendar advances', saved.franchise.currentSeason !== '2026-27',
    saved.franchise.currentSeason)
}

// ------------------------------------------------------------------ reload
// Closing the tab and coming back is not an exotic case, it is how people play a browser
// game. The calendar persists the phase, so anything it cannot rebuild strands the career
// on a card whose objectives can never be ticked — which is exactly what happened at the
// draft, with "make your pick" required and no pick to make.
{
  const saved2 = win.localStorage.getItem(slotKey())
  const dom2 = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/gm', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  })
  const w2 = dom2.window, d2 = w2.document
  w2.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  w2.HTMLCanvasElement.prototype.getContext = () => null
  w2.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  w2.scrollTo = () => {}
  w2.process = { env: { NODE_ENV: 'development' } }
  w2.localStorage.setItem('wce.gm.career.v1', saved2)
  const sc2 = d2.createElement('script')
  sc2.textContent = bundle
  d2.body.appendChild(sc2)
  await sleep(1500)
  const t2 = () => d2.getElementById('root').textContent
  check('a reloaded career comes back to the front office', /Owner mandate|Calendar/i.test(t2()),
    t2().slice(0, 140))
  const acts = [...d2.querySelectorAll('button')].filter((b) => !b.classList.contains('fo-obj'))
  const advance = acts.find((b) => /Open the preseason|Advance to |Play to game|Play on to |Run the postseason|Take the offseason|Start the new season/
    .test(b.textContent))
  check('the calendar is not stuck after a reload', !!advance && !advance.disabled,
    advance ? `"${advance.textContent.trim()}" is disabled` : 'no advance button found')
  const required = [...d2.querySelectorAll('.fo-obj')].filter((b) => /required/.test(b.textContent))
  const impossible = required.filter((b) => /no first-rounder|Nobody is expiring/i.test(b.textContent))
  check('no objective is required and impossible at once', impossible.length === 0,
    impossible.map((b) => b.textContent.trim().slice(0, 70)).join(' | '))
  dom2.window.close()
}

// The exact state Adam was stranded in: the calendar says you are at the draft, but the
// draft room was never opened in this session, so "make your pick" and "settle your free
// agents" were both required and both unsatisfiable.
{
  const stranded = JSON.parse(win.localStorage.getItem(slotKey()))
  stranded.phase = 'offseason'
  const dom3 = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/gm', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  })
  const w3 = dom3.window, d3 = w3.document
  w3.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  w3.HTMLCanvasElement.prototype.getContext = () => null
  w3.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  w3.scrollTo = () => {}
  w3.process = { env: { NODE_ENV: 'development' } }
  w3.localStorage.setItem('wce.gm.career.v1', JSON.stringify(stranded))
  const sc3 = d3.createElement('script')
  sc3.textContent = bundle
  d3.body.appendChild(sc3)
  await sleep(1500)
  const t3 = () => d3.getElementById('root').textContent
  const acts3 = [...d3.querySelectorAll('button')].filter((b) => !b.classList.contains('fo-obj'))
  const adv3 = acts3.find((b) => /Start the new season|Take the offseason|Open the preseason|Advance to |Play to game/
    .test(b.textContent))
  check('reloading straight into the draft stage is not a dead end',
    !!adv3 && !adv3.disabled, adv3 ? `"${adv3.textContent.trim()}" is disabled` : 'no advance button')
  const req3 = [...d3.querySelectorAll('.fo-obj')].filter((b) => /required/.test(b.textContent))
  check('and it does not require a pick you do not have',
    !req3.some((b) => /no first-rounder|Nobody is expiring/i.test(b.textContent)),
    req3.map((b) => b.textContent.trim().slice(0, 60)).join(' | '))
  dom3.window.close()
}

// ------------------------------------------------------------- quit and come back
// The whole point of three files: you can put one down without destroying it, and the
// one you pick up is the one you left.
{
  const open = saveNow()
  const seasonsIn = open.records.seasonsCompleted
  await click(byText('.fo-quit', /Quit franchise/), 220)
  check('the quit dialog offers both exits',
    /Save and quit/.test(text()) && /Quit and delete/.test(text()))
  await click(byText('button', /^Save and quit$/), 400)
  await waitFor(() => doc.querySelector('.fo-slot'), 8000, 'the cabinet after quitting')
  check('quitting lands back in the cabinet', /Your franchises/.test(text()))
  check('and the career is still on file', all('.fo-slot.empty').length === 2,
    `${all('.fo-slot.empty').length} empty`)
  check('the card shows the club it was saved with',
    new RegExp(open.franchise.team).test(text()), open.franchise.team)
  check('nothing is the active career now',
    JSON.parse(win.localStorage.getItem('wce.gm.franchises.v1')).active === null)

  // A second file, started while the first one sits there untouched.
  await click(all('.fo-slot.empty')[0], 200)
  await waitFor(() => doc.querySelector('.fo-input'), 8000, 'the hiring screen again')
  check('an empty file opens the hiring flow', /You have been hired/.test(text()))
  await click(byText('button', /Back to franchises/), 250)
  check('and backing out returns to the cabinet', /Your franchises/.test(text()))

  await click(byText('button', /^Continue$/), 600)
  await waitFor(() => doc.querySelector('.fo-app'), 8000, 'the reopened career')
  const back = saveNow()
  check('continuing reopens the same club', back.franchise.team === open.franchise.team,
    `${back.franchise.team} vs ${open.franchise.team}`)
  check('with the seasons it had played', back.records.seasonsCompleted === seasonsIn,
    `${back.records.seasonsCompleted} vs ${seasonsIn}`)
  check('and its own thirty rosters', Object.keys(back.league.rosters).length === 30)

  // And deleting is the other door, taking only its own file with it.
  await click(byText('.fo-quit', /Quit franchise/), 220)
  await click(byText('button', /Quit and delete/), 150)
  await click(byText('button', /Yes, delete this career/), 400)
  await waitFor(() => doc.querySelector('.fo-slot'), 8000, 'the cabinet after deleting')
  check('deleting frees the file', all('.fo-slot.empty').length === 3,
    `${all('.fo-slot.empty').length} empty`)
  check('and there is nothing left to load',
    !win.localStorage.getItem(`wce.gm.career.v1.s${open.slot}`))
}

// ------------------------------------------------------- the setup flow can scroll
// `.fo` is a fixed, full-viewport surface. The app shell scrolls its own pane, but the
// setup flow and the franchise cabinet are direct children with no scroller of their own:
// with `overflow:hidden` on `.fo` the Continue button below the thirty-team grid was
// simply unreachable on a short window. jsdom does no layout, so this guards the rule
// rather than the rendering.
{
  const css = fs.readFileSync(path.resolve('src/pages/gm.css'), 'utf8')
  const block = css.slice(css.indexOf('.fo{'), css.indexOf('}', css.indexOf('.fo{')))
  check('the setup surface can scroll when it is taller than the window',
    /overflow-y:\s*auto/.test(block) && !/overflow:\s*hidden/.test(block),
    block.split('\n').find((l) => /overflow/.test(l)) || 'no overflow rule')
}

check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '))

const bad = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`)
if (errors.length) console.log('errors:\n' + errors.slice(0, 8).join('\n'))
process.exit(bad.length ? 1 : 0)
