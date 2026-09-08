// Possession-lite game simulation — the browser port of Basketball-Savant/sim_engine.py.
//
// This file and the Python file MUST produce identical results from identical seeds:
// the server verifies a claimed season by replaying it, so a divergence of one
// possession invalidates the whole leaderboard. Two things make that possible.
//
//   1. mulberry32, not Math.random. Same thirty lines of 32-bit integer arithmetic in
//      both runtimes (see prng.py).
//   2. Every gaussian draw is rounded to 9 decimals. log/cos/sqrt can disagree between
//      runtimes in the last bit, and one bit is enough to flip a comparison and diverge
//      a season. Nine decimals sits far below anything the model notices and far above
//      where the runtimes differ.
//
// tools/gm/fixtures.json holds seeds and their expected scores, asserted in both.
import { SEED } from './seed.js'

const C = SEED.cal
const Q = 1e9

export function rng(seed) {
  let a = seed | 0
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    rand,
    gauss(mu = 0, sd = 1) {
      const u1 = Math.max(1e-12, rand())
      const u2 = rand()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      return Math.round((mu + sd * z) * Q) / Q
    },
    randrange(n) { return Math.floor(rand() * n) % n },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.randrange(i + 1)
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    },
  }
}

const adj = (pct, scale) => 1 + ((50 - pct) / 50) * scale

// AVAILABILITY IS A PER-GAME THING, NOT A PER-MINUTE THING.
//
// `load` is minutes discounted by availability, and the rotation used to share the night out
// by it. That conflates two different questions — how often a man is fit to play, and how much
// he plays when he does — and the answer it produced was that a player expected to miss half
// the year was on the floor for sixteen minutes of every single game instead of thirty-three
// minutes of half of them.
//
// It was not a rounding error. Thirteen of thirty clubs had their best player outside their
// own top three in minutes: Jayson Tatum listed at 32.6 and playing 16.8, tenth in Boston's
// rotation; Trae Young at eighteen per cent availability never appearing at all. And because
// the top ten loads were then normalised to 240 regardless of what they summed to — 161 on one
// roster, 214 on another — a thin team inflated everybody, which is how Jamal Murray came out
// at 42.4 minutes a night, a figure no player in NBA history has posted.
//
// So availability now decides WHO DRESSES, drawn once per man before the game, and the men who
// dress share the night by what they actually play. A star plays star minutes on the nights he
// plays and misses the nights he does not, the rest of the roster absorbs his minutes when he
// is out, and a season's averages come back close to what the profile says.
export const MIN_DRESSED = 8
// Five men on the floor for forty-eight minutes.
export const GAME_LENGTH = 240

// Recovered from the profile rather than added to it: `load` is mpg times availability, and
// both runtimes read the same seed file, so neither needs a new field to agree on this.
export const availabilityOf = (p) => Math.max(0.05, Math.min(1,
  (p.load || 0) / Math.max(1, p.mpg || 1)))

// Who is fit tonight. ONE DRAW PER MAN, ALWAYS — the count of draws cannot depend on the
// outcome or the two runtimes fall out of step on the very next number.
//
// Drawn in ID ORDER, not roster order, and that is not fussiness. The two runtimes hold the
// same sixteen men in different orders — Python's loader and the seed file disagree from the
// fourth man on — which never mattered while the rotation sorted by load, because sorting
// does not care how the list arrived. The moment a draw is spent PER MAN IN SEQUENCE, the
// order decides which player gets which number, and the same seed dressed two different
// nines. Possession counts still matched, which is what made it look like a scoring bug.
export const drawOrder = (roster) => [...roster]
  .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))

export function dressed(roster, r) {
  const fit = [], out = []
  for (const p of drawOrder(roster)) {
    if (r.rand() < availabilityOf(p)) fit.push(p)
    else out.push(p)
  }
  if (fit.length >= MIN_DRESSED) return fit
  // Nobody forfeits. Short of eight, the most available of the missing dress anyway — decided
  // without drawing, so the stream stays aligned, and tie-broken on id so it is not left to
  // the sort's discretion.
  const spare = [...out].sort((a, b) => availabilityOf(b) - availabilityOf(a)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return [...fit, ...spare.slice(0, MIN_DRESSED - fit.length)]
}

// Nobody plays forty minutes because the roster is thin. On a night when eight men dress and
// one of them is Nikola Jokić, sharing strictly by season minutes hands him forty-four — which
// is not a coaching decision anybody makes, it is an artefact of dividing a fixed number by a
// short list. So the share is capped and the overflow goes to the men who have room for it.
export const MAX_MINUTES = 38
const CAP_PASSES = 3

// The night, shared out by what these men actually play.
export function rotation(roster, n = 10) {
  // Ties broken on id for the same reason: never leave the answer to how the list arrived.
  const pool = [...roster].sort((x, y) => (y.mpg - x.mpg)
    || (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0)).slice(0, n)
  const tot = pool.reduce((s, p) => s + p.mpg, 0) || 1
  const cap = MAX_MINUTES / GAME_LENGTH
  let share = pool.map((p) => p.mpg / tot)
  // A fixed number of passes rather than a loop to convergence: it settles in one or two, and
  // a fixed count is the same arithmetic in both runtimes every time.
  for (let pass = 0; pass < CAP_PASSES; pass++) {
    let over = 0, room = 0
    for (const x of share) {
      if (x > cap) over += x - cap
      else room += cap - x
    }
    if (over <= 0 || room <= 0) break
    share = share.map((x) => (x > cap ? cap : x + (over * (cap - x)) / room))
  }
  return pool.map((p, i) => ({ ...p, _share: share[i] }))
}

// Who tipped it off. Ordered by MINUTES, not by load — load is minutes discounted by
// availability, which is right for deciding how the engine shares out a game and wrong for
// deciding who starts one. A star who misses twenty games still starts the sixty he plays,
// and reading starters off load had Giannis Antetokounmpo and Victor Wembanyama on the
// Sixth Man of the Year ballot. Draws no randomness. Exported because "he came off the
// bench" is the whole of that award.
export const startersOf = (pool) => new Set([...pool]
  .sort((a, b) => (b.mpg ?? b.load ?? 0) - (a.mpg ?? a.load ?? 0)).slice(0, 5).map((p) => p.id))

// Court time as the engine allots it: one five on the floor for forty-eight minutes, shared
// out by load.
export const minutesOf = (p, total = 240) => (p._share ?? 0) * total

// Deficit-driven rotation: one five on the floor at a time, substituting when a player's
// played share drifts from his target. Redrawing five at random each possession flattens
// minutes and lets a player defend a possession he was not on the floor for.
function makeLineup(pool) {
  const played = Object.create(null)
  pool.forEach((p) => { played[p.id] = 0 })
  let five = [...pool].sort((a, b) => b._share - a._share).slice(0, 5)
  return {
    tick(i) {
      five.forEach((p) => { played[p.id] += 1 })
      if (i % 6 !== 0 || i === 0) return five
      const elapsed = i + 1
      const deficit = (p) => p._share * 5 * elapsed - played[p.id]
      const bench = pool.filter((p) => !five.includes(p))
      if (!bench.length) return five
      let out = five[0], inn = bench[0]
      five.forEach((p) => { if (deficit(p) < deficit(out)) out = p })
      bench.forEach((p) => { if (deficit(p) > deficit(inn)) inn = p })
      if (deficit(inn) > deficit(out)) five = five.map((p) => (p === out ? inn : p))
      return five
    },
  }
}

const defProfile = (five) => ({
  rim: five.reduce((s, p) => s + p.dr, 0) / five.length,
  poa: five.reduce((s, p) => s + p.dp, 0) / five.length,
  evt: five.reduce((s, p) => s + p.de, 0) / five.length,
  dreb: five.reduce((s, p) => s + p.dreb, 0) / five.length,
})

function weighted(five, key, r) {
  const w = five.map((p) => Math.max(1e-6, p[key]))
  const tot = w.reduce((a, b) => a + b, 0)
  let acc = 0, x = r.rand() * tot
  for (let i = 0; i < five.length; i++) { acc += w[i]; if (acc >= x) return five[i] }
  return five[five.length - 1]
}

function assist(five, shooter, r, box) {
  const c = five.filter((p) => p !== shooter)
  if (!c.length) return
  if (r.rand() < C.AST_CAL) {
    const tot = c.reduce((s, p) => s + p.ast, 0) || 1
    let acc = 0, x = r.rand() * tot
    for (const p of c) { acc += p.ast; if (acc >= x) { bump(box, p.id, 'ast'); return p } }
  }
  return null
}

const bump = (box, id, k, v = 1) => {
  const b = box[id] || (box[id] = {})
  b[k] = (b[k] || 0) + v
}

// WHO DID IT. A turnover is a live ball somebody took, and a missed two is sometimes a shot
// somebody sent into the third row. Both were happening in the engine already; neither was
// ever credited to anybody, so the season had to guess afterwards from a generic defensive
// rating — which put a centre on top of the league in steals.
//
// Savant measures both for every player: `stlr` is steals per hundred opponent possessions
// and `blkr` is the share of opponent two-point attempts he blocks. So the engine can just
// ask who, using the rates the men actually posted.
//
// EXACTLY ONE DRAW, ALWAYS. Not one draw when somebody has a rate and none otherwise — the
// number of times this function touches the random stream must never depend on the data, or
// the JavaScript and Python engines drift the moment one runtime has a rate the other is
// missing, and thirty replay fixtures start failing for a reason nobody can find. The single
// draw decides both whether it happened and who did it: given that it happened, x is uniform
// below the threshold, so rescaling it picks the man at no further cost.
function credit(five, key, cal, r, box, stat) {
  const x = r.rand()
  let sum = 0
  for (const q of five) sum += Math.max(0, q[key] || 0)
  if (sum <= 0) return null
  const p = Math.min(0.9, sum * cal)
  if (x >= p) return null
  const y = (x / p) * sum
  let acc = 0
  for (const q of five) {
    acc += Math.max(0, q[key] || 0)
    if (acc >= y) { bump(box, q.id, stat); return q }
  }
  const last = five[five.length - 1]
  bump(box, last.id, stat)
  return last
}

// `ev`, when present, collects what happened as plays for the gamecast. It must never
// touch the RNG — the same seed has to produce the same game whether or not the user is
// watching it, or the server's replay check falls apart.
function possession(off5, dfn, r, hot, box, st, depth = 0, ev = null) {
  const D = defProfile(dfn)
  const w = off5.map((p) => p.usg)
  const tot = w.reduce((a, b) => a + b, 0) || 1
  let man = off5[off5.length - 1], acc = 0
  const x = r.rand() * tot
  for (let i = 0; i < off5.length; i++) { acc += w[i]; if (acc >= x) { man = off5[i]; break } }
  const id = man.id

  const tovP = C.TOV_CAL * man.tov * adj(D.evt, -C.DEF_EVT) * st.momentum_tov
  if (r.rand() < Math.min(0.35, tovP)) {
    bump(box, id, 'tov')
    const thief = credit(dfn, 'stlr', C.STL_CAL, r, box, 'stl')
    if (ev) ev.push({ k: 'tov', id, n: man.n, stl: thief ? thief.n : null })
    return 0
  }

  if (r.rand() < Math.min(0.45, man.ftr * C.FTR_CAL)) {
    let made = 0
    for (let i = 0; i < 2; i++) if (r.rand() < man.ft) made++
    bump(box, id, 'fta', 2); bump(box, id, 'ftm', made); bump(box, id, 'pts', made)
    if (ev) ev.push({ k: 'ft', id, n: man.n, made, att: 2 })
    return made
  }

  const three = r.rand() < man.fg3r
  const h = hot[id] || 1
  if (three) {
    const p = C.FG3_CAL * man.fg3 * adj(D.poa, C.DEF_POA) * h * st.momentum_shot
    bump(box, id, 'fg3a'); bump(box, id, 'fga')
    if (r.rand() < Math.max(0.05, Math.min(0.75, p))) {
      bump(box, id, 'fg3m'); bump(box, id, 'fgm'); bump(box, id, 'pts', 3)
      const a = assist(off5, man, r, box)
      if (ev) ev.push({ k: '3', id, n: man.n, made: true, ast: a ? a.n : null, hot: h > 1.02 })
      hot[id] = h + C.HOT_UP; return 3
    }
    if (ev) ev.push({ k: '3', id, n: man.n, made: false })
    hot[id] = h - C.HOT_DOWN
  } else {
    const p = C.FG2_CAL * man.fg2 * adj(D.rim, C.DEF_RIM) * h * st.momentum_shot
    bump(box, id, 'fga')
    if (r.rand() < Math.max(0.15, Math.min(0.85, p))) {
      bump(box, id, 'fgm'); bump(box, id, 'pts', 2)
      const a = assist(off5, man, r, box)
      if (ev) ev.push({ k: '2', id, n: man.n, made: true, ast: a ? a.n : null,
        rim: man.slot >= 3.6 || man.ftr > 0.3 })
      hot[id] = h + C.HOT_UP; return 2
    }
    // Only twos. Blocked threes happen and they are rare enough that the rate Savant
    // measures — share of opponent TWO-point attempts blocked — is the one to use.
    const blocker = credit(dfn, 'blkr', C.BLK_CAL, r, box, 'blk')
    if (ev) ev.push({ k: '2', id, n: man.n, made: false, blk: blocker ? blocker.n : null })
    hot[id] = h - C.HOT_DOWN
  }

  if (r.rand() < C.TEAM_REB) { if (ev) ev.push({ k: 'reb', team: true }); return 0 }
  const orb = off5.reduce((s, p) => s + p.oreb, 0) / 5
  const pOrb = orb / Math.max(1e-6, orb + D.dreb)
  if (r.rand() < pOrb * C.ORB_CAL) {
    const p = weighted(off5, 'oreb', r)
    bump(box, p.id, 'oreb'); bump(box, p.id, 'reb')
    if (ev) ev.push({ k: 'orb', id: p.id, n: p.n })
    if (depth < 3) return possession(off5, dfn, r, hot, box, st, depth + 1, ev)
    return 0
  }
  const p = weighted(dfn, 'dreb', r)
  bump(box, p.id, 'dreb'); bump(box, p.id, 'reb')
  if (ev) ev.push({ k: 'drb', id: p.id, n: p.n })
  return 0
}

export function winProb(margin, possLeft, sdPerPoss = 1.16) {
  if (possLeft <= 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5
  const sd = sdPerPoss * Math.sqrt(2 * possLeft)
  const z = margin / Math.max(1e-6, sd)
  // Abramowitz & Stegun erf approximation — display only, never fed back into the sim.
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-((z / Math.SQRT2) ** 2))
  return 0.5 * (1 + (z >= 0 ? y : -y))
}

export function simulate(homeRoster, awayRoster, seed = 0, trace = false) {
  const r = rng(seed)
  // Home first, then away, every man drawn for exactly once. Both runtimes do this in this
  // order before any other number is taken.
  const H = rotation(dressed(homeRoster, r)), A = rotation(dressed(awayRoster, r))
  const box = Object.create(null)
  const score = { home: 0, away: 0 }
  const luck = { home: r.gauss(1, C.GAME_LUCK), away: r.gauss(1, C.GAME_LUCK) }
  const hot = Object.create(null)
  const nPoss = Math.round(r.gauss(C.pace, 4))
  const offM = { home: 1, away: 1 }, defM = { home: 1, away: 1 }
  const state = {
    home: { momentum_shot: luck.home * C.HCA, momentum_tov: 1 },
    away: { momentum_shot: luck.away, momentum_tov: 1 },
  }
  const LH = makeLineup(H), LA = makeLineup(A)
  const tr = trace ? [] : null
  let plays = tr ? [] : null

  for (let i = 0; i < nPoss; i++) {
    const h5 = LH.tick(i), a5 = LA.tick(i)
    for (const [side, o5, d5] of [['home', h5, a5], ['away', a5, h5]]) {
      const lead = score[side] - score[side === 'home' ? 'away' : 'home']
      const st = state[side]
      const sv = st.momentum_shot
      let over = 0
      if (lead > C.SCORE_THRESHOLD) over = Math.min(28, lead - C.SCORE_THRESHOLD)
      else if (lead < -C.SCORE_THRESHOLD) over = Math.max(-28, lead + C.SCORE_THRESHOLD)
      st.momentum_shot = sv * (1 - C.SCORE_EFFECT * over)
      const ev = tr ? [] : null
      const got = possession(o5, d5, r, hot, box, st, 0, ev)
      score[side] += got
      if (tr) plays.push({ side, ev, pts: got })
      st.momentum_shot = sv
      o5.forEach((p) => {
        const h = hot[p.id]
        if (h !== undefined && h !== 1) hot[p.id] = 1 + (h - 1) * C.HOT_DECAY
      })
      const base = luck[side] * (side === 'home' ? C.HCA : 1) * offM[side] * defM[side]
      state[side].momentum_shot = base + (state[side].momentum_shot - base) * 0.98
    }
    if (tr) {
      const m = score.home - score.away
      tr.push({ p: i + 1, h: score.home, a: score.away,
        wp: Math.round(winProb(m, nPoss - i - 1) * 1e4) / 1e4,
        q: Math.min(4, Math.floor((i * 4) / nPoss) + 1),
        plays })
      plays = []
    }
  }
  // Overtime. Without it a tie is resolved by whichever comparison is written first and
  // the box score shows a 113-113 loss, which is not a thing that happens in basketball.
  let ot = 0
  let total = nPoss
  while (score.home === score.away && ot < 6) {
    ot++
    for (let j = 0; j < 5; j++) {
      const i = total + j
      const h5 = LH.tick(i), a5 = LA.tick(i)
      for (const [side, o5, d5] of [['home', h5, a5], ['away', a5, h5]]) {
        const ev = tr ? [] : null
        const got = possession(o5, d5, r, hot, box, state[side], 0, ev)
        score[side] += got
        if (tr) plays.push({ side, ev, pts: got })
      }
      if (tr) {
        tr.push({ p: i + 1, h: score.home, a: score.away, wp: 0.5, q: 4 + ot, plays })
        plays = []
      }
    }
    total += 5
  }
  // WHO ACTUALLY PLAYED, handed back rather than left to be guessed at.
  //
  // The season's accumulator used to re-derive the rotation from the full roster, which was
  // merely redundant while the rotation was a pure function of the roster and became a lie
  // the moment availability started deciding who dressed: the engine played the game with
  // one nine and the box score booked the minutes to a different ten. Returning the lineups
  // costs nothing — the cross-runtime check compares the score, the box and the possession
  // count, so Python does not have to hand anything back to match.
  return { score, box, nPoss: total, trace: tr, lineups: { home: H, away: A } }
}
