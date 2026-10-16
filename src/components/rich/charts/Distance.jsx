import { useState } from 'react'
import { C, Frame, PLAYER_COLOR, Seg, Tip, scale, ticks, useJson, useWidth } from './kit.jsx'

// Ordered categories (how close the nearest defender was): one hue, light to dark.
const BUCKETS = [
  { k: 'tight', label: 'Within 4 ft', color: '#c9d3e1' },
  { k: 'open', label: '4–6 ft', color: '#7f97b8' },
  { k: 'wide', label: '6+ ft (wide open)', color: '#22395a' },
]

export default function Distance({ base, data, title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const [ref, w] = useWidth()
  const [view, setView] = useState('share')
  const [hover, setHover] = useState(null)
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const rows = d.players.map((p) => {
    const tot = p.tight[1] + p.open[1] + p.wide[1]
    const pct = (b) => (b[1] ? (100 * b[0]) / b[1] : null)
    return { ...p, tot, share: { tight: (100 * p.tight[1]) / tot, open: (100 * p.open[1]) / tot, wide: (100 * p.wide[1]) / tot }, pct: { tight: pct(p.tight), open: pct(p.open), wide: pct(p.wide) } }
  })
  const rowH = 38
  const m = { l: 92, r: 54, t: 26, b: 34 }
  const h = m.t + rows.length * rowH + m.b
  const table = {
    cols: [
      { k: 'short', label: 'Player' },
      { k: 'tot', label: '3PA', align: 'r' },
      { k: 'wideShare', label: 'Share wide open', align: 'r' },
      { k: 'widePct', label: '3P% wide open', align: 'r' },
      { k: 'openPct', label: '3P% 4–6 ft', align: 'r' },
      { k: 'tightPct', label: '3P% within 4 ft', align: 'r' },
      { k: 'cs', label: 'Catch-and-shoot 3P%', align: 'r' },
    ],
    rows: rows.map((r) => ({
      short: r.short, tot: r.tot, wideShare: `${r.share.wide.toFixed(1)}%`,
      widePct: `${r.pct.wide.toFixed(1)}% (${r.wide[0]}/${r.wide[1]})`, openPct: `${r.pct.open.toFixed(1)}% (${r.open[0]}/${r.open[1]})`,
      tightPct: r.pct.tight == null ? '' : `${r.pct.tight.toFixed(1)}% (${r.tight[0]}/${r.tight[1]})`, cs: `${((100 * r.cs[0]) / r.cs[1]).toFixed(1)}%`,
    })),
  }

  let body
  if (view === 'share') {
    const x = scale(0, 100, m.l, w - m.r)
    body = (
      <svg width={w} height={h} role="img" aria-label="Share of three-point attempts by distance to the closest defender">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t} className="rich-axis">
            <line x1={x(t)} x2={x(t)} y1={m.t - 6} y2={h - m.b} stroke={C.grid} />
            <text x={x(t)} y={h - m.b + 16} textAnchor="middle">{t}%</text>
          </g>
        ))}
        {rows.map((r, i) => {
          let acc = 0
          const yy = m.t + i * rowH
          return (
            <g key={r.short} onMouseEnter={() => setHover({ r, x: x(100) - 40, y: yy })} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={yy} width={w} height={rowH} fill="transparent" />
              <circle cx={10} cy={yy + 14} r={4} fill={PLAYER_COLOR[r.short] || C.neutralDark} />
              <text x={20} y={yy + 18} className="rich-row-label">{r.short}</text>
              {BUCKETS.map((b, j) => {
                const x0 = x(acc)
                acc += r.share[b.k]
                const x1 = x(acc)
                return <rect key={b.k} x={x0 + (j ? 1 : 0)} y={yy + 4} width={Math.max(0, x1 - x0 - (j ? 2 : 1))} height={20} fill={b.color} rx={j === 2 ? 4 : 0} />
              })}
              <text x={w - m.r + 6} y={yy + 18} className="rich-val">{r.share.wide.toFixed(0)}%</text>
            </g>
          )
        })}
        <text x={w - m.r + 6} y={m.t - 10} className="rich-ann">wide</text>
      </svg>
    )
  } else {
    const lo = 20
    const hi = 60
    const x = scale(lo, hi, m.l, w - m.r)
    const lg = d.league.wo * 100
    body = (
      <svg width={w} height={h} role="img" aria-label="Three-point percentage on wide-open attempts, with the league average">
        {ticks(lo, hi, 4).map((t) => (
          <g key={t} className="rich-axis">
            <line x1={x(t)} x2={x(t)} y1={m.t - 6} y2={h - m.b} stroke={C.grid} />
            <text x={x(t)} y={h - m.b + 16} textAnchor="middle">{t}%</text>
          </g>
        ))}
        <line x1={x(lg)} x2={x(lg)} y1={m.t - 14} y2={h - m.b} stroke={C.gold} strokeWidth={2} />
        <text x={x(lg)} y={m.t - 16} textAnchor="middle" className="rich-ann">League {lg.toFixed(1)}%</text>
        {rows.map((r, i) => {
          const yy = m.t + i * rowH + 14
          const p = r.wide[0] / r.wide[1]
          const se = Math.sqrt((p * (1 - p)) / r.wide[1]) * 100
          const v = p * 100
          return (
            <g key={r.short} onMouseEnter={() => setHover({ r, x: x(v), y: yy - 14 })} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={yy - 14} width={w} height={rowH} fill="transparent" />
              <circle cx={10} cy={yy} r={4} fill={PLAYER_COLOR[r.short] || C.neutralDark} />
              <text x={20} y={yy + 4} className="rich-row-label">{r.short}</text>
              <line x1={x(Math.max(lo, v - se))} x2={x(Math.min(hi, v + se))} y1={yy} y2={yy} stroke={C.ink} strokeWidth={1.5} />
              <circle cx={x(v)} cy={yy} r={5.5} fill={PLAYER_COLOR[r.short] || C.neutralDark} stroke="#fff" strokeWidth={2} />
              <text x={w - m.r + 6} y={yy + 4} className="rich-val">{v.toFixed(1)}%</text>
            </g>
          )
        })}
        <text x={m.l} y={h - 4} className="rich-ann muted">Line through each dot: ±1 standard error on his attempts</text>
      </svg>
    )
  }
  return (
    <Frame title={title} caption={caption} source={source} table={table}>
      <div className="rich-controls">
        <Seg label="View" value={view} onChange={setView} options={[{ value: 'share', label: 'How open' }, { value: 'pct', label: 'What they made wide open' }]} />
        {view === 'share' && (
          <div className="rich-legend">
            {BUCKETS.map((b) => (
              <span key={b.k}><i style={{ background: b.color }} />{b.label}</span>
            ))}
          </div>
        )}
      </div>
      <div ref={ref} className="rich-plot">
        {body}
        {hover && (
          <Tip x={hover.x} y={hover.y} w={w}>
            <strong>{hover.r.short}</strong> · {hover.r.tot} threes
            <div>Wide open: {hover.r.wide[0]}/{hover.r.wide[1]} ({hover.r.pct.wide.toFixed(1)}%)</div>
            <div>4–6 ft: {hover.r.open[0]}/{hover.r.open[1]} ({hover.r.pct.open.toFixed(1)}%)</div>
            <div>Within 4 ft: {hover.r.tight[0]}/{hover.r.tight[1]}{hover.r.pct.tight != null ? ` (${hover.r.pct.tight.toFixed(1)}%)` : ''}</div>
            <div className="muted">Catch-and-shoot: {hover.r.cs[0]}/{hover.r.cs[1]} ({((100 * hover.r.cs[0]) / hover.r.cs[1]).toFixed(1)}%)</div>
          </Tip>
        )}
      </div>
    </Frame>
  )
}
