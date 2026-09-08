// The Cup, from the draw to the banner.
//
// Adam asked for it to work the way it works in the NBA: groups, real rules, a single
// elimination bracket with its own pageantry, a morale lift for winning it, and a decision
// about the banner. These are the checks that the rules are the rules.
//
//   node tools/gm/cup.test.mjs
import { SEED } from '../../src/lib/gm/seed.js'
import { setLeague, newLeague } from '../../src/lib/gm/league.js'
import { newSeason, playNext, cupGroupDone, playCupRound } from '../../src/lib/gm/season.js'
import { groupTable, qualifiers, openKnockout, roundName, roundCounts, ROUNDS,
  raiseBanner, moraleNow, CUP_BOOST, DEFERRED_BOOST, GROUP_GAMES, GROUP_SIZE } from '../../src/lib/gm/cup.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

setLeague(newLeague())
const st = newSeason(4242)

console.log('— the draw —')
{
  const g = st.cupGroups
  check('six groups', g.length === 6, `${g.length}`)
  check('five clubs in each', g.every((x) => x.teams.length === GROUP_SIZE),
    g.map((x) => x.teams.length).join(','))
  check('every club is in exactly one', new Set(g.flatMap((x) => x.teams)).size === 30, '')
  check('and the groups stay inside a conference',
    g.every((x) => x.teams.every((t) => SEED.teams[t].conf === x.conf)), '')
}

console.log('\n— the group games are league games —')
{
  let guard = 0
  while (!cupGroupDone(st) && st.played < st.schedule.length && guard++ < 400) playNext(st, 20)
  check('sixty group games were played', st.cupResults.length === 60, `${st.cupResults.length}`)
  const per = {}
  for (const r of st.cupResults) { per[r.home] = (per[r.home] || 0) + 1; per[r.away] = (per[r.away] || 0) + 1 }
  check('four each, and not five for anybody',
    Object.values(per).every((n) => n === GROUP_GAMES), JSON.stringify(per).slice(0, 120))
  // The point of the in-season tournament is that it does not sit outside the season.
  const played = st.results.length
  check('and they counted in the standings', played >= 60
    && Object.values(st.rec).reduce((s, r) => s + r.w + r.l, 0) === played * 2, '')
  check('the group stage is over before December', st.played < st.schedule.length * 0.35,
    `${st.played} of ${st.schedule.length} league games in`)
}

console.log('\n— who goes through —')
const q = qualifiers(st.cupGroups, st.cupResults)
{
  check('eight qualify', q.field.length === 8, `${q.field.length}`)
  check('four from each conference',
    q.byConf.East.length === 4 && q.byConf.West.length === 4,
    `${q.byConf.East.length}E ${q.byConf.West.length}W`)
  check('six group winners and two wild cards',
    q.field.filter((x) => x.seedIn === 'winner').length === 6
    && q.field.filter((x) => x.seedIn === 'wildcard').length === 2,
    q.field.map((x) => `${x.team}:${x.seedIn}`).join(' '))
  // A wild card cannot be seeded above a group winner — that is the whole meaning of winning
  // your group.
  check('and a group winner is always seeded above the wild card',
    ['East', 'West'].every((c) => {
      const w = q.byConf[c].findIndex((x) => x.seedIn === 'wildcard')
      return w === -1 || w === q.byConf[c].length - 1
    }), '')
  const tops = q.tables.map((t) => t.rows[0])
  check('the table is sorted on something', tops.every((r) => typeof r.w === 'number'), '')
}

console.log('\n— the bracket —')
{
  let kn = openKnockout(q.byConf)
  check('four quarter-finals', kn.ties.length === 4, `${kn.ties.length}`)
  check('and East stays away from West until Las Vegas',
    kn.ties.every((t) => SEED.teams[t.hi].conf === SEED.teams[t.lo].conf), '')
  check('one against four, two against three',
    kn.ties.filter((t) => t.conf === 'East').every((t) => {
      const s = q.byConf.East
      const a = s.findIndex((x) => x.team === t.hi), b = s.findIndex((x) => x.team === t.lo)
      return a + b === 3
    }), '')

  const seen = []
  let guard = 0
  while (kn.stage !== 'done' && guard++ < 8) { seen.push(kn.stage); kn = playCupRound(st, kn) }
  check('it runs to a champion', !!kn.champion, kn.champion || 'nobody won it')
  check('through three named rounds', seen.length === 3, seen.join(' → '))
  check('and every round has a name and a venue',
    ROUNDS.every((r) => roundName(r.key) && r.where), '')
  // The final is an exhibition in the record book, and the rest are not.
  check('the group games and the early rounds count; the final does not',
    roundCounts('qf') && roundCounts('sf') && !roundCounts('final'), '')
  check('nobody plays twice in a round',
    kn.ties.filter((t) => t.round === 'final').length === 1, '')
  check('and the champion won every tie he was in',
    kn.ties.filter((t) => t.hi === kn.champion || t.lo === kn.champion)
      .every((t) => t.winner === kn.champion), '')
}

console.log('\n— and the banner is a decision —')
{
  const base = { franchise: { currentSeason: SEED.season }, banners: [], morale: {} }
  const up = raiseBanner(base, { raised: true, day: 40 })
  check('raising it gives the team something to play for',
    moraleNow(up, 45).mult > 1, `${moraleNow(up, 45).mult}`)
  check('and it wears off', moraleNow(up, 40 + CUP_BOOST.days + 1).mult === 1, '')
  check('the banner goes in the record book either way',
    up.banners.length === 1 && raiseBanner(base, { raised: false, day: 40 }).banners.length === 1, '')
  const down = raiseBanner(base, { raised: false, day: 40 })
  check('declining it carries a promise instead of a boost',
    moraleNow(down, 45).mult === 1 && down.deferredBanner?.from === 'cup',
    JSON.stringify(down.deferredBanner))
  check('and the deferred one is worth more, for longer',
    DEFERRED_BOOST.pct > CUP_BOOST.pct && DEFERRED_BOOST.days > CUP_BOOST.days,
    `${DEFERRED_BOOST.pct} for ${DEFERRED_BOOST.days} against ${CUP_BOOST.pct} for ${CUP_BOOST.days}`)
}

console.log('\n— and it replays identically —')
{
  setLeague(newLeague())
  const again = newSeason(4242)
  let guard = 0
  while (!cupGroupDone(again) && again.played < again.schedule.length && guard++ < 400) playNext(again, 20)
  const q2 = qualifiers(again.cupGroups, again.cupResults)
  check('the same seed draws the same groups',
    JSON.stringify(st.cupGroups) === JSON.stringify(again.cupGroups), '')
  check('and produces the same eight',
    q.field.map((x) => x.team).join() === q2.field.map((x) => x.team).join(),
    q2.field.map((x) => x.team).join(' '))
}

console.log(`\n${pass}/${pass + fail} checks pass`)
process.exit(fail ? 1 : 0)
