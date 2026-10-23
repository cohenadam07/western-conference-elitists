import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/* Dynasty Exchange — Swipe.
 *
 * You hold a player. You are shown another. Swipe right to take him, left to keep yours.
 * Whoever wins is your guy for the next card, until the run ends on your #1. Every swipe is
 * one head-to-head result that moves the board (api/_dynasty-swipe.js prices it).
 *
 * The card is a Basketball Savant summary: the per-game line for his last three seasons on
 * top, the Savant percentiles underneath, against the league or his position. Rookies
 * without an NBA sample show their Draft Savant card, ranked against their draft class.
 * Every number comes from /dynasty/cards.json, which the build cuts from the same Savant
 * API files the connector serves, so a card never disagrees with the Savant page.
 *
 * The server deals a deck; this file only chooses the order. Swipes are held here and sent
 * as one batch at the end of a run, when the deck runs out, or when the tab is hidden.
 */

const API = '/api/dynasty'
const CARDS_URL = '/dynasty/cards.json'
const HEAD = (id) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`
const RUN_LEN = 15
const POOL_KEY = 'wce_swipe_pool'
const SITE = 'https://wcehoops.com'

export const SWIPE_MODES = [
  ['all', 'All players', 'Anyone on the board'],
  ['guard', 'Guards', 'Savant guards only'],
  ['wing', 'Wings', 'Savant wings only'],
  ['big', 'Bigs', 'Savant bigs only'],
  ['rookie', 'Rookies', 'The 2026 class'],
  ['u25', 'Under 25', 'The young core'],
]
const modeLabel = (m) => (SWIPE_MODES.find((x) => x[0] === m) || SWIPE_MODES[0])[1]
const POS_WORD = { Guard: 'guards', Wing: 'wings', Big: 'bigs' }

// Savant's percentile ramp, blue -> grey -> red (savant-core.mjs colorAt).
function colorAt(p) {
  const LO = [28, 78, 134], MID = [120, 124, 132], HI = [188, 58, 44]
  const mix = (a, b, u) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * u))
  const t = Math.max(0, Math.min(100, p)) / 100
  const c = t < 0.5 ? mix(LO, MID, t / 0.5) : mix(MID, HI, (t - 0.5) / 0.5)
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

// The page's own formats (savant-core.mjs fmt), for the units the card uses.
function fmt(unit, v) {
  if (v == null || !Number.isFinite(+v)) return '—'
  switch (unit) {
    case 'pct3': return '.' + String(Math.round(v * 1000)).padStart(3, '0')
    case 'pct1': return (+v).toFixed(1) + '%'
    case 'num2': return (+v).toFixed(2)
    case 'sgn': return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1)
    case 'ftin': { const t = Math.round(v), f = Math.floor(t / 12); return `${f}'${t - f * 12}"` }
    default: return (+v).toFixed(1)
  }
}
const one = (v) => (v == null ? '—' : (+v).toFixed(1))
const ts3 = (v) => (v == null ? '—' : '.' + String(Math.round(v * 1000)).padStart(3, '0'))
const rid = () => Math.random().toString(36).slice(2, 10)
// A run id is the share link, so it is long enough that nobody stumbles onto someone else's.
const runId = () => (Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8)).padEnd(12, '0')
export const runUrl = (id) => `${SITE}/dynasty?run=${id}`
// "Tarris Reed Jr." -> "Reed", for the buttons and the toast
const lastName = (n) => { const w = String(n || '').split(' ').filter((x) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(x)); return w[w.length - 1] || n }

function readPref(key, fallback) { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
function writePref(key, v) { try { localStorage.setItem(key, v) } catch { /* private mode */ } }

// ---------------------------------------------------------------- the card

// True when this card's number beats the other player's. Lower-is-better stats (turnovers)
// flip; percentiles are already flipped by Savant, so they always compare higher-is-better.
const beats = (a, b, lower = false) => a != null && b != null && Number.isFinite(+a) && Number.isFinite(+b)
  && (lower ? +a < +b : +a > +b)

function Bar({ label, unit, v, pct, low, better }) {
  const has = pct != null
  return (
    <div className={[low ? 'sw-low' : '', better ? 'sw-better' : ''].join(' ')}>
      <div className="sw-bar-l"><span className="truncate">{label}</span><b>{fmt(unit, v)}</b></div>
      <div className="sw-track">
        {has && <span className="sw-fill" style={{ width: `${pct}%`, background: colorAt(pct) }} />}
        {has && <span className="sw-dot" style={{ left: `${pct}%`, background: colorAt(pct) }}>{pct}</span>}
      </div>
    </div>
  )
}

const GROUPS = { off: 'Offense', def: 'Defense', val: 'Overall value' }

function Summary({ metrics, m, low, base, posIdx, vs }) {
  let last = null
  const out = []
  for (const [key, label, group, unit] of metrics) {
    if (group !== last) { out.push(<div key={'g' + group} className="sw-grp">{GROUPS[group]}</div>); last = group }
    const cell = m[key]
    const idx = base === 'pos' ? posIdx : 1
    const other = vs && vs[key]
    out.push(
      <Bar key={key} label={label} unit={unit} v={cell ? cell[0] : null}
        pct={cell ? cell[idx] : null} low={low && low.includes(key)}
        better={!!(cell && other && beats(cell[idx], other[idx]))} />,
    )
  }
  return <div className="sw-bars">{out}</div>
}

/* The card. `cards` is the whole cards.json; `id` the player; `seed` the board's own entry
 * (the fallback when the build could not write cards.json). */
/* `vs`: the player this card is being weighed against. Every number where this card's player
 * is better lights up green: the season lines season by season, the Savant bars on the same
 * season and the same pool. Nothing lights when the two have nothing comparable. */
export function SwipeCard({ id, cards, seed, base, setBase, compact = false, vs = null }) {
  const c = cards?.players?.[id]
  const o = vs ? cards?.players?.[vs] : null
  const name = c?.n || seed?.name || '—'
  const pos = c?.p || null
  const posWord = POS_WORD[pos] || 'position'

  // Which summary opens: the season in progress once it has enough games, else the last full one.
  const options = []
  if (c?.q) {
    for (const s of [cards.latest, cards.prevFull]) if (c.q[s] && !options.some((o) => o.s === s)) options.push({ s, ...c.q[s] })
  }
  const curOk = c?.q?.[cards?.latest]?.gp >= (cards?.currentMinGp || 10)
  const nbaDefault = options.find((o) => (curOk ? o.s === cards.latest : o.s === cards.prevFull)) || options[0]
  // A rookie opens on his Draft Savant card until his NBA season has enough games to read.
  const draftFirst = !!c?.d && (!nbaDefault || (c?.r && !curOk))
  const [pick, setPick] = useState(null)        // null = the default above
  useEffect(() => { setPick(null) }, [id])
  const view = pick || (draftFirst ? 'draft' : nbaDefault?.s || null)
  const q = view && view !== 'draft' ? c?.q?.[view] : null

  const lines = c?.s || []
  // pre-draft line against pre-draft line only (college numbers next to NBA ones mean nothing)
  const dhi = (i, lower = false) => (o?.d && beats(c.d.line[i], o.d.line[i], lower) ? 'sw-better' : '')
  // the other player's bars for the season (or pre-draft card) this card is showing
  const vsM = !o ? null : view === 'draft' ? o.d?.m || null : o.q?.[view]?.m || null
  const sub = [c?.t || seed?.team, pos || seed?.pos, (c?.a ?? seed?.age) ? `${Math.round((c?.a ?? seed?.age) * 10) / 10}y` : null,
    c?.r ? (c?.pk ? `Rookie · #${c.pk} pick` : 'Rookie') : null].filter(Boolean).join(' · ')

  return (
    <div>
      <div className="sw-head">
        <img className="sw-shot" src={HEAD(id)} alt="" draggable="false" width="96" height="70"
          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        <div className="min-w-0 flex-1 pb-1">
          <div className="sw-name text-[var(--dyn-text)]">{name}</div>
          <div className="sw-sub">{sub}</div>
        </div>
      </div>

      {(lines.length > 0 || c?.d) && (
        <table className="sw-lines">
          <thead>
            <tr><th>SZN</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>TO</th><th title="Steals + blocks per 75 possessions">STK/75</th><th>USG</th><th>TS</th></tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const now = l[0] === cards.latest && cards.inProgress
              const ol = o?.s?.find((x) => x[0] === l[0])
              const hi = (i) => (ol && beats(l[i], ol[i], i === 6) ? 'sw-better' : '')
              return (
                <tr key={l[0]} className={now ? 'sw-now' : ''}>
                  <td>{cards.seasonsShort?.[l[0]] || l[0]}</td>
                  <td className={[now && l[1] < (cards.currentMinGp || 10) ? 'sw-thin' : '', hi(1)].join(' ')}>{l[1] ?? '—'}</td>
                  <td className={hi(2)}>{one(l[2])}</td><td className={hi(3)}>{one(l[3])}</td><td className={hi(4)}>{one(l[4])}</td><td className={hi(5)}>{one(l[5])}</td>
                  <td className={hi(6)}>{one(l[6])}</td><td className={hi(7)}>{one(l[7])}</td><td className={hi(8)}>{l[8] == null ? '—' : (+l[8]).toFixed(1)}</td><td className={hi(9)}>{ts3(l[9])}</td>
                </tr>
              )
            })}
            {c?.d && (lines.length < 3) && (
              <tr>
                <td title={c.d.c || 'Pre-draft season'}>{/not NCAA|NBL|G League|Ignite|Euro|ACB|Liga|ABA/i.test(c.d.c || '') ? 'PRO' : 'COLL'}</td>
                <td>{c.d.gp ?? '—'}</td><td>—</td><td className={dhi(0)}>{one(c.d.line[0])}</td><td className={dhi(1)}>{one(c.d.line[1])}</td><td className={dhi(2)}>{one(c.d.line[2])}</td>
                <td className={dhi(3, true)}>{one(c.d.line[3])}</td><td>—</td><td className={dhi(4)}>{c.d.line[4] == null ? '—' : (+c.d.line[4]).toFixed(1)}</td><td className={dhi(5)}>{ts3(c.d.line[5])}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {!compact && (view === 'draft' || q) && (
        <div className="sw-sum">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="dyn-label hidden text-[var(--dyn-gold)] min-[400px]:inline">{view === 'draft' ? 'Draft' : 'Savant'}</span>
              {options.map((o) => (
                <button key={o.s} type="button" className="sw-chip" aria-pressed={view === o.s}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => setPick(o.s)}>
                  {cards.seasonsShort?.[o.s] || o.s}{o.s === cards.latest && cards.inProgress ? ` · ${o.gp}g` : ''}
                </button>
              ))}
              {c?.d && (
                <button type="button" className="sw-chip" aria-pressed={view === 'draft'}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => setPick('draft')}>Pre-draft</button>
              )}
            </div>
            <div className="sw-seg" onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" aria-pressed={base === 'league'} onClick={() => setBase('league')}>
                {view === 'draft' ? 'Class' : 'League'}
              </button>
              <button type="button" aria-pressed={base === 'pos'} onClick={() => setBase('pos')}>
                vs {view === 'draft' ? 'class ' : ''}{POS_WORD[view === 'draft' ? (c?.d?.p || pos) : pos] || posWord}
              </button>
            </div>
          </div>
          {view === 'draft'
            ? <Summary metrics={cards.draft?.metrics || []} m={c.d.m} low={null} base={base} posIdx={2} vs={vsM} />
            : <Summary metrics={cards.nba} m={q.m} low={q.low} base={base} posIdx={2} vs={vsM} />}
          <p className="mt-2 text-[10px] leading-snug text-[var(--dyn-faint)]">
            {view === 'draft'
              ? `Pre-draft season, percentile vs. the ${cards.draft?.year} draft class${base === 'pos' ? ` (${POS_WORD[c?.d?.p || pos] || 'same position'})` : ''}.`
              : `Per-75, percentile vs. ${base === 'pos' ? posWord : 'the league'}, ${cards.seasonsShort?.[view] || view}${q?.low?.length ? '. Hatched bars are under their stable sample' : ''}${q?.uq ? '. Below the minutes floor: ranked against qualifiers' : ''}.`}
            {o && (vsM || o.s) && <> <span className="text-[var(--dyn-up)]">Green</span>: better than {lastName(o.n)}{vsM ? '' : ' (no comparable Savant season)'}.</>}
          </p>
        </div>
      )}
      {!c && (
        <p className="px-4 pb-4 text-[11px] text-[var(--dyn-faint)]">No Savant card for him in this build.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the game

export default function DynastySwipe({ uid, board, byId, onExit, onTraded, initialMode = null, initialRun = null }) {
  const [cards, setCards] = useState(null)
  const [phase, setPhase] = useState('setup')   // setup | loading | play | done | error
  const [mode, setMode] = useState(initialMode || 'all')
  const [endless, setEndless] = useState(false)
  const [base, setBaseState] = useState(() => readPref(POOL_KEY, 'league'))
  const setBase = (b) => { setBaseState(b); writePref(POOL_KEY, b) }

  const [champ, setChamp] = useState(null)
  const [chal, setChal] = useState(null)
  const [count, setCount] = useState(0)          // swipes this run
  const [toast, setToast] = useState(null)
  const [crowned, setCrowned] = useState([])     // this session's #1s, newest first
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)
  const [peek, setPeek] = useState(false)
  const [me, setMe] = useState(null)
  const [viewRun, setViewRun] = useState(initialRun)   // a run being looked at, from a link or the end screen
  const [runId0, setRunId0] = useState(null)           // the run that just finished

  // Everything the batch needs lives in a ref, so a swipe never waits on a render.
  // `used` is this deck's shown cards (what the server will accept once); `seen` is the whole
  // run's, so a fresh deck never re-shows someone you already passed on.
  const g = useRef({ deal: null, used: new Set(), seen: new Set(), steps: [], shownAt: 0, run: '', place: 1, undos: 0, busy: false })

  useEffect(() => {
    fetch(CARDS_URL).then((r) => (r.ok ? r.json() : null)).then(setCards).catch(() => setCards(null))
  }, [])

  const rankOf = useMemo(() => {
    const m = {}
    board.forEach((r, i) => { m[String(r.id)] = { rank: i + 1, rating: r.rating } })
    return m
  }, [board])

  // Next card: mostly the dealt player nearest a few spots ABOVE the champion (a run climbs),
  // sometimes a wildcard, so it never settles into a predictable ladder.
  const chooseNext = useCallback((champId) => {
    const left = (g.current.deal?.deck || []).filter((id) => !g.current.used.has(id) && !g.current.seen.has(id) && id !== champId)
    if (!left.length) return null
    if (Math.random() < 0.15) return left[Math.floor(Math.random() * left.length)]
    const target = (rankOf[champId]?.rank || 200) - 3
    const near = left.slice().sort((a, b) => Math.abs((rankOf[a]?.rank || 999) - target) - Math.abs((rankOf[b]?.rank || 999) - target))
    return near[Math.floor(Math.random() * Math.min(3, near.length))]
  }, [rankOf])

  const show = useCallback((id) => {
    setChal(id)
    g.current.used.add(id)
    g.current.seen.add(id)
    g.current.shownAt = performance.now()
    // warm the next likely headshot so the swipe after this one has no blank frame
    const left = (g.current.deal?.deck || []).filter((x) => !g.current.used.has(x) && x !== id)
    left.slice(0, 3).forEach((x) => { const im = new Image(); im.src = HEAD(x) })
  }, [])

  const deal = useCallback(async (m, champId) => {
    const qs = new URLSearchParams({ action: 'swipe-deal', mode: m })
    if (champId) qs.set('champ', champId)
    if (crowned.length) qs.set('ex', crowned.join(','))
    const r = await fetch(`${API}?${qs}`)
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.ok) throw new Error(j?.error || 'Could not deal a deck.')
    g.current.deal = { nonce: j.nonce, start: String(j.start), deck: j.deck.map(String), preview: !!j.preview }
    g.current.used = new Set()
    g.current.steps = []
    return g.current.deal
  }, [crowned])

  // Send whatever is held. `beacon` for a tab on its way out: fire and forget.
  const submit = useCallback(async ({ done = false, beacon = false } = {}) => {
    const d = g.current.deal
    if (!d || !g.current.steps.length) return null
    const body = JSON.stringify({ nonce: d.nonce, uid, run: g.current.run, done, place: g.current.place, undos: g.current.undos, steps: g.current.steps })
    g.current.undos = 0
    g.current.steps = []
    g.current.deal = { ...d, spent: true }
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(`${API}?action=swipe-submit`, new Blob([body], { type: 'application/json' }))
      return null
    }
    try {
      const r = await fetch(`${API}?action=swipe-submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.ok) { onTraded?.(); return j }
    } catch { /* the swipes are lost to the market, not to the run */ }
    return null
  }, [uid, onTraded])

  const start = useCallback(async (m = mode) => {
    setErr(null); setResult(null); setCount(0); setPhase('loading')
    g.current.run = runId()
    g.current.place = crowned.length + 1
    g.current.undos = 0
    g.current.seen = new Set()
    try {
      const d = await deal(m, null)
      setChamp(d.start)
      g.current.seen.add(d.start)
      const next = chooseNext(d.start)
      if (!next) throw new Error('Not enough players in this mode.')
      show(next)
      setPhase('play')
    } catch (e) { setErr(e.message); setPhase('error') }
  }, [mode, deal, chooseNext, show])

  // /dynasty?swipe=<mode> drops straight into a run once the board is in.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (initialMode && board.length && !autoStarted.current) { autoStarted.current = true; start(initialMode) }
  }, [initialMode, board.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // A tab that is hidden may never come back: send what is held. If it does come back, the
  // deck that batch spent is gone, so deal a fresh one around the same champion and put a new
  // card up (the old one is not in the new deck and could not be accepted).
  const champRef = useRef(null)
  champRef.current = champ
  useEffect(() => {
    const vis = async () => {
      if (document.visibilityState === 'hidden') {
        if (g.current.steps.length) submit({ beacon: true })
        return
      }
      if (!g.current.deal?.spent || g.current.busy || !champRef.current) return
      g.current.busy = true
      try {
        await deal(mode, champRef.current)
        const next = chooseNext(champRef.current)
        if (next) show(next)
      } catch { /* the next swipe will try again */ }
      g.current.busy = false
    }
    const leave = () => { if (g.current.steps.length) submit({ beacon: true }) }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('pagehide', leave)
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', leave) }
  }, [submit, deal, chooseNext, show, mode])

  const finish = useCallback(async (winner) => {
    setPhase('done')
    setRunId0(g.current.run)
    setCrowned((c) => [winner, ...c.filter((x) => x !== winner)])
    const j = await submit({ done: true })
    setResult(j)
    fetch(`${API}?action=swipe-me&uid=${encodeURIComponent(uid)}&n=20`).then((r) => r.json()).then((x) => x?.ok && setMe(x)).catch(() => {})
  }, [submit, uid])

  const swipe = useCallback(async (took) => {
    if (phase !== 'play' || !chal || g.current.busy) return
    const d = g.current.deal
    if (d?.spent) return                       // a fresh deck is on its way (see the effect above)
    const ms = Math.round(performance.now() - g.current.shownAt)
    const winner = took ? chal : champ
    // what the market thought, said after the fact so it never anchors the swipe
    const rc = rankOf[champ]?.rating ?? 1500, rx = rankOf[chal]?.rating ?? 1500
    const pTake = Math.round(100 / (1 + Math.pow(10, (rc - rx) / 400)))
    const agree = took ? pTake : 100 - pTake
    setToast({ k: Date.now(), agree, took, name: lastName(cards?.players?.[winner]?.n || byId[winner]?.name || '') })
    if (navigator.vibrate) { try { navigator.vibrate(8) } catch { /* not allowed */ } }

    g.current.steps.push([champ, chal, took ? 1 : 0, ms])
    const n = count + 1
    setCount(n)
    setChamp(winner)
    setPeek(false)

    if (!endless && n >= RUN_LEN) { finish(winner); return }
    let next = chooseNext(winner)
    if (!next) {
      g.current.busy = true
      submit()                                        // this deck is done; trade it
      try { await deal(mode, winner); next = chooseNext(winner) } catch (e) { setErr(e.message) }
      g.current.busy = false
      if (!next) { finish(winner); return }
    }
    show(next)
  }, [phase, chal, champ, count, endless, rankOf, cards, byId, chooseNext, show, submit, deal, mode, finish])

  const undo = useCallback(() => {
    const s = g.current.steps.pop()
    if (!s) return
    g.current.undos++
    const [c, x] = s
    g.current.used.delete(chal)
    g.current.seen.delete(chal)
    g.current.used.delete(x)
    setChamp(c); setCount((n) => n - 1)
    show(x)
  }, [chal, show])

  // keys: ← keep, → take, Backspace/Z undo
  useEffect(() => {
    const k = (e) => {
      if (phase !== 'play' || e.target?.tagName === 'INPUT') return
      if (e.key === 'ArrowRight') { e.preventDefault(); fling(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); fling(-1) }
      else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  // ---- drag
  const cardRef = useRef(null)
  const drag = useRef(null)
  const setX = (x, cls = '') => {
    const el = cardRef.current
    if (!el) return
    el.className = 'sw-card ' + cls
    el.style.transform = `translateX(${x}px) rotate(${x / 22}deg)`
    const t = el.querySelector('.sw-stamp-take'), k = el.querySelector('.sw-stamp-keep')
    if (t) t.style.opacity = String(Math.max(0, Math.min(1, x / 90)))
    if (k) k.style.opacity = String(Math.max(0, Math.min(1, -x / 90)))
  }
  const fling = (dir) => {
    if (phase !== 'play' || g.current.busy) return
    setX(dir * (window.innerWidth + 120), 'sw-fly')
    setTimeout(() => { setX(0, 'sw-in'); swipe(dir > 0) }, 200)
  }
  const onDown = (e) => {
    if (phase !== 'play' || e.button > 0) return
    drag.current = { x0: e.clientX, y0: e.clientY, t0: performance.now(), dx: 0, live: false, id: e.pointerId }
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    d.dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (!d.live) {
      if (Math.abs(d.dx) < 8) return
      if (Math.abs(dy) > Math.abs(d.dx)) { drag.current = null; return }   // a scroll, not a swipe
      d.live = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    setX(d.dx)
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d || !d.live) return
    const v = d.dx / Math.max(1, performance.now() - d.t0)
    if (Math.abs(d.dx) > 95 || Math.abs(v) > 0.6) fling(Math.sign(d.dx))
    else setX(0, 'sw-back')
  }

  // ---------------------------------------------------------------- screens
  const nameOf = (id) => cards?.players?.[id]?.n || byId[id]?.name || '—'

  if (viewRun) {
    return (
      <RunReceipt id={viewRun} cards={cards} byId={byId} board={board} base={base} setBase={setBase}
        mine={viewRun === runId0}
        onBack={() => { setViewRun(null); if (initialRun && phase === 'setup') onExit() }}
        onPlay={(m) => { setViewRun(null); setMode(m); start(m) }} />
    )
  }

  if (phase === 'setup' || phase === 'error') {
    return (
      <div className="mx-auto max-w-xl px-4 pb-16 pt-6 sm:pt-10">
        <div className="dyn-label text-[var(--dyn-up)]">New · swipe mode</div>
        <h2 className="mt-2 text-4xl leading-none tracking-tight text-[var(--dyn-text)] sm:text-5xl">
          FIND YOUR <span className="text-[var(--dyn-gold)]">#1</span>
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--dyn-dim)]">
          You start with one player. Each card is a challenger: swipe right to take him, left to keep
          your guy. Whoever you keep faces the next card. {RUN_LEN} swipes and you have your #1, and
          every swipe is a head-to-head result that moves the board.
        </p>

        <div className="mt-7 dyn-label">Pool</div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SWIPE_MODES.map(([k, l, d]) => (
            <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k}
              className={`rounded-xl border p-3 text-left transition-colors ${mode === k ? 'border-[var(--dyn-gold)] bg-[var(--dyn-panel-2)]' : 'border-[var(--dyn-line)] bg-[var(--dyn-panel)]'}`}>
              <div className="text-[15px] text-[var(--dyn-text)]">{l}</div>
              <div className="mt-0.5 text-[11px] text-[var(--dyn-faint)]">{d}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 dyn-label">Length</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[[false, `${RUN_LEN}-card run`, 'Ends on your #1'], [true, 'Endless', 'Keep going until you stop']].map(([k, l, d]) => (
            <button key={String(k)} type="button" onClick={() => setEndless(k)} aria-pressed={endless === k}
              className={`rounded-xl border p-3 text-left ${endless === k ? 'border-[var(--dyn-gold)] bg-[var(--dyn-panel-2)]' : 'border-[var(--dyn-line)] bg-[var(--dyn-panel)]'}`}>
              <div className="text-[15px] text-[var(--dyn-text)]">{l}</div>
              <div className="mt-0.5 text-[11px] text-[var(--dyn-faint)]">{d}</div>
            </button>
          ))}
        </div>

        {err && <p className="dyn-mono mt-5 text-[12px] text-[var(--dyn-down)]">{err}</p>}
        {!board.length && <p className="dyn-mono mt-5 text-[12px] text-[var(--dyn-faint)]">The market is offline, so there is nothing to deal right now.</p>}
        <div className="mt-7 flex gap-3">
          <button type="button" className="dyn-btn flex-1 rounded-xl py-4" disabled={!board.length} onClick={() => start(mode)}>
            Start swiping →
          </button>
          <button type="button" className="dyn-btn-ghost rounded-xl" onClick={onExit}>Back</button>
        </div>
      </div>
    )
  }

  if (phase === 'loading') {
    return <div className="dyn-mono px-5 py-24 text-center text-[11px] tracking-widest text-[var(--dyn-faint)]">DEALING…</div>
  }

  if (phase === 'done') {
    const top = crowned[0]
    const moved = result?.moved?.find((m) => String(m.id) === String(top))
    const history = (me?.log || []).filter((l) => l.f).slice(0, 8)
    return (
      <div className="mx-auto max-w-xl px-4 pb-16 pt-5">
        <div className="text-center">
          <div className="dyn-label text-[var(--dyn-gold)]">Your #1 · {modeLabel(mode)}</div>
        </div>
        <div className="sw-card sw-crowned mt-3" style={{ borderColor: 'rgba(194,162,99,.6)' }}>
          <SwipeCard id={top} cards={cards} seed={byId[top]} base={base} setBase={setBase} />
        </div>
        <p className="dyn-mono mt-3 text-center text-[11px] text-[var(--dyn-dim)]">
          {count} swipes{result?.preview ? ' · preview: priced, not traded' : ''}
          {moved && moved.delta ? <> · his price <span className={moved.delta > 0 ? 'dyn-up' : 'dyn-down'}>{moved.delta > 0 ? '+' : ''}{moved.delta}</span></> : null}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="dyn-btn rounded-xl py-4" onClick={() => start(mode)}>Go again for #{crowned.length + 1}</button>
          <ShareButton id={top} name={nameOf(top)} mode={mode} cards={cards} n={count} run={result?.run || null} place={crowned.length} />
        </div>
        {result?.run && (
          <button type="button" className="dyn-btn-ghost mt-2 w-full rounded-xl" onClick={() => setViewRun(result.run)}>
            See every pick in this run →
          </button>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" className="dyn-btn-ghost rounded-xl" onClick={() => { setCrowned([]); setPhase('setup') }}>New pool</button>
          <button type="button" className="dyn-btn-ghost rounded-xl" onClick={onExit}>The board</button>
        </div>
        {crowned.length > 1 && (
          <div className="mt-7">
            <div className="dyn-label">Your order this session</div>
            <ol className="mt-2 divide-y divide-[var(--dyn-line-soft)] rounded-xl border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
              {crowned.slice().reverse().map((id, i) => (
                <li key={id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span className="dyn-mono w-6 text-[var(--dyn-gold)]">#{i + 1}</span>
                  <span className="text-[var(--dyn-text)]">{nameOf(String(id))}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {me?.board?.length > 0 && <MyBoard me={me} nameOf={nameOf} board={board} />}
        {history.length > 0 && (
          <div className="mt-7">
            <div className="flex items-baseline justify-between">
              <span className="dyn-label">Your runs, on record</span>
              <span className="dyn-mono text-[10px] text-[var(--dyn-faint)]">{me.swipes} swipes · {me.runs} runs</span>
            </div>
            <ul className="mt-2 divide-y divide-[var(--dyn-line-soft)] rounded-xl border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
              {history.map((l, i) => (
                <li key={i}>
                  <button type="button" disabled={!l.r} onClick={() => setViewRun(l.r)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px]">
                    <span className="truncate text-[var(--dyn-text)]">{l.p > 1 ? `#${l.p} · ` : ''}{nameOf(String(l.f))}</span>
                    <span className="dyn-mono shrink-0 text-[10px] text-[var(--dyn-faint)]">{modeLabel(l.m)} · {new Date(l.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{l.r ? ' →' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  // ---- play
  const champCard = cards?.players?.[champ]
  const lastFull = champCard?.s?.find((l) => !(l[0] === cards.latest && cards.inProgress)) || champCard?.s?.[0]
  return (
    <div className="mx-auto max-w-xl px-3 pb-6 pt-3 sm:px-4">
      <div className="mb-2 flex items-center gap-3">
        <button type="button" onClick={() => { submit(); setPhase('setup') }} className="dyn-mono text-[11px] text-[var(--dyn-faint)]">✕</button>
        <div className="sw-progress flex-1"><i style={{ width: endless ? '100%' : `${(count / RUN_LEN) * 100}%`, opacity: endless ? 0.35 : 1 }} /></div>
        <span className="dyn-mono text-[10px] text-[var(--dyn-dim)]">{endless ? `${count}` : `${count}/${RUN_LEN}`}</span>
      </div>

      {/* the champion: hold to see his full card */}
      <button type="button" className="sw-champ mb-2.5 w-full text-left"
        onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)}
        onContextMenu={(e) => e.preventDefault()}>
        <img src={HEAD(champ)} alt="" draggable="false" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        <div className="min-w-0 flex-1">
          <div className="dyn-label text-[var(--dyn-gold)]">Your guy · {modeLabel(mode)}</div>
          <div className="truncate text-[15px] text-[var(--dyn-text)]">{nameOf(champ)}</div>
        </div>
        {lastFull && (
          <div className="dyn-mono shrink-0 text-right text-[10px] leading-tight text-[var(--dyn-dim)]">
            <div>{one(lastFull[3])} / {one(lastFull[4])} / {one(lastFull[5])}</div>
            <div className="text-[var(--dyn-faint)]">{cards.seasonsShort?.[lastFull[0]]} · hold</div>
          </div>
        )}
      </button>

      <div className="sw-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div ref={cardRef} className="sw-card" style={peek ? { borderColor: 'rgba(194,162,99,.6)' } : undefined}>
          <span className="sw-stamp sw-stamp-take">TAKE</span>
          <span className="sw-stamp sw-stamp-keep">KEEP</span>
          {peek
            ? <><div className="dyn-label px-4 pt-3 text-[var(--dyn-gold)]">Your guy</div><SwipeCard id={champ} cards={cards} seed={byId[champ]} base={base} setBase={setBase} vs={chal} /></>
            : <SwipeCard id={chal} cards={cards} seed={byId[chal]} base={base} setBase={setBase} vs={champ} />}
        </div>
      </div>

      <div className="sticky bottom-0 -mx-3 mt-3 bg-gradient-to-t from-[var(--dyn-bg)] via-[var(--dyn-bg)] to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-4 sm:-mx-4 sm:px-4">
        <div className="sw-act">
          <button type="button" className="sw-keep" onClick={() => fling(-1)}>
            <span className="block">← Keep</span>
            <span className="block truncate px-2 text-[9px] tracking-wider opacity-70">{lastName(nameOf(champ))}</span>
          </button>
          <button type="button" className="sw-undo" onClick={undo} disabled={!g.current.steps.length} aria-label="Undo">↶</button>
          <button type="button" className="sw-take" onClick={() => fling(1)}>
            <span className="block">Take →</span>
            <span className="block truncate px-2 text-[9px] tracking-wider opacity-70">{lastName(nameOf(chal))}</span>
          </button>
        </div>
        {endless && (
          <button type="button" className="sw-finish mt-2 w-full" disabled={!count} onClick={() => finish(champ)}>
            Finish · crown {lastName(nameOf(champ))} your #1
          </button>
        )}
        <p className="dyn-mono mt-2 hidden text-center text-[10px] text-[var(--dyn-faint)] sm:block">← keep · → take · Z undo · hold your guy to compare</p>
      </div>

      {toast && (
        <div key={toast.k} className="sw-toast">
          <span className={toast.agree >= 50 ? 'dyn-up' : 'text-[var(--dyn-gold)]'}>
            {toast.agree >= 50 ? 'With the market' : 'Against the market'}
          </span>
          <span className="text-[var(--dyn-dim)]"> · board had {toast.name} at {toast.agree}%</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- share

const poolNoun = (mode) => (mode === 'all' ? 'player' : mode === 'u25' ? 'under-25 player' : modeLabel(mode).toLowerCase().replace(/s$/, ''))

function ShareButton({ id, name, mode, cards, n, run, place = 1 }) {
  const [said, setSaid] = useState(null)
  const go = async () => {
    // the link opens this exact run, every pick in it; without one (it did not save) the pool
    const url = run ? runUrl(run) : `${SITE}/dynasty?swipe=${mode}`
    const text = `${n} swipes later, ${name} is my ${place > 1 ? `#${place}` : '#1'} dynasty ${poolNoun(mode)}.${run ? ' Every pick is here:' : ' Find yours on Dynasty Exchange.'}`
    let file = null
    try { file = await shareImage(id, name, mode, cards, n, place) } catch { file = null }
    try {
      if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text, url }); return }
      if (navigator.share) { await navigator.share({ text, url }); return }
    } catch { return }                                // the person closed the sheet
    if (file) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(file); a.download = file.name; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    }
    try { await navigator.clipboard.writeText(`${text} ${url}`); setSaid('Copied') } catch { setSaid('Saved') }
    setTimeout(() => setSaid(null), 1800)
  }
  return <button type="button" className="dyn-btn-ghost rounded-xl" onClick={go}>{said || 'Share'}</button>
}

// A 1080×1350 card for a story or a group chat: the name, his line, six Savant bars.
async function shareImage(id, name, mode, cards, n, place = 1) {
  const W = 1080, H = 1350
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const x = cv.getContext('2d')
  await document.fonts?.ready
  x.fillStyle = '#0a0d12'; x.fillRect(0, 0, W, H)
  x.strokeStyle = 'rgba(255,255,255,.035)'; x.lineWidth = 1
  for (let i = 0; i < W; i += 54) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke() }
  for (let i = 0; i < H; i += 54) { x.beginPath(); x.moveTo(0, i); x.lineTo(W, i); x.stroke() }

  const img = await new Promise((res) => {
    const im = new Image(); im.crossOrigin = 'anonymous'
    im.onload = () => res(im); im.onerror = () => res(null); im.src = HEAD(id)
    setTimeout(() => res(null), 2500)
  })
  if (img) { try { x.drawImage(img, W - 640, 120, 600, 438) } catch { /* tainted: skip the photo */ } }

  x.fillStyle = '#c2a263'; x.font = '500 30px "IBM Plex Mono", monospace'
  x.fillText(`MY #${place} · ${modeLabel(mode).toUpperCase()} · OUT OF ${n} SWIPES`, 72, 150)
  x.fillStyle = '#e9edf3'; x.font = '600 104px Newsreader, Georgia, serif'
  const parts = name.split(' ')
  const first = parts.slice(0, -1).join(' ') || name, last = parts.length > 1 ? parts.slice(-1)[0] : ''
  x.fillText(first, 72, 330); if (last) x.fillText(last, 72, 440)
  const c = cards?.players?.[id]
  x.fillStyle = '#8d97a6'; x.font = '500 30px "IBM Plex Mono", monospace'
  x.fillText([c?.t, c?.p, c?.a ? `${c.a}Y` : null].filter(Boolean).join(' · ').toUpperCase(), 72, 505)

  const q = c?.q?.[cards.prevFull] || c?.q?.[cards.latest]
  const rows = q ? ['pts', 'ts', 'ast', 'reb75', 'stk75', 'bpm'].map((k) => [cards.nba.find((m) => m[0] === k), q.m[k]]).filter(([m, v]) => m && v)
    : c?.d ? ['usg', 'ts', 'ast', 'stl', 'blk', 'bpm'].map((k) => [cards.draft.metrics.find((m) => m[0] === k), c.d.m[k]]).filter(([m, v]) => m && v) : []
  x.fillStyle = '#5a6472'; x.font = '500 24px "IBM Plex Mono", monospace'
  x.fillText(q ? `BASKETBALL SAVANT · ${cards.seasonsShort?.[cards.prevFull] || ''} · VS LEAGUE` : `DRAFT SAVANT · VS ${cards.draft?.year} CLASS`, 72, 640)
  rows.forEach(([m, v], i) => {
    const y = 700 + i * 92, p = v[1]
    x.fillStyle = '#8d97a6'; x.font = '500 30px "IBM Plex Sans", sans-serif'; x.fillText(m[1], 72, y)
    x.fillStyle = '#e9edf3'; x.font = '500 30px "IBM Plex Mono", monospace'
    const val = fmt(m[3], v[0]); x.fillText(val, W - 72 - x.measureText(val).width, y)
    x.fillStyle = '#1a212c'; x.fillRect(72, y + 20, W - 144, 14)
    if (p != null) { x.fillStyle = colorAt(p); x.fillRect(72, y + 20, (W - 144) * p / 100, 14) }
  })
  x.fillStyle = '#c2a263'; x.fillRect(72, H - 150, 90, 4)
  x.fillStyle = '#e9edf3'; x.font = '600 44px Newsreader, Georgia, serif'; x.fillText('Dynasty Exchange', 72, H - 90)
  x.fillStyle = '#8d97a6'; x.font = '500 28px "IBM Plex Mono", monospace'; x.fillText('wcehoops.com/dynasty', 72, H - 48)
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'))
  return blob ? new File([blob], `my-1-${mode}.png`, { type: 'image/png' }) : null
}

// ---------------------------------------------------------------- your board

/* Your personal board: everyone you have swiped on, ordered by your calls alone
 * (api/_dynasty-swipe.js personalSteps), next to where the market has him. */
function MyBoard({ me, nameOf, board }) {
  const [all, setAll] = useState(false)
  const market = {}
  board.forEach((r, i) => { market[String(r.id)] = i + 1 })
  const rows = (me.board || []).filter((r) => r.w + r.l > 0)
  const shown = all ? rows : rows.slice(0, 10)
  return (
    <div className="mt-7">
      <div className="flex items-baseline justify-between">
        <span className="dyn-label">Your board</span>
        <span className="dyn-mono text-[10px] text-[var(--dyn-faint)]">your calls only · W-L · market rank</span>
      </div>
      <ol className="mt-2 divide-y divide-[var(--dyn-line-soft)] rounded-xl border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
        {shown.map((r, i) => {
          const m = market[String(r.id)]
          const diff = m ? m - (i + 1) : 0
          return (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
              <span className="dyn-mono w-6 shrink-0 text-[var(--dyn-gold)]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--dyn-text)]">{nameOf(String(r.id))}</span>
              <span className="dyn-mono shrink-0 text-[10.5px] text-[var(--dyn-dim)]">{r.w}-{r.l}</span>
              <span className="dyn-mono w-16 shrink-0 text-right text-[10.5px] text-[var(--dyn-faint)]">
                {m ? `#${m}` : '—'}
                {diff !== 0 && m ? <span className={diff > 0 ? 'dyn-up' : 'dyn-down'}> {diff > 0 ? '▲' : '▼'}{Math.abs(diff)}</span> : null}
              </span>
            </li>
          )
        })}
      </ol>
      {rows.length > 10 && (
        <button type="button" className="dyn-mono mt-2 text-[10px] tracking-wider text-[var(--dyn-gold)]" onClick={() => setAll(!all)}>
          {all ? 'SHOW TOP 10' : `SHOW ALL ${rows.length}`}
        </button>
      )}
      <p className="mt-2 text-[10.5px] leading-snug text-[var(--dyn-faint)]">
        ▲ you rate him higher than the market does. Everyone enters at his market price; only your swipes move him here.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- one run, from a link

/* What a shared link opens: the #1, the pool, how many swipes it took, and every matchup in
 * order, who was taken over whom and what the board thought of that call at the time. */
function RunReceipt({ id, cards, byId, board, base, setBase, mine, onBack, onPlay }) {
  const [run, setRun] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    setRun(null); setErr(null)
    fetch(`${API}?action=swipe-run&id=${encodeURIComponent(id)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok && j?.ok ? setRun(j) : setErr(j?.error === 'no such run' ? 'That run is not on record.' : 'Could not load that run.')))
      .catch(() => setErr('Could not load that run.'))
  }, [id])
  const nameOf = (pid) => cards?.players?.[pid]?.n || byId[pid]?.name || `#${pid}`
  const market = {}
  board.forEach((r, i) => { market[String(r.id)] = i + 1 })

  if (err) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-[14px] text-[var(--dyn-dim)]">{err}</p>
        <button type="button" className="dyn-btn mt-6 rounded-xl" onClick={() => onPlay('all')}>Find your own #1 →</button>
      </div>
    )
  }
  if (!run) return <div className="dyn-mono px-5 py-24 text-center text-[11px] tracking-widest text-[var(--dyn-faint)]">LOADING THE RUN…</div>

  const steps = run.steps || []
  const took = steps.filter((s) => s[2] === 1).length
  const bold = steps.filter((s) => s[4] != null && (s[2] ? s[4] : 100 - s[4]) < 40).length
  const secs = steps.length ? steps.reduce((a, s) => a + (s[3] || 0), 0) / steps.length / 1000 : 0
  const champ = run.champ ? String(run.champ) : steps.length ? String(steps[steps.length - 1][2] ? steps[steps.length - 1][1] : steps[steps.length - 1][0]) : null
  const when = run.finished || run.started

  return (
    <div className="mx-auto max-w-xl px-4 pb-16 pt-5">
      <button type="button" onClick={onBack} className="dyn-mono text-[10px] tracking-widest text-[var(--dyn-faint)]">← BACK</button>
      <div className="mt-3 text-center">
        <div className="dyn-label text-[var(--dyn-gold)]">
          {mine ? 'Your' : 'Their'} {run.place > 1 ? `#${run.place}` : '#1'} · {modeLabel(run.mode)}
        </div>
        <div className="mt-1 text-[22px] leading-tight text-[var(--dyn-text)]">
          Out of <span className="text-[var(--dyn-gold)]">{run.swipes}</span> swipes, {champ ? lastName(nameOf(champ)) : '—'} came out on top
        </div>
        {when ? <div className="dyn-mono mt-1 text-[10px] text-[var(--dyn-faint)]">{new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}{run.finished ? '' : ' · unfinished'}</div> : null}
      </div>

      {champ && (
        <div className="sw-card mt-4" style={{ borderColor: 'rgba(194,162,99,.6)' }}>
          <SwipeCard id={champ} cards={cards} seed={byId[champ]} base={base} setBase={setBase} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--dyn-line)] bg-[var(--dyn-line)] text-center">
        {[[`${steps.length - took}`, 'kept'], [`${took}`, 'took'], [`${bold}`, 'against the board']].map(([v, l]) => (
          <div key={l} className="bg-[var(--dyn-panel)] px-2 py-2.5">
            <div className="dyn-mono text-[16px] text-[var(--dyn-text)]">{v}</div>
            <div className="dyn-label mt-0.5">{l}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-baseline justify-between">
        <span className="dyn-label">Every pick, in order</span>
        {secs ? <span className="dyn-mono text-[10px] text-[var(--dyn-faint)]">{secs.toFixed(1)}s a card</span> : null}
      </div>
      <ol className="mt-2 divide-y divide-[var(--dyn-line-soft)] rounded-xl border border-[var(--dyn-line)] bg-[var(--dyn-panel)]">
        {steps.map(([c, x, k, ms, odds], i) => {
          const w = String(k ? x : c), l = String(k ? c : x)
          const backed = odds == null ? null : (k ? odds : 100 - odds)
          return (
            <li key={i} className="flex items-center gap-2.5 px-3 py-2">
              <span className="dyn-mono w-5 shrink-0 text-[10px] text-[var(--dyn-faint)]">{i + 1}</span>
              <span className={`dyn-mono w-10 shrink-0 text-[9px] tracking-wider ${k ? 'dyn-up' : 'text-[var(--dyn-gold)]'}`}>{k ? 'TAKE' : 'KEEP'}</span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-tight">
                <span className="text-[var(--dyn-text)]">{nameOf(w)}</span>
                <span className="text-[var(--dyn-faint)]"> over </span>
                <span className="text-[var(--dyn-dim)]">{nameOf(l)}</span>
              </span>
              {backed != null && (
                <span className={`dyn-mono shrink-0 text-[10px] ${backed < 40 ? 'text-[var(--dyn-gold)]' : 'text-[var(--dyn-faint)]'}`} title="The board's odds for this pick when it was made">
                  {backed}%
                </span>
              )}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-[10.5px] leading-snug text-[var(--dyn-faint)]">
        % is the chance the board gave the pick when it was made. Gold marks a call against the board.
        {champ && market[champ] ? ` Market rank today: ${lastName(nameOf(champ))} #${market[champ]}.` : ''}
      </p>

      <button type="button" className="dyn-btn mt-6 w-full rounded-xl py-4" onClick={() => onPlay(run.mode)}>
        Find your own #1 · {modeLabel(run.mode)} →
      </button>
    </div>
  )
}
