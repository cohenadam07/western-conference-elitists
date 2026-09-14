// THE TRANSACTION LOG.
//
// Every move the career has ever made existed in exactly one place: the ticker, a fourteen-item
// marquee that scrolls past at reading speed and is wiped on reload. So a franchise had no
// record of its own decisions — you could not go back and see what you gave up for a player,
// or when you signed him, or who you drafted four years ago. In a mode whose entire payoff is
// that season fourteen remembers season three, that is the wrong place for the only copy.
//
// This is the durable one. Append-only, small, and indexed by season so the history screen can
// show a year at a time.
export const LEDGER_VERSION = 1

// The kinds, declared here so a screen can filter by them and a colour can be attached to
// each without a string literal turning up in three files.
export const KINDS = {
  trade: 'Trade',
  sign: 'Signing',
  resign: 'Re-signing',
  waive: 'Waiver',
  draft: 'Draft',
  claim: 'Acquisition',
  loss: 'Departure',
  retire: 'Retirement',
  hire: 'Staff',
  fired: 'Front office',
}

export const emptyLedger = () => ({ v: LEDGER_VERSION, entries: [] })

// `day` is the season day the move happened on, which is what lets a year's entries sort in
// the order they actually occurred rather than the order they were written.
export function record(ledger, { season, phase, kind, text, day = 0, detail = null }) {
  const l = ledger && ledger.v === LEDGER_VERSION ? ledger : emptyLedger()
  const entries = l.entries.concat([{
    season, phase: phase || null, kind, text, day, detail,
    seq: l.entries.length,
  }])
  // A career can run for decades and nobody scrolls past a few hundred moves. Keep the most
  // recent thousand, which is roughly fifteen seasons of an active front office.
  return { v: LEDGER_VERSION, entries: entries.slice(-1000) }
}

export const bySeason = (ledger) => {
  const out = new Map()
  for (const e of ledger?.entries || []) {
    if (!out.has(e.season)) out.set(e.season, [])
    out.get(e.season).push(e)
  }
  for (const rows of out.values()) rows.sort((a, b) => a.day - b.day || a.seq - b.seq)
  return out
}

export const countOf = (ledger, kind) =>
  (ledger?.entries || []).filter((e) => e.kind === kind).length
