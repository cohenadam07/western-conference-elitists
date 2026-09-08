// GAME-DAY FORM.
//
// A young player with real upside is not a steadily good player yet. He is a player who
// scores thirty-one one night and goes two-for-eleven the next, and that swing IS the
// upside as anybody watching actually experiences it. A high-floor prospect is the
// opposite: less to dream on, far more reliable in October. Neither is captured by a
// season-long rating, because a rating is an average and the whole point is the spread
// around it.
//
// WHY THIS LIVES OUTSIDE THE ENGINE. `simulate()` must stay a pure function of the profiles
// it is handed: the server verifies a claimed season by replaying it against
// Basketball-Savant's Python engine, and the two agree draw for draw. Adding a random draw
// inside the possession loop would desynchronise them and every fixture would fail. So form
// is applied to the PROFILES on the way in — the season perturbs them, the engine plays
// them exactly as it always has, and the replay check is untouched.
import { rng } from './sim.js'

// TWO draws, not one, because a thirty-one-point night is mostly about how many shots a
// man took rather than how well he shot them. The first version moved efficiency and left
// volume almost alone, and measured against a control it changed a young player's
// game-to-game spread by nothing at all — the shot-count randomness already in the engine
// swamped a six-percent efficiency wobble. Usage is a SHARE, and the possession engine
// picks its shooter by weighting on it, so moving it moves the shots.
export const FORM_EFF_SD = 0.055
export const FORM_USG_SD = 0.20

// Youth penalties, applied to a prospect's projected self on the way in.
export const ROOKIE_DEF_PENALTY = 14      // rating points off both defensive axes at 19
export const ROOKIE_TOV_PENALTY = 0.35    // proportional turnover surcharge at 19

export function youthPenalty(age) {
  // Full at 19, gone by 24 — the shape of every "he finally figured out where to be" arc.
  const a = age ?? 22
  return Math.max(0, Math.min(1, (24 - a) / 5))
}

// How much this player swings from night to night. 1 is an ordinary rotation player.
export function volatilityFor(cap, sim) {
  const age = cap?.a ?? 26
  const youth = youthPenalty(age)
  // Upside is what a prospect could become; floor is how much of it he already is. A
  // drafted player carries both; anybody else is read off age and role.
  const upside = cap?.upside ?? null
  const floor = cap?.floor ?? null
  let v = 1 + youth * 0.55
  if (upside !== null) v += Math.max(0, upside - (floor ?? 0)) * 0.5 * (0.4 + youth * 0.6)
  if (floor !== null) v -= Math.min(0.45, floor * 0.35)
  // A high-usage player's night swings more than a spot-up big's, whatever his age.
  v *= 0.85 + (sim?.usg ?? 0.18) * 1.1
  return Math.max(0.55, Math.min(2.2, Math.round(v * 100) / 100))
}

// A stable per-player integer, so the same man in the same game always draws the same
// night — and the same season replays identically.
const idHash = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

// One player's night.
export function formFor(p, gameSeed) {
  const vol = p.vol ?? 1
  if (vol === 1 && !p.vol) return p
  const r = rng((gameSeed ^ idHash(p.id || p.n || 'x')) >>> 0)
  const eff = Math.max(0.68, Math.min(1.38, 1 + r.gauss(0, FORM_EFF_SD * vol)))
  const use = Math.max(0.55, Math.min(1.7, 1 + r.gauss(0, FORM_USG_SD * vol)))
  const out = { ...p }
  // Shooting swings; turnovers swing the other way; how much of the offence runs through
  // him swings hardest, and correlated with it — the nights he cannot miss are the nights
  // he keeps shooting. Defensive ratings do NOT move: a twenty-year-old's problem on that
  // end is knowing where to be, and that does not come and go by the evening.
  for (const k of ['fg3', 'fg2', 'ft']) {
    if (typeof out[k] === 'number') out[k] = Math.max(0.05, Math.min(0.95, out[k] * eff))
  }
  if (typeof out.tov === 'number') out.tov = Math.max(0.02, Math.min(0.30, out.tov / eff))
  if (typeof out.usg === 'number') {
    out.usg = Math.max(0.04, Math.min(0.45, out.usg * use * (1 + (eff - 1) * 0.5)))
  }
  return out
}

// A whole roster's night. Called by the season and the postseason; never by the engine.
export const withForm = (roster, gameSeed) =>
  (roster || []).map((p) => formFor(p, gameSeed))
