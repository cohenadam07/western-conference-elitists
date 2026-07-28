import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePageMeta from '../lib/usePageMeta.js'

/* Dynasty Exchange — a crowd-priced trade-value board, dressed as the thing it actually is.
 *
 * Every visitor is handed four players and asked to rank them. That single answer is six
 * head-to-head results, and each one reprices both sides against what the crowd already
 * believed (api/dynasty.js does the Elo). Nobody votes on a number; the number is what the
 * votes imply — which is why it earns the market furniture rather than borrowing it.
 *
 * Seeded from Hashtag Basketball's points-league dynasty ranking so day one isn't a blank
 * board. It starts moving with the first pick.
 */

const API = '/api/dynasty'
const SEED_URL = '/dynasty/players.json'
const UID_KEY = 'wce_dyn_uid'
const HEAD = (id) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`

function uid() {
  try {
    let v = localStorage.getItem(UID_KEY)
    if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(UID_KEY, v) }
    return v
  } catch { return 'anon' }
}

/* Every asset needs a symbol. First initial + surname, stripped and capped — Victor
 * Wembanyama trades as VWEMB, Shai Gilgeous-Alexander as SGILG. */
function symbolOf(name = '') {
  const parts = String(name).replace(/[.'’]/g, '').split(/[\s-]+/).filter(Boolean)
  if (!parts.length) return '—'
  const last = parts[parts.length - 1].replace(/(Jr|Sr|II|III|IV)$/i, '') || parts[parts.length - 1]
  return (parts[0][0] + last).toUpperCase().slice(0, 5)
}

const pctOf = (delta, rating) => (!rating || !delta ? 0 : (delta / (rating - delta)) * 100)

function Chg({ delta, pct }) {
  // An unmoved price is not "0 +0.0%" — that reads as data. It's simply unquoted yet.
  if (!delta) return <span className="dyn-mono dyn-flat">—</span>
  const up = delta > 0
  return (
    <span className={`dyn-mono ${up ? 'dyn-up' : 'dyn-down'}`}>
      {up ? '▲' : '▼'} {up ? '+' : ''}{delta}
      {pct !== undefined && <span className="ml-1 opacity-70">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>}
    </span>
  )
}

function Ticker({ rows, byId }) {
  const movers = useMemo(() => {
    const withMove = rows.filter((r) => r.delta)
    const pool = (withMove.length >= 8 ? withMove : rows).slice(0, 28)
    return pool.map((r) => ({ ...r, name: (byId[String(r.id)] || {}).name || String(r.id) }))
  }, [rows, byId])
  if (!movers.length) return null
  const Run = () => (
    <div className="flex shrink-0 items-center" aria-hidden="true">
      {movers.map((m, i) => (
        <span key={i} className="dyn-mono flex items-center gap-2 whitespace-nowrap px-5 py-2 text-[11px]">
          <span className="text-[var(--dyn-dim)]">{symbolOf(m.name)}</span>
          <span className="text-[var(--dyn-text)]">{m.rating}</span>
          <Chg delta={m.delta} />
        </span>
      ))}
    </div>
  )
  return (
    <div className="overflow-hidden border-y border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
      <div className="dyn-tape"><Run /><Run /></div>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="px-5 py-3">
      <div className="dyn-label">{label}</div>
      <div className={`dyn-mono mt-1 text-lg ${tone || 'text-[var(--dyn-text)]'}`}>{value}</div>
    </div>
  )
}

function TicketCard({ p, slot, onPick, disabled }) {
  const stat = (v, l) =>
    v == null ? null : (
      <span className="whitespace-nowrap">
        <span className="text-[var(--dyn-text)]">{v}</span>
        <span className="ml-0.5 text-[var(--dyn-faint)]">{l}</span>
      </span>
    )
  return (
    <button
      type="button" onClick={onPick} disabled={disabled} data-picked={slot ? '1' : '0'}
      aria-label={`Rank ${p.name}${slot ? `, currently ${slot}` : ''}`}
      className="dyn-card group relative flex flex-col items-center gap-3 p-4 text-center"
    >
      <span className="absolute left-0 top-0 flex w-full items-center justify-between px-2.5 py-2">
        <span className="dyn-mono text-[10px] tracking-widest text-[var(--dyn-faint)]">{symbolOf(p.name)}</span>
        <span
          className={`flex h-6 w-6 items-center justify-center dyn-mono text-[11px] ${
            slot ? 'bg-[var(--dyn-gold)] text-[#0a0d12]' : 'border border-[var(--dyn-line)] text-[var(--dyn-faint)]'
          }`}
        >
          {slot || '·'}
        </span>
      </span>

      {p.id ? (
        <img src={HEAD(p.id)} alt="" width="104" height="76" loading="lazy"
          className="mt-5 h-[76px] w-[104px] object-contain"
          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
      ) : (
        <div className="dyn-mono mt-5 flex h-[76px] w-[104px] items-center justify-center text-2xl text-[var(--dyn-faint)]">
          {symbolOf(p.name)}
        </div>
      )}

      <div>
        <div className="text-[15px] leading-tight text-[var(--dyn-text)]">{p.name}</div>
        <div className="dyn-mono mt-1 text-[10px] tracking-wider text-[var(--dyn-dim)]">
          {[p.pos, p.team, p.age ? `${p.age}Y` : null].filter(Boolean).join(' · ')}
        </div>
      </div>

      <div className="dyn-mono flex flex-wrap justify-center gap-x-3 text-[11px] text-[var(--dyn-dim)]">
        {stat(p.ppg, 'PTS')}{stat(p.rpg, 'REB')}{stat(p.apg, 'AST')}
      </div>
    </button>
  )
}

export default function Dynasty() {
  usePageMeta(
    'Dynasty Exchange',
    'Crowd-priced NBA dynasty rankings — rank four players at a time and move the market.',
  )

  const [seed, setSeed] = useState(null)
  const [board, setBoard] = useState([])
  const [total, setTotal] = useState(0)
  const [recent, setRecent] = useState([])
  const [live, setLive] = useState(true)
  const [group, setGroup] = useState(null)
  const [order, setOrder] = useState([])
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [flash, setFlash] = useState({})
  // Opening the tab drops you in the lobby: what this is, where the market stands,
  // and a deliberate step onto the floor. Being handed four strangers to rank with no
  // framing is a bad first ten seconds.
  const [entered, setEntered] = useState(false)
  const me = useRef(uid())
  const lastPrices = useRef({})

  const byId = useMemo(() => {
    const m = {}
    ;(seed?.players || []).forEach((p) => { m[String(p.id)] = p })
    return m
  }, [seed])

  useEffect(() => {
    fetch(SEED_URL).then((r) => (r.ok ? r.json() : null)).then(setSeed).catch(() => setSeed(null))
  }, [])

  const loadBoard = useCallback(() => {
    fetch(`${API}?action=board&limit=200`)
      .then((r) => r.json())
      .then((j) => {
        if (!j || j.configured === false) { setLive(false); return }
        setLive(true)
        // flash any row whose price moved since the last read — the one piece of motion a market needs
        const f = {}
        ;(j.board || []).forEach((r) => {
          const was = lastPrices.current[r.id]
          if (was !== undefined && was !== r.rating) f[r.id] = r.rating > was ? 'up' : 'down'
          lastPrices.current[r.id] = r.rating
        })
        if (Object.keys(f).length) { setFlash(f); setTimeout(() => setFlash({}), 1000) }
        setBoard(j.board || []); setTotal(j.total || 0); setRecent(j.recent || [])
      })
      .catch(() => setLive(false))
  }, [])

  const nextGroup = useCallback(() => {
    setResult(null); setOrder([]); setErr(null)
    fetch(`${API}?action=next&uid=${encodeURIComponent(me.current)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j || j.configured === false || !j.seeded) { setLive(false); return }
        setGroup({ nonce: j.nonce, ids: j.group.map(String), daily: !!j.daily })
      })
      .catch(() => setErr('Could not load the next matchup.'))
  }, [])

  useEffect(() => { loadBoard(); nextGroup() }, [loadBoard, nextGroup])

  const pick = (id) => {
    if (busy || result) return
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : o.length < 4 ? [...o, id] : o))
  }

  const submit = async () => {
    if (order.length !== 4 || !group || busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: group.nonce, order, uid: me.current }),
      })
      const j = await r.json()
      if (!r.ok) {
        setErr(j.error === 'daily already played'
          ? 'Today’s session is already filled for this account.'
          : 'Order rejected — try the next book.')
        setBusy(false); return
      }
      setResult(j); setTotal(j.total || 0); loadBoard()
    } catch { setErr('Order rejected — try the next book.') }
    setBusy(false)
  }

  const rows = live && board.length
    ? board
    : (seed?.players || []).slice(0, 200).map((p, i) => ({
        id: String(p.id), rating: Math.round(p.rating), rank: i + 1, delta: 0, rankDelta: 0, streak: 0, seen: 0,
      }))

  const session = useMemo(() => {
    const cut = Date.now() - 864e5
    return recent.filter((r) => (r.ts || 0) > cut).length
  }, [recent])
  const topGainer = useMemo(() => rows.slice().sort((a, b) => b.delta - a.delta)[0], [rows])
  const topLoser = useMemo(() => rows.slice().sort((a, b) => a.delta - b.delta)[0], [rows])
  const nameOf = (id) => (byId[String(id)] || {}).name || `#${id}`

  if (!entered) {
    const top = rows.slice(0, 5)
    return (
      <div className="dyn-term">
        <div className="dyn-grid border-b border-[var(--dyn-line)]">
          <div className="mx-auto max-w-5xl px-5 py-16 text-center sm:py-24">
            <div className="flex items-center justify-center gap-2">
              <span className="dyn-live inline-block h-1.5 w-1.5 rounded-full bg-[var(--dyn-up)]" />
              <span className="dyn-label text-[var(--dyn-up)]">Market open</span>
            </div>
            <h1 className="mt-4 text-5xl leading-none tracking-tight text-[var(--dyn-text)] sm:text-7xl">
              DYNASTY <span className="text-[var(--dyn-gold)]">EXCHANGE</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-[var(--dyn-dim)]">
              A dynasty board priced by the people who argue about it. There is no panel of experts
              here — every number on the board is what the crowd’s picks imply.
            </p>

            <div className="mx-auto mt-10 grid max-w-3xl gap-px bg-[var(--dyn-line)] sm:grid-cols-3">
              {[
                ['01', 'Rank four', 'You get four players with their season line and age. Put them in order of dynasty value.'],
                ['02', 'Six verdicts', 'That one answer is six head-to-head results. Each reprices both sides against the market.'],
                ['03', 'The board moves', 'Beat someone far above you and you jump. Keep landing first and you move in bigger steps.'],
              ].map(([n, h, b]) => (
                <div key={n} className="bg-[var(--dyn-panel)] p-6 text-left">
                  <div className="dyn-mono text-[11px] text-[var(--dyn-gold)]">{n}</div>
                  <div className="mt-2 text-[15px] text-[var(--dyn-text)]">{h}</div>
                  <p className="mt-2 text-[13px] leading-relaxed text-[var(--dyn-dim)]">{b}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <button type="button" onClick={() => setEntered(true)} className="dyn-btn px-8 py-4 text-[12px]">
                {group?.daily ? 'Take today’s session' : 'Start ranking'}
              </button>
              <button type="button" onClick={() => setEntered(true)} className="dyn-btn-ghost px-6 py-4">
                Just show me the board
              </button>
            </div>
            {group?.daily && (
              <p className="dyn-mono mt-4 text-[10px] tracking-widest text-[var(--dyn-faint)]">
                DAILY SESSION · SAME FOUR FOR EVERYONE · ONCE PER DAY
              </p>
            )}
          </div>
        </div>

        <Ticker rows={rows} byId={byId} />

        <div className="border-b border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
          <div className="mx-auto flex max-w-5xl flex-wrap divide-x divide-[var(--dyn-line)]">
            <Stat label="Volume · all time" value={total.toLocaleString()} />
            <Stat label="Listed" value={rows.length} />
            <Stat label="Top gainer"
              value={topGainer?.delta ? `${symbolOf(nameOf(topGainer.id))} +${topGainer.delta}` : '—'}
              tone={topGainer?.delta ? 'dyn-up' : ''} />
            <Stat label="Top loser"
              value={topLoser?.delta < 0 ? `${symbolOf(nameOf(topLoser.id))} ${topLoser.delta}` : '—'}
              tone={topLoser?.delta < 0 ? 'dyn-down' : ''} />
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-5 py-12">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="dyn-label text-[var(--dyn-gold)]">Top of the board</span>
            <button type="button" onClick={() => setEntered(true)}
              className="dyn-mono text-[10px] tracking-widest text-[var(--dyn-faint)] hover:text-[var(--dyn-text)]">
              FULL BOARD →
            </button>
          </div>
          <ol className="divide-y divide-[var(--dyn-line-soft)] border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
            {top.map((r) => {
              const p = byId[String(r.id)] || {}
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="dyn-mono w-6 text-[11px] text-[var(--dyn-faint)]">{r.rank}</span>
                  {p.id && (
                    <img src={HEAD(p.id)} alt="" width="34" height="25" loading="lazy"
                      className="h-[25px] w-[34px] shrink-0 object-contain"
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--dyn-text)]">{p.name || `#${r.id}`}</span>
                    <span className="dyn-mono block text-[10px] tracking-wider text-[var(--dyn-faint)]">
                      {symbolOf(p.name || '')} · {[p.pos, p.team, p.age ? `${p.age}Y` : null].filter(Boolean).join(' ')}
                    </span>
                  </span>
                  <span className="dyn-mono text-[13px] text-[var(--dyn-text)]">{r.rating}</span>
                  <span className="w-20 text-right text-[11px]"><Chg delta={r.delta} /></span>
                </li>
              )
            })}
          </ol>
          <p className="mt-4 text-[12px] leading-relaxed text-[var(--dyn-faint)]">
            Opening prices come from Hashtag Basketball’s points-league dynasty ranking. That is a
            starting line, not a verdict — it moves from the first pick onward.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="dyn-term">
      {/* ---------------- masthead ---------------- */}
      <div className="dyn-grid border-b border-[var(--dyn-line)]">
        <div className="mx-auto max-w-7xl px-5 py-10 sm:py-14">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="dyn-live inline-block h-1.5 w-1.5 rounded-full bg-[var(--dyn-up)]" />
                <span className="dyn-label text-[var(--dyn-up)]">Market open</span>
              </div>
              <h1 className="mt-3 text-4xl leading-none tracking-tight text-[var(--dyn-text)] sm:text-6xl">
                DYNASTY <span className="text-[var(--dyn-gold)]">EXCHANGE</span>
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--dyn-dim)]">
                Prices are set by the crowd, not by us. Rank four players — that single answer is
                six head-to-head results, and each one reprices both sides against what the market
                already believed.
              </p>
            </div>
            <div className="dyn-mono text-right text-[11px] text-[var(--dyn-faint)]">
              <button type="button" onClick={() => setEntered(false)}
                className="dyn-mono mb-2 block w-full text-right text-[10px] tracking-widest text-[var(--dyn-faint)] hover:text-[var(--dyn-text)]">
                ← LOBBY
              </button>
              <div>SEED · HASHTAG BASKETBALL</div>
              <div>POINTS-LEAGUE DYNASTY</div>
              <div className="mt-1 text-[var(--dyn-dim)]">{rows.length} LISTED</div>
            </div>
          </div>
        </div>
      </div>

      <Ticker rows={rows} byId={byId} />

      {/* ---------------- market stats ---------------- */}
      <div className="border-b border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
        <div className="mx-auto flex max-w-7xl flex-wrap divide-x divide-[var(--dyn-line)]">
          <Stat label="Volume · all time" value={total.toLocaleString()} />
          <Stat label="Session" value={session.toLocaleString()} />
          <Stat label="Listed" value={rows.length} />
          <Stat label="Top gainer"
            value={topGainer?.delta ? `${symbolOf(nameOf(topGainer.id))} +${topGainer.delta}` : '—'}
            tone={topGainer?.delta ? 'dyn-up' : ''} />
          <Stat label="Top loser"
            value={topLoser?.delta < 0 ? `${symbolOf(nameOf(topLoser.id))} ${topLoser.delta}` : '—'}
            tone={topLoser?.delta < 0 ? 'dyn-down' : ''} />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 py-10">
        {!live && (
          <p className="dyn-panel dyn-mono mb-8 px-4 py-3 text-[11px] text-[var(--dyn-dim)]">
            PRICING FEED OFFLINE — SHOWING THE OPENING BOOK ONLY.
          </p>
        )}

        {/* ---------------- order ticket ---------------- */}
        <section className="dyn-panel">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--dyn-line)] px-5 py-3">
            <div className="flex items-center gap-3">
              <span className="dyn-label text-[var(--dyn-gold)]">
                {group?.daily ? 'Daily session' : 'Open book'}
              </span>
              <span className="dyn-mono text-[11px] text-[var(--dyn-faint)]">
                {group?.daily
                  ? 'SAME FOUR FOR EVERYONE · ONCE PER DAY'
                  : 'RANK BY DYNASTY VALUE · BEST FIRST'}
              </span>
            </div>
            {order.length > 0 && !result && (
              <button type="button" onClick={() => setOrder([])}
                className="dyn-mono text-[10px] tracking-widest text-[var(--dyn-faint)] hover:text-[var(--dyn-text)]">
                CLEAR
              </button>
            )}
          </header>

          <div className="p-5">
            {!group && !result && (
              <p className="dyn-mono py-6 text-center text-[11px] text-[var(--dyn-faint)]">
                {live ? 'LOADING THE BOOK…' : 'THE BOOK IS CLOSED WHILE THE PRICING FEED IS OFFLINE.'}
              </p>
            )}
            {group && !result && (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {group.ids.map((id) => (
                    <TicketCard key={id} p={byId[id] || { id, name: `#${id}` }}
                      slot={order.indexOf(id) + 1} disabled={busy} onPick={() => pick(id)} />
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={submit} disabled={order.length !== 4 || busy} className="dyn-btn">
                    {busy ? 'Executing…' : order.length === 4 ? 'Execute ranking' : `Select ${4 - order.length} more`}
                  </button>
                  {err && <span className="dyn-mono dyn-down text-[11px]">{err}</span>}
                </div>
              </>
            )}

            {result && (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {(result.averages || result.moved).map((m, i) => {
                    const mv = (result.moved || []).find((x) => String(x.id) === String(m.id))
                    return (
                      <div key={m.id} className="dyn-card p-4 text-center">
                        <div className="dyn-label">{result.averages ? `Crowd #${i + 1}` : 'Filled'}</div>
                        <div className="dyn-mono mt-1 text-[10px] tracking-widest text-[var(--dyn-faint)]">
                          {symbolOf(nameOf(m.id))}
                        </div>
                        <div className="mt-1 text-sm text-[var(--dyn-text)]">{nameOf(m.id)}</div>
                        {result.averages && (
                          <div className="dyn-mono mt-1 text-[11px] text-[var(--dyn-dim)]">
                            AVG {m.avg?.toFixed(2)} · {m.n} {m.n === 1 ? 'VOTE' : 'VOTES'}
                          </div>
                        )}
                        <div className="mt-2"><Chg delta={mv?.delta ?? 0} /></div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={nextGroup} className="dyn-btn-ghost">Next book →</button>
                  <span className="dyn-mono text-[11px] text-[var(--dyn-faint)]">
                    {result.daily ? 'DAILY SESSION FILLED · CONTINUE ON THE OPEN BOOK' : 'PRICES UPDATED'}
                  </span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ---------------- board + blotter ---------------- */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <section className="dyn-panel">
            <header className="flex items-center justify-between border-b border-[var(--dyn-line)] px-5 py-3">
              <span className="dyn-label text-[var(--dyn-gold)]">The board</span>
              <span className="dyn-mono text-[10px] text-[var(--dyn-faint)]">PRICE · 24H CHANGE · VOLUME</span>
            </header>

            <div className="grid grid-cols-[2.2rem_1fr_4.5rem_5.5rem] items-center gap-3 border-b border-[var(--dyn-line)] px-4 py-2 sm:grid-cols-[2.2rem_1fr_4.5rem_6.5rem_3.5rem]">
              <span className="dyn-label">#</span>
              <span className="dyn-label">Asset</span>
              <span className="dyn-label text-right">Last</span>
              <span className="dyn-label text-right">24h</span>
              <span className="dyn-label hidden text-right sm:block">Vol</span>
            </div>

            <ol className="max-h-[38rem] overflow-y-auto">
              {rows.slice(0, 120).map((r) => {
                const p = byId[String(r.id)] || {}
                const f = flash[r.id]
                return (
                  <li key={r.id}
                    className={`dyn-row grid grid-cols-[2.2rem_1fr_4.5rem_5.5rem] items-center gap-3 px-4 py-2.5 sm:grid-cols-[2.2rem_1fr_4.5rem_6.5rem_3.5rem] ${
                      f === 'up' ? 'dyn-fu' : f === 'down' ? 'dyn-fd' : ''}`}>
                    <span className="dyn-mono text-[11px] text-[var(--dyn-faint)]">{r.rank}</span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      {p.id && (
                        <img src={HEAD(p.id)} alt="" width="30" height="22" loading="lazy"
                          className="hidden h-[22px] w-[30px] shrink-0 object-contain sm:block"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-[var(--dyn-text)]">
                          {p.name || `#${r.id}`}
                          {Math.abs(r.streak) >= 2 && (
                            <span
                              title={r.streak > 0
                                ? `First in ${r.streak} straight books — repricing in bigger steps`
                                : `Last in ${Math.abs(r.streak)} straight books — repricing in bigger steps`}
                              className={`dyn-mono ml-2 px-1 py-0.5 text-[9px] tracking-wider ${
                                r.streak > 0 ? 'dyn-up bg-[rgba(22,199,132,.14)]' : 'dyn-down bg-[rgba(234,57,67,.14)]'}`}>
                              {r.streak > 0 ? 'BID' : 'ASK'} ×{Math.min(9, Math.abs(r.streak))}
                            </span>
                          )}
                        </span>
                        <span className="dyn-mono block text-[10px] tracking-wider text-[var(--dyn-faint)]">
                          {symbolOf(p.name || '')} · {[p.pos, p.team, p.age ? `${p.age}Y` : null].filter(Boolean).join(' ')}
                        </span>
                      </span>
                    </span>
                    <span className="dyn-mono text-right text-[13px] text-[var(--dyn-text)]">{r.rating}</span>
                    <span className="text-right text-[11px]"><Chg delta={r.delta} pct={pctOf(r.delta, r.rating)} /></span>
                    <span className="dyn-mono hidden text-right text-[11px] text-[var(--dyn-faint)] sm:block">{r.seen || 0}</span>
                  </li>
                )
              })}
            </ol>

            <footer className="border-t border-[var(--dyn-line)] px-5 py-3 text-[11px] leading-relaxed text-[var(--dyn-faint)]">
              Last is the crowd’s Elo. 24h compares against a snapshot taken once a day, so a fresh
              board reads flat until the market has a day behind it. Vol is how many books an asset
              has appeared in — a thin price is a provisional one.
            </footer>
          </section>

          <aside className="dyn-panel self-start">
            <header className="flex items-center justify-between border-b border-[var(--dyn-line)] px-4 py-3">
              <span className="dyn-label text-[var(--dyn-gold)]">Blotter</span>
              <span className="dyn-mono text-[10px] text-[var(--dyn-faint)]">LAST 5</span>
            </header>
            <ul className="divide-y divide-[var(--dyn-line-soft)]">
              {recent.slice(0, 5).map((r, i) => (
                <li key={i} className="px-4 py-3">
                  <div className="dyn-mono mb-1.5 flex justify-between text-[9.5px] tracking-widest text-[var(--dyn-faint)]">
                    <span>{r.daily ? 'DAILY' : 'OPEN'}</span><span>{timeAgo(r.ts)}</span>
                  </div>
                  <ol>
                    {(r.order || []).map((id, j) => (
                      <li key={id} className="flex items-baseline gap-2 truncate text-[11px]">
                        <span className="dyn-mono text-[var(--dyn-faint)]">{j + 1}</span>
                        <span className="dyn-mono text-[var(--dyn-dim)]">{symbolOf(nameOf(id))}</span>
                        <span className="truncate text-[var(--dyn-text)]">{nameOf(id)}</span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
              {!recent.length && (
                <li className="dyn-mono px-4 py-4 text-[11px] text-[var(--dyn-faint)]">
                  NO TRADES YET — YOURS PRINTS FIRST.
                </li>
              )}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  )
}

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - (ts || 0)) / 1000))
  if (s < 60) return `${s}S AGO`
  if (s < 3600) return `${Math.round(s / 60)}M AGO`
  if (s < 86400) return `${Math.round(s / 3600)}H AGO`
  return `${Math.round(s / 86400)}D AGO`
}
