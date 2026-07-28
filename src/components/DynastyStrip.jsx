import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

/* The Dynasty Exchange trailer for the home page.
 *
 * A dark band in the middle of a warm-paper site — the same jolt the tab itself is, so it
 * reads as a different room rather than another article card. It pulls the live board, so
 * what a visitor sees here is the actual market, not a screenshot of one. If the feed is
 * down it falls back to the static seed and simply doesn't quote changes.
 */

const HEAD = (id) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`

function symbolOf(name = '') {
  const parts = String(name).replace(/[.'’]/g, '').split(/[\s-]+/).filter(Boolean)
  if (!parts.length) return '—'
  const last = parts[parts.length - 1].replace(/(Jr|Sr|II|III|IV)$/i, '') || parts[parts.length - 1]
  return (parts[0][0] + last).toUpperCase().slice(0, 5)
}

export default function DynastyStrip() {
  const [seed, setSeed] = useState(null)
  const [board, setBoard] = useState([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/dynasty/players.json').then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setSeed(j)).catch(() => {})
    fetch('/api/dynasty?action=board&limit=60').then((r) => r.json())
      .then((j) => { if (alive && j && j.configured !== false) { setBoard(j.board || []); setTotal(j.total || 0) } })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const byId = useMemo(() => {
    const m = {}
    ;(seed?.players || []).forEach((p) => { m[String(p.id)] = p })
    return m
  }, [seed])

  const rows = board.length
    ? board
    : (seed?.players || []).slice(0, 12).map((p, i) => ({ id: String(p.id), rating: Math.round(p.rating), rank: i + 1, delta: 0 }))

  // lead with whatever is actually moving; before there's volume, the top of the board
  const feature = useMemo(() => {
    const movers = rows.filter((r) => r.delta).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    return (movers.length >= 4 ? movers : rows).slice(0, 4)
  }, [rows])

  if (!seed) return null

  return (
    <section className="dyn-term dyn-grid border-y border-[var(--dyn-line)]">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="dyn-live inline-block h-1.5 w-1.5 rounded-full bg-[var(--dyn-up)]" />
              <span className="dyn-label text-[var(--dyn-up)]">Now trading</span>
            </div>
            <h2 className="mt-3 text-4xl leading-none tracking-tight text-[var(--dyn-text)] sm:text-5xl">
              DYNASTY <span className="text-[var(--dyn-gold)]">EXCHANGE</span>
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--dyn-dim)]">
              A dynasty board priced by the people who argue about it. Rank four players — that
              single answer is six head-to-head results, and every one of them moves the market.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <div className="dyn-label">Volume</div>
                <div className="dyn-mono mt-0.5 text-xl text-[var(--dyn-text)]">{total.toLocaleString()}</div>
              </div>
              <div>
                <div className="dyn-label">Listed</div>
                <div className="dyn-mono mt-0.5 text-xl text-[var(--dyn-text)]">{seed.count ?? rows.length}</div>
              </div>
              <Link
                to="/dynasty"
                className="dyn-mono border border-[var(--dyn-gold)] px-5 py-3 text-[11px] uppercase tracking-[0.14em] text-[var(--dyn-gold)] transition-colors hover:bg-[var(--dyn-gold)] hover:text-[#0a0d12]"
              >
                Open the exchange →
              </Link>
            </div>
          </div>

          <ul className="divide-y divide-[var(--dyn-line-soft)] border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
            {feature.map((r) => {
              const p = byId[String(r.id)] || {}
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  {p.id && (
                    <img src={HEAD(p.id)} alt="" width="34" height="25" loading="lazy"
                      className="h-[25px] w-[34px] shrink-0 object-contain"
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--dyn-text)]">{p.name || `#${r.id}`}</span>
                    <span className="dyn-mono block text-[10px] tracking-wider text-[var(--dyn-faint)]">
                      {symbolOf(p.name || '')} · {[p.pos, p.team].filter(Boolean).join(' ')}
                    </span>
                  </span>
                  <span className="dyn-mono text-[13px] text-[var(--dyn-text)]">{r.rating}</span>
                  <span className="dyn-mono w-16 text-right text-[11px]">
                    {r.delta
                      ? <span className={r.delta > 0 ? 'dyn-up' : 'dyn-down'}>
                          {r.delta > 0 ? '▲ +' : '▼ '}{r.delta}
                        </span>
                      : <span className="dyn-flat">—</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}
