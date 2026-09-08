// THE PLAYER PAGE.
//
// The Savant page for a player, in the game's own clothes. Everything here already exists
// somewhere — the cap sheet's skill ratings, the possession engine's rate stats, the fit
// model, the market — and the point of the page is that a general manager can see all of
// it about one man in one place, from wherever he happened to click.
//
// Percentiles are against the LEAGUE'S ROTATION, not against everybody on a cap sheet.
// Including twelfth men drags every distribution down and hands ordinary starters
// eightieth percentiles, which reads as flattery and is useless for comparing two players.
import { SEED } from './seed.js'
import { rostersOf, simOf } from './league.js'
import { playerMarketValue, projection, talentVorp } from './trade/market.js'
import { badgesFor } from './badges.js'

const ROTATION_MPG = 12

// One pass over the league, cached. Rebuilt when the league is replaced, which the version
// counter in league.js already signals by identity.
let CACHE = null
let CACHE_KEY = null

function league() {
  const key = Object.keys(SEED.teams).map((t) => rostersOf(t).length).join(',')
  if (CACHE && CACHE_KEY === key) return CACHE
  const rows = []
  for (const team of Object.keys(SEED.teams)) {
    const sims = simOf(team)
    for (const c of rostersOf(team)) {
      const s = sims.find((x) => x.n === c.n) || null
      if ((s?.mpg ?? c.mpg ?? 0) < ROTATION_MPG) continue
      rows.push({ team, cap: c, sim: s })
    }
  }
  CACHE = rows
  CACHE_KEY = key
  return rows
}

export const rotationSize = () => league().length

// Where a value sits in the league's rotation, 0-100. Higher is better unless the metric
// says otherwise — turnovers are the obvious one, and getting that backwards would praise
// a player for the thing he is worst at.
export function percentile(metric, value, lowerIsBetter = false) {
  if (value === undefined || value === null || Number.isNaN(value)) return null
  const vals = league().map(metric).filter((v) => typeof v === 'number' && !Number.isNaN(v))
  if (vals.length < 8) return null
  const below = vals.filter((v) => (lowerIsBetter ? v > value : v < value)).length
  return Math.round((below / vals.length) * 100)
}

const capOf = (r) => r.cap
const simOfRow = (r) => r.sim || {}

// The three columns the real page uses, built from what this game actually measures. Each
// row carries the raw number AND the percentile, because a percentile with no number behind
// it is a rating, and this game does not do ratings.
export function savantRows(cap, sim) {
  const num = (v, d = 0) => (typeof v === 'number' ? v.toFixed(d) : '—')
  const pctStr = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

  const offense = [
    { k: 'Scoring', v: num(cap.sc), p: percentile((r) => capOf(r).sc, cap.sc),
      why: 'Shot creation and finishing, on the cap sheet’s own 0-100 scale.' },
    { k: 'Shooting', v: num(cap.sh), p: percentile((r) => capOf(r).sh, cap.sh),
      why: 'Jump shooting, weighted toward volume from three.' },
    { k: 'Gravity', v: num(cap.gr), p: percentile((r) => capOf(r).gr, cap.gr),
      why: 'How much a defence has to account for him away from the ball. The largest single '
        + 'coefficient in the fit model, at 1.60.' },
    { k: 'Playmaking', v: num(cap.pm), p: percentile((r) => capOf(r).pm, cap.pm),
      why: 'Creating for others, not just passing.' },
    { k: 'Rim pressure', v: num(cap.rpr), p: percentile((r) => capOf(r).rpr, cap.rpr),
      why: 'Getting downhill and drawing the second defender.' },
    { k: 'Ball security', v: num(cap.bs), p: percentile((r) => capOf(r).bs, cap.bs),
      why: 'The inverse of giving it away. Weighted 1.03 in the fit model.' },
    { k: 'Usage', v: pctStr(sim?.usg), p: percentile((r) => simOfRow(r).usg, sim?.usg),
      why: 'Share of possessions he finishes while on the floor. Not a good or a bad thing on '
        + 'its own — it is what everything else has to be read against.' },
    { k: 'Three-point rate', v: pctStr(sim?.fg3r), p: percentile((r) => simOfRow(r).fg3r, sim?.fg3r),
      why: 'Share of his shots taken from three.' },
    { k: 'Three-point %', v: pctStr(sim?.fg3), p: percentile((r) => simOfRow(r).fg3, sim?.fg3),
      why: 'The rate the possession engine actually rolls against.' },
    { k: 'Two-point %', v: pctStr(sim?.fg2), p: percentile((r) => simOfRow(r).fg2, sim?.fg2) },
    { k: 'Free-throw rate', v: pctStr(sim?.ftr), p: percentile((r) => simOfRow(r).ftr, sim?.ftr) },
    { k: 'Assist rate', v: pctStr(sim?.ast), p: percentile((r) => simOfRow(r).ast, sim?.ast) },
    { k: 'Turnover rate', v: pctStr(sim?.tov), p: percentile((r) => simOfRow(r).tov, sim?.tov, true),
      why: 'Lower is better, and the percentile is scored that way.' },
  ]

  const defense = [
    { k: 'Point-of-attack', v: num(cap.pd), p: percentile((r) => capOf(r).pd, cap.pd),
      why: 'Staying in front of his man. Weighted 1.15 in the fit model.' },
    { k: 'Rim protection', v: num(cap.rp), p: percentile((r) => capOf(r).rp, cap.rp),
      why: 'What happens at the basket when he is the last line. Weighted 0.99.' },
    { k: 'Event creation', v: num(sim?.de, 1), p: percentile((r) => simOfRow(r).de, sim?.de),
      why: 'Steals and deflections — the engine reads this when it decides whether a '
        + 'possession ends in a turnover.' },
    { k: 'Defensive rebounding', v: pctStr(sim?.dreb), p: percentile((r) => simOfRow(r).dreb, sim?.dreb) },
    { k: 'Offensive rebounding', v: pctStr(sim?.oreb), p: percentile((r) => simOfRow(r).oreb, sim?.oreb) },
    { k: 'Size', v: num(cap.sz, 1), p: percentile((r) => capOf(r).sz, cap.sz),
      why: 'Measured, and worth almost nothing at team level — the ridge put it at 0.005. '
        + 'Shown because it is real, not because it wins games.' },
  ]

  const mv = playerMarketValue(cap)
  const value = [
    { k: 'VORP', v: num(cap.v, 2), p: percentile((r) => capOf(r).v, cap.v),
      why: 'Value over replacement, the currency everything in this game is priced in.' },
    { k: 'Box plus/minus', v: num(cap.bpm, 1), p: percentile((r) => capOf(r).bpm, cap.bpm) },
    { k: 'Minutes', v: num(sim?.mpg ?? cap.mpg, 1), p: percentile((r) => simOfRow(r).mpg ?? capOf(r).mpg, sim?.mpg ?? cap.mpg) },
    { k: 'Availability', v: typeof cap.av === 'number' ? `${Math.round(cap.av)}%` : '—',
      p: percentile((r) => capOf(r).av, cap.av),
      why: 'Share of last season he was actually able to play. The rotation budgets minutes '
        + 'from it and it is a skill, not luck.' },
  ]

  return { offense, defense, value, market: mv }
}

// Nearest players in the league by the skill vector — the same axes the fit model reads, so
// a comp is somebody who would do a similar job rather than somebody with similar counting
// stats. Distance is standardised, otherwise size (a 0-100 scale with a wide spread) would
// dominate every comparison.
// WHO HE PLAYS LIKE.
//
// This used to be computed here, as a standardised distance across nine cap-sheet axes, and
// it read badly — the axes are a coarse summary of a player and nine of them is not enough
// dimensions to tell two big men apart. Savant already publishes comps for every player,
// computed against far more than nine axes and against the same league, and they are the ones
// on the website. So the page shows those instead of a second, worse opinion.
//
// Where Savant has none — a rookie, a two-way conversion, anyone who has not played — there
// is no comp, and the section says so rather than inventing one out of a placeholder profile.
// A comparison nobody would make is worse than no comparison.
export function compsFor(cap, n = 3) {
  const raw = Array.isArray(cap?.comps) ? cap.comps : null
  if (!raw || !raw.length) return []
  const rows = league()
  const byName = new Map(rows.map((r) => [r.cap.n, r]))
  return raw.slice(0, n).map((c) => {
    const hit = byName.get(c.n)
    return {
      name: c.n,
      // The team on the comp is the team he played for when Savant computed it; if he is in
      // this league now, say where he is now, because a career moves people.
      team: hit ? hit.team : c.t,
      cap: hit ? hit.cap : null,
      similarity: Math.round(c.s ?? 0),
      inLeague: !!hit,
    }
  })
}

// One call for the page.
export function savantProfile(cap, sim, team) {
  if (!cap) return null
  const rows = savantRows(cap, sim)
  return {
    cap,
    sim,
    team,
    badges: badgesFor(cap),
    ...rows,
    comps: compsFor(cap),
    // Five years of what the projection model thinks, which is the thing a trade is
    // actually about — not what he is, what he will be while you have him.
    projection: projection(cap, 5),
    talent: talentVorp(cap),
  }
}

// Find a player anywhere in the league by name or uid, so a click from any screen resolves.
export function findPlayer(idOrName) {
  if (!idOrName) return null
  for (const team of Object.keys(SEED.teams)) {
    const cap = rostersOf(team).find((p) => (p.uid || p.n) === idOrName || p.n === idOrName)
    if (cap) return { cap, sim: simOf(team).find((x) => x.n === cap.n) || null, team }
  }
  return null
}
