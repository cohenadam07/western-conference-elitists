// Level validator and par-finder. Beam search over flap decisions, guided by a BFS distance
// field rather than straight-line distance — in a staircase you must travel AWAY from the
// hoop to climb, and a Euclidean heuristic walks the beam straight into a wall and sits there.
// The physics module is the source of truth for levels, worlds and simulation.
export const G = await import('../../src/lib/hoopsPhysics.js')
const CELL = 20

function distField(li) {
  const L = G.LEVELS[li], segs = G.segsOf(li), h = G.hoopOf(li)
  const cols = Math.ceil(L.w / CELL), rows = Math.ceil(L.h / CELL)
  const blocked = new Uint8Array(cols * rows)
  const near = (px, py, s) => {
    const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy
    let t = l2 ? ((px - s[0]) * dx + (py - s[1]) * dy) / l2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy))
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const px = c * CELL + CELL / 2, py = r * CELL + CELL / 2
    for (const s of segs) if (near(px, py, s) < G.RB + 2) { blocked[r * cols + c] = 1; break }
  }
  const dist = new Float32Array(cols * rows).fill(Infinity)
  const gx = Math.min(cols - 1, Math.max(0, Math.floor(h.x / CELL)))
  const gy = Math.min(rows - 1, Math.max(0, Math.floor((h.y - 90) / CELL)))
  const q = [gy * cols + gx]; dist[q[0]] = 0
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], c = i % cols, r = (i - c) / cols
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc = c + dc, nr = r + dr
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      const j = nr * cols + nc
      if (blocked[j] || dist[j] !== Infinity) continue
      dist[j] = dist[i] + CELL; q.push(j)
    }
  }
  return { dist, cols, rows,
    at(x, y) {
      const c = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)))
      const r = Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)))
      const d = dist[r * cols + c]
      return Number.isFinite(d) ? d : 1e6
    } }
}

export function solve(li, P = G.DEFAULTS, opt = {}) {
  // Resolve the world's physics, or Denver's holes get measured at sea level and every par
  // there is a fiction.
  P = G.paramsFor(li, P)
  const every = opt.every || 13, beam = opt.beam || 900, horizon = opt.horizon || 220
  const field = distField(li)
  let pool = [{ st: G.makeState(li), inputs: [] }]
  for (let d = 0; d < horizon; d++) {
    const next = []
    for (const node of pool) {
      for (const dir of [0, -1, 1]) {
        const st = { ...node.st }
        const inputs = node.inputs.slice()
        if (dir !== 0) { G.flap(st, P, dir); inputs.push({ s: d * every, d: dir }) }
        for (let i = 0; i < every && !st.sank; i++) G.step(st, P)
        if (st.sank) return { sank: true, flaps: st.flaps, inputs, steps: (d + 1) * every }
        next.push({ st, inputs })
      }
    }
    next.sort((a, b) =>
      (field.at(a.st.x, a.st.y) + a.st.flaps * 22) - (field.at(b.st.x, b.st.y) + b.st.flaps * 22))
    const seen = new Set(); pool = []
    for (const n of next) {
      const k = `${Math.round(n.st.x / 24)}:${Math.round(n.st.y / 24)}:${Math.round(n.st.vx / 150)}:${Math.round(n.st.vy / 150)}`
      if (seen.has(k)) continue
      seen.add(k); pool.push(n)
      if (pool.length >= beam) break
    }
    if (!pool.length) break
  }
  return { sank: false }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0
  for (let li = 0; li < G.LEVELS.length; li++) {
    const L = G.LEVELS[li], t = Date.now()
    const r = solve(li)
    if (!r.sank) bad++
    console.log(r.sank
      ? `  PASS  ${li + 1} "${L.name}" (${L.w}x${L.h}) — par ${r.flaps}, ${(r.steps / 120).toFixed(1)}s  [${Date.now() - t}ms]`
      : `  FAIL  ${li + 1} "${L.name}" (${L.w}x${L.h}) — unsolvable  [${Date.now() - t}ms]`)
  }
  console.log(bad ? `\n${bad} level(s) need redesign` : '\nevery level is solvable')
}
