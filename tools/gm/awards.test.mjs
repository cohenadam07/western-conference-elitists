// Does the season remember what happened, and can it be argued about?
//
// The engine always produced a box score for every game and the season always threw it
// away. These are the checks that it now keeps one, that what it keeps looks like a real
// league's numbers rather than plausible-looking noise, and that an award voted off those
// numbers goes to somebody a person would actually have voted for.
//
//   node tools/gm/awards.test.mjs
import { SEED } from '../../src/lib/gm/seed.js'
import { setLeague, newLeague, rostersOf, simOf, playableSim } from '../../src/lib/gm/league.js'
import { rotation, startersOf } from '../../src/lib/gm/sim.js'
import { newSeason, playNext, TEAMS, teamGames } from '../../src/lib/gm/season.js'
import { allLines, line, GAME_MINUTES } from '../../src/lib/gm/box.js'
import { simOf as simsOf } from '../../src/lib/gm/league.js'
import { vote, ballotRows } from '../../src/lib/gm/awards.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const near = (x, lo, hi) => x >= lo && x <= hi

setLeague(newLeague())
const st = newSeason(90210)
while (st.played < st.schedule.length) playNext(st, 400)
const L = allLines(st.stats)
const byId = new Map(L.map((l) => [l.id, l]))

console.log('— the season keeps a box score —')
{
  check('every game was played', st.played === st.schedule.length, `${st.played} of ${st.schedule.length}`)
  check('somebody has a stat line', L.length > 250, `${L.length} players`)
  check('nobody played more games than there are games',
    L.every((l) => l.g <= 82), '')

  // Court time has to add up: five men on the floor for forty-eight minutes is 240 minutes a
  // team a game, and if it does not come out to that the rotation is being misread.
  //
  // Summed as TOTAL minutes over games played, not as a sum of per-game averages. Those were
  // the same number only while every man played all eighty-two; once availability started
  // deciding who dresses, adding up twelve averages taken over twelve different denominators
  // stopped meaning anything and this check began reporting 320 to 481 for a league that was
  // in fact within a fifth of a minute of exact.
  const perTeam = {}
  const gamesFor = {}
  for (const t of TEAMS) gamesFor[t] = teamGames(st, t).length
  for (const l of L) perTeam[l.team] = (perTeam[l.team] || 0) + l.mpg * l.g
  const mins = Object.entries(perTeam).map(([t, m]) => m / Math.max(1, gamesFor[t]))
  check('five men are on the floor at a time',
    mins.every((m) => near(m, GAME_MINUTES - 2, GAME_MINUTES + 2)),
    `team minutes ${Math.min(...mins).toFixed(0)}–${Math.max(...mins).toFixed(0)} (want ${GAME_MINUTES})`)

  // Exactly five starters a team, every night.
  const starts = {}
  for (const l of L) starts[l.team] = (starts[l.team] || 0) + l.started
  const s = Object.values(starts)
  check('five men start every game', s.every((x) => x === 82 * 5),
    `starts per team ${Math.min(...s)}–${Math.max(...s)} (want ${82 * 5})`)
}

console.log('\n— and the numbers look like a league —')
{
  const tot = (k) => L.reduce((a, l) => a + l[k] * l.g, 0) / (82 * 30)
  const scoring = tot('pts')
  check('teams score like NBA teams', near(scoring, 105, 126), `${scoring.toFixed(1)} a game`)
  check('teams rebound like NBA teams', near(tot('reb'), 38, 50), `${tot('reb').toFixed(1)} a game`)
  check('teams pass like NBA teams', near(tot('ast'), 20, 32), `${tot('ast').toFixed(1)} a game`)
  check('teams steal like NBA teams', near(tot('stl'), 5.5, 9.5), `${tot('stl').toFixed(1)} a game`)
  check('teams block like NBA teams', near(tot('blk'), 3.5, 6.5), `${tot('blk').toFixed(1)} a game`)
  const ts = L.filter((l) => l.g > 40).reduce((a, l) => a + l.ts, 0) / L.filter((l) => l.g > 40).length
  check('and shoot like NBA players', near(ts, 0.53, 0.61), `true shooting ${ts.toFixed(3)}`)

  // Steals and blocks are no longer a model at all — the engine credits them to the man
  // whose measured rate earned them. Which means every player has to HAVE a rate.
  const rated = TEAMS.flatMap((t2) => simsOf(t2))
  const noRate = rated.filter((p) => !(p.stlr > 0) || !(p.blkr > 0))
  check('every player carries a real steal and block rate', noRate.length === 0,
    `${noRate.length} without: ${noRate.slice(0, 5).map((p) => p.n).join(', ')}`)
}

console.log('\n— steals belong to guards and blocks belong to bigs —')
{
  // The first version of the attribution handed both to whoever rated best defensively and
  // played the most, and the league's steal leader came out as Nikola Jokic.
  const sims = {}
  for (const t of TEAMS) for (const p of simOf(t)) sims[p.n] = p
  const capOf = {}
  for (const t of TEAMS) for (const c of rostersOf(t)) capOf[c.n] = c
  // "Big" on the game's own positional scale, not on a size rating. A six-seven wing can rate
  // 60 for size and lead the league in steals, which is a description of Ausar Thompson rather
  // than a bug — flagging him as a big man made this check fail for the right player.
  const big = (l) => (capOf[l.n]?.slot ?? 3) >= 4.2
  const topBlk = [...L].sort((a, b) => b.blk - a.blk).slice(0, 8)
  check('the shot-blocking leaderboard is big men',
    topBlk.filter(big).length >= 6, topBlk.map((l) => `${l.n}${big(l) ? '' : '*'}`).join(', '))
  const topStl = [...L].sort((a, b) => b.stl - a.stl).slice(0, 8)
  check('the steals leaderboard is not big men',
    topStl.filter(big).length <= 2, topStl.map((l) => `${l.n}${big(l) ? '*' : ''}`).join(', '))
}

console.log('\n— and somebody wins something —')
const a = vote(st)
{
  check('every award has a winner', a.list.length === 5, a.list.map((x) => x.key).join(', '))
  check('the shares add to one',
    a.list.every((x) => Math.abs(x.ballot.reduce((s2, b) => s2 + b.share, 0) - 1) < 1e-6), '')

  const mvp = a.list.find((x) => x.key === 'mvp').winner
  check('the MVP is a big producer', mvp.pts + mvp.reb + mvp.ast > 30,
    `${mvp.name} ${mvp.pts.toFixed(1)}/${mvp.reb.toFixed(1)}/${mvp.ast.toFixed(1)}`)
  // The record term is deliberately heavy, because that is how the award is actually voted.
  check('and he is not on a bad team', mvp.wins >= 42, `${mvp.name}, ${mvp.wins} wins`)

  const dpoy = a.list.find((x) => x.key === 'dpoy').winner
  check('the DPOY defends', dpoy.blk + dpoy.stl > 1.6,
    `${dpoy.name} ${dpoy.blk.toFixed(1)} blk, ${dpoy.stl.toFixed(1)} stl`)

  // Rookie of the Year has to be a rookie. The age fallback that used to stand in for this
  // put second-year players on the ballot because they are still twenty.
  const rows = new Map(ballotRows(st).map((r) => [r.id, r]))
  const roy = a.list.find((x) => x.key === 'roy').winner
  check('the Rookie of the Year is in his first season', !!rows.get(roy.id)?.rookie,
    `${roy.name}, exp ${rows.get(roy.id)?.cap?.exp}`)

  // Sixth Man has to have come off the bench. A star on a short rotation can trail his own
  // team-mates in the engine's minutes order without being anybody's sixth man.
  const smoy = a.list.find((x) => x.key === 'smoy').winner
  const sl = byId.get(smoy.id)
  check('the Sixth Man came off the bench', sl && sl.started < sl.g * 0.35 && sl.mpg <= 30,
    `${smoy.name} started ${sl?.started}/${sl?.g}, ${sl?.mpg.toFixed(1)} mpg`)
}

console.log('\n— the teams are teams —')
{
  const flat = a.allNba.flat()
  check('All-NBA is fifteen men', flat.length === 15, `${flat.length}`)
  check('and nobody is on it twice', new Set(flat.map((r) => r.id)).size === flat.length, '')
  const slot = (r) => (/C/.test(r.cap?.pos || '') ? 'C' : /G/.test(r.cap?.pos || '') ? 'G' : 'F')
  const full = vote(st)
  for (let i = 0; i < full.allNba.length; i++) {
    const counts = { G: 0, F: 0, C: 0 }
    full.allNba[i].forEach((r) => { counts[slot(r)] += 1 })
    check(`All-NBA ${['first', 'second', 'third'][i]} team is two guards, two forwards and a centre`,
      counts.G === 2 && counts.F === 2 && counts.C === 1,
      `${counts.G}G ${counts.F}F ${counts.C}C`)
  }
  check('All-Rookie is only rookies',
    a.allRookie.flat().every((r) => {
      const row = ballotRows(st).find((x) => x.id === r.id)
      return !row || row.rookie
    }), '')
}

console.log('\n— and the same season votes the same way —')
{
  setLeague(newLeague())
  const again = newSeason(90210)
  while (again.played < again.schedule.length) playNext(again, 400)
  const b = vote(again)
  check('a replayed season produces identical awards',
    JSON.stringify(a.list.map((x) => [x.key, x.winner.name, Math.round(x.winner.share * 1e6)]))
    === JSON.stringify(b.list.map((x) => [x.key, x.winner.name, Math.round(x.winner.share * 1e6)])),
    b.list.map((x) => `${x.key}:${x.winner.name}`).join(', '))
  const l1 = allLines(st.stats).sort((x, y) => y.pts - x.pts)[0]
  const l2 = allLines(again.stats).sort((x, y) => y.pts - x.pts)[0]
  check('and identical box scores', l1.n === l2.n && Math.abs(l1.pts - l2.pts) < 1e-9,
    `${l1.n} ${l1.pts.toFixed(2)} vs ${l2.n} ${l2.pts.toFixed(2)}`)
}

console.log(`\n${pass}/${pass + fail} checks pass`)
process.exit(fail ? 1 : 0)
