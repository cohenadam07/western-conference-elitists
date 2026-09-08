// THIRTY FRONT OFFICES.
//
// The question this answers: can the other teams actually think, instead of returning a
// preset answer when you click?
//
// They can, and the way to do it is not an LLM per team — that would be slow,
// non-deterministic and unverifiable, and it would break the replay check the leaderboard
// depends on. It is to give each organisation the things that make a real front office's
// answer its own:
//
//   1. A PERSONALITY. How much it pays for stars, how tightly it holds picks, how patient
//      it is, how much it trusts its own analytics, how it feels about you.
//   2. PRIVATE VALUATIONS. Its own scouting error on every player — a number nobody else
//      can see. Two teams looking at the same 22-year-old genuinely disagree, which is
//      where trades come from. Deterministic per team per player, so the same GM is
//      consistently wrong in the same direction, the way a real one is.
//   3. A STANDING AGENDA. What it is trying to do this month: a target list built from its
//      own needs, players it is shopping, a list it will not touch.
//   4. MEMORY. Who it has dealt with, who lowballed it, how many times you have already
//      taken value out of it this season.
//
// Then each agent runs the same loop every phase — assess, identify needs, generate
// targets, call around, evaluate, maybe execute — against its own private numbers. Same
// engine, thirty different answers, and a case-by-case one every time.
import { SEED } from './../seed.js'
import { CITY } from './../theme.js'
import { rostersOf, allRosters } from './../league.js'
import { rng } from './../sim.js'
import { pickKey, label as pickLabel, violatesStepien } from './../picks.js'
import { playerMarketValue, pickMarketValue, talentVorp } from './market.js'
import { teamContext } from './context.js'
import { assetUtility, assetCost, changeUtility } from './utility.js'
import { stanceTaste, stancePickTaste, readStance, stanceAsk } from './stance.js'
import { decideTrade, availabilityOf, AVAILABILITY, VERDICT, wontPartWith } from './accept.js'
import { legality } from './negotiate.js'
import { teamSalary, status, maxIncoming } from './../cap.js'

/* ---------------------------------------------------------------- personality */

// Drawn once per career from the career seed, so a league is consistent and two careers
// are not. Ranges are deliberately narrow: personality should colour a decision, never
// overwhelm the basketball.
export const TRAITS = ['starHunger', 'pickAttachment', 'youthAttachment', 'thrift',
  'patience', 'analytics', 'fitSensitivity', 'activity']

export function makeFrontOffices(seed) {
  const r = rng((seed ^ 0x5eed) >>> 0)
  const out = {}
  for (const team of Object.keys(SEED.teams)) {
    const t = {}
    for (const k of TRAITS) t[k] = Math.round((0.3 + r.rand() * 0.7) * 100) / 100
    // A big market is more willing to eat money; a small one is thriftier by mandate.
    const market = SEED.teams[team]?.market ?? 0
    t.thrift = Math.max(0.15, Math.min(1, t.thrift - market * 0.12))
    // The private error each of its evaluations carries. An analytics-heavy front office
    // is wrong less often, which is what paying for a scouting department buys.
    t.noise = Math.round((0.55 - 0.35 * t.analytics) * 100) / 100
    t.seed = (r.randrange(1e9) >>> 0)
    out[team] = t
  }
  return out
}

export const describeFO = (t) => {
  const bits = []
  if (t.starHunger > 0.72) bits.push('will overpay for a star')
  if (t.pickAttachment > 0.72) bits.push('hoards picks')
  if (t.youthAttachment > 0.72) bits.push('protects its young players')
  if (t.thrift > 0.72) bits.push('watches the payroll')
  if (t.patience < 0.4) bits.push('impatient')
  if (t.analytics > 0.72) bits.push('analytics-driven')
  if (t.activity > 0.75) bits.push('always on the phone')
  return bits.length ? bits.join(', ') : 'conventional'
}

/* ------------------------------------------------------- private valuations */

// Deterministic, per (team, player). The same front office is consistently wrong about
// the same player in the same direction, which is what makes disagreement feel like
// judgement rather than dice.
function hash(a, b) {
  let h = 2166136261 ^ a
  for (let i = 0; i < b.length; i++) { h ^= b.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}

// How wrong a team can be about a player: more about the young and the unproven, less
// about a 30-year-old with eight seasons on tape. This is the information asymmetry that
// makes two front offices price the same prospect differently.
export function privateView(team, player, fo) {
  const t = fo || {}
  const age = player.a ?? 26
  const unproven = age <= 23 ? 1 : age <= 25 ? 0.7 : age <= 29 ? 0.45 : 0.3
  const swing = (hash(t.seed || 0, `${team}|${player.uid || player.n}`) - 0.5) * 2
  const err = swing * (t.noise ?? 0.4) * unproven
  const m = playerMarketValue(player)
  // The error moves their read of his production, and the value follows from that.
  const view = { ...m, edge: err, value: Math.round(m.value * (1 + err * 0.55)) }
  view.tier = Math.max(0, Math.min(5, m.tier + (err > 0.45 ? 1 : err < -0.45 ? -1 : 0)))
  return view
}

/* -------------------------------------------------------------- the agenda */

// What this front office is trying to do right now, from its own state. Rebuilt each
// phase rather than stored, because a team's agenda in February is not its agenda in July.
export function agenda(team, opts = {}) {
  // What the user has told the league he is doing. It re-ranks his players on every rival's
  // shopping list and touches nobody else's — a declaration is about your own roster.
  const stance = opts.stance || 'neutral'
  const stanceTeam = opts.stanceTeam || null
  const fo = opts.fo || {}
  const ctx = opts.ctx || teamContext(team, { roster: rostersOf(team), ...opts })
  const roster = rostersOf(team)
  const needs = ctx.profile.needs.slice(0, 3)

  const shopping = [], untouchable = [], available = []
  for (const p of roster) {
    const a = availabilityOf(p, team, { ctx, roster })
    const v = privateView(team, p, fo)
    if (wontPartWith(a.level)) untouchable.push({ p, why: a.why })
    else if (a.level === AVAILABILITY.SHOPPING || a.level === AVAILABILITY.DUMP) {
      shopping.push({ p, why: a.why, value: v.value })
    } else available.push({ p, value: v.value })
  }

  // Targets: what would help most, weighted by this front office's tastes.
  const targets = []
  for (const other of Object.keys(SEED.teams)) {
    if (other === team) continue
    for (const p of rostersOf(other)) {
      const a = availabilityOf(p, other, {})
      if (wontPartWith(a.level)) continue
      const want = assetUtility(p, team, { ctx, roster, ...opts }).value
      if (want <= 8e6) continue
      const v = privateView(team, p, fo)
      const taste = (1
        + (v.tier >= 4 ? (fo.starHunger ?? 0.5) * 0.5 : 0)
        + ((p.a ?? 30) <= 24 ? (fo.youthAttachment ?? 0.5) * 0.3 : 0)
        - (p.s > 30e6 ? (fo.thrift ?? 0.5) * 0.25 : 0))
        * (other === stanceTeam ? stanceTaste(p, stance) : 1)
      targets.push({ p, from: other, want: want * taste, tier: v.tier })
    }
  }
  targets.sort((a, b) => b.want - a.want)

  return { team, ctx, needs, shopping, untouchable, available, targets: targets.slice(0, 12) }
}

/* ------------------------------------------------------------ conservatism */

// Real front offices trade rarely, and when they do it is mostly role players, filler
// salary and second-rounders. Left to clear its own bar by a dollar, the market produced
// a blockbuster a week — Tyrese Haliburton in October, Kyrie Irving in November — which
// is not a league, it is a fantasy draft that never ends.
//
// Two brakes. A CPU needs a MARGIN over its threshold that grows steeply with the calibre
// of the best player moving, and the calibre that can move at all depends on the window:
// stars change teams at the deadline and in the summer, not on a Tuesday in November.
// Conservative does not mean inert. Real teams make small trades constantly — filler,
// second-rounders, a rotation big for a wing — and almost never move a genuine starter
// without a reason everyone can see. So the bar is nearly flat at the bottom and steep at
// the top, rather than uniformly high, which just froze the league.
const CPU_MARGIN = [2e6, 4e6, 12e6, 80e6, 200e6, 400e6]   // by tier of the best player leaving

const WINDOW_TIER = { quiet: 2, deadline: 4, offseason: 5 }

// Even inside a window, a genuine star only moves when both sides are in the right place:
// somebody rebuilding who should cash him in, and somebody contending who should pay.
function starMoveAllowed(tier, buyerCtx, sellerCtx, window) {
  if (tier <= 2) return true
  if (window === 'quiet') return false
  if (tier >= 4) {
    return sellerCtx.futureOrientation > 0.65 && buyerCtx.contention > 0.55
  }
  return sellerCtx.futureOrientation > 0.45 || buyerCtx.contention > 0.45
}

/* --------------------------------------------------------------- the market */

// One front office's turn: pick a target it can afford, build something legal, and see
// whether the other side says yes. Runs on its own private numbers throughout, so a deal
// two teams both like can be one a third would refuse.
function attempt(buyer, plan, opts) {
  const { fo, ledger, ranks, year } = opts
  const buyerRoster = rostersOf(buyer)
  // Sweeteners go cheapest first, and a pick that is worth more than the player is not a
  // sweetener. Adding them in ledger order had Milwaukee attaching a first projected at
  // number four to get a fringe forward.
  const picks = (ledger[buyer] || [])
    .filter((k) => k.year > year && !k.forfeit)
    .map((k) => ({ k, v: pickMarketValue(k, (opts.ranks || {})[k.from], year).value }))
    .sort((a, b) => a.v - b.v)
  const budget = Math.round((1 - (fo.pickAttachment ?? 0.5)) * 3)

  // Try a handful of its targets, not just the top one — a front office that can only
  // pursue its first choice makes no trades at all, because its first choice is usually
  // someone it cannot afford.
  const shortlist = plan.targets.slice(0, 6)
  const start = Math.floor(opts.pick ?? 0) % Math.max(1, shortlist.length)
  for (let n = 0; n < shortlist.length; n++) {
    const target = shortlist[(start + n) % shortlist.length]
    if (!target) continue
    const seller = target.from
    const sellerCtx = teamContext(seller, { roster: rostersOf(seller) })
    const window = opts.window || 'quiet'
    const tierOut = playerMarketValue(target.p).tier
    if (tierOut > (WINDOW_TIER[window] ?? 2)) continue
    if (!starMoveAllowed(tierOut, plan.ctx, sellerCtx, window)) continue
    const margin = CPU_MARGIN[Math.max(0, Math.min(5, tierOut))]
    const ask = assetCost(target.p, seller, { ctx: sellerCtx, roster: rostersOf(seller), ranks, year }).value

    // SALARY FIRST. Sorting the buyer's expendable contracts by price ascending and hoping
    // meant no combination ever reached a $50M target and the whole league stood still.
    const pool = buyerRoster
      .filter((p) => !wontPartWith(availabilityOf(p, buyer, { ctx: plan.ctx, roster: buyerRoster }).level))
      .filter((p) => !(opts.cooling && opts.cooling.has(p.uid || p.n)))
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
    const shapes = []
    for (let i = 0; i < pool.length; i++) {
      shapes.push([pool[i]])
      for (let j = i + 1; j < pool.length; j++) {
        shapes.push([pool[i], pool[j]])
        for (let k = j + 1; k < Math.min(8, pool.length); k++) shapes.push([pool[i], pool[j], pool[k]])
      }
    }
    // Closest salary match first — but in the legal DIRECTION. An apron team matches at
    // 100% with no buffer, so it has to send at least what it takes back; sorting purely
    // by |difference| put shapes two million dollars short at the top of the list and the
    // whole league stood still.
    const st = status(teamSalary(buyerRoster))
    const tight = st.overApron1
    const sum = (arr) => arr.reduce((s2, p) => s2 + p.s, 0)
    shapes.sort((a, b) => {
      const sa = sum(a), sb = sum(b)
      const pa = tight && sa < target.p.s ? 1e12 : 0
      const pb = tight && sb < target.p.s ? 1e12 : 0
      return (pa + Math.abs(sa - target.p.s)) - (pb + Math.abs(sb - target.p.s))
    })

    // Their throw-ins, for the roster count. A two-for-one into a full roster is not a
    // rejection of the idea, it is a missing minimum contract going back.
    const fillers = rostersOf(seller)
      .filter((p) => (p.uid || p.n) !== (target.p.uid || target.p.n))
      .map((p) => ({ p, m: playerMarketValue(p) }))
      .filter((x) => x.m.tier <= 1)
      .sort((a, b) => a.m.value - b.m.value)
      .slice(0, 4)

    for (const out of shapes.slice(0, 40)) {
      const deal = { other: seller, out, inc: [target.p], outPicks: [], inPicks: [] }
      let cap = legality(buyer, seller, deal, allRosters())
      if (!cap.ok && cap.rule === 'Roster limit') {
        for (const f of fillers) {
          const balanced = { ...deal, inc: [target.p, f.p] }
          const c2 = legality(buyer, seller, balanced, allRosters())
          if (c2.ok) { deal.inc = balanced.inc; cap = c2; break }
        }
      }
      if (!cap.ok) continue
      let used = []
      let sellerSays = decideTrade(seller, { in: out, out: deal.inc },
        { from: buyer, ctx: sellerCtx, roster: rostersOf(seller), ranks, year })
      // A rotation player does not cost a first-round pick. Ever.
      const pickBudget = tierOut >= 2 ? budget : 0
      const worth = Math.max(12e6, playerMarketValue(target.p).value)
      for (const { k, v } of picks) {
        if (sellerSays.need <= 0 || used.length >= pickBudget) break
        if (v > worth * 0.6) break
        used.push(k)
        const owned = (ledger[buyer] || []).filter((x) => !used.some((u) => pickKey(u) === pickKey(x)))
        if (!violatesStepien(owned, buyer, year).ok) { used.pop(); break }
        sellerSays = decideTrade(seller, { in: out, out: deal.inc, inPicks: used },
          { from: buyer, ctx: sellerCtx, roster: rostersOf(seller), ranks, year })
      }
      // Both sides have to want it clearly, not marginally. A CPU that trades on a
      // one-dollar edge churns its roster every week.
      if (sellerSays.need > -margin) continue
      deal.outPicks = [...used]
      const buyerSays = decideTrade(buyer, { in: deal.inc, out, outPicks: used },
        { from: seller, ctx: plan.ctx, roster: buyerRoster, ranks, year })
      if (buyerSays.need > -margin * 0.5) continue
      return { buyer, seller, deal, buyerSays, sellerSays, ask, target: target.p,
        text: `${CITY[buyer][1]} get ${deal.inc.map((p) => p.n).join(' and ')} from ${CITY[seller][1]} for `
          + `${out.map((p) => p.n).concat(used.map((k) => pickLabel(k, ranks[k.from]))).join(', ') || 'cash considerations'}` }
    }
  }
  return null
}

// A round of league business. Every team gets a turn in an order the seed decides, the
// active ones actually make calls, and what they agree to is applied to the league.
export function runMarket(save, opts = {}) {
  const offices = save.frontOffices || {}
  // A player who just changed teams is not on the market again next week. Without this the
  // league undoes its own work: Josh Giddey went to San Antonio and back to Chicago inside
  // a month, because each round re-evaluated from scratch with no memory of the last one.
  const cooling = new Set(Object.keys(save.recentlyMoved || {}))
  const r = opts.r || rng((save.rngSeed ^ 0x7ade) >>> 0)
  const teams = Object.keys(SEED.teams).filter((t) => t !== save.franchise.team)
  r.shuffle(teams)
  const done = []
  const touched = new Set([save.franchise.team])
  const max = opts.max ?? (opts.window === 'deadline' ? 4 : opts.window === 'offseason' ? 3 : 1)

  for (const team of teams) {
    if (done.length >= max) break
    const fo = offices[team] || {}
    // Not every team is working the phones every week.
    // Most teams do nothing in most weeks, which is what a real transaction wire looks
    // like: long quiet stretches and a burst in February.
    const base = opts.intensity ?? (opts.window === 'deadline' ? 0.7
      : opts.window === 'offseason' ? 0.45 : 0.2)
    if (r.rand() > (fo.activity ?? 0.5) * base) continue
    if (touched.has(team)) continue
    const plan = agenda(team, { fo, ledger: save.picks, ranks: opts.ranks, year: opts.year,
      stance: readStance(save), stanceTeam: save.franchise.team })
    plan.targets = plan.targets.filter((t) => !cooling.has(t.p.uid || t.p.n))
    // Shuffle the shortlist so two teams with similar needs do not converge on the same
    // deal every time the market runs.
    r.shuffle(plan.targets)
    if (!plan.targets.length) continue
    const deal = attempt(team, plan, { ...opts, fo, offices, ledger: save.picks,
      cooling, window: opts.window || 'quiet',
      pick: r.randrange(Math.min(5, plan.targets.length)) })
    if (!deal) continue
    if (touched.has(deal.seller)) continue
    touched.add(team); touched.add(deal.seller)
    done.push(deal)
  }
  return done
}

// What a front office would come to YOU with, unprompted. Same machinery, aimed at your
// roster — which is why the offer that arrives is one this particular team wants rather
// than a generic package.
export function offersForUser(save, opts = {}) {
  const offices = save.frontOffices || {}
  const mine = save.franchise.team
  const r = opts.r || rng((save.rngSeed ^ 0x0ffe4) >>> 0)
  const teams = Object.keys(SEED.teams).filter((t) => t !== mine)
  r.shuffle(teams)
  const out = []
  for (const team of teams) {
    if (out.length >= (opts.max ?? 3)) break
    const fo = offices[team] || {}
    if (r.rand() > (fo.activity ?? 0.5) * (opts.intensity ?? 0.5)) continue
    const plan = agenda(team, { fo, ledger: save.picks, ranks: opts.ranks, year: opts.year,
      stance: readStance(save), stanceTeam: save.franchise.team })
    const mineTargets = plan.targets.filter((t) => t.from === mine)
    if (!mineTargets.length) continue
    const deal = attempt(team, { ...plan, targets: mineTargets }, { ...opts, fo, offices,
      ledger: save.picks, pick: 0 })
    if (!deal) continue
    out.push({
      team, fo, deal: deal.deal, theirs: deal.sellerSays, buyer: deal.buyerSays,
      want: mineTargets[0].p,
      pitch: `${SEED.teams[team].name} (${describeFO(fo)}) have called about ${mineTargets[0].p.n}.`,
    })
  }
  return out
}
