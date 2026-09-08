// THE LONG RUN TERMINATES.
//
// "Play to the end of the season" was a dead button on February 11th for as long as the
// deadline phase existed: it carries no game count, and the runner read "no games here"
// as "give up" rather than "turn the page". Nothing caught it, because the decision lived
// inside a React effect. It is a pure function now, so this walks it.
import { PHASES, runStep } from '../../src/lib/gm/phase.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m) } }

// Drive a run from every phase of a season and prove it reaches the target.
for (const start of PHASES.filter((p) => p.stage === 'season')) {
  for (const target of [58, 82]) {
    let save = { phase: start.key }
    let played = start.games ? Math.min(start.games, target) - 1 : target - 1
    if (start.key === 'deadline') played = 58
    if (start.key === 'postseason') continue
    let guard = 0, done = false, handed = false
    while (guard++ < 400) {
      const s = runStep(save, played, target)
      if (s.do === 'stop') {
        done = played >= target
        handed = !done
        break
      }
      if (s.do === 'advance') {
        const i = PHASES.findIndex((p) => p.key === save.phase)
        save = { phase: PHASES[Math.min(PHASES.length - 1, i + 1)].key }
        continue
      }
      ok(s.n > 0, `${start.key}→${target}: a play step must move (${s.n})`)
      played += s.n
    }
    ok(guard < 400, `${start.key}→${target}: run terminates, no loop`)
    // Christmas→deadline is the one place a run is allowed to stop short: the deadline
    // is handed to the user on purpose. Everywhere else it must actually get there.
    const legalHandover = handed && save.phase === 'midseason'
    ok(done || legalHandover,
      `${start.key}→${target}: reaches ${target} or hands over at the deadline `
      + `(stopped at ${played} in ${save.phase})`)
  }
}

// The specific regression: standing ON the deadline, a run to 82 must not stop dead.
{
  const s = runStep({ phase: 'deadline' }, 58, 82)
  ok(s.do === 'advance', `on the deadline, a run to 82 advances (got ${s.do})`)
}
// And a run aimed AT the deadline from before it still stops there.
{
  const s = runStep({ phase: 'midseason' }, 58, 82)
  ok(s.do === 'stop', `a run past the deadline is handed over (got ${s.do})`)
}
// Outside a season there is nothing to run to.
for (const k of ['camp', 'preseason', 'review', 'offseason']) {
  ok(runStep({ phase: k }, 0, 82).do === 'stop', `${k}: no long run`)
}
// A finished target never plays another game.
ok(runStep({ phase: 'stretch' }, 82, 82).do === 'stop', 'target reached is a stop')
ok(runStep({ phase: 'stretch' }, 0, 0).do === 'stop', 'no target is a stop')

console.log(`\nrun: ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
