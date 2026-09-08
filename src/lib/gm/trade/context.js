// Team state and the roster model the fit measurements need.
//
// A team is not a label. It has a continuous position on two axes — how close it is to
// contending and how far its horizon reaches — and those emerge from the roster, the
// record, the cap sheet and the calendar rather than being typed in.
import { SEED } from '../seed.js'
import { rostersOf, league } from '../league.js'
import { teamSalary, status, CBA } from '../cap.js'
import { fitContribution } from './impact.js'

const F = SEED.fit
const TEAM_MINUTES = 240

// Three bands, because a rotation is not a ranked list — it is minutes at positions, and
// a fifth good centre cannot play. This is where positional redundancy comes from.
const BANDS = [
  { key: 'guard', lo: 0, hi: 2.5, minutes: 96 },
  { key: 'wing', lo: 2.5, hi: 3.5, minutes: 72 },
  { key: 'big', lo: 3.5, hi: 9, minutes: 72 },
]
export const bandOf = (p) => {
  const s = slotOf(p)
  return BANDS.find((b) => s >= b.lo && s < b.hi) || BANDS[1]
}

export function slotOf(p) {
  if (typeof p.slot === 'number') return p.slot
  const byPos = { PG: 1, SG: 2, SF: 3, PF: 4, C: 5 }
  return byPos[p.pos] ?? 3
}

// Quality per minute, for deciding who plays. VORP is a total, so it has to be divided
// back out by the minutes that produced it or the model hands the floor to whoever played
// most last season.
export function ratePerMin(p) {
  if (typeof p.bpm === 'number') return p.bpm
  const mp = Math.max(6, p.mpg || 12)
  return ((p.v ?? 0) * 48) / mp - 2
}

// Minutes allocation: within each positional band, the best available players get their
// expected role first until the band is full.
export function rotation(roster) {
  const out = []
  for (const band of BANDS) {
    const pool = roster.filter((p) => bandOf(p).key === band.key)
      .sort((a, b) => ratePerMin(b) - ratePerMin(a))
    let left = band.minutes
    for (const p of pool) {
      if (left <= 0) break
      const want = Math.max(6, Math.min(36, p.mpg || 14))
      const min = Math.min(want, left)
      left -= min
      out.push({ p, min })
    }
  }
  return out
}

/* --------------------------------------------------------------- the fit model */

// A roster's net rating is the sum of what its rotation contributes, minute by minute,
// using the same two-estimate blend the market layer values players with: the fit model's
// marginal net rating and box plus/minus, half each.
//
// Summing over an allocated rotation rather than averaging over a roster is what makes
// redundancy real. A fifth good centre gets no minutes, so he adds nothing; a wing on a
// team with no wings displaces someone bad, so he adds a lot.
// Calibrated, not guessed: across the 30 real rosters the raw sum has mean 2.192 and
// sd 4.230, and the 2025-26 league's actual net ratings have mean 0 and sd 6.14. Centring
// and rescaling puts predicted net on the same scale as the thing it predicts, which is
// what makes the win curve below mean anything.
const NET_CENTRE = 2.192
const NET_SCALE = 1.451

export function playerNet(p, minutes) {
  const min = minutes ?? Math.max(6, Math.min(36, p.mpg || 14))
  const fit = fitContribution(p, { minutes: min })
  const bpm = (typeof p.bpm === 'number' ? p.bpm : 0) * (min / 48)
  return (0.5 * fit + 0.5 * bpm)
}

export function fitNet(roster) {
  const rot = rotation(roster)
  let net = 0
  const parts = {}
  for (const { p, min } of rot) {
    const c = playerNet(p, min)
    net += c
    parts[p.uid || p.n] = c * NET_SCALE
  }
  return { net: (net - NET_CENTRE) * NET_SCALE, raw: net, parts,
    rotation: rot, minutes: rot.reduce((s, r) => s + r.min, 0) }
}

export const winsFromNet = (net) => 41 + net * (F.wins_per_net ?? 2.15)

// THE LEAGUE CAN ONLY WIN 1230 GAMES.
//
// The fit model rates each roster on its own, and nothing made the thirty ratings add up.
// They summed to +26 rather than to zero, so the average club projected at 42.9 wins instead
// of 41 and every team in the league looked about two wins better than it can possibly be.
// Small, and it compounds: ownership sets a target off the projection, so it was asking San
// Antonio for sixty-three wins in a league that will not produce sixty-three wins twice.
//
// Every win is somebody's loss. Centring the ratings is not a fudge, it is the constraint.
//
// Cached against the league object itself rather than a flag, so a trade — which replaces the
// rosters — recomputes it, and two careers open at once cannot share one club's centre.
let CENTRE_FOR = null
let CENTRE = 0
export function leagueCentre() {
  const l = league()
  if (CENTRE_FOR === l) return CENTRE
  const teams = Object.keys(l.rosters || {})
  if (!teams.length) return 0
  let sum = 0
  for (const t of teams) sum += fitNet(l.rosters[t] || []).net
  CENTRE_FOR = l
  CENTRE = sum / teams.length
  return CENTRE
}

// What this roster should actually win, against a league that has to add up.
export const projectedWins = (net) => winsFromNet(net - leagueCentre())

// What the roster is worth in wins, and what each skill area is costing or buying. The
// needs list is the same numbers, sorted — a deficit is a need by definition rather than
// by assertion.
// Where a roster is thin, measured against the league's own averages on the axes the fit
// model found to matter. A need is a deficit, not an assertion.
const SKILL_FIELD = {
  spacing: 'sh', gravity: 'gr', rimprot: 'rp', poa: 'pd',
  playmaking: 'pm', size: 'sz', rimpress: 'rpr', ballsec: 'bs',
}
export const NEED_LABEL = {
  spacing: 'three-point shooting', gravity: 'off-ball gravity', rimprot: 'rim protection',
  poa: 'point-of-attack defence', playmaking: 'playmaking', size: 'size',
  rimpress: 'rim pressure', ballsec: 'ball security',
}

export function teamProfile(roster) {
  const f = fitNet(roster)
  const rot = f.rotation
  const tot = rot.reduce((s, r) => s + r.min, 0) || 1
  const needs = []
  for (const [key, field] of Object.entries(SKILL_FIELD)) {
    const c = F.coef[key]
    if (c === undefined || c <= 0) continue      // only axes that measurably help a team
    let n = 0, d = 0
    for (const { p, min } of rot) {
      const v = p[field]
      if (v === undefined || v === null) continue
      n += min * v; d += min
    }
    if (!d) continue
    const x = n / d
    const z = (x - F.mean[key]) / (F.scale[key] || 1)
    needs.push({ key, label: NEED_LABEL[key] || key, value: Math.round(x), z, weight: c, gap: -z * c })
  }
  needs.sort((a, b) => b.gap - a.gap)
  // Positional supply: minutes committed per band against what a rotation needs.
  const band = {}
  for (const b of BANDS) band[b.key] = { need: b.minutes, have: 0, deep: 0 }
  for (const { p, min } of rot) band[bandOf(p).key].have += min
  for (const p of roster) {
    const b = band[bandOf(p).key]
    if (b) b.deep += 1
  }
  return { ...f, wins: projectedWins(f.net), needs, band }
}

/* -------------------------------------------------------------- strategic state */

const logistic = (x, mid, k) => 1 / (1 + Math.exp(-k * (x - mid)))

// Championship equity as a function of expected wins — the thing a contender is actually
// buying. Anchored on what real title odds look like: a 50-win team is a long shot, a
// 60-win team is a live contender, a 70-win team is a favourite and still not certain.
//   45 wins ~ 4%   55 ~ 16%   60 ~ 26%   65 ~ 40%   70 ~ 55%
export const titleOdds = (wins) => logistic(wins, 68, 0.13)
export const playoffOdds = (wins) => logistic(wins, 42.5, 0.34)

export function teamContext(team, { roster, seasonState, save, phase = 'offseason' } = {}) {
  const rs = roster || rostersOf(team)
  const prof = teamProfile(rs)
  const rec = seasonState?.rec?.[team]
  const played = rec ? rec.w + rec.l : 0
  // Once games exist, believe them — blended with the roster projection, more heavily as
  // the sample grows. In July the roster is all there is.
  const projWins = played > 0
    ? (prof.wins * Math.max(0, 1 - played / 45) + (rec.w / played) * 82 * Math.min(1, played / 45))
    : prof.wins

  const rot = prof.rotation
  const mins = rot.reduce((s, r) => s + r.min, 0) || 1
  const coreAge = rot.slice().sort((a, b) => b.min - a.min).slice(0, 5)
    .reduce((s, r, _, arr) => s + (r.p.a ?? 26) / arr.length, 0)
  const st = status(teamSalary(rs))

  const title = titleOdds(projWins)
  const playoff = playoffOdds(projWins)
  const contention = Math.max(0, Math.min(1, title * 0.55 + playoff * 0.45))
  const rebuild = Math.max(0, Math.min(1, (1 - playoff) * (coreAge < 26 ? 1 : 0.7)))
  // Urgency: how much this team should be paying for wins right now. Peaks for a good
  // team with an old core at the deadline.
  const stage = phase === 'deadline' ? 1 : phase === 'season' ? 0.6 : 0.35
  const urgency = Math.max(0, Math.min(1,
    contention * (0.45 + 0.55 * stage) * (1 + Math.max(0, coreAge - 28) * 0.06)))
  const futureOrientation = Math.max(0, Math.min(1, rebuild * 0.7 + (1 - contention) * 0.4))

  const mandate = save?.status?.mandate
  return {
    team, wins: projWins, net: prof.net, title, playoff,
    contention, rebuild, urgency, futureOrientation,
    coreAge, minutes: mins, cap: st, mandate, phase,
    profile: prof,
    label: contention > 0.62 ? (title > 0.25 ? 'dynasty contender' : 'contender')
      : contention > 0.42 ? 'playoff buyer'
        : contention > 0.28 ? 'fringe'
          : rebuild > 0.6 ? (coreAge < 25.5 ? 'early rebuild' : 'rebuilder')
            : 'retooling',
  }
}
