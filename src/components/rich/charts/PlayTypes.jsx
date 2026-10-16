import { useState } from 'react'
import { C, Frame, PLAYER_COLOR, Seg, Tip, XAxis, YAxis, ord, placeLabels, scale, ticks, useJson, useWidth } from './kit.jsx'

const STORY = { PRRollman: 'good', Cut: 'good', Isolation: 'bad', Postup: 'bad' }

export default function PlayTypes({ base, data, title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const [view, setView] = useState('spurs')
  const [sel, setSel] = useState('PRRollman')
  const [hover, setHover] = useState(null)
  const [ref, w] = useWidth()
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const pts = view === 'spurs' ? d.spurs : d.wemby
  const league = view === 'spurs' && sel ? d.league[sel] || [] : []
  const allX = [...pts.map((p) => p.freq), ...league.map((p) => p.freq)]
  const allY = [...pts.map((p) => p.ppp), ...league.map((p) => p.ppp)]
  const h = Math.min(420, Math.max(300, w * 0.6))
  const m = { l: 52, r: 18, t: 16, b: 46 }
  const x = scale(0, Math.ceil((Math.max(...allX) + 2) / 5) * 5, m.l, w - m.r)
  const ylo = Math.floor((Math.min(...allY) - 0.05) * 10) / 10
  const yhi = Math.ceil((Math.max(...allY) + 0.05) * 10) / 10
  const y = scale(ylo, yhi, h - m.b, m.t)
  const color = (p) => (view === 'wemby' ? (STORY[p.k] === 'good' ? PLAYER_COLOR.Wemby : STORY[p.k] === 'bad' ? C.neutralDark : C.neutral) : p.k === sel ? C.navy : '#6f86a8')
  // Most-used plays and the selected one get first pick of label spots.
  const order = [...pts].sort((a, b) => (b.k === sel) - (a.k === sel) || b.freq - a.freq)
  const labels = placeLabels(order.map((p) => ({ id: p.k, cx: x(p.freq), cy: y(p.ppp), r: 6.5, text: p.label })), { x0: m.l + 2, x1: w - 2, y0: 0, y1: h - m.b, charW: 6.2 })
  const table = {
    cols: [{ k: 'label', label: 'Play type' }, { k: 'freq', label: 'Share of plays', align: 'r' }, { k: 'ppp', label: 'Points per play', align: 'r' }, { k: 'pct', label: 'Percentile', align: 'r' }, { k: 'poss', label: 'Plays', align: 'r' }],
    rows: pts.map((p) => ({ label: p.label, freq: `${p.freq.toFixed(1)}%`, ppp: p.ppp.toFixed(3), pct: p.pct, poss: p.poss })),
    sortable: true,
  }
  return (
    <Frame title={title} caption={caption} source={source} table={table}>
      <div className="rich-controls">
        <Seg label="Whose plays" value={view} onChange={(v) => { setView(v); setHover(null) }} options={[{ value: 'spurs', label: 'Spurs offense' }, { value: 'wemby', label: 'Wembanyama' }]} />
        {view === 'spurs' && (
          <label className="rich-select">
            <span>Compare the league on</span>
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              {d.spurs.map((p) => (
                <option key={p.k} value={p.k}>{p.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {view === 'wemby' && (
        <div className="rich-legend">
          <span><i style={{ background: PLAYER_COLOR.Wemby }} />Rolls and cuts</span>
          <span><i style={{ background: C.neutralDark }} />Isolations and post-ups</span>
          <span><i style={{ background: C.neutral }} />Everything else</span>
        </div>
      )}
      <div ref={ref} className="rich-plot">
        <svg width={w} height={h} role="img" aria-label="Play types by frequency and points per play">
          <XAxis x={x} ticks={ticks(0, x.invert(w - m.r), w < 480 ? 4 : 6)} y0={m.t} y1={h - m.b} format={(v) => `${v}%`} label="Share of plays" width={w} />
          <YAxis y={y} ticks={ticks(ylo, yhi, 5)} x0={m.l} x1={w - m.r} format={(v) => v.toFixed(1)} label="Points per play" height={h} />
          {league.filter((t) => t.t !== 'SAS').map((t) => (
            <circle key={t.t} cx={x(t.freq)} cy={y(t.ppp)} r={4} fill={C.neutral} opacity={0.8} onMouseEnter={() => setHover({ label: `${t.t}: ${d.spurs.find((p) => p.k === sel).label}`, freq: t.freq, ppp: t.ppp, x: x(t.freq), y: y(t.ppp) })} onMouseLeave={() => setHover(null)} />
          ))}
          {pts.map((p) => (
            <g key={p.k} onMouseEnter={() => setHover({ label: p.label, freq: p.freq, ppp: p.ppp, pct: p.pct, poss: p.poss, x: x(p.freq), y: y(p.ppp) })} onMouseLeave={() => setHover(null)} onClick={() => view === 'spurs' && setSel(p.k)} style={{ cursor: view === 'spurs' ? 'pointer' : 'default' }}>
              <circle cx={x(p.freq)} cy={y(p.ppp)} r={14} fill="transparent" />
              <circle cx={x(p.freq)} cy={y(p.ppp)} r={6.5} fill={color(p)} stroke="#fff" strokeWidth={2} />
              <text {...labels[p.k]} className="rich-dot-label small">{p.label}</text>
            </g>
          ))}
        </svg>
        {hover && (
          <Tip x={hover.x} y={hover.y} w={w}>
            <strong>{hover.label}</strong>
            <div>{hover.freq.toFixed(1)}% of plays · {hover.ppp.toFixed(3)} points per play</div>
            {hover.pct != null && <div className="muted">{ord(hover.pct)} percentile · {hover.poss} plays</div>}
          </Tip>
        )}
      </div>
    </Frame>
  )
}
