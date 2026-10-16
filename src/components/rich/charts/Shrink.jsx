import { useState } from 'react'
import { C, Frame, Slider, scale, ticks, useWidth } from './kit.jsx'

// The three numbers for one lineup (raw, luck-adjusted, sample-adjusted), and what the
// sample adjustment would do if the same lineup had played more.
export default function Shrink({ unit, title, caption, source }) {
  const [n, setN] = useState(unit.poss)
  const [ref, w] = useWidth()
  const est = (poss) => (poss * unit.adj + unit.k * unit.team) / (poss + unit.k)
  const weight = (poss) => poss / (poss + unit.k)
  const narrow = w < 480
  const own = Math.round(weight(n) * 100)
  const steps = [
    { label: 'Raw net rating', v: unit.raw, note: `${unit.poss} possessions as they happened` },
    { label: 'Luck-adjusted', v: unit.adj, note: narrow ? 'Opponent 3P% and FT% set to average' : "Opponents' threes and free throws reset to league average" },
    { label: narrow ? `Sample-adjusted, ${n.toLocaleString()} poss.` : `Sample-adjusted at ${n.toLocaleString()} possessions`, v: est(n), note: narrow ? `${own}% own record, ${100 - own}% team's +${unit.team}` : `${own}% the unit's own record, ${100 - own}% the team's +${unit.team}` },
  ]
  const m = { l: 16, r: 16 }
  const x = scale(Math.min(0, unit.team - 5), Math.max(100, unit.raw + 5), m.l, w - m.r)
  const rowY = (i) => 34 + i * 54
  const h = rowY(steps.length) + 20
  // Weight curve
  const cw = w
  const chH = 150
  const cm = { l: 44, r: 16, t: 14, b: 34 }
  const nMax = 4000
  const cx = scale(0, nMax, cm.l, cw - cm.r)
  const cy = scale(0, 1, chH - cm.b, cm.t)
  const curve = Array.from({ length: 81 }, (_, i) => (i / 80) * nMax).map((p, i) => `${i ? 'L' : 'M'}${cx(p).toFixed(1)},${cy(weight(p)).toFixed(1)}`).join('')
  return (
    <Frame title={title} caption={caption} source={source}>
      <p className="rich-unit-name">{unit.name}</p>
      <div ref={ref} className="rich-plot">
        <svg width={w} height={h} role="img" aria-label="Raw, luck-adjusted and sample-adjusted net rating">
          {ticks(x.invert(m.l), x.invert(w - m.r), w < 480 ? 4 : 6).map((t) => (
            <g key={t} className="rich-axis">
              <line x1={x(t)} x2={x(t)} y1={18} y2={h - 18} stroke={C.grid} />
              <text x={x(t)} y={h - 4} textAnchor="middle">{t > 0 ? `+${t}` : t}</text>
            </g>
          ))}
          <line x1={x(unit.team)} x2={x(unit.team)} y1={4} y2={h - 18} stroke={C.gold} strokeWidth={2} />
          <text x={x(unit.team) + 5} y={h - 22} className="rich-ann halo">Team +{unit.team}</text>
          {steps.map((s, i) => (
            <g key={i}>
              <text x={m.l} y={rowY(i) - 8} className="rich-ann strong">{s.label}</text>
              <line x1={x(0)} x2={x(s.v)} y1={rowY(i) + 8} y2={rowY(i) + 8} stroke={C.navy} strokeWidth={2} opacity={0.35} />
              <circle cx={x(s.v)} cy={rowY(i) + 8} r={7} fill={i === 2 ? C.pos : C.navy} stroke="#fff" strokeWidth={2} />
              {(() => {
                const right = x(s.v) + 12 + 44 <= w
                return (
                  <text x={right ? x(s.v) + 12 : x(s.v) - 12} y={rowY(i) + 12} textAnchor={right ? 'start' : 'end'} className="rich-val strong halo">{s.v > 0 ? '+' : ''}{s.v.toFixed(1)}</text>
                )
              })()}
              <text x={m.l} y={rowY(i) + 30} className="rich-ann muted">{s.note}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="rich-controls">
        <Slider id="shrink-n" label="If this lineup had played this many possessions" value={n} min={unit.poss} max={nMax} step={unit.poss < 100 ? 4 : 10} onChange={setN} format={(v) => `${v.toLocaleString()} (about ${Math.round(v / 2.05)} min)`} />
      </div>
      <div className="rich-plot">
        <svg width={cw} height={chH} role="img" aria-label="How much a lineup's own record counts as it plays more">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t} className="rich-axis">
              <line x1={cm.l} x2={cw - cm.r} y1={cy(t)} y2={cy(t)} stroke={C.grid} />
              <text x={cm.l - 6} y={cy(t) + 4} textAnchor="end">{Math.round(t * 100)}%</text>
            </g>
          ))}
          {ticks(0, nMax, 4).map((t) => (
            <text key={t} x={cx(t)} y={chH - cm.b + 16} textAnchor="middle" className="rich-tick">{t.toLocaleString()}</text>
          ))}
          <text x={(cw + cm.l) / 2} y={chH - 4} textAnchor="middle" className="rich-axis-label">Possessions played</text>
          <path d={curve} fill="none" stroke={C.navy} strokeWidth={2} />
          <line x1={cx(unit.k)} x2={cx(unit.k)} y1={cm.t} y2={chH - cm.b} stroke={C.gold} strokeWidth={1.5} />
          <text x={cx(unit.k) + 4} y={cm.t + 10} className="rich-ann">k = {unit.k}: half and half</text>
          <circle cx={cx(Math.min(n, nMax))} cy={cy(weight(n))} r={5} fill={C.pos} stroke="#fff" strokeWidth={2} />
        </svg>
      </div>
    </Frame>
  )
}
