// LAYER TWO — universal asset value.
//
// "What would the league broadly pay for this asset?" — before any one team's preferences
// touch it. Team-specific wanting lives in utility.js; whether an organisation actually
// pulls the trigger lives in accept.js. Keeping those three apart is the whole point:
// value != utility != acceptance.
//
// The currency is dollars of surplus. Production is priced at the measured $14.1M per
// VORP (league payroll over league positive VORP, from value_engine.py), a contract costs
// what it costs, and the difference is what an asset is worth. That is the same currency
// picks.js already prices picks in, so players, picks and cap filler are directly
// comparable rather than living on three scales.
import { SEED } from '../seed.js'
import { fitContribution } from './impact.js'

const P = SEED.picks
export const DOLLARS_PER_VORP = P.perVorp
export const REPLACEMENT_VALUE = P.replacement
export const DISCOUNT = P.discount

// Stars are worth more per unit of production than the sum of the parts, and the reason is
// structural rather than sentimental: the maximum salary caps what elite players can be
// paid, so their surplus is suppressed by rule, and no combination of mid-tier contracts
// reproduces one. Without this, ten $20M assets buy Nikola Jokic.
const STAR_KNEE = 2.6        // VORP at which scarcity starts to bite (~a good starter)
const STAR_GAIN = 0.42       // extra value per VORP above the knee, as a fraction
const STAR_CAP = 2.35        // ceiling on the multiplier

export function scarcityMultiplier(vorp) {
  if (!(vorp > STAR_KNEE)) return 1
  return Math.min(STAR_CAP, 1 + (vorp - STAR_KNEE) * STAR_GAIN)
}

// What a season of this production is worth on the open market.
// A season of a roster spot producing at this level, priced by scarcity rather than by
// surplus. Zero at the level anybody can sign off the street, and convex above it.
export const SPOT_FLOOR = 0.2      // VORP a minimum contract buys; below this a spot is free
export const SPOT_GAMMA = 1.3      // how sharply value bends upward with production
export const SPOT_K = 5.0e6        // dollars at one unit above the floor, solved against the anchors
export const SURPLUS_W = 0.18      // how much of the contract's own surplus survives into value
export const CONTRACT_SWING = 0.55 // and how far it can move him either way, as a share of spot

export const spotValue = (vorp) => (vorp > SPOT_FLOOR
  ? SPOT_K * Math.pow(vorp - SPOT_FLOOR, SPOT_GAMMA) : 0)

export function productionValue(vorp) {
  const v = Math.max(-1.5, vorp || 0)
  return (REPLACEMENT_VALUE + v * DOLLARS_PER_VORP) * scarcityMultiplier(v)
}

// WHAT A DOLLAR BUYS.
//
// Measured on the 383 rated contracts in the league: expected VORP = -0.591 + 0.589 x
// ln(salary in $M), R2 0.299. The low R2 is the point — the market is only weakly
// efficient, and that inefficiency is where trades come from.
//
// This matters because "surplus = production minus salary" is the wrong subtraction. The
// alternative to a contract is not a free roster spot, it is what the same money buys on
// the open market. Against replacement level, a 1.8-VORP centre on the minimum looks like
// a $100M asset; against what $2.7M actually buys, his edge is real but finite.
const PRICE_A = -0.591
const PRICE_B = 0.589
export const vorpForMoney = (salary) => PRICE_A + PRICE_B * Math.log(Math.max(1.5e6, salary || 1.5e6) / 1e6)

// UNCERTAINTY IS WORTH MONEY, and the reason is convexity rather than optimism: value per
// unit of production rises at the top of the distribution because of the salary cap, so
// the expectation of the value exceeds the value of the expectation. A 23-year-old whose
// projection carries a wide band is worth more than a 30-year-old at the same forecast.
//
// The projection model's own residual is 0.88 VORP at every age; young players get a
// wider band because their outcomes genuinely spread further.
const NODES = [-1.75, -1.05, -0.5, 0, 0.5, 1.05, 1.75]
const WEIGHTS = [0.045, 0.12, 0.2, 0.27, 0.2, 0.12, 0.045]

export const spreadFor = (age) => (age <= 22 ? 1.45 : age <= 24 ? 1.2 : age <= 28 ? 0.9 : 0.78)

export function expectedProductionValue(vorp, age) {
  const sd = spreadFor(age)
  let v = 0
  for (let i = 0; i < NODES.length; i++) v += WEIGHTS[i] * productionValue(vorp + NODES[i] * sd)
  return v
}

// TALENT: two validated estimates, blended.
//
// VORP comes from box plus/minus, and BPM systematically overrates one specific profile —
// the low-usage, high-efficiency big who rebounds and blocks shots. That is exactly how a
// backup centre ends up rated like a good starter. The fit model is the second estimate:
// it was fitted on 390 team-seasons and validated leave-one-season-out at R2 0.661, and
// it says what a player's skill profile does to a team's net rating. It reads Neemias
// Queta as a league-average contributor and Ausar Thompson as clearly above one, which is
// the distinction BPM misses.
//
// Neither is trusted alone. Half each, converted to VORP so the whole engine keeps one
// currency: 2.15 wins per net-rating point (measured in the season runs) over the 2.7 wins
// per VORP that VORP is defined by.
const NET_TO_VORP = 2.15 / 2.7

// THE CROWD'S OPINION, as a bounded correction.
//
// Box plus/minus rewards efficiency, and efficiency is easiest at low usage — which is how a
// catch-and-shoot specialist ends up rated like a starter. Measured against the Dynasty
// Exchange board over 369 joined players, our model ranks a low-usage player about 18 places
// better than the crowd and a high-usage player 19 places worse (usage coefficient −514 rank
// places per unit of usage, R² 0.20 with age).
//
// The board is not the answer either. It is a fantasy DYNASTY board: it pays for youth and
// for counting stats, which is why it has nineteen-year-olds inside its top hundred. So it
// gets the same treatment the fit model gets — a capped nudge, never a verdict — and players
// under 22 are left out of it entirely, because there the board is pricing a future our own
// projection model already handles.
const CONSENSUS_N = SEED.consensus?.n || 407
const CONSENSUS_WEIGHT = 0.35
const CONSENSUS_CAP = 0.9

// Where a board rank sits on OUR scale: quantile mapping, so two different measuring sticks
// can be compared at all. Rank 1 maps to the best VORP in the league, and so on down.
let LADDER = null
function ladder() {
  if (LADDER) return LADDER
  const vs = []
  for (const t of Object.keys(SEED.rosters || {})) {
    for (const p of SEED.rosters[t] || []) {
      if (typeof p.v === 'number' && (p.mpg ?? 0) >= 10) vs.push(p.v)
    }
  }
  vs.sort((a, b) => b - a)
  LADDER = vs
  return vs
}

export function consensusVorp(rank) {
  if (!rank) return null
  const vs = ladder()
  if (!vs.length) return null
  const i = Math.min(vs.length - 1, Math.max(0, Math.round((rank / CONSENSUS_N) * vs.length)))
  return vs[i]
}

export function talentVorp(player) {
  const mpg = Math.max(6, player.mpg || 14)
  const bpmNet = (typeof player.bpm === 'number' ? player.bpm : 0) * (mpg / 48)
  const fitNet = fitContribution(player)
  // A BOUNDED correction, not a blend. The fit coefficients were measured across team
  // seasons, where gravity is entangled with simply having good offensive players, so
  // used unbounded on one player they savage every non-shooter. Capped at half a point of
  // net rating they do what they are good for: telling you that a rim-protecting backup
  // centre is not really a plus starter and that an elite point-of-attack defender is
  // worth more than his box score.
  // Only correct a player the fit model can actually see. Nineteen contracts carry no
  // skill profile at all, and reading their absent gravity as bad gravity turned every
  // one of them into a negative asset.
  const seen = ['sh', 'gr', 'rp', 'pd', 'pm'].filter((k) => typeof player[k] === 'number').length
  const adj = seen >= 3 ? Math.max(-0.5, Math.min(0.5, (fitNet - bpmNet) * 0.4)) : 0
  let out = (player.v ?? bpmNet * NET_TO_VORP) + adj * NET_TO_VORP

  // And what everybody else thinks, if the board has an opinion and he is old enough for it
  // to be about who he is rather than who he might become.
  const cons = (player.a ?? 26) >= 22 ? consensusVorp(player.cr) : null
  if (cons !== null) {
    out += Math.max(-CONSENSUS_CAP, Math.min(CONSENSUS_CAP, (cons - out) * CONSENSUS_WEIGHT))
  }
  return out
}

/* ------------------------------------------------------------------ projection */

// Every player carries the projection model's own multi-horizon forecast — absolute VORP
// for each of the next five seasons plus the probability he is still a rotation player,
// fitted on 88,316 player-season x horizon rows. The trade engine reads that table rather
// than inventing an aging curve, so the AI and the offseason share one world model.
// THE CURVE KNOWS THE SHAPE; THE RATING KNOWS THE LEVEL.
//
// The projection table and the cap sheet's own rate are two estimates of the same man, and
// across 395 players they mostly agree — the mean disagreement is about a third of a VORP.
// Where they do not agree it is almost always the men who matter most: Giannis at 3.6
// against the table's 6.4, Wembanyama at 5.7 against 7.6, Jayson Tatum at 2.1 against 3.6.
// A single season of that gap is worth forty million dollars on its own, and the valuation
// was simply taking whichever number the table happened to hold. The top of the market was
// a coin flip between two models.
//
// So the table keeps its SHAPE — who is rising, who is falling, who comes off a cliff at
// thirty-four is exactly what a projection table is for — and its LEVEL is anchored halfway
// to the rating. Same pattern as talentVorp itself: two estimates, blended, rather than one
// of them chosen and the other discarded.
export const LEVEL_ANCHOR = 0.5

export function projection(player, years = 5) {
  const prog = SEED.prog[String(player.id || '')] || SEED.prog[String(player.pid || '')]
  const base = talentVorp(player)
  // The projection table is keyed on recorded VORP, so shift its path by the difference
  // between that and the talent estimate rather than throwing the aging curve away.
  const shift = prog && prog.v0 !== undefined ? base - prog.v0 : 0
  // ...and then pull the whole path toward the rating, by a constant, so the shape survives.
  const lift = prog && prog.v && prog.v[0] !== undefined
    ? (base - (prog.v[0] + shift)) * (1 - LEVEL_ANCHOR) : 0
  const out = []
  for (let y = 0; y < years; y++) {
    if (prog && prog.v && prog.v[y] !== undefined) {
      out.push({ vorp: prog.v[y] + shift + lift, survive: prog.s ? prog.s[y] : 1 })
    } else {
      // No table for this player (a generated rookie, a two-way conversion): fall back to
      // the population age curve rather than assuming he stays exactly as he is.
      const age = (player.a ?? 26) + y
      const drift = age < 25 ? 0.22 : age < 28 ? 0.04 : age < 31 ? -0.12 : age < 34 ? -0.2 : -0.3
      out.push({ vorp: base + drift * (y + 1), survive: Math.max(0.15, 1 - 0.09 * (y + 1) - Math.max(0, age - 31) * 0.05) })
    }
  }
  return out
}

// Salary in year y, honouring what we know about the deal's shape.
function salaryIn(player, y) {
  if (y === 0) return player.s || 0
  const yrs = Math.max(1, player.yr || 1)
  if (y >= yrs) return 0
  // Raises are not modelled per year in the seed; the league's standard 5% is the honest
  // stand-in and it matters over four years.
  return Math.round((player.s || 0) * (1 + 0.05 * y))
}

/* -------------------------------------------------------------- player value */

export function playerMarketValue(player, opts = {}) {
  const years = Math.max(1, Math.min(5, player.yr || 1))
  const proj = projection(player, 5)
  const age = player.a ?? 26

  // Under contract: what he produces against what the same money buys elsewhere.
  let surplus = 0
  const bits = []
  for (let y = 0; y < years; y++) {
    const { vorp, survive } = proj[y]
    const cost = salaryIn(player, y)
    const mine = expectedProductionValue(vorp, age + y) * survive
    const alternative = productionValue(vorpForMoney(cost))
    const d = (mine - alternative) * Math.pow(DISCOUNT, y)
    surplus += d
    bits.push({ year: y, vorp: Math.round(vorp * 100) / 100, survive, worth: mine, cost, net: d })
  }

  // AFTER the contract, you still hold his rights.
  //
  // Treating the years past a deal as worth nothing was the single biggest error in the
  // old valuation: it made a 23-year-old on an expiring rookie deal cheaper than a
  // 27-year-old backup on five cheap years, because only one of them had years left on
  // paper. In fact Bird rights on a good young player are most of what he is worth — you
  // get to keep him, at a price the cap suppresses, through his prime.
  let control = 0
  const retention = age <= 25 ? 0.82 : age <= 28 ? 0.62 : 0.35
  for (let y = years; y < 7; y++) {
    const a = age + y
    if (a > 33) break
    const p = proj[Math.min(proj.length - 1, y)]
    const mu = p.vorp + (y >= proj.length ? -0.12 * (y - proj.length + 1) : 0)
    // You negotiate before you know, so the price is set off the forecast — but you only
    // sign if he is worth it. That asymmetry is the whole value of holding rights, and it
    // is why a 23-year-old with a wide outcome band is worth more than a 30-year-old with
    // the same forecast. Integrated over the distribution rather than evaluated at its
    // mean, because max() and expectation do not commute.
    const pay = Math.min(CBA_MAX, Math.max(2.3e6, productionValue(mu) * 0.78))
    const alt = productionValue(vorpForMoney(pay))
    const sd = spreadFor(a)
    let opt = 0
    for (let i = 0; i < NODES.length; i++) {
      const draw = productionValue(mu + NODES[i] * sd) * (p.survive ?? 0.7)
      opt += WEIGHTS[i] * Math.max(0, draw - alt)
    }
    control += opt * retention * Math.pow(DISCOUNT, y)
  }

  // WHAT A ROSTER SPOT PRODUCING AT THIS LEVEL IS WORTH, WHATEVER HE IS PAID.
  //
  // This term was missing, and its absence is the single biggest reason trade values felt
  // wrong. Everything above prices SURPLUS — production minus what the same money buys — and
  // surplus is the right way to think about a contract. It is the wrong way to think about a
  // player. Mikal Bridges cost New York five first-round picks; his salary eats his entire
  // surplus, so on surplus alone this engine valued him at nothing. Donovan Mitchell and
  // Kevin Durant came out NEGATIVE — the model said you would have to pay somebody to take
  // them — while both are men a real front office would give up a haul for.
  //
  // The thing surplus cannot see is that you only have five places to stand. You cannot buy
  // six VORP by signing two three-VORP players, at any price, because the second one has
  // nowhere to play. That is why value is convex in production and why a max contract, which
  // is fair by construction and therefore has no surplus at all, is still an asset.
  //
  // Constants solved against the two anchor trades in tools/gm/trades.bench.mjs.
  let spot = 0
  for (let y = 0; y < Math.max(1, years); y++) {
    const { vorp, survive } = proj[Math.min(y, proj.length - 1)]
    spot += spotValue(vorp) * (survive ?? 0.85) * Math.pow(DISCOUNT, y)
  }

  // The contract still matters — it is just no longer the whole story. It adds when it is a
  // bargain and subtracts when it is an anchor, bounded so that neither can swamp the man.
  // The two sides of a contract are NOT symmetric, and treating them as if they were made
  // every dead contract in the league free to move. A bargain is a bonus — nice to have, and
  // it does not change who the player is — so it is discounted heavily. An anchor is a
  // liability you have to pay somebody to accept, and it comes through at full weight,
  // because that is exactly what it costs in a real negotiation.
  const raw = surplus + control
  const swing = Math.max(spot, 55e6) * CONTRACT_SWING
  const contract = raw >= 0
    ? Math.min(swing, raw * SURPLUS_W)
    : Math.max(-swing, raw * 0.55)
  const value = spot + contract

  return {
    value: Math.round(value),
    spot: Math.round(spot),
    contract: Math.round(contract),
    surplus: Math.round(surplus),
    control: Math.round(control),
    vorp: proj[0].vorp,
    peak: Math.max(...proj.map((p) => p.vorp)),
    age,
    years,
    // Tier is who he IS, which is the better of what he is now and what he is projected
    // to be. Reading it off next season's forecast alone made a 37-year-old star a
    // rotation player on paper, and the acceptance layer reasons about tiers.
    tier: tierOf(Math.max(talentVorp(player), proj[0].vorp), proj),
    perYear: bits,
    negative: value < 0,
  }
}

const CBA_MAX = SEED.cba.max_35

// Tiers exist so the acceptance layer can reason about "who is the best player in this
// trade" without re-deriving it from dollars, which is exactly the reasoning volume
// exploits depend on nobody doing.
export const TIERS = ['fringe', 'rotation', 'starter', 'quality starter', 'all-star', 'superstar']

export function tierOf(vorp, proj) {
  const peak = proj ? Math.max(vorp, ...proj.slice(0, 3).map((p) => p.vorp)) : vorp
  const x = Math.max(vorp, peak * 0.85)
  if (x >= 6.0) return 5
  if (x >= 3.8) return 4
  if (x >= 2.2) return 3
  if (x >= 1.0) return 2
  if (x >= -0.2) return 1
  return 0
}

/* ---------------------------------------------------------------- pick value */

// Picks are already priced off the empirical curve — 328 drafted players joined to their
// first four NBA seasons — using the owning team's projected finish. What this adds is the
// uncertainty premium the flat curve misses: a distant pick from a fragile roster is a
// lottery ticket, and tail upside is worth paying for.
// WHAT A PICK IS ACTUALLY WORTH, AND WHY THE CURVE ALONE UNDERSTATES IT.
//
// The measured curve prices a pick at the surplus its player produces over his FIRST FOUR
// SEASONS, because that is what the 328-player study could observe. A player valued by
// playerMarketValue gets those four years and then seven more of control value — Bird
// rights, a suppressed re-signing price, the whole reason a young man on a rookie deal is
// the most valuable thing in the league. Picks were getting the four years and nothing else.
//
// That asymmetry is not small and it is not neutral: it is the entire exchange rate between
// players and draft capital, and it made a late first worth nine million dollars against a
// star's four hundred. Every real trade says otherwise. Phoenix paid four unprotected firsts
// AND two good starters for Kevin Durant; New York paid five firsts for Mikal Bridges alone.
// A league where a star costs forty firsts is not the league those trades happened in.
//
// So a pick carries the same tail a player does. The multiple is largest at the top of the
// draft, where the man you take is young enough and good enough for the rights to matter,
// and smallest in the second round, where most of them never sign a second contract.
const CONTROL_TAIL_TOP = 2.6     // a lottery pick is worth this many times its rookie-deal surplus
const CONTROL_TAIL_LATE = 2.0    // a late first
const CONTROL_TAIL_SECOND = 1.25 // a second, where the tail mostly does not happen

export const controlTail = (slot) => (slot <= 14
  ? CONTROL_TAIL_TOP - (slot - 1) * ((CONTROL_TAIL_TOP - CONTROL_TAIL_LATE) / 13)
  : slot <= 30
    ? CONTROL_TAIL_LATE - (slot - 14) * ((CONTROL_TAIL_LATE - CONTROL_TAIL_SECOND) / 16)
    : CONTROL_TAIL_SECOND)

export function pickMarketValue(pick, strengthRank, currentYear, opts = {}) {
  const out = Math.max(0, pick.year - currentYear)
  const slot = Math.max(1, Math.min(60, Math.round((strengthRank ?? 15) + (pick.round - 1) * 30)))
  const base = (P.slotValue[slot] ?? 0) * controlTail(slot)
  const discounted = base * Math.pow(P.discount, out)
  // Variance is worth something, and it grows with distance because nobody has seen the
  // roster that will produce the pick. Applied to the upside only: a pick cannot be worth
  // less than nothing, so widening the distribution raises the expectation.
  const spread = Math.min(0.42, 0.07 * out) * (opts.fragile ? 1.5 : 1)
  const protection = pick.protection ? 1 - Math.min(0.45, pick.protection / 60) : 1
  const value = discounted * (1 + spread) * protection
  return { value: Math.round(value), slot, out, spread, base: Math.round(discounted) }
}

/* ------------------------------------------------------------------ helpers */

export const assetMarketValue = (asset, ctx = {}) => (asset.kind === 'pick'
  ? pickMarketValue(asset.pick, ctx.ranks?.[asset.pick.from], ctx.year ?? parseInt(SEED.season, 10),
    { fragile: ctx.fragile?.[asset.pick.from] })
  : playerMarketValue(asset.player ?? asset))
