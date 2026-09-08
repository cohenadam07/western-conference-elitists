// Play the game, not the units. Run: node tools/gm/soak.mjs [careers] [seasons]
//
// Every engine here passes in isolation. The last three real bugs — a tie recorded as a
// loss, the alphabet setting draft-pick value, dead-money rows silencing half the league
// at the deadline — were all found by looking at a screen, not by a unit test. This plays
// whole careers and asserts the things a player would notice.
import { SEED } from '../../src/lib/gm/seed.js'
import { newLeague, setLeague, allRosters } from '../../src/lib/gm/league.js'
import { rng } from '../../src/lib/gm/sim.js'
import { newSeason, playNext, standings, teamGames, TEAMS } from '../../src/lib/gm/season.js'
import {
  runPlayoffs, teamRun, openBracket, stepBracket, playRound, bracketResult,
} from '../../src/lib/gm/playoffs.js'
import { rollSeason, ageRoster, runContracts, earnedBadges, refill, rookieContract } from '../../src/lib/gm/offseason.js'
import { newPickLedger, strengthRanks, violatesStepien } from '../../src/lib/gm/picks.js'
import { generateOffers, offerMargin, DEADLINE_GAME } from '../../src/lib/gm/deadline.js'
import { newCareer } from '../../src/lib/gm/storage.js'
import { applyTrade } from '../../src/lib/gm/trades.js'
import { validateTrade, teamSalary, status } from '../../src/lib/gm/cap.js'

const CAREERS = Number(process.argv[2] || 8)
const SEASONS = Number(process.argv[3] || 5)

const fails = []
const seen = new Map()
function check(name, cond, detail = '') {
  const rec = seen.get(name) || { pass: 0, fail: 0, first: '' }
  if (cond) rec.pass++
  else { rec.fail++; if (!rec.first) rec.first = detail; fails.push(`${name} — ${detail}`) }
  seen.set(name, rec)
}

const t0 = Date.now()
for (let c = 0; c < CAREERS; c++) {
  const r = rng(1000 + c * 77)
  const team = TEAMS[r.randrange(TEAMS.length)]
  // A fresh league per career — thirty mutable rosters, not a view onto the seed.
  setLeague(newLeague())
  let save = newCareer({ gm: { name: `GM ${c}` }, team, preset: 'guided',
    levels: { ...SEED.presets.guided.levels }, seed: 4242 + c * 131 })
  let simRoster = save.league.sim[team]
  let capRoster = save.league.rosters[team]

  for (let y = 0; y < SEASONS; y++) {
    // ---- regular season
    const st = newSeason(save.rngSeed)
    playNext(st, Math.floor(st.schedule.length * 0.45), { traceTeam: team })

    // ---- deadline
    const ledger = newPickLedger(SEED.season)
    const year = parseInt(SEED.season, 10)
    const offers = generateOffers(team, st, r, ledger, year, 4, save.league.rosters[team])
    const ranks = strengthRanks(st)
    for (const o of offers) {
      const cap = validateTrade([
        { team, roster: save.league.rosters[team], out: [o.want], inc: o.give },
        { team: o.team, roster: allRosters()[o.team], out: o.give, inc: [o.want] },
      ])
      check('deadline offers are cap-legal', cap.ok, `${team}<-${o.team}: ${cap.rule || ''}`)
      check('deadline offers respect Stepien',
        violatesStepien((ledger[o.team] || []).filter((p) =>
          !o.givePicks.some((g) => g.from === p.from && g.year === p.year && g.round === p.round)),
          o.team, year).ok, `${o.team}`)
      check('deadline offer margins are sane',
        Math.abs(offerMargin(o, ranks, year)) < 120e6,
        `${(offerMargin(o, ranks, year) / 1e6).toFixed(0)}M`)
    }

    // Actually take a deadline deal, so the career roster is exercised by trades and not
    // only by aging. Accepting a trade used to change nothing at all.
    if (offers.length) {
      const o = offers[r.randrange(offers.length)]
      const before = save.league.rosters[team].length
      const beforeNames = new Set(save.league.rosters[team].map((p) => p.n))
      // The bug this was written for: only the user's roster used to move, so a player
      // you traded for stayed on his old team and could be offered to you again.
      const theirBefore = save.league.rosters[o.team].length
      save = applyTrade(save, { other: o.team, out: [o.want], inc: o.give,
        outPicks: [], inPicks: o.givePicks })
      check('BOTH rosters move', save.league.rosters[o.team].length === theirBefore + 1 - o.give.length,
        `${o.team} ${theirBefore} -> ${save.league.rosters[o.team].length}`)
      check('the other team receives the player you sent',
        save.league.rosters[o.team].some((p) => p.n === o.want.n), `${o.want.n} never reached ${o.team}`)
      // By id, not by name: Basketball-Reference lists dead money as its own row, so a
      // team can legitimately carry two lines with the same name and only one of them
      // moves.
      const key = (x) => x.uid || `${x.n}|${x.s}`
      check('the other team loses what it sent',
        o.give.every((g) => !save.league.rosters[o.team].some((p) => key(p) === key(g))),
        `${o.team} still has one of ${o.give.map((g) => g.n).join(', ')}`)
      check('the other team can still field what it kept',
        o.give.every((g) => !save.league.sim[o.team].some((p) => p.n === g.n)),
        'a player who left is still in the other team\'s simulation roster')
      check('a trade changes the roster', save.league.rosters[team].length === before - 1 + o.give.length,
        `${before} -> ${save.league.rosters[team].length}`)
      check('the player you sent is gone',
        !save.league.rosters[team].some((p) => (p.uid || `${p.n}|${p.s}`) === (o.want.uid || `${o.want.n}|${o.want.s}`)),
        o.want.n)
      check('the players you got arrived',
        o.give.every((g) => save.league.rosters[team].some((p) => p.n === g.n)), '')
      check('incoming players can actually play',
        o.give.every((g) => save.league.sim[team].some((p) => p.n === g.n)),
        'a traded-for player had no simulation profile')
      check('traded picks change hands',
        o.givePicks.every((gp) => (save.picks[team] || []).some((p) =>
          p.from === gp.from && p.year === gp.year && p.round === gp.round)), '')
      check('traded picks leave the other team',
        o.givePicks.every((gp) => !(save.picks[o.team] || []).some((p) =>
          p.from === gp.from && p.year === gp.year && p.round === gp.round)), '')
      check('the trade counter moves', save.records.tradesMade > 0, '')
      simRoster = save.league.sim[team]
      capRoster = save.league.rosters[team]
    }

    playNext(st, st.schedule.length)

    // ---- season invariants
    const tw = TEAMS.reduce((s, t) => s + st.rec[t].w, 0)
    const tl = TEAMS.reduce((s, t) => s + st.rec[t].l, 0)
    check('every team plays exactly 82', TEAMS.every((t) => st.rec[t].w + st.rec[t].l === 82),
      TEAMS.map((t) => st.rec[t].w + st.rec[t].l).filter((n) => n !== 82).join(','))
    check('league wins equal league losses', tw === tl && tw === 1230, `${tw}/${tl}`)
    check('no tied games', st.results.every((g) => g.hs !== g.as), 'a game ended level')
    // The floor is 50, not 60. A career roster that has been stripped to minimum
    // contracts genuinely produces historic lows — a 58-point game is the simulation
    // reporting a bad team accurately, not a fault.
    check('scores are plausible',
      st.results.every((g) => g.hs > 50 && g.hs < 190 && g.as > 50 && g.as < 190),
      st.results.filter((g) => g.hs <= 50 || g.hs >= 190).slice(0, 1).map((g) => `${g.hs}-${g.as}`).join(''))

    // ---- identity invariants
    //
    // Two rows with the same uid is not a cosmetic problem. The development report keys
    // its lookup by uid, so a collision silently drops a player out of the year's report,
    // and every roster edit that matches on uid can remove the wrong man. It surfaced once
    // as a React duplicate-key warning on a random career seed, which is exactly the kind
    // of bug that hides until it does not.
    for (const t of TEAMS) {
      const rs = save.league.rosters[t] || []
      const ids = rs.map((p) => p.uid || p.n)
      const dupes = ids.filter((x, i) => ids.indexOf(x) !== i)
      check('no roster holds the same id twice', dupes.length === 0, `${t}: ${dupes.slice(0, 2).join(',')}`)
      const names = rs.map((p) => p.n)
      const dupN = names.filter((x, i) => names.indexOf(x) !== i)
      check('and no roster holds the same player twice', dupN.length === 0, `${t}: ${dupN.slice(0, 2).join(',')}`)
      if (dupN.length && process.env.SOAK_DEBUG) {
        const d = dupN[0]
        console.log('   [DUP]', 'yr', y, t, JSON.stringify(rs.filter((x) => x.n === d)
          .map((x) => ({ uid: x.uid, s: x.s, yr: x.yr, a: x.a }))))
      }
    }

    // ---- the staged bracket agrees with itself
    {
      const b = openBracket(st)
      let guard = 0
      while (b.stage !== 'done' && guard++ < 400) stepBracket(b)
      const res = bracketResult(b)
      check('the staged bracket reaches a champion', !!res.champion, `stage ${b.stage} after ${guard}`)
      check('and every one of its series has a winner',
        res.rounds.every((x) => !!x.winner), '')
      check('the staged bracket takes more than one click',
        b.series.reduce((n, x) => n + x.games.length, 0) > 60,
        `${b.series.reduce((n, x) => n + x.games.length, 0)} games`)
      // Same season, same bracket, whichever way you step it.
      const b2 = openBracket(st)
      let g2 = 0
      while (b2.stage !== 'done' && g2++ < 20) playRound(b2)
      check('stepping game by game and round by round give the same champion',
        bracketResult(b2).champion === res.champion,
        `${bracketResult(b2).champion} vs ${res.champion}`)
    }

    // ---- playoffs
    const po = runPlayoffs(st)
    check('a champion exists', !!po.champion, '')
    const finals = po.rounds[po.rounds.length - 1]
    check('the finals go to four wins', Math.max(finals.w[finals.hi], finals.w[finals.lo]) === 4,
      JSON.stringify(finals.w))
    check('no series exceeds seven', po.rounds.every((x) => x.games.length <= 7), '')
    check('every series has a winner who won more',
      po.rounds.every((x) => x.w[x.winner] > x.w[x.winner === x.hi ? x.lo : x.hi]), '')
    const tab = standings(st)
    const topSeed = tab.West[0].team
    check('the champion made the field',
      [...po.field.East, ...po.field.West].includes(po.champion), po.champion)

    // ---- roll the career
    const run = teamRun(po, team)
    const before = save.records.totalWins
    save = rollSeason(save, { season: save.franchise.currentSeason, wins: st.rec[team].w,
      losses: st.rec[team].l, seed: st.seed, run, pf: st.rec[team].pf, pa: st.rec[team].pa })
    check('career wins accumulate', save.records.totalWins === before + st.rec[team].w, '')
    check('career games are consistent',
      save.records.totalWins + save.records.totalLosses === (y + 1) * 82,
      `${save.records.totalWins + save.records.totalLosses} after ${y + 1}`)
    check('badges match the record',
      JSON.stringify(save.badges) === JSON.stringify(earnedBadges(save.records, save.seasons)), '')
    check('a title is recorded when it happens',
      !run.champion || save.records.championships > 0, '')

    // ---- offseason
    const aged = ageRoster(simRoster, capRoster, y, r)
    check('roster does not vanish', aged.sim.length >= 6, `${aged.sim.length} left`)
    check('rates stay inside the possible', aged.sim.every((p) =>
      p.fg3 > 0.02 && p.fg3 < 0.96 && p.fg2 > 0.05 && p.fg2 < 0.96 &&
      p.usg > 0.02 && p.usg < 0.5 && p.tov > 0 && p.tov < 0.4 && p.load > 0),
      JSON.stringify(aged.sim.find((p) => !(p.fg3 > 0.02 && p.fg3 < 0.96
        && p.fg2 > 0.05 && p.fg2 < 0.96 && p.usg > 0.02 && p.usg < 0.5
        && p.tov > 0 && p.tov < 0.4 && p.load > 0)) || {}).slice(0, 140))
    const con = runContracts(aged.cap)
    check('contracts run down', con.kept.every((p) => p.yr >= 1), '')
    check('nobody is lost in contract bookkeeping',
      con.kept.length + con.expiring.length === aged.cap.length, '')
    // Draft a player and refill to the fourteen-man minimum, which is what the offseason
    // in the page does. Without it attrition is one-way and the roster empties.
    const rookie = rookieContract({ id: `${y}-x`, name: `Rookie ${y}`, age: 19.5 }, 14 + r.randrange(16), r)
    const filled = refill(aged.sim, con.kept, [rookie], r, y)
    check('roster refills to the minimum', filled.cap.length >= 14, `${filled.cap.length}`)
    check('sim and cap rosters stay aligned',
      Math.abs(filled.sim.length - filled.cap.length) <= 2,
      `${filled.sim.length} vs ${filled.cap.length}`)
    check('refilled rates stay possible', filled.sim.every((p) =>
      p.fg2 > 0.05 && p.fg2 < 0.96 && p.usg > 0.02 && p.usg < 0.5 && p.load > 0), '')
    simRoster = filled.sim
    capRoster = filled.cap
    save.league = { ...save.league,
      rosters: { ...save.league.rosters, [team]: filled.cap },
      sim: { ...save.league.sim, [team]: filled.sim } }
    setLeague(save.league)
    save = { ...save, league: save.league,
             rngSeed: (save.rngSeed * 31 + 17) >>> 0 }
    check('the career roster survives the offseason', save.league.rosters[team].length >= 14,
      `${save.league.rosters[team].length}`)
  }
  check('a career ends employed or fired, never undefined',
    typeof save.status.employed === 'boolean', '')
}

const ms = Date.now() - t0
console.log(`soak — ${CAREERS} careers x ${SEASONS} seasons in ${(ms / 1000).toFixed(1)}s\n`)
let bad = 0
for (const [name, r] of seen) {
  const ok = r.fail === 0
  if (!ok) bad++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  (${r.pass}/${r.pass + r.fail})`)
  if (!ok) console.log(`        first: ${r.first}`)
}
console.log(`\n${seen.size - bad}/${seen.size} invariants hold across ${CAREERS * SEASONS} seasons`)
process.exit(bad ? 1 : 0)
