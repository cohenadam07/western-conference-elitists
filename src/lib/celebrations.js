// Comp Chain win celebrations — a set of distinct, over-the-top canvas effects.
// Each takes the fullscreen <canvas> and returns a cleanup fn. pickCelebration()
// rotates through them so a different one plays every win.

const GOLD = '#c2a263'
const COLORS = [GOLD, '#e6cf9b', '#fff3d6', '#22395a', '#5b7cab', '#ffffff', '#bc3a2c']
const rnd = (a, b) => a + Math.random() * (b - a)
const pick = () => COLORS[(Math.random() * COLORS.length) | 0]
const TAU = Math.PI * 2

function mount(canvas) {
  const ctx = canvas.getContext('2d')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = (canvas.width = canvas.offsetWidth * dpr)
  const H = (canvas.height = canvas.offsetHeight * dpr)
  return { ctx, W, H, dpr }
}
function run(canvas, step) {
  const { ctx, W, H, dpr } = mount(canvas)
  const timers = []
  let raf
  const t0 = performance.now()
  const loop = (now) => {
    ctx.clearRect(0, 0, W, H)
    const cont = step(ctx, W, H, dpr, now - t0)
    if (cont !== false) raf = requestAnimationFrame(loop)
    else ctx.clearRect(0, 0, W, H)
  }
  raf = requestAnimationFrame(loop)
  return { after: (ms, fn) => timers.push(setTimeout(fn, ms)), stop: () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout) } }
}

function drawPart(ctx, p) {
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.35))
  if (p.glow) { ctx.shadowBlur = p.glow; ctx.shadowColor = p.color }
  if (p.shape === 'streak') {
    ctx.strokeStyle = p.color; ctx.lineWidth = p.w * 0.7; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(p.px - p.vx * 2.4, p.py - p.vy * 2.4); ctx.lineTo(p.x, p.y); ctx.stroke()
  } else if (p.shape === 'circle') {
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.w / 2, 0, TAU); ctx.fill()
  } else {
    ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
  }
  ctx.restore()
}
function stepPart(p, dpr, grav) {
  p.px = p.x; p.py = p.y
  p.vy += (grav ?? 0.15) * dpr; p.vx *= p.drag ?? 0.991; p.vy *= p.drag ?? 0.991
  p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay
}
const mk = (o) => Object.assign({ px: o.x, py: o.y, rot: rnd(0, TAU), vr: rnd(-0.3, 0.3), w: 4, h: 8, life: 1, decay: 0.01, glow: 0, drag: 0.991, shape: 'rect', color: pick() }, o)

/* 1 — FIREWORKS: an opening supernova, then rockets that launch, trail, and explode */
function fireworks(canvas) {
  const P = []; const rockets = []; let opened = false
  const burst = (n, x, y, pw, dpr) => { for (let i = 0; i < n; i++) { const a = rnd(0, TAU); const v = pw * rnd(0.25, 1) * dpr; P.push(mk({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(2.5, 6) * dpr, h: rnd(5, 12) * dpr, decay: rnd(0.007, 0.016), glow: 14 * dpr, shape: Math.random() < 0.6 ? 'streak' : 'rect' })) } }
  const c = run(canvas, (ctx, W, H, dpr, t) => {
    if (!opened) { opened = true; burst(150, W / 2, H * 0.4, 16, dpr) }
    if (t < 3000 && Math.random() < 0.07) rockets.push({ x: rnd(W * 0.15, W * 0.85), y: H + 10, vx: rnd(-1, 1) * dpr, vy: -rnd(13, 17) * dpr, fuse: rnd(30, 50) })
    for (let i = rockets.length - 1; i >= 0; i--) { const r = rockets[i]; r.x += r.vx; r.y += r.vy; r.vy += 0.18 * dpr; r.fuse--; P.push(mk({ x: r.x, y: r.y + rnd(0, 6) * dpr, vx: rnd(-0.5, 0.5), vy: rnd(0.4, 1.2), w: rnd(1.5, 3) * dpr, shape: 'circle', color: '#ffe9bd', life: 0.5, decay: 0.05, glow: 8 * dpr })); ctx.save(); ctx.shadowBlur = 16 * dpr; ctx.shadowColor = GOLD; ctx.fillStyle = '#fff3d6'; ctx.beginPath(); ctx.arc(r.x, r.y, 3 * dpr, 0, TAU); ctx.fill(); ctx.restore(); if (r.vy > -3 * dpr || r.fuse <= 0) { burst(110, r.x, r.y, 13, dpr); rockets.splice(i, 1) } }
    for (const p of P) { if (p.life <= 0) continue; stepPart(p, dpr, 0.14); if (p.y < H + 40) drawPart(ctx, p); else p.life = 0 }
    return t < 6500 && (rockets.length || P.some((p) => p.life > 0))
  })
  return c.stop
}

/* 2 — CONFETTI STORM: dense cannons from both bottom corners + top rain */
function confettiStorm(canvas) {
  const P = []
  const cone = (x, y, n, pw, dir, dpr) => { for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + dir * rnd(0.03, 0.55); const v = pw * rnd(0.5, 1.15) * dpr; P.push(mk({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(3, 7) * dpr, h: rnd(6, 13) * dpr, decay: rnd(0.004, 0.009), shape: Math.random() < 0.3 ? 'circle' : 'rect' })) } }
  const c = run(canvas, (ctx, W, H, dpr, t) => {
    if (t < 2200 && Math.random() < 0.5) for (let i = 0; i < 4; i++) P.push(mk({ x: rnd(0, W), y: -10, vx: rnd(-1, 1), vy: rnd(2, 4) * dpr, w: rnd(3, 6) * dpr, h: rnd(7, 13) * dpr, decay: 0.004, drag: 0.995 }))
    for (const p of P) { if (p.life <= 0) continue; stepPart(p, dpr, 0.12); p.x += Math.sin(t / 260 + p.px) * 0.6 * dpr; if (p.y < H + 40) drawPart(ctx, p); else p.life = 0 }
    return t < 6500 && P.some((p) => p.life > 0)
  })
  const { dpr, W, H } = { dpr: Math.min(devicePixelRatio || 1, 2), W: canvas.offsetWidth * Math.min(devicePixelRatio || 1, 2), H: canvas.offsetHeight * Math.min(devicePixelRatio || 1, 2) }
  cone(0, H, 120, 22, +1, dpr); cone(W, H, 120, 22, -1, dpr)
  c.after(320, () => { cone(0, H, 90, 24, +1, dpr); cone(W, H, 90, 24, -1, dpr) })
  c.after(760, () => { cone(W * 0.5, H, 120, 26, 0, dpr) })
  return c.stop
}

/* 3 — SUPERNOVA: blinding core, huge radial streak blast, expanding shock ring */
function supernova(canvas) {
  const P = []; let ring = 0
  const { dpr, W, H } = { dpr: Math.min(devicePixelRatio || 1, 2), W: canvas.offsetWidth * Math.min(devicePixelRatio || 1, 2), H: canvas.offsetHeight * Math.min(devicePixelRatio || 1, 2) }
  const cx = W / 2, cy = H * 0.42
  const blast = (n, pw) => { for (let i = 0; i < n; i++) { const a = rnd(0, TAU); const v = pw * rnd(0.3, 1) * dpr; P.push(mk({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(2, 5) * dpr, h: rnd(8, 22) * dpr, decay: rnd(0.006, 0.013), glow: 16 * dpr, shape: 'streak', drag: 0.985 })) } }
  const c = run(canvas, (ctx, w, h, d, t) => {
    // core flash
    if (t < 700) { const k = 1 - t / 700; ctx.save(); ctx.globalAlpha = k; ctx.fillStyle = '#fff7e2'; ctx.shadowBlur = 80 * d; ctx.shadowColor = GOLD; ctx.beginPath(); ctx.arc(cx, cy, (18 + t * 0.06) * d, 0, TAU); ctx.fill(); ctx.restore() }
    // shock rings
    ring += 9 * d
    for (const [r, a] of [[ring, 0.5], [ring * 0.62, 0.3]]) { if (r < Math.max(w, h)) { ctx.save(); ctx.globalAlpha = Math.max(0, a * (1 - r / Math.max(w, h))); ctx.strokeStyle = GOLD; ctx.lineWidth = 3 * d; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); ctx.restore() } }
    for (const p of P) { if (p.life <= 0) continue; stepPart(p, d, 0.03); drawPart(ctx, p) }
    return t < 5200 && P.some((p) => p.life > 0)
  })
  blast(220, 20); c.after(180, () => blast(120, 26))
  return c.stop
}

/* 4 — GOLDEN VORTEX: a galaxy of gold sparks spiraling out from the center */
function vortex(canvas) {
  const { dpr, W, H } = { dpr: Math.min(devicePixelRatio || 1, 2), W: canvas.offsetWidth * Math.min(devicePixelRatio || 1, 2), H: canvas.offsetHeight * Math.min(devicePixelRatio || 1, 2) }
  const cx = W / 2, cy = H * 0.42
  const S = []
  for (let i = 0; i < 260; i++) S.push({ ang: rnd(0, TAU), rad: rnd(4, 20) * dpr, spin: rnd(0.05, 0.14) * (Math.random() < 0.5 ? 1 : 1), grow: rnd(2.2, 5.5) * dpr, size: rnd(1.5, 4) * dpr, color: Math.random() < 0.72 ? GOLD : pick(), life: 1, decay: rnd(0.004, 0.008), glow: rnd(6, 14) * dpr })
  const c = run(canvas, (ctx, w, h, d, t) => {
    let alive = 0
    for (const s of S) { if (s.life <= 0) continue; alive++; s.ang += s.spin; s.rad += s.grow; s.life -= s.decay; const x = cx + Math.cos(s.ang) * s.rad, y = cy + Math.sin(s.ang) * s.rad; ctx.save(); ctx.globalAlpha = Math.max(0, s.life); ctx.shadowBlur = s.glow; ctx.shadowColor = s.color; ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, y, s.size, 0, TAU); ctx.fill(); ctx.restore() }
    return t < 4800 && alive > 0
  })
  return c.stop
}

/* 5 — FIRESTORM: a wall of glowing embers and sparks rising from the floor */
function firestorm(canvas) {
  const P = []
  const c = run(canvas, (ctx, W, H, dpr, t) => {
    if (t < 3800) for (let i = 0; i < 6; i++) { const warm = Math.random() < 0.6 ? GOLD : (Math.random() < 0.5 ? '#e6cf9b' : '#bc3a2c'); P.push(mk({ x: rnd(0, W), y: H + 8, vx: rnd(-1.2, 1.2) * dpr, vy: -rnd(3, 8) * dpr, w: rnd(2, 5) * dpr, h: rnd(2, 5) * dpr, shape: 'circle', color: warm, decay: rnd(0.008, 0.018), glow: rnd(8, 18) * dpr, drag: 0.985 })) }
    for (const p of P) { if (p.life <= 0) continue; p.px = p.x; p.py = p.y; p.vy += 0.02 * dpr; p.vx += Math.sin(t / 220 + p.py) * 0.05 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.life -= p.decay; p.w = p.h = Math.max(0.5, p.w * 0.996); if (p.y > -30) drawPart(ctx, p); else p.life = 0 }
    return t < 5600 && P.some((p) => p.life > 0)
  })
  return c.stop
}

/* 6 — LIGHTNING: branching gold bolts crack across the screen with spark showers */
function lightning(canvas) {
  const P = []; const bolts = []
  const strike = (W, H, dpr) => {
    const x0 = rnd(W * 0.1, W * 0.9), pts = [[x0, 0]]
    let x = x0, y = 0
    while (y < H) { y += rnd(20, 55) * dpr; x += rnd(-45, 45) * dpr; pts.push([Math.max(0, Math.min(W, x)), y]) }
    bolts.push({ pts, life: 1, branches: pts.filter(() => Math.random() < 0.25).map(([bx, by]) => ({ x: bx, y: by, dx: rnd(-60, 60) * dpr, dy: rnd(30, 70) * dpr })) })
    const [ex, ey] = pts[pts.length - 1]
    for (let i = 0; i < 30; i++) { const a = rnd(-Math.PI, 0); const v = rnd(3, 9) * dpr; P.push(mk({ x: ex, y: ey, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(2, 4) * dpr, shape: 'circle', color: '#fff3d6', decay: rnd(0.02, 0.04), glow: 10 * dpr })) }
  }
  const c = run(canvas, (ctx, W, H, dpr, t) => {
    // flashes when a fresh bolt exists
    const flash = bolts.some((b) => b.life > 0.75)
    if (flash) { ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = GOLD; ctx.fillRect(0, 0, W, H); ctx.restore() }
    for (let i = bolts.length - 1; i >= 0; i--) { const b = bolts[i]; b.life -= 0.04; if (b.life <= 0) { bolts.splice(i, 1); continue } ctx.save(); ctx.globalAlpha = b.life; ctx.strokeStyle = '#fff7e2'; ctx.shadowBlur = 18 * dpr; ctx.shadowColor = GOLD; ctx.lineWidth = rnd(1.5, 3) * dpr; ctx.lineCap = 'round'; ctx.beginPath(); b.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); b.branches.forEach((br) => { ctx.beginPath(); ctx.moveTo(br.x, br.y); ctx.lineTo(br.x + br.dx, br.y + br.dy); ctx.stroke() }); ctx.restore() }
    for (const p of P) { if (p.life <= 0) continue; stepPart(p, dpr, 0.12); drawPart(ctx, p) }
    return t < 5200 && (bolts.length || P.some((p) => p.life > 0))
  })
  const dpr = Math.min(devicePixelRatio || 1, 2), W = canvas.offsetWidth * dpr, H = canvas.offsetHeight * dpr
  strike(W, H, dpr)
  for (let i = 1; i <= 7; i++) c.after(i * 260, () => strike(W, H, dpr))
  return c.stop
}

export const CELEBRATIONS = [fireworks, confettiStorm, supernova, vortex, firestorm, lightning]

export function pickCelebration(lastIdx) {
  let i = (Math.random() * CELEBRATIONS.length) | 0
  if (CELEBRATIONS.length > 1 && i === lastIdx) i = (i + 1) % CELEBRATIONS.length
  return { idx: i, run: CELEBRATIONS[i] }
}
