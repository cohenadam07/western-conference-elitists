// Draft pick ownership, valuation, protections, swaps and the Stepien rule.
//
// Pick value is the EMPIRICAL curve from trade_engine.py, fitted on 328 drafted players
// (2010-2020 first rounds) joined to their first four NBA seasons: pick 1 returns a mean
// of 9.28 four-year VORP with a 73% star rate, picks 21-30 return 1.36 with a 56% bust
// rate. Surplus is that production priced at $14.1M per VORP, less the rookie scale.
//
// A pick's value is not fixed. A future first from a team that collapses is a lottery
// pick; from a contender it is pick 27. So an UNPLAYED pick is valued on the owning
// team's expected finish, which is exactly why picks change hands in the first place.
//
// AND a pick is not always a pick. Most real first-round trades carry a protection, a swap
// right, or both, and pricing those is most of the craft of the job: "top-four protected"
// is a materially different asset from "unprotected", and the difference is the
// probability of the origin team finishing in the top four. That probability is computed
// here from the same strength ranks everything else uses.
import { SEED } from './seed.js'
import { rostersOf, simOf } from './league.js'
import { REAL_LEDGER, SWAP_GROUPS, REAL_PICKS_SOURCE } from './pickData.js'

const P = SEED.picks
export const YEARS_OUT = 5
export { REAL_PICKS_SOURCE }

const TEAMS = () => Object.keys(SEED.teams)

// ------------------------------------------------------------------ the ledger
//
// Two worlds. `real` starts from the actual ledger — Oklahoma City's hoard, Utah's
// protected picks, the Clippers' forfeited firsts — which is the league as it stands and
// is far more interesting to inherit. `clean` gives every team its own picks back, which
// is the fair fight and the easier thing to reason about.

function parseSpec(spec, from, year, round) {
  const base = { from, year, round, owner: from }
  if (!spec || spec === 'own') return base
  if (spec === 'forfeit') return { ...base, owner: null, forfeit: true }
  if (spec.startsWith('to:')) return { ...base, owner: spec.slice(3) }
  if (spec.startsWith('@')) return { ...base, owner: null, group: spec.slice(1) }
  if (spec.startsWith('prot:')) {
    const [range, to] = spec.slice(5).split('>')
    const [lo, hi] = range.split('-').map(Number)
    return to.startsWith('@')
      ? { ...base, prot: { lo, hi }, group: to.slice(1) }
      : { ...base, prot: { lo, hi, to }, owner: from }
  }
  if (spec.startsWith('split:')) {
    const parts = spec.slice(6).split('|').map((s) => {
      const [range, to] = s.split('>')
      const [lo, hi] = range.split('-').map(Number)
      return { lo, hi, to }
    })
    return { ...base, split: parts, owner: parts[0].to }
  }
  return base
}

export function newPickLedger(seasonLabel, opts = {}) {
  const real = opts.real !== false
  const y0 = parseInt(seasonLabel, 10)
  const picks = []
  for (let y = 1; y <= YEARS_OUT; y++) {
    const year = y0 + y
    for (const round of [1, 2]) {
      for (const from of TEAMS()) {
        const spec = real ? REAL_LEDGER[year]?.[round]?.[from] : 'own'
        picks.push(parseSpec(spec || 'own', from, year, round))
      }
    }
  }
  // Groups are carried on the ledger so a traded swap seat travels with the save.
  const groups = {}
  if (real) for (const [k, g] of Object.entries(SWAP_GROUPS)) groups[k] = { ...g, assign: g.assign.slice() }
  return toLedger(picks, groups, null)
}

// Ownership is derived, not stored, because a protection and a swap are both answers to
// "where does it finish?" — and that answer changes every time the standings do.
export function assignOwners(picks, groups, ranks) {
  const slot = (p) => expectedSlot(p.from, p.round, ranks?.[p.from])
  const byGroup = {}
  for (const p of picks) if (p.group && !p.traded) (byGroup[p.group] ||= []).push(p)

  for (const p of picks) {
    if (p.forfeit) { p.owner = null; continue }
    if (p.traded) { p.owner = p.traded; continue }
    const s = slot(p)
    if (p.split) { p.owner = (p.split.find((r) => s >= r.lo && s <= r.hi) || p.split[0]).to; continue }
    if (p.prot && s >= p.prot.lo && s <= p.prot.hi) { p.owner = p.from; continue }
    if (p.prot && p.prot.to) { p.owner = p.prot.to; continue }
    if (!p.group) p.owner = p.from
  }
  for (const [name, list] of Object.entries(byGroup)) {
    const g = groups[name]
    if (!g) { list.forEach((p) => { p.owner = p.from }); continue }
    // Most favourable first — a lower slot is a better pick.
    const ordered = list.slice().sort((a, b) => slot(a) - slot(b))
    ordered.forEach((p, i) => { p.owner = g.assign[i] ?? p.from; p.seat = i })
  }
  return picks
}

// The ledger's own shape is the OLD one — a plain map of team to the picks it holds —
// because a dozen call sites read `ledger[team]` and a rename would have been a dozen
// chances to introduce a bug for no gain. The machinery rides along under `$`-prefixed
// keys, which are obviously not teams. `$picks` is the single source of truth; the team
// arrays are a derived mirror, rebuilt whenever ownership can have moved.
const toLedger = (picks, groups, ranks) => {
  assignOwners(picks, groups, ranks)
  const led = { $picks: picks, $groups: groups }
  for (const t of TEAMS()) led[t] = []
  for (const p of picks) if (p.owner && led[p.owner]) led[p.owner].push(p)
  return led
}

// A ledger is rebuilt whenever the standings move, because that is when a protection or a
// swap changes hands. Old saves hold the flat `{TEAM: [picks]}` shape; they still work.
export function rebuildLedger(ledger, ranks) {
  if (!ledger || !ledger.$picks) return ledger
  return toLedger(ledger.$picks, ledger.$groups || {}, ranks)
}

export const ownedBy = (ledger, team) => ledger?.[team] || []
// A save written before protections existed has no `$picks`; its team arrays are still
// the truth, so flatten those instead of pretending the ledger is empty.
export const allPicks = (ledger) => (ledger?.$picks
  ? ledger.$picks
  : Object.entries(ledger || {}).filter(([k]) => !k.startsWith('$')).flatMap(([, v]) => v))
export const teamsIn = (ledger) => Object.keys(ledger || {}).filter((k) => !k.startsWith('$'))

// Trading a pick sets an explicit destination that survives the next standings change. A
// swap seat traded away is the same act: the seat's destination in the group changes.
export function movePick(ledger, pick, to, ranks) {
  const p = allPicks(ledger).find((x) => pickKey(x) === pickKey(pick))
  if (!p) return ledger
  if (p.group && ledger.$groups?.[p.group] && typeof p.seat === 'number') {
    ledger.$groups[p.group].assign[p.seat] = to
  }
  p.traded = to
  return ledger.$picks ? rebuildLedger(ledger, ranks) : ledger
}

// Every pick both teams hold after a proposed swap, which is what the Stepien check and
// the AI's valuation both need to see.
export function afterTrade(ledger, mine, other, outPicks, inPicks) {
  const outK = new Set(outPicks.map(pickKey))
  const inK = new Set(inPicks.map(pickKey))
  const mineAfter = ownedBy(ledger, mine).filter((p) => !outK.has(pickKey(p))).concat(inPicks)
  const otherAfter = ownedBy(ledger, other).filter((p) => !inK.has(pickKey(p))).concat(outPicks)
  return { [mine]: mineAfter, [other]: otherAfter }
}

export const pickKey = (p) => `${p.from}-${p.year}-${p.round}`

// ------------------------------------------------------------------ valuation

export function expectedSlot(fromTeam, round, strengthRank) {
  const base = strengthRank ?? 15
  return Math.max(1, Math.min(60, Math.round(base + (round - 1) * 30)))
}

// How likely is a pick to land inside a range? The standings are noisy — a team projected
// 8th finishes anywhere from 3rd to 14th in a normal year — so a "top-4 protected" pick
// from a projected 6th-worst team conveys far more often than the projection alone says.
// sd 4.2 slots is the season-to-season movement in the 47-season sample.
const SLOT_SD = 4.2
// Discrete and NORMALISED over the slots that actually exist, not a raw normal tail. A
// team projected second cannot finish better than first, so the third of the distribution
// that a plain normal puts left of slot 1 has to land back inside the draft — and it lands
// exactly where a top-4 protection lives. Ignoring that priced a 2nd-worst team's top-4
// protected pick as 64% likely to convey when the true figure is closer to a third.
export function landsInRange(slot, lo, hi, span = 30) {
  let inside = 0, total = 0
  for (let i = 1; i <= span; i++) {
    const z = (i - slot) / SLOT_SD
    const w = Math.exp(-0.5 * z * z)
    total += w
    if (i >= lo && i <= hi) inside += w
  }
  return total > 0 ? inside / total : 0
}

// The chance a pick actually reaches the team that traded for it this year. An
// unprotected pick is 1; a top-4 protected pick from a bad team can be under a half.
export function conveyanceOdds(pick, ranks) {
  if (pick.forfeit) return 0
  if (!pick.prot) return 1
  const s = expectedSlot(pick.from, pick.round, ranks?.[pick.from])
  const span = pick.round === 1 ? 30 : 60
  return 1 - landsInRange(s, pick.prot.lo, pick.prot.hi, span)
}

const rawSlotValue = (slot) => P.slotValue[Math.max(1, Math.min(60, Math.round(slot)))] ?? 0

// Expected value across the spread of finishes, not the value of the median finish. The
// pick curve is steeply convex at the top — pick 1 is worth far more than twice pick 4 —
// so averaging over the distribution is worth real money on a lottery pick.
//
// ONE integrator for both the protected and unprotected cases, discrete over the slots
// that exist and normalised. Using two different schemes was subtly wrong in a way that
// showed up as a top-4-protected pick being worth MORE than the same pick unprotected —
// not by much, but a valuation that can be inverted is a valuation the AI can be milked
// through.
function spreadValue(slot, span = 30, skip = null) {
  let num = 0, den = 0
  for (let i = 1; i <= span; i++) {
    const z = (i - slot) / SLOT_SD
    const w = Math.exp(-0.5 * z * z)
    den += w
    if (skip && i >= skip.lo && i <= skip.hi) continue
    num += rawSlotValue(i) * w
  }
  // `den` is the WHOLE distribution, so a protected pick's value already carries its own
  // conveyance probability — there is nothing left to multiply by.
  return den > 0 ? num / den : 0
}

// Where a protected pick lands GIVEN that it conveyed: the mean of the finishing
// distribution with the protected range cut out of it.
export function slotIfConveys(pick, slot) {
  if (!pick.prot) return slot
  const span = pick.round === 1 ? 30 : 60
  let num = 0, den = 0
  for (let i = 1; i <= span; i++) {
    if (i >= pick.prot.lo && i <= pick.prot.hi) continue
    const z = (i - slot) / SLOT_SD
    const w = Math.exp(-0.5 * z * z)
    num += i * w
    den += w
  }
  return den > 0 ? num / den : slot
}

export function pickValue(pick, strengthRank, currentYear, ctx = {}) {
  if (pick.forfeit) return 0
  const slot = expectedSlot(pick.from, pick.round, strengthRank)
  const out = Math.max(0, pick.year - currentYear)
  const discount = Math.pow(P.discount, out)

  // A swap seat is not the pick, it is the RIGHT to the better one. Its value is the
  // seat's expected slot given the pool, which assignOwners has already worked out.
  const span = pick.round === 1 ? 30 : 60
  let raw = spreadValue(slot, span)
  if (pick.prot) {
    // The cruelty of a protected pick, priced honestly: you receive it ONLY in the
    // outcomes where it is outside the protected range — which is to say only when it is
    // worse than the pick you were hoping for. Cutting those outcomes out of the same
    // integral is exactly that, and it can never come out above the unprotected value.
    raw = spreadValue(slot, span, pick.prot)
  }
  return Math.round(raw * discount)
}

export function label(pick, strengthRank) {
  const slot = expectedSlot(pick.from, pick.round, strengthRank)
  const ord = pick.round === 1 ? '1st' : '2nd'
  let s = `${pick.year} ${pick.from} ${ord} (proj. #${slot})`
  if (pick.forfeit) return `${pick.year} ${pick.from} ${ord} — forfeited`
  if (pick.prot) s += ` · ${pick.prot.lo}-${pick.prot.hi} prot.`
  if (pick.group) s += ' · swap'
  return s
}

// The one-line explanation the teaching layer shows the first time one of these appears.
export function describePick(pick, ranks, groups) {
  const slot = expectedSlot(pick.from, pick.round, ranks?.[pick.from])
  if (pick.forfeit) return 'Forfeited. Nobody drafts with it.'
  const bits = [`Projected to land around #${slot}.`]
  if (pick.prot) {
    const odds = Math.round(conveyanceOdds(pick, ranks) * 100)
    bits.push(`Protected ${pick.prot.lo}-${pick.prot.hi}: ${pick.from} keeps it if it lands there, `
      + `so it conveys about ${odds}% of the time. If it does not convey it rolls to the next year.`)
  }
  if (pick.group && groups?.[pick.group]) {
    const g = groups[pick.group]
    bits.push(`Swap: ${g.pool.join(', ')} are pooled and sorted best-first, then handed out `
      + `to ${g.assign.join(', ')}. You are holding seat ${(pick.seat ?? 0) + 1}.`)
    if (g.approx) bits.push('The real clause here is a multi-team conditional; this is its likeliest branch.')
  }
  return bits.join(' ')
}

// A protection that does not convey does not vanish — it rolls forward, usually a year at
// a time until it becomes seconds. This is the rule that makes "top-4 protected" a
// multi-year obligation rather than a coin flip.
export function rollProtection(pick, actualSlot) {
  if (!pick.prot || !pick.prot.to) return null
  if (actualSlot < pick.prot.lo || actualSlot > pick.prot.hi) return null
  const nextYear = pick.year + 1
  // Protections narrow as they roll: top-4 becomes top-3 and so on, until unprotected.
  const hi = Math.max(0, pick.prot.hi - 1)
  return hi === 0
    ? { ...pick, year: nextYear, prot: undefined, owner: pick.prot.to, rolled: true }
    : { ...pick, year: nextYear, prot: { ...pick.prot, hi }, rolled: true }
}

// ------------------------------------------------------------------- the rules

// The Stepien rule: a team may not be without a first-round pick in consecutive future
// drafts. This is the rule that stops a user mortgaging a decade in one afternoon, and
// it is the single most important constraint on a rebuild-by-trade.
export function violatesStepien(ownedAfter, team, currentYear) {
  const firsts = new Set(
    ownedAfter.filter((p) => p.round === 1 && p.year > currentYear).map((p) => p.year)
  )
  const years = []
  for (let y = currentYear + 1; y <= currentYear + YEARS_OUT; y++) years.push(y)
  for (let i = 0; i + 1 < years.length; i++)
    if (!firsts.has(years[i]) && !firsts.has(years[i + 1]))
      return { ok: false, years: [years[i], years[i + 1]] }
  return { ok: true }
}

// Team strength ranks, worst first.
//
// Before any games exist this MUST fall back to something real. Returning a constant for
// every team looks harmless and is not: the sort then breaks ties alphabetically, so
// Atlanta's picks all projected #1 and Oklahoma City's all projected #21 — the reigning
// champion holding a mid-lottery pick and the alphabet deciding pick value. Roster
// strength (minutes-weighted VORP) is the honest stand-in.
export function strengthRanks(seasonState) {
  const teams = TEAMS()
  const score = {}
  for (const t of teams) {
    const r = seasonState?.rec?.[t]
    if (r && r.w + r.l > 0) { score[t] = r.w + (r.pf - r.pa) / 1000; continue }
    const roster = simOf(t)
    const capRoster = rostersOf(t)
    const vByName = new Map(capRoster.map((p) => [p.n, p.v ?? 0]))
    score[t] = roster.reduce((s, p) => s + (vByName.get(p.n) ?? 0) * (p.load / 30), 0)
  }
  const order = teams.slice().sort((a, b) => score[a] - score[b])
  const rank = {}
  order.forEach((t, i) => { rank[t] = i + 1 })
  return rank
}
