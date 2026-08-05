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
import * as SHOP from '../lib/hoopsShop.js'

const API = '/api/race'
const UID_KEY = 'wce_hoops_uid'
const NAME_KEY = 'wce_hoops_name'
const BEST_KEY = 'flaphoops.bests'
const GHOST_LAG_MS = 500
const VH = 620
/* The opening shot. You cannot plan a route to a hoop you have not seen, and every hole here
   starts with the hoop off screen — so hold on it, pan to the ball, then count down. These
   sum to the server's lead-in; the client reads that from the payload so the two cannot drift. */
const REVEAL_MS = 1000
const PAN_MS = 1200
const COUNT_MS = 3000

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
  const [picking, setPicking] = useState(null)   // null | 'worlds' | a world key
  const [wallet, setWallet] = useState(() => SHOP.loadWallet())
  const [shopOpen, setShopOpen] = useState(false)
  const [teaser, setTeaser] = useState(null)     // world key whose intro card is showing
  const [earned, setEarned] = useState(0)
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
    c.P = HP.paramsFor(li, HP.DEFAULTS)   // world physics, resolved once per hole
    c.skin = SHOP.itemById(SHOP.loadWallet().ball)
    c.trailStyle = SHOP.itemById(SHOP.loadWallet().trail)
    c.st = HP.makeState(li)
    c.trail = []; c.myInputs = []; c.sank = false
    c.startAt = startAt || 0
    // Solo has no server clock, so its opening runs on a local timer. Play begins when the
    // pan lands, not before — otherwise gravity is already working while you are still
    // being shown the hoop.
    c.introUntil = mode === 'solo' ? performance.now() + REVEAL_MS + PAN_MS : 0
    c.running = false
    c.t0 = performance.now()
    c.ghosts = new Map()
    snapCam(true)
  }, [])

  // Where the camera is allowed to sit: a level smaller than the viewport centres instead of
  // clamping, or it sticks to a corner with dead space on one side.
  function clampCam(x, y) {
    const c = g.current, L = HP.LEVELS[c.li]
    return {
      x: c.vw >= L.w ? L.w / 2 : Math.max(c.vw / 2, Math.min(L.w - c.vw / 2, x)),
      y: c.vh >= L.h ? L.h / 2 : Math.max(c.vh / 2, Math.min(L.h - c.vh / 2, y)),
    }
  }
  function snapCam(instant) {
    const c = g.current
    if (!c.st) return
    const t = clampCam(c.st.x, c.st.y)
    if (instant) { c.cam.x = t.x; c.cam.y = t.y; return }
    c.cam.x += (t.x - c.cam.x) * 0.12
    c.cam.y += (t.y - c.cam.y) * 0.12
  }
  /* Which beat of the opening we are on. Returns null once play has started. */
  function introPhase() {
    const c = g.current
    if (c.mode === 'race') {
      if (!c.startAt) return null
      const left = c.startAt - (Date.now() + c.skew)
      if (left <= 0) return null
      if (left > COUNT_MS + PAN_MS) return { phase: 'reveal' }
      if (left > COUNT_MS) return { phase: 'pan', k: 1 - (left - COUNT_MS) / PAN_MS }
      return { phase: 'count', n: Math.ceil(left / 1000) }
    }
    if (!c.introUntil) return null
    const left = c.introUntil - performance.now()
    if (left <= 0) { c.introUntil = 0; c.running = true; return null }
    if (left > PAN_MS) return { phase: 'reveal' }
    return { phase: 'pan', k: 1 - left / PAN_MS }
  }
  function runIntroCamera(intro) {
    const c = g.current, h = HP.hoopOf(c.li)
    if (intro.phase === 'reveal') { const t = clampCam(h.x, h.y); c.cam.x = t.x; c.cam.y = t.y; return }
    if (intro.phase === 'pan') {
      const e = intro.k < 0.5 ? 2 * intro.k * intro.k : 1 - Math.pow(-2 * intro.k + 2, 2) / 2  // ease in-out
      const a = clampCam(h.x, h.y), b = clampCam(c.st.x, c.st.y)
      c.cam.x = a.x + (b.x - a.x) * e
      c.cam.y = a.y + (b.y - a.y) * e
      return
    }
    const t = clampCam(c.st.x, c.st.y); c.cam.x = t.x; c.cam.y = t.y
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
      HP.flap(c.st, c.P, dir)
    }
    // The count lives in a ref so the 120Hz loop never re-renders React. That means nothing
    // repaints the HUD on its own, and the flap counter sat on 0 all game. A flap is a human
    // action a few times a second, so nudging a render here costs nothing.
    force((n) => n + 1)
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
          // only on the opening hole: after that everyone knows where they are
          if (j.hole === 0) setTeaser(j.world)
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
      const P = HP.paramsFor(li, HP.DEFAULTS)
      // Re-simulate from scratch. A run is a few thousand steps, so this is cheap, and it
      // means a late-arriving flap corrects the ghost instead of desyncing it forever.
      const st = HP.makeState(li)
      const at = new Map()
      for (const i of inputs) { if (!at.has(i.s)) at.set(i.s, []); at.get(i.s).push(i.d) }
      for (let s = 0; s < step && !st.sank; s++) {
        const fl = at.get(s)
        if (fl) for (const d of fl) HP.flap(st, P, d)
        HP.step(st, P)
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
          if (fl) for (const d of fl) HP.flap(c.st, c.P, d)
          HP.step(c.st, c.P)
          c.trail.push({ x: c.st.x, y: c.st.y }); if (c.trail.length > 90) c.trail.shift()
        }
        if (c.st.sank && !c.sank) {
          c.sank = true
          call('finish', { code: race.code, inputs: encodeInputs(c.myInputs) }).catch(() => {})
        }
      } else if (c.running && !c.st.sank && !c.introUntil) {
        while (acc >= HP.DT) {
          HP.step(c.st, c.P)
          c.trail.push({ x: c.st.x, y: c.st.y }); if (c.trail.length > 90) c.trail.shift()
          acc -= HP.DT
          if (c.st.sank) break
        }
        if (c.st.sank && !c.sank) {
          c.sank = true; c.running = false; recordBest()
          const L = HP.LEVELS[c.li]
          const got = SHOP.coinsForHole(L.par, c.st.flaps, true)
          setEarned(got); setWallet((w) => SHOP.award(w, got))
          force((n) => n + 1)
        }
      }
      acc = 0
      const intro = introPhase()
      if (intro) runIntroCamera(intro); else snapCam(false)
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

    /* Backdrop. Drawn in SCREEN space with the camera applied as a fraction, which is what
       makes it read as distance: the far ridge barely moves, the near haze drifts, the court
       tracks you exactly. Doing it in world space instead would nail the sky to the floor and
       the whole thing would look like wallpaper. */
    const drawAir = (ctx2, world, cv2) => {
      const c = g.current, w = HP.WORLDS[world] || HP.WORLDS.house, air = w.air, pal = w.pal
      const W = cv2.width, H = cv2.height, k = c.dpr
      const sky = ctx2.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, air.sky[0]); sky.addColorStop(1, air.sky[1])
      ctx2.fillStyle = sky; ctx2.fillRect(0, 0, W, H)

      if (air.stars) {
        // fixed pseudo-random field: seeded by index, so the sky does not shimmer each frame
        ctx2.fillStyle = 'rgba(255,255,255,.5)'
        for (let i = 0; i < 90; i++) {
          const sx = ((i * 9301 + 49297) % 233280) / 233280
          const sy = ((i * 4021 + 12987) % 233280) / 233280
          const px = (sx * W * 1.4 - c.cam.x * 0.06 * c.scale) % W
          ctx2.globalAlpha = 0.25 + ((i % 5) / 8)
          ctx2.fillRect((px + W) % W, sy * H * 0.55, 1.6 * k, 1.6 * k)
        }
        ctx2.globalAlpha = 1
      }

      const px = (mul) => -c.cam.x * mul * c.scale
      const py = (mul) => -c.cam.y * mul * c.scale

      if (air.ridge === 'mountains') {
        // two ranges at different depths; the near one is darker and moves more
        for (const [mul, base, col] of [[0.10, 0.66, '#161D42'], [0.20, 0.80, '#0A0E28']]) {
          ctx2.fillStyle = col
          ctx2.beginPath(); ctx2.moveTo(0, H)
          const off = px(mul) % (W / 2)
          for (let i = -1; i <= 6; i++) {
            const bx = off + (i * W) / 4
            ctx2.lineTo(bx, H * base)
            ctx2.lineTo(bx + W / 8, H * (base - 0.22 - (i % 2) * 0.07))
            ctx2.lineTo(bx + W / 4, H * base)
          }
          ctx2.lineTo(W, H); ctx2.closePath(); ctx2.fill()
          // snow caps on the near range
          if (mul > 0.15) {
            ctx2.fillStyle = 'rgba(226,232,248,.5)'
            for (let i = -1; i <= 6; i++) {
              const bx = off + (i * W) / 4 + W / 8
              const ty = H * (base - 0.22 - (i % 2) * 0.07)
              ctx2.beginPath(); ctx2.moveTo(bx, ty)
              ctx2.lineTo(bx - W / 46, ty + H * 0.045); ctx2.lineTo(bx + W / 46, ty + H * 0.045)
              ctx2.closePath(); ctx2.fill()
            }
            ctx2.fillStyle = col
          }
        }
      } else if (air.ridge === 'skyline') {
        ctx2.fillStyle = '#0E1E36'
        const off = px(0.14) % (W / 3)
        for (let i = -1; i <= 9; i++) {
          const bx = off + (i * W) / 6, bw = W / 14 + (i % 3) * (W / 40)
          const bh = H * (0.16 + ((i * 37) % 11) / 44)
          ctx2.fillRect(bx, H * 0.74 - bh, bw, bh + H * 0.3)
          ctx2.fillStyle = 'rgba(207,224,234,.16)'
          for (let wy = 0; wy < 5; wy++) for (let wx = 0; wx < 2; wx++) {
            if ((i + wy + wx) % 3) ctx2.fillRect(bx + 6 * k + wx * (bw / 2.4), H * 0.74 - bh + 10 * k + wy * (bh / 6), 3 * k, 5 * k)
          }
          ctx2.fillStyle = '#0E1E36'
        }
      } else if (air.ridge === 'rafters') {
        // championship banners in the dark up top — the whole point of the building
        ctx2.strokeStyle = 'rgba(226,214,178,.14)'; ctx2.lineWidth = 2 * k
        ctx2.beginPath(); ctx2.moveTo(0, H * 0.11); ctx2.lineTo(W, H * 0.11); ctx2.stroke()
        const off = px(0.16)
        for (let i = 0; i < air.banners; i++) {
          const bx = ((i * (W / 7) + off) % (W * 1.25) + W * 1.25) % (W * 1.25) - W * 0.12
          const bw = W / 26, bh = H * (0.15 + (i % 3) * 0.02)
          ctx2.fillStyle = i % 2 ? 'rgba(29,82,55,.85)' : 'rgba(12,40,26,.85)'
          ctx2.beginPath(); ctx2.moveTo(bx, H * 0.11); ctx2.lineTo(bx + bw, H * 0.11)
          ctx2.lineTo(bx + bw, H * 0.11 + bh); ctx2.lineTo(bx + bw / 2, H * 0.11 + bh + H * 0.03)
          ctx2.lineTo(bx, H * 0.11 + bh); ctx2.closePath(); ctx2.fill()
          ctx2.strokeStyle = 'rgba(226,214,178,.5)'; ctx2.lineWidth = 1.5 * k; ctx2.stroke()
        }
      }

      // arena light spill from above, and a vignette to sit the court in the room
      const lamp = ctx2.createRadialGradient(W * 0.5, -H * 0.15, 0, W * 0.5, -H * 0.15, H * 1.15)
      lamp.addColorStop(0, (air.lamp || '#fff') + '22'); lamp.addColorStop(1, 'rgba(0,0,0,0)')
      ctx2.fillStyle = lamp; ctx2.fillRect(0, 0, W, H)

      if (air.motes) {
        const t = performance.now() / 1000
        ctx2.fillStyle = air.motes === 'snow' ? 'rgba(226,232,248,.5)' : 'rgba(232,220,200,.22)'
        for (let i = 0; i < 34; i++) {
          const sx = ((i * 7919) % 1000) / 1000, sp = 0.25 + ((i % 7) / 12)
          const mx = (sx * W + px(0.35) + (air.motes === 'snow' ? t * 14 * sp : Math.sin(t * 0.4 + i) * 26)) % W
          const my = (((i * 104729) % 1000) / 1000 * H + (air.motes === 'snow' ? t * 34 * sp : t * 5 * sp) + py(0.35)) % H
          const r = (air.motes === 'snow' ? 2.1 : 1.5) * k
          ctx2.beginPath(); ctx2.arc((mx + W) % W, (my + H) % H, r, 0, 7); ctx2.fill()
        }
      }
      ctx2.fillStyle = air.haze; ctx2.fillRect(0, 0, W, H)
      void pal
    }

    const draw = (ctx2) => {
      const c = g.current
      const L = HP.LEVELS[c.li], h = HP.hoopOf(c.li), segs = HP.segsOf(c.li)
      const world = HP.WORLDS[L.world] || HP.WORLDS.house
      const pal = world.pal
      const cv2 = cvRef.current
      ctx2.setTransform(1, 0, 0, 1, 0, 0)
      ctx2.fillStyle = '#0E0906'; ctx2.fillRect(0, 0, cv2.width, cv2.height)
      drawAir(ctx2, L.world, cv2)
      ctx2.setTransform(c.scale, 0, 0, c.scale, cv2.width / 2 - c.cam.x * c.scale, cv2.height / 2 - c.cam.y * c.scale)

      // the court itself, lit against the room behind it
      /* Deliberately translucent. At full opacity the court is a lid on the whole backdrop and
         the sky, ridge and drifting motes are wasted work — you only ever see them in the
         margins. Letting them through is what makes the play area feel like it is standing
         somewhere rather than floating on a colour. */
      const grad = ctx2.createLinearGradient(0, 0, 0, L.h)
      grad.addColorStop(0, pal.bg1 + 'A6'); grad.addColorStop(1, pal.bg2 + 'D9')
      ctx2.fillStyle = grad; ctx2.fillRect(0, 0, L.w, L.h)
      drawFloor(ctx2, L, world)

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

      // During the opening, ring the hoop so "this is where you are going" is unmissable.
      const introNow = introPhase()
      if (introNow && introNow.phase !== 'count') {
        const pulse = (performance.now() % 1400) / 1400
        for (const k of [0, 0.5]) {
          const u = (pulse + k) % 1
          ctx2.strokeStyle = `rgba(217,98,43,${(1 - u) * 0.55})`
          ctx2.lineWidth = 3
          ctx2.beginPath(); ctx2.arc(h.x, h.y, 60 + u * 90, 0, 7); ctx2.stroke()
        }
      }

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
        const ts = c.trailStyle || { color: 'rgba(217,98,43,.30)', width: 2 }
        if (ts.rainbow) {
          // hue walks the trail rather than the clock, so the ribbon reads as a path
          for (let i = 1; i < c.trail.length; i++) {
            ctx2.strokeStyle = `hsla(${(i * 6) % 360},85%,62%,.6)`
            ctx2.lineWidth = ts.width
            ctx2.beginPath(); ctx2.moveTo(c.trail[i - 1].x, c.trail[i - 1].y)
            ctx2.lineTo(c.trail[i].x, c.trail[i].y); ctx2.stroke()
          }
        } else if (ts.fade) {
          for (let i = 1; i < c.trail.length; i++) {
            ctx2.globalAlpha = i / c.trail.length
            ctx2.strokeStyle = ts.color; ctx2.lineWidth = ts.width * (i / c.trail.length)
            ctx2.beginPath(); ctx2.moveTo(c.trail[i - 1].x, c.trail[i - 1].y)
            ctx2.lineTo(c.trail[i].x, c.trail[i].y); ctx2.stroke()
          }
          ctx2.globalAlpha = 1
        } else {
          ctx2.strokeStyle = ts.color; ctx2.lineWidth = ts.width
          ctx2.beginPath(); ctx2.moveTo(c.trail[0].x, c.trail[0].y)
          for (const p of c.trail) ctx2.lineTo(p.x, p.y)
          ctx2.stroke()
          if (ts.spark) {
            ctx2.fillStyle = ts.color
            for (let i = 0; i < c.trail.length; i += 7) {
              const p = c.trail[i]
              ctx2.fillRect(p.x - 1.5, p.y - 1.5, 3, 3)
            }
          }
        }
      }

      const skin = c.skin || SHOP.BALLS[0]
      ctx2.save(); ctx2.translate(c.st.x, c.st.y); ctx2.rotate(c.st.rot)
      if (skin.glow) {
        const gl = ctx2.createRadialGradient(0, 0, HP.RB * 0.6, 0, 0, HP.RB * 2.1)
        gl.addColorStop(0, skin.glow + '66'); gl.addColorStop(1, 'rgba(0,0,0,0)')
        ctx2.fillStyle = gl; ctx2.beginPath(); ctx2.arc(0, 0, HP.RB * 2.1, 0, 7); ctx2.fill()
      }
      const bg = ctx2.createRadialGradient(-5, -6, 2, 0, 0, HP.RB)
      bg.addColorStop(0, skin.a); bg.addColorStop(1, skin.b)
      ctx2.fillStyle = bg; ctx2.beginPath(); ctx2.arc(0, 0, HP.RB, 0, 7); ctx2.fill()
      ctx2.strokeStyle = skin.seam; ctx2.lineWidth = 1.6
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

    /* Floor grain. Boston gets the actual parquet — alternating blocks of opposed grain,
       which is the most recognisable floor in the sport and the reason its dead spots are
       folklore. Everywhere else gets long boards. */
    const drawFloor = (ctx2, L, world) => {
      const pal = world.pal
      if (world.air.floor === 'parquet') {
        const B = 96
        for (let y = 0; y < L.h; y += B) {
          for (let x = 0; x < L.w; x += B) {
            const flip = ((x / B | 0) + (y / B | 0)) % 2 === 0
            ctx2.strokeStyle = 'rgba(226,214,178,.07)'; ctx2.lineWidth = 1
            for (let i = 6; i < B; i += 11) {
              ctx2.beginPath()
              if (flip) { ctx2.moveTo(x + i, y); ctx2.lineTo(x + i, y + B) }
              else { ctx2.moveTo(x, y + i); ctx2.lineTo(x + B, y + i) }
              ctx2.stroke()
            }
            ctx2.strokeStyle = 'rgba(226,214,178,.13)'; ctx2.lineWidth = 1.5
            ctx2.strokeRect(x, y, B, B)
          }
        }
      } else {
        ctx2.strokeStyle = pal.grain; ctx2.lineWidth = 1
        for (let x = 0; x < L.w; x += 26) { ctx2.beginPath(); ctx2.moveTo(x, 0); ctx2.lineTo(x, L.h); ctx2.stroke() }
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
        } else if (z.t === 'dead') {
          // a scuff in the parquet: visible if you look, easy to miss if you do not
          ctx2.fillStyle = 'rgba(10,20,14,.55)'
          ctx2.fillRect(z.x, z.y - 5, z.w, 10)
          ctx2.strokeStyle = 'rgba(226,214,178,.30)'; ctx2.lineWidth = 1.5
          ctx2.setLineDash([5, 6])
          ctx2.beginPath(); ctx2.moveTo(z.x, z.y); ctx2.lineTo(z.x + z.w, z.y); ctx2.stroke()
          ctx2.setLineDash([])
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
  const worldKeys = HP.LEVELS.reduce((acc, L) => (acc.includes(L.world) ? acc : acc.concat(L.world)), [])
  const level = HP.LEVELS[c.li] || HP.LEVELS[0]
  const world = HP.WORLDS[level.world] || HP.WORLDS.house
  const lead = race?.lead || (REVEAL_MS + PAN_MS + COUNT_MS)
  const msLeft = c.mode === 'race' && c.startAt ? c.startAt - (Date.now() + c.skew) : 0
  const showingHole = msLeft > COUNT_MS || (c.mode === 'solo' && c.introUntil)
  const counting = msLeft > 0 && msLeft <= COUNT_MS
  const countdown = counting ? Math.ceil(msLeft / 1000) : 0
  void lead

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
        {!race && view !== 'menu' && (
          <button type="button" className="hh-btn" onClick={() => setPicking('worlds')}>Courts</button>
        )}
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
              onClick={() => { g.current.mode = 'solo'; setTeaser(HP.LEVELS[0].world); loadLevel(0, 'solo', 0); setView('solo') }}>
              Play on my own
            </button>
            <div className="hoops-actions">
              <span className="hoops-coins">{wallet.coins}<i>coins</i></span>
              <button type="button" className="hoops-ghost" onClick={() => setShopOpen(true)}>Shop</button>
            </div>
            {err && <p className="hoops-err">{err}</p>}
          </div>
        )}

        {showingHole && (
          <div className="hoops-reveal">
            <span className="hr-k">Hole {race ? race.hole + 1 : c.li + 1}</span>
            <span className="hr-n">{level.name}</span>
            <span className="hr-p">Par {level.par}</span>
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

        {shopOpen && (
          <div className="hoops-card hoops-shopwrap">
            <div className="hp-head">
              <h2>Shop</h2>
              <span className="hoops-coins">{wallet.coins}<i>coins</i></span>
              <button type="button" className="hh-btn" onClick={() => setShopOpen(false)}>Close</button>
            </div>
            {[['Balls', SHOP.BALLS], ['Trails', SHOP.TRAILS]].map(([label, items]) => (
              <div key={label} className="shop-sect">
                <h3>{label}</h3>
                <div className="shop-grid">
                  {items.map((it) => {
                    const owned = wallet.owned.includes(it.id)
                    const on = wallet[it.kind] === it.id
                    const afford = wallet.coins >= it.price
                    return (
                      <button key={it.id} type="button"
                        className={`shop-item${on ? ' on' : ''}${!owned && !afford ? ' locked' : ''}`}
                        onClick={() => setWallet((w) => (owned ? SHOP.equip(w, it.id) : SHOP.buy(w, it.id)))}>
                        <span className="shop-swatch" style={it.kind === 'ball'
                          ? { background: `radial-gradient(circle at 35% 32%, ${it.a}, ${it.b})`,
                              boxShadow: it.glow ? `0 0 14px ${it.glow}` : 'none' }
                          : { background: it.rainbow
                              ? 'linear-gradient(90deg,#e5534b,#e0a13a,#63b45e,#4a90d9,#9060c0)'
                              : (it.color || '#6b5240'), height: '8px', borderRadius: '4px' }} />
                        <span className="shop-name">{it.name}</span>
                        <span className="shop-price">
                          {on ? 'Equipped' : owned ? 'Equip' : `${it.price} coins`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <p className="shop-note">Beat par to earn more. Racing pays best.</p>
          </div>
        )}

        {teaser && HP.WORLDS[teaser] && (
          <div className="hoops-card hoops-teaser">
            <span className="ht-k">{HP.WORLDS[teaser].team || 'Warm-up'}</span>
            <h1>{HP.WORLDS[teaser].name}</h1>
            <p>{HP.WORLDS[teaser].teaser}</p>
            <button type="button" className="hoops-go" onClick={() => setTeaser(null)}>Let&rsquo;s go</button>
          </div>
        )}

        {picking && (
          <div className="hoops-card hoops-pick">
            <div className="hp-head">
              <h2>{picking === 'worlds' ? 'Choose a court' : HP.WORLDS[picking].name}</h2>
              {picking !== 'worlds' && (
                <button type="button" className="hh-btn" onClick={() => setPicking('worlds')}>&larr; All courts</button>
              )}
              <button type="button" className="hh-btn" onClick={() => setPicking(null)}>Close</button>
            </div>
            {picking === 'worlds' ? (
              <div className="hp-worlds">
                {worldKeys.map((k) => {
                  const w = HP.WORLDS[k]
                  const n = HP.LEVELS.filter((l) => l.world === k).length
                  return (
                    <button key={k} type="button" className="hp-world"
                      style={{ background: `linear-gradient(135deg, ${w.pal.bg1}, ${w.pal.bg2})` }}
                      onClick={() => setPicking(k)}>
                      <span className="hp-swatch" style={{ background: w.pal.rim }} />
                      <span className="hp-name">{w.name}</span>
                      <span className="hp-sub">{w.sub}</span>
                      <span className="hp-meta">{n} holes{w.phys ? ' \u00b7 thin air' : ''}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="hp-holes">
                {HP.LEVELS.map((L, idx) => L.world !== picking ? null : (
                  <button key={L.name} type="button" className="hp-hole"
                    onClick={() => { setPicking(null); setTeaser(L.world); g.current.mode = 'solo'; loadLevel(idx, 'solo', 0); setView('solo'); force((x) => x + 1) }}>
                    <span className="hp-n">{HP.LEVELS.filter((x) => x.world === picking).indexOf(L) + 1}</span>
                    <span className="hp-hn">{L.name}</span>
                    <span className="hp-par">Par {L.par}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'solo' && c.sank && (
          <div className="hoops-card">
            <h1>{c.st.flaps <= level.par ? 'Nothing but net' : 'Bucket'}</h1>
            <p>{c.st.flaps} flaps. Par is {level.par}.</p>
            <p className="hoops-earned">+{earned} coins</p>
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