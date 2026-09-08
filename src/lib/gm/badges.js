// BADGES AND TENDENCIES.
//
// 2K's badges are the best idea in that game's presentation: they turn a wall of numbers
// into a sentence about what a player is good at. The version here earns them the same way
// the rest of this project earns everything — off the measured distribution. A badge is a
// PERCENTILE, not a hand-placed label, so "gold" means the same thing to every player in
// the league and it keeps meaning it after ten seasons of aging and drafting.
//
// Tendencies are the honest half. They are not a separate rating system: they are the rate
// stats the simulation ITSELF uses to decide what a player does with the ball — his
// three-point rate, his usage, his assist rate, his free-throw rate. When the card says a
// player shoots a lot of threes, that is the number the possession engine reads.
import { SEED } from './seed.js'
import { allRosters, allSim } from './league.js'

/* ------------------------------------------------------------------- tiers */

// 2K's four tiers. The cuts are per AXIS, but what matters to a player looking at a card is
// how rare the badge is across the whole league — and with ten axes, a 99th-percentile cut
// put a Hall of Fame badge on one rotation player in six, which makes the top tier mean
// nothing. Tightened until the tiers are rare in the way their names claim: about one
// player in twenty holds a Hall of Fame badge on anything.
export const TIERS = [
  { key: 'hof', label: 'Hall of Fame', pct: 0.995, rank: 4 },
  { key: 'gold', label: 'Gold', pct: 0.97, rank: 3 },
  { key: 'silver', label: 'Silver', pct: 0.91, rank: 2 },
  { key: 'bronze', label: 'Bronze', pct: 0.80, rank: 1 },
]

// Every badge names the axis it is earned on, so a player can always ask why.
export const BADGES = [
  { id: 'deadeye', name: 'Deadeye', field: 'sh', of: 'shooting',
    blurb: 'Makes the shot when it is there. Catch-and-shoot volume is the cheapest offence in basketball.' },
  { id: 'gravity', name: 'Gravity', field: 'gr', of: 'off-ball attention',
    blurb: 'Defences move toward him without the ball. The fit model rates this above shooting itself — it is the single largest coefficient in the whole thing.' },
  { id: 'creator', name: 'Shot Creator', field: 'sc', of: 'self creation',
    blurb: 'Gets his own look when the offence stalls. This is what separates a starter from a bench scorer.' },
  { id: 'general', name: 'Floor General', field: 'pm', of: 'playmaking',
    blurb: 'Sees the next pass early and makes it on time.' },
  { id: 'safehands', name: 'Safe Hands', field: 'bs', of: 'ball security',
    blurb: 'Does not give the ball away under pressure. Worth about as much as rim protection in the fit model.' },
  { id: 'downhill', name: 'Downhill', field: 'rpr', of: 'rim pressure',
    blurb: 'Lives at the rim and the free-throw line.' },
  { id: 'anchor', name: 'Rim Anchor', field: 'rp', of: 'rim protection',
    blurb: 'Deters shots at the basket on his own, which is what lets a scheme take risks anywhere else.' },
  { id: 'poa', name: 'Point of Attack', field: 'pd', of: 'perimeter defence',
    blurb: 'Guards the ball. Cannot be hidden, cannot be hunted.' },
  { id: 'frame', name: 'Frame', field: 'sz', of: 'size',
    blurb: 'Real NBA size for the position he plays.' },
  { id: 'iron', name: 'Iron', field: 'av', of: 'availability',
    blurb: 'Plays. The most underrated ability in the sport is the one where you are on the floor.' },
]

/* ------------------------------------------------- the league's own scale */

// Percentile cuts, computed from the league in the save rather than from a constant. A
// badge means "better than this share of the league THIS season" and it keeps meaning that
// as the league changes underneath it.
let CACHE = null
export function scale(rosters) {
  const source = rosters || allRosters()
  const key = Object.keys(source).length
  if (CACHE && CACHE.key === key && CACHE.source === source) return CACHE.cuts
  const cols = {}
  for (const b of BADGES) cols[b.field] = []
  for (const team of Object.keys(source)) {
    for (const p of source[team]) {
      // Rotation players only. Including every fifteenth man drags the cuts down until a
      // bronze badge means "not the worst player in the league", which is not a badge.
      if ((p.mpg ?? 0) < 12) continue
      for (const b of BADGES) {
        const v = p[b.field]
        if (typeof v === 'number') cols[b.field].push(v)
      }
    }
  }
  const cuts = {}
  for (const [field, arr] of Object.entries(cols)) {
    arr.sort((a, b) => a - b)
    cuts[field] = {}
    for (const t of TIERS) {
      cuts[field][t.key] = arr.length
        ? arr[Math.min(arr.length - 1, Math.floor(t.pct * (arr.length - 1)))]
        : Infinity
    }
    cuts[field].n = arr.length
  }
  CACHE = { key, source, cuts }
  return cuts
}
export const resetScale = () => { CACHE = null }

// What this player has earned.
export function badgesFor(player, rosters) {
  const cuts = scale(rosters)
  const out = []
  for (const b of BADGES) {
    const v = player[b.field]
    if (typeof v !== 'number') continue
    const c = cuts[b.field]
    if (!c) continue
    const tier = TIERS.find((t) => v >= c[t.key])
    if (tier) out.push({ ...b, tier: tier.key, tierLabel: tier.label, rank: tier.rank, value: Math.round(v) })
  }
  return out.sort((a, b) => b.rank - a.rank || b.value - a.value)
}

/* -------------------------------------------------------------- tendencies */

// These are the simulation's own inputs. `fg3r` is the share of a player's shots that are
// threes, `usg` is the share of his team's possessions he uses, and the possession engine
// reads both directly — so a tendency here is a promise the game keeps.
export const TENDENCIES = [
  { id: 'three', field: 'fg3r', name: 'Three-point rate',
    lo: 'rim-first', hi: 'lives behind the line',
    blurb: 'Share of his shots that come from three. The possession engine draws from this every time he shoots.' },
  { id: 'usage', field: 'usg', name: 'Usage',
    lo: 'plays off others', hi: 'first option',
    blurb: 'Share of the team’s possessions he finishes. Two high-usage players on one floor is the collision the fit model measures.' },
  { id: 'assist', field: 'ast', name: 'Assist rate',
    lo: 'finisher', hi: 'facilitator',
    blurb: 'How often a possession he touches ends in someone else scoring.' },
  { id: 'foul', field: 'ftr', name: 'Free-throw rate',
    lo: 'settles', hi: 'draws fouls',
    blurb: 'Free throws per shot. The cheapest points in the game and the hardest to defend.' },
  { id: 'crash', field: 'oreb', name: 'Offensive glass',
    lo: 'gets back', hi: 'crashes',
    blurb: 'Offensive rebound rate. Every crash is a second shot and a transition risk.' },
  { id: 'care', field: 'tov', name: 'Turnovers',
    lo: 'careful', hi: 'loose', invert: true,
    blurb: 'Turnovers per possession used.' },
]

let TCACHE = null
export function tendencyScale(sim) {
  const source = sim || allSim()
  if (TCACHE && TCACHE.source === source) return TCACHE.cuts
  const cols = {}
  for (const t of TENDENCIES) cols[t.field] = []
  for (const team of Object.keys(source)) {
    for (const p of source[team]) {
      if ((p.mpg ?? 0) < 12) continue
      for (const t of TENDENCIES) {
        const v = p[t.field]
        if (typeof v === 'number') cols[t.field].push(v)
      }
    }
  }
  const cuts = {}
  for (const [f, arr] of Object.entries(cols)) {
    arr.sort((a, b) => a - b)
    cuts[f] = arr
  }
  TCACHE = { source, cuts }
  return cuts
}
export const resetTendencyScale = () => { TCACHE = null }

const pctOf = (arr, v) => {
  if (!arr || !arr.length) return 0.5
  let lo = 0, hi = arr.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m }
  return lo / arr.length
}

// A player's tendencies as league percentiles, with the raw rate kept so the number behind
// the bar is always visible.
export function tendenciesFor(simPlayer, sim) {
  if (!simPlayer) return []
  const cuts = tendencyScale(sim)
  return TENDENCIES.map((t) => {
    const v = simPlayer[t.field]
    if (typeof v !== 'number') return null
    const pct = pctOf(cuts[t.field], v)
    return {
      ...t,
      value: v,
      pct,
      label: pct >= 0.75 ? t.hi : pct <= 0.25 ? t.lo : 'balanced',
      display: t.field === 'usg' || t.field === 'fg3r' || t.field === 'ast'
        || t.field === 'oreb' || t.field === 'tov' || t.field === 'ftr'
        ? `${(v * 100).toFixed(1)}%` : v.toFixed(2),
    }
  }).filter(Boolean)
}

// One sentence for a scouting report or a roster row.
export function describePlayer(player, simPlayer, rosters, sim) {
  const b = badgesFor(player, rosters).slice(0, 2)
  const t = tendenciesFor(simPlayer, sim).filter((x) => x.pct >= 0.8 || x.pct <= 0.2)
  const bits = []
  if (b.length) bits.push(b.map((x) => `${x.tierLabel} ${x.name}`).join(', '))
  if (t.length) bits.push(t.slice(0, 2).map((x) => x.label).join(', '))
  return bits.join(' · ') || 'a rotation player'
}
