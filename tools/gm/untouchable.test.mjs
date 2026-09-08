// NOBODY TRADES THEIR FRANCHISE PLAYER.
//
// FRANCHISE is the top rung of the availability ladder — "an overwhelming offer, or
// nothing". Four separate places each wrote that check as `level !== CORE`, which
// protected the forty-one core players in the league and let the three above them
// through. Walking the deadline inbox cold, San Antonio offered Victor Wembanyama and
// Tobias Harris for Shai Gilgeous-Alexander and the game graded it +$15.5M, the best
// deal on the board.
import { AVAILABILITY, availabilityOf, wontPartWith } from '../../src/lib/gm/trade/accept.js'
import { offersForUser, agenda } from '../../src/lib/gm/trade/agents.js'
import { SEED } from '../../src/lib/gm/seed.js'
import { newLeague, setLeague, allRosters } from '../../src/lib/gm/league.js'
import { newCareer } from '../../src/lib/gm/storage.js'
import { rng } from '../../src/lib/gm/sim.js'

setLeague(newLeague())
const R = allRosters()
const rostersOf = (t) => R[t] || []

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m) } }

// 1. The predicate itself.
ok(wontPartWith(AVAILABILITY.FRANCHISE), 'a franchise player is kept')
ok(wontPartWith(AVAILABILITY.CORE), 'a core player is kept')
for (const l of [AVAILABILITY.PREMIUM, AVAILABILITY.AVAILABLE,
  AVAILABILITY.SHOPPING, AVAILABILITY.DUMP]) {
  ok(!wontPartWith(l), `${l} is tradeable`)
}
// FRANCHISE must never be treated as a LOWER rung than CORE. This is the assertion that
// would have failed from the day the ladder was written.
ok(wontPartWith(AVAILABILITY.FRANCHISE) >= wontPartWith(AVAILABILITY.CORE),
  'franchise is protected at least as hard as core')

// 2. Who the league actually rates untouchable, and that they exist at all.
const kept = []
for (const t of Object.keys(SEED.teams)) {
  const r = rostersOf(t)
  if (!r?.length) continue
  for (const p of r) {
    const a = availabilityOf(p, t, { roster: r })
    if (a.level === AVAILABILITY.FRANCHISE) kept.push({ t, n: p.n })
  }
}
ok(kept.length > 0, 'somebody in the league is a franchise player')
ok(kept.length < 12, `franchise players are rare (${kept.length})`)

// 3. THE REGRESSION, exhaustively. Every club, every player it keeps.
//
//    Sampling generated offers was too thin a net — the shuffle decides how many appear,
//    and under the old semantics the run that produced the Wembanyama offer was one of
//    twenty-one. `agenda` is deterministic and covers all thirty rosters, so this asks
//    the question directly: does the front office KNOW it will not part with him?
// Anchored on the LADDER, not on the predicate. Asking `wontPartWith` who to check
// would make this test agree with any answer the predicate gave, including the wrong
// one — under the old semantics it simply stopped looking at the three men it should
// have been looking at hardest.
const KEEP_LEVELS = [AVAILABILITY.FRANCHISE, AVAILABILITY.CORE]
const isKept = (lvl) => KEEP_LEVELS.indexOf(lvl) >= 0
const bad = { listed: [], shopped: [], targeted: [] }
let players = 0
for (const team of Object.keys(SEED.teams)) {
  const roster = rostersOf(team)
  if (!roster.length) continue
  const plan = agenda(team, { ledger: {}, ranks: {}, year: parseInt(SEED.season, 10) })
  const idOf = (p) => p.uid || p.n
  const untouchable = new Set((plan.untouchable || []).map((x) => idOf(x.p)))
  const onBlock = new Set([...(plan.shopping || []), ...(plan.available || [])].map((x) => idOf(x.p)))
  for (const p of roster) {
    const a = availabilityOf(p, team, { roster })
    if (!isKept(a.level)) continue
    players++
    if (!untouchable.has(idOf(p))) bad.listed.push(`${team} ${p.n} (${a.level}) missing from its own untouchable list`)
    if (onBlock.has(idOf(p))) bad.shopped.push(`${team} ${p.n} (${a.level}) is on the block`)
  }
  // And nobody builds a plan around prising away a man his club keeps.
  for (const t of (plan.targets || [])) {
    const a = availabilityOf(t.p, t.from, { roster: rostersOf(t.from) })
    if (isKept(a.level)) bad.targeted.push(`${team} targets ${t.p.n} (${t.from}, ${a.level})`)
  }
}
ok(players > 0, `there are players clubs keep (${players})`)
ok(bad.listed.length === 0,
  `every kept man is on his club's untouchable list — ${bad.listed.length} missing`
  + (bad.listed.length ? `\n     e.g. ${bad.listed.slice(0, 3).join('\n          ')}` : ''))
ok(bad.shopped.length === 0,
  `no kept man is on the block — ${bad.shopped.length} found`
  + (bad.shopped.length ? `\n     e.g. ${bad.shopped.slice(0, 3).join('\n          ')}` : ''))
ok(bad.targeted.length === 0,
  `no club plans around a man it cannot get — ${bad.targeted.length} found`
  + (bad.targeted.length ? `\n     e.g. ${bad.targeted.slice(0, 3).join('\n          ')}` : ''))

// 4. And the generated offers themselves, as a second net.
const seen = { offers: 0, bad: [] }
for (let s = 0; s < 40; s++) {
  let save
  try { save = newCareer({ gm: { name: 'T' }, team: 'OKC', preset: 'guided' }) } catch { continue }
  if (!save) continue
  save.rngSeed = (1000 + s) >>> 0
  const r = rng((1000 + s) >>> 0)
  let offers = []
  try {
    offers = offersForUser(save, { r, ranks: {}, year: parseInt(SEED.season, 10), max: 4, intensity: 1 })
  } catch { continue }
  for (const o of offers) {
    seen.offers++
    for (const p of (o.deal?.out || [])) {
      const a = availabilityOf(p, o.team, { roster: rostersOf(o.team) })
      if (isKept(a.level)) seen.bad.push(`${o.team} offered ${p.n} (${a.level}: ${a.why})`)
    }
  }
}
ok(seen.bad.length === 0,
  `no club offers a man it keeps — ${seen.bad.length} violations in ${seen.offers} offers`
  + (seen.bad.length ? `\n     e.g. ${seen.bad.slice(0, 3).join('\n          ')}` : ''))

console.log(`\nuntouchable: ${pass}/${pass + fail}  (${players} kept men across 30 clubs, `
  + `${seen.offers} offers checked, ${kept.length} franchise: `
  + `${kept.map((x) => `${x.t} ${x.n}`).join(', ')})`)
process.exit(fail ? 1 : 0)
