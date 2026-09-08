// LAYER THREE — team-specific utility.
//
// Not "what is this player worth" but "what is he worth to THIS team, right now". The
// same player is a different asset to a 59-win team with a 30-year-old core than to a
// 29-win team whose best player is 22, and that gap is where trades come from.
//
// Three currencies, all in dollars so they can be added:
//
//   championship equity — what this season's on-court change does to title and playoff
//                         odds, through the measured fit model. This is the win curve.
//   future value        — out-year contract surplus, team control, and draft capital,
//                         weighted by how far this team's horizon reaches.
//   financial           — payroll, the tax bill, and the apron consequences.
import { SEED } from '../seed.js'
import { rostersOf } from '../league.js'
import { teamSalary, status, CBA } from '../cap.js'
import { fitNet, winsFromNet, titleOdds, playoffOdds, teamContext } from './context.js'
import { playerMarketValue, pickMarketValue, productionValue, projection, DISCOUNT } from './market.js'

// A title is the point of the exercise, so it dominates — but only where it is actually
// in reach, which is what makes the curve steep in the 50s and flat at 30 wins.
const TITLE_WORTH = 900e6
const PLAYOFF_WORTH = 150e6
const BASE_WIN_WORTH = 2.2e6

const MONEY_WEIGHT = 0.45
const MONEY_CAP = 45e6

export const equityOf = (wins) => TITLE_WORTH * titleOdds(wins)
  + PLAYOFF_WORTH * playoffOdds(wins) + BASE_WIN_WORTH * wins

// How much this organisation cares about this season versus the ones after it.
export const nowWeight = (ctx) => 0.55 + 0.95 * ctx.urgency
export const laterWeight = (ctx) => 0.5 + 1.0 * ctx.futureOrientation

/* ------------------------------------------------------------ the tax bill */

export function taxBill(total) {
  let over = Math.max(0, total - CBA.tax), bill = 0
  const rates = [1.5, 1.75, 2.5, 3.25]
  for (let i = 0; i < rates.length && over > 0; i++) {
    const band = Math.min(over, 5_000_000)
    bill += band * rates[i]; over -= band
  }
  return bill + over * 3.75
}

// Being over an apron costs more than money — it costs the tools: the mid-level, the
// ability to aggregate salaries, sign-and-trade, a future first that freezes. Priced as
// what a team would rationally pay to keep them.
//
// Ramped rather than stepped. A step function made taking on $11M cost a team $60M the
// moment it crossed a line, which is not how a front office behaves — it is how a bug
// behaves. And the tools are worth most to a team that intends to use them, so the cost
// scales with how close to contending it is.
const ramp = (x, at, over) => Math.max(0, Math.min(1, (x - at) / over))
function apronCost(total, ctx) {
  const want = 0.35 + 0.75 * (ctx?.contention ?? 0.5)
  return (ramp(total, CBA.apron1 - 4e6, 8e6) * 20e6
    + ramp(total, CBA.apron2 - 4e6, 8e6) * 34e6) * want
}

/* --------------------------------------------------------- future value of assets */

// A rebuilding team's asset is the PLAYER, not the discount on his contract.
//
// This term only counted out-year contract surplus, so a 25-year-old starter on a fair
// deal cost a rebuilder nothing to give away — his surplus is zero by definition and his
// current wins are worth nothing to a 30-win team. That is how Portland ended up trading
// Deni Avdija for a worse 20-year-old and a late first. What a rebuilder is actually
// buying is production in the seasons when it is good again, which is a different
// quantity from surplus and has to be priced as one.
const FUTURE_PRODUCTION = 0.4

function futureValueOfPlayer(p, ctx) {
  const m = playerMarketValue(p)
  // Year 0 is priced as championship equity below, so only the out-years and the control
  // premium count here. Otherwise a contender pays twice for the same season.
  const outYears = m.perYear.slice(1).reduce((s, y) => s + y.net, 0)
  const proj = projection(p, 5)
  const years = Math.max(1, Math.min(5, p.yr || 1))
  let later = 0
  // Only the seasons you actually hold him for. Counting five years of production on a
  // two-year contract valued a rebuild's window at a player it will not have when the
  // window opens — and a rebuilding team ended up wanting a 31-year-old MORE than a
  // contender did.
  for (let y = 1; y < Math.min(proj.length, years); y++) {
    later += productionValue(proj[y].vorp) * (proj[y].survive ?? 0.7) * Math.pow(DISCOUNT, y)
  }
  // And a player who will be 34 when the rebuild finishes is not part of the rebuild.
  const age = p.a ?? 26
  const stillThere = Math.max(0, 1 - Math.max(0, age - 27) * 0.14)
  return outYears + m.control
    + later * FUTURE_PRODUCTION * (ctx?.futureOrientation ?? 0.5) * stillThere
}

/* --------------------------------------------------------------- the change */

// `change` is what this team gives and gets: players in and out, picks in and out.
export function changeUtility(team, change, opts = {}) {
  const ctx = opts.ctx || teamContext(team, opts)
  const roster = opts.roster || rostersOf(team)
  const inP = change.in || [], outP = change.out || []
  const inK = change.inPicks || [], outK = change.outPicks || []
  const ranks = opts.ranks || {}
  const year = opts.year ?? parseInt(SEED.season, 10)

  const keyOf = (p) => p.uid || `${p.n}|${p.s}`
  const going = new Set(outP.map(keyOf))
  const after = roster.filter((p) => !going.has(keyOf(p))).concat(inP)

  // 1. championship equity, through the fit model
  const beforeNet = fitNet(roster).net
  const afterNet = fitNet(after).net
  const beforeWins = winsFromNet(beforeNet)
  const afterWins = winsFromNet(afterNet)
  const equity = (equityOf(afterWins) - equityOf(beforeWins)) * nowWeight(ctx)

  // 2. future value
  const lw = laterWeight(ctx)
  let future = 0
  for (const p of inP) future += futureValueOfPlayer(p, ctx) * lw
  for (const p of outP) future -= futureValueOfPlayer(p, ctx) * lw
  let capital = 0
  for (const k of inK) capital += pickMarketValue(k, ranks[k.from], year).value * lw
  for (const k of outK) capital -= pickMarketValue(k, ranks[k.from], year).value * lw

  // 3. financial
  const beforeTotal = teamSalary(roster)
  const afterTotal = teamSalary(after)
  // A contender eats the tax; a lottery team refuses to pay it for nothing.
  //
  // `salaryNeutral` answers a different question: how much does this team WANT the player,
  // setting aside the money. Without it, asking 29 teams what they think of a $50M
  // expiring contract gets 24 shrugs — not because nobody wants the player but because the
  // question was posed as "would you take him on for nothing back", which no team over the
  // cap can. In a real trade the salary goes out as well as in, and that is handled when
  // the package is actually built.
  const conserv = 0.5 + 0.85 * (1 - ctx.contention)
  const raw = -((taxBill(afterTotal) - taxBill(beforeTotal)) * conserv
    + (apronCost(afterTotal, ctx) - apronCost(beforeTotal, ctx)))
  // Tax dollars are real, but they are not championship-equity dollars, and a front
  // office will not hand over a starter to save them. Unweighted and uncapped, cap relief
  // was worth more than any player on the roster: Portland scored $48M for shedding
  // salary and gave up its best young wing to get it.
  const money = opts.salaryNeutral ? 0
    : Math.max(-MONEY_CAP, Math.min(MONEY_CAP, raw * MONEY_WEIGHT))

  const delta = equity + future + capital + money
  return {
    delta,
    components: { equity, future, capital, money },
    wins: { before: beforeWins, after: afterWins, delta: afterWins - beforeWins },
    net: { before: beforeNet, after: afterNet },
    payroll: { before: beforeTotal, after: afterTotal },
    ctx,
  }
}

// What one asset is worth to one team — the question the trade finder asks 29 times.
export function assetUtility(asset, team, opts = {}) {
  const change = asset.kind === 'pick' ? { inPicks: [asset.pick] } : { in: [asset.player ?? asset] }
  const u = changeUtility(team, change, { salaryNeutral: true, ...opts })
  return { value: u.delta, components: u.components, wins: u.wins.delta, ctx: u.ctx }
}

// What a team would need to be paid to give an asset up — which is not the same number,
// because giving up your starting centre costs you the minutes he was playing.
export function assetCost(asset, team, opts = {}) {
  const change = asset.kind === 'pick' ? { outPicks: [asset.pick] } : { out: [asset.player ?? asset] }
  const u = changeUtility(team, change, { salaryNeutral: true, ...opts })
  return { value: -u.delta, components: u.components, wins: u.wins.delta, ctx: u.ctx }
}
