// Does ownership ask for something real?
//
// The old mandate was four buckets off projected wins and the middle one was enormous, so
// almost every club in the league opened with "make the playoffs, about forty-four wins". Two
// completely different jobs — a thirty-eight-win team holding three firsts and a fifty-win team
// holding none — got the same sentence. These are the checks that it now says something.
//
//   node tools/gm/mandate.test.mjs
import { SEED } from '../../src/lib/gm/seed.js'
import { setLeague, newLeague, rostersOf } from '../../src/lib/gm/league.js'
import { newPickLedger, rebuildLedger, strengthRanks } from '../../src/lib/gm/picks.js'
import { teamContext, winsFromNet, leagueCentre, projectedWins, fitNet } from '../../src/lib/gm/trade/context.js'
import { issueMandate, primaryFor, gradeMandate, ambitionAt, youngTalentIn } from '../../src/lib/gm/mandate.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

setLeague(newLeague())
const TEAMS = Object.keys(SEED.teams)
const picks = rebuildLedger(newPickLedger(SEED.season), strengthRanks(null))
const save = { picks, franchise: { currentSeason: SEED.season, team: 'BOS' } }
const all = TEAMS.map((t) => ({ t, m: issueMandate(t, save), ctx: teamContext(t, { roster: rostersOf(t), phase: 'offseason' }) }))

console.log('— the league adds up —')
{
  // Every win is somebody's loss. The fit model rated each roster on its own and nothing made
  // the thirty ratings sum to zero, so the average club projected at 42.9 wins in an
  // eighty-two game league and ownership was asking San Antonio for sixty-three.
  const total = all.reduce((s, x) => s + x.ctx.wins, 0)
  check('the thirty projections sum to a season', Math.abs(total - 1230) < 1,
    `${total.toFixed(1)} against 1230`)
  check('and the average club projects at .500', Math.abs(total / 30 - 41) < 0.1,
    `${(total / 30).toFixed(2)} wins`)
  check('the centre is a real number, not zero by accident', Math.abs(leagueCentre()) > 0.05,
    `centre ${leagueCentre().toFixed(3)}`)
  check('centring is what does it',
    Math.abs(projectedWins(fitNet(rostersOf('BOS')).net) - winsFromNet(fitNet(rostersOf('BOS')).net)) > 0.5, '')
}

console.log('\n— and ownership asks thirty different questions —')
{
  const labels = new Set(all.map((x) => x.m.label))
  check('the league does not get one mandate', labels.size >= 6, `${labels.size} distinct: ${[...labels].join(' · ')}`)
  const winTargets = all.filter((x) => x.m.primary.kind === 'wins').map((x) => x.m.primary.n)
  check('and the win targets are not all the same number',
    new Set(winTargets).size >= Math.min(3, winTargets.length), winTargets.join(', '))
  check('nobody is asked for forty-four wins by default',
    !all.every((x) => (x.m.target ?? 0) === 44), '')

  // The ask has to be reachable AND worth reaching. Both failures are real: a target below the
  // projection is not an ask, and a target far above it is a firing dressed as a mandate.
  const off = all.filter((x) => x.m.primary.wins !== undefined
    && (x.m.primary.wins < x.ctx.wins || x.m.primary.wins > x.ctx.wins + 5))
  check('every target sits just above what the roster projects', off.length === 0,
    off.map((x) => `${x.t} asked ${x.m.primary.wins} on ${x.ctx.wins.toFixed(0)}`).join(', '))
  check('and the bump shrinks as the projection rises', ambitionAt(30) > ambitionAt(60),
    `${ambitionAt(30)} at 30 wins, ${ambitionAt(60)} at 60`)
}

console.log('\n— the contenders are judged on the bracket —')
{
  const top = [...all].sort((a, b) => b.ctx.wins - a.ctx.wins).slice(0, 3)
  check('the best teams are asked to go somewhere, not to win a number',
    top.every((x) => x.m.primary.kind === 'round'),
    top.map((x) => `${x.t} ${x.m.primary.kind}`).join(', '))
  const bottom = [...all].sort((a, b) => a.ctx.wins - b.ctx.wins).slice(0, 4)
  check('and the worst are not asked for wins at all',
    bottom.every((x) => x.m.primary.kind === 'develop' || x.m.primary.kind === 'assets'),
    bottom.map((x) => `${x.t} ${x.m.primary.kind}`).join(', '))

  // Which of the two bad-team mandates you get turns on whether there is anybody to develop.
  // Average core age was the wrong test — it had Portland, with Donovan Clingan on it, being
  // stripped for parts because two veterans on the bench dragged the mean up.
  const wrong = all.filter((x) => x.m.primary.kind === 'develop' && youngTalentIn(rostersOf(x.t)) < 2)
  check('a develop mandate is only given to a club with somebody to develop', wrong.length === 0,
    wrong.map((x) => x.t).join(', '))
}

console.log('\n— and the objectives are about your actual roster —')
{
  const withSecs = all.filter((x) => x.m.secondaries.length > 0)
  check('almost every club gets objectives as well as a goal', withSecs.length >= 27,
    `${withSecs.length} of 30`)
  check('never more than three', all.every((x) => x.m.secondaries.length <= 3), '')

  // The minutes objective has to name somebody who is actually on the roster, or it cannot be
  // graded and it cannot be acted on.
  const named = all.flatMap((x) => x.m.secondaries.filter((o) => o.kind === 'minutes')
    .map((o) => ({ t: x.t, who: o.who })))
  const ghosts = named.filter((n) => !rostersOf(n.t).some((p) => p.n === n.who))
  check('a player named in an objective is on the roster', ghosts.length === 0,
    ghosts.map((g) => `${g.who} not on ${g.t}`).join(', '))
  check('and he is young enough to be worth developing',
    named.every((n) => (rostersOf(n.t).find((p) => p.n === n.who)?.a ?? 99) <= 23.9), '')

  // Size came out at 0.005 in the ridge. Telling a general manager to fix the one axis the
  // measurement says to ignore is worse than saying nothing.
  const sizeAsk = all.flatMap((x) => x.m.secondaries).filter((o) => o.axis === 'size')
  check('no objective asks anybody to get taller', sizeAsk.length === 0, `${sizeAsk.length} found`)

  const kinds = new Set(all.flatMap((x) => x.m.secondaries).map((o) => o.kind))
  check('objectives come from more than one part of the job', kinds.size >= 3, [...kinds].join(', '))
}

console.log('\n— and every one of them can be graded —')
{
  const m = issueMandate('BOS', save)
  const ctx = { wins: 55, round: 3, developed: 2, firsts: 4, salary: 190e6,
    minutesOf: Object.fromEntries(m.secondaries.filter((o) => o.who).map((o) => [o.who, o.n])),
    needZ: Object.fromEntries(m.secondaries.filter((o) => o.axis).map((o) => [o.axis, 0.1])) }
  const g = gradeMandate(m, ctx)
  check('a perfect season grades as one', g.primary.met && g.kept === g.of,
    `${g.kept}/${g.of} objectives, primary ${g.primary.met}`)
  const bad = gradeMandate(m, { wins: 12, round: 0, developed: 0, firsts: 0, salary: 260e6,
    minutesOf: {}, needZ: {} })
  check('and a disaster grades as one', !bad.primary.met && bad.kept === 0, `${bad.kept}/${bad.of}`)
  check('the score sorts them the right way round', g.score > bad.score,
    `${g.score.toFixed(2)} against ${bad.score.toFixed(2)}`)
  check('every objective produces a sentence, not a blank',
    g.secondaries.every((s) => typeof s.line === 'string' && s.line.length > 0), '')
}

// The mandate has to reach the screen. Every consumer reads `label`, and for a long time
// nothing put one on the object — so a bespoke sentence about this roster was rendered as the
// seed's one-word placeholder.
for (const t of ['BOS', 'OKC', 'SAS', 'POR', 'WAS']) {
  const m2 = issueMandate(t, { franchise: { team: t, currentSeason: '2026-27' }, status: {}, records: {} })
  check(`${t} issues a mandate with a label`, !!m2.label, JSON.stringify(m2).slice(0, 80))
  check(`${t}'s label is the primary objective, not a placeholder`, m2.label === m2.primary.label,
    `${m2.label} vs ${m2.primary?.label}`)
  check(`${t}'s label reads like a sentence`, /\s/.test(m2.label || ''), m2.label)
}

console.log(`\n${pass}/${pass + fail} checks pass`)
process.exit(fail ? 1 : 0)
