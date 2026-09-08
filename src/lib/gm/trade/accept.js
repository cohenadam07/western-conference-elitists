// LAYER FOUR — acceptance.
//
// Utility says how much a team wants something. Acceptance says whether an organisation
// actually does it, which is a different question with different failure modes. Real
// front offices refuse deals that improve them on paper, because the best player in the
// trade matters, because young talent is not swapped for equal veteran talent, because
// nobody trades the face of the franchise, and because doing a deal has a cost.
//
// This is also where a game is made unexploitable. A deterministic valuation with a fixed
// threshold can be drained one favourable trade at a time; scrutiny rises with every deal
// a partner has already extracted.
import { SEED } from '../seed.js'
import { rostersOf } from '../league.js'
import { CITY } from '../theme.js'
import { playerMarketValue, pickMarketValue, talentVorp, TIERS } from './market.js'
import { teamContext, bandOf, ratePerMin } from './context.js'
import { changeUtility } from './utility.js'
import { situationOf, shiftLevel } from '../story.js'

export const VERDICT = {
  ACCEPT: 'accept',
  LIKELY: 'likely',
  NEGOTIABLE: 'negotiable',
  COUNTER: 'counter',
  REJECT: 'reject',
  NONSTARTER: 'nonstarter',
  UNTOUCHABLE: 'untouchable',
}

// THE LADDER, NAMED.
//
// The old top rung said "not moving, at any price", and it meant it — a franchise player was
// a wall the negotiation layer could not get past, so the desk's answer was "he is not
// available at any price, ask about someone else" and there was nothing else to say.
//
// That is not how the league works. Franchise players move: Durant, Doncic, Lillard, Davis,
// Harden, Mitchell — all of them, inside a decade. What is true is that nobody gets one for a
// FAIR package. They cost an overwhelming one, and usually there is a story underneath.
//
// So the top of the ladder is a PRICE rather than a gate. A franchise player carries a
// threshold so large that only a genuine haul clears it, and the desk can finally answer the
// question a GM actually asks — not "no", but "what would it take?"
export const AVAILABILITY = {
  FRANCHISE: 'franchise',  // the face of the club: an overwhelming offer, or nothing
  CORE: 'core',            // they build around him; it takes a clear overpay
  PREMIUM: 'premium',      // they like him; they would have to be paid
  AVAILABLE: 'available',
  SHOPPING: 'shopping',    // actively looking to move him
  DUMP: 'dump',            // will attach value to get him gone
}

// WILL THIS CLUB PART WITH HIM AT ALL.
//
// FRANCHISE sits ABOVE core on the ladder — "an overwhelming offer, or nothing" — so
// everywhere that protects a core player has to protect a franchise player at least as
// hard. Four separate sites each spelled that as `level !== CORE`, which let exactly the
// three most untouchable men in the league through while correctly protecting the
// forty-one below them: San Antonio would hand over Victor Wembanyama as salary filler
// but not its second-best player. The deadline inbox offered Wembanyama and Tobias
// Harris for Shai Gilgeous-Alexander and graded it the best deal on the board.
//
// One predicate, so the four sites cannot drift apart again.
export const KEPT = [AVAILABILITY.FRANCHISE, AVAILABILITY.CORE]
export const wontPartWith = (level) => KEPT.indexOf(level) >= 0

// What each rung costs on top of the deal's own value, as a multiple of what the man is
// worth — and a floor, because a franchise player on a bad contract still costs a haul.
const RUNG = {
  [AVAILABILITY.FRANCHISE]: { mult: 1.15, floor: 140e6 },
  [AVAILABILITY.CORE]: { mult: 0.60, floor: 45e6 },
  [AVAILABILITY.PREMIUM]: { mult: 0.35, floor: 18e6 },
}

/* -------------------------------------------------------------- untouchables */

// Derived from what the team is and who the player is, not from a hand-kept list.
// THE STORY LAYER SITS HERE, AND ONLY HERE.
//
// A trade request does not change what a man is worth — every price below is still the same
// number about basketball. What it changes is how willing his club is to listen: one rung
// down the ladder, so a franchise player becomes gettable for a clear overpay rather than not
// at all. That is how Lillard and Davis and Butler actually moved, and keeping it out of the
// valuation is what stops it from turning into a discount.
export function availabilityOf(player, team, opts = {}) {
  const base = baseAvailability(player, team, opts)
  const sit = opts.situation !== undefined ? opts.situation : situationOf(player)
  const level = shiftLevel(base.level, sit)
  if (level === base.level) return base
  return { ...base, level, base: base.level, situation: sit,
    why: sit.state === 'standoff'
      ? `${base.why} — but his contract talks have broken down`
      : `${base.why} — but he has asked to be traded` }
}

function baseAvailability(player, team, opts = {}) {
  const ctx = opts.ctx || teamContext(team, opts)
  const roster = opts.roster || rostersOf(team)
  const m = playerMarketValue(player)
  // Ages are decimals in the data and integers in basketball. A 25.4-year-old failing an
  // "age <= 25" gate is how Deni Avdija stopped being Portland's untouchable young core
  // and became a player they would trade for a prospect.
  const age = Math.floor(m.age)
  // Ranked by TALENT, not by asset value. Market value is contract-adjusted, so an
  // ageing star on a maximum deal has a deeply negative asset value — and a team's
  // franchise player was briefly classified as a salary dump because of it.

  if (m.tier >= 5) return { level: AVAILABILITY.FRANCHISE, why: 'the face of the franchise' }

  // A contender's core is not one player. Treating only the single best as untouchable
  // had Oklahoma City shopping Chet Holmgren because Shai Gilgeous-Alexander exists.
  const ranked = roster.map((p) => ({ p, t: talentVorp(p) })).sort((a, b) => b.t - a.t)
  const rank = ranked.findIndex((x) => (x.p.uid || x.p.n) === (player.uid || player.n))
  const isBest = rank === 0
  const inTopThree = rank >= 0 && rank < 3

  // The best player on a genuine contender is a franchise player in every sense that matters
  // to a trade, whatever his tier says.
  if (isBest && ctx.contention > 0.62 && m.tier >= 4) {
    return { level: AVAILABILITY.FRANCHISE, why: 'the best player on a team trying to win now' }
  }
  if (isBest && ctx.contention > 0.4 && m.tier >= 2) {
    return { level: AVAILABILITY.CORE, why: 'the best player on a team trying to win now' }
  }
  if (inTopThree && ctx.contention > 0.52 && m.tier >= 2) {
    return { level: AVAILABILITY.CORE, why: 'part of a core that is trying to win now' }
  }
  if (m.tier >= 4 && age <= 27) return { level: AVAILABILITY.CORE, why: 'young and elite' }
  if (inTopThree && age <= 25 && m.tier >= 3) {
    return { level: AVAILABILITY.CORE, why: 'a young building block' }
  }
  // A 23-year-old who is already one of your two best players is a building block on any
  // team, whatever its record. Requiring a starter's tier as well left Brandon Miller —
  // Charlotte's second-best player at 23 — sitting in the window as "a rotation piece".
  if (rank >= 0 && rank < 2 && age <= 24 && m.tier >= 2) {
    return { level: AVAILABILITY.CORE, why: 'a young building block' }
  }
  if (inTopThree && age <= 26 && m.tier >= 2) {
    return { level: AVAILABILITY.PREMIUM, why: 'young, and one of the best players they have' }
  }
  if (m.tier >= 3 && age <= 24 && ctx.futureOrientation > 0.4) {
    return { level: AVAILABILITY.PREMIUM, why: 'part of the long-term core' }
  }
  // STATURE, WHICH THE AGEING CURVE CANNOT SEE.
  //
  // The projection is harsh on a thirty-eight-year-old and it is not wrong to be — but it had
  // Golden State accepting two first-round picks for Stephen Curry, because by next season's
  // forecast alone he is no longer a starter. No front office on earth makes that call. A
  // club's most-used player is its centrepiece whatever the model thinks of his next twelve
  // months, and moving him is a decision about the franchise rather than about value.
  // Top TWO by minutes, not top one: Curry plays 30.9 a night on a roster where Jimmy Butler
  // plays 31.1, and "second-most used man on the Warriors" is not a description of somebody
  // you can have for two first-round picks.
  const byMinutes = [...roster].sort((a2, b2) => (b2.mpg ?? 0) - (a2.mpg ?? 0)).slice(0, 2)
  const central = byMinutes.some((x) => (x.uid || x.n) === (player.uid || player.n))
  if (central && (player.mpg ?? 0) >= 30) {
    // On a club with something to play for, the man who plays the most is not a premium
    // asset, he is the team. New York was accepting two first-round picks for Jalen Brunson
    // because the aging curve has him at tier three and nothing else in the ladder had heard
    // of him. A playoff team does not sell its most-used player for picks.
    return ctx.contention > 0.45
      ? { level: AVAILABILITY.CORE, why: 'the man this team is built around on the floor' }
      : { level: AVAILABILITY.PREMIUM, why: 'the man this team is built around on the floor' }
  }
  if (m.tier >= 3) return { level: AVAILABILITY.PREMIUM, why: 'a starter they would have to be paid for' }
  // A negative contract is only a dump if the player is not still a real contributor and
  // the money is genuinely bad. At a $20M threshold a third of the league came out as a
  // salary dump, which says more about how harshly the price curve treats anyone paid
  // above the market than about the players.
  if (m.negative && m.value < -45e6 && m.tier <= 1) {
    return { level: AVAILABILITY.DUMP, why: 'a contract they want off the books' }
  }
  if (ctx.futureOrientation > 0.55 && age >= 30) {
    return { level: AVAILABILITY.SHOPPING, why: 'a veteran on a team looking to the future' }
  }
  return { level: AVAILABILITY.AVAILABLE, why: 'a rotation piece' }
}

/* ------------------------------------------------------------------ the guards */

const bestTier = (players) => players.reduce((t, p) => Math.max(t, playerMarketValue(p).tier), -1)

// Friction: doing a deal costs something even when the numbers say yes — medicals,
// fit risk, the roster churn, the explaining. Small, but it stops infinite churn.
const FRICTION = 7e6
const CHURN = 2.5e6

export function decideTrade(team, change, opts = {}) {
  const ctx = opts.ctx || teamContext(team, opts)
  const roster = opts.roster || rostersOf(team)
  const inP = change.in || [], outP = change.out || []
  const u = changeUtility(team, change, { ...opts, ctx, roster })

  const reasons = []
  const codes = []
  let threshold = FRICTION + CHURN * (inP.length + outP.length)
  let block = null

  // 1. What it costs to prise somebody loose.
  //
  //    Priced, not blocked. The old version returned a hard refusal for anybody a club built
  //    around, which meant the negotiation layer had nothing to compute and the desk could
  //    only say "not available at any price, ask about somebody else" — the least useful
  //    sentence in a trade game. Every one of these men has a number. It is a very large
  //    number, and saying it out loud is the whole point of a trade desk.
  let topRung = null
  for (const p of outP) {
    const a = availabilityOf(p, team, { ...opts, ctx, roster })
    const rung = RUNG[a.level]
    if (!rung) continue
    const worth = playerMarketValue(p).value
    threshold += Math.max(rung.floor, worth * rung.mult)
    if (a.level === AVAILABILITY.FRANCHISE) {
      topRung = { p, a }
      codes.push('FRANCHISE')
      reasons.push(`${p.n} is ${a.why}. It would take a haul, and they would still have to `
        + `explain it.`)
    } else if (a.level === AVAILABILITY.CORE) {
      if (!topRung) topRung = { p, a }
      codes.push('BUILDS_AROUND')
      reasons.push(`${p.n} is ${a.why}; they are not moving him for value, only for a lot more than value.`)
    } else {
      codes.push('WANTS_OVERPAY')
      reasons.push(`${p.n} is ${a.why}; moving him takes a clear overpay.`)
    }
  }

  // 2. The best player in the trade matters. Volume does not buy quality — this is the
  //    single most common way sports games produce absurd trades.
  //
  //    But SELLING IS NOT CONSOLIDATING, and conflating the two broke the market. This guard
  //    compared the best player leaving against the best player arriving, counted picks as
  //    nothing, and so read every player-for-picks deal as "turning talent into pieces" —
  //    which made it a non-starter outright for any team with a pulse. A rotation player for
  //    two second-rounders came back "nonstarter". So did taking a bad contract off somebody
  //    for a second. Those are not exotic trades, they are most of the transaction wire, and
  //    the engine could not do any of them.
  //
  //    The distinction is what is coming BACK. A team that gives up its best player and
  //    receives worse players is consolidating downward and should refuse. A team that gives
  //    him up for draft capital is selling, which is a thing teams do constantly and on
  //    purpose — and whether it is a good idea is a question about VALUE, which the threshold
  //    below already answers. So the guard only bites when players come the other way.
  const tIn = bestTier(inP), tOut = bestTier(outP)
  const incomingPicks = (change.inPicks || []).length
  if (outP.length && tOut > tIn && inP.length) {
    const gap = tOut - tIn
    // The premium is set by the BEST player leaving, not the sum of the package. Summing
    // let a team bundle a negative contract alongside a good player and have the negative
    // one quietly shrink the guard that was supposed to protect the good one.
    const bestOut = Math.max(0, ...outP.map((p) => playerMarketValue(p).value))
    // Draft capital coming back is not "pieces". It softens the guard rather than clearing
    // it: Phoenix gave up Mikal Bridges and Cameron Johnson for one older, better player and
    // took four firsts back doing it.
    const relief = Math.min(0.6, incomingPicks * 0.15)
    threshold += gap * 0.45 * (1 - relief) * Math.max(25e6, bestOut)
    codes.push('CONSOLIDATION')
    reasons.push(gap >= 2
      ? `They are not turning ${TIERS[tOut]}-level talent into ${inP.length > 1 ? 'depth' : 'a lesser player'}.`
      : `The best player in this deal is theirs, and that is not how they lose a trade.`)
    // Not for a franchise player. His rung already carries a price so large that only a haul
    // clears it, and blocking on top of that puts the wall back — which is the exact thing
    // the ladder was rebuilt to remove. The number has to exist for the desk to quote it.
    if (gap >= 2 && ctx.contention > 0.5 && incomingPicks < 2 && !codes.includes('FRANCHISE')) {
      block = { verdict: VERDICT.NONSTARTER, code: 'CONSOLIDATION',
        text: `${CITY[team][1]} are trying to win now and will not break up ${TIERS[tOut]}-level talent for pieces.` }
    }
  }

  // 3. Young talent is not swapped for equal old talent, and the more a team is looking
  //    forward the more that holds.
  for (const p of outP) {
    const mo = playerMarketValue(p)
    if (Math.floor(mo.age) > 25 || mo.tier < 2) continue
    const oldest = inP.length ? Math.min(...inP.map((x) => playerMarketValue(x).age)) : 99
    if (oldest >= mo.age + 3) {
      threshold += (0.25 + 0.5 * ctx.futureOrientation) * Math.max(10e6, mo.value)
      codes.push('TIMELINE')
      reasons.push(`${p.n} is ${Math.round(mo.age)}; the players coming back are older than their timeline.`)
    }
  }

  // 4. Anti-exploit: every deal this partner has already got done raises the scrutiny.
  const done = opts.history?.[opts.from] ?? 0
  if (done > 0) {
    threshold += done * 12e6
    if (done >= 3) {
      codes.push('SPAM')
      reasons.push('They have already done business with you this season and are done being helpful.')
    }
  }

  // 5. Roster reality: a team with a full band does not want another body in it.
  for (const p of inP) {
    const band = bandOf(p)
    const rot = u.ctx.profile.rotation.filter((r) => bandOf(r.p).key === band.key)
    const worst = rot.length ? Math.min(...rot.map((r) => ratePerMin(r.p))) : -99
    if (rot.length >= 4 && ratePerMin(p) <= worst) {
      codes.push('ROSTER_PROBLEM')
      reasons.push(`They are already deep at ${band.key === 'big' ? 'the front court' : band.key === 'guard' ? 'guard' : 'the wing'}.`)
      threshold += 8e6
    }
  }

  if (block) {
    return { ...u, team, verdict: block.verdict, code: block.code, threshold: Infinity,
      need: Infinity, reasons: [block.text, ...reasons], codes: [block.code, ...codes] }
  }

  const need = threshold - u.delta
  const scale = Math.max(30e6, threshold)
  // UNTOUCHABLE is a RESPONSE now, not a gate. It still reads the same to the user when the
  // offer is nowhere near — "he is not available" is the honest summary of being two hundred
  // million short for a franchise player — but `need` stays FINITE, so the negotiation layer
  // can answer the question that actually interests a general manager: not "no", but "what
  // would it take?".
  const franchise = codes.includes('FRANCHISE')
  const verdict = u.delta >= threshold * 1.35 ? VERDICT.ACCEPT
    : u.delta >= threshold ? VERDICT.LIKELY
      : need <= scale * 0.25 ? VERDICT.NEGOTIABLE
        : need <= scale * 0.9 ? VERDICT.COUNTER
          : need <= scale * 2.5 ? (franchise ? VERDICT.UNTOUCHABLE : VERDICT.REJECT)
            : (franchise ? VERDICT.UNTOUCHABLE : VERDICT.NONSTARTER)

  // What they would say, in the order a front office would say it.
  if (!reasons.length || verdict === VERDICT.ACCEPT || verdict === VERDICT.LIKELY) {
    const c = u.components
    const biggest = Object.entries(c).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]
    if (verdict === VERDICT.ACCEPT || verdict === VERDICT.LIKELY) {
      reasons.unshift(c.equity > 0 && u.wins.delta > 0.6
        ? `This makes them better now — about ${u.wins.delta.toFixed(1)} wins.`
        : c.capital > 0 ? 'They like the draft capital.'
          : c.money > 0 ? 'The money works for them.'
            : 'It clears their bar.')
    } else if (biggest && biggest[1] < 0) {
      const label = { equity: 'It makes them worse on the floor this season.',
        future: 'They lose too much long-term value.',
        capital: 'They are giving up draft capital they want to keep.',
        money: 'The money does not work — it costs them tax and flexibility.' }
      reasons.unshift(label[biggest[0]])
    }
  }
  if (verdict === VERDICT.COUNTER || verdict === VERDICT.REJECT) {
    codes.push(ctx.futureOrientation > 0.5 ? 'WANTS_PICKS' : 'WANTS_WIN_NOW_HELP')
  }

  return { ...u, team, verdict, threshold, need, reasons, codes,
    tiers: { in: tIn, out: tOut } }
}

// One line the user actually reads, instead of a number they should not see.
export function verdictText(d, team) {
  const who = CITY[team]?.[1] || team
  switch (d.verdict) {
    case VERDICT.ACCEPT: return `${who} take it.`
    case VERDICT.LIKELY: return `${who} would do this.`
    case VERDICT.NEGOTIABLE: return `${who} are interested but want a little more.`
    case VERDICT.COUNTER: return `${who} want more than this.`
    case VERDICT.UNTOUCHABLE: return `${who} say no.`
    case VERDICT.NONSTARTER: return `${who} hang up.`
    default: return `${who} pass.`
  }
}
