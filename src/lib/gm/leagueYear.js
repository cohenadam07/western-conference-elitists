// THE LEAGUE'S OWN OFFSEASON.
//
// Until now exactly one roster in thirty aged, ran its contracts down, drafted anybody or
// lost a player to free agency: yours. Six simulated seasons in, Kevin Durant was still
// thirty-seven years old on the same contract, not one drafted rookie had ever joined an
// NBA team, and Cleveland had won three titles because nothing about Cleveland could
// change. A franchise game where the league is frozen is a single-player game with
// twenty-nine mannequins.
//
// This runs the same year for everybody else that you run for yourself: age, retire,
// expire, draft, sign, fill.
import { SEED } from './seed.js'
import { league, rostersOf, simOf } from './league.js'
import { ageRoster, runContracts, refill, rookieContract, labelRookie } from './offseason.js'
import { teamSalary, status, CBA } from './cap.js'
import { marketPrice } from './fa.js'

const MIN_ROSTER = 14

// A free agent's asking price, and what a team is willing to go to. Deliberately lighter
// than the trade engine's valuation: this runs for every free agent against every team,
// and the full utility model would take longer than the season it follows.
// The minimum is a real number and `CBA.min` was not one of the keys — the price came out
// NaN, every comparison against it was false, and the result was 229 free agents and zero
// signings a year until the actual NBA had washed out of the league entirely. Names matter.
const MIN_SALARY = 2_300_000

function ask(p) {
  const m = marketPrice(p.v ?? 0, p.a ?? 27, p.mpg ?? 20, p.exp ?? 5)
  return Math.max(MIN_SALARY, Math.round(Number.isFinite(m) ? m : MIN_SALARY))
}

// How much a team wants him: production, its own thinness at his position, and whether it
// can pay without crossing a line it cares about.
// `rosters` is the WORKING copy, not the live league. Reading the live one meant every
// team saw its original roster all through free agency, never noticed it was full, and
// signed without limit — the league went from 470 contracts to 838 in six years and a
// hoarding team won 79 games.
// BIRD RIGHTS are why most free agents re-sign. A team may exceed the cap to keep its own
// player and nobody else can match that without room — which is the single biggest reason
// the real league's free agency is not a jump ball. Without it, 82 of 96 free agents
// changed teams in one summer, which is not a basketball league.
export function maxOffer(team, p, rosters) {
  const roster = (rosters || {})[team] || rostersOf(team)
  const payroll = teamSalary(roster)
  const st = status(payroll)
  const room = CBA.cap - payroll
  const own = p && p.from === team
  if (own) return CBA.max_35                       // Bird rights: over the cap is allowed
  if (st.overApron2) return MIN_SALARY
  if (st.overApron1 || st.overTax) return Math.max(room, CBA.mle_tax)
  return Math.max(room, room > 0 ? CBA.mle_room : CBA.mle_nontax)
}

function appetite(team, p, price, r, rosters) {
  const roster = rosters[team] || []
  const payroll = teamSalary(roster)
  const st = status(payroll)
  const room = CBA.cap - payroll

  // Over the cap you can only offer the exception you actually have: the full mid-level
  // under the tax, the taxpayer one above it, and nothing at all above the second apron.
  if (roster.length >= 15) return -1
  if (price > maxOffer(team, p, rosters)) return -1

  const talent = (p.v ?? 0)
  const need = Math.max(0, MIN_ROSTER + 1 - roster.length) * 0.35
  const tax = st.overTax ? -0.6 : st.overApron1 ? -1.1 : 0
  return talent + need + tax + r.rand() * 0.5
}

/* --------------------------------------------------------------- the year */

// OPEN THE MARKET.
//
// Free agency used to happen entirely behind the user's back: every expiring contract in
// the league was signed somewhere before the offseason screen was drawn, and the only
// players a GM could ever sign were the ones already on his own payroll. In a game about
// running a front office, that removes the single most famous thing a front office does.
//
// So the league year now stops here. Aging, retirements and the draft are applied; the
// free agents are handed back unsigned, and nobody moves until the market is resolved
// with the user's offers on the table alongside everyone else's.
export function openFreeAgency(save, opts = {}) {
  return runLeagueYear(save, { ...opts, hold: true })
}

// What a player wants, so the user can see the number he is bidding against.
export { ask as askingPrice }

// RESOLVE IT. Every free agent weighs what he has been offered — the user's bid and each
// interested team's — and signs. Money matters most and it is not the only thing: a
// player takes less to join a team that is going somewhere, and he leans toward staying
// where he already is.
export function resolveFreeAgency(save, opts = {}) {
  const r = opts.r
  const mine = save.franchise.team
  const pool = opts.pool || []
  const offers = opts.offers || {}          // { [playerUid]: { salary, years } }
  const L = league()
  const rosters = { ...L.rosters }
  const sim = { ...L.sim }
  const teams = Object.keys(SEED.teams).filter((t) => t !== mine)
  const strength = {}
  for (const t of Object.keys(SEED.teams)) {
    strength[t] = (rosters[t] || []).reduce((a, p) => a + Math.max(0, p.v ?? 0), 0)
  }
  const maxStrength = Math.max(1, ...Object.values(strength))
  const signings = []

  pool.sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
  for (const p of pool) {
    const price = ask(p)
    const bids = []
    for (const t of teams) {
      const a = appetite(t, p, price, r, rosters)
      if (a > 0) bids.push({ team: t, salary: price, fit: a })
    }
    // The user bids under the same rules as everyone else: room, or the exception he has,
    // or Bird rights on his own player. An offer he cannot legally make is not an offer.
    const mineOffer = offers[p.uid] || offers[`${p.n}|${p.from}`]
    if (mineOffer && (rosters[mine] || []).length < 15) {
      const cap = maxOffer(mine, p, rosters)
      const salary = Math.min(mineOffer.salary, cap)
      if (salary >= MIN_SALARY) {
        bids.push({ team: mine, salary, years: mineOffer.years, fit: 1.2, user: true,
          trimmed: salary < mineOffer.salary })
      }
    }
    if (!bids.length) continue

    // What the player is actually choosing between.
    let best = null
    for (const b of bids) {
      const money = b.salary / Math.max(1, price)
      const winning = 0.6 + 0.4 * (strength[b.team] / maxStrength)
      // Staying is the default in the real league — familiarity, the extra year and the
      // larger raises a team can offer its own player. Leaving is the exception.
      const loyalty = b.team === p.from ? 1.3 : 1
      const score = money * winning * loyalty * (0.92 + r.rand() * 0.16)
      if (!best || score > best.score) best = { ...b, score }
    }
    const years = best.years || ((p.v ?? 0) > 2 ? 3 : (p.v ?? 0) > 0.7 ? 2 : 1)
    rosters[best.team] = [...(rosters[best.team] || []), {
      ...p, s: best.salary, yr: years, o: null,
      uid: `${best.team}-fa-${opts.year || 0}-${signings.length}`,
    }]
    const prof = (sim[p.from] || []).find((x) => x.n === p.n)
    if (prof && best.team !== p.from) sim[best.team] = [...(sim[best.team] || []), prof]
    signings.push({ player: p, team: best.team, salary: best.salary, years, user: !!best.user,
      stayed: best.team === p.from, bidders: bids.length })
  }

  // Nobody plays a season a man short.
  for (const team of Object.keys(SEED.teams)) {
    if (team === mine) continue
    if ((rosters[team] || []).length >= MIN_ROSTER) continue
    const filled = refill(sim[team] || [], rosters[team] || [], [], r, opts.year || 2027, MIN_ROSTER)
    rosters[team] = filled.cap
    sim[team] = filled.sim
  }

  L.rosters = rosters
  L.sim = sim
  return {
    league: { ...L },
    signings,
    mine: signings.filter((s) => s.user),
    news: signings
      .filter((s) => !s.stayed && (s.player.v ?? 0) > 1.6)
      .slice(0, 6)
      .map((s) => `<b>${s.player.n}</b> signs with ${SEED.teams[s.team]?.name || s.team}.`),
  }
}

export function runLeagueYear(save, opts = {}) {
  const r = opts.r
  const year = opts.year ?? (parseInt(SEED.season, 10) + 1)
  const yearIndex = opts.yearIndex ?? 0
  const mine = save.franchise.team
  const L = league()
  const rosters = { ...L.rosters }
  const sim = { ...L.sim }

  const pool = []          // free agents, league-wide
  const retired = []
  const news = []

  // 1. Everybody ages, and some careers end.
  for (const team of Object.keys(SEED.teams)) {
    if (team === mine) continue                     // yours is run by the offseason screen
    const aged = ageRoster(sim[team] || [], rosters[team] || [], yearIndex, r)
    for (const d of aged.departed) retired.push({ ...d, team })
    const { kept, expiring } = runContracts(aged.cap)
    rosters[team] = kept
    sim[team] = aged.sim
    for (const p of expiring) pool.push({ ...p, from: team })
  }

  // 2. Draft picks become players — but not all sixty. Every first-rounder gets a
  //    guaranteed deal; most second-rounders never sign a standard contract, and putting
  //    all sixty on rosters every year dragged the league's mean age down to twenty-two
  //    inside six seasons.
  for (const pick of opts.draftPicks || []) {
    if (!pick.prospect || pick.team === mine) continue
    if (pick.round === 2 && r.rand() > 0.3) continue
    const entry = labelRookie(rookieContract(pick.prospect, pick.overall, r))
    if (!entry?.cap) continue
    rosters[pick.team] = [...(rosters[pick.team] || []), { ...entry.cap, uid: `${pick.team}-rk-${pick.overall}` }]
    if (entry.sim) sim[pick.team] = [...(sim[pick.team] || []), entry.sim]
  }

  // Held for the market, if the caller wants the user in it.
  if (opts.hold) {
    L.rosters = rosters
    L.sim = sim
    pool.sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
    return { league: { ...L }, retired, pool, signed: 0, poolSize: pool.length, news: [] }
  }

  // 3. Free agency. Best players choose first, from whoever will have them — which is what
  //    makes a good team's cap sheet matter and a bad team's money matter.
  pool.sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
  const teams = Object.keys(SEED.teams).filter((t) => t !== mine)
  let signed = 0
  for (const p of pool) {
    const price = ask(p)
    let best = null
    for (const t of teams) {
      const a = appetite(t, p, price, r, rosters)
      if (a > 0 && (!best || a > best.a)) best = { t, a }
    }
    if (!best) continue
    // He usually re-signs where he was if the money is close; players move, but not at random.
    const stay = p.from !== mine && appetite(p.from, p, price, r, rosters)
    const dest = stay > 0 && stay > best.a * 0.82 ? p.from : best.t
    const years = (p.v ?? 0) > 2 ? 3 : (p.v ?? 0) > 0.7 ? 2 : 1
    rosters[dest] = [...(rosters[dest] || []), {
      ...p, s: price, yr: years, o: null, uid: `${dest}-fa-${year}-${signed}`,
    }]
    const prof = (sim[p.from] || []).find((x) => x.n === p.n)
    if (prof && dest !== p.from) sim[dest] = [...(sim[dest] || []), prof]
    if (dest !== p.from && (p.v ?? 0) > 1.6) {
      news.push(`<b>${p.n}</b> signs with ${SEED.teams[dest]?.name || dest}.`)
    }
    signed++
  }

  // 4. Nobody plays a season a man short.
  for (const team of teams) {
    if ((rosters[team] || []).length >= MIN_ROSTER) continue
    const filled = refill(sim[team] || [], rosters[team] || [], [], r, year, MIN_ROSTER)
    rosters[team] = filled.cap
    sim[team] = filled.sim
  }

  L.rosters = rosters
  L.sim = sim
  return {
    league: { ...L },
    retired,
    signed,
    poolSize: pool.length,
    news: news.slice(0, 6),
  }
}
