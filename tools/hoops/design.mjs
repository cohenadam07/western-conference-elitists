/* Design harness.
 *
 * Two kinds of modifier, and they need opposite tests. This took three goes to get right and
 * both wrong versions would have signed off bad levels:
 *
 *   ENABLERS (gush, lasso, bronco, stepback) let you go somewhere. Delete one and par should
 *   climb, or the hole should stop going at all.
 *
 *   HAZARDS (weed, cannon, dead) take something from you. "Par went up when I deleted it" is
 *   backwards for these. Nor is "does the best line hit it" right — a well-played line DODGES
 *   a hazard, and dodging is the gameplay. What actually matters is whether it costs anything:
 *   delete it and see if the hole gets cheaper. If par does not move, nobody ever had to wait,
 *   duck or go around, and it is scenery.
 */
import { solve, G } from './solver.mjs'

const ENABLERS = new Set(['gush', 'lasso', 'bronco', 'stepback'])

function pathDiffers(li, keep, dropIndex, inputs) {
  const L = G.LEVELS[li]
  const run = () => {
    const P = G.paramsFor(li, G.DEFAULTS)
    const st = G.makeState(li)
    const at = new Map()
    for (const i of inputs) { if (!at.has(i.s)) at.set(i.s, []); at.get(i.s).push(i.d) }
    for (let s = 0; s < 6000 && !st.sank; s++) {
      const fl = at.get(s); if (fl) for (const d of fl) G.flap(st, P, d)
      G.step(st, P)
    }
    return `${Math.round(st.x)},${Math.round(st.y)},${st.t},${st.sank ? 1 : 0}`
  }
  L.zones = keep; delete L._segs
  const withIt = run()
  L.zones = keep.filter((_, k) => k !== dropIndex); delete L._segs
  const without = run()
  L.zones = keep; delete L._segs
  return withIt !== without
}

export function audit(li) {
  const L = G.LEVELS[li]
  const base = solve(li)
  if (!base.sank) return { ok: false }
  const keep = L.zones || []
  const zs = []
  for (let z = 0; z < keep.length; z++) {
    const t = keep[z].t
    if (ENABLERS.has(t)) {
      L.zones = keep.filter((_, k) => k !== z); delete L._segs
      const r = solve(li)
      L.zones = keep; delete L._segs
      zs.push({ t, kind: 'enabler', delta: r.sank ? r.flaps - base.flaps : Infinity })
    } else {
      /* Hazards are measured in TIME, not flaps. Waiting for a gap costs you nothing in
         flaps, so a flap-based test calls every hazard free — but a race is first-to-sink,
         and seconds are the entire currency there. Steps is the honest unit. */
      L.zones = keep.filter((_, k) => k !== z); delete L._segs
      const r = solve(li)
      L.zones = keep; delete L._segs
      zs.push({ t, kind: 'hazard',
        secs: r.sank ? Number(((base.steps - r.steps) / 120).toFixed(1)) : Infinity,
        hit: pathDiffers(li, keep, z, base.inputs) })
    }
  }
  /* Same-type modifiers are usually a SET — four planks across a chasm, two ropes over a
     span. Pull one and the others cover for it, so a per-zone test calls every one redundant
     while the group is the whole hole. Measure the group as well. */
  const groups = {}
  for (const t of new Set(keep.map((z) => z.t))) {
    if (keep.filter((z) => z.t === t).length < 2) continue
    L.zones = keep.filter((z) => z.t !== t); delete L._segs
    const r = solve(li)
    L.zones = keep; delete L._segs
    groups[t] = r.sank ? r.flaps - base.flaps : Infinity
  }
  return { ok: true, par: base.flaps, zones: zs, groups }
}

export function install(li, spec) {
  Object.assign(G.LEVELS[li], spec); delete G.LEVELS[li]._segs
}

export function grade(z) {
  if (z.kind === 'enabler') {
    return z.delta === Infinity ? 'REQUIRED' : z.delta >= 3 ? `+${z.delta}` : z.delta > 0 ? `+${z.delta}!` : 'DEAD'
  }
  if (z.secs === Infinity) return 'BLOCKS'
  if (z.secs >= 0.4) return `costs ${z.secs}s`
  return z.hit ? 'brushed' : 'FREE'
}
/* A hazard passes if the best line runs into its space. The solver threads these almost
   perfectly and pays barely any time for it — a person will not. Demanding a measurable time
   cost against an optimal player sets the bar somewhere no hazard can reach. */
export function ok(z) { return z.kind === 'enabler' ? z.delta >= 3 : (z.secs >= 0.4 || z.hit) }

export function report(name, a) {
  if (!a.ok) return `  ${name.padEnd(16)} UNSOLVABLE`
  const g = Object.entries(a.groups || {})
    .map(([t, d]) => `${t} set: ${d === Infinity ? 'REQUIRED' : d > 0 ? '+' + d : 'DEAD'}`)
  const carried = new Set(Object.entries(a.groups || {}).filter(([, d]) => d === Infinity || d >= 3).map(([t]) => t))
  const bad = a.zones.filter((z) => !ok(z) && !carried.has(z.t)).length
  return `  ${name.padEnd(16)} par ${String(a.par).padStart(2)}  ` +
    a.zones.map((z) => `${z.t}:${grade(z)}`).join(' ') +
    (g.length ? '  [' + g.join(', ') + ']' : '') +
    (bad ? '   <-- ' + bad + ' not pulling weight' : '')
}
