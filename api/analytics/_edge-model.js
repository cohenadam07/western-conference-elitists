// Edge Lab — the arithmetic. Pure functions only: no network, no storage, so every number the
// page shows can be checked by tools/edge/check.mjs on its own.
//
//   - the WCE model arm: a player's WCE projection (savant-proj.json, the Fantasy tab's
//     rest-of-season line) turned into a probability for "reaches N+" with a negative
//     binomial whose spread comes from his own game log, shrunk toward a per-stat prior
//   - Kalshi's taker fee
//   - the bet rule: per player per game, the one market and side with the largest edge after
//     the fee, at the price you could actually get (the ask), if it clears the threshold
//   - settlement: P&L, closing line value, and the per-game aggregates the page adds up
//
// Not a function itself: Vercel skips api files that start with an underscore.

// The three arms the test started with. They are the head-to-head scoreboard; everything added
// since is an experiment (below), scored only from the day it started.
export const ARMS = ['model', 'claude_wce', 'claude_box']
// Every forecaster: the three above plus Claude arms added as experiments. Each prices every
// market, so each has forecasts to score.
export const CLAUDE_FORECASTERS = ['claude_wce', 'claude_box', 'claude_rc']
export const FORECASTERS = ['model', ...CLAUDE_FORECASTERS]
export const ARM_LABEL = {
  model: 'WCE model (no Claude)',
  claude_wce: 'Claude + WCE analytics',
  claude_box: 'Claude, box scores only',
  claude_rc: 'Claude + WCE + its own report card',
}
// The experiments that are forecasters rather than rules, with the day each started.
export const FORECASTER_EXPERIMENTS = {
  claude_rc: {
    name: 'Claude + WCE + report card',
    hypothesis: 'Claude + WCE, shown its own track record (calibration, its lean against the market, its record by stat) before each game, corrects its own mistakes and forecasts better than Claude + WCE without it. Its control is Claude + WCE on the same games.',
    success: 'CLV t past the bar over 300+ bets; and a better Brier score than Claude + WCE on the same games.',
  },
}

export const STATS = ['pts', 'reb', 'ast', 'fg3m', 'pra']

// Kalshi's taker fee on a quadratic series (fee_type "quadratic", multiplier 1, which is what
// KXNBAPTS / REB / AST / 3PT / PRA carry): 0.07 x contracts x P x (1 - P), rounded up to the
// cent per order. Paper bets are priced per contract with the rounding left out, which is what
// a 100-contract order pays to within a hundredth of a cent.
export const FEE_RATE = 0.07
export const takerFee = (p) => FEE_RATE * p * (1 - p)

/* ------------------------------------------------------------------ *
 * The WCE model arm
 * ------------------------------------------------------------------ */

// Game-to-game variance over mean for each stat, used when a player has little or no log
// (rookies). Rough league-typical values; the player's own log takes over as it grows.
export const PHI_PRIOR = { pts: 2.4, reb: 1.35, ast: 1.35, fg3m: 1.15, pra: 2.2 }
const PRIOR_GAMES = 20
const PHI_MIN = 1.0
const PHI_MAX = 6

// One stat's value in one game-log row. `ix` maps log_cols names to positions.
export function logValue(row, ix, stat) {
  if (stat === 'pra') return (row[ix.pts] || 0) + (row[ix.reb] || 0) + (row[ix.ast] || 0)
  return row[ix[stat]] || 0
}

// Projected per-game mean for a stat from a projection line ({ pts, reb, ast, fg3m, ... }).
export function projMean(line, stat) {
  if (!line) return null
  if (stat === 'pra') return (line.pts || 0) + (line.reb || 0) + (line.ast || 0)
  const v = line[stat]
  return Number.isFinite(v) ? v : null
}

// Variance-to-mean ratio for a player's stat, from his log, shrunk toward the prior.
export function dispersion(log, ix, stat) {
  const prior = PHI_PRIOR[stat]
  const rows = Array.isArray(log) ? log.filter((r) => Array.isArray(r) && (r[ix.min] || 0) > 0) : []
  const n = rows.length
  if (n < 5) return prior
  const xs = rows.map((r) => logValue(r, ix, stat))
  const mean = xs.reduce((a, b) => a + b, 0) / n
  if (mean <= 0.05) return prior
  const varr = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
  const obs = varr / mean
  const phi = (n * obs + PRIOR_GAMES * prior) / (n + PRIOR_GAMES)
  return Math.min(PHI_MAX, Math.max(PHI_MIN, phi))
}

// P(X >= k) for a count with mean mu and variance phi * mu: negative binomial when phi > 1,
// Poisson at phi = 1.
export function tailProb(mu, phi, k) {
  if (!(mu > 0)) return k <= 0 ? 1 : 0
  if (k <= 0) return 1
  let pmf, step
  if (phi <= 1.0001) {
    pmf = Math.exp(-mu)
    step = (x) => mu / (x + 1)
  } else {
    const p = 1 / phi // success probability
    const r = mu / (phi - 1)
    pmf = Math.exp(r * Math.log(p))
    step = (x) => ((x + r) / (x + 1)) * (1 - p)
  }
  let cdf = 0
  for (let x = 0; x < k; x++) {
    cdf += pmf
    pmf *= step(x)
  }
  return Math.min(1, Math.max(0, 1 - cdf))
}

const clampP = (p) => Math.min(0.995, Math.max(0.005, p))

// The model arm's probability that `player` reaches k+ in `stat`, from his projection row in
// savant-proj.json and that file's log column index.
export function modelProb(player, ix, stat, k) {
  const mu = projMean(player?.ros || player?.pre, stat)
  if (mu == null) return null
  const phi = dispersion(player.log, ix, stat)
  return clampP(tailProb(mu, phi, k))
}

// Pool-adjacent-violators: forces one player's thresholds for one stat to be coherent (a
// higher line is never likelier than a lower one). Takes [{ k, p }], returns the same order.
export function monotone(items) {
  const sorted = items.map((it, i) => ({ ...it, i })).sort((a, b) => a.k - b.k)
  const blocks = []
  for (const it of sorted) {
    blocks.push({ sum: it.p, n: 1, members: [it] })
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2]
      if (a.sum / a.n >= b.sum / b.n) break
      a.sum += b.sum; a.n += b.n; a.members.push(...b.members)
      blocks.pop()
    }
  }
  const out = new Array(items.length)
  for (const b of blocks) for (const m of b.members) out[m.i] = { ...items[m.i], p: b.sum / b.n }
  return out
}

/* ------------------------------------------------------------------ *
 * The bet rule
 * ------------------------------------------------------------------ */

export const BET_RULES = {
  minEdge: 0.03, // probability points after the fee
  maxSpread: 0.10, // bid-ask, in dollars
  minPrice: 0.05,
  maxPrice: 0.95,
}

export const isQuoted = (m) => m.bid > 0 && m.ask < 1 && m.ask > m.bid
export const mid = (m) => (m.bid + m.ask) / 2
// The bid-ask spread in whole cents. Prices are cents, so compare in cents: 0.40 - 0.30 is
// 0.10000000000000003 in floating point, which would fail a "<= 0.10" test.
export const spreadCents = (m) => Math.round((m.ask - m.bid) * 100)
export const withinSpread = (m, max) => spreadCents(m) <= Math.round(max * 100)

// The better side of one market for a forecaster who believes p. Prices are what you would
// pay as a taker: the YES ask, or the NO ask (1 - YES bid).
export function bestSide(m, p, rules = BET_RULES) {
  if (p == null || !isQuoted(m) || !withinSpread(m, rules.maxSpread)) return null
  const noAsk = m.noAsk != null ? m.noAsk : 1 - m.bid
  const sides = [
    { side: 'yes', price: m.ask, win: p },
    { side: 'no', price: noAsk, win: 1 - p },
  ].filter((s) => s.price >= rules.minPrice && s.price <= rules.maxPrice)
  let best = null
  for (const s of sides) {
    const fee = takerFee(s.price)
    const edge = s.win - s.price - fee
    if (!best || edge > best.edge) best = { side: s.side, price: s.price, fee, edge, p }
  }
  return best
}

// One bet per player per game: the market and side with the largest edge, kept only if it
// clears the threshold. `markets` carry { ticker, playerKey, ... }; `probs` maps ticker -> p.
export function pickBets(markets, probs, rules = BET_RULES) {
  const byPlayer = new Map()
  for (const m of markets) {
    const s = bestSide(m, probs.get(m.ticker), rules)
    if (!s || s.edge < rules.minEdge) continue
    const cur = byPlayer.get(m.playerKey)
    if (!cur || s.edge > cur.edge) byPlayer.set(m.playerKey, { ...s, market: m })
  }
  return [...byPlayer.values()]
}

/* ------------------------------------------------------------------ *
 * Settlement
 * ------------------------------------------------------------------ */

// A settled market's value to a YES holder: 1 or 0 when it resolved, a fraction when Kalshi
// paid out a fair price (the player never took the court), null when not yet settled.
export function settledValue(m) {
  if (!m) return null
  if (m.result === 'yes') return 1
  if (m.result === 'no') return 0
  const v = Number(m.value)
  if (m.settled && Number.isFinite(v)) return Math.min(1, Math.max(0, v))
  return null
}

// One paper bet, one unit staked (price plus fee). Returns the fields the page shows.
//   outcome  'win' | 'loss' | 'void'. A fair-price settlement (the player never took the
//            court) is a void: it says nothing about the forecast, so it stays out of P&L.
//   pnl      in units
//   clv      closing fair probability for the side taken, minus the price paid (pre-fee)
//   cost     the price paid minus the mid when the bet was made: half the spread, what a
//            taker pays to cross it
//   move     the mid at the close minus the mid when the bet was made, for the side taken:
//            how far the market moved toward the bet. clv = move - cost, so move is the part
//            of CLV that says something about the forecast
export function settleBet(bet, value, close) {
  if (value == null) return null
  const contracts = 1 / (bet.price + bet.fee)
  const payout = bet.side === 'yes' ? value : 1 - value
  const decided = value === 0 || value === 1
  const outcome = !decided ? 'void' : payout === 1 ? 'win' : 'loss'
  const pnl = outcome === 'void' ? 0 : contracts * payout - 1
  let clv = null, closeMid = null, move = null, cost = null
  const sideFair = (m) => (bet.side === 'yes' ? m : 1 - m)
  const openMid = bet.bid > 0 && bet.ask < 1 && bet.ask >= bet.bid ? (bet.bid + bet.ask) / 2 : null
  if (openMid != null) cost = bet.price - sideFair(openMid)
  if (close && close.bid > 0 && close.ask < 1 && close.ask >= close.bid) {
    closeMid = (close.bid + close.ask) / 2
    clv = sideFair(closeMid) - bet.price
    if (openMid != null) move = sideFair(closeMid) - sideFair(openMid)
  }
  return { outcome, pnl, value, closeMid, close: close || null, clv, move, cost }
}

/* ------------------------------------------------------------------ *
 * Aggregates (summed per game at settlement, then across games by the page)
 * ------------------------------------------------------------------ */

export const emptyBetAgg = () => ({ n: 0, w: 0, l: 0, v: 0, staked: 0, pnl: 0, clvN: 0, clvSum: 0, clvSq: 0, beat: 0,
  mvN: 0, mvSum: 0, mvSq: 0, mvUp: 0, costSum: 0 })
// Bumped whenever a settled game's aggregates gain a field; older games are recomputed from
// their stored bets and forecasts the next time the page reads them.
export const AGG_VERSION = 3
export const BINS = 10
// dd, dr, rr: sums for one regression, of the result's surprise against the market
// (r = y - market) on the arm's disagreement with the market (d = p - market). Its slope is
// the weight a blend should give the arm next to the market's own price: 0 means the arm knows
// nothing the price doesn't, 1 means take the arm's number as it is.
// dsum is the arm's total lean against the market (sum of arm - market), for the report card.
export const emptyFcAgg = () => ({ n: 0, brier: 0, brierMkt: 0, ll: 0, llMkt: 0, dd: 0, dr: 0, rr: 0, dsum: 0, bins: Array.from({ length: BINS }, () => [0, 0, 0]) })
// Per stat, for the report card: count, both Brier sums and the lean.
export const emptyStatAgg = () => ({ n: 0, brier: 0, brierMkt: 0, dsum: 0 })
export function addStatForecast(agg, p, marketP, y) {
  if (p == null || marketP == null || (y !== 0 && y !== 1)) return agg
  agg.n += 1
  agg.brier += (p - y) ** 2
  agg.brierMkt += (marketP - y) ** 2
  agg.dsum += p - marketP
  return agg
}
// The market's own lean: how far Kalshi's mid sat above how often the YES side hit (positive
// means YES was priced rich, the retail lean toward overs).
export const emptyMktAgg = () => ({ n: 0, sum: 0, sq: 0 })
export function addMarket(agg, marketP, y) {
  if (marketP == null || (y !== 0 && y !== 1)) return agg
  const e = marketP - y
  agg.n += 1; agg.sum += e; agg.sq += e * e
  return agg
}
export function describeMarket(a) {
  if (!a?.n) return { n: 0, bias: null, se: null, t: null }
  const mean = a.sum / a.n
  const se = a.n > 1 ? Math.sqrt(Math.max(0, (a.sq - a.n * mean * mean) / (a.n - 1)) / a.n) : null
  return { n: a.n, bias: mean, se, t: se ? mean / se : null }
}

export function addBet(agg, settled) {
  if (!settled) return agg
  agg.n += 1
  if (settled.outcome === 'win') agg.w += 1
  else if (settled.outcome === 'loss') agg.l += 1
  else agg.v += 1
  if (settled.outcome !== 'void') {
    agg.staked += 1
    agg.pnl += settled.pnl
  }
  if (settled.clv != null && settled.outcome !== 'void') {
    agg.clvN += 1
    agg.clvSum += settled.clv
    agg.clvSq += settled.clv * settled.clv
    if (settled.clv > 0) agg.beat += 1
  }
  if (settled.move != null && settled.cost != null && settled.outcome !== 'void') {
    agg.mvN += 1
    agg.mvSum += settled.move
    agg.mvSq += settled.move * settled.move
    agg.costSum += settled.cost
    if (settled.move > 0) agg.mvUp += 1
  }
  return agg
}

const LL_FLOOR = 1e-3
const logLoss = (p, y) => -Math.log(Math.max(LL_FLOOR, y ? p : 1 - p))

// One forecast against its result, next to the market's own forecast (the mid when the arm
// made its call). Only markets that resolved 1 or 0 count.
export function addForecast(agg, p, marketP, y) {
  if (p == null || marketP == null || (y !== 0 && y !== 1)) return agg
  agg.n += 1
  agg.brier += (p - y) ** 2
  agg.brierMkt += (marketP - y) ** 2
  agg.ll += logLoss(p, y)
  agg.llMkt += logLoss(marketP, y)
  const d = p - marketP, r = y - marketP
  agg.dsum += d
  agg.dd += d * d
  agg.dr += d * r
  agg.rr += r * r
  const b = Math.min(BINS - 1, Math.floor(p * BINS))
  agg.bins[b][0] += 1
  agg.bins[b][1] += p
  agg.bins[b][2] += y
  return agg
}

export function mergeBetAgg(into, a) {
  if (!a) return into
  for (const k of Object.keys(into)) into[k] += a[k] || 0
  return into
}

export function mergeFcAgg(into, a) {
  if (!a) return into
  for (const k of ['n', 'brier', 'brierMkt', 'll', 'llMkt', 'dd', 'dr', 'rr', 'dsum']) into[k] += a[k] || 0
  ;(a.bins || []).forEach((b, i) => { if (into.bins[i]) for (let j = 0; j < 3; j++) into.bins[i][j] += b[j] || 0 })
  return into
}

// The information test. Fits r = w * d with no intercept over every scored forecast:
//   weight     w, the share of the arm's disagreement with the market a blend should keep
//   t          w over its standard error. Forecasts in one game move together (a player's
//              ladder, a blowout), so treat this t as generous
//   blendSkill how much the blend market + w * (arm - market) beats the market's Brier score
//              (always >= 0 in sample; it means something once t is past 2)
export function infoOverMarket(a) {
  if (!a || !(a.dd > 0) || !(a.rr > 0) || a.n < 3) return null
  const w = a.dr / a.dd
  const rss = Math.max(0, a.rr - (a.dr * a.dr) / a.dd)
  const se = Math.sqrt(rss / (a.n - 1) / a.dd)
  return { weight: w, se, t: se > 0 ? w / se : null, blendSkill: a.rr > 0 ? 1 - rss / a.rr : null, n: a.n }
}

// What the page prints for one arm.
export function describeBets(a) {
  const decided = a.w + a.l
  const clvMean = a.clvN ? a.clvSum / a.clvN : null
  let clvSe = null, clvT = null
  if (a.clvN > 1) {
    const varr = Math.max(0, (a.clvSq - a.clvN * clvMean * clvMean) / (a.clvN - 1))
    clvSe = Math.sqrt(varr / a.clvN)
    clvT = clvSe > 0 ? clvMean / clvSe : null
  }
  let moveMean = null, moveSe = null, moveT = null
  if (a.mvN) moveMean = a.mvSum / a.mvN
  if (a.mvN > 1) {
    const varr = Math.max(0, (a.mvSq - a.mvN * moveMean * moveMean) / (a.mvN - 1))
    moveSe = Math.sqrt(varr / a.mvN)
    moveT = moveSe > 0 ? moveMean / moveSe : null
  }
  return {
    moveBets: a.mvN || 0, moveMean, moveSe, moveT, moveUpRate: a.mvN ? a.mvUp / a.mvN : null, spreadPaid: a.mvN ? a.costSum / a.mvN : null,
    bets: a.n, wins: a.w, losses: a.l, voids: a.v,
    hitRate: decided ? a.w / decided : null,
    staked: a.staked, pnl: a.pnl, roi: a.staked ? a.pnl / a.staked : null,
    clvBets: a.clvN, clvMean, clvSe, clvT, beatRate: a.clvN ? a.beat / a.clvN : null,
  }
}

export function describeForecasts(a) {
  if (!a.n) return { forecasts: 0, brier: null, brierMarket: null, skill: null, logLoss: null, logLossMarket: null, calibration: [], info: null }
  return {
    forecasts: a.n,
    info: infoOverMarket(a),
    brier: a.brier / a.n,
    brierMarket: a.brierMkt / a.n,
    skill: a.brierMkt > 0 ? 1 - a.brier / a.brierMkt : null, // > 0 means better than the market
    logLoss: a.ll / a.n,
    logLossMarket: a.llMkt / a.n,
    calibration: a.bins.map(([n, sp, sy], i) => ({ bin: i, n, predicted: n ? sp / n : null, actual: n ? sy / n : null })),
  }
}

/* ------------------------------------------------------------------ *
 * Portfolios: each arm's bets as dollars
 * ------------------------------------------------------------------ */

// Each arm runs its own paper portfolio from the same start. A bet's size comes from its edge
// (fractional Kelly), from the bankroll the arm had going into that night, so a stake is fixed
// the moment it is bet and never moves with later results. Three caps keep one bet, one game
// or one night from swinging the whole thing: a game's cap is maxGame, or less on a big slate
// (maxNight / games on the slate, with the slate's size stored on each game when it is decided,
// so a stake never changes after it is bet); when one game's bets add up past it they are all
// scaled down together (which keeps the bigger edges bigger), and then no bet is more than
// maxBet. The whole history is replayed from the ledger every read, so the numbers are
// always the same arithmetic on the same bets.
export const PORTFOLIO = {
  version: 2, // bumped when the sizing changes; the night lines recorded under another one are dropped
  start: 1000, // dollars, per arm
  kellyFraction: 0.25, // quarter Kelly: full Kelly on noisy probabilities is far too aggressive
  maxBet: 0.015, // of the night's bankroll, per bet
  maxGame: 0.05, // of the night's bankroll, all of one arm's bets on one game together
  maxNight: 0.25, // of the night's bankroll, all of one arm's bets that night: each game gets at
  //                 most maxNight / games on the slate (so 11 games get 2.27% each, 4 get 5%)
}

// Full Kelly for a binary contract bought at `cost` (price plus fee, per $1 of payout) by
// someone whose edge is `edge` (win probability minus cost): the share of bankroll to stake.
export function kellyShare(edge, cost) {
  if (!(edge > 0) || !(cost > 0 && cost < 1)) return 0
  return edge / (1 - cost)
}

// What a YES contract is worth right now: its settlement once Kalshi has one, the mid of a
// two-sided quote, else the last trade. Null when there is nothing to go on.
export function markValue(m) {
  if (!m) return null
  const s = settledValue(m)
  if (s != null) return s
  if (m.bid > 0 && m.ask < 1 && m.ask >= m.bid) return (m.bid + m.ask) / 2
  if (m.last > 0 && m.last < 1) return m.last
  return null
}

const cents2 = (x) => Math.round(x * 100) / 100

// The ledger row for one bet: [arm, ticker, side, edge, cost, u] where u is the bet's P&L per
// unit staked once settled, 'v' for a void, null while open.
export function ledgerRow(b) {
  const r = b.result
  const u = !r ? null : r.outcome === 'void' ? 'v' : Math.round(r.pnl * 1e6) / 1e6
  return [b.arm, b.ticker, b.side, Math.round(b.edge * 1e5) / 1e5, Math.round((b.price + b.fee) * 1e5) / 1e5, u]
}

// Replays every bet in order and returns where each arm stands.
//   games  [{ key, date, tip, slate?, bets: [ledger rows] }]; slate is how many games that date
//          had (games decided before it was stored fall back to the night's decided games)
//   marks  Map(ticker -> YES value now) for open bets; an open bet without a mark is held at
//          what it cost
export function buildPortfolios(games, marks = null, cfg = PORTFOLIO, armIds = ARMS) {
  const ARMS = armIds // the base three unless experiments are asked for too; each starts at cfg.start
  const realized = Object.fromEntries(ARMS.map((a) => [a, cfg.start]))
  const unreal = Object.fromEntries(ARMS.map((a) => [a, 0]))
  const counts = Object.fromEntries(ARMS.map((a) => [a, { open: 0, openStake: 0, settled: 0, staked: 0 }]))
  const stakes = {}
  const opens = {}
  const closes = []
  const byDate = new Map()
  for (const g of games) {
    if (!byDate.has(g.date)) byDate.set(g.date, [])
    byDate.get(g.date).push(g)
  }
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date).slice().sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip) || (a.key < b.key ? -1 : 1))
    const bank = { ...realized } // sized from what each arm had going into the night
    const slate = Math.max(day.length, ...day.map((g) => Number(g.slate) || 0))
    const gameCap = Math.min(cfg.maxGame, cfg.maxNight ? cfg.maxNight / slate : cfg.maxGame)
    opens[date] = Object.fromEntries(ARMS.map((a) => [a, cents2(bank[a])]))
    const dayPnl = Object.fromEntries(ARMS.map((a) => [a, 0]))
    let allSettled = true
    for (const g of day) {
      for (const arm of ARMS) {
        const rows = (g.bets || []).filter((r) => r[0] === arm)
        if (!rows.length) continue
        const B = bank[arm]
        // Game cap first (it keeps sizes in proportion to edge), then the per-bet cap: capping
        // each bet first would flatten every decent edge to the same size.
        const raw = rows.map((r) => Math.max(0, B * cfg.kellyFraction * kellyShare(r[3], r[4])))
        const sum = raw.reduce((t, x) => t + x, 0)
        const scale = sum > gameCap * B ? (gameCap * B) / sum : 1
        rows.forEach((r, i) => {
          const [, ticker, side, , cost, u] = r
          const stake = cents2(Math.min(raw[i] * scale, cfg.maxBet * B))
          const id = `${g.key}|${arm}|${ticker}`
          if (u === null || u === undefined) {
            allSettled = false
            const yes = marks?.get(ticker)
            const mark = yes == null ? null : side === 'yes' ? yes : 1 - yes
            const value = mark == null || !(cost > 0) ? stake : (stake / cost) * mark
            unreal[arm] += value - stake
            counts[arm].open += 1
            counts[arm].openStake += stake
            stakes[id] = { stake, open: true, mark, value: cents2(value), pnl: cents2(value - stake) }
          } else {
            const pnl = u === 'v' ? 0 : stake * u
            dayPnl[arm] += pnl
            counts[arm].settled += 1
            if (u !== 'v') counts[arm].staked += stake
            stakes[id] = { stake, open: false, pnl: cents2(pnl), void: u === 'v' }
          }
        })
      }
    }
    for (const a of ARMS) realized[a] += dayPnl[a]
    if (allSettled) closes.push({ date, ...Object.fromEntries(ARMS.map((a) => [a, cents2(realized[a])])) })
  }
  const arms = Object.fromEntries(ARMS.map((a) => [a, {
    start: cfg.start,
    realized: cents2(realized[a]),
    unrealized: cents2(unreal[a]),
    equity: cents2(realized[a] + unreal[a]),
    ...counts[a],
    openStake: cents2(counts[a].openStake),
    staked: cents2(counts[a].staked),
  }]))
  return { config: cfg, arms, closes, opens, stakes }
}

/* ------------------------------------------------------------------ *
 * Experiments: rule arms and the bar they have to clear
 * ------------------------------------------------------------------ */

// A rule arm is a betting rule over forecasts the lab already makes, so it costs nothing to run.
//   source    a forecaster ('model', 'claude_wce', 'claude_box', 'claude_rc') or 'claude_avg'
//             (the two original Claude arms averaged, where both priced the market)
//   blend     null, or 'fit': bet on market + w * (source - market), with w the source's
//             information weight fitted only on games settled before this one (0 to 1; no bets
//             until 1,000 forecasts are scored)
//   side      'yes' | 'no' | null (either)
//   stats     a list of stats, or null for all
//   minEdge   the edge after the fee a bet needs (default 3 points); maxEdge an optional ceiling
//   minPrice, maxPrice   the price of the side taken (default 5 to 95 cents)
// One bet per player per game, the market and side with the largest edge, as for every arm.
export const RULE_SOURCES = ['model', 'claude_wce', 'claude_box', 'claude_rc', 'claude_avg']
export const BLEND_MIN_FORECASTS = 1000

export function validateRule(r) {
  const errs = []
  if (!r || typeof r !== 'object') return ['the arm must be an object']
  if (!RULE_SOURCES.includes(r.source)) errs.push(`source must be one of ${RULE_SOURCES.join(', ')}`)
  if (r.blend != null && r.blend !== 'fit') errs.push('blend must be null or "fit"')
  if (r.side != null && r.side !== 'yes' && r.side !== 'no') errs.push('side must be "yes", "no" or null')
  if (r.stats != null && (!Array.isArray(r.stats) || !r.stats.length || r.stats.some((x) => !STATS.includes(x)))) errs.push(`stats must be null or a list from ${STATS.join(', ')}`)
  for (const k of ['minEdge', 'maxEdge']) if (r[k] != null && !(Number(r[k]) >= 0.01 && Number(r[k]) <= 0.5)) errs.push(`${k} must be between 0.01 and 0.5`)
  for (const k of ['minPrice', 'maxPrice']) if (r[k] != null && !(Number(r[k]) >= 0.02 && Number(r[k]) <= 0.98)) errs.push(`${k} must be between 0.02 and 0.98`)
  if (r.blend === 'fit' && r.source === 'claude_avg') errs.push('a blend needs a single forecaster as its source')
  if (r.minEdge != null && r.maxEdge != null && Number(r.maxEdge) <= Number(r.minEdge)) errs.push('maxEdge must be above minEdge')
  if (r.minPrice != null && r.maxPrice != null && Number(r.maxPrice) <= Number(r.minPrice)) errs.push('maxPrice must be above minPrice')
  for (const k of ['name', 'hypothesis', 'success']) if (typeof r[k] !== 'string' || r[k].trim().length < (k === 'name' ? 3 : 20)) errs.push(`${k} must be written out`)
  return errs
}

// The source's probability for one market (ticker), or null.
export function sourceProb(source, probs, ticker) {
  if (source === 'claude_avg') {
    const a = probs.claude_wce?.get(ticker), b = probs.claude_box?.get(ticker)
    return a != null && b != null ? (a + b) / 2 : null
  }
  return probs[source]?.get(ticker) ?? null
}

// The bets one rule arm takes on one game.
//   markets  the live quoted markets ({ ticker, playerKey, stat, bid, ask, noAsk, ... })
//   probs    { forecaster: Map(ticker -> p) }
//   weight   the blend weight for a blend arm (null when there isn't one yet)
export function pickRuleBets(rule, markets, probs, weight = null, base = BET_RULES) {
  if (rule.blend === 'fit' && !(weight > 0)) return []
  const rules = {
    ...base,
    minEdge: rule.minEdge != null ? Number(rule.minEdge) : base.minEdge,
    minPrice: rule.minPrice != null ? Number(rule.minPrice) : base.minPrice,
    maxPrice: rule.maxPrice != null ? Number(rule.maxPrice) : base.maxPrice,
  }
  const byPlayer = new Map()
  for (const m of markets) {
    if (rule.stats && !rule.stats.includes(m.stat)) continue
    let p = sourceProb(rule.source, probs, m.ticker)
    if (p == null) continue
    if (rule.blend === 'fit') {
      const mk = mid(m)
      p = Math.min(0.99, Math.max(0.01, mk + weight * (p - mk)))
    }
    const s = rule.side ? sideOnly(m, p, rule.side, rules) : bestSide(m, p, rules)
    if (!s || s.edge < rules.minEdge) continue
    if (rule.maxEdge != null && s.edge > Number(rule.maxEdge)) continue
    const cur = byPlayer.get(m.playerKey)
    if (!cur || s.edge > cur.edge) byPlayer.set(m.playerKey, { ...s, market: m })
  }
  return [...byPlayer.values()]
}

function sideOnly(m, p, side, rules) {
  if (p == null || !isQuoted(m) || !withinSpread(m, rules.maxSpread)) return null
  const price = side === 'yes' ? m.ask : (m.noAsk != null ? m.noAsk : 1 - m.bid)
  if (price < rules.minPrice || price > rules.maxPrice) return null
  const win = side === 'yes' ? p : 1 - p
  const fee = takerFee(price)
  return { side, price, fee, edge: win - price - fee, p }
}

// The blend weight for a source from the information sums of games settled before a date,
// clamped to 0..1. Null until enough forecasts are scored.
export function blendWeight(fcAgg) {
  const info = infoOverMarket(fcAgg)
  if (!info || fcAgg.n < BLEND_MIN_FORECASTS) return null
  return Math.min(1, Math.max(0, info.weight))
}

// The bar an arm has to clear to graduate: CLV t past the one-sided 5% point, split across
// every arm ever tried (a Bonferroni correction). Trying more arms raises it, which is what
// keeps "we found an edge" from meaning "we tried enough times".
export const GRADUATE_MIN_BETS = 300
export function graduationBar(armsTried) {
  const k = Math.max(1, armsTried)
  return normalQuantile(1 - 0.05 / k)
}

// Where an arm stands, from its bet summary (describeBets) and the bar.
export function armStanding(d, bar, retired = false) {
  if (retired) return 'retired'
  if ((d.clvBets || 0) < GRADUATE_MIN_BETS) return 'collecting'
  if (d.clvT != null && d.clvT >= bar) return 'graduated'
  return 'no edge yet'
}

// Inverse of the standard normal CDF (Acklam's approximation, ~1e-9 relative error).
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const lo = 0.02425
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  const q = p - 0.5, r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}
