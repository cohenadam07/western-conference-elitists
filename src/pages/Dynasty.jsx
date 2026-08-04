import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePageMeta from '../lib/usePageMeta.js'
import { buildScale, displayValue } from '../lib/dynastyValue.js'

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
  // Suffixes are dropped as whole tokens before picking the surname. Trimming them off the
  // last token instead leaves nothing behind, which is how Trey Murphy III once traded as TIII.
  const parts = String(name).replace(/[.'’]/g, '').split(/[\s-]+/).filter(Boolean)
    .filter((t, i, a) => i === 0 || !/^(jr|sr|ii|iii|iv|v)$/i.test(t) || a.length === 1)
  if (!parts.length) return '—'
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0]
  return (parts[0][0] + last).toUpperCase().slice(0, 5)
}

/* How to connect each league. Sleeper and Fantrax expose public read APIs, and ESPN does for
 * public leagues — so those three take a code. Yahoo is OAuth-only: there is no code a reader
 * could paste that would work, so it says so and points at the manual box instead of failing
 * at them after they have typed something. */
const PLATFORMS = [
  { id: 'sleeper', name: 'Sleeper', label: 'Sleeper username or league ID',
    placeholder: 'e.g. yourusername',
    how: 'Enter your Sleeper username and pick the league — that is all it needs. Or open the league in a browser and copy the long number out of the URL (sleeper.com/leagues/1234567890123456789).' },
  { id: 'fantrax', name: 'Fantrax', label: 'Fantrax league ID',
    placeholder: 'e.g. abcd1234efgh5678',
    how: 'Open your league on Fantrax and copy the ID from the URL after /league/ — it is the string before the next slash. Works for any league with the standard public league info enabled.' },
  { id: 'espn', name: 'ESPN', label: 'ESPN league ID',
    placeholder: 'e.g. 123456',
    how: 'From your league URL, copy the number after leagueId=. ESPN only lets outsiders read leagues set to Public — if yours is private, use Enter manually.' },
  { id: 'yahoo', name: 'Yahoo', manual: true,
    how: 'Yahoo requires a signed-in connection, so there is no league code that works from here. Open your team on Yahoo, select the roster and copy it, then paste it into the manual box.' },
  { id: 'other', name: 'Other', manual: true,
    how: 'Any other platform works the same way: select your roster on your team page, copy it, and paste it in. Names are matched loosely, so extra numbering or positions will not break it.' },
]

/* Which players a lineup slot will accept. G/F are the combo slots and UTIL takes anyone,
 * which is what makes "best possible lineup" a real question rather than a sort. */
const SLOT_OK = {
  PG: (p) => p.includes('PG'), SG: (p) => p.includes('SG'),
  SF: (p) => p.includes('SF'), PF: (p) => p.includes('PF'),
  C: (p) => p.includes('C'),
  G: (p) => p.includes('PG') || p.includes('SG') || p.includes('G'),
  F: (p) => p.includes('SF') || p.includes('PF') || p.includes('F'),
  UTIL: () => true,
}
// Leagues that don't tell us their slots get the common 10-man shape.
const DEFAULT_SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL', 'UTIL']

/* Best possible starting lineup, exactly — not a greedy fill.
 *
 * Each player is worth the same wherever he slots, so the value of a lineup depends only on
 * WHICH players start. Sets of players that can simultaneously fill distinct slots form a
 * transversal matroid, and on a matroid, taking the most valuable player that can still be
 * added is provably optimal. "Can still be added" is the bit greedy alone gets wrong — a
 * centre already sitting in UTIL may need to shuffle to C to make room — so each candidate
 * gets an augmenting-path search (Kuhn's) rather than a single look at the free slots.
 */
function bestLineup(players, slots) {
  const slotOf = slots.map((s) => SLOT_OK[s] || SLOT_OK.UTIL)
  const filled = new Array(slots.length).fill(-1)      // slot -> player index
  const ranked = players.map((p, i) => i).sort((a, b) => players[b].value - players[a].value)

  const tryPlace = (pi, seen) => {
    for (let s = 0; s < slots.length; s++) {
      if (seen[s] || !slotOf[s](players[pi].pos)) continue
      seen[s] = true
      if (filled[s] === -1 || tryPlace(filled[s], seen)) { filled[s] = pi; return true }
    }
    return false
  }

  const starters = []
  for (const pi of ranked) {
    if (starters.length >= slots.length) break
    if (tryPlace(pi, new Array(slots.length).fill(false))) starters.push(pi)
  }
  const lineup = slots.map((name, s) => ({ slot: name, player: filled[s] === -1 ? null : players[filled[s]] }))
  return { lineup, total: lineup.reduce((a, l) => a + (l.player ? l.player.value : 0), 0) }
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

function Ticker({ rows, byId, val, valDelta }) {
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
          <span className="text-[var(--dyn-text)]">{val ? val(m.rating).toLocaleString() : m.rating}</span>
          <Chg delta={valDelta ? valDelta(m) : m.delta} />
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

/* Defined at module scope on purpose. A component declared inside Dynasty() is a NEW
 * component type on every render, so React unmounts and remounts the whole subtree —
 * which is why typing in the league-code field lost focus after each keystroke. */
function Shell({ title, kicker, total, onHome, children }) {
  return (
    <div className="dyn-term">
      <div className="border-b border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <button type="button" onClick={onHome}
            className="dyn-mono text-[10px] tracking-widest text-[var(--dyn-faint)] hover:text-[var(--dyn-text)]">
            ← DYNASTY
          </button>
          <div className="flex items-center gap-3">
            <span className="dyn-label text-[var(--dyn-gold)]">{kicker}</span>
            <span className="dyn-mono text-[11px] text-[var(--dyn-text)]">{title}</span>
          </div>
          <span className="dyn-mono text-[10px] text-[var(--dyn-faint)]">
            VOL {Number(total || 0).toLocaleString()}
          </span>
        </div>
      </div>
      {children}
    </div>
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
  // 'hub' is the front door; the rest are the rooms behind it.
  const [view, setView] = useState('hub')       // hub | rank | board | trending | team | lobby
  // ---- lobby (a room of people ranking the same four) ----
  // `code`/`setCode` below belong to the fantasy-league connect, hence lob* here.
  const [lobCode, setLobCode] = useState('')    // what the user typed on the join form
  const [lob, setLob] = useState(null)          // server state for the room we're actually in
  const [lobName, setLobName] = useState('')
  const [lobOrder, setLobOrder] = useState([])
  const [lobBusy, setLobBusy] = useState(false)
  const [lobErr, setLobErr] = useState(null)
  const [roster, setRoster] = useState('')      // paste-your-team box
  const [valued, setValued] = useState(null)
  const [teamMode, setTeamMode] = useState('connect')   // connect | paste
  const [platform, setPlatform] = useState('sleeper')
  const [code, setCode] = useState('')
  const [lg, setLg] = useState(null)          // {leagues}|{teams} awaiting a choice
  const [lgBusy, setLgBusy] = useState(false)
  const [lgErr, setLgErr] = useState(null)
  const [rankMode, setRankMode] = useState('full')     // full | start
  const [myTeam, setMyTeam] = useState(null)
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
    fetch(`${API}?action=board&limit=600`)
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

  // ---- lobby plumbing ------------------------------------------------------
  const lobCall = useCallback(async (action, body) => {
    const isGet = action === 'lobby-state'
    const qs = new URLSearchParams({ action, uid: me.current, ...(isGet ? { code: body.code } : {}) })
    const r = await fetch(`${API}?${qs}`, isGet ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, uid: me.current }),
    })
    // Everything below is a failure this endpoint can report while still looking like a
    // success, and each one of them used to end as a click that did nothing:
    //   non-JSON  — an auth wall (protected preview) answering the API with its login page
    //   200 + configured:false — how the handler reports its own caught exceptions
    //   200 + seeded:false     — Redis reachable but the board has no players in it
    //   200 + no code          — anything else shaped wrong
    // Treat the response as a room or throw; never hand back something half-formed.
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('json')) throw new Error('got a web page instead of data — is this deployment behind a login?')
    const j = await r.json().catch(() => null)
    if (!j) throw new Error('unreadable response')
    if (!r.ok || j.configured === false || j.error) throw new Error(j.error || 'the lobby service is unavailable')
    if (j.seeded === false) throw new Error('the dynasty board has no players on this deployment')
    if (!j.code) throw new Error('the server did not return a room')
    return j
  }, [])

  // Poll while the room is open. Vercel supports WebSockets now, but a room is a handful of
  // people making one decision — a 2s poll costs a few Redis reads and needs no connection
  // to keep alive, reconnect, or reason about on a flaky phone.
  useEffect(() => {
    if (view !== 'lobby' || !lob?.code || lob.status !== 'open') return undefined
    const t = setInterval(() => {
      lobCall('lobby-state', { code: lob.code })
        .then((j) => setLob((p) => (p && p.code === j.code ? { ...p, ...j } : p)))
        .catch(() => { /* transient — the next tick retries */ })
    }, 2000)
    return () => clearInterval(t)
  }, [view, lob?.code, lob?.status, lobCall])

  const lobCreate = async () => {
    setLobBusy(true); setLobErr(null)
    try { setLob(await lobCall('lobby-create', { name: lobName })); setLobOrder([]) }
    catch (e) {
      // Show what the server actually said. "Could not open a room" on its own sends you
      // hunting through the client for a fault that is usually the backend or its config.
      setLobErr(e.message === 'slow down' ? 'Too many rooms too fast — wait a moment.'
        : `Could not open a room — ${e.message}`)
    }
    setLobBusy(false)
  }
  const lobJoin = async () => {
    const c = lobCode.trim().toUpperCase()
    if (c.length !== 4) { setLobErr('Codes are four characters.'); return }
    setLobBusy(true); setLobErr(null)
    try { setLob(await lobCall('lobby-join', { code: c, name: lobName })); setLobOrder([]) }
    catch (e) {
      setLobErr(e.message === 'no such lobby' ? 'No room with that code — it may have expired.'
        : e.message === 'lobby full' ? 'That room is full.' : 'Could not join.')
    }
    setLobBusy(false)
  }
  const lobSubmit = async () => {
    if (lobOrder.length !== 4 || lobBusy) return
    setLobBusy(true); setLobErr(null)
    try {
      const j = await lobCall('lobby-submit', { code: lob.code, order: lobOrder })
      setLob((p) => ({ ...p, ...j }))
    } catch { setLobErr('Ranking rejected.') }
    setLobBusy(false)
  }
  const lobClose = async () => {
    setLobBusy(true)
    try {
      const j = await lobCall('lobby-close', { code: lob.code })
      setLob((p) => ({ ...p, ...j }))
    } catch { setLobErr('Could not close the room.') }
    setLobBusy(false)
  }
  const lobPick = (id) => {
    if (lobBusy || lob?.status === 'settled' || lob?.submitted?.includes(me.current)) return
    setLobOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : o.length < 4 ? [...o, id] : o))
  }

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
    : (seed?.players || []).map((p, i) => ({
        id: String(p.id), rating: Math.round(p.rating), rank: i + 1, delta: 0, rankDelta: 0, streak: 0, seen: 0,
      }))

  // One curve for the whole page: Elo decides the order, this decides what the order is worth.
  const scale = useMemo(() => buildScale(rows.map((r) => r.rating)), [rows])
  const val = useCallback((rating) => displayValue(scale, rating), [scale])
  // A 24h move is quoted in value, not Elo — the same rating gain is worth far more near the
  // top of the curve than in the tail, and the tail is where Elo drifts most.
  const valDelta = useCallback((r) => (!r.delta ? 0 : val(r.rating) - val(r.rating - r.delta)), [val])

  const session = useMemo(() => {
    const cut = Date.now() - 864e5
    return recent.filter((r) => (r.ts || 0) > cut).length
  }, [recent])
  const topGainer = useMemo(() => rows.slice().sort((a, b) => b.delta - a.delta)[0], [rows])
  const topLoser = useMemo(() => rows.slice().sort((a, b) => a.delta - b.delta)[0], [rows])
  const nameOf = (id) => (byId[String(id)] || {}).name || `#${id}`

  // ---- paste-your-roster valuation -----------------------------------------
  // Every fantasy platform lets you copy a roster as text, so text is the input. Names are
  // matched loosely (case, punctuation and accents ignored, surname as a fallback) and any
  // line we cannot place is reported rather than quietly dropped — a total that silently
  // skipped your best player would be worse than no total.
  // One matcher, used for a pasted roster and for every team in a connected league.
  const priceList = (entries) => {
    const key = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/ (jr|sr|ii|iii|iv|v)$/, '')
    const idx = {}, bySurname = {}
    ;(seed?.players || []).forEach((pl) => {
      const k = key(pl.name)
      idx[k] = pl
      const sn = k.split(' ').slice(-1)[0]
      ;(bySurname[sn] = bySurname[sn] || []).push(pl)
    })
    const priced = {}
    rows.forEach((r) => { priced[String(r.id)] = r })

    const hits = [], misses = [], seenIds = new Set()
    entries.forEach((entry) => {
      const raw = typeof entry === 'string' ? entry : entry.name
      const platformPos = typeof entry === 'string' ? [] : (entry.pos || [])
      const k = key(String(raw).replace(/^\s*\d+[.)]?\s*/, ''))
      if (!k) return
      let pl = idx[k]
      if (!pl) {
        const cands = bySurname[k.split(' ').slice(-1)[0]] || []
        if (cands.length === 1) pl = cands[0]
      }
      if (!pl) { misses.push(raw); return }
      if (seenIds.has(String(pl.id))) return                    // duplicate line, already counted
      seenIds.add(String(pl.id))
      // A player deeper than the loaded board still has a seed price; quoting that beats
      // dropping him, which is how a roster could come back missing someone with no
      // explanation at all.
      const r = priced[String(pl.id)] || { id: pl.id, rating: Math.round(pl.rating), rank: null, delta: 0 }
      // trust the platform's eligibility when it gave us any; fall back to our own label
      const pos = platformPos.length ? platformPos : (pl.pos ? [pl.pos] : [])
      hits.push({ pl, r, pos, value: val(r.rating), name: pl.name })
    })
    hits.sort((a, b) => b.value - a.value)
    return { hits, misses, total: hits.reduce((a, h) => a + h.value, 0), lines: entries.length }
  }

  const valueRoster = (explicit) => {
    const entries = (explicit && explicit.length)
      ? explicit
      : roster.split(/[\n,;\t]+/).map((l) => l.trim()).filter(Boolean)
    setValued(priceList(entries))
  }


  // Public, unauthenticated reads only — we never ask anyone for a password, which is also
  // why Yahoo is not on the list rather than being on it and failing.
  // Value every team in a connected league, both ways, so the toggle needs no refetch.
  const leagueRanks = useMemo(() => {
    if (!lg?.teams || !rows.length) return null
    const slots = (lg.slots && lg.slots.length ? lg.slots : DEFAULT_SLOTS)
      .map((x) => (SLOT_OK[x] ? x : 'UTIL'))
    return {
      slots,
      teams: lg.teams.map((t) => {
        const p = priceList(t.players)
        const best = bestLineup(p.hits, slots)
        return { id: t.id, name: t.name, hits: p.hits, misses: p.misses,
                 full: p.total, start: best.total, lineup: best.lineup, count: p.hits.length }
      }),
    }
    // priceList closes over seed+rows, both in the dep list
  }, [lg, rows, seed])       // eslint-disable-line react-hooks/exhaustive-deps

  const connectLeague = (leagueId) => {
    setLgBusy(true); setLgErr(null)
    const qs = new URLSearchParams({ platform, code: code.trim() })
    if (leagueId) qs.set('league', leagueId)
    fetch(`/api/league?${qs}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) {
          setLgErr({
            'no-user': 'No Sleeper user with that username.',
            'no-leagues': 'That account has no NBA leagues we can see.',
            'no-league': 'Could not read that league. If it is private, paste your roster instead.',
            'empty': 'That league came back with no rosters yet.',
            'bad-code': 'That does not look like a valid code.',
          }[j.error] || 'Could not reach that league. Paste your roster instead.')
          setLg(null)
        } else setLg(j)
      })
      .catch(() => setLgErr('Could not reach that league. Paste your roster instead.'))
      .finally(() => setLgBusy(false))
  }

  // ---- the hub -------------------------------------------------------------
  if (view === 'hub') {
    const doors = [
      { id: 'rank', k: group?.daily ? 'Daily session ready' : 'Set the price',
        t: 'Rank players', d: 'Four at a time, best dynasty value first. Every answer is six head-to-head results and moves the board.',
        cta: group?.daily ? 'Take today’s session →' : 'Start ranking →', accent: true },
      { id: 'board', k: 'The board', t: 'View rankings',
        d: `All ${seed?.count ?? rows.length} assets, priced by the crowd, with 24h movement and how thin each price is.`, cta: 'Open the board →' },
      { id: 'trending', k: 'Activity', t: 'Trending',
        d: 'What is actually moving right now — biggest gainers and fallers, momentum runs, and the live trade tape.', cta: 'See what is moving →' },
      { id: 'lobby', k: 'With friends', t: 'Settle it in a room',
        d: 'Open a room, share the code, and everyone ranks the same four. The room settles as one answer — and a room that agrees moves the board harder than a room that splits.',
        cta: 'Open a room →' },
      { id: 'team', k: 'Your roster', t: 'Value my team',
        d: 'Paste your roster from any platform and the market prices it, player by player, with a total.', cta: 'Paste a roster →' },
    ]
    return (
      <div className="dyn-term">
        <div className="dyn-grid border-b border-[var(--dyn-line)]">
          <div className="mx-auto max-w-6xl px-5 py-14 text-center sm:py-20">
            <div className="flex items-center justify-center gap-2">
              <span className="dyn-live inline-block h-1.5 w-1.5 rounded-full bg-[var(--dyn-up)]" />
              <span className="dyn-label text-[var(--dyn-up)]">Market open</span>
            </div>
            <h1 className="mt-4 text-5xl leading-none tracking-tight text-[var(--dyn-text)] sm:text-7xl">
              DYNASTY <span className="text-[var(--dyn-gold)]">EXCHANGE</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--dyn-dim)]">
              A dynasty board priced by the people who argue about it. No panel of experts —
              every number here is what the crowd’s picks imply.
            </p>

            <div className="mx-auto mt-10 grid max-w-4xl gap-px bg-[var(--dyn-line)] sm:grid-cols-2">
              {doors.map((d) => (
                <button key={d.id} type="button" onClick={() => setView(d.id)}
                  className="group bg-[var(--dyn-panel)] p-6 text-left transition-colors hover:bg-[var(--dyn-panel-2)]">
                  <div className={`dyn-label ${d.accent ? 'text-[var(--dyn-up)]' : 'text-[var(--dyn-gold)]'}`}>{d.k}</div>
                  <div className="mt-2 text-xl text-[var(--dyn-text)]">{d.t}</div>
                  <p className="mt-2 text-[13px] leading-relaxed text-[var(--dyn-dim)]">{d.d}</p>
                  <span className="dyn-mono mt-4 inline-block text-[11px] tracking-wider text-[var(--dyn-gold)] opacity-0 transition-opacity group-hover:opacity-100">
                    {d.cta}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <Ticker rows={rows} byId={byId} val={val} valDelta={valDelta} />

        <div className="border-b border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
          <div className="mx-auto flex max-w-6xl flex-wrap divide-x divide-[var(--dyn-line)]">
            <Stat label="Volume · all time" value={total.toLocaleString()} />
            <Stat label="Listed" value={rows.length} />
            <Stat label="Top gainer"
              value={topGainer?.delta ? `${symbolOf(nameOf(topGainer.id))} +${valDelta(topGainer)}` : '—'}
              tone={topGainer?.delta ? 'dyn-up' : ''} />
            <Stat label="Top loser"
              value={topLoser?.delta < 0 ? `${symbolOf(nameOf(topLoser.id))} ${valDelta(topLoser)}` : '—'}
              tone={topLoser?.delta < 0 ? 'dyn-down' : ''} />
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-5 py-10">
          <p className="text-[12px] leading-relaxed text-[var(--dyn-faint)]">
            Opening prices come from Hashtag Basketball’s points-league dynasty ranking. That is a
            starting line, not a verdict — it moves from the first pick onward.
          </p>
        </div>
      </div>
    )
  }

  // ---- lobby ---------------------------------------------------------------
  if (view === 'lobby') {
    const inRoom = !!lob?.code
    const meIn = !!lob?.submitted?.includes(me.current)
    const roster = Object.entries(lob?.roster || {})
    const res = lob?.result
    const settled = lob?.status === 'settled'
    return (
      <Shell kicker="With friends" title="THE ROOM" total={total}
        onHome={() => { setView('hub'); setLobErr(null) }}>
        <div className="mx-auto max-w-3xl px-5 py-10">
          {!inRoom && (
            <section className="dyn-panel p-5">
              <div className="dyn-label text-[var(--dyn-gold)]">Start or join</div>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--dyn-dim)]">
                Everyone in a room ranks the identical four. When the last person has ranked, the
                room settles as a single answer — the more you agree, the harder it moves the board.
              </p>
              <label className="dyn-label mt-5 block text-[var(--dyn-faint)]" htmlFor="lobname">Your name</label>
              <input id="lobname" value={lobName} onChange={(e) => setLobName(e.target.value)}
                placeholder="Shown to the room" maxLength={24}
                className="dyn-input mt-1 w-full" />
              <div className="mt-5 flex flex-wrap items-end gap-3">
                <button type="button" onClick={lobCreate} disabled={lobBusy} className="dyn-btn">
                  {lobBusy ? 'Opening…' : 'Open a room'}
                </button>
                <span className="dyn-mono text-[11px] text-[var(--dyn-faint)]">OR</span>
                <div>
                  <label className="dyn-label block text-[var(--dyn-faint)]" htmlFor="lobcode">Room code</label>
                  <input id="lobcode" value={lobCode} maxLength={4}
                    onChange={(e) => setLobCode(e.target.value.toUpperCase())}
                    placeholder="ABCD"
                    className="dyn-input dyn-mono mt-1 w-28 tracking-[0.3em]" />
                </div>
                <button type="button" onClick={lobJoin} disabled={lobBusy} className="dyn-btn-ghost">Join</button>
              </div>
              {lobErr && <p className="dyn-mono dyn-down mt-3 text-[11px]">{lobErr}</p>}
            </section>
          )}

          {inRoom && (
            <>
              <section className="dyn-panel">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--dyn-line)] px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="dyn-label text-[var(--dyn-gold)]">Room</span>
                    <span className="dyn-mono text-lg tracking-[0.3em] text-[var(--dyn-text)]">{lob.code}</span>
                  </div>
                  <span className="dyn-mono text-[11px] text-[var(--dyn-faint)]">
                    {settled ? 'SETTLED' : `${lob.submitted?.length || 0}/${roster.length} RANKED`}
                  </span>
                </header>

                <div className="border-b border-[var(--dyn-line)] px-5 py-3">
                  <div className="flex flex-wrap gap-2">
                    {roster.map(([uid, nm]) => {
                      const done = lob.submitted?.includes(uid)
                      return (
                        <span key={uid}
                          className={`dyn-mono rounded-sm border px-2 py-1 text-[10px] tracking-wider ${
                            done ? 'border-[var(--dyn-up)] text-[var(--dyn-up)]'
                                 : 'border-[var(--dyn-line)] text-[var(--dyn-faint)]'}`}>
                          {done ? '✓ ' : '· '}{nm}{uid === me.current ? ' (you)' : ''}
                        </span>
                      )
                    })}
                  </div>
                </div>

                <div className="p-5">
                  {!settled && (
                    <>
                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {lob.group.map((id) => (
                          <TicketCard key={id} p={byId[String(id)] || { id, name: `#${id}` }}
                            slot={lobOrder.indexOf(String(id)) + 1}
                            disabled={lobBusy || meIn} onPick={() => lobPick(String(id))} />
                        ))}
                      </div>
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        {!meIn && (
                          <button type="button" onClick={lobSubmit}
                            disabled={lobOrder.length !== 4 || lobBusy} className="dyn-btn">
                            {lobBusy ? 'Locking in…' : lobOrder.length === 4 ? 'Lock in my ranking'
                              : `Select ${4 - lobOrder.length} more`}
                          </button>
                        )}
                        {meIn && (
                          <span className="dyn-mono text-[11px] text-[var(--dyn-up)]">
                            LOCKED IN · WAITING ON THE ROOM
                          </span>
                        )}
                        {/* host escape hatch: somebody always wanders off mid-argument */}
                        {lob.host && (lob.submitted?.length || 0) > 0
                          && lob.submitted.length < roster.length && (
                          <button type="button" onClick={lobClose} className="dyn-btn-ghost">
                            Settle without the stragglers
                          </button>
                        )}
                        {lobErr && <span className="dyn-mono dyn-down text-[11px]">{lobErr}</span>}
                      </div>
                    </>
                  )}

                  {settled && res && (
                    <>
                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {res.consensus.map((id, i) => {
                          const mv = res.moved.find((x) => String(x.id) === String(id))
                          return (
                            <div key={id} className="dyn-card p-4 text-center">
                              <div className="dyn-label">Room #{i + 1}</div>
                              <div className="dyn-mono mt-1 text-[10px] tracking-widest text-[var(--dyn-faint)]">
                                {symbolOf(nameOf(id))}
                              </div>
                              <div className="mt-1 text-sm text-[var(--dyn-text)]">{nameOf(id)}</div>
                              <div className="mt-2"><Chg delta={mv?.delta ?? 0} /></div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="mt-5 grid gap-px bg-[var(--dyn-line)] sm:grid-cols-3">
                        <Stat label="Voters" value={res.voters} />
                        <Stat label="Agreement" value={`${Math.round(res.agreement * 100)}%`}
                          tone={res.agreement >= 0.5 ? 'dyn-up' : ''} />
                        <Stat label="Worth" value={`${res.weight}× a single pick`}
                          tone={res.weight === 0 ? 'dyn-down' : 'dyn-up'} />
                      </div>
                      <p className="mt-4 text-[12px] leading-relaxed text-[var(--dyn-faint)]">
                        {res.weight === 0
                          ? 'The room split evenly, so nothing moved. A room only moves the board when it actually agrees.'
                          : `The room's answer was applied once, worth ${res.weight}× a single pick. A room's influence is capped no matter how many people are in it.`}
                      </p>
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <button type="button"
                          onClick={() => { setLob(null); setLobOrder([]); setLobCode(''); loadBoard() }}
                          className="dyn-btn-ghost">Another room →</button>
                      </div>
                    </>
                  )}
                </div>
              </section>

              <p className="dyn-mono mt-4 text-center text-[11px] text-[var(--dyn-faint)]">
                SHARE THE CODE <span className="text-[var(--dyn-gold)]">{lob.code}</span> — ROOMS EXPIRE AFTER SIX HOURS
              </p>
            </>
          )}
        </div>
      </Shell>
    )
  }

  // ---- value my team -------------------------------------------------------
  if (view === 'team') {
    return (
      <Shell kicker="Your roster" title="VALUE MY TEAM" total={total}
        onHome={() => { setView('hub'); setValued(null) }}>
        <div className="mx-auto max-w-3xl px-5 py-10">
          <h2 className="text-3xl leading-tight text-[var(--dyn-text)]">What is your team worth?</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--dyn-dim)]">
            Connect a league and pick your team, or type the roster in yourself. Either way the
            market prices every player at the crowd’s current value.
          </p>

          <div className="mt-6 inline-flex border border-[var(--dyn-line)]">
            {[['connect', 'Connect a league'], ['paste', 'Enter manually']].map(([m, label]) => (
              <button key={m} type="button" onClick={() => { setTeamMode(m); setValued(null) }}
                aria-pressed={teamMode === m}
                className={`dyn-mono px-5 py-3 text-[11px] uppercase tracking-[0.12em] ${
                  teamMode === m ? 'bg-[var(--dyn-gold)] text-[#0a0d12]' : 'text-[var(--dyn-dim)] hover:text-[var(--dyn-text)]'}`}>
                {label}
              </button>
            ))}
          </div>

          {teamMode === 'connect' && (
            <div className="mt-6">
              <div className="flex flex-wrap gap-px bg-[var(--dyn-line)]">
                {PLATFORMS.map((pf) => (
                  <button key={pf.id} type="button"
                    onClick={() => { setPlatform(pf.id); setLg(null); setLgErr(null); setCode('') }}
                    aria-pressed={platform === pf.id}
                    className={`dyn-mono flex-1 px-4 py-3 text-[11px] uppercase tracking-[0.1em] ${
                      platform === pf.id ? 'bg-[var(--dyn-panel-2)] text-[var(--dyn-text)]' : 'bg-[var(--dyn-panel)] text-[var(--dyn-faint)] hover:text-[var(--dyn-dim)]'}`}>
                    {pf.name}
                  </button>
                ))}
              </div>

              {(() => {
                const pf = PLATFORMS.find((x) => x.id === platform)
                if (pf.manual) {
                  return (
                    <div className="border border-t-0 border-[var(--dyn-line)] bg-[var(--dyn-panel)] p-5">
                      <p className="text-[13px] leading-relaxed text-[var(--dyn-dim)]">{pf.how}</p>
                      <button type="button" onClick={() => setTeamMode('paste')} className="dyn-btn-ghost mt-4">
                        Enter it manually →
                      </button>
                    </div>
                  )
                }
                return (
                  <div className="border border-t-0 border-[var(--dyn-line)] bg-[var(--dyn-panel)] p-5">
                    <label className="dyn-label block" htmlFor="lgcode">{pf.label}</label>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <input id="lgcode" value={code} spellCheck="false" autoComplete="off"
                        onChange={(e) => { setCode(e.target.value); setLg(null); setLgErr(null) }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) connectLeague() }}
                        placeholder={pf.placeholder}
                        className="dyn-mono min-w-0 flex-1 border border-[var(--dyn-line)] bg-[var(--dyn-bg)] px-3 py-3 text-[13px] text-[var(--dyn-text)] outline-none placeholder:text-[var(--dyn-faint)] focus:border-[var(--dyn-gold)]" />
                      <button type="button" onClick={() => connectLeague()} disabled={!code.trim() || lgBusy} className="dyn-btn">
                        {lgBusy ? 'Connecting…' : 'Connect'}
                      </button>
                    </div>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--dyn-faint)]">{pf.how}</p>
                    {lgErr && <p className="dyn-mono dyn-down mt-3 text-[11px]">{lgErr}</p>}
                  </div>
                )
              })()}

              {lg?.leagues && (
                <div className="mt-4">
                  <div className="dyn-label mb-2">Which league?</div>
                  <ul className="divide-y divide-[var(--dyn-line-soft)] border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
                    {lg.leagues.map((l) => (
                      <li key={l.id}>
                        <button type="button" onClick={() => connectLeague(l.id)}
                          className="w-full px-4 py-3 text-left text-[13px] text-[var(--dyn-text)] hover:bg-[var(--dyn-panel-2)]">
                          {l.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {leagueRanks && (
                <div className="mt-6">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="dyn-label text-[var(--dyn-gold)]">
                      League power rankings{lg.leagueName ? ` · ${lg.leagueName}` : ''}
                    </span>
                    <div className="inline-flex border border-[var(--dyn-line)]">
                      {[['full', 'Full roster'], ['start', 'Starters only']].map(([m, label]) => (
                        <button key={m} type="button" onClick={() => setRankMode(m)}
                          aria-pressed={rankMode === m}
                          className={`dyn-mono px-4 py-2 text-[10px] uppercase tracking-[0.1em] ${
                            rankMode === m ? 'bg-[var(--dyn-gold)] text-[#0a0d12]' : 'text-[var(--dyn-dim)] hover:text-[var(--dyn-text)]'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <ol className="divide-y divide-[var(--dyn-line-soft)] border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
                    {[...leagueRanks.teams].sort((a, b) => b[rankMode] - a[rankMode]).map((t, i, arr) => {
                      const top = arr[0][rankMode] || 1
                      const mine = myTeam === t.id
                      return (
                        <li key={t.id}>
                          <button type="button"
                            onClick={() => { setMyTeam(t.id); setRoster(t.hits.map((h) => h.name).join('\n')); valueRoster(t.hits.map((h) => h.name)) }}
                            className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--dyn-panel-2)] ${mine ? 'bg-[var(--dyn-panel-2)]' : ''}`}>
                            <span className="dyn-mono w-6 text-[12px] text-[var(--dyn-faint)]">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-[var(--dyn-text)]">
                                {t.name}
                                {mine && <span className="dyn-mono ml-2 bg-[var(--dyn-gold)] px-1.5 py-0.5 text-[9px] text-[#0a0d12]">YOURS</span>}
                              </span>
                              <span className="mt-1 block h-1 w-full max-w-[220px] bg-[var(--dyn-line)]">
                                <span className="block h-full bg-[var(--dyn-up)]"
                                  style={{ width: `${Math.max(3, Math.round((t[rankMode] / top) * 100))}%` }} />
                              </span>
                            </span>
                            <span className="text-right">
                              <span className="dyn-mono block text-[13px] text-[var(--dyn-text)]">{t[rankMode].toLocaleString()}</span>
                              <span className="dyn-mono block text-[10px] text-[var(--dyn-faint)]">
                                {rankMode === 'start' ? `${leagueRanks.slots.length} STARTERS` : `${t.count} PLAYERS`}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ol>

                  <p className="mt-3 text-[12px] leading-relaxed text-[var(--dyn-faint)]">
                    {rankMode === 'start'
                      ? `Best possible lineup for each team at ${leagueRanks.slots.join(' / ')} — every roster is optimised, not taken as currently set, so this compares ceilings rather than who remembered to set their lineup.`
                      : 'Every rostered player, summed. Measures accumulated equity, which rewards depth a starting lineup never plays.'}
                    {' '}Tap a team to price it player by player.
                  </p>

                  {rankMode === 'start' && myTeam && (() => {
                    const t = leagueRanks.teams.find((x) => x.id === myTeam)
                    if (!t) return null
                    return (
                      <div className="mt-4">
                        <div className="dyn-label mb-2">Your best lineup</div>
                        <ol className="divide-y divide-[var(--dyn-line-soft)] border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
                          {t.lineup.map((l, i) => (
                            <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                              <span className="dyn-mono w-12 text-[11px] text-[var(--dyn-gold)]">{l.slot}</span>
                              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--dyn-text)]">
                                {l.player ? l.player.name : <span className="text-[var(--dyn-faint)]">— empty —</span>}
                              </span>
                              <span className="dyn-mono text-[12px] text-[var(--dyn-text)]">{l.player ? l.player.value : ''}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {teamMode === 'paste' && (
            <>
              <textarea
                value={roster} onChange={(e) => setRoster(e.target.value)} rows={8} spellCheck="false"
                placeholder={'Victor Wembanyama\nAnthony Edwards\nAlperen Sengun\n…'}
                className="dyn-mono mt-5 w-full resize-y border border-[var(--dyn-line)] bg-[var(--dyn-panel)] p-4 text-[13px] text-[var(--dyn-text)] outline-none placeholder:text-[var(--dyn-faint)] focus:border-[var(--dyn-gold)]"
              />
              <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--dyn-faint)]">
                One name per line, or comma separated. Numbering, punctuation and accents are all
                fine — anything we cannot place gets listed back to you rather than dropped.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => valueRoster()} disabled={!roster.trim()} className="dyn-btn">
                  Price this roster
                </button>
                {valued && (
                  <button type="button" onClick={() => { setRoster(''); setValued(null) }} className="dyn-btn-ghost">
                    Clear
                  </button>
                )}
              </div>
            </>
          )}


          {valued && (
            <div className="mt-8">
              <div className="flex flex-wrap divide-x divide-[var(--dyn-line)] border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
                <Stat label="Total value" value={valued.total.toLocaleString()} />
                <Stat label="Priced" value={`${valued.hits.length} / ${valued.lines}`} />
                <Stat label="Top asset"
                  value={valued.hits[0] ? symbolOf(valued.hits[0].pl.name) : '—'} />
                <Stat label="Avg price"
                  value={valued.hits.length ? Math.round(valued.total / valued.hits.length).toLocaleString() : '—'} />
              </div>

              <ol className="mt-4 divide-y divide-[var(--dyn-line-soft)] border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
                {valued.hits.map(({ pl, r }) => (
                  <li key={pl.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="dyn-mono w-10 text-[11px] text-[var(--dyn-faint)]">{r.rank ? `#${r.rank}` : '—'}</span>
                    {pl.id && (
                      <img src={HEAD(pl.id)} alt="" width="34" height="25" loading="lazy"
                        className="h-[25px] w-[34px] shrink-0 object-contain"
                        onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[var(--dyn-text)]">{pl.name}</span>
                      <span className="dyn-mono block text-[10px] tracking-wider text-[var(--dyn-faint)]">
                        {symbolOf(pl.name)} · {[pl.pos, pl.team, pl.age ? `${pl.age}Y` : null].filter(Boolean).join(' ')}
                      </span>
                    </span>
                    <span className="dyn-mono text-[13px] text-[var(--dyn-text)]">{val(r.rating).toLocaleString()}</span>
                    <span className="w-20 text-right text-[11px]"><Chg delta={valDelta(r)} /></span>
                  </li>
                ))}
                {!valued.hits.length && (
                  <li className="dyn-mono px-4 py-5 text-[12px] text-[var(--dyn-faint)]">
                    NOTHING MATCHED — CHECK THE NAMES AND TRY AGAIN.
                  </li>
                )}
              </ol>

              {valued.misses.length > 0 && (
                <p className="dyn-mono mt-3 text-[11px] leading-relaxed text-[var(--dyn-faint)]">
                  NOT ON THE BOARD ({valued.misses.length}): {valued.misses.slice(0, 12).join(' · ')}
                  {valued.misses.length > 12 ? ' …' : ''}
                </p>
              )}
              <p className="mt-3 text-[12px] leading-relaxed text-[var(--dyn-faint)]">
                Totals are the sum of crowd prices, so they measure accumulated value, not roster
                construction — two studs and filler can out-total a deep, balanced team.
              </p>
            </div>
          )}
        </div>
      </Shell>
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
                {view === 'board' ? <>THE <span className="text-[var(--dyn-gold)]">BOARD</span></>
                  : view === 'trending' ? <>WHAT IS <span className="text-[var(--dyn-gold)]">MOVING</span></>
                  : <>DYNASTY <span className="text-[var(--dyn-gold)]">EXCHANGE</span></>}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--dyn-dim)]">
                {view === 'board'
                  ? 'Every listed asset at the crowd’s current price, with 24h movement and how many books it has been through.'
                  : view === 'trending'
                  ? 'The board reprices on every pick. This is where it is happening fastest — and who is on a run.'
                  : 'Prices are set by the crowd, not by us. Rank four players — that single answer is six head-to-head results, and each one reprices both sides against what the market already believed.'}
              </p>
            </div>
            <div className="dyn-mono text-right text-[11px] text-[var(--dyn-faint)]">
              <button type="button" onClick={() => setView('hub')}
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

      <Ticker rows={rows} byId={byId} val={val} valDelta={valDelta} />

      {/* ---------------- market stats ---------------- */}
      <div className="border-b border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
        <div className="mx-auto flex max-w-7xl flex-wrap divide-x divide-[var(--dyn-line)]">
          <Stat label="Volume · all time" value={total.toLocaleString()} />
          <Stat label="Session" value={session.toLocaleString()} />
          <Stat label="Listed" value={rows.length} />
          <Stat label="Top gainer"
            value={topGainer?.delta ? `${symbolOf(nameOf(topGainer.id))} +${valDelta(topGainer)}` : '—'}
            tone={topGainer?.delta ? 'dyn-up' : ''} />
          <Stat label="Top loser"
            value={topLoser?.delta < 0 ? `${symbolOf(nameOf(topLoser.id))} ${valDelta(topLoser)}` : '—'}
            tone={topLoser?.delta < 0 ? 'dyn-down' : ''} />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 py-10">
        {!live && (
          <p className="dyn-panel dyn-mono mb-8 px-4 py-3 text-[11px] text-[var(--dyn-dim)]">
            PRICING FEED OFFLINE — SHOWING THE OPENING BOOK ONLY.
          </p>
        )}

        {/* ---------------- order ticket (ranking room only) ---------------- */}
        {view === 'rank' && (
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
        )}

        {/* ---------------- movers (trending room) ---------------- */}
        {view === 'trending' && (
          <section className="dyn-panel">
            <header className="flex items-center justify-between border-b border-[var(--dyn-line)] px-5 py-3">
              <span className="dyn-label text-[var(--dyn-gold)]">Movers</span>
              <span className="dyn-mono text-[10px] text-[var(--dyn-faint)]">SINCE THE LAST DAILY SNAPSHOT</span>
            </header>
            <div className="grid gap-px bg-[var(--dyn-line)] sm:grid-cols-2">
              {[['Climbing', rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 8)],
                ['Falling', rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 8)]].map(([label, list]) => (
                <div key={label} className="bg-[var(--dyn-panel)]">
                  <div className="dyn-label border-b border-[var(--dyn-line-soft)] px-4 py-2">{label}</div>
                  <ol>
                    {list.map((r) => {
                      const pl = byId[String(r.id)] || {}
                      return (
                        <li key={r.id} className="flex items-center gap-3 border-b border-[var(--dyn-line-soft)] px-4 py-2.5 last:border-0">
                          {pl.id && (
                            <img src={HEAD(pl.id)} alt="" width="30" height="22" loading="lazy"
                              className="h-[22px] w-[30px] shrink-0 object-contain"
                              onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-[var(--dyn-text)]">{pl.name || `#${r.id}`}</span>
                            <span className="dyn-mono block text-[10px] tracking-wider text-[var(--dyn-faint)]">
                              {symbolOf(pl.name || '')} · #{r.rank}
                              {Math.abs(r.streak) >= 2 && (
                                <span className={r.streak > 0 ? 'dyn-up' : 'dyn-down'}>
                                  {' '}· {r.streak > 0 ? 'BID' : 'ASK'} ×{Math.min(9, Math.abs(r.streak))}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="dyn-mono text-[13px] text-[var(--dyn-text)]">{val(r.rating).toLocaleString()}</span>
                          <span className="w-24 text-right text-[11px]"><Chg delta={valDelta(r)} pct={pctOf(valDelta(r), val(r.rating))} /></span>
                        </li>
                      )
                    })}
                    {!list.length && (
                      <li className="dyn-mono px-4 py-4 text-[11px] text-[var(--dyn-faint)]">
                        NOTHING {label === 'Climbing' ? 'UP' : 'DOWN'} YET TODAY.
                      </li>
                    )}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---------------- board + blotter ---------------- */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <section className="dyn-panel">
            <header className="flex items-center justify-between border-b border-[var(--dyn-line)] px-5 py-3">
              <span className="dyn-label text-[var(--dyn-gold)]">The board</span>
              <span className="dyn-mono text-[10px] text-[var(--dyn-faint)]">VALUE · 24H CHANGE · VOLUME</span>
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
                    <span className="dyn-mono text-right text-[13px] text-[var(--dyn-text)]">{val(r.rating).toLocaleString()}</span>
                    <span className="text-right text-[11px]"><Chg delta={valDelta(r)} pct={pctOf(valDelta(r), val(r.rating))} /></span>
                    <span className="dyn-mono hidden text-right text-[11px] text-[var(--dyn-faint)] sm:block">{r.seen || 0}</span>
                  </li>
                )
              })}
            </ol>

            <footer className="border-t border-[var(--dyn-line)] px-5 py-3 text-[11px] leading-relaxed text-[var(--dyn-faint)]">
              Value is the crowd’s order priced on a dynasty curve — steeply convex at the top,
              because roster spots are scarce and depth does not substitute for a franchise player.
              The order is exactly how the market voted; only the spacing is curved. 24h compares
              against a snapshot taken once a day, so a fresh board reads flat until the market has
              a day behind it. Vol is how many books an asset has appeared in — a thin value is a
              provisional one.
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
