import { useState } from 'react'
import { C, Frame, PLAYER_COLOR, Seg, Slider, scale, ticks, useJson, useWidth } from './kit.jsx'

// A beta-binomial style shooting projector. The prior comes from free throws (what his touch
// says), the evidence is his three-point attempts, and the reader chooses how much the recent
// stretch and the playoffs count.
export default function Projector({ base, data, title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const [who, setWho] = useState('Castle')
  const [off, setOff] = useState({})
  const [w25, setW25] = useState(0)
  const [wpo, setWpo] = useState(1)
  const [useFt, setUseFt] = useState(true)
  const [ref, w] = useWidth()
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const P = d.players[who]
  const seasons = P.seasons
  const included = seasons.filter((s) => !off[`${who}|${s.season}`])

  // Free throws: career, plus the playoffs at the chosen weight.
  const ftm = included.reduce((a, s) => a + (s.ft / 100) * s.fta, 0) + P.po[2] * wpo
  const fta = included.reduce((a, s) => a + s.fta, 0) + P.po[3] * wpo
  const ftPct = fta ? ftm / fta : 0.78
  const lg = d.prior.p
  const tau = useFt ? d.prior.tau : 0.0257
  const mu = useFt ? d.prior.a + d.prior.b * ftPct : lg
  const k = (lg * (1 - lg)) / (tau * tau)

  const made = included.reduce((a, s) => a + s.m, 0) + P.l25[0] * w25 + P.po[0] * wpo
  const att = included.reduce((a, s) => a + s.a, 0) + P.l25[1] * w25 + P.po[1] * wpo
  const est = (k * mu + made) / (k + att)
  const sd = Math.sqrt((est * (1 - est)) / (k + att))
  const lo80 = est - 1.2816 * sd
  const hi80 = est + 1.2816 * sd

  const last = seasons[seasons.length - 1]
  const marks = [
    { k: 'prior', label: useFt ? 'What his free throws say' : 'League average', v: mu, shape: 'tick' },
    { k: 'season', label: `${last.season} regular season`, v: last.m / last.a, shape: 'ring' },
    { k: 'l25', label: 'Last 25 games', v: P.l25[0] / P.l25[1], shape: 'ring' },
    ...(P.po[1] ? [{ k: 'po', label: '2026 playoffs', v: P.po[0] / P.po[1], shape: 'ring' }] : []),
    ...(P.model ? [{ k: 'model', label: 'Fitted model', v: P.model, shape: 'diamond' }] : []),
  ]
  const lo = 0.24
  const hi = Math.max(0.52, ...marks.map((m) => m.v + 0.02))
  const m = { l: 18, r: 18 }
  const x = scale(lo, hi, m.l, w - m.r)
  const rowY = (i) => 34 + i * 32
  const h = rowY(marks.length) + 64
  const col = PLAYER_COLOR[who] || C.navy
  const pct = (v) => `${(v * 100).toFixed(1)}%`
  const table = {
    cols: [{ k: 'what', label: 'Window' }, { k: 'm', label: '3PM', align: 'r' }, { k: 'a', label: '3PA', align: 'r' }, { k: 'p', label: '3P%', align: 'r' }, { k: 'ft', label: 'FT%', align: 'r' }],
    rows: [
      ...seasons.map((s) => ({ what: s.season, m: s.m, a: s.a, p: pct(s.m / s.a), ft: `${s.ft.toFixed(1)}%` })),
      { what: 'Last 25 games', m: P.l25[0], a: P.l25[1], p: pct(P.l25[0] / P.l25[1]), ft: pct(P.l25[2] / P.l25[3]) },
      ...(P.po[1] ? [{ what: '2026 playoffs', m: P.po[0], a: P.po[1], p: pct(P.po[0] / P.po[1]), ft: pct(P.po[2] / P.po[3]) }] : []),
    ],
  }
  return (
    <Frame title={title} caption={caption} source={source} table={table}>
      <div className="rich-controls">
        <Seg label="Player" value={who} onChange={setWho} options={Object.keys(d.players)} />
      </div>
      <div className="rich-controls rich-controls-col">
        <div className="rich-checks" role="group" aria-label="Seasons to count">
          {seasons.map((s) => {
            const key = `${who}|${s.season}`
            return (
              <label key={key} className="rich-check-opt">
                <input type="checkbox" checked={!off[key]} onChange={() => setOff((o) => ({ ...o, [key]: !o[key] }))} />
                {s.season} <span className="muted">({s.m}/{s.a})</span>
              </label>
            )
          })}
          <label className="rich-check-opt">
            <input type="checkbox" checked={useFt} onChange={() => setUseFt((v) => !v)} />
            Start from his free throws
          </label>
        </div>
        <Slider id={`w25-${who}`} label="Extra weight on the last 25 games" value={w25} min={0} max={3} step={0.5} onChange={setW25} format={(v) => (v ? `+${v}×` : 'none')} />
        <Slider id={`wpo-${who}`} label="Weight on the playoffs" value={wpo} min={0} max={1} step={0.25} onChange={setWpo} format={(v) => `${Math.round(v * 100)}%`} />
      </div>
      <div ref={ref} className="rich-plot">
        <svg width={w} height={h} role="img" aria-label={`Projected three-point percentage for ${who}: ${pct(est)}`}>
          {ticks(lo * 100, hi * 100, w < 480 ? 4 : 7).map((t) => (
            <g key={t} className="rich-axis">
              <line x1={x(t / 100)} x2={x(t / 100)} y1={14} y2={h - 30} stroke={C.grid} />
              <text x={x(t / 100)} y={h - 14} textAnchor="middle">{t}%</text>
            </g>
          ))}
          {marks.map((mk, i) => (
            <g key={mk.k}>
              <text x={x(lo) + 2} y={rowY(i) - 11} className="rich-ann">{mk.label}</text>
              {mk.shape === 'tick' && <line x1={x(mk.v)} x2={x(mk.v)} y1={rowY(i) - 8} y2={rowY(i) + 8} stroke={C.goldDeep} strokeWidth={3} />}
              {mk.shape === 'ring' && <circle cx={x(mk.v)} cy={rowY(i)} r={5} fill="#fff" stroke={C.ink} strokeWidth={1.5} />}
              {mk.shape === 'diamond' && <rect x={x(mk.v) - 5} y={rowY(i) - 5} width={10} height={10} transform={`rotate(45 ${x(mk.v)} ${rowY(i)})`} fill={C.ink} />}
              <text x={x(mk.v) + 9} y={rowY(i) + 4} className="rich-val halo">{pct(mk.v)}</text>
            </g>
          ))}
          <g>
            <text x={x(lo) + 2} y={rowY(marks.length) + 4} className="rich-ann strong">Estimate · 80% range</text>
            <rect x={x(lo80)} y={rowY(marks.length) + 12} width={Math.max(2, x(hi80) - x(lo80))} height={14} rx={7} fill={col} opacity={0.18} />
            <circle cx={x(est)} cy={rowY(marks.length) + 19} r={7} fill={col} stroke="#fff" strokeWidth={2} />
          </g>
        </svg>
      </div>
      <div className="rich-readout">
        <div>
          <span className="k">Estimate</span>
          <span className="big">{pct(est)}</span>
        </div>
        <div>
          <span className="k">80% range</span>
          <span className="big">{pct(lo80)}–{pct(hi80)}</span>
        </div>
        <div>
          <span className="k">Evidence</span>
          <span className="small">{Math.round(att)} weighted attempts + a prior worth {Math.round(k)}</span>
        </div>
      </div>
    </Frame>
  )
}
