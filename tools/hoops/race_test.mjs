// End-to-end race test: in-memory Upstash, controllable clock, no network, no credentials.
process.env.KV_REST_API_URL = 'http://fake-redis.local'
process.env.KV_REST_API_TOKEN = 'test'

const H = new Map(), S = new Map()
const hash = (k) => { if (!H.has(k)) H.set(k, new Map()); return H.get(k) }
function run(cmd) {
  const [op, ...a] = cmd.map((x) => (typeof x === 'string' ? x : String(x)))
  switch (op.toUpperCase()) {
    case 'HGETALL': return [...hash(a[0]).entries()].flat()
    case 'HSET': { const h = hash(a[0]); for (let i = 1; a[i + 1] !== undefined; i += 2) h.set(a[i], a[i + 1]); return 1 }
    case 'HSETNX': { const h = hash(a[0]); if (h.has(a[1])) return 0; h.set(a[1], a[2]); return 1 }
    case 'HGET': return hash(a[0]).get(a[1]) ?? null
    case 'HINCRBY': { const h = hash(a[0]); const v = Number(h.get(a[1]) || 0) + Number(a[2]); h.set(a[1], String(v)); return v }
    case 'DEL': H.delete(a[0]); S.delete(a[0]); return 1
    case 'EXPIRE': return 1
    default: throw new Error('unsupported: ' + op)
  }
}
globalThis.fetch = async (url, opts = {}) => {
  const b = JSON.parse(opts.body || '[]')
  const out = String(url).endsWith('/pipeline') ? b.map((c) => ({ result: run(c) })) : { result: run(b) }
  return { ok: true, headers: { get: () => 'application/json' }, json: async () => out }
}
let OFFSET = 0
const REAL = Date.now
Date.now = () => REAL.call(Date) + OFFSET
const travel = (ms) => { OFFSET += ms }

const { default: handler } = await import('../../api/race.js')
const P = await import('../../src/lib/hoopsPhysics.js')
const { solve } = await import('./solver.mjs')

const call = (method, query, body) => {
  const req = { method, query, body, headers: {}, socket: {} }
  let payload = null, code = 0
  const res = { setHeader() {}, status(c) { code = c; return this }, json(j) { payload = j } }
  return handler(req, res).then(() => ({ code, ...payload }))
}
const ok = (l, c, x = '') => console.log(`${c ? '  PASS' : '  FAIL'}  ${l}${x ? '  — ' + x : ''}`)
const enc = (inputs) => inputs.map((i) => `${i.s}:${i.d}`).join(',')
const HOLE_CAP_TEST = 130000   // just past api/race.js's HOLE_CAP_MS

console.log('\n--- make a party')
const made = await call('POST', { action: 'create' }, { uid: 'a', name: 'Adam', world: 'dallas' })
ok('party created', made.ok && /^[A-HJ-NP-Z2-9]{4}$/.test(made.code), 'code=' + made.code)
const C = made.code
const lobby = await call('GET', { action: 'state', code: C, uid: 'a' })
ok('starts in a lobby', lobby.status === 'lobby')
ok('a whole world is the match', lobby.holeCount === 9, lobby.holeCount + ' holes')

console.log('\n--- joining')
const solo = await call('POST', { action: 'start', code: C, uid: 'a' }, {})
ok('cannot start alone', solo.code === 409, solo.error)
for (const [u, n] of [['b', 'Ben'], ['c', 'Chris']]) await call('POST', { action: 'join' }, { code: C, uid: u, name: n })
const guest = await call('POST', { action: 'start', code: C, uid: 'b' }, {})
ok('only the host starts', guest.code === 403, guest.error)

console.log('\n--- hole 1')
const r1 = await call('POST', { action: 'start', code: C, uid: 'a' }, {})
ok('match running', r1.status === 'running' && r1.hole === 0)
ok('there is a countdown before step 0', r1.startAt > r1.now, `${r1.startAt - r1.now}ms`)
const LI = r1.levelIndex
const sol = solve(LI)
ok('the hole is winnable', sol.sank, `par line ${sol.flaps} flaps`)

console.log('\n--- flaps travel as inputs, not positions')
const half = enc(sol.inputs.slice(0, 2))
await call('POST', { action: 'input' }, { code: C, uid: 'b', inputs: half })
const seen = await call('GET', { action: 'state', code: C, uid: 'a' })
ok('others can see my flaps mid-run', seen.inputs.b === half, seen.inputs.b)
ok('and my own ball is not broadcast as a position',
   !JSON.stringify(seen).includes('"x":') && !JSON.stringify(seen).includes('"vx"'))

console.log('\n--- finishing is verified by replay')
const cheat = await call('POST', { action: 'finish' }, { code: C, uid: 'b', inputs: '0:1' })
ok('a run that does not sink is rejected', cheat.code === 400, cheat.error)
const bad = await call('POST', { action: 'finish' }, { code: C, uid: 'b', inputs: 'nonsense' })
ok('malformed inputs are rejected', bad.code === 400, bad.error)
const fin = await call('POST', { action: 'finish' }, { code: C, uid: 'b', inputs: enc(sol.inputs) })
ok('a genuine run is accepted', fin.status === 'running' && !!fin.finishes.b, fin.finishes.b)
ok('the first finisher is recorded', fin.firstAt !== null)
const dbl = await call('POST', { action: 'finish' }, { code: C, uid: 'b', inputs: enc(sol.inputs) })
ok('you cannot finish twice', dbl.code === 409, dbl.error)

console.log('\n--- a hole ends when everyone is home, or at the cap')
const slow = solve(LI)
await call('POST', { action: 'finish' }, { code: C, uid: 'c', inputs: enc(slow.inputs) })
travel(21000)
const mid = await call('GET', { action: 'state', code: C, uid: 'a' })
ok('a finished player does not cut the hole short', mid.status === 'running',
   'still ' + mid.status + ' 21s after the first finish')
travel(HOLE_CAP_TEST)
const closed = await call('GET', { action: 'state', code: C, uid: 'a' })
ok('the hole ends at the cap', closed.status === 'hole-done')
ok('a scoreboard is produced', Array.isArray(closed.table) && closed.table.length === 3)
const winner = closed.table.find((r) => r.place === 1)
ok('first place scores 10', winner && winner.points === 10, JSON.stringify(closed.table.map(r => [r.uid, r.place, r.points])))
ok('whoever never sank scores nothing', closed.table.find((r) => r.uid === 'a').points === 0)
ok('standings reflect the hole', closed.standings[0].points === 10)

console.log('\n--- playing out the world')
let guard = 0, st = closed
while (st.status !== 'finished' && guard++ < 30) {
  const nx = await call('POST', { action: 'next', code: C, uid: 'a' }, {})
  if (nx.status === 'finished') { st = nx; break }
  const s = solve(nx.levelIndex)
  await call('POST', { action: 'finish' }, { code: C, uid: 'a', inputs: enc(s.inputs) })
  travel(HOLE_CAP_TEST)
  st = await call('GET', { action: 'state', code: C, uid: 'a' })
}
ok('the match ends after the last hole', st.status === 'finished', `after ${guard} holes`)
ok('a winner is declared', !!st.winner, st.winner ? `${st.winner.name} on ${st.winner.points}` : '')
ok('the winner is whoever has most points',
   st.standings[0].points >= st.standings[st.standings.length - 1].points,
   st.standings.map(s => `${s.name}:${s.points}`).join(' '))

console.log('\n--- world physics must agree on both sides')
// Denver bends drag and gravity. If the server verified against sea-level numbers it would
// reject honest runs there, so play a Denver hole through the real endpoint.
const den = await call('POST', { action: 'create' }, { uid: 'd1', name: 'D1', world: 'denver' })
await call('POST', { action: 'join' }, { code: den.code, uid: 'd2', name: 'D2' })
const dr = await call('POST', { action: 'start', code: den.code, uid: 'd1' }, {})
ok('a denver match starts', dr.status === 'running', 'level ' + dr.levelIndex)
const dsol = solve(dr.levelIndex)
ok('the denver hole solves under thin air', dsol.sank, dsol.flaps + ' flaps')
const dfin = await call('POST', { action: 'finish' }, { code: den.code, uid: 'd1', inputs: enc(dsol.inputs) })
ok('the server accepts a thin-air run', !!dfin.finishes && !!dfin.finishes.d1, dfin.error || dfin.finishes?.d1)

console.log('\n--- the chase clock is gone')
travel(25000)
const still = await call('GET', { action: 'state', code: den.code, uid: 'd2' })
ok('one finisher does not cut the hole short', still.status === 'running',
   'status ' + still.status + ' 25s after the first finish')
travel(130000)
const capped = await call('GET', { action: 'state', code: den.code, uid: 'd2' })
ok('the two-minute cap still ends it', capped.status === 'hole-done')
