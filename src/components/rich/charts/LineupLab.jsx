import { useState } from 'react'
import { C, Frame, PLAYER_COLOR, scale, useJson, useWidth } from './kit.jsx'

// A box-score projection for any five: summed offensive and defensive BPM, with or without
// the usage-overlap term from the lineup study. Fit on 5,669 lineups, 2018-19 to 2025-26.
function project(five, roster, model, usagePenalty) {
  const ps = five.map((s) => roster.find((r) => r.short === s)).filter(Boolean)
  const ob = ps.reduce((a, r) => a + r.obpm, 0)
  const db = ps.reduce((a, r) => a + r.dbpm, 0)
  const us = ps.reduce((a, r) => a + r.usg, 0)
  const est = usagePenalty
    ? model.A.Intercept + model.A.obpm * ob + model.A.dbpm * db + model.A.usg_over * (us - 100)
    : model.B.Intercept + model.B.obpm * ob + model.B.dbpm * db
  const shooters = ps.filter((r) => r.tp3 != null && r.tp3 >= 37.5 && r.tp3_n >= 150).length
  return { est, ob, db, us, shooters, ps }
}

export default function LineupLab({ base, data, lineups, presets = [], title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const { data: L } = useJson(`${base}/${lineups}`)
  const [five, setFive] = useState(presets[0]?.five || [])
  const [pen, setPen] = useState(true)
  const [ref, w] = useWidth()
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const roster = d.roster.filter((r) => r.obpm != null && r.usg != null)
  const model = { A: d.modelA, B: d.modelB }
  const cur = project(five, roster, model, pen)
  const toggle = (s) => setFive((f) => (f.includes(s) ? f.filter((q) => q !== s) : f.length >= 5 ? f : [...f, s]))
  const observed = L && five.length === 5 ? (L.rs5 || []).find((u) => u.p.length === 5 && five.every((s) => u.p.includes(s))) : null
  const same = (a, b) => a.length === b.length && a.every((s) => b.includes(s))
  const bars = presets.map((p) => ({ label: p.label, five: p.five, est: project(p.five, roster, model, pen).est }))
  if (five.length === 5 && !presets.some((p) => same(p.five, five))) bars.push({ label: 'Your five', five, est: cur.est })
  const lo = Math.min(0, ...bars.map((b) => b.est))
  const hi = Math.max(16, ...bars.map((b) => Math.ceil(b.est / 4) * 4))
  // On phones the preset names sit above their bars instead of beside them.
  const stack = w < 520
  const labelW = stack ? 4 : 220
  const x = scale(lo, hi, labelW, w - 46)
  const rowH = stack ? 44 : 30
  const barY = stack ? 18 : 2
  return (
    <Frame title={title} caption={caption} source={source} wide>
      <div className="rich-presets">
        {presets.map((p) => (
          <button key={p.label} type="button" className={same(p.five, five) ? 'on' : ''} aria-pressed={same(p.five, five)} onClick={() => setFive(p.five)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="rich-chips" role="group" aria-label="Choose five players">
        {roster.map((r) => {
          const on = five.includes(r.short)
          return (
            <button key={r.short} type="button" aria-pressed={on} disabled={!on && five.length >= 5} className={on ? 'on' : ''} onClick={() => toggle(r.short)}>
              <span className="sw" style={{ background: PLAYER_COLOR[r.short] || '#8d8a83' }} aria-hidden="true" />
              {r.short}
            </button>
          )
        })}
      </div>
      <label className="rich-check-opt rich-pen">
        <input type="checkbox" checked={pen} onChange={() => setPen((v) => !v)} />
        Charge for usage over 100% (the box-score version of the lineup study; the on/off version finds no charge on offense)
      </label>
      <div className="rich-readout">
        <div>
          <span className="k">Projected net rating</span>
          <span className="big">{five.length === 5 ? `${cur.est > 0 ? '+' : ''}${cur.est.toFixed(1)}` : 'n/a'}</span>
        </div>
        <div>
          <span className="k">Combined usage</span>
          <span className="big">{five.length ? `${cur.us.toFixed(1)}%` : 'n/a'}</span>
        </div>
        <div>
          <span className="k">37.5%+ shooters</span>
          <span className="big">{five.length ? cur.shooters : 'n/a'}</span>
        </div>
        <div>
          <span className="k">Summed BPM (off / def)</span>
          <span className="big">{five.length ? `${cur.ob.toFixed(1)} / ${cur.db.toFixed(1)}` : 'n/a'}</span>
        </div>
      </div>
      {five.length === 5 && (
        <p className="rich-observed">
          {observed
            ? `Played together last regular season: ${Math.round(observed.min)} minutes, ${observed.net > 0 ? '+' : ''}${observed.net.toFixed(1)} raw, ${observed.adj > 0 ? '+' : ''}${observed.adj.toFixed(1)} luck-adjusted, ${observed.est > 0 ? '+' : ''}${observed.est.toFixed(1)} sample-adjusted.`
            : 'This five did not play 5 minutes together last regular season.'}
        </p>
      )}
      <div ref={ref} className="rich-plot">
        <svg width={w} height={bars.length * rowH + 30} role="img" aria-label="Projected net rating for each preset lineup">
          {[0, 4, 8, 12, 16, 20].filter((t) => t >= lo && t <= hi).map((t) => (
            <g key={t} className="rich-axis">
              <line x1={x(t)} x2={x(t)} y1={4} y2={bars.length * rowH + 6} stroke={C.grid} />
              <text x={x(t)} y={bars.length * rowH + 22} textAnchor="middle">{t > 0 ? `+${t}` : t}</text>
            </g>
          ))}
          {bars.map((b, i) => {
            const on = same(b.five, five)
            const y = 8 + i * rowH
            return (
              <g key={b.label} onClick={() => setFive(b.five)} style={{ cursor: 'pointer' }}>
                <text x={stack ? labelW : labelW - 10} y={y + 13} textAnchor={stack ? 'start' : 'end'} className={`rich-row-label${on ? ' strong' : ''}`}>{b.label}</text>
                <rect x={x(0)} y={y + barY} width={Math.max(2, x(b.est) - x(0))} height={16} rx={4} fill={on ? C.navy : C.neutral} />
                <text x={x(b.est) + 6} y={y + barY + 12} className="rich-val">{b.est > 0 ? '+' : ''}{b.est.toFixed(1)}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </Frame>
  )
}
