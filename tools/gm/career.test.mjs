// DOES A DECADE READ LIKE BASKETBALL?
//
// The soak proves a career's data holds together — no duplicate ids, no illegal trades, every
// team plays 82. None of it asks whether ten years of the league would look right to somebody
// who follows it. This does: it runs the offseason the way the app runs it and then reads the
// league the way a fan would.
//
// Written after an audit of the same question produced four alarming findings in a row — the
// league ageing to 21, rosters collapsing to two men, no real player surviving six seasons —
// every one of which was the AUDIT failing to do something the app does. That is the point of
// this file: it mirrors the real flow, so its answers are about the game.
//
//   node tools/gm/career.test.mjs [seasons]
import { SEED } from '../../src/lib/gm/seed.js'
import { newLeague, setLeague, rostersOf, simOf } from '../../src/lib/gm/league.js'
import { rng } from '../../src/lib/gm/sim.js'
import { newSeason, playNext, standings, TEAMS } from '../../src/lib/gm/season.js'
import { runPlayoffs } from '../../src/lib/gm/playoffs.js'
import { runContracts, ageRoster, refill, rollSeason } from '../../src/lib/gm/offseason.js'
import { openFreeAgency, resolveFreeAgency } from '../../src/lib/gm/leagueYear.js'
import { runDraft, generateClass, runLottery } from '../../src/lib/gm/draft.js'
import { enrich } from '../../src/lib/gm/prospects.js'
import { newCareer } from '../../src/lib/gm/storage.js'
import { refillLeague } from '../../src/lib/gm/trades.js'
import { cpuFillFromPool } from '../../src/lib/gm/pool.js'
import { talentVorp } from '../../src/lib/gm/trade/market.js'

const SEASONS = Number(process.argv[2] || 8)
let n = 0, bad = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  FAIL ' + m) } }

setLeague(newLeague())
const mine = 'BOS'
let save = newCareer({ gm: { name: 'Audit' }, team: mine, preset: 'guided',
  levels: { ...SEED.presets.guided.levels }, seed: 909 })

const realNames = new Set()
for (const rs of Object.values(SEED.rosters)) for (const p of rs) realNames.add(p.n)

const champs = [], ages = [], spreads = [], smallest = []

for (let y = 0; y < SEASONS; y++) {
  const r = rng(700 + y * 131)
  const st = newSeason((save.rngSeed + y * 7919) >>> 0)
  while (st.played < st.schedule.length) playNext(st, 400)
  const po = runPlayoffs(st, rng((save.rngSeed ^ 0xbeef ^ y) >>> 0))
  champs.push(po.champion)
  const tab = standings(st)
  const wins = [...tab.East, ...tab.West].map((x) => x.w)
  spreads.push([Math.min(...wins), Math.max(...wins)])

  const all = []
  for (const t of TEAMS) for (const p of rostersOf(t)) all.push({ t, p, v: talentVorp(p) })
  ages.push(all.reduce((s, x) => s + (x.p.a || 26), 0) / all.length)
  smallest.push(Math.min(...TEAMS.map((t) => rostersOf(t).length)))

  // ---- the offseason, in the order the app runs it ----
  const year = parseInt(save.franchise.currentSeason, 10) + 1
  const aged = ageRoster(simOf(mine), rostersOf(mine), save.records.seasonsCompleted, r)
  const { kept } = runContracts(aged.cap)
  const worstFirst = TEAMS.slice().sort((a, b) => st.rec[a].w - st.rec[b].w)
  const lot = runLottery(worstFirst, r)
  const cls = enrich(generateClass(r, 60, year), r)
  let draftRes
  try { draftRes = runDraft(lot, cls, r, mine) } catch { draftRes = { picks: [] } }

  // The rest of the league ages, retires and drafts, and its free agents go on the market.
  const opened = openFreeAgency({ ...save, league: save.league }, {
    r, year, yearIndex: save.records.seasonsCompleted, draftPicks: draftRes.picks })
  setLeague(opened.league)
  // AND THE MARKET CLEARS. Held open and never resolved, every expiring contract in the
  // league evaporates each summer and synthetic filler takes its place.
  const res = resolveFreeAgency({ ...save, league: opened.league },
    { r, pool: opened.pool, year, offers: {} })
  setLeague(res.league)

  const filled = refill(aged.sim, kept, [], r, year, 14)
  const L = res.league
  L.rosters = { ...L.rosters, [mine]: filled.cap }
  L.sim = { ...L.sim, [mine]: filled.sim }
  setLeague(L)
  save = rollSeason({ ...save, league: L }, { season: save.franchise.currentSeason,
    wins: st.rec[mine].w, losses: st.rec[mine].l, seed: st.seed,
    run: { made: true, seriesWon: 1, confTitle: false, champion: po.champion === mine },
    pf: st.rec[mine].pf, pa: st.rec[mine].pa })
  save.league = L
  // The app refills CPU rosters at every phase change.
  let fs = refillLeague({ ...save, league: L }, r, year, 14)
  fs = cpuFillFromPool(fs, r)
  setLeague(fs.league)
  save = { ...save, league: fs.league }
}

/* ------------------------------------------------------- what a fan would notice */

// The league does not get young, and does not get old.
for (const [i, a] of ages.entries()) {
  ok(a >= 24.5 && a <= 28, `year ${i + 1} the league is a normal age (${a.toFixed(1)})`)
}
ok(Math.abs(ages[ages.length - 1] - ages[0]) < 2,
  `age does not drift across a decade (${ages[0].toFixed(1)} → ${ages[ages.length - 1].toFixed(1)})`)

// Everybody can field a team.
for (const [i, s] of smallest.entries()) {
  ok(s >= 12, `year ${i + 1} every club can field a side (smallest ${s})`)
}

// The season still separates good teams from bad, without inventing a 5-win club.
for (const [i, [lo, hi]] of spreads.entries()) {
  ok(lo >= 8 && lo <= 30, `year ${i + 1} the worst team is bad, not broken (${lo})`)
  ok(hi >= 50 && hi <= 78, `year ${i + 1} the best team is good, not absurd (${hi})`)
}

// Somebody different wins it. A league where one club wins every year is not a league.
ok(new Set(champs).size >= Math.max(2, Math.floor(SEASONS / 3)),
  `the title moves around (${new Set(champs).size} winners in ${SEASONS}: ${champs.join(', ')})`)
ok(champs.every(Boolean), 'every season produces a champion')

// THE ONE THAT MATTERS. After a decade the best players should still mostly be men you have
// heard of, developed forward — not a league of invented twenty-one-year-olds. This is what
// fails first if the aging curve, the draft or free agency drifts.
{
  const final = []
  for (const t of TEAMS) for (const p of rostersOf(t)) final.push({ p, v: talentVorp(p), real: realNames.has(p.n) })
  final.sort((a, b) => b.v - a.v)
  const top50 = final.slice(0, 50)
  const realTop = top50.filter((x) => x.real).length
  // The floor DECAYS with the horizon, because a league where the 2026 cohort still owned the
  // top fifty after a decade would be the broken one — twelve draft classes ought to produce
  // stars. Measured: 44 of 50 after eight seasons, 22 after twelve. What must not happen is
  // the collapse, where invented twenty-one-year-olds take over inside six years.
  const floor = Math.max(10, 50 - SEASONS * 3)
  ok(realTop >= floor,
    `the league's best are still mostly men you have heard of (${realTop}/50 real, floor ${floor})`)
  const best = final[0]
  ok(best.real, `and the best player in the league is one of them (${best.p.n}, ${Math.round(best.p.a)})`)
  ok(best.v > 3, `who is a genuine star (vorp ${best.v.toFixed(2)})`)

  // Talent peaks in the late twenties, the way it does in life.
  const byAge = {}
  for (const x of final) { const a = Math.round(x.p.a); (byAge[a] = byAge[a] || []).push(x.v) }
  const mean = (a) => (byAge[a] || []).reduce((s, v) => s + v, 0) / Math.max(1, (byAge[a] || []).length)
  const young = [20, 21, 22].map(mean).reduce((s, v) => s + v, 0) / 3
  const prime = [26, 27, 28, 29].map(mean).reduce((s, v) => s + v, 0) / 4
  ok(prime > young, `a prime-age player is better than a rookie (${prime.toFixed(2)} vs ${young.toFixed(2)})`)
}

console.log(`career: ${n - bad}/${n}`)
process.exit(bad ? 1 : 0)
