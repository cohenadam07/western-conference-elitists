// Badges, tendencies, modes, lessons and the rotation.
//
// These are the parts of the game meant to teach somebody what a front office actually
// does, so the thing that must not rot is the honesty: a badge has to mean a percentile,
// a tendency has to be the number the simulation reads, a mode has to change the job, and
// a lesson has to appear once and stay gone.
//
//   node tools/gm/teach.test.mjs
import { SEED } from '../../src/lib/gm/seed.js'
import { setLeague, newLeague, allRosters, allSim, rostersOf, simOf, playableSim } from '../../src/lib/gm/league.js'
import { badgesFor, tendenciesFor, scale, BADGES, TIERS, resetScale } from '../../src/lib/gm/badges.js'
import { MODES, MODE, modeOf, controls } from '../../src/lib/gm/modes.js'
import { LESSONS, LESSON, DEPTH, nextLesson, learn, seen, glossary } from '../../src/lib/gm/lessons.js'
import { autoRotation, checkRotation, sustainable, strain, applyRotation, accumulateWear,
  availabilityNow, applyWear, wornDown, TEAM_MINUTES } from '../../src/lib/gm/rotation.js'
import { applyPractice, ageWeight } from '../../src/lib/gm/offseason.js'
import { bandOf, ratePerMin } from '../../src/lib/gm/trade/context.js'

setLeague(newLeague())
let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const find = (n) => { for (const t of Object.keys(SEED.teams)) { const p = rostersOf(t).find((x) => x.n === n); if (p) return { t, p } } return null }

/* --------------------------------- what a new general manager is taught FIRST */
{
  // The apron lesson used to be pushed to the front of the queue whenever the club was over
  // it — a fact about the roster you were handed, not about what you are ready to read. So a
  // brand new GM's first screen, before he had seen a single player, opened with the second
  // apron: sign-and-trades, salary aggregation, and a first-round pick seven years out
  // freezing. The hardest idea in the game, delivered first, because his team was expensive.
  const fresh = { learned: {} }
  check('the first screen teaches what the screen is about, not the fine print',
    nextLesson(fresh, ['apron', 'mandate'])?.id === 'mandate',
    nextLesson(fresh, ['apron', 'mandate'])?.id)
  check('and the fine print follows once the basics are read',
    nextLesson({ learned: { mandate: 1 } }, ['apron', 'mandate'])?.id === 'apron')
  check('the trade desk still leads with what a trade is worth',
    nextLesson(fresh, ['apron', 'value', 'matching'])?.id === 'value')
  // Every lesson has to have a depth, or it silently defaults and the ordering is a guess.
  const noDepth = Object.keys(LESSON).filter((id) => DEPTH[id] === undefined)
  check('every lesson has a depth', noDepth.length === 0, noDepth.join(', '))
  // Depth is a small ordinal, not an arbitrary number.
  check('depths are 1, 2 or 3',
    Object.values(DEPTH).every((d) => d >= 1 && d <= 3))
  // Nothing is read twice.
  check('a lesson already read is not offered again',
    nextLesson({ learned: { mandate: 1, apron: 1 } }, ['apron', 'mandate']) === null)
  check('an empty queue teaches nothing', nextLesson(fresh, []) === null)
}

console.log('\n— everyone is on the floor —')
{
  // The bug this whole turn started from: profiles keyed to last season's team, spelled
  // without the accents the cap sheet uses.
  let unplayable = 0, worst = null
  for (const t of Object.keys(SEED.teams)) {
    const names = new Set(playableSim(t).map((p) => p.n))
    for (const c of rostersOf(t)) {
      if (!names.has(c.n)) { unplayable++; if (!worst || (c.mpg ?? 0) > (worst.mpg ?? 0)) worst = c }
    }
  }
  check('every player under contract can actually play', unplayable === 0,
    worst ? `${unplayable} cannot, worst is ${worst.n}` : '')
  const jok = find('Nikola Jokić') || find('Nikola Jokic')
  check('and that includes the best player in the league',
    !!jok && playableSim(jok.t).some((p) => p.n === jok.p.n), 'Jokic is not on his own team’s floor')
  const sizes = Object.keys(SEED.teams).map((t) => playableSim(t).length)
  check('every team can field a rotation', Math.min(...sizes) >= 9, `smallest is ${Math.min(...sizes)}`)
}

console.log('\n— badges are percentiles —')
{
  const cuts = scale()
  check('cuts are computed from the league, not typed in',
    cuts.sh && cuts.sh.n > 200 && cuts.sh.hof > cuts.sh.gold
      && cuts.sh.gold > cuts.sh.silver && cuts.sh.silver > cuts.sh.bronze,
    JSON.stringify(cuts.sh))
  // The share of the league holding each tier has to match the percentile it claims.
  const all = Object.keys(SEED.teams).flatMap((t) => rostersOf(t)).filter((p) => (p.mpg ?? 0) >= 12)
  const gold = all.filter((p) => badgesFor(p).some((b) => b.rank >= 3)).length
  check('gold and above is rare', gold / all.length < 0.35, `${(gold / all.length * 100).toFixed(0)}% hold one`)
  const hof = all.filter((p) => badgesFor(p).some((b) => b.rank === 4)).length
  check('Hall of Fame is rarer still', hof / all.length < 0.15, `${(hof / all.length * 100).toFixed(0)}%`)
  const sga = find('Shai Gilgeous-Alexander')
  check('an MVP-level player holds several', sga && badgesFor(sga.p).length >= 3,
    sga ? badgesFor(sga.p).map((b) => b.name).join(', ') : 'not found')
  const scrub = all.sort((a, b) => (a.bpm ?? 0) - (b.bpm ?? 0))[0]
  check('a replacement-level player holds few or none', badgesFor(scrub).length <= 2,
    `${scrub.n}: ${badgesFor(scrub).map((b) => b.name).join(', ')}`)
  check('every badge names the axis it was earned on',
    BADGES.every((b) => b.field && b.blurb && b.of))
}

console.log('\n— tendencies are the simulation’s own inputs —')
{
  const sga = find('Shai Gilgeous-Alexander')
  const sp = simOf(sga.t).find((x) => x.n === sga.p.n)
  const t = tendenciesFor(sp)
  check('a tendency reports the same number the engine reads',
    t.find((x) => x.id === 'usage').value === sp.usg
    && t.find((x) => x.id === 'three').value === sp.fg3r)
  check('and places it against the league', t.every((x) => x.pct >= 0 && x.pct <= 1))
  const curry = find('Stephen Curry')
  const cs = simOf(curry.t).find((x) => x.n === curry.p.n)
  const three = tendenciesFor(cs).find((x) => x.id === 'three')
  check('a shooter reads as a shooter', three.pct >= 0.7, `${(three.pct * 100).toFixed(0)}th percentile`)
}

console.log('\n— three modes, three different jobs —')
{
  check('easy is the trade desk and nothing else',
    Object.entries(MODE.easy.levels).filter(([, v]) => v === 'manual').map(([k]) => k).join() === 'trades')
  check('medium adds contracts and the draft',
    ['trades', 'free_agency', 'draft', 'extensions'].every((k) => MODE.medium.levels[k] === 'manual')
    && MODE.medium.levels.rotations === 'auto')
  check('hard is everything', Object.values(MODE.hard.levels).every((v) => v === 'manual'))
  check('a save reports the mode it is actually set to',
    MODES.every((m) => modeOf({ controlSurface: { levels: m.levels } }).key === m.key))
  check('and controls() answers per domain',
    controls({ controlSurface: { levels: MODE.hard.levels } }, 'rotations')
    && !controls({ controlSurface: { levels: MODE.easy.levels } }, 'rotations'))
}

console.log('\n— lessons appear once —')
{
  check('every lesson has a title, a place and a body',
    LESSONS.every((l) => l.id && l.title && l.where && l.body.length > 80))
  let sv = { learned: {} }
  // Used to assert that the caller's array order won, so 'apron' came first here. It is the
  // deepest lesson in the game and it was being offered ahead of salary matching purely
  // because a caller had listed it first. Depth decides now; the caller's order only breaks
  // ties within a depth.
  const first = nextLesson(sv, ['apron', 'matching'])
  check('the shallower lesson is offered first', first.id === 'matching', first.id)
  sv = learn(sv, 'apron')
  check('and never again once read', nextLesson(sv, ['apron', 'matching']).id === 'matching')
  check('marking one does not mark the rest', !seen(sv, 'matching'))
  check('the glossary shows what has been read',
    glossary(sv).find((l) => l.id === 'apron').read === true
    && glossary(sv).find((l) => l.id === 'matching').read === false)
  // The teaching claim of the project: where there is a measured number, it is in the text.
  const withNumbers = LESSONS.filter((l) => /\d/.test(l.body)).length
  check('most lessons carry the measured number behind the idea', withNumbers >= 12,
    `${withNumbers} of ${LESSONS.length}`)
}

console.log('\n— the rotation is a real budget —')
{
  const r = rostersOf('BOS'), sm = simOf('BOS')
  const rot = autoRotation(r, sm, bandOf, ratePerMin)
  const chk = checkRotation(rot)
  check('the coach’s rotation spends exactly 240 minutes', chk.total === TEAM_MINUTES, `${chk.total}`)
  check('and plays a legal number of people', chk.ok, chk.why || '')
  check('an over-full rotation is rejected',
    !checkRotation({ ...rot, extra: 40 }).ok)
  check('a short one is rejected too', !checkRotation({ a: 40, b: 40 }).ok)
  // Minutes have to reach the engine, or the screen is decoration.
  const heavy = {}
  for (const p of r) heavy[p.uid || p.n] = 0
  const star = r.sort((a, b) => ratePerMin(b) - ratePerMin(a))[0]
  heavy[star.uid || star.n] = 38
  const applied = applyRotation(sm, r, heavy)
  // Minutes are read off `mpg` now, not `load`: load carries availability, and setting a
  // rotation must not make a man healthier than he is. So the check is that the number you
  // typed is the number the engine plays him, and that his availability came through untouched.
  {
    const him = applied.find((x) => x.n === star.n)
    const other = applied.find((x) => x.n !== star.n)
    const was = sm.find((x) => x.n === star.n)
    check('the minutes you set are the minutes the simulation reads',
      him.mpg === 38 && other.mpg === 0)
    const avWas = Math.max(0.05, Math.min(1, (was.load || 0) / Math.max(1, was.mpg || 1)))
    const avNow = Math.max(0.05, Math.min(1, (him.load || 0) / Math.max(1, him.mpg || 1)))
    check('and setting them does not change how often he is fit',
      Math.abs(avNow - avWas) < 1e-9, `${avWas.toFixed(3)} -> ${avNow.toFixed(3)}`)
  }
  // And they cost something.
  const sp = sm.find((x) => x.n === star.n)
  const safe = sustainable(star, sp)
  check('a sustainable load is a real number', safe > 8 && safe <= 38, `${safe.toFixed(1)}`)
  check('pushing well past it is flagged', strain(star, sp, safe + 10).risk === 'heavy')
  check('resting below it is not', strain(star, sp, safe - 6).risk === 'rested')
  check('and heavy minutes cost availability', strain(star, sp, safe + 10).delta < 0)
}

console.log('\n— minutes are actually spent —')
{
  // The first version of this priced a rotation and then charged nobody for it. A screen
  // that says "stretched" and costs nothing is a slider, not a decision.
  const r = rostersOf('BOS'), sm = simOf('BOS')
  const rot = autoRotation(r, sm, bandOf, ratePerMin)
  // Somebody there is actually room to over-ride: a player whose body has shown a modest
  // load. You cannot ride a 37-minute player ten minutes over — the cap is 38 — and that
  // is correct. Wear bites when you push a bench player into a starter's minutes.
  const healthy = r.filter((p) => (p.av ?? 0) > 85)
    .map((p) => ({ p, safe: sustainable(p, sm.find((x) => x.n === p.n)) }))
    .filter((x) => x.safe <= 26)
    .sort((a, b) => a.safe - b.safe)[0].p
  const key = healthy.uid || healthy.n
  const sp = sm.find((x) => x.n === healthy.n)
  const safe = sustainable(healthy, sp)

  const ridden = { ...rot, [key]: Math.min(38, Math.round(safe) + 10) }
  let hard = {}
  for (let g = 0; g < 82; g += 10) hard = accumulateWear(hard, r, sm, ridden, 10)
  const lost = (healthy.av ?? 75) - availabilityNow(healthy, hard)
  check('a season ridden ten minutes over costs about a fifth of a season',
    lost > 12 && lost < 28, `${lost.toFixed(1)} points of availability`)

  const rested = { ...rot, [key]: Math.max(6, Math.round(safe) - 8) }
  let easy = {}
  for (let g = 0; g < 82; g += 10) easy = accumulateWear(easy, r, sm, rested, 10)
  check('and staying inside it costs nothing', (easy[key] || 0) === 0, `${(easy[key] || 0).toFixed(1)}`)

  check('wear is reported before it is severe',
    wornDown(r, hard, 10).some((x) => (x.p.uid || x.p.n) === key))
  // And it has to reach the engine, or it is a number on a screen.
  const worn = applyWear(sm, r, hard)
  const before = sm.find((x) => x.n === healthy.n).load
  const after = worn.find((x) => x.n === healthy.n).load
  check('wear reaches the simulation through load', after < before,
    `${before.toFixed(1)} -> ${after.toFixed(1)}`)
  check('and it is bounded — nobody disappears', after > before * 0.6)
}

console.log('\n— training camp buys something —')
{
  const r = rostersOf('BOS')
  const withSkills = r.filter((p) => typeof p.sh === 'number')
  check('every player has skills to develop', withSkills.length === r.length,
    `${r.length - withSkills.length} without`)

  const shooting = applyPractice(r, 'shooting')
  const moved = r.filter((p, i) => shooting[i].sh > p.sh).length
  check('a camp on shooting moves shooting', moved === r.length, `${moved} of ${r.length}`)
  const cond = applyPractice(r, 'conditioning')
  check('conditioning buys durability and no skill',
    cond.every((p, i) => p.av > r[i].av) && cond.every((p, i) => p.sh === r[i].sh))

  // The one part with a measurement behind it.
  check('development is worth more than twice as much at 22 as at 34',
    ageWeight(22) / ageWeight(34) > 2, `${(ageWeight(22) / ageWeight(34)).toFixed(2)}x`)
  const young = r.find((p) => (p.a ?? 30) <= 23) || r[0]
  const old = r.find((p) => (p.a ?? 0) >= 33) || r[r.length - 1]
  const iy = r.indexOf(young), io = r.indexOf(old)
  check('and the young gain more than the old from the same camp',
    (shooting[iy].sh - young.sh) > (shooting[io].sh - old.sh),
    `${(shooting[iy].sh - young.sh).toFixed(1)} vs ${(shooting[io].sh - old.sh).toFixed(1)}`)
  check('no emphasis is a no-op, not a crash', applyPractice(r, undefined).length === r.length)
}

console.log(`\n${pass}/${pass + fail} checks pass`)
process.exit(fail ? 1 : 0)
