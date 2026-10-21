// Which "what's new" items the homepage banner shows right now, and how each one reads.
// The list itself is gathered at build time (scripts/lib/whats-new.mjs); this decides, at the
// moment someone opens the page, what still counts as recent.

const DAY = 864e5

// How long each kind stays up, and how many of it the banner carries at once.
export const RULES = {
  article: { days: 30, max: 2 },
  video: { days: 10, max: 2 },
  short: { days: 3, max: 1 },
  update: { days: 21, max: 4 },
}
// A UFC card shows from a week before until the night it happens.
const EVENT_LEAD = 7 * DAY
const EVENT_TAIL = 1.5 * DAY
// "New" for the first three days.
const FRESH = 3 * DAY

export function pickRecent(items, now = Date.now(), max = 8) {
  const out = []
  const count = {}
  const sorted = [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  for (const it of sorted) {
    const t = Date.parse(it.date)
    if (Number.isNaN(t)) continue
    if (it.kind === 'event') {
      if (now > t + EVENT_TAIL || t - now > EVENT_LEAD) continue
      if (count.event) continue
    } else {
      const rule = RULES[it.kind]
      if (!rule) continue
      // Dated ahead (an article set to go out later): not yet.
      if (t > now + 3600e3) continue
      if (now - t > rule.days * DAY) continue
      if ((count[it.kind] || 0) >= rule.max) continue
    }
    count[it.kind] = (count[it.kind] || 0) + 1
    out.push({ ...it, fresh: it.kind !== 'event' && now - t < FRESH })
    if (out.length >= max) break
  }
  return out
}

export function label(it) {
  if (it.kind === 'article') return `Article: ${it.text}`
  if (it.kind === 'video') return `Video: ${it.text}`
  if (it.kind === 'short') return `Short: ${it.text}`
  if (it.kind === 'update') return `${it.product}${it.version ? ` ${it.version}` : ''}: ${it.text}`
  return it.text
}

// The small tag in front of a line: "New" for three days, then the date. A UFC card shows its day.
export function stamp(it) {
  if (it.fresh) return 'New'
  // Plain dates ("2026-10-17") are days, not instants: read them at noon so no time zone moves them.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? new Date(`${it.date}T12:00:00Z`) : new Date(it.date)
  const opts = { month: 'short', day: 'numeric', timeZone: 'America/New_York' }
  if (it.kind === 'event') opts.weekday = 'short'
  return d.toLocaleDateString('en-US', opts)
}
