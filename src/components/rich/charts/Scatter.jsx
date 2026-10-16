import { useState } from 'react'
import { C, Frame, PLAYER_COLOR, Tip, XAxis, YAxis, scale, ticks, useJson, useWidth } from './kit.jsx'

const SHORT = { 'Stephon Castle': 'Castle', 'Dylan Harper': 'Harper', "De'Aaron Fox": 'Fox' }
// Harper and Fox sit at the same turnover rate a few points of assist rate apart, so their
// labels go below and away from each other; Castle's goes above.
const LABEL_AT = {
  Castle: (cx, cy) => ({ x: cx + 9, y: cy - 8 }),
  Harper: (cx, cy) => ({ x: cx - 4, y: cy + 21, textAnchor: 'end' }),
  Fox: (cx, cy) => ({ x: cx + 4, y: cy + 21 }),
}

// Assist rate against turnover rate for every qualified guard, with the league trend and
// Castle's path from his rookie season.
export default function Scatter({ base, data, title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const pts = d.points.filter((p) => p.ast != null && p.tov != null)
  const h = Math.min(440, Math.max(320, w * 0.62))
  const m = { l: 46, r: 16, t: 14, b: 46 }
  const xs = pts.map((p) => p.ast)
  const ys = pts.map((p) => p.tov)
  const x = scale(Math.floor(Math.min(...xs) / 5) * 5, Math.ceil(Math.max(...xs) / 5) * 5, m.l, w - m.r)
  const y = scale(Math.floor(Math.min(...ys) / 2) * 2, Math.ceil(Math.max(...ys) / 2) * 2, h - m.b, m.t)
  const [x0, x1] = [x.invert(m.l), x.invert(w - m.r)]
  const fit = (v) => d.fit.a + d.fit.b * v
  const c24 = d.castle24
  const castle = pts.find((p) => p.name === 'Stephon Castle')

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    let best = null
    let bd = 28 * 28
    for (const p of pts) {
      const dx = x(p.ast) - px
      const dy = y(p.tov) - py
      const dd = dx * dx + dy * dy
      if (dd < bd) {
        bd = dd
        best = p
      }
    }
    setHover(best ? { p: best, x: x(best.ast), y: y(best.tov) } : null)
  }
  const named = pts.filter((p) => SHORT[p.name])
  const table = {
    cols: [{ k: 'name', label: 'Guard' }, { k: 'team', label: 'Team' }, { k: 'ast', label: 'Assist %', align: 'r' }, { k: 'tov', label: 'Turnover %', align: 'r' }, { k: 'usg', label: 'Usage %', align: 'r' }],
    rows: [...pts].sort((a, b) => b.tov - a.tov),
    sortable: true,
    max: 25,
  }
  return (
    <Frame title={title} caption={caption} source={source} table={table}>
      <div ref={ref} className="rich-plot">
        <svg width={w} height={h} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Scatter of assist rate against turnover rate for qualified guards">
          <XAxis x={x} ticks={ticks(x0, x1, w < 480 ? 4 : 7)} y0={m.t} y1={h - m.b} format={(v) => `${v}%`} label={w < 520 ? 'Assist rate' : "Assist rate (share of teammates' baskets he assisted)"} width={w} />
          <YAxis y={y} ticks={ticks(y.invert(h - m.b), y.invert(m.t), 6)} x0={m.l} x1={w - m.r} format={(v) => `${v}%`} label="Turnover rate" height={h} />
          <line x1={x(x0)} x2={x(x1)} y1={y(fit(x0))} y2={y(fit(x1))} stroke={C.gold} strokeWidth={2} />
          <text x={x(x1) - 4} y={y(fit(x1)) + 16} textAnchor="end" className="rich-ann halo">League trend</text>
          {pts.filter((p) => !SHORT[p.name]).map((p) => (
            <circle key={p.id} cx={x(p.ast)} cy={y(p.tov)} r={4} fill={C.neutral} opacity={0.75} />
          ))}
          {c24 && castle && (
            <g>
              <defs>
                <marker id="arrow-castle" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" fill={PLAYER_COLOR.Castle} />
                </marker>
              </defs>
              <circle cx={x(c24.ast)} cy={y(c24.tov)} r={5} fill="#fff" stroke={PLAYER_COLOR.Castle} strokeWidth={2} />
              <line x1={x(c24.ast)} y1={y(c24.tov)} x2={x(castle.ast) - 8} y2={y(castle.tov) + 5} stroke={PLAYER_COLOR.Castle} strokeWidth={1.5} markerEnd="url(#arrow-castle)" />
              <text x={x(c24.ast) - 8} y={y(c24.tov) + (w < 520 ? 4 : -8)} textAnchor="end" className="rich-ann halo">{w < 520 ? 'Rookie' : 'Castle, rookie year'}</text>
            </g>
          )}
          {named.map((p) => (
            <g key={p.id}>
              <circle cx={x(p.ast)} cy={y(p.tov)} r={6} fill={PLAYER_COLOR[SHORT[p.name]]} stroke="#fff" strokeWidth={2} />
              <text {...LABEL_AT[SHORT[p.name]](x(p.ast), y(p.tov))} className="rich-dot-label">{SHORT[p.name]}</text>
            </g>
          ))}
          {hover && <circle cx={hover.x} cy={hover.y} r={8} fill="none" stroke={C.ink} strokeWidth={1.5} />}
        </svg>
        {hover && (
          <Tip x={hover.x} y={hover.y} w={w}>
            <strong>{hover.p.name}</strong> <span className="muted">{hover.p.team}</span>
            <div>Assist rate {hover.p.ast.toFixed(1)}% · Turnover rate {hover.p.tov.toFixed(1)}%</div>
            <div className="muted">Usage {hover.p.usg?.toFixed(1)}% · trend expects {fit(hover.p.ast).toFixed(1)}%</div>
          </Tip>
        )}
      </div>
    </Frame>
  )
}
