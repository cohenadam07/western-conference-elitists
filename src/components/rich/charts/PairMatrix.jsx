import { useState } from 'react'
import { C, Frame, Seg, Tip, diverging, textOn, useJson, useWidth } from './kit.jsx'

const MODES = [
  { value: 'net', label: 'Raw' },
  { value: 'adj', label: 'Luck-adjusted' },
  { value: 'est', label: 'Sample-adjusted' },
]

export default function PairMatrix({ base, data, players, title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const [mode, setMode] = useState('est')
  const [hover, setHover] = useState(null)
  const [ref, w] = useWidth()
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const pair = (a, b) => d.rs2.find((u) => u.p.includes(a) && u.p.includes(b))
  const n = players.length
  const narrow = w < 520
  const labelW = narrow ? 58 : 92
  const cell = Math.max(24, Math.min(64, Math.floor((w - labelW - 4) / n)))
  const ABBR = { Champagnie: 'Champ.', 'K. Johnson': 'KJ', Wembanyama: 'Wemby' }
  const rowName = (p) => (narrow ? ABBR[p] || p : p)
  const colName = (p) => {
    const s = cell < 80 ? ABBR[p] || p : p
    return narrow ? s.slice(0, cell < 32 ? 3 : 4) : s
  }
  const center = mode === 'net' ? d.team.net : d.team.adj
  const span = mode === 'est' ? 8 : 18
  const gw = labelW + cell * n
  const gh = 26 + cell * n
  const table = {
    cols: [{ k: 'pair', label: 'Pair' }, { k: 'min', label: 'Min', align: 'r' }, { k: 'net', label: 'Raw net', align: 'r' }, { k: 'adj', label: 'Luck-adj', align: 'r' }, { k: 'est', label: 'Sample-adj', align: 'r' }],
    rows: players.flatMap((a, i) => players.slice(i + 1).map((b) => ({ a, b, u: pair(a, b) }))).filter((r) => r.u).map(({ a, b, u }) => ({ pair: `${a} + ${b}`, min: u.min, net: u.net.toFixed(1), adj: u.adj.toFixed(1), est: u.est.toFixed(1) })),
    sortable: true,
  }
  return (
    <Frame title={title} caption={caption} source={source} table={table}>
      <div className="rich-controls">
        <Seg label="Rating" value={mode} onChange={setMode} options={MODES} />
        <span className="rich-ctl-note">Colored against the team: {mode === 'net' ? '+8.4 raw' : '+7.6 luck-adjusted'}. Red is better, blue worse.</span>
      </div>
      <div ref={ref} className="rich-plot rich-matrix">
        <svg width={Math.min(w, gw)} height={gh} role="img" aria-label="Net rating for every pair of Spurs players">
          {players.map((p, j) => (
            <text key={`c${p}`} x={labelW + j * cell + cell / 2} y={16} textAnchor="middle" className="rich-tick">{colName(p)}</text>
          ))}
          {players.map((a, i) => (
            <g key={a}>
              <text x={labelW - 8} y={26 + i * cell + cell / 2 + 4} textAnchor="end" className="rich-row-label">{rowName(a)}</text>
              {players.map((b, j) => {
                const x = labelW + j * cell
                const y = 26 + i * cell
                if (a === b) return <rect key={b} x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} fill={C.wash} />
                const u = pair(a, b)
                if (!u) return <rect key={b} x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} fill="#fff" stroke={C.grid} />
                const v = u[mode]
                const fill = diverging(v, center, span)
                const thin = u.min < 150
                return (
                  <g key={b} onMouseEnter={() => setHover({ a, b, u, x: x + cell / 2, y })} onMouseLeave={() => setHover(null)}>
                    <rect x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} rx={3} fill={fill} opacity={thin ? 0.45 : 1} />
                    <text x={x + cell / 2} y={y + cell / 2 + 4} textAnchor="middle" className="rich-cell" fill={thin ? C.ink : textOn(fill)}>
                      {v > 0 ? '+' : ''}{cell < 40 ? Math.round(v) : v.toFixed(1)}
                    </text>
                  </g>
                )
              })}
            </g>
          ))}
        </svg>
        {hover && (
          <Tip x={hover.x} y={hover.y} w={w}>
            <strong>{hover.a} + {hover.b}</strong>
            <div>{Math.round(hover.u.min)} minutes · {hover.u.poss} possessions</div>
            <div>Raw {hover.u.net > 0 ? '+' : ''}{hover.u.net.toFixed(1)} · Luck-adjusted {hover.u.adj > 0 ? '+' : ''}{hover.u.adj.toFixed(1)} · Sample-adjusted {hover.u.est > 0 ? '+' : ''}{hover.u.est.toFixed(1)}</div>
            {hover.u.min < 150 && <div className="muted">Under 150 minutes: read the sample-adjusted number.</div>}
          </Tip>
        )}
      </div>
    </Frame>
  )
}
