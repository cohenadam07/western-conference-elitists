// THE SCOUTING DEPARTMENT.
//
// A draft board is not a fact, it is an opinion assembled by people you hired. This module
// is those people: a market of scouts, each with a region he actually covers, a type of
// prospect he reads best, and an axis of the game he sees more clearly than the rest.
//
// The accuracy numbers are anchored, not invented. Running the trajectory model's
// leave-one-draft-out predictions against real outcomes for 479 drafted prospects gives a
// correlation of +0.537 — better than the actual NBA draft order's +0.497. So 0.54 is what
// "we did the work and we were right" looks like, and the numbers below sit around it:
// nobody in this game gets to be certain, because nobody in the real one does.
import { SEED } from './seed.js'
import { rng } from './sim.js'

const D = SEED.draft

/* ------------------------------------------------------------------ regions */

// Where prospects come from, and how much of a class each supplies. Shares are roughly the
// real distribution of drafted players by origin.
export const REGIONS = [
  { key: 'acc', label: 'ACC', group: 'NCAA', share: 0.11 },
  { key: 'sec', label: 'SEC', group: 'NCAA', share: 0.13 },
  { key: 'b1g', label: 'Big Ten', group: 'NCAA', share: 0.11 },
  { key: 'b12', label: 'Big 12', group: 'NCAA', share: 0.11 },
  { key: 'bigeast', label: 'Big East', group: 'NCAA', share: 0.06 },
  { key: 'midmajor', label: 'mid-major college', group: 'NCAA', share: 0.13 },
  { key: 'euro', label: 'EuroLeague', group: 'International', share: 0.12 },
  { key: 'euro2', label: 'second-division Europe', group: 'International', share: 0.07 },
  { key: 'nbl', label: 'Australia / NBL', group: 'International', share: 0.04 },
  { key: 'africa', label: 'Africa / BAL', group: 'International', share: 0.03 },
  { key: 'latam', label: 'South America', group: 'International', share: 0.02 },
  { key: 'gleague', label: 'G League', group: 'Domestic', share: 0.04 },
  { key: 'prep', label: 'prep and post-grad', group: 'Domestic', share: 0.03 },
]
export const REGION = Object.fromEntries(REGIONS.map((r) => [r.key, r]))

// What a scout is FOR. A department of five generalists sees everything badly.
export const LEANS = [
  { key: 'project', label: 'projects and long-term bets',
    blurb: 'Reads teenagers and raw tools. Wants to know what a player becomes, not what he is.' },
  { key: 'ready', label: 'ready-made contributors',
    blurb: 'Reads production and translation. Wants to know who can play in October.' },
]
export const AXES = [
  { key: 'shooting', label: 'shooting and spacing', fields: ['sh', 'gr'] },
  { key: 'defence', label: 'defence', fields: ['pd', 'rp'] },
  { key: 'athleticism', label: 'athleticism and tools', fields: ['rpr', 'sz'] },
  { key: 'feel', label: 'feel and decision-making', fields: ['pm', 'bs'] },
]

/* ------------------------------------------------------------------ the market */

const FIRST = ['Dana', 'Marcus', 'Yusuf', 'Rob', 'Elena', 'Terry', 'Goran', 'Amaka', 'Pete',
  'Sasha', 'Curtis', 'Mireille', 'Duane', 'Tomas', 'Nia', 'Bill', 'Rasheed', 'Ivo', 'Grace',
  'Hank', 'Diego', 'Femi', 'Lenny', 'Aiko', 'Vince', 'Rui', 'Charlotte', 'Ben']
const LAST = ['Whitcomb', 'Ferraro', 'Adeyemi', 'Salas', 'Kovac', 'Brennan', 'Nkemdi',
  'Lindholm', 'Guerrero', 'Pashkov', 'Osei', 'Duval', 'McAllister', 'Bianchi', 'Radic',
  'Okafor', 'Sundberg', 'Reyes', 'Halstead', 'Tanaka', 'Mbaye', 'Corrigan', 'Vasquez']

// A scout's accuracy INSIDE his specialty against outside it. Experience raises both, but
// the gap is what makes hiring a decision rather than a formality.
function accuracyOf(exp, star) {
  // Calibrated so the whole range brackets the measured 0.537 rather than blowing past it.
  // A good scout inside his own region is roughly as reliable as the model; outside it he
  // is guessing along with everyone else, and that gap is the reason to hire deliberately.
  const inside = 0.38 + exp * 0.005 + star * 0.09      // ~0.40 to ~0.58
  return {
    inside: Math.min(0.58, Math.round(inside * 1000) / 1000),
    outside: Math.round(Math.max(0.24, inside - 0.18 - star * 0.02) * 1000) / 1000,
  }
}

export function makeScoutMarket(seed, n = 14) {
  const r = rng((seed ^ 0x5c07) >>> 0)
  const out = []
  const usedNames = new Set()
  for (let i = 0; i < n; i++) {
    let name
    do { name = `${FIRST[r.randrange(FIRST.length)]} ${LAST[r.randrange(LAST.length)]}` }
    while (usedNames.has(name))
    usedNames.add(name)

    const exp = 2 + r.randrange(20)
    const star = r.rand()
    // One or two regions, and the pairing is not random: a European scout covers Europe,
    // not the SEC and the NBL.
    const primary = REGIONS[r.randrange(REGIONS.length)]
    const sameGroup = REGIONS.filter((x) => x.group === primary.group && x.key !== primary.key)
    const regions = [primary.key]
    if (r.rand() < 0.55 && sameGroup.length) regions.push(sameGroup[r.randrange(sameGroup.length)].key)

    const acc = accuracyOf(exp, star)
    // Real scouts are not paid like players. A department is a handful of people, which is
    // what makes covering the whole world a genuine budget problem.
    const salary = Math.round((90e3 + exp * 14e3 + star * 260e3) / 5e3) * 5e3
    out.push({
      id: `sc-${i}`,
      name,
      exp,
      regions,
      lean: LEANS[r.randrange(LEANS.length)].key,
      axis: AXES[r.randrange(AXES.length)].key,
      inside: acc.inside,
      outside: acc.outside,
      salary,
      reputation: star > 0.8 ? 'well regarded' : star > 0.5 ? 'solid' : 'unproven',
    })
  }
  return out.sort((a, b) => b.inside - a.inside)
}

export const describeScout = (s) => {
  const where = s.regions.map((k) => REGION[k].label).join(' and ')
  const lean = LEANS.find((l) => l.key === s.lean)
  const axis = AXES.find((a) => a.key === s.axis)
  return `${where} · ${lean.label} · reads ${axis.label} best`
}

/* --------------------------------------------------------------- coverage */

// How well your department sees ONE prospect. This is the whole point of hiring: a board
// is only as sharp as the people who watched the games.
export function accuracyFor(prospect, staff = [], opts = {}) {
  if (!staff.length) return { q: 0.22, by: null, covered: false, why: 'no scouting department' }

  let best = null
  for (const s of staff) {
    const inRegion = s.regions.includes(prospect.region)
    let q = inRegion ? s.inside : s.outside
    // A projects man on a 19-year-old, or a translation man on a 22-year-old producer,
    // is worth about as much as two years of experience.
    if (s.lean === prospect.type) q += 0.03
    if (!best || q > best.q) best = { q, by: s, inRegion }
  }
  // A second pair of eyes helps, with diminishing returns — this is why a department of
  // five specialists beats one great scout, but only just.
  const second = staff
    .filter((s) => s !== best.by && s.regions.includes(prospect.region))
    .length
  let q = best.q + Math.min(0.04, second * 0.02)

  // Workouts and interviews you paid for, on this specific prospect.
  const worked = opts.workouts?.[prospect.id] || 0
  q += Math.min(0.06, worked * 0.03)

  return {
    // No floor at "poor" — a department with nobody covering a league is genuinely worse
    // than the league-average front office, and should be.
    q: Math.max(0.2, Math.min(0.62, Math.round(q * 1000) / 1000)),
    by: best.by,
    covered: best.inRegion,
    workouts: worked,
    why: best.inRegion ? `${best.by.name} covers ${REGION[prospect.region].label}`
      : `nobody on staff covers ${REGION[prospect.region].label}`,
  }
}

// The department's coverage map, for the UI: which regions you actually see.
export function coverage(staff = []) {
  const map = {}
  for (const reg of REGIONS) {
    const on = staff.filter((s) => s.regions.includes(reg.key))
    map[reg.key] = {
      region: reg,
      scouts: on,
      level: on.length === 0 ? 'none' : on.length === 1 ? 'covered' : 'deep',
      best: on.reduce((b, s) => (!b || s.inside > b.inside ? s : b), null),
    }
  }
  return map
}

export const payroll = (staff = []) => staff.reduce((s, x) => s + x.salary, 0)
export const SCOUT_BUDGET = 2_400_000
