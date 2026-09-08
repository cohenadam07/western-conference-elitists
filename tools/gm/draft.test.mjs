// Does the scouting department do anything?
//
// The claim the draft room makes is that who you hire changes what you see. That is only
// true if a specialist beats a generalist on his own patch, if a blind region really is
// close to a coin flip, and if the board you draft off is measurably better when your
// staff is better. These check exactly that, over enough drafts to mean something.
//
//   node tools/gm/draft.test.mjs
import { SEED } from '../../src/lib/gm/seed.js'
import { rng } from '../../src/lib/gm/sim.js'
import { generateClass, scoutWithStaff } from '../../src/lib/gm/draft.js'
import { enrich, scoutedProfile, report, gradeOf, ARCHETYPES } from '../../src/lib/gm/prospects.js'
import { makeScoutMarket, accuracyFor, coverage, payroll, REGIONS, REGION,
  SCOUT_BUDGET, describeScout } from '../../src/lib/gm/scouts.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const market = makeScoutMarket(4242, 30)
const classOf = (seed, n = 60) => { const r = rng(seed); return enrich(generateClass(r, n, 2027), r) }

// Spearman-ish: how well a board ordering predicts the real four-year outcome.
function boardQuality(board) {
  const byBoard = [...board].sort((a, b) => a.board - b.board)
  const n = byBoard.length
  const trueRank = new Map([...board].sort((a, b) => b._vorp4 - a._vorp4).map((p, i) => [p.id, i]))
  let num = 0, d1 = 0, d2 = 0
  const mb = (n - 1) / 2
  byBoard.forEach((p, i) => {
    const a = i - mb, b = trueRank.get(p.id) - mb
    num += a * b; d1 += a * a; d2 += b * b
  })
  return num / Math.sqrt(d1 * d2)
}

console.log('\n— the class —')
{
  const cls = classOf(11)
  check('every prospect has an origin, a school and measurements',
    cls.every((p) => p.region && p.school && p.height && p.wingspan && p.weight))
  check('every prospect has an archetype the league also uses',
    cls.every((p) => ARCHETYPES.includes(p.arch)))
  check('every prospect has a full skill profile',
    cls.every((p) => ['sh', 'gr', 'rp', 'pd', 'pm', 'sc', 'sz', 'rpr', 'bs']
      .every((k) => typeof p.skills[k] === 'number' && p.skills[k] >= 1 && p.skills[k] <= 99)))
  const regions = new Set(cls.map((p) => p.region))
  check('a class is drawn from across the world, not one league', regions.size >= 7,
    `${regions.size} regions`)
  const bigs = cls.filter((p) => p.pos === 'C')
  const guards = cls.filter((p) => p.pos === 'PG')
  check('centres are taller than point guards',
    bigs.length && guards.length
      && bigs.reduce((s, p) => s + p.heightIn, 0) / bigs.length
       > guards.reduce((s, p) => s + p.heightIn, 0) / guards.length + 4)
  // Skills have to track talent, or the profile is decoration.
  const top = cls.filter((p) => p._vorp4 > 3), bot = cls.filter((p) => p._vorp4 < 0.2)
  const avg = (xs) => xs.reduce((s, p) => s + Object.values(p.skills).reduce((a, b) => a + b, 0) / 9, 0) / xs.length
  check('better prospects have better skill profiles', avg(top) > avg(bot) + 5,
    `${avg(top).toFixed(0)} vs ${avg(bot).toFixed(0)}`)
}

console.log('\n— coverage changes what you see —')
{
  const cls = classOf(22)
  const euroScout = market.find((s) => s.regions.includes('euro'))
  const accScout = market.find((s) => s.regions.includes('acc') && !s.regions.includes('euro'))
  const euroProspect = cls.find((p) => p.region === 'euro')
  check('the market offers scouts for both college and abroad', !!euroScout && !!accScout)
  if (euroScout && accScout && euroProspect) {
    const withEuro = accuracyFor(euroProspect, [euroScout]).q
    const withACC = accuracyFor(euroProspect, [accScout]).q
    check('a Europe scout reads a European prospect better than a college scout does',
      withEuro > withACC + 0.08, `${withEuro.toFixed(2)} vs ${withACC.toFixed(2)}`)
    check('and the report says who filed it',
      accuracyFor(euroProspect, [euroScout]).by.name === euroScout.name)
  }
  const blind = accuracyFor(cls[0], []).q
  check('no department at all is close to a coin flip', blind <= 0.25, `${blind}`)
}

console.log('\n— the department shows up in the board —')
{
  // Two teams, same class, same luck: one with a department built for the class, one blind.
  const trials = 40
  let good = 0, bad = 0
  for (let i = 0; i < trials; i++) {
    const cls = classOf(500 + i, 60)
    // A department that covers the biggest slices of this class.
    const counts = {}
    for (const p of cls) counts[p.region] = (counts[p.region] || 0) + 1
    const wanted = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k)
    const staff = []
    for (const reg of wanted) {
      const s = market.find((m) => m.regions.includes(reg) && !staff.includes(m)
        && payroll(staff) + m.salary <= SCOUT_BUDGET)
      if (s) staff.push(s)
    }
    good += boardQuality(scoutWithStaff(cls, staff, rng(9000 + i)))
    bad += boardQuality(scoutWithStaff(cls, [], rng(9000 + i)))
  }
  const g = good / trials, b = bad / trials
  check('a real department produces a measurably better board', g > b + 0.08,
    `${g.toFixed(3)} with scouts vs ${b.toFixed(3)} blind`)
  check('and even a good board is nowhere near certain', g < 0.75, `${g.toFixed(3)}`)
  check('a blind board is still better than nothing', b > 0.05, `${b.toFixed(3)}`)
}

console.log('\n— workouts —')
{
  const cls = classOf(33)
  const p = cls[0]
  const staff = [market[0]]
  const before = accuracyFor(p, staff).q
  const after = accuracyFor(p, staff, { workouts: { [p.id]: 2 } }).q
  check('a workout sharpens your read on that prospect', after > before, `${before} -> ${after}`)
  const other = accuracyFor(cls[1], staff, { workouts: { [p.id]: 2 } }).q
  check('and only on that prospect', other === accuracyFor(cls[1], staff).q)
}

console.log('\n— the report is a report, not the answer key —')
{
  const cls = classOf(44)
  const staff = [market[0], market[1]]
  let leaked = 0, blindVaguer = 0, n = 0
  for (const p of cls.slice(0, 30)) {
    const r = rng(777 + n)
    const view = scoutedProfile(p, staff, r)
    const rep = report(p, view)
    n++
    // Nothing in a report may quote the hidden outcome.
    const text = JSON.stringify(rep)
    if (text.includes(String(p._vorp4)) || text.includes(String(p._u))) leaked++
    const blindView = scoutedProfile(p, [], r)
    if (/coin flip/i.test(report(p, blindView).projection || '')) blindVaguer++
  }
  check('a report never quotes the hidden outcome', leaked === 0, `${leaked} leaks`)
  check('with no department the report admits it is guessing', blindVaguer >= 25,
    `${blindVaguer} of 30`)
  const view = scoutedProfile(cls[0], staff, rng(5))
  const seen = Object.values(view.seen)
  check('the scouted profile differs from the truth', seen.some((v, i) => v !== Object.values(cls[0].skills)[i]))
  check('grades run from A+ down to C', gradeOf(1) === 'A+' && gradeOf(60) === 'C')
}

console.log(`\n${pass}/${pass + fail} draft checks pass`)
process.exit(fail ? 1 : 0)
