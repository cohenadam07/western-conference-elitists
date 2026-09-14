// THE BOARDS MUST RANK WHAT THEY VERIFIED.
//
// Three separate failures lived here at once, and all three were silent:
//
//  1. api/gm.js threw on import — englishDataset was spread instead of built — so every
//     request to the endpoint failed before a line of it ran.
//  2. The client wrote schema 2 and the server accepted only schema 1, so any save that
//     did reach it came back 400 and pushCareer swallowed the error.
//  3. gm:titles and gm:wins were ZADDed from save.records.*, numbers the client simply
//     asserts, while the replay that was supposed to justify them checked only the last
//     season's win total. Play one honest season, post championships: 99, top the board.
//
// And underneath all of it: a season is a function of (seed, the league that played it),
// and the server only ever received the seed.
import { newLeague, setLeague } from '../../src/lib/gm/league.js'
import { newSeason, playNext } from '../../src/lib/gm/season.js'
import { runPlayoffs } from '../../src/lib/gm/playoffs.js'
import { SAVE_VERSION, ACCEPTED_VERSIONS } from '../../src/lib/gm/schema.js'
import { replaySeason, leagueIsLegal, verifyNewest, emptyTally } from '../../api/gm.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m) } }
const TEAM = 'OKC'

// The client and the server must agree on the save format, by construction.
ok(ACCEPTED_VERSIONS.includes(SAVE_VERSION),
  `the server accepts what the client writes (writes ${SAVE_VERSION}, accepts ${ACCEPTED_VERSIONS.join(',')})`)

// --- a real season, played the way the game plays one ---
setLeague(newLeague())
const base = newLeague()
setLeague(base)
const st = newSeason(555001)
playNext(st, st.schedule.length)
const po = runPlayoffs(st)
const truth = {
  season: '2026-27', seed: 555001,
  wins: st.rec[TEAM].w, losses: st.rec[TEAM].l,
  champion: po.champion === TEAM,
}

// 1. The replay reproduces it when given the league that played it.
{
  const r = replaySeason(TEAM, truth, base)
  ok(r.ok, `an honest season reproduces (${r.ok ? `${r.wins}-${r.losses}` : r.why})`)
  ok(r.wins === truth.wins && r.losses === truth.losses, 'the replayed record matches the claim')
  ok(r.champion === truth.champion, 'the postseason is replayed too, not taken on trust')
}

// 2. A forged record does not.
{
  const lie = { ...truth, wins: 73, losses: 9 }
  const r = replaySeason(TEAM, lie, base)
  ok(!r.ok, `an invented 73-9 is rejected (${r.why || 'accepted!'})`)
}

// 3. THE EXPLOIT. Inflated career records must not reach a board.
{
  const seasons = [truth]
  const res = verifyNewest(TEAM, seasons, base, null)
  ok(res.verified, 'an honest career verifies')
  ok(res.tally.wins === truth.wins, `the tally counts the REPLAYED wins (${res.tally.wins})`)
  ok(res.tally.titles === (truth.champion ? 1 : 0), 'titles come from the replayed postseason')
  // whatever the client claims about itself is simply not consulted
  const inflated = { records: { championships: 99, totalWins: 5000, bestRecord: { wins: 82 } } }
  ok(!JSON.stringify(res.tally).includes('99') && res.tally.wins !== 5000,
    'nothing the client asserts about its own career appears in the tally')
  ok(res.tally.titles <= 1, `a career claiming 99 titles still ranks ${res.tally.titles}`)
  void inflated
}

// 4. No roster state sent = not verified. This is the case that used to pass silently.
{
  const res = verifyNewest(TEAM, [truth], null, null)
  ok(!res.verified, `a claim with no roster state is refused (${res.why})`)
}

// 5. Gaps are reported, not skipped.
{
  const prev = { ...emptyTally(), through: 1 }
  const res = verifyNewest(TEAM, [truth, truth, truth], base, prev)
  ok(!res.verified, 'a career that skipped a season does not advance')
  ok(/never arrived|through season/.test(res.why || ''), `the gap is named (${res.why})`)
  ok(res.pending === 2, `pending reports how far behind the board is (${res.pending})`)
}

// 6. An impossible league is refused.
{
  ok(leagueIsLegal(base).ok, 'the real league is legal')
  const cloned = { ...base, rosters: { ...base.rosters } }
  const a = cloned.rosters.DEN, b = cloned.rosters.OKC
  cloned.rosters = { ...cloned.rosters, OKC: [...b, a[0]] }  // same man, two clubs
  const r = leagueIsLegal(cloned)
  ok(!r.ok, `a player on two rosters is caught (${r.why || 'allowed!'})`)

  const stacked = { ...base, rosters: { ...base.rosters, OKC: base.rosters.OKC.slice(0, 3) } }
  ok(!leagueIsLegal(stacked).ok, 'a three-man roster is caught')

  const rich = { ...base, rosters: { ...base.rosters,
    OKC: base.rosters.OKC.map((p, i) => (i ? p : { ...p, s: 400e6 })) } }
  ok(!leagueIsLegal(rich).ok, 'an impossible contract is caught')

  ok(!leagueIsLegal(null).ok, 'no league at all is caught')
  ok(!leagueIsLegal({ sim: {}, rosters: {} }).ok, 'an empty league is caught')
}

console.log(`\nleaderboard: ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
