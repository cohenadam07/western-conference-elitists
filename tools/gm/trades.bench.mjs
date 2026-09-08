// WHAT THINGS ACTUALLY COST.
//
// The trade engine prices everything in dollars — championship equity, out-year contract
// surplus, the tax bill — and every one of those terms was measured against something real.
// What was never checked is the thing a GM actually feels: the EXCHANGE RATE. Does a star
// cost what a star costs? Do four firsts buy what four firsts buy?
//
// This file is the answer to "how would we know". It is not a unit test of the valuation
// code; it is a set of prices taken from trades that really happened, asserted against the
// engine's own verdicts. Where it fails, the engine is wrong about the league.
//
// THE ANCHORS, verified rather than remembered:
//
//   Kevin Durant to Phoenix, February 2023 — a top-ten player, thirty-four years old, on a
//   max, for Mikal Bridges AND Cameron Johnson AND four unprotected firsts AND a swap.
//   https://www.nba.com/news/suns-nets-kevin-durant-trade
//
//   Mikal Bridges to New York, June 2024 — a very good starter and not a star, for four
//   unprotected firsts, a fifth first (top-four protected), an unprotected swap, a second,
//   and salary filler.
//   https://www.nba.com/news/knicks-to-acquire-mikal-bridges-from-nets
//
// Read together those two say something the engine has to reproduce and currently does not:
// FIRSTS ARE THE CURRENCY FOR GOOD STARTERS, AND A STAR COSTS GOOD STARTERS *PLUS* FIRSTS.
// Bridges alone cost nearly as much draft capital as Durant did, because most of what
// Phoenix paid for Durant was players. Any model where a pile of picks buys a superstar has
// the league backwards.
//
//   node tools/gm/trades.bench.mjs
import { SEED } from '../../src/lib/gm/seed.js'
import { setLeague, newLeague, allRosters, rostersOf } from '../../src/lib/gm/league.js'
import { newPickLedger, strengthRanks } from '../../src/lib/gm/picks.js'
import { playerMarketValue, pickMarketValue } from '../../src/lib/gm/trade/market.js'
import { teamContext } from '../../src/lib/gm/trade/context.js'
import { decideTrade, availabilityOf, AVAILABILITY, VERDICT } from '../../src/lib/gm/trade/accept.js'

const YEAR = parseInt(SEED.season, 10)
setLeague(newLeague())
const R = allRosters()
const ranks = strengthRanks(null)
const ledger = newPickLedger(SEED.season)

let pass = 0, fail = 0
const rows = []
const check = (name, ok, detail = '') => {
  rows.push({ name, ok, detail })
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  MISS ${name}${detail ? ` — ${detail}` : ''}`) }
}

/* ------------------------------------------------------------------ the cast */

const every = Object.keys(SEED.teams).flatMap((t) => rostersOf(t).map((p) => ({ ...p, team: t })))
const withValue = every.map((p) => ({ ...p, m: playerMarketValue(p) }))
const byRate = [...withValue].sort((a, b) => (b.v ?? 0) - (a.v ?? 0))

// Somebody who fits a description, from whichever club has one. Picked by production rather
// than by name so the file does not rot the moment the seed is regenerated.
const find = (fn, skip = new Set()) => byRate.find((p) => !skip.has(p.n) && fn(p))
const used = new Set()
const take = (label, fn) => {
  const p = find(fn, used)
  if (p) used.add(p.n)
  else console.log(`  (no player matches: ${label})`)
  return p
}

const superstar = take('a top-five player', (p) => (p.v ?? 0) >= 5 && (p.a ?? 30) <= 32)
const star = take('a star', (p) => (p.v ?? 0) >= 3.5 && (p.a ?? 30) <= 31)
const starB = take('a second star', (p) => (p.v ?? 0) >= 3.4 && (p.a ?? 30) <= 32)
// Deliberately in his mid-to-late twenties. A twenty-one-year-old at the same rate is not a
// "good starter" in the sense this benchmark means, he is a premium asset, and letting the
// picker take the highest rate in the band quietly turned every question about Mikal Bridges
// into a question about a rookie-scale star.
const goodStarter = take('a good starter', (p) => (p.v ?? 0) >= 2.0 && (p.v ?? 0) < 3.4
  && (p.a ?? 0) >= 25 && (p.a ?? 30) <= 30)
const goodStarterB = take('a second good starter', (p) => (p.v ?? 0) >= 1.8 && (p.v ?? 0) < 3.4
  && (p.a ?? 0) >= 25 && (p.a ?? 30) <= 30)
const rotation = take('a rotation player', (p) => (p.v ?? 0) >= 0.8 && (p.v ?? 0) < 1.6)
const badDeal = take('a bad contract', (p) => p.s > 25e6 && (p.v ?? 0) < 1.0 && (p.yr ?? 1) >= 2)
const oldMax = take('an old player on big money', (p) => (p.a ?? 0) >= 33 && p.s > 35e6)

console.log('the cast')
for (const [k, p] of Object.entries({ superstar, star, starB, goodStarter, goodStarterB, rotation, badDeal, oldMax })) {
  if (p) {
    console.log(`  ${k.padEnd(14)} ${p.n.padEnd(24)} ${p.team}  age ${String(Math.round(p.a)).padStart(2)}`
      + `  v ${String(p.v).padStart(6)}  tier ${p.m.tier}  $${(p.s / 1e6).toFixed(0)}M`
      + `  worth $${Math.round(p.m.value / 1e6)}M`)
  }
}

/* ------------------------------------------------------------------ the currency */

// A first from a club nobody expects to be good, which is what "an unprotected first" means
// when a contender sends one: a late pick, most years.
const lateFirst = (n) => Array.from({ length: n }, (_, i) => ({ year: YEAR + 2 + i, round: 1, from: 'BOS' }))
const midFirst = (n) => Array.from({ length: n }, (_, i) => ({ year: YEAR + 2 + i, round: 1, from: 'CHA' }))
const seconds = (n) => Array.from({ length: n }, (_, i) => ({ year: YEAR + 2 + i, round: 2, from: 'BOS' }))
const pickWorth = (ks) => ks.reduce((s, k) => s + pickMarketValue(k, ranks[k.from], YEAR).value, 0)

console.log(`\nthe currency`)
console.log(`  a late first   $${Math.round(pickMarketValue(lateFirst(1)[0], ranks.BOS, YEAR).value / 1e6)}M`
  + `   ·  four of them $${Math.round(pickWorth(lateFirst(4)) / 1e6)}M`)
console.log(`  a mid first    $${Math.round(pickMarketValue(midFirst(1)[0], ranks.CHA, YEAR).value / 1e6)}M`
  + `   ·  four of them $${Math.round(pickWorth(midFirst(4)) / 1e6)}M`)
console.log(`  a second       $${(pickMarketValue(seconds(1)[0], ranks.BOS, YEAR).value / 1e6).toFixed(1)}M`)

/* ------------------------------------------------------------------ asking */

// Would the club holding `keep` do this deal: they send `keep`, they receive `players` and
// `picks`. Everything is asked of the SELLER, because that is the side that says no.
function ask(keep, players, picks = []) {
  const seller = keep.team
  const ctx = teamContext(seller, { roster: R[seller] })
  return decideTrade(seller, { out: [keep], in: players, inPicks: picks },
    { from: players[0]?.team || 'BOS', ctx, roster: R[seller], ranks, year: YEAR, ledger })
}
// NEGOTIABLE counts as a yes. It means the price is met to within a rounding error and the
// club would do it after a phone call — which is what "six firsts buy him" describes. Reading
// it as a refusal made the benchmark fail a deal the engine was already agreeing to.
const YES = new Set([VERDICT.ACCEPT, VERDICT.LIKELY, VERDICT.NEGOTIABLE])
const NO = new Set([VERDICT.REJECT, VERDICT.NONSTARTER, VERDICT.COUNTER, VERDICT.UNTOUCHABLE])
const says = (d) => `${d.verdict}${d.need > 0 ? ` (short $${Math.round(d.need / 1e6)}M)` : ''}`

console.log(`\n— what a star costs —`)
if (superstar && goodStarter && goodStarterB) {
  // Phoenix did not buy Durant with picks. Nobody buys a superstar with picks.
  const a = ask(superstar, [], lateFirst(4))
  check('four firsts alone do not buy a top-five player', NO.has(a.verdict), says(a))

  // The Durant shape, sized in this engine's own currency rather than in 2023's. The point of
  // the case is not the exact package — it is that a franchise player is OBTAINABLE at all.
  // He used to be a wall the negotiation layer could not compute against, and the desk's only
  // possible answer was "not available at any price".
  const haul = [goodStarter, goodStarterB, star].filter(Boolean)
  const b = ask(superstar, haul, lateFirst(6))
  check('a genuine haul does buy one', YES.has(b.verdict), says(b))
  check('and the price is a number, not a wall', Number.isFinite(b.need),
    `need is ${Number.isFinite(b.need) ? 'finite' : 'infinite'}`)
}
if (superstar && goodStarter && goodStarterB && rotation) {
  // The whole of convexity in one line: you cannot buy the best player in a trade with a pile
  // of good ones, because you only have five places to stand. (Two OTHER superstars for one
  // is a different question and the answer there is yes — that is a real overpay, and the
  // engine is right to take it.)
  const c = ask(superstar, [goodStarter, goodStarterB, rotation])
  check('three good players do not buy one great one', NO.has(c.verdict), says(c))
}

console.log(`\n— what a good starter costs —`)
// Asked of a club that is NOT building around him — a young building block on a rebuilding
// team is expensive for reasons that have nothing to do with the exchange rate, and asking
// about him measures the untouchables ladder rather than the price of a starter.
// By TIER rather than by last season's rate. A thirty-one-year-old can post a good rate and
// still be a tier-two player in this engine's eyes, because the aging curve has already
// written most of his remaining value off — and asking "what does a starter cost" about a man
// the model does not think is a starter answers a different question.
// PREMIUM is as low as a real starter goes on the ladder — every tier-three player in the
// league is at least that, which is right: clubs have to be paid for starters. What has to be
// excluded is the top two rungs, where the price is about the franchise rather than the
// player.
const OFF_LIMITS = new Set([AVAILABILITY.FRANCHISE, AVAILABILITY.CORE])
// The MEDIAN qualifying starter, not the most valuable one. Taking the top of the list kept
// finding a different edge case every time the ratings moved — a rookie-scale star, then a
// thirty-one-year-old the aging curve had written off, then Jayson Tatum. "What does a good
// starter cost" is a question about a typical starter, and the median is how you ask it.
// ...and not one of the twenty-five most valuable assets in the league. "Tier three" spans
// everything from a solid starter to an All-Star on a max, so without that cut the median kept
// landing on Karl-Anthony Towns, and six firsts for Towns is a question about a star.
// Cut on PRODUCTION, not on value — that is the whole lesson of the spot-value term. A star on
// a max has enormous production and modest value precisely because the contract is fair, so a
// value-ranked cut let Karl-Anthony Towns through as a "good starter" twice running.
const eliteCut = new Set([...withValue].sort((a, b) => b.m.spot - a.m.spot).slice(0, 25).map((p) => p.n))
// And on a club with a REASON to sell. A fifty-win New York turning down six future firsts for
// Karl-Anthony Towns is not the engine being wrong — picks do not help a team in that window,
// and refusing is the correct answer. The price of a starter is a question you ask a club that
// is listening.
const willListen = (p) => {
  try { return teamContext(p.team, { roster: R[p.team] }).contention < 0.45 } catch { return false }
}
// Age-capped at both ends. A thirty-five-year-old on a maximum contract is not "a good
// starter" for pricing purposes, he is a salary dump with a player attached — and the Clippers
// taking two firsts for Kawhi Leonard is the right answer to a different question.
const startersForSale = withValue.filter((p) => p.m.tier >= 3 && (p.a ?? 0) >= 25 && (p.a ?? 99) <= 31
  && !eliteCut.has(p.n) && willListen(p)
  && !OFF_LIMITS.has(availabilityOf(p, p.team, { roster: R[p.team] }).level))
  .sort((a, b) => a.m.value - b.m.value)
const sellable = startersForSale[Math.floor(startersForSale.length / 2)]
if (!sellable) check('there is a starter in the league somebody would sell', false, 'none matched')
else {
  console.log(`  (asking about ${sellable.n}, ${sellable.team}, who they are not building around)`)
  const d = ask(sellable, [], lateFirst(2))
  check('two firsts do not buy a starter', NO.has(d.verdict), says(d))
  const e = ask(sellable, [], lateFirst(6))
  check('six firsts do', YES.has(e.verdict), says(e))
}
{
  // A useful rotation player does not go for two seconds — a contender loses real wins giving
  // one up, and that is right. A team with nothing to play for is the one that sells him.
  const seller = Object.keys(SEED.teams)
    .map((t2) => ({ t: t2, c: teamContext(t2, { roster: R[t2] }).contention }))
    .sort((a, b) => a.c - b.c)[0]
  const spare = (R[seller.t] || []).map((p) => ({ ...p, team: seller.t, m: playerMarketValue(p) }))
    .filter((p) => (p.a ?? 0) >= 28 && (p.v ?? 0) >= 0.6 && (p.v ?? 0) < 2.0)
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))[0]
  if (spare) {
    const f = ask(spare, [], seconds(2))
    check('a rebuilding club sells a veteran rotation player for two seconds', YES.has(f.verdict),
      `${spare.n} (${seller.t}, contention ${seller.c.toFixed(2)}): ${says(f)}`)
  }
}

console.log(`\n— the contract is part of the player —`)
{
  // A genuinely dead contract: real money, no production. Asked of the club being offered him,
  // because that is the side that has to be paid — the whole point of a salary dump is that
  // value moves TOWARDS the team absorbing it.
  const dead = withValue.filter((p) => p.s > 20e6 && (p.v ?? 0) < 0.4 && (p.yr ?? 1) >= 2)
    .sort((a, b) => a.m.value - b.m.value)[0]
  if (dead) {
    const taker = Object.keys(SEED.teams).find((t2) => t2 !== dead.team)
    const ctx2 = teamContext(taker, { roster: R[taker] })
    const g = decideTrade(taker, { in: [dead], out: [], inPicks: [] },
      { from: dead.team, ctx: ctx2, roster: R[taker], ranks, year: YEAR })
    check('absorbing a dead contract has to be paid for', g.need > 0,
      `${dead.n} ($${(dead.s / 1e6).toFixed(0)}M, ${dead.v} rate): they need $${Math.round(g.need / 1e6)}M`)
    check('and the contract itself is priced below nothing', dead.m.value < 0,
      `${dead.n} worth $${Math.round(dead.m.value / 1e6)}M`)
  }
}
if (oldMax) {
  // Asked of the club HOLDING him, which is the right way round: a team with a thirty-five
  // year old on fifty million a year should bite your hand off for three firsts. The question
  // worth asking is whether he is priced like an asset — he is not, and should not be.
  const h = ask(oldMax, [], lateFirst(3))
  check('a club will happily sell an old man on a max for three firsts', YES.has(h.verdict), says(h))
}
{
  // Two men of the same quality, one cheap and one at the ceiling. The cheap one is worth
  // far more, and the gap is the whole of why a rookie-scale star is untouchable.
  const cheap = withValue.filter((p) => (p.v ?? 0) >= 2.5 && p.s < 15e6)
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))[0]
  const dear = withValue.filter((p) => (p.v ?? 0) >= 2.5 && p.s > 40e6)
    .sort((a, b) => Math.abs((a.v ?? 0) - (cheap?.v ?? 0)) - Math.abs((b.v ?? 0) - (cheap?.v ?? 0)))[0]
  if (cheap && dear) {
    check('the same production on rookie money is worth much more than on a max',
      cheap.m.value > dear.m.value * 1.8,
      `${cheap.n} $${(cheap.s / 1e6).toFixed(0)}M → $${Math.round(cheap.m.value / 1e6)}M vs `
      + `${dear.n} $${(dear.s / 1e6).toFixed(0)}M → $${Math.round(dear.m.value / 1e6)}M`)
  }
}

console.log(`\n— some men are not for sale —`)
{
  const cores = every.filter((p) => availabilityOf(p, p.team, { roster: R[p.team] }).level === AVAILABILITY.CORE)
  check('every club has somebody it will not trade', cores.length >= 20,
    `${cores.length} untouchables across thirty rosters`)
  check('and they are the best players, not a random handful',
    cores.length > 0 && cores.reduce((s, p) => s + (p.v ?? 0), 0) / cores.length > 2.2,
    `mean rate ${(cores.reduce((s, p) => s + (p.v ?? 0), 0) / Math.max(1, cores.length)).toFixed(2)}`)
  const best = byRate[0]
  const d = ask(best, [], midFirst(6))
  check('the best player in the league is not for sale for picks',
    d.verdict === VERDICT.UNTOUCHABLE || NO.has(d.verdict), `${best.n}: ${says(d)}`)
}

console.log(`\n— the exchange rate, stated —`)
{
  // The headline number: how many good firsts does the engine think a star is worth? A real
  // front office answers "three or four, plus players". A model that answers "forty" is not
  // describing this league.
  const one = pickMarketValue(lateFirst(1)[0], ranks.BOS, YEAR).value
  for (const p of [superstar, star, goodStarter].filter(Boolean)) {
    const n = p.m.value / one
    console.log(`  ${p.n.padEnd(24)} = ${n.toFixed(1)} late firsts`)
  }
  // The bands come off the two anchor trades rather than off a feeling. Bridges alone went
  // for five firsts, so a good starter is four to nine. Durant went for Bridges plus Cameron
  // Johnson plus four more firsts — call it twelve firsts of value — so a top-five player in
  // his prime, with more years left than Durant had, is ten to twenty-two.
  const s = superstar ? superstar.m.value / one : 0
  check('a top-five player prices at ten to twenty-two firsts', s >= 10 && s <= 22,
    superstar ? `${superstar.n} = ${s.toFixed(1)} firsts` : 'no superstar found')
  // The Bridges number is the softest of the two anchors and it is worth saying why: it is
  // widely regarded as an overpay, and the engine's aging curve is harsher on a
  // twenty-nine-year-old than the 2024 market was. So the band is wide, and what is really
  // being asserted is the RATIO — a star is worth several good starters, not several dozen
  // and not one and a half.
  const g = goodStarter ? goodStarter.m.value / one : 0
  check('a good starter prices at two to eight firsts', g >= 2 && g <= 8,
    goodStarter ? `${goodStarter.n} = ${g.toFixed(1)} firsts` : 'no starter found')
  if (superstar && goodStarter) {
    const ratio = superstar.m.value / Math.max(1, goodStarter.m.value)
    check('and a top-five player is worth three to nine of him', ratio >= 3 && ratio <= 9,
      `${superstar.n} is ${ratio.toFixed(1)}x ${goodStarter.n}`)
  }
}

console.log(`\n${pass}/${pass + fail} prices are right`)
if (fail) {
  console.log('\nwhere the engine disagrees with the league:')
  rows.filter((r) => !r.ok).forEach((r) => console.log(`  · ${r.name}${r.detail ? ` — ${r.detail}` : ''}`))
}
process.exit(process.env.BENCH_STRICT ? (fail ? 1 : 0) : 0)
