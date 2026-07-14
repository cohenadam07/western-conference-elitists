import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GRAPH from '../data/compChain.json'
import usePageMeta from '../lib/usePageMeta.js'
import { pickCelebration } from '../lib/celebrations.js'

// Comp Chain — standalone game page with its own dark scoreboard look.
// Hop from a random NBA player through his statistical comps (Basketball Savant)
// to reach the target. The game graph gives 4 comps per player, spread by an
// in-degree cap so no hub player absorbs every chain, and targets are drawn from
// the start's reachable set at low par — every round is solvable and short.
// Modes: Daily (seeded by the date, same puzzle for everyone) and Free Play.
// Hints are counted; each win fires one of several over-the-top celebrations.

const HEAD = (id) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`
const GOLD = '#c2a263'

/* ---------- graph ---------- */
function buildMaps() {
  const adj = {}
  const info = {}
  for (const p of GRAPH) {
    adj[p.id] = p.comps.map((c) => c.id)
    info[p.id] = { name: p.name, team: p.team, comps: p.comps }
  }
  return { adj, info, nodes: GRAPH.map((p) => p.id) }
}

function bfs(adj, src) {
  const seen = { [src]: 0 }
  const q = [src]
  let i = 0
  while (i < q.length) {
    const u = q[i++]
    for (const v of adj[u] || []) if (seen[v] == null) { seen[v] = seen[u] + 1; q.push(v) }
  }
  return seen
}

/* ---------- seeded RNG for the daily puzzle ---------- */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
const todayKey = () => new Date().toLocaleDateString('en-CA')
const todayLabel = () =>
  new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function makeGame(adj, nodes, rng, parMin, parMax) {
  let start
  let target = null
  let par = 0
  for (let t = 0; t < 400 && target == null; t++) {
    start = nodes[(rng() * nodes.length) | 0]
    const dist = bfs(adj, start)
    const cand = Object.keys(dist).map(Number)
      .filter((id) => id !== start && dist[id] >= parMin && dist[id] <= parMax)
      .sort((a, b) => a - b)
    if (cand.length) { target = cand[(rng() * cand.length) | 0]; par = dist[target] }
  }
  if (target == null) {
    const dist = bfs(adj, start)
    const cand = Object.keys(dist).map(Number).filter((id) => id !== start && dist[id] > 0).sort((a, b) => a - b)
    target = cand[(rng() * cand.length) | 0]
    par = dist[target]
  }
  return { start, target, par }
}

/* ---------- localStorage stats ---------- */
const LS = 'wce_comp_chain_v1'
function loadStats() {
  try { return { plays: 0, wins: 0, flawless: 0, daily: {}, streak: 0, lastDaily: null, ...JSON.parse(localStorage.getItem(LS) || '{}') } }
  catch { return { plays: 0, wins: 0, flawless: 0, daily: {}, streak: 0, lastDaily: null } }
}
function saveStats(s) { try { localStorage.setItem(LS, JSON.stringify(s)) } catch { /* private mode */ } }

/* win jingle — tiny WebAudio arpeggio, no assets */
function winJingle(flawless) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ac = new AC()
    const t0 = ac.currentTime + 0.02
    const notes = flawless ? [523.25, 659.25, 783.99, 1046.5, 1318.51] : [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((f, i) => {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.type = 'triangle'; o.frequency.value = f
      const t = t0 + i * 0.085
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.13, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.connect(g); g.connect(ac.destination)
      o.start(t); o.stop(t + 0.55)
    })
    setTimeout(() => ac.close(), 1800)
  } catch { /* audio unavailable */ }
}

/* ---------- small pieces ---------- */
function useCountUp(target, active, ms = 900) {
  const [n, setN] = useState(active ? 0 : target)
  useEffect(() => {
    if (!active) { setN(target); return }
    let raf
    const t0 = performance.now()
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms)
      setN(Math.round(target * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, active, ms])
  return n
}

function Head({ id, className }) {
  return (
    <img src={HEAD(id)} alt="" loading="lazy"
      onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} className={className} />
  )
}

function EndCard({ id, role, info, tone }) {
  const p = info[id] || { name: '?', team: '—' }
  const ring = tone === 'target' ? 'ring-[#c2a263]/60' : 'ring-white/15'
  const glow = tone === 'target' ? '0 0 34px -6px rgba(194,162,99,0.55)' : 'none'
  return (
    <div className={`flex flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 ring-1 ${ring}`} style={{ boxShadow: glow }}>
      <Head id={id} className="h-14 w-14 shrink-0 rounded-xl bg-white/5 object-cover object-[center_top] ring-1 ring-white/10" />
      <div className="min-w-0">
        <div className={`font-mono text-[9px] font-semibold uppercase tracking-[0.22em] ${tone === 'target' ? 'text-[#c2a263]' : 'text-white/40'}`}>{role}</div>
        <div className="truncate text-lg font-semibold leading-tight text-white">{p.name}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{p.team}</div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent, pulseKey }) {
  return (
    <div key={pulseKey} className="cc-stat-pop flex flex-col items-center rounded-xl border border-white/10 bg-black/30 px-6 py-3">
      <span className={`font-mono text-3xl font-bold tabular-nums leading-none ${accent ? 'text-[#c2a263]' : 'text-white'}`}>{value}</span>
      <span className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-white/45">{label}</span>
    </div>
  )
}

function Btn({ children, onClick, disabled, primary }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={primary
        ? 'rounded-lg bg-[#c2a263] px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[#0b0f18] transition hover:brightness-110 disabled:opacity-40'
        : 'rounded-lg border border-white/15 bg-white/[0.03] px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.12em] text-white/70 transition hover:border-[#c2a263]/60 hover:text-white disabled:opacity-30'}>
      {children}
    </button>
  )
}

/* ---------- page ---------- */
export default function CompChain() {
  usePageMeta('Comp Chain', 'Hop from one NBA player to another through their statistical comps — a daily game built on Basketball Savant data.')
  const { adj, info, nodes } = useMemo(buildMaps, [])
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])

  const [mode, setMode] = useState('daily')
  const [game, setGame] = useState(null)
  const [path, setPath] = useState([])
  const [won, setWon] = useState(false)
  const [hints, setHints] = useState(0)
  const [hintOn, setHintOn] = useState(false)
  const [revealed, setRevealed] = useState(null)
  const [stats, setStats] = useState(loadStats)
  const [copied, setCopied] = useState(false)
  const confettiRef = useRef(null)
  const lastFx = useRef(-1)
  const recorded = useRef(false)

  const newRound = useCallback((m) => {
    const g = m === 'daily'
      ? makeGame(adj, nodes, mulberry32(hashStr('wce-comp-chain-' + todayKey())), 2, 4)
      : makeGame(adj, nodes, Math.random, 2, 3)
    setGame(g); setPath([g.start]); setWon(false); setHints(0); setHintOn(false); setRevealed(null); setCopied(false)
    recorded.current = false
  }, [adj, nodes])

  useEffect(() => { newRound(mode) }, [mode, newRound])

  const cur = path[path.length - 1]
  const clicks = path.length - 1
  const reachable = won || (game != null && bfs(adj, cur)[game.target] != null)

  const bestNext = useMemo(() => {
    if (!game || won) return null
    let best = null; let bd = Infinity
    for (const v of adj[cur] || []) {
      const dv = bfs(adj, v)[game.target]
      if (dv != null && dv < bd) { bd = dv; best = v }
    }
    return best
  }, [adj, cur, game, won])

  const flawless = won && clicks <= (game?.par ?? 0) && hints === 0
  const shownMoves = useCountUp(clicks, won)

  useEffect(() => {
    if (!won || !game || recorded.current) return
    recorded.current = true
    setStats((prev) => {
      const s = { ...prev, plays: prev.plays + 1, wins: prev.wins + 1, flawless: prev.flawless + (flawless ? 1 : 0) }
      if (mode === 'daily' && !prev.daily[todayKey()]) {
        s.daily = { ...prev.daily, [todayKey()]: { moves: clicks, par: game.par, hints } }
        const y = new Date(); y.setDate(y.getDate() - 1)
        s.streak = prev.lastDaily === y.toLocaleDateString('en-CA') ? prev.streak + 1 : 1
        s.lastDaily = todayKey()
      }
      saveStats(s)
      return s
    })
    winJingle(flawless)
    try { navigator.vibrate?.([35, 45, 35, 45, 150]) } catch { /* no haptics */ }
    if (!reduceMotion && confettiRef.current) {
      const { idx, run: runFx } = pickCelebration(lastFx.current)   // a different celebration every win
      lastFx.current = idx
      return runFx(confettiRef.current)
    }
  }, [won]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!game) return <div className="min-h-[60vh] bg-[#0b0f18]" />

  const hop = (id) => {
    if (won) return
    setPath([...path, id]); setHintOn(false); setRevealed(null)
    if (id === game.target) setWon(true)
  }
  const undo = () => {
    if (path.length < 2 || won) return
    setPath(path.slice(0, -1)); setHintOn(false); setRevealed(null)
  }
  const useHint = () => { if (!hintOn) setHints(hints + 1); setHintOn(true) }
  const reveal = () => {
    if (revealed) return
    const parent = { [cur]: null }
    const q = [cur]; let i = 0; let found = false
    while (i < q.length) {
      const u = q[i++]
      if (u === game.target) { found = true; break }
      for (const v of adj[u] || []) if (!(v in parent)) { parent[v] = u; q.push(v) }
    }
    if (!found) return
    const p = []; let u = game.target
    while (u != null) { p.unshift(u); u = parent[u] }
    setHints(hints + 2)
    setRevealed(p)
  }
  const share = async () => {
    const over = Math.max(0, clicks - game.par)
    const squares = '🟨'.repeat(Math.min(clicks, game.par)) + '⬜'.repeat(over)
    const txt = [
      mode === 'daily' ? `Comp Chain Daily — ${todayLabel()}` : 'Comp Chain',
      `${info[game.start]?.name} → ${info[game.target]?.name}`,
      `${squares} ${clicks}/${game.par}${hints ? ` · ${hints} hint${hints === 1 ? '' : 's'}` : ' · no hints'}${flawless ? ' · FLAWLESS' : ''}`,
      'wcehoops.com/comp-chain',
    ].join('\n')
    try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }

  const dailyDone = mode === 'daily' && stats.daily[todayKey()]
  const verdict = flawless ? 'FLAWLESS — optimal, no hints.'
    : clicks <= game.par ? 'Optimal chain.'
    : clicks <= game.par + 2 ? 'Sharp chain.' : 'Solved.'

  return (
    <div className="relative overflow-hidden bg-[#0b0f18] text-white">
      <style>{`
        @keyframes cc-flash { 0%{opacity:.9} 100%{opacity:0} }
        @keyframes cc-ring { 0%{transform:translate(-50%,-50%) scale(.15);opacity:1} 100%{transform:translate(-50%,-50%) scale(3.6);opacity:0} }
        @keyframes cc-ray { 0%{transform:translate(-50%,-50%) rotate(var(--a)) scaleY(.1);opacity:.95} 100%{transform:translate(-50%,-50%) rotate(var(--a)) scaleY(1);opacity:0} }
        @keyframes cc-pop { 0%{transform:scale(.35) rotate(-16deg);opacity:0} 55%{transform:scale(1.16) rotate(4deg);opacity:1} 100%{transform:scale(1) rotate(0)} }
        @keyframes cc-shake { 0%,100%{transform:translate(0,0)} 12%{transform:translate(-9px,3px) rotate(-.7deg)} 26%{transform:translate(8px,-4px) rotate(.6deg)} 40%{transform:translate(-7px,-2px)} 54%{transform:translate(5px,3px) rotate(.4deg)} 70%{transform:translate(-4px,1px)} 85%{transform:translate(2px,-1px)} }
        @keyframes cc-screenshake { 0%,100%{transform:translate(0,0)} 20%{transform:translate(-5px,3px)} 40%{transform:translate(5px,-4px)} 60%{transform:translate(-4px,-2px)} 80%{transform:translate(3px,2px)} }
        @keyframes cc-crumb { 0%{color:rgba(255,255,255,.45);text-shadow:none} 60%{color:#ffe9bd;text-shadow:0 0 18px rgba(194,162,99,.95)} 100%{color:#c2a263;text-shadow:0 0 8px rgba(194,162,99,.5)} }
        @keyframes cc-stat { 0%{transform:scale(1.35)} 100%{transform:scale(1)} }
        @keyframes cc-glowpulse { 0%,100%{box-shadow:0 0 60px -18px rgba(194,162,99,.55)} 50%{box-shadow:0 0 120px -10px rgba(194,162,99,.95)} }
        @keyframes cc-spin { to{transform:rotate(360deg)} }
        @keyframes cc-holo { 0%{transform:translateX(-160%) skewX(-18deg)} 100%{transform:translateX(220%) skewX(-18deg)} }
        @keyframes cc-glitch {
          0%,100%{clip-path:inset(0 0 0 0);text-shadow:0 0 14px rgba(194,162,99,.7)}
          8%{clip-path:inset(12% 0 62% 0);transform:translateX(-3px);text-shadow:-3px 0 #5b7cab,3px 0 #c2a263}
          16%{clip-path:inset(55% 0 18% 0);transform:translateX(3px);text-shadow:3px 0 #bc3a2c,-3px 0 #c2a263}
          24%{clip-path:inset(0 0 0 0);transform:none}
          62%{clip-path:inset(30% 0 40% 0);transform:translateX(2px);text-shadow:-2px 0 #5b7cab,2px 0 #c2a263}
          70%{clip-path:inset(0 0 0 0);transform:none}
        }
        .cc-stat-pop { animation: cc-stat .28s cubic-bezier(.22,.61,.36,1) }
        @media (prefers-reduced-motion: reduce){ .cc-anim { animation: none !important } }
      `}</style>

      {/* atmosphere */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#c2a263]/10 blur-[120px]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

      {/* win overlays: flash, shockwaves, starburst rays */}
      {won && !reduceMotion && (
        <>
          <div aria-hidden="true" className="cc-anim pointer-events-none fixed inset-0 z-50 bg-[#c2a263]" style={{ animation: 'cc-flash .55s ease-out forwards' }} />
          {[0, 1, 2, 3].map((i) => (
            <div key={`r${i}`} aria-hidden="true" className="cc-anim pointer-events-none fixed left-1/2 top-1/2 z-40 h-64 w-64 rounded-full border-2 border-[#c2a263]"
              style={{ animation: `cc-ring 1.15s ${i * 0.16}s cubic-bezier(.22,.61,.36,1) forwards`, opacity: 0 }} />
          ))}
          {[0, 30, 60, 90, 120, 150].map((a) => (
            <div key={`ray${a}`} aria-hidden="true" className="cc-anim pointer-events-none fixed left-1/2 top-1/2 z-40 h-[130vmax] w-[3px] origin-center bg-gradient-to-b from-transparent via-[#c2a263]/70 to-transparent"
              style={{ '--a': `${a}deg`, animation: `cc-ray .9s .1s ease-out forwards`, opacity: 0 }} />
          ))}
        </>
      )}
      <canvas ref={confettiRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 h-full w-full" />

      <div className="relative mx-auto max-w-5xl px-6 py-14 lg:py-18"
        style={won && !reduceMotion ? { animation: 'cc-screenshake .5s .12s ease' } : undefined}>
        {/* header */}
        <div className="text-center">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.32em] text-[#c2a263]">Basketball Savant · Game</span>
          <h1 className="mt-4 font-mono text-5xl font-bold uppercase tracking-tight text-white sm:text-6xl lg:text-7xl" style={{ textShadow: '0 0 40px rgba(194,162,99,0.35)' }}>
            Comp Chain
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/55">
            Start on one NBA player. Hop through his closest statistical comps and reach the target in as few moves as you can.
          </p>
        </div>

        {/* mode switch + streak */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <div className="flex rounded-lg border border-white/15 bg-black/30 p-1">
            {[['daily', `Daily · ${todayLabel()}`], ['free', 'Free Play']].map(([m, label]) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`rounded-md px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
                  mode === m ? 'bg-[#c2a263] text-[#0b0f18]' : 'text-white/55 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
          {stats.streak > 1 && (
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#c2a263]">🔥 {stats.streak}-day streak</span>
          )}
        </div>
        {mode === 'daily' && (
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            One puzzle · same for everyone · resets at midnight
            {dailyDone && !won ? ` · you solved today's in ${dailyDone.moves} (par ${dailyDone.par})` : ''}
          </p>
        )}

        {/* start -> target */}
        <div className="mx-auto mt-10 flex max-w-3xl items-stretch gap-3 sm:gap-4">
          <EndCard id={game.start} role="Start" info={info} tone="start" />
          <div className="flex flex-col items-center justify-center px-1 text-[#c2a263]">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 12h15m0 0l-6-6m6 6l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <EndCard id={game.target} role="Target" info={info} tone="target" />
        </div>

        {/* scoreboard */}
        <div className="mt-6 flex items-center justify-center gap-3 sm:gap-4">
          <Stat label="Moves" value={won ? shownMoves : clicks} accent pulseKey={clicks} />
          <span className="font-mono text-lg text-white/25">/</span>
          <Stat label="Best possible" value={game.par} />
          <span className="font-mono text-lg text-white/25">/</span>
          <Stat label="Hints" value={hints} pulseKey={hints} />
        </div>

        {/* chain breadcrumb — lights up link by link on a win */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[11px] leading-6">
          {path.map((id, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden="true" className="text-[#c2a263]/70">›</span>}
              <span
                className={`cc-anim ${!won && i === path.length - 1 ? 'font-semibold text-white' : 'text-white/45'}`}
                style={won && !reduceMotion ? { animation: `cc-crumb .5s ${0.3 + i * 0.14}s ease forwards` } : won ? { color: GOLD } : undefined}>
                {info[id]?.name || '?'}
              </span>
            </Fragment>
          ))}
        </div>

        {won ? (
          /* win panel: spinning conic border + holo sweep + pop/shake/glow */
          <div className="cc-anim relative mx-auto mt-10 max-w-2xl overflow-hidden rounded-2xl p-[2px]"
            style={reduceMotion ? undefined : { animation: 'cc-pop .6s .15s cubic-bezier(.22,.61,.36,1) both, cc-shake .5s .8s ease both, cc-glowpulse 2.4s 1.1s ease-in-out infinite' }}>
            <div aria-hidden="true" className="cc-anim absolute left-1/2 top-1/2 h-[300%] w-[300%] -translate-x-1/2 -translate-y-1/2"
              style={{ background: `conic-gradient(from 0deg, transparent 0 40deg, ${GOLD} 70deg, #fff3d6 90deg, ${GOLD} 110deg, transparent 140deg 220deg, ${GOLD}88 260deg, transparent 300deg)`, animation: reduceMotion ? 'none' : 'cc-spin 3.2s linear infinite' }} />
            <div className="relative overflow-hidden rounded-[14px] bg-[#131a28] px-6 py-9 text-center">
              <div aria-hidden="true" className="cc-anim pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent"
                style={reduceMotion ? { display: 'none' } : { animation: 'cc-holo 1.5s .5s ease-in-out 2 both' }} />
              <div className="relative mx-auto h-20 w-20">
                <div aria-hidden="true" className="cc-anim absolute -inset-2 rounded-full border-2 border-dashed border-[#c2a263]/70"
                  style={reduceMotion ? undefined : { animation: 'cc-spin 7s linear infinite' }} />
                <Head id={game.target} className="h-20 w-20 rounded-full bg-white/5 object-cover object-[center_top] ring-2 ring-[#c2a263]" />
              </div>
              <div className="cc-anim mt-4 font-mono text-sm font-bold uppercase tracking-[0.34em] text-[#c2a263]"
                style={reduceMotion ? undefined : { animation: 'cc-glitch 1.8s .4s steps(1) 2' }}>
                {flawless ? '👑 Flawless victory' : '🏆 Chain complete'}
              </div>
              <div className="mt-3 font-mono text-5xl font-bold text-white sm:text-6xl" style={{ textShadow: '0 0 30px rgba(194,162,99,.45)' }}>
                {shownMoves}<span className="text-2xl text-white/50"> {clicks === 1 ? 'move' : 'moves'}</span>
              </div>
              <div className="mt-2 font-mono text-xs text-white/60">
                {verdict} Best possible was {game.par} · {hints === 0 ? 'no hints' : `${hints} hint${hints === 1 ? '' : 's'}`}.
              </div>
              <div className="mt-7 flex flex-wrap justify-center gap-2.5">
                <Btn onClick={share} primary>{copied ? 'Copied!' : 'Share result'}</Btn>
                <Btn onClick={() => newRound(mode === 'daily' ? 'free' : mode)}>{mode === 'daily' ? 'Keep playing (free)' : 'Play again'}</Btn>
              </div>
            </div>
          </div>
        ) : (
          <>
            {!reachable && (
              <p className="mt-8 rounded-lg border border-[#bc3a2c]/40 bg-[#bc3a2c]/10 px-4 py-2.5 text-center font-mono text-[11px] text-[#f0a89f]">
                Dead end — {info[game.target]?.name} can&rsquo;t be reached from here. Undo a move to get back on track.
              </p>
            )}
            <div className="mt-10 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
              At <span className="text-white/80">{info[cur]?.name}</span> — pick a comp to hop to
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(adj[cur] || []).map((id) => {
                const oi = info[id] || { name: '?', team: '—' }
                const comp = (info[cur]?.comps || []).find((c) => c.id === id)
                const isTarget = id === game.target
                const isHint = hintOn && id === bestNext
                return (
                  <button key={id} type="button" onClick={() => hop(id)}
                    className={`group flex items-center gap-2.5 rounded-2xl border bg-white/[0.03] px-3 py-2.5 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.06] ${
                      isHint ? 'border-[#c2a263] ring-2 ring-[#c2a263]/40' : isTarget ? 'border-[#c2a263]/70' : 'border-white/12 hover:border-[#c2a263]/50'}`}
                    style={isHint ? { boxShadow: '0 0 26px -8px rgba(194,162,99,0.55)' } : undefined}>
                    <Head id={id} className="h-10 w-10 shrink-0 rounded-xl bg-white/5 object-cover object-[center_top] ring-1 ring-white/10" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold leading-tight text-white">
                        {oi.name}
                        {isTarget && <span className="ml-1.5 rounded bg-[#c2a263] px-1 py-px align-middle font-mono text-[8px] font-bold tracking-wide text-[#0b0f18]">TARGET</span>}
                      </div>
                      <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-white/45">
                        {oi.team}{comp ? ` · ${comp.score}%` : ''}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-2.5">
              <Btn onClick={useHint}>Hint{hintOn ? ' ✓' : ''}</Btn>
              <Btn onClick={undo} disabled={path.length < 2}>Undo</Btn>
              <Btn onClick={reveal}>Reveal path (+2 hints)</Btn>
              <Btn onClick={() => newRound(mode)}>New game</Btn>
            </div>

            {revealed && (
              <p className="mx-auto mt-6 max-w-2xl rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-center font-mono text-[11px] leading-6 text-white/60">
                <span className="text-[#c2a263]">Shortest path:</span>{' '}
                {revealed.map((id) => info[id]?.name || '?').join(' › ')}{' '}
                <span className="text-white/35">({revealed.length - 1} {revealed.length - 1 === 1 ? 'move' : 'moves'})</span>
              </p>
            )}
          </>
        )}

        {/* lifetime stats */}
        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
          <span>Solved <b className="text-white/70">{stats.wins}</b></span>
          <span>Flawless <b className="text-[#c2a263]">{stats.flawless}</b></span>
          <span>Daily streak <b className="text-white/70">{stats.streak}</b></span>
        </div>
        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
          Similarity from 10 percentile stats · usage · shooting · 3-point shooting · playmaking · rebounding · rim protection
        </p>
      </div>
    </div>
  )
}
