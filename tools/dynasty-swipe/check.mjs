// Dynasty Exchange swipe mode: the cards, the dealer, the pricing and the one write.
//
//   npm run check:dynasty-swipe      (node --test tools/dynasty-swipe/check.mjs)
//
// 1. CARDS match Savant. Every number on a card is compared with the Savant API file it came
//    from, so a card can never show a percentile the Basketball Savant page would not.
// 2. The DEALER only deals the mode you asked for, never repeats, honours "go again".
// 3. A BATCH is accepted only as one unbroken chain through dealt cards.
// 4. PRICING: a batch moves the market exactly as the same swipes would one at a time; a
//    champion's run is damped; the daily budget holds.
// 5. END TO END through api/dynasty.js on an in-memory store running the real Lua: prices
//    move by what was priced, a deck cannot be spent twice, history reads back, a preview
//    deployment writes nothing to the market, and what a batch costs in store commands.
// 6. A SIMULATION of what one person can do to one player's price, printed for the record.
//
// No network, no keys. Reads the real public/ data, so it takes a few seconds.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { writeSavantApi } from '../../scripts/lib/savant-api.mjs'
import { writeDraftApi } from '../../scripts/lib/savant-api-draft.mjs'
import { writeDynastyCards, NBA_SUMMARY, DRAFT_SUMMARY } from '../../scripts/lib/dynasty-cards.mjs'
import { fakeRedis } from './fake-redis.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = path.join(ROOT, 'public')
const DIST = mkdtempSync(path.join(os.tmpdir(), 'dyn-swipe-'))
process.on('exit', () => rmSync(DIST, { recursive: true, force: true }))

writeSavantApi({ publicDir: PUBLIC, dist: DIST })
writeDraftApi({ publicDir: PUBLIC, dist: DIST })
const built = writeDynastyCards({ publicDir: PUBLIC, dist: DIST })
const CARDS = JSON.parse(readFileSync(path.join(DIST, 'dynasty/cards.json'), 'utf8'))
const SWPOOL = JSON.parse(readFileSync(path.join(DIST, 'dynasty/swipe-pool.json'), 'utf8'))
const POOL = JSON.parse(readFileSync(path.join(PUBLIC, 'dynasty/players.json'), 'utf8')).players
const gz = (f) => JSON.parse(gunzipSync(readFileSync(f)).toString('utf8'))

// ---------------------------------------------------------------- 1. cards

test('every player on the board has a card, and nearly all have real data', () => {
  assert.equal(Object.keys(CARDS.players).length, POOL.length)
  for (const p of POOL) assert.ok(CARDS.players[p.id], `no card for ${p.name}`)
  const bare = Object.values(CARDS.players).filter((c) => !c.s && !c.q && !c.d)
  assert.ok(bare.length <= 3, `${bare.length} cards with no data: ${bare.map((c) => c.n).join(', ')}`)
  console.log('  ' + built.summary)
})

test('card percentiles are the Savant API numbers, stat for stat', () => {
  const meta = JSON.parse(readFileSync(path.join(DIST, 'savant-api/basketball/v1/meta.json'), 'utf8'))
  const files = {}
  for (const s of meta.seasons.slice(0, 3)) files[s] = gz(path.join(DIST, `savant-api/basketball/v1/seasons/${s}.json.gz`))
  const row = (s, id) => files[s].players.find((r) => r.id === id)
  let checked = 0
  for (const [id, c] of Object.entries(CARDS.players)) {
    for (const [season, q] of Object.entries(c.q || {})) {
      const r = row(season, Number(id))
      for (const [, key] of NBA_SUMMARY) assert.deepEqual(q.m[key], r.m[key], `${c.n} ${season} ${key}`)
      assert.deepEqual(q.low || [], (r.low || []).filter((k) => q.m[k]), `${c.n} ${season} low sample`)
      checked++
    }
    for (const line of c.s || []) {
      const r = row(line[0], Number(id))
      assert.equal(line[1], r.gp, `${c.n} ${line[0]} gp`)
      assert.equal(line[3], Math.round(r.line.ppg * 10) / 10, `${c.n} ${line[0]} ppg`)
      assert.equal(line[6], Math.round(r.line.tpg * 10) / 10, `${c.n} ${line[0]} tpg`)
    }
  }
  assert.ok(checked > 600, `only ${checked} season summaries checked`)
})

test('rookie cards carry Draft Savant class percentiles, unchanged', () => {
  const dmeta = JSON.parse(readFileSync(path.join(DIST, 'savant-api/draft/v1/meta.json'), 'utf8'))
  const year = CARDS.draft.year
  assert.ok(dmeta.classes.some((c) => c.year === year))
  const cls = gz(path.join(DIST, `savant-api/draft/v1/classes/${year}.json.gz`))
  const rookies = Object.values(CARDS.players).filter((c) => c.r)
  const withDraft = rookies.filter((c) => c.d)
  assert.equal(withDraft.length, rookies.length, 'a rookie without his Draft Savant card')
  for (const c of withDraft) {
    const pr = cls.players.find((p) => p.pick === c.pk)
    for (const [, key] of DRAFT_SUMMARY) {
      if (!c.d.m[key]) continue
      assert.deepEqual(c.d.m[key], [pr.m[key][0], pr.m[key][1], pr.m[key][2]], `${c.n} ${key}`)
    }
  }
})

test('the season in progress is flagged and the card knows when to trust it', () => {
  assert.equal(typeof CARDS.currentMinGp, 'number')
  if (CARDS.inProgress) assert.notEqual(CARDS.latest, CARDS.prevFull)
})

// ---------------------------------------------------------------- 2-4. pure pieces

const S = await import('../../api/_dynasty-swipe.js')
const D = await import('../../api/dynasty.js')

const board = POOL.slice().sort((a, b) => b.rating - a.rating).map((p) => String(p.id))
const entry = (id) => SWPOOL.players[id]
const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

test('the dealer deals only the mode asked for, without repeats', () => {
  for (const mode of Object.keys(S.MODES)) {
    for (let k = 0; k < 20; k++) {
      const d = S.dealDeck(board, entry, { mode, rnd: seeded(k + 1) })
      assert.ok(d, mode)
      const all = [d.start, ...d.deck]
      assert.equal(new Set(all).size, all.length, `${mode}: repeat`)
      for (const id of all) assert.ok(S.MODES[mode].test(entry(id)), `${mode}: dealt ${id}`)
      assert.ok(d.deck.length >= Math.min(S.DECK, 20), `${mode}: thin deck ${d.deck.length}`)
    }
  }
})

test('a carried champion stays, excluded ones never come back', () => {
  const champ = board[40]
  const ex = board.slice(0, 10)
  const d = S.dealDeck(board, entry, { champ, exclude: ex, rnd: seeded(7) })
  assert.equal(d.start, champ)
  for (const id of ex) assert.ok(!d.deck.includes(id))
  const near = d.deck.filter((id) => Math.abs(board.indexOf(id) - 40) <= S.NEAR_ABOVE).length
  assert.ok(near >= Math.round(S.DECK * S.NEAR_SHARE) - 2, `only ${near} near the champion`)
})

test('a batch must be one unbroken chain through dealt cards', () => {
  const d = S.dealDeck(board, entry, { rnd: seeded(3) })
  const [a, b, c] = d.deck
  const good = S.checkSteps(d.start, d.deck, [[d.start, a, 1, 900], [a, b, 0, 400], [a, c, 1, 2000]])
  assert.equal(good.champ, c)
  assert.equal(S.checkSteps(d.start, d.deck, [[a, b, 1, 1]]).error, 'broken chain')
  assert.equal(S.checkSteps(d.start, d.deck, [[d.start, board[0] === d.start ? board[1] : board.find((x) => !d.deck.includes(x) && x !== d.start), 1, 1]]).error, 'not dealt')
  assert.equal(S.checkSteps(d.start, d.deck, [[d.start, a, 0, 1], [d.start, a, 0, 1]]).error, 'not dealt')
  assert.equal(S.checkSteps(d.start, d.deck, [[d.start, a, 2, 1]]).error, 'bad pick')
  assert.equal(S.checkSteps(d.start, d.deck, []).error, 'no swipes')
  assert.equal(S.checkSteps(d.start, d.deck, 'x').error, 'no swipes')
})

const ratingsOf = () => Object.fromEntries(POOL.map((p) => [String(p.id), p.rating]))

test('a batch prices exactly as its swipes would one at a time', () => {
  const d = S.dealDeck(board, entry, { rnd: seeded(11) })
  let champ = d.start
  const steps = d.deck.slice(0, 12).map((x, i) => { const s = [champ, x, i % 3 === 0 ? 1 : 0, 500]; if (s[2]) champ = x; return s })
  const r0 = ratingsOf()
  const batch = S.priceSteps(steps, r0, {}, {}, D.eloUpdates)
  // one at a time, carrying prices and the champion's run forward by hand
  const r = { ...r0 }; let run = 0, prev = null
  for (const [c, x, took] of steps) {
    run = c === prev ? run + 1 : 1; prev = c
    const w = 1 / Math.sqrt(run)
    const dd = D.eloUpdates(took ? [x, c] : [c, x], r, {}, {})
    for (const id of [c, x]) r[id] += dd[id] * w
  }
  for (const id of Object.keys(batch.delta)) assert.ok(Math.abs(batch.after[id] - r[id]) < 1e-9, id)
  const sum = Object.values(batch.delta).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum) < 1e-9, 'not zero-sum: ' + sum)
  assert.equal(batch.odds.length, steps.length)
})

test('your personal board moves only on your own calls, and adds up', () => {
  const r0 = ratingsOf()
  const steps = [[board[50], board[60], 1, 1], [board[60], board[40], 0, 1], [board[60], board[45], 1, 1]]
  const p = S.personalSteps(steps, r0)
  const touched = [board[50], board[60], board[40], board[45]]
  const sum0 = touched.reduce((a, id) => a + r0[id], 0), sum1 = touched.reduce((a, id) => a + p.ratings[id], 0)
  assert.ok(Math.abs(sum0 - sum1) < 1e-9, 'not zero-sum')
  assert.ok(p.ratings[board[45]] > r0[board[45]] && p.ratings[board[50]] < r0[board[50]])
  assert.deepEqual(p.wins, [board[60], board[60], board[45]])
})

test('a champion defending again is worth less each time, and the budget holds', () => {
  const champ = board[100]
  const steps = board.slice(110, 120).map((x) => [champ, x, 0, 300])   // stays under his player cap
  const w = S.priceSteps(steps, ratingsOf(), {}, {}, D.eloUpdates)
  const expected = steps.reduce((a, _, i) => a + 1 / Math.sqrt(i + 1), 0)
  assert.ok(Math.abs(w.spent - expected) < 1e-9, `spent ${w.spent} vs ${expected}`)
  const over = S.priceSteps(steps, ratingsOf(), {}, {}, D.eloUpdates, { spentUid: S.BUDGET_UID })
  assert.ok(Math.abs(over.spent - expected * S.OVER_BUDGET) < 1e-9, 'past budget not damped')
  assert.ok(Math.abs(over.delta[champ] - w.delta[champ] * S.OVER_BUDGET) / w.delta[champ] < 0.02)
})

test('no browser moves one player more than his daily cap', () => {
  const champ = board[100]
  const steps = board.slice(110, 140).map((x) => [champ, x, 0, 300])
  const p = S.priceSteps(steps, ratingsOf(), {}, {}, D.eloUpdates)
  assert.ok(Math.abs(p.perPlayer[champ] - S.PLAYER_CAP_UID) < 1e-9, `spent ${p.perPlayer[champ]} on him`)
  const next = S.priceSteps(steps, ratingsOf(), {}, {}, D.eloUpdates, { playerUid: { [champ]: S.PLAYER_CAP_UID } })
  assert.equal(next.delta[champ] || 0, 0, 'a capped player still moved')
  // the cap is per player: the challengers he beat are untouched by it
  assert.ok(Object.keys(next.delta).length === 0 || next.spent === 0)
})

// ---------------------------------------------------------------- 5. end to end

const R = fakeRedis()
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  if (u.startsWith('http://fake-redis.local')) return R.fetch(url, opts)
  const file = u.includes('/dynasty/swipe-pool.json') ? path.join(DIST, 'dynasty/swipe-pool.json')
    : u.includes('/dynasty/players.json') ? path.join(PUBLIC, 'dynasty/players.json') : null
  if (file) { const t = readFileSync(file, 'utf8'); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => JSON.parse(t) } }
  return realFetch(url, opts)
}
process.env.KV_REST_API_URL = 'http://fake-redis.local'
process.env.KV_REST_API_TOKEN = 'test'
// api/dynasty.js reads the store settings at import: load a fresh copy now they are set.
const { default: handler } = await import('../../api/dynasty.js?e2e')

let ipN = 0
const call = (method, query, body, ip) => new Promise((resolve) => {
  const req = { method, query, body, headers: { host: 'localhost', 'x-forwarded-for': ip || '10.0.0.' + (++ipN % 200) }, socket: {} }
  let code = 200
  const res = { setHeader() {}, status(c) { code = c; return this }, json(j) { resolve({ code, ...j }) } }
  handler(req, res)
})

// Plays a deck the way the browser does: next card is the nearest dealt player above the
// champion; `pick(champ, challenger)` says whom you take.
function play(dealt, pick, n = 15) {
  const left = [...dealt.deck]; let champ = dealt.start; const steps = []
  while (steps.length < n && left.length) {
    left.sort((a, b) => Math.abs(board.indexOf(a) - board.indexOf(champ) + 3) - Math.abs(board.indexOf(b) - board.indexOf(champ) + 3))
    const x = left.shift()
    const took = pick(champ, x) ? 1 : 0
    steps.push([champ, x, took, 700])
    if (took) champ = x
  }
  return steps
}
const better = (a, b) => board.indexOf(a) < board.indexOf(b)   // the board's own opinion

test('end to end: deal, swipe, the market moves by exactly what was priced', async () => {
  delete process.env.VERCEL_ENV
  const b0 = await call('GET', { action: 'board', limit: 600 })
  assert.equal(b0.seeded, true)
  const before = Object.fromEntries(b0.board.map((r) => [r.id, r]))

  const dealt = await call('GET', { action: 'swipe-deal', mode: 'guard' })
  assert.equal(dealt.ok, true)
  assert.equal(dealt.preview, false)
  const steps = play(dealt, (c, x) => !better(c, x))       // a contrarian, so prices move
  R.reset()
  const sub = await call('POST', { action: 'swipe-submit' }, { nonce: dealt.nonce, uid: 'tester01', run: 'runabc123', done: true, place: 1, undos: 2, steps })
  const cost = R.commands()
  assert.equal(sub.ok, true, sub.error)
  assert.equal(sub.swipes, steps.length)
  console.log(`  a batch of ${steps.length} swipes cost ${cost} store commands`)
  assert.ok(cost <= 13, `a batch cost ${cost} commands`)

  const zset = R.S.get('dyn:rating')
  for (const m of sub.moved) {
    const was = before[m.id].rating                      // the board rounds; allow for it
    assert.ok(Math.abs(zset.get(m.id) - was - m.delta) < 0.6, `${m.id}: stored move ${zset.get(m.id) - was} vs priced ${m.delta}`)
    assert.equal(Number(R.S.get('dyn:seen').get(m.id)), 1, `${m.id} seen count`)
  }
  assert.equal(Number(R.S.get('dyn:sw:n')), steps.length)
  const again = await call('POST', { action: 'swipe-submit' }, { nonce: dealt.nonce, uid: 'tester01', steps })
  assert.equal(again.code, 409, 'a deck spent twice')

  const me = await call('GET', { action: 'swipe-me', uid: 'tester01' })
  assert.equal(me.swipes, steps.length)
  assert.equal(me.runs, 1)
  assert.equal(me.log[0].f, Number(sub.champ))
  assert.equal(me.log[0].s.length, steps.length)
  assert.deepEqual(me.log[0].s[0].slice(0, 3), [Number(steps[0][0]), Number(steps[0][1]), steps[0][2]])

  assert.equal(me.log[0].u, 2, 'undos not kept')
  // the personal board: everyone swiped on, and a record that adds up
  const ids = new Set(steps.flatMap(([c, x]) => [String(c), String(x)]))
  assert.equal(me.board.length, ids.size)
  assert.equal(me.board.reduce((a, r) => a + r.w, 0), steps.length)
  assert.equal(me.board.reduce((a, r) => a + r.l, 0), steps.length)
  assert.equal(me.tops[0].id, sub.champ)

  // the shared link: every pick, in order, and nothing about who made them
  const run = await call('GET', { action: 'swipe-run', id: 'runabc123' })
  assert.equal(run.ok, true)
  assert.equal(run.champ, sub.champ)
  assert.equal(run.swipes, steps.length)
  assert.deepEqual(run.steps.map((r) => r.slice(0, 3)), steps.map(([c, x, k]) => [Number(c), Number(x), k]))
  assert.ok(!JSON.stringify(run).includes('tester01'), 'a shared run leaks the browser id')

  // somebody else naming the same run cannot write into it
  const d2 = await call('GET', { action: 'swipe-deal', mode: 'all' })
  const hijack = await call('POST', { action: 'swipe-submit' }, { nonce: d2.nonce, uid: 'intruder1', run: 'runabc123', done: true, steps: play(d2, () => true, 3) })
  assert.equal(hijack.ok, true)
  const after = await call('GET', { action: 'swipe-run', id: 'runabc123' })
  assert.equal(after.swipes, steps.length, 'another browser wrote into a run')
  assert.equal(after.champ, sub.champ)
  assert.equal((await call('GET', { action: 'swipe-run', id: 'nosuchrun9' })).code, 404)

  // rank your #1s: only players you crowned, an order your picks actually produce, no market
  const d3 = await call('GET', { action: 'swipe-deal', mode: 'guard', ex: sub.champ })
  const sub3 = await call('POST', { action: 'swipe-submit' }, { nonce: d3.nonce, uid: 'tester01', run: 'runabc456', done: true, place: 2, steps: play(d3, (c, x) => better(x, c)) })
  const [one, two] = [sub.champ, sub3.champ]
  const marketBefore = new Map(R.S.get('dyn:rating'))
  const fin = (body) => call('POST', { action: 'swipe-final' }, { uid: 'tester01', id: 'finabc123', mode: 'guard', ...body })
  assert.equal((await fin({ order: [one, two], pairs: [[one, two, 1, 900]] })).code, 400, 'an order the picks contradict was accepted')
  assert.equal((await fin({ order: [one, board[0]], pairs: [[one, board[0], 0, 1]] })).code, 403, 'ranked someone never crowned')
  const ok = await fin({ order: [two, one], pairs: [[one, two, 1, 900]] })
  assert.equal(ok.ok, true, ok.error)
  assert.deepEqual(new Map(R.S.get('dyn:rating')), marketBefore, 'a final moved the market')
  const got = await call('GET', { action: 'swipe-final-get', id: 'finabc123' })
  assert.deepEqual(got.order.map(String), [two, one])
  assert.ok(!JSON.stringify(got).includes('tester01'), 'a shared final leaks the browser id')
  const intr = await call('POST', { action: 'swipe-final' }, { uid: 'intruder1', id: 'finabc123', order: [two, one], pairs: [[one, two, 1, 1]] })
  assert.ok(intr.code === 403 || intr.code === 409, 'someone else overwrote a final')
  const me2 = await call('GET', { action: 'swipe-me', uid: 'tester01' })
  assert.equal(me2.finals, 1)
  assert.deepEqual(me2.finalRankings[0].order.map(String), [two, one])

  const tape = await call('GET', { action: 'board', limit: 5 })
  assert.ok(tape.recent.some((r) => r.swipe && String(r.order[0]) === sub.champ), 'the #1 is not on the tape')
})

test('end to end: a preview prices a batch but never trades it', async () => {
  process.env.VERCEL_ENV = 'preview'
  const snapshot = new Map(R.S.get('dyn:rating'))
  const seenBefore = new Map(R.S.get('dyn:seen') || [])
  const dealt = await call('GET', { action: 'swipe-deal', mode: 'all' })
  assert.equal(dealt.preview, true)
  const sub = await call('POST', { action: 'swipe-submit' }, { nonce: dealt.nonce, uid: 'tester02', done: true, steps: play(dealt, (c, x) => !better(c, x)) })
  assert.equal(sub.ok, true, sub.error)
  assert.ok(sub.moved.some((m) => m.delta !== 0), 'a preview should still say what would move')
  assert.deepEqual(new Map(R.S.get('dyn:rating')), snapshot, 'a preview moved the market')
  assert.deepEqual(new Map(R.S.get('dyn:seen') || []), seenBefore, 'a preview counted views')
  assert.ok(R.S.has('dynpv:u:tester02:sw'), 'preview history not kept apart')
  assert.ok(!R.S.has('dyn:u:tester02:sw'))
  delete process.env.VERCEL_ENV
})

test('end to end: bad input is turned away', async () => {
  const dealt = await call('GET', { action: 'swipe-deal' })
  const bad = (body) => call('POST', { action: 'swipe-submit' }, { nonce: dealt.nonce, uid: 'tester03', ...body })
  assert.equal((await bad({ uid: 'x' })).code, 400)
  assert.equal((await bad({ steps: [[board[0], board[1], 1, 1]] })).code, 400)
  assert.equal((await call('POST', { action: 'swipe-submit' }, { nonce: 'nosuchdeck123', uid: 'tester03', steps: [[1, 2, 1, 1]] })).code, 409)
  assert.equal((await call('GET', { action: 'swipe-me', uid: '../etc' })).code, 400)
})

// ---------------------------------------------------------------- 6. what one person can do

// The worst case for the market: someone who opens run after run and takes the same player
// every time he is dealt, for a whole day. `browsers` is how many ids he mints on one address.
function rig({ browsers, runs, settled }) {
  const target = board[150]
  const r0 = ratingsOf(), r = { ...r0 }
  const seen = settled ? Object.fromEntries(board.map((id) => [id, 40])) : {}
  const rank = () => board.slice().sort((a, b) => r[b] - r[a]).indexOf(target) + 1
  const startRank = rank()
  const ip = { spent: 0, player: {} }
  const ids = Array.from({ length: browsers }, () => ({ spent: 0, player: {} }))
  let rnd = seeded(99)
  for (let n = 0; n < runs; n++) {
    const me = ids[n % browsers]
    const steps = board.filter((id) => id !== target).sort(() => rnd() - 0.5).slice(0, 15).map((x) => [target, x, 0, 300])
    const p = S.priceSteps(steps, r, {}, seen, D.eloUpdates,
      { spentUid: me.spent, spentIp: ip.spent, playerUid: me.player, playerIp: ip.player })
    Object.assign(r, p.after); me.spent += p.spent; ip.spent += p.spent
    for (const [id, w] of Object.entries(p.perPlayer)) { me.player[id] = (me.player[id] || 0) + w; ip.player[id] = (ip.player[id] || 0) + w }
  }
  return { target, startRank, endRank: rank(), gain: r[target] - r0[target], seen }
}

test('simulation: what one person can do to one player in a day', () => {
  const lines = []
  let worst = 0
  for (const settled of [true, false]) {
    for (const browsers of [1, 25]) {
      const o = rig({ browsers, runs: 40, settled })
      worst = Math.max(worst, o.gain)
      lines.push(`  40 rigged runs, ${browsers === 1 ? 'one browser ' : browsers + ' browsers'} on one address, ${settled ? 'settled price  ' : 'brand-new price'}: #${o.startRank} -> #${o.endRank}, +${o.gain.toFixed(1)} Elo`)
    }
  }
  const settledSeen = Object.fromEntries(board.map((id) => [id, 40]))
  const oneBallot = D.eloUpdates([board[150], board[149], board[151], board[152]], ratingsOf(), {}, settledSeen)[board[150]]
  lines.push(`  for scale, one honest 4-player ballot he wins, settled price: +${oneBallot.toFixed(1)} Elo`)
  console.log(lines.join('\n'))
  // One address can never be worth more than the per-address player cap of results.
  assert.ok(worst < S.PLAYER_CAP_IP * 25 * 0.6, 'one address can buy a player too much: +' + worst.toFixed(1))
})
