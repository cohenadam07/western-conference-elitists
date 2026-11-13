// tools/hoops-acct-test.mjs — Flappy Hoops accounts and all-time records (api/_hoops.js), tested through
// the real endpoint: it starts tools/race-dev.mjs (a throwaway redis-server, an Upstash-style REST shim
// and api/race.js) and talks to it over HTTP.
//   node tools/hoops-acct-test.mjs [port=8891]
// Needs redis-server on the PATH, and public/flappy-hoops/server/sim.mjs (the game's rules, copied with
// the game's build). The record runs are found here by nudging a Savant line's taps and replaying them
// with that same sim.mjs, so the expected flaps and times are the game's own.
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) || 8891)
const BASE = `http://127.0.0.1:${PORT}/api/race`
const ADMIN_KEY = 'test-admin-key-' + Math.random().toString(36).slice(2)

let n = 0, failed = 0
const ok = (cond, what) => { n++; if (!cond) { failed++; console.log('FAIL', what) } else console.log('PASS', what) }

const dev = spawn(process.execPath, [path.join(ROOT, 'tools/race-dev.mjs'), String(PORT)], { cwd: ROOT, env: { ...process.env, WCE_STATUS_KEY: ADMIN_KEY, RACE_TEST: '1', RACE_LEAD_MS: '300', RACE_REVEAL_MS: '200', RACE_BOARD_MS: '400' }, stdio: ['ignore', 'pipe', 'inherit'] })
process.on('exit', () => dev.kill())
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('race-dev did not start')), 15000)
  dev.stdout.on('data', (d) => { if (String(d).includes('race api on')) { clearTimeout(t); resolve() } })
})

// (an idle keep-alive connection can be closed under a request that reuses it: try once more)
const fetch = async (url, opts) => { try { return await globalThis.fetch(url, opts) } catch { await new Promise((r) => setTimeout(r, 50)); return globalThis.fetch(url, opts) } }

let ip = 1
const nextIp = () => `10.0.${Math.floor(ip / 250)}.${ip++ % 250}`
async function post(body, { from = nextIp() } = {}) {
  const r = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from }, body: JSON.stringify(body) })
  return { status: r.status, j: await r.json(), headers: r.headers }
}
async function get(q) {
  const r = await fetch(BASE + q)
  return { status: r.status, j: await r.json(), headers: r.headers }
}
const commands = async () => Number(await (await fetch(`http://127.0.0.1:${PORT}/__commands`)).text())
async function cost(fn) { const a = await commands(); const out = await fn(); return [out, (await commands()) - a] }

/* ---------------------------------------------------------------- accounts */
const c1 = await post({ a: 'acct.create', name: '  Adam   Test ', pin: '1234' })
ok(c1.status === 200 && c1.j.t && c1.j.name === 'Adam Test' && c1.j.save && c1.j.save.wallet.balls[0] === 'classic' && Object.keys(c1.j.save.bests).length === 0,
  'create: a good name and PIN → a token, the name tidied (“Adam Test”) and an empty save')
for (const nm of ['adam_test', 'ADAM.TEST', 'adamtest', 'Adam-Test']) {
  const r = await post({ a: 'acct.create', name: nm, pin: '1111' })
  ok(r.status === 409 && /taken/.test(r.j.error), `create: “${nm}” is the same name (case, spaces, dots, dashes and underscores don’t count) → 409`)
}
for (const [nm, why] of [['ab', 'too short'], ['thirteenchars', 'too long'], ['a!bcd', 'a character outside the set'], ['...', 'no letter or number'], ['fuckface', 'profanity'], ['sh1thead', 'disguised profanity'], ['f.u.c.k', 'spaced-out profanity']]) {
  const r = await post({ a: 'acct.create', name: nm, pin: '1234' })
  ok(r.status === 400 && r.j.error, `create: “${nm}” refused (${why}): ${r.j.error}`)
}
for (const pin of ['12a4', '123', '12345', 1234, '']) {
  const r = await post({ a: 'acct.create', name: 'Pinny' + String(pin).length, pin })
  ok(r.status === 400 && /four digits/.test(r.j.error), `create: PIN ${JSON.stringify(pin)} refused`)
}

const [s1, signinCost] = await cost(() => post({ a: 'acct.signin', name: 'adam test', pin: '1234' }))
ok(s1.status === 200 && s1.j.t && s1.j.t !== c1.j.t && s1.j.name === 'Adam Test', 'sign in: right PIN (name typed in another case) → a new token and the shown name')
const wrong = await post({ a: 'acct.signin', name: 'Adam Test', pin: '9999' })
const nobody = await post({ a: 'acct.signin', name: 'Nobody Here', pin: '1234' })
ok(wrong.status === 401 && nobody.status === 401 && wrong.j.error === nobody.j.error, `sign in: a wrong PIN and an unknown name get the same answer: “${wrong.j.error}”`)

await post({ a: 'acct.create', name: 'Locky', pin: '4321' })
const tries = []
for (let i = 0; i < 5; i++) tries.push((await post({ a: 'acct.signin', name: 'Locky', pin: '0000' })).status)
const locked = await post({ a: 'acct.signin', name: 'Locky', pin: '4321' })
ok(tries.every((s) => s === 401) && locked.status === 429 && /15 minutes/.test(locked.j.error), 'lockout: five wrong PINs, then even the right one is refused for 15 minutes (429)')

const ipSt = []
for (let i = 0; i < 21; i++) ipSt.push((await post({ a: 'acct.signin', name: 'Ghost' + i, pin: '1234' }, { from: '9.9.9.9' })).status)
ok(ipSt.slice(0, 20).every((s) => s === 401) && ipSt[20] === 429, 'one address: 20 sign-in tries in ten minutes, the 21st is refused (429)')

const me = await post({ a: 'acct.me', t: c1.j.t })
const meBad = await post({ a: 'acct.me', t: 'x'.repeat(32) })
ok(me.status === 200 && me.j.name === 'Adam Test' && meBad.status === 401, 'me: a good token says who you are; a made-up one is 401')
const tOut = (await post({ a: 'acct.signin', name: 'Adam Test', pin: '1234' })).j.t
const so = await post({ a: 'acct.signout', t: tOut })
const after = await post({ a: 'acct.me', t: tOut })
ok(so.status === 200 && after.status === 401 && (await post({ a: 'acct.me', t: c1.j.t })).status === 200, 'sign out: that token stops working; the account’s other sessions don’t')

/* ---------------------------------------------------------------- sync */
const A = c1.j.t, B = s1.j.t
const run = (k) => [[0, 1], [k, 1]]
const empty = { bests: {}, flags: {}, wallet: { balls: ['classic'], trails: ['streak'], ball: 'classic', trail: 'streak', spins: 0, drops: 0 } }
const save = (o) => ({ ...empty, ...o, wallet: { ...empty.wallet, ...(o.wallet || {}) } })

const [y1, syncCost] = await cost(() => post({ a: 'acct.sync', t: A, save: save({ bests: { cage: { flaps: 6, stars: 1, inputs: run(40) } }, flags: { 'done.cage': 1 }, wallet: { balls: ['classic', 'neon'] } }), delta: { tickets: 50, earned: 50 } }))
ok(y1.status === 200 && y1.j.save.wallet.tickets === 50 && y1.j.save.wallet.earned === 50 && y1.j.save.flags['done.cage'] === 1 && y1.j.name === 'Adam Test',
  'sync (device A, first): its 50 tickets and its flag go up')
ok(Object.keys(y1.j.save.bests).length === 0, 'sync: a device isn’t sent back the best it just sent')

const y2 = await post({ a: 'acct.sync', t: B, save: save({ bests: { cage: { flaps: 5, stars: 1, inputs: run(41) }, rucker: { flaps: 8, stars: 0, inputs: run(50) } }, flags: { 'found.city-hall': 1 }, wallet: { balls: ['classic', 'taxi'] } }), delta: { tickets: 30, earned: 30 } })
const W2 = y2.j.save.wallet
ok(W2.tickets === 80 && W2.earned === 80, 'tickets: two devices’ earnings add up (50 + 30 = 80)')
ok(y2.j.save.flags['done.cage'] === 1 && y2.j.save.flags['found.city-hall'] === 1, 'flags: the union of both devices')
ok(W2.balls.join() === 'classic,neon,taxi', 'balls owned: the union, the server’s order first: ' + W2.balls.join())
ok(Object.keys(y2.j.save.bests).length === 0, 'sync (device B): it already has everything it sent, so no bests come back')

// device A still thinks cage is 6 flaps (1 star); it sends cage 7 flaps with 3 stars
const y3 = await post({ a: 'acct.sync', t: A, save: save({ bests: { cage: { flaps: 7, stars: 3, inputs: run(60) } } }), have: { cage: [6, 1] }, delta: {} })
const cg = y3.j.save.bests.cage
ok(cg && cg.flaps === 5 && cg.stars === 3 && JSON.stringify(cg.inputs) === JSON.stringify(run(41)), 'bests: fewer flaps wins (B’s 5 and its taps), stars are the most either earned (3)')
ok(y3.j.save.bests.rucker && Object.keys(y3.j.save.bests).length === 2, 'sync: A is sent the two holes it’s behind on (cage, better; rucker, missing)')

const y4 = await post({ a: 'acct.sync', t: B, save: save({}), have: { cage: [5, 1], rucker: [8, 0] }, delta: {} })
ok(Object.keys(y4.j.save.bests).join() === 'cage' && y4.j.save.bests.cage.stars === 3, 'sync: a stars-only improvement comes back (cage, same 5 flaps, now 3 stars)')
const y5 = await post({ a: 'acct.sync', t: B, save: save({}), have: { cage: [5, 3], rucker: [8, 0] }, delta: {} })
ok(Object.keys(y5.j.save.bests).length === 0 && y5.j.save.wallet.tickets === 80, 'sync: a device that has everything gets no bests back (flags and wallet still in full)')
const y6 = await post({ a: 'acct.sync', t: B, save: save({}), have: { cage: [5, 3] }, delta: {} })
ok(Object.keys(y6.j.save.bests).join() === 'rucker', 'sync: a device missing one hole gets just that one')

const y7 = await post({ a: 'acct.sync', t: A, save: save({ wallet: { balls: ['classic', 'neon'], ball: 'neon' } }), have: {}, delta: { tickets: -30 }, eq: true })
ok(y7.j.save.wallet.tickets === 50 && y7.j.save.wallet.ball === 'neon', 'a spend: −30 → 50; what A put on (neon, eq true) is what the account has on')
const y8 = await post({ a: 'acct.sync', t: B, save: save({ wallet: { ball: 'taxi' } }), delta: {}, eq: false })
ok(y8.j.save.wallet.ball === 'neon', 'eq false: B’s stale ball (taxi) doesn’t replace what’s on (neon)')
const y9 = await post({ a: 'acct.sync', t: B, save: save({ wallet: { ball: 'dragon' } }), delta: {}, eq: true })
ok(y9.j.save.wallet.ball === 'neon', 'eq true but not owned (dragon): what’s on stays')
const y10 = await post({ a: 'acct.sync', t: B, save: save({}), delta: { tickets: -1000 } })
ok(y10.j.save.wallet.tickets === 0, 'tickets never go below zero (50 − 1000 → 0)')
const y11 = await post({ a: 'acct.sync', t: A, save: save({ wallet: { spins: 3, drops: 2 } }), delta: { earned: -500 } })
ok(y11.j.save.wallet.spins === 3 && y11.j.save.wallet.drops === 2 && y11.j.save.wallet.earned === 80, 'spins and drops: the most either device has; lifetime earned never goes down')

const big = await post({ a: 'acct.sync', t: A, save: save({ flags: { pad: 'x'.repeat(950 * 1024) } }) })
ok(big.status === 413, 'a body over 900 KB → 413')
ok((await post({ a: 'acct.sync', t: 'y'.repeat(32), save: save({}) })).status === 401, 'sync with a bad token → 401')

const sB = await post({ a: 'acct.signin', name: 'Adam Test', pin: '1234' })
ok(sB.j.save.bests.cage && sB.j.save.bests.rucker && sB.j.save.wallet.balls.includes('taxi'), 'sign in returns the full save (every best)')

/* ---------------------------------------------------------------- records: find the runs */
const SIM = await import(pathToFileURL(path.join(ROOT, 'public/flappy-hoops/server/sim.mjs')).href)
// (the game's Savant lines: FH_LINES, or the game's repo where it usually is)
const LINES_AT = [process.env.FH_LINES, '/home/claude/fh/game/src/levels/lines.json', path.join(process.env.HOME || '', 'flappy-hoops-build/flappy-hoops-v2/src/levels/lines.json')].filter((f) => f && fs.existsSync(f))
const LINES = JSON.parse(fs.readFileSync(LINES_AT[0], 'utf8'))
const H = 'cage', L0 = LINES[H]
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const replay = (id, inp, race) => { const w = SIM.compileLevel(SIM.HOLES[id]); if (race) w.portals = []; const { state } = SIM.simulate(w, inp, 36000, { stopOnScore: true }); return state.scored >= 0 ? { f: state.flaps, k: state.scored } : null }
const pool = []
for (let t = 0; t < 3000; t++) {
  let inp = L0.inputs.map(([s, d]) => [Math.max(0, s + Math.round((rnd() - 0.5) * 12)), d])
  if (rnd() < 0.4) { const i = Math.floor(rnd() * inp.length); inp.splice(i, 0, [Math.max(0, inp[i][0] - 2 - Math.floor(rnd() * 30)), inp[i][1]]) }
  inp.sort((a, b) => a[0] - b[0])
  const r = replay(H, inp); if (r) pool.push({ ...r, inp })
}
const f0 = L0.flaps, k0 = L0.step
const four = pool.filter((p) => p.f === f0), five = pool.filter((p) => p.f === f0 + 1)
const kc = Math.min(...five.map((p) => p.k).filter((k) => four.some((q) => q.k === k)))
const Z = five.find((p) => p.k === kc), W = four.find((p) => p.k === kc)
const Y = five.find((p) => p.k > kc && p.k < k0)
const V = four.find((p) => p.k > kc && p.k < k0)
const X = { f: f0, k: k0, inp: L0.inputs }
ok(Z && W && Y && V, `runs found by nudging the Savant line (${f0} flaps, ${k0} steps): Y ${Y?.f}:${Y?.k}, X ${f0}:${k0} (the Savant line), Z ${Z?.f}:${Z?.k}, V ${V?.f}:${V?.k}, W ${W?.f}:${W?.k}`)

const T = sB.j.t
const sub = (inp, extra = {}) => post({ a: 'rec.submit', t: T, h: H, in: inp, b: SIM.BUILD, ...extra })

/* ---------------------------------------------------------------- records */
const [r1, submitCost] = await cost(() => sub(Y.inp))
ok(r1.status === 200 && r1.j.f === Y.f && r1.j.k === Y.k && r1.j.boards.f.set && r1.j.boards.s.set && r1.j.boards.f.prev === null && r1.j.boards.f.cur.n === 'Adam Test',
  `the first run on an empty hole takes both boards (${Y.f} flaps, ${Y.k} steps, worked out by the server)`)
const r2 = await sub(Y.inp)
ok(r2.j.boards.f.tied && r2.j.boards.s.tied && !r2.j.boards.f.set && !r2.j.boards.s.set && r2.j.boards.f.cur.k === Y.k, 'the same run again: level on both, so the holder keeps both (you have to beat it)')
const r3 = await sub(X.inp)
ok(r3.j.boards.f.set && !r3.j.boards.s.set && r3.j.boards.f.prev.f === Y.f && r3.j.boards.s.cur.k === Y.k, `fewer flaps but slower (${X.f}:${X.k}): takes Fewest Flaps only`)
const r4 = await sub(Z.inp)
ok(r4.j.boards.s.set && !r4.j.boards.f.set && r4.j.boards.s.prev.k === Y.k, `faster but more flaps (${Z.f}:${Z.k}): takes Fastest only`)
const r5 = await sub(V.inp)
ok(r5.j.boards.f.set && !r5.j.boards.f.tied && !r5.j.boards.s.set && r5.j.boards.f.prev.k === X.k, `level on flaps (${V.f}), quicker (${V.k} < ${X.k}): the tiebreaker takes Fewest Flaps`)
const r6 = await sub(W.inp)
ok(r6.j.boards.s.set && r6.j.boards.s.prev.f === Z.f && r6.j.boards.f.set, `level on time (${W.k}), fewer flaps (${W.f} < ${Z.f}): the tiebreaker takes Fastest (and it’s the quickest ${W.f}-flapper too)`)
const r6b = await sub(W.inp)
ok(r6b.j.boards.f.tied && r6b.j.boards.s.tied, 'and matching it exactly takes nothing')

const nope = await sub([[0, 1]])
ok(nope.status === 422 && /doesn’t sink/.test(nope.j.error), 'a run that doesn’t score → 422')
const unk = await post({ a: 'rec.submit', t: T, h: 'zz-nope', in: L0.inputs })
ok(unk.status === 400 && unk.j.stale === true, 'a hole the server doesn’t know → 400, stale (reload for the new version)')
for (const [inp, why] of [['nope', 'not a list'], [[[0, 2]], 'dir 2'], [[[50, 1], [10, 1]], 'steps going back'], [[[0.5, 1]], 'a fractional step'], [[[40000, 1]], 'past five minutes'], [Array.from({ length: 4001 }, (_, i) => [i, 1]), '4,001 taps']]) {
  const r = await sub(inp)
  ok(r.status === 400, `malformed taps refused (${why})`)
}
ok((await post({ a: 'rec.submit', t: 'z'.repeat(30), h: H, in: L0.inputs })).status === 401, 'submit with a bad token → 401')

// a race run that goes through Golden State's ghost door and still sinks it: solo it warps, in a race the door's shut
const GR = 'gsw-granny', GIN = [[0, 1], [198, 1], [904, 0]]
const solo = await post({ a: 'rec.submit', t: T, h: GR, in: GIN })
const raced = await post({ a: 'rec.submit', t: T, h: GR, in: GIN, race: true })
ok(solo.status === 422 && raced.status === 200 && raced.j.f === 3 && raced.j.k === 1015 && raced.j.boards.f.cur.r === 1,
  'race runs replay with the ghost-hole doors shut: through Golden State’s door it’s a warp solo (422), a make in a race (3 flaps, 1015 steps, marked r)')

// Knockout runs (2.11) never count, whatever the game says
{
  const ko1 = await sub(W.inp, { mode: 'knockout', race: true })
  const ko2 = await sub(W.inp, { ko: true })
  const ko3 = await sub([...W.inp.slice(0, 1), [W.inp[0][0] + 1, 'U'], ...W.inp.slice(1)])
  ok(ko1.status === 403 && ko1.j.ko === true && /Knockout/.test(ko1.j.error) && ko2.status === 403 && ko3.status === 403,
    `a Knockout run is refused (403: “${ko1.j.error}”), marked as one, or with an item in its taps`)
  // a race run from a party whose race is Knockout: refused even when the game doesn't say it was Knockout
  const party = async (mode) => {
    const a1 = await post({ a: 'create', name: 'KoA' }), code = a1.j.code
    const b1 = await post({ a: 'join', code, name: 'KoB' })
    const P = [{ id: a1.j.you, key: a1.j.key }, { id: b1.j.you, key: b1.j.key }]
    await post({ a: 'start', code, id: P[0].id, key: P[0].key, worlds: [{ id: 'newyork', n: 9 }, { id: 'sanantonio', n: 9 }, { id: 'okc', n: 9 }, { id: 'cleveland', n: 9 }] })
    let v = null
    for (let i = 0; i < 4; i++) for (const p of P) v = (await post({ a: 'poll', code, id: p.id, key: p.key, me: { m: 1, h: -1, vw: 'newyork', vm: mode, kv: 2 } })).j
    return { code, mode: v.mode }
  }
  const K = await party('knockout'), S = await party('speed')
  const before = (await get('?rec=all')).j.records[H + '|s']
  const ko4 = await sub(W.inp, { race: true, pc: K.code })
  const sp = await sub(W.inp, { race: true, pc: S.code })
  ok(K.mode === 'knockout' && ko4.status === 403 && ko4.j.ko === true, `a race run from a Knockout party (${K.code}) is refused, even unmarked`)
  ok(S.mode === 'speed' && sp.status === 200, `a race run from a speed party (${S.code}) still counts as before`)
  const afterKo = (await get('?rec=all')).j.records[H + '|s']
  ok(JSON.stringify(before) === JSON.stringify(afterKo), 'and the boards are as they were')
}

// ---------------------------------------------------------------- Knockout's own records (2.12)
// A one-hole Knockout match on The Cage between two signed-in players, through the real endpoint: whoever the seed puts
// on the tee flies the Savant line in (the other gives up straight away, so the runner is the last ball: K), and the
// server replays the hole with the game's own rules (server/sim.mjs) for the record.
{
  const recsBefore = (await get('?rec=all&fresh=1')).j
  const koEmpty = (await get('?rec=ko&fresh=1')).j
  ok(koEmpty.ok && Object.keys(koEmpty.holes).length === 0 && Object.keys(koEmpty.worlds).length === 0, 'the Knockout boards start empty (nothing backfilled)')
  const accts = {}
  for (const nm of ['Koa Runner', 'Kob Runner']) accts[nm] = (await post({ a: 'acct.create', name: nm, pin: '2468' })).j.t
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const enc = (list) => list.map(([t, d]) => t + ':' + d).join(',')
  // runner: whose account should fly; delay: steps on the tee before the line; claim: what its game says (k)
  async function koMatch(runner, delay, claim = null, scoreIt = true) {
    for (let tries = 0; tries < 40; tries++) {
      const names = Object.keys(accts), other = names.find((n) => n !== runner)
      const a1 = await post({ a: 'create', name: 'R1', t: accts[runner] }), code = a1.j.code
      const b1 = await post({ a: 'join', code, name: 'R2', t: accts[other] })
      const P = { run: { id: a1.j.you, key: a1.j.key }, out: { id: b1.j.you, key: b1.j.key } }
      await post({ a: 'start', code, id: P.run.id, key: P.run.key, worlds: [{ id: 'newyork', n: 1 }] })
      let v = null
      for (let i = 0; i < 60 && !(v && v.phase === 'hole'); i++) { for (const p of [P.run, P.out]) v = (await post({ a: 'poll', code, id: p.id, key: p.key, me: { m: 1, h: -1, vw: 'newyork', vm: 'knockout', kv: 2 } })).j; await sleep(60) }
      if (!v || v.phase !== 'hole' || v.mode !== 'knockout') continue
      const ids = v.racers.slice().sort(), pick = SIM.spotOrder(v.seed, ids.length, SIM.SPOTS.cage.length)
      if (pick[ids.indexOf(P.run.id)] !== 0) { await post({ a: 'leave', code, id: P.out.id, key: P.out.key }); await post({ a: 'leave', code, id: P.run.id, key: P.run.key }); continue }   // (not on the tee: again)
      const line = scoreIt ? SIM.LINES.cage.inputs.map(([t, d]) => [t + delay, d]) : [[delay, 1]]
      const ins = [[2, 'K'], ...line]
      // what every game computes (the same world, played with everything known)
      const w = SIM.compileLevel(SIM.HOLES.cage); w.portals = []
      const K = SIM.createKnockout({ world: w, line: SIM.LINES.cage, ids: v.racers, seed: v.seed, starts: SIM.SPOTS.cage })
      K.feed(P.run.id, ins, 9000); K.feed(P.out.id, [[1, 'G']], 9000); K.advance(2400)
      const real = K.finOf(P.run.id)
      while (Date.now() < v.startAt + 1500) await sleep(100)
      await post({ a: 'poll', code, id: P.out.id, key: P.out.key, me: { m: 1, h: 0, k: 10, f: 0, in: '1:G', kv: 2 }, fin: { dnf: 1 } })   // (gives up straight away: G)
      const fin = { k: claim != null ? claim : (real ? real.k : 300), f: real ? real.f : 3 }
      v = (await post({ a: 'poll', code, id: P.run.id, key: P.run.key, me: { m: 1, h: 0, k: fin.k, f: fin.f, in: enc(ins), kv: 2 }, fin })).j
      for (let i = 0; i < 40 && v.phase === 'hole'; i++) { await sleep(80); v = (await post({ a: 'poll', code, id: P.run.id, key: P.run.key, me: { m: 1, h: 0, kv: 2 } })).j }
      // the server's replay, and this side's: the same world (to the same tick)
      const kv = v.kov && v.kov[0]
      const L = SIM.createKnockout({ world: w, line: SIM.LINES.cage, ids: v.racers, seed: v.seed, starts: SIM.SPOTS.cage })
      L.feed(P.run.id, ins, 9000); L.feed(P.out.id, [[1, 'G']], 9000); if (kv) L.advance(kv.T)
      const res = { v, real, claim: fin, kov: kv, same: !!kv && L.hash() === kv.hash, code, P }
      for (let i = 0; i < 30 && res.v.phase !== 'final'; i++) { await sleep(100); res.v = (await post({ a: 'poll', code, id: P.run.id, key: P.run.key, me: { m: 1, h: 0, kv: 2 } })).j }
      return res
    }
    return null
  }
  const ko = async () => (await get('?rec=ko&fresh=' + Date.now())).j
  const m1 = await koMatch('Koa Runner', 60, 120)               // (slow, and its game claims 120 steps: a lie)
  const r1 = await ko()
  ok(m1 && m1.v.mode === 'knockout' && m1.real && m1.kov, 'a Knockout hole with everyone’s inputs in: the server replays it', m1 && JSON.stringify({ real: m1.real, kov: m1.kov }))
  ok(m1 && m1.same, 'the server’s replay is the same world every game has (the same fingerprint, to the same tick)')
  ok(r1.holes.cage && r1.holes.cage.n === 'Koa Runner' && r1.holes.cage.k === m1.real.k && r1.holes.cage.f === m1.real.f,
    `the Knockout record is the replay’s ${m1 && m1.real.k} steps, not the 120 its game claimed (a tampered claim doesn’t count)`, JSON.stringify(r1.holes.cage))
  ok(!r1.worlds.newyork, 'no KOs in the match: no Most KOs record')
  const m2 = await koMatch('Kob Runner', 60)                    // (the same run, the other account: level on both)
  const r2 = await ko()
  ok(m2 && r2.holes.cage.n === 'Koa Runner' && !(r2.counts.cage && r2.counts.cage[0]), 'level on time and flaps: the holder keeps it')
  const m3 = await koMatch('Kob Runner', 10)                    // (50 steps sooner)
  const r3 = await ko()
  ok(m3 && r3.holes.cage.n === 'Kob Runner' && r3.holes.cage.k === m3.real.k && m3.real.k < m1.real.k && JSON.stringify(r3.counts.cage) === '[1,1]', 'faster: it changes hands (broken once, changed hands once)', JSON.stringify(r3.counts.cage))
  const m4 = await koMatch('Koa Runner', 10, null, false)       // (a finish claimed, but its inputs never go in)
  const r4 = await ko()
  ok(m4 && !m4.real && r4.holes.cage.n === 'Kob Runner' && r4.holes.cage.k === m3.real.k, 'a claimed finish the replay doesn’t see go in sets nothing')
  const hist = (await get('?rec=kohistory&h=cage&fresh=1')).j
  ok(hist.entries.length === 2 && hist.entries[0].n === 'Koa Runner' && hist.entries[1].n === 'Kob Runner' && hist.breaks === 1 && hist.hands === 1, 'its history: every holder, oldest first, with how often it was broken and changed hands')
  // Most KOs in a match, per world: the board's own rules (the match counted by the server's replays; see race-test.mjs)
  const ka = (await post({ a: 'acct.me', t: accts['Koa Runner'] })).j, u = (n) => 'u-' + n
  const kt = (ko2, who) => post({ a: 'rec.kotest', cands: [{ world: 'denver', u: u(who), n: who, ko: ko2 }] })
  await kt(2, 'Koa Runner'); await kt(2, 'Kob Runner')
  let w = (await ko()).worlds.denver
  ok(ka.ok && w && w.n === 'Koa Runner' && w.ko === 2, 'Most KOs: the first match with KOs takes the world’s record; level, the holder keeps it')
  await kt(3, 'Kob Runner'); w = (await ko()).worlds.denver
  const wh = (await get('?rec=kohistory&w=denver&fresh=1')).j
  ok(w.n === 'Kob Runner' && w.ko === 3 && JSON.stringify((await ko()).wcounts.denver) === '[1,1]' && wh.entries.length === 2, 'more KOs: it changes hands, with its history and counts')
  ok((await post({ a: 'rec.kotest', cands: [{ world: 'atlanta', u: 'x', n: 'Nobody', ko: 0 }] })).j.res.length === 0, 'a match with no KOs isn’t a record')
  // and the all-time records didn't move
  const recsAfter = (await get('?rec=all&fresh=2')).j
  ok(JSON.stringify(recsAfter.records) === JSON.stringify(recsBefore.records) && JSON.stringify(recsAfter.counts) === JSON.stringify(recsBefore.counts), 'none of it touches the all-time records (or their counts)')
}

const [all, getCost] = await cost(() => get('?rec=all'))
ok(all.status === 200 && all.j.build === SIM.BUILD && all.j.records[H + '|f'].f === W.f && all.j.records[H + '|f'].k === W.k && all.j.records[GR + '|s'] && !('i' in all.j.records[H + '|f']),
  `GET ?rec=all: every board, no taps, and the build (${all.j.build})`)
ok(/s-maxage=5/.test(all.headers.get('cache-control') || ''), 'GET ?rec=all is cached at the edge for 5 s: ' + all.headers.get('cache-control'))
const [wt, watchCost] = await cost(() => get(`?rec=watch&h=${H}&b=s`))
ok(wt.status === 200 && JSON.stringify(wt.j.inputs) === JSON.stringify(W.inp) && wt.j.entry.k === W.k && /s-maxage=5/.test(wt.headers.get('cache-control') || ''), 'GET ?rec=watch: the record’s taps, to watch it back')
ok((await get('?rec=watch&h=rucker&b=f')).status === 404 && (await get('?rec=watch&h=cage&b=x')).status === 400, 'watch: an empty board is 404, a bad board 400')
ok((await get('')).j.races === true, 'a plain GET still answers for races')

// the board's history: every holder, oldest first, and how many times it was broken / changed hands
const hf = await get(`?rec=history&h=${H}&b=f`)
ok(hf.status === 200 && hf.j.entries.map((e) => `${e.f}:${e.k}`).join() === [Y, X, V, W].map((e) => `${e.f}:${e.k}`).join() && hf.j.breaks === 3 && hf.j.hands === 0,
  `GET ?rec=history: every holder, oldest first (${hf.j.entries.map((e) => `${e.f}:${e.k}`).join(' → ')}), broken 3 times, never changed hands (one player)`)
ok(all.j.counts && JSON.stringify(all.j.counts[H + '|f']) === '[3,0]' && JSON.stringify(all.j.counts[H + '|s']) === '[2,0]' && JSON.stringify(all.j.counts[GR + '|f']) === '[0,0]',
  'GET ?rec=all carries each board’s counts [broken, changed hands]: ' + JSON.stringify(all.j.counts))
const ls = await post({ a: 'rec.admin', key: ADMIN_KEY, h: H, b: 'f', op: 'list' })
ok(ls.status === 200 && ls.j.cur.k === W.k && ls.j.history.map((e) => `${e.f}:${e.k}`).join() === [V, X, Y].map((e) => `${e.f}:${e.k}`).join(), 'admin list: the holder and everyone before, newest first: ' + ls.j.history.map((e) => `${e.f}:${e.k}`).join(' '))
const dr = await post({ a: 'rec.admin', key: ADMIN_KEY, h: H, b: 'f', op: 'drop' })
const wt2 = await get(`?rec=watch&h=${H}&b=f`)
ok(dr.j.dropped.k === W.k && dr.j.cur.k === V.k && JSON.stringify(wt2.j.inputs) === JSON.stringify(V.inp), 'admin drop: the record comes down and the one before it is back, taps and all')
ok((await post({ a: 'rec.admin', key: 'wrong', h: H, b: 'f', op: 'list' })).status === 403, 'a wrong admin key → 403')
const hd = await get(`?rec=history&h=${H}&b=f&x=1`)
ok(hd.j.entries.length === 3 && hd.j.breaks === 2 && hd.j.entries[2].k === V.k, 'admin drop takes the dropped holder off the history too (broken 2 times now)')

/* ---------------------------------------------------------------- admin: accounts */
const rp = await post({ a: 'acct.admin', key: ADMIN_KEY, name: 'adam test', op: 'resetpin', pin: '9999' })
ok(rp.status === 200 && rp.j.name === 'Adam Test', 'admin resetpin: a new PIN for a name')
ok((await post({ a: 'acct.me', t: T })).status === 401 && (await post({ a: 'acct.signin', name: 'Adam Test', pin: '1234' })).status === 401 && (await post({ a: 'acct.signin', name: 'Adam Test', pin: '9999' })).status === 200,
  'after a reset the old sessions are signed out, the old PIN fails and the new one works')
ok((await post({ a: 'acct.admin', key: 'nope', name: 'Adam Test', op: 'resetpin', pin: '1111' })).status === 403, 'acct.admin with a wrong key → 403')

const d1 = await post({ a: 'acct.create', name: 'Deleter', pin: '5555' })
await post({ a: 'rec.submit', t: d1.j.t, h: H, in: W.inp })      // (W beats V, back on Fewest Flaps after the drop)
const before = (await get('?rec=all')).j.records[H + '|f']
const del = await post({ a: 'acct.admin', key: ADMIN_KEY, name: 'Deleter', op: 'delete' })
const afterDel = (await get('?rec=all')).j.records[H + '|f']
ok(before.n === 'Deleter' && del.status === 200 && del.j.recordsDropped.includes(H + '|f') && afterDel.n === 'Adam Test' && (await post({ a: 'acct.me', t: d1.j.t })).status === 401 && (await post({ a: 'acct.signin', name: 'Deleter', pin: '5555' })).status === 401,
  'admin delete: the account, its sessions and its records go (the board goes back to the one before)')
const hDel = (await get(`?rec=history&h=${H}&b=f&x=2`)).j
ok(hDel.breaks === 2 && hDel.hands === 0 && hDel.entries.every((e) => e.n === 'Adam Test'), 'a deleted account comes off the history too, and the counts go back')
const d2 = await post({ a: 'acct.create', name: 'Taker', pin: '5555' })
await post({ a: 'rec.submit', t: d2.j.t, h: H, in: W.inp })
const hT = (await get(`?rec=history&h=${H}&b=f&x=3`)).j
ok(hT.breaks === 3 && hT.hands === 1 && hT.entries[3].n === 'Taker', 'someone else taking it: broken 3 times, changed hands once')
// boards set before the log existed: the admin rebuild makes it from their history
const rest = async (cmd) => (await (await globalThis.fetch(`http://127.0.0.1:${PORT + 1}`, { method: 'POST', body: JSON.stringify(cmd) })).json()).result
await rest(['DEL', `fhrec:log:${H}|f`, `fhrec:log:${H}|s`, 'fhrec:c'])
const rb = await post({ a: 'rec.admin', key: ADMIN_KEY, op: 'rebuildlog' })
const hR = (await get(`?rec=history&h=${H}&b=f&x=4`)).j, aR = (await get('?rec=all&x=4')).j
ok(rb.status === 200 && rb.j.rebuilt.includes(H + '|f') && hR.breaks === 3 && hR.hands === 1 && hR.entries.map((e) => e.n).join() === 'Adam Test,Adam Test,Adam Test,Taker' && JSON.stringify(aR.counts[H + '|f']) === '[3,1]',
  'admin rebuildlog: a board with no log gets one from its history (same order and counts)')
ok((await post({ a: 'acct.create', name: 'Deleter', pin: '5555' })).status === 200, 'and the name is free again')

console.log(`\nRedis commands per call: create ${(await cost(() => post({ a: 'acct.create', name: 'Counter', pin: '1234' })))[1]} · sign in ${signinCost} · sync ${syncCost} · rec.submit ${submitCost} · GET ?rec=all ${getCost} · GET ?rec=watch ${watchCost}`)
console.log(`${n - failed} of ${n} passed`)
dev.kill()
process.exit(failed ? 1 : 0)
