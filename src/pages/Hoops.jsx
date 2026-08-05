/* Flap Hoops — solo, or a live race through a whole world with friends.
 *
 * The opponents' balls on screen are not received positions. Each player sends only their
 * flaps ("12:1,45:-1"), and this file replays them through the same deterministic physics the
 * server verifies with. So a ghost runs at full framerate, is pixel-identical to what its
 * owner sees, and a late packet costs nothing: the ghost is re-simulated from its own start,
 * which takes microseconds for a run of a few thousand steps.
 *
 * Ghosts render on a deliberate delay (GHOST_LAG_MS). Without it a flap that arrives after
 * its step has passed makes the ghost visibly jump when it re-simulates. With it the input is
 * almost always already in hand, so the ghost is smooth and merely slightly behind — which,
 * for judging who is ahead in a race, nobody can perceive.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as HP from '../lib/hoopsPhysics.js'

const API = '/api/race'
const UID_KEY = 'wce_hoops_uid'
const NAME_KEY = 'wce_hoops_name'
const BEST_KEY = 'flaphoops.bests'
const GHOST_LAG_MS = 500
const VH = 620

function uid() {
  try {
    let v = localStorage.getItem(UID_KEY)
    if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(UID_KEY, v) }
    return v
  } catch { return Math.random().toString(36).slice(2) }
}
const GHOST_COLORS = ['#6E96A6', '#B08A4A', '#7FA86F', '#A96A8C', '#8C7FC0', '#C08A5A', '#5E9AA8']
const encodeInputs = (a) => a.map((i) => `${i.s}:${i.d}`).join(',')
function parseInputs(str) {
  const out = []
  for (const p of String(str || '').split(',')) {
    if (!p) continue
    const [s, d] = p.split(':')
    const step = Number(s), dir = Number(d)
    if (Number.isInteger(step) && (dir === 1 || dir === -1)) out.push({ s: step, d: dir })
  }
  return out
}
const initials = (n) => (n || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

export default function Hoops() {
  const me = useRef(uid())
  const cvRef = useRef(null)
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' } })
  const [view, setView] = useState('menu')          // menu | solo | party
  const [joinCode, setJoinCode] = useState('')
  const [race, setRace] = useState(null)            // server state while in a party
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [, force] = useState(0)

  /* Everything the render loop touches lives in a ref, not state: the loop runs at 120Hz and
     re-rendering React on every physics step would be absurd. React state is only for the
     things a human actually sees change — screens, rosters, scoreboards. */
  const g = useRef({
    li: 0, st: null, running: false, t0: 0, trail: [], cam: { x: 0, y: 0 },
    scale: 1, vw: 0, vh: VH, dpr: 1, myInputs: [], startAt: 0, skew: 0,
    ghosts: new Map(), sank: false, mode: 'solo',
  })

  // ---------------------------------------------------------------- server
  const call = useCallback(async (action, body = {}, method = 'POST') => {
    const qs = new URLSearchParams({ action, uid: me.current, ...(body.code ? { code: body.code } : {}) })
    const r = await fetch(`${API}?${qs}`, method === 'GET' ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, uid: me.current }),
    })
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('json')) throw new Error('the server sent a page instead of data')
    const j = await r.json().catch(() => null)
    if (!j) throw new Error('unreadable reply')
    if (!r.ok || j.error) throw new Error(j.error || 'request failed')
    return j
  }, [])

  const pushInputs = useCallback((code) => {
    // whole string every time: idempotent, so a retry can never duplicate or interleave flaps
    call('input', { code, inputs: encodeInputs(g.current.myInputs) }).catch(() => {})
  }, [call])

  // ---------------------------------------------------------------- level
  const loadLevel = useCallback((li, mode, startAt) => {
    const c = g.current
    c.li = li; c.mode = mode
    c.st = HP.makeState(li)
    c.trail = []; c.myInputs = []; c.sank = false
    c.startAt = startAt || 0
    c.running = mode === 'solo'
    c.t0 = performance.now()
    c.ghosts = new Map()
    snapCam(true)
  }, [])

  function snapCam(instant) {
    const c = g.current
    if (!c.st) return
    const L = HP.LEVELS[c.li]
    const tx = c.vw >= L.w ? L.w / 2 : Math.max(c.vw / 2, Math.min(L.w - c.vw / 2, c.st.x))
    const ty = c.vh >= L.h ? L.h / 2 : Math.max(c.vh / 2, Math.min(L.h - c.vh / 2, c.st.y))
    if (instant) { c.cam.x = tx; c.cam.y = ty; return }
    c.cam.x += (tx - c.cam.x) * 0.12
    c.cam.y += (ty - c.cam.y) * 0.12
  }

  const resize = useCallback(() => {
    const cv = cvRef.current
    if (!cv || !cv.parentElement) return
    const c = g.current
    const r = cv.parentElement.getBoundingClientRect()
    c.dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.width = Math.round(r.width * c.dpr); cv.height = Math.round(r.height * c.dpr)
    c.scale = (r.height * c.dpr) / VH
    c.vw = cv.width / c.scale; c.vh = VH
    snapCam(true)
  }, [])

  // ---------------------------------------------------------------- input
  const doFlap = useCallback((dir) => {
    const c = g.current
    if (!c.st || c.sank) return
    if (c.mode === 'race') {
      if (!c.startAt) return
      const nowMs = Date.now() + c.skew
      if (nowMs < c.startAt) return                 // still in the countdown
      const step = Math.floor(((nowMs - c.startAt) / 1000) / HP.DT)
      c.myInputs.push({ s: step, d: dir })
      if (race?.code) pushInputs(race.code)
    } else {
      if (!c.running) return
      HP.flap(c.st, HP.DEFAULTS, dir)
    }
  }, [race?.code, pushInputs])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') { e.preventDefault(); doFlap(-1) }
      if (e.key === 'ArrowRight' || e.key === 'd') { e.preventDefault(); doFlap(1) }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', resize) }
  }, [doFlap, resize])

  // ---------------------------------------------------------------- party polling
  useEffect(() => {
    if (view !== 'party' || !race?.code) return undefined
    let alive = true
    const tick = async () => {
      try {
        const j = await call('state', { code: race.code }, 'GET')
        if (!alive) return
        const c = g.current
        c.skew = j.now - Date.now()
        setRace(j)
        if (j.status === 'running' && j.levelIndex != null
            && (c.li !== j.levelIndex || c.mode !== 'race' || c.startAt !== j.startAt)) {
          loadLevel(j.levelIndex, 'race', j.startAt)
        }
        if (j.status === 'running') {
          const gh = new Map()
          for (const [u, s] of Object.entries(j.inputs || {})) {
            if (u === me.current) continue
            gh.set(u, { inputs: parseInputs(s), name: j.roster[u] })
          }
          c.ghosts = gh
        }
      } catch { /* transient; the next tick retries */ }
    }
    tick()
    const t = setInterval(tick, race.status === 'running' ? 600 : 1500)
    return () => { alive = false; clearInterval(t) }
  }, [view, race?.code, race?.status, call, loadLevel])

  // ---------------------------------------------------------------- the loop
  useEffect(() => {
    let raf = 0, acc = 0, last = 0
    const cv = cvRef.current
    if (!cv) return undefined
    const ctx = cv.getContext('2d')
    resize()

    const ghostStateAt = (inputs, li, step) => {
      // Re-simulate from scratch. A run is a few thousand steps, so this is cheap, and it
      // means a late-arriving flap corrects the ghost instead of desyncing it forever.
      const st = HP.makeState(li)
      const at = new Map()
      for (const i of inputs) { if (!at.has(i.s)) at.set(i.s, []); at.get(i.s).push(i.d) }
      for (let s = 0; s < step && !st.sank; s++) {
        const fl = at.get(s)
        if (fl) for (const d of fl) HP.flap(st, HP.DEFAULTS, d)
        HP.step(st, HP.DEFAULTS)
      }
      return st
    }

    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const c = g.current
      if (!c.st) return
      if (!last) last = now
      acc += Math.min((now - last) / 1000, 0.25); last = now

      if (c.mode === 'race' && c.startAt) {
        // In a race the clock is authoritative: catch the simulation up to the step the
        // shared start time says we are on, so every device agrees on the world.
        const nowMs = Date.now() + c.skew
        const target = Math.max(0, Math.floor(((nowMs - c.startAt) / 1000) / HP.DT))
        const at = new Map()
        for (const i of c.myInputs) { if (!at.has(i.s)) at.set(i.s, []); at.get(i.s).push(i.d) }
        let guard = 0
        while (c.st.t < target && !c.st.sank && guard++ < 5000) {
          const fl = at.get(c.st.t)
          if (fl) for (const d of fl) HP.flap(c.st, HP.DEFAULTS, d)
          HP.step(c.st, HP.DEFAULTS)
          c.trail.push({ x: c.st.x, y: c.st.y }); if (c.trail.length > 90) c.trail.shift()
        }
        if (c.st.sank && !c.sank) {
          c.sank = true
          call('finish', { code: race.code, inputs: encodeInputs(c.myInputs) }).catch(() => {})
        }
      } else if (c.running && !c.st.sank) {
        while (acc >= HP.DT) {
          HP.step(c.st, HP.DEFAULTS)
          c.trail.push({ x: c.st.x, y: c.st.y }); if (c.trail.length > 90) c.trail.shift()
          acc -= HP.DT
          if (c.st.sank) break
        }
        if (c.st.sank && !c.sank) { c.sank = true; c.running = false; recordBest(); force((n) => n + 1) }
      }
      acc = 0
      snapCam(false)
      draw(ctx)
    }

    const recordBest = () => {
      const c = g.current, L = HP.LEVELS[c.li]
      const secs = (performance.now() - c.t0) / 1000
      try {
        const all = JSON.parse(localStorage.getItem(BEST_KEY) || '{}')
        const k = L.world + '/' + L.name
        if (!all[k] || c.st.flaps < all[k].f) { all[k] = { f: c.st.flaps, s: Number(secs.toFixed(1)) } }
        localStorage.setItem(BEST_KEY, JSON.stringify(all))
      } catch { /* private mode */ }
    }

    const draw = (ctx2) => {
      const c = g.current
      const L = HP.LEVELS[c.li], h = HP.hoopOf(c.li), segs = HP.segsOf(c.li)
      const pal = (HP.WORLDS[L.world] || HP.WORLDS.house).pal
      const cv2 = cvRef.current
      ctx2.setTransform(1, 0, 0, 1, 0, 0)
      ctx2.fillStyle = '#0E0906'; ctx2.fillRect(0, 0, cv2.width, cv2.height)
      ctx2.setTransform(c.scale, 0, 0, c.scale, cv2.width / 2 - c.cam.x * c.scale, cv2.height / 2 - c.cam.y * c.scale)

      const grad = ctx2.createLinearGradient(0, 0, 0, L.h)
      grad.addColorStop(0, pal.bg1); grad.addColorStop(1, pal.bg2)
      ctx2.fillStyle = grad; ctx2.fillRect(0, 0, L.w, L.h)
      ctx2.strokeStyle = pal.grain; ctx2.lineWidth = 1
      for (let x = 0; x < L.w; x += 26) { ctx2.beginPath(); ctx2.moveTo(x, 0); ctx2.lineTo(x, L.h); ctx2.stroke() }

      drawZones(ctx2, L, pal, c.st.t)

      ctx2.lineCap = 'round'
      ctx2.strokeStyle = pal.wall; ctx2.lineWidth = 8
      for (const s of segs) { ctx2.beginPath(); ctx2.moveTo(s[0], s[1]); ctx2.lineTo(s[2], s[3]); ctx2.stroke() }
      ctx2.strokeStyle = pal.edge; ctx2.lineWidth = 2
      for (const s of segs) { ctx2.beginPath(); ctx2.moveTo(s[0], s[1]); ctx2.lineTo(s[2], s[3]); ctx2.stroke() }

      ctx2.save(); ctx2.globalAlpha = 0.2; ctx2.fillStyle = pal.glass
      ctx2.fillRect(h.rx + 4, h.y - 96, 9, 92); ctx2.restore()
      ctx2.strokeStyle = pal.glass; ctx2.lineWidth = 2
      ctx2.strokeRect(h.rx + 4, h.y - 96, 9, 92)
      ctx2.strokeStyle = 'rgba(242,237,228,.45)'; ctx2.lineWidth = 1.2
      for (let i = 0; i <= 6; i++) {
        const px = h.lx + (i / 6) * (HP.RIM_HALF * 2)
        ctx2.beginPath(); ctx2.moveTo(px, h.y); ctx2.lineTo(h.x + (px - h.x) * 0.42, h.y + 34); ctx2.stroke()
      }
      ctx2.strokeStyle = c.st.sank ? '#6FB07A' : pal.rim; ctx2.lineWidth = HP.RIM_R * 2
      ctx2.beginPath(); ctx2.moveTo(h.lx, h.y); ctx2.lineTo(h.rx, h.y); ctx2.stroke()

      // ghosts, on a delay so their inputs have arrived by the time they are needed
      if (c.mode === 'race' && c.startAt) {
        const nowMs = Date.now() + c.skew - GHOST_LAG_MS
        const gstep = Math.max(0, Math.floor(((nowMs - c.startAt) / 1000) / HP.DT))
        let gi = 0
        for (const gh of c.ghosts.values()) {
          const col = GHOST_COLORS[gi++ % GHOST_COLORS.length]
          const gs = ghostStateAt(gh.inputs, c.li, gstep)
          ctx2.globalAlpha = gs.sank ? 0.35 : 0.72
          ctx2.fillStyle = col
          ctx2.beginPath(); ctx2.arc(gs.x, gs.y, HP.RB, 0, 7); ctx2.fill()
          ctx2.globalAlpha = 1
          ctx2.fillStyle = 'rgba(255,255,255,.9)'
          ctx2.font = '600 13px ui-monospace, monospace'
          ctx2.textAlign = 'center'
          ctx2.fillText(initials(gh.name), gs.x, gs.y - HP.RB - 7)
        }
        ctx2.textAlign = 'start'
      }

      if (c.trail.length > 1) {
        ctx2.strokeStyle = 'rgba(217,98,43,.30)'; ctx2.lineWidth = 2
        ctx2.beginPath(); ctx2.moveTo(c.trail[0].x, c.trail[0].y)
        for (const p of c.trail) ctx2.lineTo(p.x, p.y)
        ctx2.stroke()
      }

      ctx2.save(); ctx2.translate(c.st.x, c.st.y); ctx2.rotate(c.st.rot)
      const bg = ctx2.createRadialGradient(-5, -6, 2, 0, 0, HP.RB)
      bg.addColorStop(0, '#F0803F'); bg.addColorStop(1, '#A8441B')
      ctx2.fillStyle = bg; ctx2.beginPath(); ctx2.arc(0, 0, HP.RB, 0, 7); ctx2.fill()
      ctx2.strokeStyle = 'rgba(40,16,6,.8)'; ctx2.lineWidth = 1.6
      ctx2.beginPath(); ctx2.moveTo(-HP.RB, 0); ctx2.lineTo(HP.RB, 0); ctx2.stroke()
      ctx2.beginPath(); ctx2.moveTo(0, -HP.RB); ctx2.lineTo(0, HP.RB); ctx2.stroke()
      ctx2.beginPath(); ctx2.arc(0, 0, HP.RB, 0, 7); ctx2.stroke()
      ctx2.restore()

      // off-screen hoop pointer
      const dx = h.x - c.cam.x, dy = h.y - c.cam.y
      if (Math.abs(dx) > c.vw / 2 - 40 || Math.abs(dy) > c.vh / 2 - 40) {
        ctx2.setTransform(1, 0, 0, 1, 0, 0)
        const cxs = cv2.width / 2, cys = cv2.height / 2, m = 34 * c.dpr, ang = Math.atan2(dy, dx)
        const rx = Math.abs(Math.cos(ang)) > 1e-3 ? Math.abs((cxs - m) / Math.cos(ang)) : Infinity
        const ry = Math.abs(Math.sin(ang)) > 1e-3 ? Math.abs((cys - m) / Math.sin(ang)) : Infinity
        const rr = Math.min(cxs - m, cys - m, rx, ry)
        ctx2.save(); ctx2.translate(cxs + Math.cos(ang) * rr, cys + Math.sin(ang) * rr); ctx2.rotate(ang)
        ctx2.fillStyle = 'rgba(194,74,36,.9)'
        ctx2.beginPath(); ctx2.moveTo(13 * c.dpr, 0); ctx2.lineTo(-9 * c.dpr, 8 * c.dpr); ctx2.lineTo(-9 * c.dpr, -8 * c.dpr)
        ctx2.closePath(); ctx2.fill(); ctx2.restore()
      }
    }

    const drawZones = (ctx2, L, pal, t) => {
      if (!L.zones) return
      for (const z of L.zones) {
        if (z.t === 'gush') {
          const gg = ctx2.createLinearGradient(0, z.y + z.h, 0, z.y)
          gg.addColorStop(0, 'rgba(184,196,202,.02)'); gg.addColorStop(1, 'rgba(184,196,202,.20)')
          ctx2.fillStyle = gg; ctx2.fillRect(z.x, z.y, z.w, z.h)
          ctx2.strokeStyle = pal.accent; ctx2.lineWidth = 4
          ctx2.beginPath(); ctx2.moveTo(z.x, z.y + z.h); ctx2.lineTo(z.x + z.w / 2, z.y + z.h - 46)
          ctx2.lineTo(z.x + z.w, z.y + z.h); ctx2.stroke()
        } else if (z.t === 'lasso') {
          ctx2.strokeStyle = 'rgba(184,196,202,.22)'; ctx2.lineWidth = 1.5
          ctx2.setLineDash([7, 9]); ctx2.beginPath(); ctx2.arc(z.x, z.y, z.r, 0, 7); ctx2.stroke()
          ctx2.setLineDash([])
          ctx2.fillStyle = pal.accent; ctx2.beginPath(); ctx2.arc(z.x, z.y, 9, 0, 7); ctx2.fill()
        } else if (z.t === 'weed') {
          const w = HP.weedAt(z, t)
          ctx2.strokeStyle = 'rgba(214,198,160,.85)'; ctx2.lineWidth = 2
          ctx2.beginPath(); ctx2.arc(w.x, w.y, z.r, 0, 7); ctx2.stroke()
        } else if (z.t === 'cannon') {
          ctx2.fillStyle = pal.accent; ctx2.fillRect(z.x - 12, z.y - 14, 24, 28)
          const sh = HP.shotAt(z, t)
          ctx2.fillStyle = pal.rim; ctx2.beginPath(); ctx2.arc(sh.x, sh.y, 13, 0, 7); ctx2.fill()
        } else if (z.t === 'stepback') {
          const gone = (g.current.st.broke & (1 << (z.id & 30))) !== 0
          ctx2.strokeStyle = gone ? 'rgba(184,196,202,.16)' : pal.accent
          ctx2.setLineDash(gone ? [6, 8] : []); ctx2.lineWidth = gone ? 2 : 7; ctx2.lineCap = 'round'
          ctx2.beginPath(); ctx2.moveTo(z.x - z.w / 2, z.y); ctx2.lineTo(z.x + z.w / 2, z.y); ctx2.stroke()
          ctx2.setLineDash([])
        } else if (z.t === 'bronco') {
          ctx2.save(); ctx2.translate(z.x, z.y)
          ctx2.fillStyle = pal.rim
          ctx2.beginPath(); ctx2.moveTo(-44, 30); ctx2.lineTo(44, 30); ctx2.lineTo(34, 6); ctx2.lineTo(-34, 6)
          ctx2.closePath(); ctx2.fill()
          ctx2.strokeStyle = pal.accent; ctx2.lineWidth = 3
          ctx2.beginPath(); ctx2.moveTo(0, 4); ctx2.lineTo(z.dx * 54, z.dy * 54); ctx2.stroke()
          ctx2.restore()
        }
      }
    }

    loadLevel(g.current.li, g.current.mode, g.current.startAt)
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [resize, loadLevel, call, race?.code])

  // ---------------------------------------------------------------- actions
  const saveName = (v) => { setName(v); try { localStorage.setItem(NAME_KEY, v) } catch { /* ignore */ } }
  const createParty = async () => {
    setBusy(true); setErr(null)
    try { const j = await call('create', { name, world: 'dallas' }); setRace(await call('state', { code: j.code }, 'GET')); setView('party') }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const joinParty = async () => {
    const c = joinCode.trim().toUpperCase()
    if (c.length !== 4) { setErr('Party codes are four characters.'); return }
    setBusy(true); setErr(null)
    try { setRace(await call('join', { code: c, name })); setView('party') }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const startMatch = async () => {
    setBusy(true); setErr(null)
    try { setRace(await call('start', { code: race.code })) } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const nextHole = async () => {
    setBusy(true); setErr(null)
    try { setRace(await call('next', { code: race.code })) } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const c = g.current
  const level = HP.LEVELS[c.li] || HP.LEVELS[0]
  const world = HP.WORLDS[level.world] || HP.WORLDS.house
  const counting = c.mode === 'race' && c.startAt && (Date.now() + c.skew) < c.startAt
  const countdown = counting ? Math.ceil((c.startAt - (Date.now() + c.skew)) / 1000) : 0

  /* Portalled to <body>. Every route on this site is wrapped in .route-fade, whose entrance
     animation uses a transform with fill-mode: both — so the wrapper keeps a transform
     forever, and a transformed ancestor becomes the containing block for position: fixed
     descendants. Left inside it, this full-screen game gets sized against a zero-height
     wrapper instead of the viewport. */
  return createPortal((
    <div className="hoops">
      <div className="hoops-hud">
        <span className="hh-title">Flap&nbsp;Hoops</span>
        <div className="hh-grp"><span className="hh-k">World</span><span className="hh-v">{world.name}</span></div>
        <div className="hh-grp"><span className="hh-k">Hole</span><span className="hh-v">{level.name}</span></div>
        <div className="hh-grp"><span className="hh-k">Flaps</span><span className="hh-v">{c.st ? c.st.flaps : 0}</span></div>
        <div className="hh-grp"><span className="hh-k">Par</span><span className="hh-v">{level.par}</span></div>
        <span className="hh-sp" />
        {race && <span className="hh-code">{race.code}</span>}
        <button type="button" className="hh-btn" onClick={() => { setView('menu'); setRace(null) }}>Menu</button>
      </div>

      <div className="hoops-stage">
        <canvas
          ref={cvRef}
          onPointerDown={(e) => {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            doFlap(e.clientX - r.left < r.width / 2 ? -1 : 1)
          }}
        />

        {view === 'menu' && (
          <div className="hoops-card">
            <h1>Flap it in the <em>hoop</em></h1>
            <p>Tap the left or right side of the court to flap that way. Fewest flaps wins —
               or race the whole world against your friends.</p>
            <input className="hoops-input" value={name} maxLength={18} placeholder="Your name"
              onChange={(e) => saveName(e.target.value)} />
            <div className="hoops-actions">
              <button type="button" className="hoops-go" disabled={busy} onClick={createParty}>
                {busy ? 'Opening…' : 'Start a party'}
              </button>
              <input className="hoops-input code" value={joinCode} maxLength={4} placeholder="CODE"
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
              <button type="button" className="hoops-ghost" disabled={busy} onClick={joinParty}>Join</button>
            </div>
            <button type="button" className="hoops-ghost"
              onClick={() => { g.current.mode = 'solo'; loadLevel(0, 'solo', 0); setView('solo') }}>
              Play on my own
            </button>
            {err && <p className="hoops-err">{err}</p>}
          </div>
        )}

        {counting && (
          <div className="hoops-count"><span>{countdown || 'GO'}</span></div>
        )}

        {view === 'party' && race?.status === 'lobby' && (
          <div className="hoops-card">
            <h1>Party <em>{race.code}</em></h1>
            <p>Share the code. You&rsquo;ll play all {race.holeCount} holes of {HP.WORLDS[race.world]?.name}.
               First to sink each hole takes 10 points, then 6, 4, 3, 2, 1. Most points after the
               last hole wins.</p>
            <div className="hoops-roster">
              {Object.entries(race.roster).map(([u, n]) => (
                <span key={u} className="hoops-chip">{n}{u === me.current ? ' (you)' : ''}</span>
              ))}
            </div>
            {race.host
              ? <button type="button" className="hoops-go" disabled={busy || Object.keys(race.roster).length < 2}
                  onClick={startMatch}>
                  {Object.keys(race.roster).length < 2 ? 'Waiting for one more' : 'Tip off'}
                </button>
              : <p className="hoops-wait">Waiting for the host to start.</p>}
            {err && <p className="hoops-err">{err}</p>}
          </div>
        )}

        {view === 'party' && race?.status === 'hole-done' && race.table && (
          <div className="hoops-card">
            <h1>Hole {race.hole + 1} <em>done</em></h1>
            <table className="hoops-table">
              <tbody>
                {race.table.slice().sort((a, b) => (a.place ?? 99) - (b.place ?? 99)).map((r) => (
                  <tr key={r.uid} className={r.uid === me.current ? 'mine' : ''}>
                    <td>{r.place ? `${r.place}.` : '—'}</td>
                    <td>{race.roster[r.uid]}</td>
                    <td>{r.steps ? `${(r.steps / 120).toFixed(1)}s` : 'did not sink'}</td>
                    <td>+{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hoops-standings">
              {race.standings.map((s) => (
                <span key={s.uid} className="hoops-chip">{s.name} {s.points}</span>
              ))}
            </div>
            {race.host
              ? <button type="button" className="hoops-go" disabled={busy} onClick={nextHole}>
                  {race.hole + 1 >= race.holeCount ? 'Final standings' : 'Next hole'}
                </button>
              : <p className="hoops-wait">Waiting for the host.</p>}
          </div>
        )}

        {view === 'party' && race?.status === 'finished' && (
          <div className="hoops-card hoops-winner">
            <div className="hoops-confetti" aria-hidden="true">
              {Array.from({ length: 26 }, (_, i) => <i key={i} style={{ '--i': i }} />)}
            </div>
            <span className="hoops-kicker">{HP.WORLDS[race.world]?.name} champion</span>
            <h1 className="hoops-champ">{race.winner?.name}</h1>
            <p>{race.winner?.points} points across {race.holeCount} holes.</p>
            <div className="hoops-standings">
              {race.standings.map((s, i) => (
                <span key={s.uid} className="hoops-chip">{i + 1}. {s.name} {s.points}</span>
              ))}
            </div>
            <button type="button" className="hoops-ghost" onClick={() => { setView('menu'); setRace(null) }}>
              Back to the menu
            </button>
          </div>
        )}

        {view === 'solo' && c.sank && (
          <div className="hoops-card">
            <h1>{c.st.flaps <= level.par ? 'Nothing but net' : 'Bucket'}</h1>
            <p>{c.st.flaps} flaps. Par is {level.par}.</p>
            <button type="button" className="hoops-go"
              onClick={() => { const n = (c.li + 1) % HP.LEVELS.length; loadLevel(n, 'solo', 0); force((x) => x + 1) }}>
              Next hole
            </button>
          </div>
        )}
      </div>
    </div>
  ), document.body)
}