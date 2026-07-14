import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GRAPH from '../data/compChain.json'
import usePageMeta from '../lib/usePageMeta.js'
import { pickCelebration } from '../lib/celebrations.js'
import { useLeaderboard } from '../lib/useLeaderboard.js'

// Comp Chain — standalone game page (its own dark scoreboard look). Hop from a
// random NBA player through his statistical comps (Basketball Savant) to reach the
// target in as few moves as possible. 3 comps per hop; targets drawn from the
// start's reachable set at low par, so every round is solvable and short. Daily
// mode is seeded by the date (same puzzle for everyone) with a shared leaderboard;
// Free Play reshuffles. Two hint tiers, counted. Each win fires a random celebration.

const HEAD = (id) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`
const GOLD = '#c2a263'
const DIMS = [['usg', 'USG'], ['ts', 'TS'], ['tp3', '3P'], ['3par', '3PA'], ['ftr', 'FTr'], ['ast', 'AST'], ['tov', 'TOV'], ['oreb', 'ORB'], ['dreb', 'DRB'], ['blkpct', 'BLK']]

/* ---------- graph ---------- */
function buildMaps() {
  const adj = {}
  const info = {}
  for (const p of GRAPH) {
    adj[p.id] = p.comps.map((c) => c.id)
    info[p.id] = { name: p.name, team: p.team, comps: p.comps, prof: p.prof }
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
const todayLabel = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function makeGame(adj, nodes, rng, parMin, parMax) {
  let start
  let target = null
  let par = 0
  for (let t = 0; t < 400 && target == null; t++) {
    start = nodes[(rng() * nodes.length) | 0]
    const dist = bfs(adj, start)
    const cand = Object.keys(dist).map(Number).filter((id) => id !== start && dist[id] >= parMin && dist[id] <= parMax).sort((a, b) => a - b)
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
      const o = ac.createOscillator(); const g = ac.createGain()
      o.type = 'triangle'; o.frequency.value = f
      const t = t0 + i * 0.085
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.13, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.55)
    })
    setTimeout(() => ac.close(), 1800)
  } catch { /* audio unavailable */ }
}

function useCountUp(target, active, ms = 900) {
  const [n, setN] = useState(active ? 0 : target)
  useEffect(() => {
    if (!active) { setN(target); return }
    let raf
    const t0 = performance.now()
    const tick = (t) => { const k = Math.min(1, (t - t0) / ms); setN(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, active, ms])
  return n
}

/* ---------- presentational ---------- */
function Head({ id, className }) {
  return <img src={HEAD(id)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} className={className} />
}

function Profile({ prof, className }) {
  return (
    <div className={`flex items-end justify-center gap-[3px] ${className || ''}`}>
      {DIMS.map(([k, label]) => {
        const v = prof?.[k]
        return (
          <div key={k} className="flex flex-col items-center gap-0.5">
            <div className="relative h-8 w-[7px] overflow-hidden rounded-sm bg-white/10 sm:w-2">
              {v != null && <div className="absolute inset-x-0 bottom-0 rounded-sm bg-[#c2a263]" style={{ height: `${Math.max(4, v)}%`, opacity: 0.5 + (v / 100) * 0.5 }} />}
            </div>
            <span className="font-mono text-[6.5px] uppercase tracking-tight text-white/40">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function EndCard({ id, role, info, tone, showProfile }) {
  const p = info[id] || { name: '?', team: '—' }
  const ring = tone === 'target' ? 'ring-[#c2a263]/60' : 'ring-white/15'
  const glow = tone === 'target' ? '0 0 34px -6px rgba(194,162,99,0.55)' : 'none'
  return (
    <div className={`flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 ring-1 sm:px-4 sm:py-3 ${ring}`} style={{ boxShadow: glow }}>
      <div className="flex items-center gap-3">
        <Head id={id} className="h-12 w-12 shrink-0 rounded-xl bg-white/5 object-cover object-[center_top] ring-1 ring-white/10 sm:h-14 sm:w-14" />
        <div className="min-w-0">
          <div className={`font-mono text-[9px] font-semibold uppercase tracking-[0.22em] ${tone === 'target' ? 'text-[#c2a263]' : 'text-white/40'}`}>{role}</div>
          <div className="truncate text-base font-semibold leading-tight text-white sm:text-lg">{p.name}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{p.team}</div>
        </div>
      </div>
      {showProfile && <Profile prof={p.prof} className="mt-2.5" />}
    </div>
  )
}

function Stat({ label, value, accent, pulseKey }) {
  return (
    <div key={pulseKey} className="cc-stat-pop flex flex-col items-center rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 sm:px-6 sm:py-3">
      <span className={`font-mono text-2xl font-bold tabular-nums leading-none sm:text-3xl ${accent ? 'text-[#c2a263]' : 'text-white'}`}>{value}</span>
      <span className="mt-1.5 font-mono text-[8px] uppercase tracking-[0.18em] text-white/45 sm:text-[9px] sm:tracking-[0.22em]">{label}</span>
    </div>
  )
}

function Btn({ children, onClick, disabled, primary }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={primary
        ? 'rounded-lg bg-[#c2a263] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-[#0b0f18] transition hover:brightness-110 disabled:opacity-40 sm:px-5'
        : 'rounded-lg border border-white/15 bg-white/[0.03] px-3.5 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-white/70 transition hover:border-[#c2a263]/60 hover:text-white disabled:opacity-30 sm:text-xs'}>
      {children}
    </button>
  )
}

/* ---------- page ---------- */
export default function CompChain() {
  usePageMeta('Comp Chain', 'Hop from one NBA player to another through their statistical comps — a daily game built on Basketball Savant data.')
  const { adj, info, nodes } = useMemo(buildMaps, [])
  const reduceMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])

  const [mode, setMode] = useState('daily')
  const [game, setGame] = useState(null)
  const [path, setPath] = useState([])
  const [won, setWon] = useState(false)
  const [hints, setHints] = useState(0)
  const [profilesOn, setProfilesOn] = useState(false)   // "show stat profiles" hint active this round
  const [stats, setStats] = useState(loadStats)
  const [copied, setCopied] = useState(false)
  // leaderboard
  const [name, setName] = useState(() => { try { return localStorage.getItem('cc_name') || '' } catch { return '' } })
  const [submitted, setSubmitted] = useState(false)
  const [myRank, setMyRank] = useState(0)
  const board = useLeaderboard(true)   // fetches today's board on mount
  const confettiRef = useRef(null)
  const lastFx = useRef(-1)
  const recorded = useRef(false)

  const newRound = useCallback((m) => {
    const g = m === 'daily'
      ? makeGame(adj, nodes, mulberry32(hashStr('wce-comp-chain-' + todayKey())), 2, 4)
      : makeGame(adj, nodes, Math.random, 2, 3)
    setGame(g); setPath([g.start]); setWon(false); setHints(0); setProfilesOn(false); setCopied(false); setSubmitted(false); setMyRank(0)
    recorded.current = false
  }, [adj, nodes])

  useEffect(() => { newRound(mode) }, [mode, newRound])

  const cur = path[path.length - 1]
  const clicks = path.length - 1
  const reachable = won || (game != null && bfs(adj, cur)[game.target] != null)
  const bestNext = useMemo(() => {
    if (!game || won) return null
    let best = null; let bd = Infinity
    for (const v of adj[cur] || []) { const dv = bfs(adj, v)[game.target]; if (dv != null && dv < bd) { bd = dv; best = v } }
    return best
  }, [adj, cur, game, won])
  const flawless = won && clicks <= (game?.par ?? 0) && hints === 0
  const shownMoves = useCountUp(clicks, won)

  /* leaderboard submit */
  const submitScore = useCallback(async () => {
    const nm = name.trim().slice(0, 18) || 'Anonymous'
    try { localStorage.setItem('cc_name', nm) } catch { /* ignore */ }
    const { rank } = await board.submit({ name: nm, moves: clicks, hints })
    setSubmitted(true); setMyRank(rank)
  }, [name, clicks, hints, board])

  /* win side effects */
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
      saveStats(s); return s
    })
    winJingle(flawless)
    try { navigator.vibrate?.([35, 45, 35, 45, 150]) } catch { /* none */ }
    if (mode === 'daily') board.refresh()
    if (!reduceMotion && confettiRef.current) {
      const { idx, run: runFx } = pickCelebration(lastFx.current)
      lastFx.current = idx
      return runFx(confettiRef.current)
    }
  }, [won]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!game) return <div className="min-h-[60vh] bg-[#0b0f18]" />

  const hop = (id) => {
    if (won) return
    setPath([...path, id])
    if (id === game.target) setWon(true)
  }
  const undo = () => { if (path.length < 2 || won) return; setPath(path.slice(0, -1)) }
  const showProfiles = () => { if (!profilesOn) { setHints(hints + 1); setProfilesOn(true) } }
  const autoSolve = () => { if (won || bestNext == null) return; setHints(hints + 2); hop(bestNext) }
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
        @keyframes cc-glitch {0%,100%{clip-path:inset(0 0 0 0);text-shadow:0 0 14px rgba(194,162,99,.7)}8%{clip-path:inset(12% 0 62% 0);transform:translateX(-3px);text-shadow:-3px 0 #5b7cab,3px 0 #c2a263}16%{clip-path:inset(55% 0 18% 0);transform:translateX(3px);text-shadow:3px 0 #bc3a2c,-3px 0 #c2a263}24%{clip-path:inset(0 0 0 0);transform:none}62%{clip-path:inset(30% 0 40% 0);transform:translateX(2px);text-shadow:-2px 0 #5b7cab,2px 0 #c2a263}70%{clip-path:inset(0 0 0 0);transform:none}}
        .cc-stat-pop { animation: cc-stat .28s cubic-bezier(.22,.61,.36,1) }
        @media (prefers-reduced-motion: reduce){ .cc-anim { animation: none !important } }
      `}</style>

      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#c2a263]/10 blur-[120px]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

      {won && !reduceMotion && (
        <>
          <div aria-hidden="true" className="cc-anim pointer-events-none fixed inset-0 z-50 bg-[#c2a263]" style={{ animation: 'cc-flash .55s ease-out forwards' }} />
          {[0, 1, 2, 3].map((i) => (
            <div key={`r${i}`} aria-hidden="true" className="cc-anim pointer-events-none fixed left-1/2 top-1/2 z-40 h-64 w-64 rounded-full border-2 border-[#c2a263]" style={{ animation: `cc-ring 1.15s ${i * 0.16}s cubic-bezier(.22,.61,.36,1) forwards`, opacity: 0 }} />
          ))}
          {[0, 30, 60, 90, 120, 150].map((a) => (
            <div key={`ray${a}`} aria-hidden="true" className="cc-anim pointer-events-none fixed left-1/2 top-1/2 z-40 h-[130vmax] w-[3px] origin-center bg-gradient-to-b from-transparent via-[#c2a263]/70 to-transparent" style={{ '--a': `${a}deg`, animation: 'cc-ray .9s .1s ease-out forwards', opacity: 0 }} />
          ))}
        </>
      )}
      <canvas ref={confettiRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 h-full w-full" />

      <div className="relative mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-14 lg:py-18" style={won && !reduceMotion ? { animation: 'cc-screenshake .5s .12s ease' } : undefined}>
        {/* header */}
        <div className="text-center">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.3em] text-[#c2a263] sm:text-[11px]">Basketball Savant · Game</span>
          <h1 className="mt-3 font-mono text-4xl font-bold uppercase tracking-tight text-white sm:text-6xl lg:text-7xl" style={{ textShadow: '0 0 40px rgba(194,162,99,0.35)' }}>Comp Chain</h1>
        </div>

        {/* how to play */}
        <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 sm:px-5">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c2a263]">How to play</div>
          <ol className="mt-2.5 space-y-1.5 text-[13px] leading-snug text-white/70">
            <li><b className="text-white">1.</b> You&rsquo;re dropped on a <b className="text-white">Start</b> player and given a <b className="text-white">Target</b>.</li>
            <li><b className="text-white">2.</b> Each player shows 3 statistical comps. <b className="text-white">Tap one to hop</b> to that player.</li>
            <li><b className="text-white">3.</b> Keep hopping until you land on the Target — in as <b className="text-white">few moves</b> as possible (beat &ldquo;best possible&rdquo;).</li>
            <li><b className="text-white">4.</b> Stuck? <b className="text-[#c2a263]">Show profiles</b> (+1 hint) reveals each option&rsquo;s stat bars to compare; <b className="text-[#c2a263]">Auto-solve</b> (+2 hints) makes the best move for you. <b>Undo</b> is free.</li>
            <li><b className="text-white">5.</b> <b className="text-white">Daily</b> is the same puzzle for everyone — win it to post your name to the leaderboard.</li>
          </ol>
        </div>

        {/* mode switch + streak */}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <div className="flex rounded-lg border border-white/15 bg-black/30 p-1">
            {[['daily', `Daily · ${todayLabel()}`], ['free', 'Free Play']].map(([m, label]) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition sm:px-4 sm:text-[11px] sm:tracking-[0.14em] ${mode === m ? 'bg-[#c2a263] text-[#0b0f18]' : 'text-white/55 hover:text-white'}`}>{label}</button>
            ))}
          </div>
          {stats.streak > 1 && <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#c2a263]">🔥 {stats.streak}-day streak</span>}
        </div>
        {mode === 'daily' && (
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
            One puzzle · same for everyone · resets at midnight{dailyDone && !won ? ` · you solved today's in ${dailyDone.moves}` : ''}
          </p>
        )}

        {/* start -> target (stacks on mobile) */}
        <div className="mx-auto mt-8 flex max-w-3xl flex-col items-stretch gap-3 sm:flex-row sm:items-stretch">
          <EndCard id={game.start} role="Start" info={info} tone="start" showProfile />
          <div className="flex items-center justify-center text-[#c2a263]">
            <svg className="h-6 w-6 rotate-90 sm:h-7 sm:w-7 sm:rotate-0" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m0 0l-6-6m6 6l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <EndCard id={game.target} role="Target" info={info} tone="target" showProfile />
        </div>
        <p className="mx-auto mt-3 max-w-3xl text-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
          Bars = percentile in 10 stats (USG · TS · 3P · 3PA · FTr · AST · TOV · ORB · DRB · BLK). Steer the chain toward the Target&rsquo;s shape.
        </p>

        {/* scoreboard */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-4">
          <Stat label="Moves" value={won ? shownMoves : clicks} accent pulseKey={clicks} />
          <span className="font-mono text-white/25">/</span>
          <Stat label="Best possible" value={game.par} />
          <span className="font-mono text-white/25">/</span>
          <Stat label="Hints" value={hints} pulseKey={hints} />
        </div>

        {/* chain breadcrumb */}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-2 font-mono text-[11px] leading-6">
          {path.map((id, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden="true" className="text-[#c2a263]/70">›</span>}
              <span className={`cc-anim ${!won && i === path.length - 1 ? 'font-semibold text-white' : 'text-white/45'}`} style={won && !reduceMotion ? { animation: `cc-crumb .5s ${0.3 + i * 0.14}s ease forwards` } : won ? { color: GOLD } : undefined}>{info[id]?.name || '?'}</span>
            </Fragment>
          ))}
        </div>

        {won ? (
          <>
            <div className="cc-anim relative mx-auto mt-9 max-w-2xl overflow-hidden rounded-2xl p-[2px]" style={reduceMotion ? undefined : { animation: 'cc-pop .6s .15s cubic-bezier(.22,.61,.36,1) both, cc-shake .5s .8s ease both, cc-glowpulse 2.4s 1.1s ease-in-out infinite' }}>
              <div aria-hidden="true" className="cc-anim absolute left-1/2 top-1/2 h-[300%] w-[300%] -translate-x-1/2 -translate-y-1/2" style={{ background: `conic-gradient(from 0deg, transparent 0 40deg, ${GOLD} 70deg, #fff3d6 90deg, ${GOLD} 110deg, transparent 140deg 220deg, ${GOLD}88 260deg, transparent 300deg)`, animation: reduceMotion ? 'none' : 'cc-spin 3.2s linear infinite' }} />
              <div className="relative overflow-hidden rounded-[14px] bg-[#131a28] px-5 py-8 text-center sm:px-6 sm:py-9">
                <div aria-hidden="true" className="cc-anim pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent" style={reduceMotion ? { display: 'none' } : { animation: 'cc-holo 1.5s .5s ease-in-out 2 both' }} />
                <div className="relative mx-auto h-20 w-20">
                  <div aria-hidden="true" className="cc-anim absolute -inset-2 rounded-full border-2 border-dashed border-[#c2a263]/70" style={reduceMotion ? undefined : { animation: 'cc-spin 7s linear infinite' }} />
                  <Head id={game.target} className="h-20 w-20 rounded-full bg-white/5 object-cover object-[center_top] ring-2 ring-[#c2a263]" />
                </div>
                <div className="cc-anim mt-4 font-mono text-sm font-bold uppercase tracking-[0.3em] text-[#c2a263] sm:tracking-[0.34em]" style={reduceMotion ? undefined : { animation: 'cc-glitch 1.8s .4s steps(1) 2' }}>{flawless ? '👑 Flawless victory' : '🏆 Chain complete'}</div>
                <div className="mt-3 font-mono text-5xl font-bold text-white sm:text-6xl" style={{ textShadow: '0 0 30px rgba(194,162,99,.45)' }}>{shownMoves}<span className="text-2xl text-white/50"> {clicks === 1 ? 'move' : 'moves'}</span></div>
                <div className="mt-2 font-mono text-xs text-white/60">{verdict} Best possible was {game.par} · {hints === 0 ? 'no hints' : `${hints} hint${hints === 1 ? '' : 's'}`}.</div>
                <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                  <Btn onClick={share} primary>{copied ? 'Copied!' : 'Share result'}</Btn>
                  <Btn onClick={() => newRound(mode === 'daily' ? 'free' : mode)}>{mode === 'daily' ? 'Keep playing (free)' : 'Play again'}</Btn>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {!reachable && (
              <p className="mt-7 rounded-lg border border-[#bc3a2c]/40 bg-[#bc3a2c]/10 px-4 py-2.5 text-center font-mono text-[11px] text-[#f0a89f]">Dead end — {info[game.target]?.name} can&rsquo;t be reached from here. Undo a move to get back on track.</p>
            )}
            <div className="mt-9 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">At <span className="text-white/80">{info[cur]?.name}</span> — tap a comp to hop</div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(adj[cur] || []).map((id) => {
                const oi = info[id] || { name: '?', team: '—' }
                const comp = (info[cur]?.comps || []).find((c) => c.id === id)
                const isTarget = id === game.target
                return (
                  <button key={id} type="button" onClick={() => hop(id)}
                    className={`group flex flex-col gap-2 rounded-2xl border bg-white/[0.03] px-3.5 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.06] ${isTarget ? 'border-[#c2a263]/70' : 'border-white/12 hover:border-[#c2a263]/50'}`}>
                    <div className="flex items-center gap-3">
                      <Head id={id} className="h-11 w-11 shrink-0 rounded-xl bg-white/5 object-cover object-[center_top] ring-1 ring-white/10" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-tight text-white">{oi.name}{isTarget && <span className="ml-1.5 rounded bg-[#c2a263] px-1 py-px align-middle font-mono text-[8px] font-bold tracking-wide text-[#0b0f18]">TARGET</span>}</div>
                        <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-white/45">{oi.team}{comp ? ` · ${comp.score}%` : ''}</div>
                      </div>
                    </div>
                    {profilesOn && <Profile prof={oi.prof} className="mt-1" />}
                  </button>
                )
              })}
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-2.5">
              <Btn onClick={showProfiles} disabled={profilesOn}>{profilesOn ? 'Option profiles shown ✓' : 'Show option profiles (+1)'}</Btn>
              <Btn onClick={autoSolve} disabled={bestNext == null}>Auto-solve hop (+2)</Btn>
              <Btn onClick={undo} disabled={path.length < 2}>Undo</Btn>
              <Btn onClick={() => newRound(mode)}>New game</Btn>
            </div>
            {profilesOn && (
              <p className="mx-auto mt-4 max-w-2xl text-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
                Bars = percentile in each stat. Match an option&rsquo;s shape to the Target&rsquo;s to close in.
              </p>
            )}
          </>
        )}

        {/* daily leaderboard — always visible */}
        {board.status !== 'unconfigured' && (
          <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-[#c2a263]/25 bg-black/40 p-5 sm:p-6" style={{ boxShadow: '0 0 60px -30px rgba(194,162,99,0.5)' }}>
            <div className="flex items-center justify-between">
              <div className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-[#c2a263]">🏆 Daily Leaderboard</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">{todayLabel()}{board.count ? ` · ${board.count} player${board.count === 1 ? '' : 's'}` : ''}</div>
            </div>

            {won && mode === 'daily' && !submitted && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={18} placeholder="Your name" aria-label="Your name for the leaderboard"
                  className="flex-1 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-[#c2a263]/60 focus:outline-none" />
                <Btn onClick={submitScore} primary disabled={board.status === 'loading'}>{board.status === 'loading' ? 'Submitting…' : `Post ${clicks}/${game.par}`}</Btn>
              </div>
            )}
            {submitted && myRank > 0 && <div className="mt-3 font-mono text-xs text-white/75">You&rsquo;re <b className="text-[#c2a263]">#{myRank}</b> of {board.count} today.</div>}
            {!won && mode === 'daily' && !submitted && <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/40">Solve today&rsquo;s daily to post your score.</p>}

            <div className="mt-4">
              {board.status === 'loading' && !board.entries.length && <div className="py-4 text-center font-mono text-[11px] text-white/40">Loading today&rsquo;s standings…</div>}
              {board.status === 'error' && <div className="py-4 text-center font-mono text-[11px] text-[#f0a89f]">Leaderboard unavailable right now.</div>}
              {board.entries.length > 0 && (
                <ol className="space-y-1">
                  {board.entries.map((e, i) => {
                    const mine = submitted && e.name.toLowerCase() === name.trim().toLowerCase()
                    return (
                      <li key={i} className={`flex items-center gap-3 rounded-lg px-3 py-1.5 font-mono text-[12.5px] ${mine ? 'bg-[#c2a263]/15 text-white ring-1 ring-[#c2a263]/40' : 'text-white/70'}`}>
                        <span className={`w-6 shrink-0 text-right ${i < 3 ? 'text-[#c2a263]' : 'text-white/40'}`}>{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{e.name}</span>
                        <span className="shrink-0 tabular-nums text-[#c2a263]">{e.moves}<span className="text-white/40"> mv</span></span>
                        <span className="w-16 shrink-0 text-right tabular-nums text-white/40">{e.hints ? `${e.hints} hint${e.hints === 1 ? '' : 's'}` : 'clean'}</span>
                      </li>
                    )
                  })}
                </ol>
              )}
              {board.status === 'ready' && !board.entries.length && <div className="py-4 text-center font-mono text-[11px] text-white/40">No scores yet today — be the first.</div>}
            </div>
          </div>
        )}

        {/* lifetime stats + footer */}
        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
          <span>Solved <b className="text-white/70">{stats.wins}</b></span>
          <span>Flawless <b className="text-[#c2a263]">{stats.flawless}</b></span>
          <span>Daily streak <b className="text-white/70">{stats.streak}</b></span>
        </div>
        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">Similarity from 10 percentile stats · usage · shooting · 3-point shooting · playmaking · rebounding · rim protection</p>
      </div>
    </div>
  )
}
