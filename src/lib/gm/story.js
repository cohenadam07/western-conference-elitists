// WHY A GOOD PLAYER BECOMES GETTABLE.
//
// Every price in this game has been a number about basketball: what a man produces, what he
// costs, how old he is. That is most of how a front office thinks and none of how the league
// actually moves. Damian Lillard was not traded because Portland's model said his surplus had
// turned; he was traded because he asked to be. Anthony Davis, Jimmy Butler, Paul George,
// Kevin Durant, James Harden — the biggest names change teams because of a SITUATION, and the
// situation is what makes an untouchable player touchable.
//
// So this layer does not adjust anybody's price. It moves men down the availability ladder in
// `trade/accept.js` — the franchise player becomes a core player you can have for an overpay,
// the core player becomes a premium one. The value model stays honest and the market gets a
// reason to open.
//
// The four things that make a man want out are the four things that make a man want out:
//
//   losing while his window closes   a good player at 28 on a team going nowhere
//   role                             a starter playing twenty-two minutes
//   being shopped                    you put him on the block and did not move him
//   a contract standoff              an expiring deal and no extension
//
// Nothing here is random for its own sake. The heat is computed from the roster, the record
// and what the user actually did; the die decides only WHEN it comes out.
import { rng } from './sim.js'

export const SITUATION = {
  CONTENT: 'content',
  RESTLESS: 'restless',   // grumbling, and his agent is briefing reporters
  REQUEST: 'request',     // has asked to be traded, publicly
  STANDOFF: 'standoff',   // extension talks are over; he plays the year out
  COMMITTED: 'committed', // just signed, and harder to get than he was
}

export const LABEL = {
  [SITUATION.RESTLESS]: 'Unsettled',
  [SITUATION.REQUEST]: 'Wants out',
  [SITUATION.STANDOFF]: 'Contract standoff',
  [SITUATION.COMMITTED]: 'Committed',
}

/* ------------------------------------------------------------------- the pressures */

// HOW GOOD HE IS, RELATIVE TO THE LEAGUE — not his tier.
//
// The first version of all of this gated on market tier and produced three stories in a whole
// season, every one of them a contract standoff. The reason is that the tier scale is
// compressed near the top: of four hundred and sixty-three players, thirty-four are tier
// three and three are tier five. Damian Lillard is a tier two. So a rule reading "tier >= 3"
// is not a rule about stars, it is a rule about nobody.
//
// `q` is a percentile of talent across the league — 0.97 is a top-fifteen player, 0.85 is a
// good starter, 0.6 is a rotation man. It is computed once per sweep from talentVorp, which
// is the honest talent number the availability ladder already uses, and it does the job the
// tier was failing to do.

// What a man of this quality expects to play — set to roughly the TWENTY-FIFTH percentile of
// minutes actually played at each level of talent in this league, measured rather than
// guessed. The first curve was the median and it made everybody aggrieved: half of every
// quality band is by definition below its own median, and Javonte Green came out as the
// angriest man in basketball. At the p25 the number means what the story needs it to mean —
// not "less than his peers" but "less than nearly all of his peers".
export function expectedMin(q) {
  if (q >= 0.94) return 32
  if (q >= 0.88) return 31
  if (q >= 0.80) return 26
  if (q >= 0.70) return 23
  if (q >= 0.55) return 20
  return 12
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))

// Losing while the window closes. Weighted by BOTH how good he is and how far past the middle
// of his career he is — a 23-year-old on a 20-win team is on a rebuild he is part of, and a
// 31-year-old on the same team is watching his prime get spent on somebody else's plan.
export function windowHeat({ age = 26, q = 0.5, winPct = 0.5 }) {
  if (q < 0.8) return 0
  const good = clamp01((q - 0.8) / 0.17)
  const old = clamp01((age - 26.5) / 5)
  const bad = clamp01((0.5 - winPct) * 2.4)
  return good * old * bad
}

// Role. Only counts if he is good enough for the minutes he is not getting.
// A man under twenty-three is not aggrieved about his minutes; he is a young player on a
// rising role, and the first version had Victor Wembanyama and a nineteen-year-old Dylan
// Harper filing role grievances about playing twenty-two minutes as rookies.
export function roleHeat({ q = 0.5, mpg = 24, age = 26 }) {
  if (q < 0.6) return 0
  const grown = clamp01((age - 22.5) / 2.5)
  return grown * clamp01((q - 0.6) / 0.25) * clamp01((expectedMin(q) - mpg) / 9)
}

// Being shopped. He knows. A man you dangled and did not move is the single most reliable
// source of a trade request in the real league, and it is the one the user causes himself.
//
// Gated on STATURE rather than on modelled talent, and that distinction is the whole reason
// this function was silently doing nothing. Portland's highest-paid player is Ja Morant at
// forty-two million a year and twenty-eight minutes a night, and talentVorp puts him at the
// forty-eighth percentile — so shopping the most expensive man on the roster produced no
// story at all. Whether being shopped stings is not a question about efficiency. It is a
// question about standing, and standing is what you are paid and how much you play.
export function shoppedHeat({ shopped = 0, shoppedUnmoved = false, q = 0.5, stature }) {
  const st = stature ?? q
  if (!shopped || st < 0.5) return 0
  return (shoppedUnmoved ? 0.85 : 0.45) * clamp01((st - 0.5) / 0.3)
}

// A contract standoff. An expiring deal on a man good enough to want paying, where the club
// has not extended him. Gated on quality as hard as the rest: at "anyone on an expiring deal"
// a third of the league was in a standoff at once, which is not a story, it is a season.
export function contractHeat({ yr = 3, q = 0.5, extended = false }) {
  if (extended || q < 0.75 || yr > 1) return 0
  const good = clamp01((q - 0.75) / 0.2)
  return (yr <= 0 ? 0.75 : 0.55) * good
}

// The four together. Not a sum — a man with two live grievances is much angrier than a man
// with one, but four cannot take him past certain.
export function heatOf(p) {
  const parts = [windowHeat(p) * 1.0, roleHeat(p) * 0.85, shoppedHeat(p) * 0.95, contractHeat(p) * 0.85]
  let left = 1
  for (const x of parts) left *= 1 - clamp01(x)
  return 1 - left
}

// Which grievance is the loudest — it decides what KIND of situation this becomes and what
// the wire says about it.
export function loudest(p) {
  const parts = [
    ['contract', contractHeat(p) * 0.85],
    ['window', windowHeat(p) * 1.0],
    ['shopped', shoppedHeat(p) * 0.95],
    ['role', roleHeat(p) * 0.85],
  ]
  return parts.sort((a, b) => b[1] - a[1])[0]
}

/* ---------------------------------------------------------------------- the firing */

// Four moments a year rather than a running dice roll: it makes the season have beats, and it
// means the same save re-simulated lands the same stories in the same weeks.
export const CHECKPOINTS = ['december', 'allstar', 'deadline', 'summer']
export const FIRE_RATE = 0.62
export const HEAT_FLOOR = 0.22
// Tuned against the measured heat distribution of a played season rather than picked: the
// league produces about a dozen men above the floor, and this turns them into four to six
// stories a year, which is roughly what the real league produces.
export function fireChance(heat) {
  if (heat < HEAT_FLOOR) return 0
  return Math.pow((heat - HEAT_FLOOR) / (1 - HEAT_FLOOR), 1.2) * FIRE_RATE
}

// A standoff is a contract story and a request is a basketball one; below the request
// threshold a man is merely unsettled, which changes nothing about his price and tells the
// user something is coming.
//
// The threshold is 0.38 because that is where Damian Lillard sits — thirty-five, on a
// twenty-five-win Portland team, playing thirty-six minutes a night for nothing. If the man
// the whole feature exists to model comes out as "mildly unsettled", the number is wrong.
export const REQUEST_HEAT = 0.38
export function situationFor(p, roll) {
  const heat = heatOf(p)
  const chance = fireChance(heat)
  if (roll >= chance) return null
  const [why] = loudest(p)
  if (why === 'contract') return { state: SITUATION.STANDOFF, why }
  return { state: heat >= REQUEST_HEAT ? SITUATION.REQUEST : SITUATION.RESTLESS, why }
}

// Deterministic per player, per season, per checkpoint. A reload replays to the same league.
export const rollFor = (seed, season, checkpoint, uid) => {
  const i = CHECKPOINTS.indexOf(checkpoint) + 1
  let h = 2166136261
  const s = `${uid}`
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) }
  return rng(((seed >>> 0) ^ Math.imul(h >>> 0, 2654435761) ^ (season * 7919) ^ (i * 104729)) >>> 0).rand()
}

/* ------------------------------------------------------- what it does to the market */

// The whole point. A situation does not change what a man is worth; it changes how willing
// his club is to hear you out. One rung, never two — a trade request makes a franchise player
// gettable for an overpay, not available at a discount.
// Spelled out rather than imported from trade/accept.js on purpose: accept.js imports THIS
// module to apply the shift, and a cycle between the two would evaluate this array before
// AVAILABILITY existed. The test asserts the two lists stay in step.
const LADDER = ['franchise', 'core', 'premium', 'available', 'shopping', 'dump']
export const LADDER_ORDER = LADDER
export const SHIFT = {
  [SITUATION.REQUEST]: 1,
  [SITUATION.STANDOFF]: 1,
  [SITUATION.RESTLESS]: 0,
  [SITUATION.COMMITTED]: -1,
  [SITUATION.CONTENT]: 0,
}

export function shiftLevel(level, situation) {
  const step = SHIFT[situation?.state] ?? 0
  if (!step) return level
  const i = LADDER.indexOf(level)
  if (i < 0) return level
  return LADDER[Math.max(0, Math.min(LADDER.length - 1, i + step))]
}

/* ------------------------------------------------------------------------ the store */
//
// Parallel to the league itself: the trade code reaches for this the way it reaches for
// rosters, and the app sets it from the save whenever the save changes.
let STORE = {}
export function setSituations(map) { STORE = map || {} }
export function allSituations() { return STORE }
export const keyOf = (p) => (p?.uid || p?.n || '')
export function situationOf(p) { return STORE[keyOf(p)] || null }

/* ------------------------------------------------------------------------ the wire */

const WHY_TEXT = {
  window: (n, t) => `${n} has told ${t} he does not want to spend the rest of his prime on a rebuild.`,
  role: (n, t) => `${n} is unhappy with his role in ${t} and has asked his agent to find a way out.`,
  shopped: (n, t) => `${n} knows ${t} shopped him and did not move him. He would like to be somewhere else.`,
  contract: (n, t) => `Extension talks between ${n} and ${t} have broken down. He is expected to play the year out.`,
}
const RESTLESS_TEXT = {
  window: (n, t) => `People around ${n} say he is frustrated with where ${t} are going.`,
  role: (n, t) => `${n} is said to be unhappy with his minutes in ${t}.`,
  shopped: (n, t) => `${n} is aware ${t} had him in trade talks.`,
  contract: (n, t) => `${n} and ${t} are not close on an extension.`,
}

export function wireLine(name, club, situation) {
  if (!situation) return null
  const t = club || 'his club'
  if (situation.state === SITUATION.REQUEST || situation.state === SITUATION.STANDOFF) {
    return (WHY_TEXT[situation.why] || WHY_TEXT.window)(name, t)
  }
  if (situation.state === SITUATION.RESTLESS) {
    return (RESTLESS_TEXT[situation.why] || RESTLESS_TEXT.window)(name, t)
  }
  if (situation.state === SITUATION.COMMITTED) return `${name} has committed his future to ${t}.`
  return null
}

/* -------------------------------------------------------- refusing, and what it costs */
//
// A trade request the user can ignore for free is a notification, not a decision. Refusing
// keeps the player and costs production for the rest of the year — he is not sulking in a
// cartoon sense, he is a professional who has stopped volunteering for the hard minutes — and
// he asks again in the summer, louder.
export const REFUSAL_PENALTY = 0.06
export const TALKDOWN_BASE = 0.45

// Talking him down: possible, not free, and less likely the angrier he is. Owner trust and a
// winning team both help, because both are reasons to believe you.
export function talkdownChance({ heat = 0.5, contention = 0.4, trust = 50 }) {
  const p = TALKDOWN_BASE - (heat - 0.5) * 0.55 + (contention - 0.4) * 0.35 + (trust - 50) / 320
  return Math.max(0.05, Math.min(0.85, p))
}

/* ----------------------------------------------------------------------- the sweep */
//
// One pass over the league at a checkpoint. Everything it needs — records, minutes, contracts
// — is already on the season and the rosters; the only thing it is told is what the user did
// (who he shopped), because nothing in the data remembers that.
export function sweep(state, {
  teams, rostersOf: rosters, talentOf, shopped = {}, seed = 0, season = 0,
  checkpoint = 'december', existing = {},
} = {}) {
  const out = { ...existing }
  // Three rankings of the whole league, so every percentile means the same thing on every
  // roster: talent, money and minutes. Talent is what he is; money and minutes are what the
  // league thinks he is, which is what "stature" means and what being shopped offends.
  const all = []
  for (const team of teams) for (const p of rosters(team)) all.push({ team, p, t: talentOf(p) })
  const pct = (key) => {
    const sorted = [...all].sort((a, b) => key(a) - key(b))
    const m = new Map()
    sorted.forEach((x, i) => m.set(keyOf(x.p), sorted.length > 1 ? i / (sorted.length - 1) : 0.5))
    return m
  }
  const qOf = pct((x) => x.t)
  const sqOf = pct((x) => x.p.s || 0)
  const mqOf = pct((x) => x.p.mpg || 0)
  all.sort((a, b) => a.t - b.t)

  for (const { team, p } of all) {
    const rec = state?.rec?.[team] || { w: 0, l: 0 }
    const gp = rec.w + rec.l
    const winPct = gp ? rec.w / gp : 0.5
    const uid = keyOf(p)
    // A man who already has a live situation keeps it — it resolves by being traded, by
    // being talked down, or by the summer, not by rolling again next month.
    if (out[uid] && out[uid].state !== SITUATION.CONTENT) continue
    const sh = shopped[uid] || {}
    const q = qOf.get(uid) ?? 0.5
    const facts = {
      age: p.a ?? 26,
      q,
      stature: Math.max(q, ((sqOf.get(uid) ?? 0.5) + (mqOf.get(uid) ?? 0.5)) / 2),
      winPct,
      mpg: p.mpg ?? 0,
      yr: p.yr ?? 3,
      shopped: sh.count || 0,
      shoppedUnmoved: !!sh.unmoved,
      extended: !!sh.extended,
    }
    const s = situationFor(facts, rollFor(seed, season, checkpoint, uid))
    if (s) out[uid] = { ...s, team, since: checkpoint, heat: heatOf(facts), name: p.n }
  }
  return out
}

// The summer clears the board: a man who asked out and was kept is angrier, not calmer, but
// the SEASON's stories end with the season. A request that survives the offseason comes back
// through the sweep in December on the same facts that caused it.
export function clearSeason(map = {}) {
  const out = {}
  for (const [k, v] of Object.entries(map)) {
    if (v?.state === SITUATION.COMMITTED) out[k] = v
  }
  return out
}
