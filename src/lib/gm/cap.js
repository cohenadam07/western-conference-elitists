// Salary cap and trade rules — ported from Basketball-Savant/cap_engine.py, which
// carries the test suite (20/20). Keep the two in step: this file is the browser copy,
// the Python file is the reference.
import { SEED } from './seed.js'

export const CBA = SEED.cba
const BR = SEED.brackets

export const money = (n) =>
  '$' + Math.round(n).toLocaleString('en-US')
export const short = (n) =>
  (n < 0 ? '-$' : '$') + (Math.abs(n) / 1e6).toFixed(1) + 'M'

export function teamSalary(roster) {
  return roster.reduce((s, p) => s + p.s, 0)
}

export function status(total) {
  return {
    total,
    space: Math.max(0, CBA.cap - total),
    underCap: total < CBA.cap,
    overTax: total > CBA.tax,
    overApron1: total > CBA.apron1,
    overApron2: total > CBA.apron2,
  }
}

export function statusLabel(st) {
  if (st.overApron2) return 'second apron'
  if (st.overApron1) return 'first apron'
  if (st.overTax) return 'taxpayer'
  if (st.underCap) return 'under the cap'
  return 'over the cap'
}

export const APRON_CONSEQUENCE = {
  'second apron':
    'Cannot aggregate salaries in a trade, cannot take back more than it sends, cannot send cash, and cannot use the taxpayer mid-level.',
  'first apron':
    'Cannot acquire by sign-and-trade, cannot use the non-taxpayer mid-level, cannot use the bi-annual exception.',
  taxpayer: 'Paying the luxury tax. Taxpayer mid-level only.',
  'over the cap': 'Full mid-level and bi-annual exceptions available.',
  'under the cap': 'Has room. Uses cap space before any exception.',
}

// Most salary a team may receive for what it sends, given its apron status.
export function maxIncoming(outgoing, st) {
  if (st.overApron1) return outgoing // 100%, no buffer — includes second-apron teams
  let allowed
  if (outgoing <= BR.lo) allowed = outgoing * 2 + BR.buffer
  else if (outgoing <= BR.hi) allowed = outgoing + BR.pad
  else allowed = outgoing * 1.25 + BR.buffer
  // A team under the cap uses its room FIRST and only needs matching on the remainder.
  return allowed + (st.underCap ? st.space : 0)
}

// packages: [{ team, roster, out: [player], inc: [player] }]
// -> { ok, rule, detail, notes: [] }
export function validateTrade(packages) {
  const notes = []
  for (const pk of packages) {
    const before = teamSalary(pk.roster)
    const st = status(before)
    const out = pk.out.reduce((s, p) => s + p.s, 0)
    const inc = pk.inc.reduce((s, p) => s + p.s, 0)
    const after = before - out + inc
    const label = statusLabel(st)

    if (st.overApron2 && pk.out.length > 1)
      return reject('Second apron — no aggregation',
        `${pk.team} is above the second apron (${money(before)}) and cannot combine ${pk.out.length} salaries in one trade.`)

    if (st.overApron2 && inc > out)
      return reject('Second apron — no salary increase',
        `${pk.team} sends ${money(out)} and receives ${money(inc)}; a team above the second apron cannot take back more than it sends.`)

    let allowed = null
    if (!(st.underCap && inc - out <= st.space)) {
      allowed = maxIncoming(out, st)
      if (inc > allowed) {
        // The shortfall is reported so "what would make this work" has a number to aim
        // at: this is how much more salary has to go the other way.
        return { ...reject('Salary matching',
          `${pk.team} (${label}) sends ${money(out)} and may receive at most ${money(allowed)}; this trade sends it ${money(inc)}.`),
        shortfall: Math.max(0, inc - allowed) }
      }
    }

    // Roster limit, grandfathered. Basketball-Reference lists dead money and stretched
    // contracts as their own rows, so several teams show more than fifteen "players" in
    // the seed (Memphis 22, Brooklyn 20). Enforcing a hard fifteen against that made any
    // one-for-one trade illegal for those teams and silenced half the league at the
    // deadline. A trade is blocked only if it makes an over-count worse.
    const size = pk.roster.length - pk.out.length + pk.inc.length
    const ceiling = Math.max(CBA.roster_max, pk.roster.length)
    if (size > ceiling)
      return reject('Roster limit',
        `${pk.team} would carry ${size} players; the maximum is ${CBA.roster_max}.`)
    if (size < CBA.roster_min)
      notes.push(`${pk.team} drops to ${size} players — must return to ${CBA.roster_min} within two weeks.`)

    const afterSt = status(after)
    if (afterSt.overApron2 && !st.overApron2)
      notes.push(`${pk.team} crosses the second apron — frozen future first, no cash, no aggregation from here.`)
    else if (afterSt.overApron1 && !st.overApron1)
      notes.push(`${pk.team} crosses the first apron.`)

    notes.push(`${pk.team}: out ${short(out)} / in ${short(inc)}${allowed === null ? ' — absorbed into cap space' : ` — limit ${short(allowed)}`}. Ends at ${money(after)} (${statusLabel(afterSt)}).`)
  }
  return { ok: true, notes }
}

function reject(rule, detail) {
  return { ok: false, rule, detail, notes: [] }
}
