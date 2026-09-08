// LAYER SIX — negotiation.
//
// "Rejected" is not an answer a front office gives. It says what it would need, or what
// it would rather have, or that the player is not available at any price. This layer
// turns a refusal into the smallest change that would fix it, and answers the other
// question a GM actually asks: what is out there for this guy?
import { SEED } from '../seed.js'
import { allRosters } from '../league.js'
import { CITY } from '../theme.js'
import { validateTrade, teamSalary, status, maxIncoming } from '../cap.js'
import { pickKey, label as pickLabel, violatesStepien } from '../picks.js'
import { playerMarketValue, pickMarketValue } from './market.js'
import { teamContext } from './context.js'
import { assetUtility, assetCost } from './utility.js'
import { stanceTaste, stancePickTaste, readStance, stanceAsk } from './stance.js'
import { decideTrade, availabilityOf, AVAILABILITY, VERDICT, wontPartWith } from './accept.js'

const money = (n) => `$${(Math.abs(n) / 1e6).toFixed(1)}M`
const uid = (p) => p.uid || `${p.n}|${p.s}`

// A proposal is always written from the user's side: `out` leaves the user, `inc` arrives.
const flip = (deal) => ({ in: deal.out || [], out: deal.inc || [],
  inPicks: deal.outPicks || [], outPicks: deal.inPicks || [] })

export function legality(mine, other, deal, rosters) {
  const myRoster = rosters[mine], theirRoster = rosters[other]
  const cap = validateTrade([
    { team: mine, roster: myRoster, out: deal.out || [], inc: deal.inc || [] },
    { team: other, roster: theirRoster, out: deal.inc || [], inc: deal.out || [] },
  ])
  return cap
}

/* ----------------------------------------------------- what would make it work */

// Smallest reasonable adjustment, not a rebuilt deal. Candidates are ranked by how much
// the other side wants them per dollar of what they cost you, so the counter asks for the
// thing you can most afford to give.
export function makeItWork(mine, other, deal, opts = {}) {
  const rosters = opts.rosters || allRosters()
  const ledger = opts.ledger || {}
  const year = opts.year ?? parseInt(SEED.season, 10)
  const ranks = opts.ranks || {}
  // What you have told the league you are doing. It does not change what a counter has to be
  // WORTH — `base.need` is untouched and every candidate still has to clear it — only which
  // of your assets they reach for first. Declaring yourself a buyer does not make your
  // twenty-year-old cheaper; it makes him the one they ask about.
  const stance = opts.stance || readStance(opts.save)
  const theirCtx = teamContext(other, { roster: rosters[other], ...opts })
  const base = decideTrade(other, flip(deal), { ...opts, from: mine, ctx: theirCtx, roster: rosters[other], ranks, year })

  // A REFUSAL WITH A NUMBER BEHIND IT IS STILL WORTH QUOTING.
  //
  // This used to return here for anybody untouchable, and the panel said "he is not available
  // at any price, ask about someone else" — the least useful sentence a trade desk can print,
  // and the end of the conversation. A franchise player now carries a price rather than a
  // wall, so the honest thing is to go and find out what it is. The verdict still reads
  // untouchable, because being three hundred million short IS a refusal; what changes is that
  // the desk can now say what would change their mind, which is the question a GM is asking.
  //
  // Only a genuinely uncomputable refusal — a shape they want no part of, with no finite gap —
  // still ends the conversation here.
  if (!Number.isFinite(base.need) || base.verdict === VERDICT.NONSTARTER) {
    return { ok: false, verdict: base.verdict, reasons: base.reasons, counters: [],
      need: base.need,
      ask: base.verdict === VERDICT.UNTOUCHABLE
        ? 'He is not available at any price. Ask about someone else.'
        : 'They want no part of this shape. Start from a different piece.' }
  }
  // A deal can fail for two entirely different reasons, and both are answerable. The cap
  // one is the more common and the more annoying: the trade is fine, the salaries do not
  // line up, and what it needs is filler rather than more value.
  const baseCap = legality(mine, other, deal, rosters)
  if (base.need <= 0 && baseCap.ok) {
    return { ok: true, verdict: base.verdict, reasons: base.reasons, counters: [] }
  }
  const illegal = !baseCap.ok

  const already = new Set((deal.out || []).map(uid))
  const players = (rosters[mine] || []).filter((p) => !already.has(uid(p)))
  const haveKeys = new Set((deal.outPicks || []).map(pickKey))
  const picks = (ledger[mine] || []).filter((p) => !haveKeys.has(pickKey(p)) && p.year > year)

  const cand = []
  for (const p of players) {
    const want = assetUtility(p, other, { ctx: theirCtx, roster: rosters[other], ranks, year }).value
    if (want <= 0) continue
    const cost = assetCost(p, mine, { roster: rosters[mine], ...opts }).value
    cand.push({ kind: 'player', p, want, cost, label: p.n, lean: want * stanceTaste(p, stance) })
  }
  for (const k of picks) {
    const want = pickMarketValue(k, ranks[k.from], year).value * (0.5 + theirCtx.futureOrientation)
    const cost = pickMarketValue(k, ranks[k.from], year).value
    cand.push({ kind: 'pick', pick: k, want, cost, label: pickLabel(k, ranks[k.from]),
      lean: want * stancePickTaste(stance) })
  }
  // Cheapest satisfying addition first: most wanted per unit of what it costs you. When
  // the problem is the cap rather than the price, salary is what has to move, so rank by
  // how much of the shortfall each contract covers instead.
  if (illegal) {
    const gap = (baseCap.shortfall ?? 0) || 1
    cand.sort((a, b) => {
      const sa = a.kind === 'player' ? a.p.s : 0
      const sb = b.kind === 'player' ? b.p.s : 0
      return Math.abs(sa - gap) - Math.abs(sb - gap)
    })
  } else {
    cand.sort((a, b) => (b.lean / Math.max(1e6, b.cost)) - (a.lean / Math.max(1e6, a.cost)))
  }

  // Their throw-ins, cheapest first — what a team sends back to balance a roster count.
  const fillers = (rosters[other] || [])
    .filter((p) => !(deal.inc || []).some((x) => uid(x) === uid(p)))
    .map((p) => ({ p, m: playerMarketValue(p) }))
    .filter((x) => x.m.tier <= 1)
    .sort((a, b) => a.m.value - b.m.value)

  const counters = []
  const tryDeal = (add, depth = 0) => {
    const next = {
      ...deal,
      out: [...(deal.out || []), ...add.filter((a) => a.kind === 'player').map((a) => a.p)],
      outPicks: [...(deal.outPicks || []), ...add.filter((a) => a.kind === 'pick').map((a) => a.pick)],
    }
    let cap = legality(mine, other, next, rosters)
    // A two-for-one into a full roster is not a rejection of the idea, it is a missing
    // throw-in. Real front offices solve this with a minimum contract going back.
    if (!cap.ok && cap.rule === 'Roster limit' && depth < 1) {
      for (const f of fillers.slice(0, 4)) {
        const balanced = { ...next, inc: [...(next.inc || []), f.p] }
        const c2 = legality(mine, other, balanced, rosters)
        if (c2.ok) { next.inc = balanced.inc; cap = c2; break }
      }
    }
    if (!cap.ok) return null
    const owned = (ledger[mine] || []).filter((p) => !next.outPicks.some((x) => pickKey(x) === pickKey(p)))
    if (!violatesStepien([...owned, ...(next.inPicks || [])], mine, year).ok) return null
    const d = decideTrade(other, flip(next), { ...opts, from: mine, ctx: theirCtx, roster: rosters[other], ranks, year })
    if (d.need > 0) return null
    return { deal: next, decision: d, add }
  }

  // one asset
  for (const c of cand) {
    if (counters.length >= 3) break
    if (!illegal && c.want < base.need * 0.55) continue
    const r = tryDeal([c])
    if (r) counters.push({ ...r, text: `Add ${c.label} and they will do it.` })
  }
  // two, then three, when nothing single closes it
  const top = cand.slice(0, 14)
  if (!counters.length) {
    for (let i = 0; i < top.length && counters.length < 2; i++) {
      for (let j = i + 1; j < top.length && counters.length < 2; j++) {
        const r = tryDeal([top[i], top[j]])
        if (r) counters.push({ ...r, text: `Add ${top[i].label} and ${top[j].label} and they will do it.` })
      }
    }
  }
  if (!counters.length) {
    for (let i = 0; i < top.length && !counters.length; i++) {
      for (let j = i + 1; j < top.length && !counters.length; j++) {
        for (let k = j + 1; k < top.length && !counters.length; k++) {
          const r = tryDeal([top[i], top[j], top[k]])
          if (r) {
            counters.push({ ...r,
              text: `Add ${top[i].label}, ${top[j].label} and ${top[k].label} and they will do it.` })
          }
        }
      }
    }
  }

  const ask = stanceAsk(stance) || (theirCtx.futureOrientation > 0.5 ? 'draft capital or a young player'
    : theirCtx.contention > 0.55 ? 'someone who helps them win now'
      : 'more value')
  return {
    ok: false,
    verdict: base.verdict,
    need: base.need,
    illegal,
    rule: illegal ? baseCap.rule : null,
    reasons: illegal ? [baseCap.detail, ...base.reasons] : base.reasons,
    counters,
    ask: counters.length ? null
      : illegal ? 'Nothing on your roster makes the salaries work. You need a third team or a different shape.'
        : `They want ${ask}, and nothing you have left closes the gap.`,
  }
}

/* --------------------------------------------------------------- shop a player */

// Ask the league what it would give up. Not every team calls back, which is the point.
//
// Packages are assembled SALARY FIRST and value second. Doing it the other way round —
// build something they would like, then hope it is cap-legal — almost never lands in the
// matching window, and it is the reason an earlier version of the deadline generated
// offers from half the league and silence from the rest.
// Shop a PACKAGE, not a player. Two contracts and a first is a completely different
// question from either piece alone — it is how salary gets matched, how a team clears a
// logjam, and how anybody acquires a star — and asking it one player at a time gave
// answers to a question nobody was asking.
export function shopAsset(player, mine, opts = {}) {
  return shopPackage({ players: [player], picks: [] }, mine, opts)
}

export function shopPackage(pkg, mine, opts = {}) {
  const players = pkg.players || []
  const outPicks = pkg.picks || []
  if (!players.length && !outPicks.length) return []
  const rosters = opts.rosters || allRosters()
  const ledger = opts.ledger || {}
  const year = opts.year ?? parseInt(SEED.season, 10)
  const ranks = opts.ranks || {}
  const myRoster = rosters[mine] || []
  const stance = opts.stance || readStance(opts.save)
  // A stance decides who picks up the phone, not what they say once they do. Shop a
  // thirty-year-old starter after telling the league you are selling and more teams call
  // back; shop the same man having declared yourself a buyer and most of them assume you
  // are not serious. The bar to respond moves. Every offer behind it is priced identically.
  const lean = players.length
    ? players.reduce((t, pl) => t + stanceTaste(pl, stance), 0) / players.length
    : stancePickTaste(stance)
  const bar = 6e6 / Math.max(0.6, Math.min(1.4, lean))
  const out = []

  for (const other of Object.keys(SEED.teams)) {
    if (other === mine) continue
    const ctx = teamContext(other, { roster: rosters[other], ...opts })
    // What the whole package is worth to them: every contract valued in their situation,
    // every pick at its market price. A package can be worth more than its parts (salary
    // filler that makes a deal legal) or less (three rotation players when they need one).
    const interest = players.reduce((acc, pl) => {
      const u = assetUtility(pl, other, { ctx, roster: rosters[other], ranks, year })
      return { value: acc.value + u.value }
    }, { value: 0 })
    for (const k of outPicks) interest.value += pickMarketValue(k, ranks[k.from], year).value
    if (interest.value < bar) {
      out.push({ team: other, ctx, interest: interest.value, offers: [],
        note: interest.value < -10e6
          ? 'no interest — they would want paying to take him on'
          : 'no interest' })
      continue
    }

    // Who they would part with, and what parting costs them.
    const theirs = (rosters[other] || [])
      .filter((p) => !wontPartWith(availabilityOf(p, other, { ctx, roster: rosters[other] }).level))
      .map((p) => ({ p, m: playerMarketValue(p), cost: assetCost(p, other, { ctx, roster: rosters[other], ranks, year }).value }))
    const bySalary = [...theirs].sort((a, b) => b.p.s - a.p.s)
    // Seconds count. They are the most common sweetener in the league, and excluding them
    // meant the engine could not close a gap of a few million without moving a first.
    const theirPicks = (ledger[other] || []).filter((k) => k.year > year && !k.forfeit)
      .map((k) => ({ k, v: pickMarketValue(k, ranks[k.from], year).value }))
      .sort((a, b) => a.v - b.v)

    // Salary-legal shapes: nothing at all (picks only, which is how a team with cap room
    // buys a cheap contributor), then one to three of their contracts.
    const shapes = [[]]
    for (let i = 0; i < Math.min(12, bySalary.length); i++) {
      shapes.push([bySalary[i]])
      for (let j = i + 1; j < Math.min(12, bySalary.length); j++) {
        shapes.push([bySalary[i], bySalary[j]])
        for (let k = j + 1; k < Math.min(10, bySalary.length); k++) {
          shapes.push([bySalary[i], bySalary[j], bySalary[k]])
        }
      }
    }

    const offers = []
    const seen = new Set()
    for (const shape of shapes) {
      if (offers.length >= 3) break
      const inc = shape.map((x) => x.p)
      const key = inc.map((p) => uid(p)).sort().join('|')
      if (seen.has(key)) continue
      const deal = { other, out: players, inc, outPicks, inPicks: [] }
      if (!legality(mine, other, deal, rosters).ok) continue
      // Top up with picks — cheapest first — until they clear their own bar.
      let d = decideTrade(other, flip(deal), { ...opts, from: mine, ctx, roster: rosters[other], ranks, year })
      const used = []
      for (const cand of theirPicks) {
        if (d.need <= 0) break
        used.push(cand.k)
        deal.inPicks = [...used]
        const owned = (ledger[other] || []).filter((k) => !used.some((x) => pickKey(x) === pickKey(k)))
        if (!violatesStepien(owned, other, year).ok) { used.pop(); deal.inPicks = [...used]; continue }
        d = decideTrade(other, flip(deal), { ...opts, from: mine, ctx, roster: rosters[other], ranks, year })
      }
      if (d.need > 0) continue
      // Whether the offer is GOOD for us is not a filter — it is information. You asked
      // what the league would give up; hiding the offers you should turn down is how a
      // trade finder becomes a wish list.
      const ours = decideTrade(mine, { in: deal.inc, out: players, inPicks: deal.inPicks, outPicks },
        { ...opts, from: other, roster: myRoster, ranks, year })
      // Sending picks out has to clear OUR Stepien position too — the finder offering a
      // deal the league would refuse is worse than offering nothing.
      if (outPicks.length) {
        const keep = (ledger[mine] || []).filter((k) => !outPicks.some((x) => pickKey(x) === pickKey(k)))
        if (!violatesStepien([...keep, ...deal.inPicks], mine, year).ok) continue
      }
      seen.add(key)
      const flavour = !inc.length ? 'picks only'
        : deal.inPicks.length && inc.every((p) => playerMarketValue(p).tier <= 1) ? 'draft capital'
        : inc.some((p) => (p.a ?? 30) <= 24) ? 'youth' + (deal.inPicks.length ? ' and a pick' : '')
          : inc.some((p) => playerMarketValue(p).tier >= 2) ? 'win-now help'
            : 'salary and a sweetener'
      offers.push({
        flavour, deal, theirs: d, mine: ours,
        pieces: inc.map((p) => p.n).concat(deal.inPicks.map((k) => pickLabel(k, ranks[k.from]))),
      })
    }
    // Best for us first.
    offers.sort((a, b) => b.mine.delta - a.mine.delta)
    out.push({ team: other, ctx, interest: interest.value, offers: offers.slice(0, 2),
      note: offers.length ? null : 'interested, but nothing they will part with fits' })
  }
  out.sort((a, b) => (b.offers[0]?.mine.delta ?? -Infinity) - (a.offers[0]?.mine.delta ?? -Infinity))
  return out
}
