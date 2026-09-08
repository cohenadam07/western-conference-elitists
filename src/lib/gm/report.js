// The season report — the promise in section 1 of the design doc.
//
// "Lose a playoff series and you don't get bad luck. You get a report: your defence gave
// up 1.19 points per possession against the pick and roll because your drop-coverage big
// was on the floor 31 minutes a night against a pull-up shooter."
//
// Every claim here is traced back to a number the user can go and look at. Nothing is
// narrated that the model did not actually produce.
import { SEED } from './seed.js'
import { rostersOf, rosterOf } from './league.js'
import { TEAMS } from './season.js'

const pct = (xs, x) => {
  const s = [...xs].sort((a, b) => a - b)
  let n = 0
  for (const v of s) if (v < x) n++
  return Math.round((100 * n) / Math.max(1, s.length))
}

// Minutes-weighted team skill, from the same skill vectors the archetypes were built on.
function teamSkill(capRoster, key) {
  let num = 0, den = 0
  for (const p of capRoster) {
    const v = p[key]
    if (v === undefined || v === null) continue
    const w = Math.max(1, p.mpg || 12)
    num += w * v; den += w
  }
  return den ? num / den : null
}

const SKILLS = [
  ['gr', 'off-ball gravity', 'offence'],
  ['sh', 'three-point shooting', 'offence'],
  ['sc', 'shot creation', 'offence'],
  ['pm', 'playmaking', 'offence'],
  ['rp', 'rim protection', 'defence'],
  ['pd', 'perimeter defence', 'defence'],
]

// "3th percentile" is the kind of detail that makes a good report look automated.
const ordinal = (n) => {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
}

export function seasonReport(save, seasonState, run) {
  const mine = save.franchise.team
  const roster = rosterOf(save)
  const rec = seasonState.rec[mine]
  const gp = rec.w + rec.l || 1
  const ortg = (100 * rec.pf) / (gp * 98.7)
  const drtg = (100 * rec.pa) / (gp * 98.7)

  const leagueO = TEAMS.map((t) => {
    const r = seasonState.rec[t], g = r.w + r.l || 1
    return (100 * r.pf) / (g * 98.7)
  })
  const leagueD = TEAMS.map((t) => {
    const r = seasonState.rec[t], g = r.w + r.l || 1
    return (100 * r.pa) / (g * 98.7)
  })

  // League skill distributions come from the seed rosters — the other 29 teams as built.
  const lines = []
  for (const [key, label, side] of SKILLS) {
    const mineV = teamSkill(roster, key)
    if (mineV === null) continue
    const others = TEAMS.filter((t) => t !== mine)
      .map((t) => teamSkill(rostersOf(t), key))
      .filter((v) => v !== null)
    if (others.length < 10) continue
    lines.push({ key, label, side, value: Math.round(mineV), rank: pct(others, mineV) })
  }
  lines.sort((a, b) => b.rank - a.rank)

  const best = lines.filter((l) => l.rank >= 60).slice(0, 2)
  const worst = lines.filter((l) => l.rank <= 40).slice(-2).reverse()

  const netRank = pct(TEAMS.map((t) => {
    const r = seasonState.rec[t], g = r.w + r.l || 1
    return (100 * (r.pf - r.pa)) / (g * 98.7)
  }), ortg - drtg)

  // The verdict is built from what actually happened, not from a template.
  const verdict = []
  if (run?.champion) verdict.push('You won it.')
  else if (run?.confTitle) verdict.push('You reached the Finals and lost.')
  else if (run?.made) verdict.push(`You made the field and won ${run.seriesWon} series.`)
  else verdict.push('You missed the postseason.')

  // "What carried you" is wrong on a 17-win team. A strength on a bad roster is a
  // strength, not a reason anything went well.
  const good = rec.w >= 41
  if (best.length)
    verdict.push(good
      ? `What carried you was ${best.map((b) => b.label).join(' and ')} — ` +
        `${ordinal(best[0].rank)} percentile in the league.`
      : `Your best trait was ${best.map((b) => b.label).join(' and ')} — ` +
        `${ordinal(best[0].rank)} percentile. Build around it.`)
  if (worst.length)
    verdict.push(`${good ? 'What cost you was' : 'The hole is'} ` +
      `${worst.map((w) => w.label).join(' and ')} — ` +
      `${ordinal(worst[0].rank)} percentile.`)

  const target = SEED.mandates[save.status.mandate]?.target ?? 44
  verdict.push(rec.w >= target
    ? `Ownership asked for ${target} wins and you delivered ${rec.w}.`
    : `Ownership asked for ${target} wins. You won ${rec.w}.`)

  return {
    record: `${rec.w}–${rec.l}`,
    ortg: Math.round(ortg * 10) / 10,
    drtg: Math.round(drtg * 10) / 10,
    net: Math.round((ortg - drtg) * 10) / 10,
    ortgRank: 30 - Math.round((pct(leagueO, ortg) / 100) * 29),
    drtgRank: Math.round((pct(leagueD, drtg) / 100) * 29) + 1,
    netRank: 30 - Math.round((netRank / 100) * 29),
    lines, best, worst, verdict,
  }
}
