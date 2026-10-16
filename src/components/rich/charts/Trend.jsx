import { useMemo, useState } from 'react'
import { C, Frame, PLAYER_COLOR, Seg, Slider, Tip, YAxis, scale, ticks, useJson, useWidth } from './kit.jsx'

const STATS = {
  '3P%': { made: 2, att: 3, lg: 36.0, fmt: (v) => `${v.toFixed(1)}%` },
  'FT%': { made: 4, att: 5, lg: 78.3, fmt: (v) => `${v.toFixed(1)}%` },
  'Turnovers / 36': { per36: 6, fmt: (v) => v.toFixed(1) },
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Trend({ base, data, title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const [stat, setStat] = useState('3P%')
  const [win, setWin] = useState(25)
  const [ref, w] = useWidth()
  const [hx, setHx] = useState(null)
  const series = useMemo(() => {
    if (!d) return []
    const S = STATS[stat]
    return Object.entries(d.players).map(([who, games]) => {
      const pts = []
      for (let i = win - 1; i < games.length; i++) {
        const slice = games.slice(i - win + 1, i + 1)
        let v
        if (S.per36) {
          const mins = slice.reduce((a, g) => a + g[8], 0)
          v = mins ? (36 * slice.reduce((a, g) => a + g[S.per36], 0)) / mins : null
        } else {
          const a = slice.reduce((s, g) => s + g[S.att], 0)
          v = a ? (100 * slice.reduce((s, g) => s + g[S.made], 0)) / a : null
        }
        if (v != null) pts.push({ t: Date.parse(games[i][0]), v, g: games[i], n: i + 1 })
      }
      return { who, pts }
    })
  }, [d, stat, win])
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const all = series.flatMap((s) => s.pts)
  if (!all.length) return null
  const S = STATS[stat]
  const h = Math.min(380, Math.max(280, w * 0.55))
  const m = { l: 46, r: 16, t: 16, b: 40 }
  const t0 = Math.min(...all.map((p) => p.t))
  const t1 = Math.max(...all.map((p) => p.t))
  const vs = all.map((p) => p.v)
  const vlo = Math.floor((Math.min(...vs, S.lg ?? Infinity) - 2) / 5) * 5
  const vhi = Math.ceil((Math.max(...vs, S.lg ?? -Infinity) + 2) / 5) * 5
  const x = scale(t0, t1, m.l, w - m.r)
  const y = scale(vlo, vhi, h - m.b, m.t)
  const poStart = Math.min(...Object.values(d.players).flatMap((g) => g.filter((r) => r[1]).map((r) => Date.parse(r[0]))))
  const monthTicks = []
  const dt = new Date(t0)
  dt.setUTCDate(1)
  while (dt.getTime() <= t1) {
    if (dt.getTime() >= t0) monthTicks.push(dt.getTime())
    dt.setUTCMonth(dt.getUTCMonth() + 1)
  }
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const near = (pts, t) => {
    let best = null
    for (const p of pts) if (p.t <= t) best = p
    return best
  }
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = Math.min(Math.max(e.clientX - r.left, m.l), w - m.r)
    setHx(px)
  }
  const ht = hx != null ? x.invert(hx) : null
  return (
    <Frame title={title} caption={caption} source={source}>
      <div className="rich-controls">
        <Seg label="Stat" value={stat} onChange={setStat} options={Object.keys(STATS)} />
        <Slider id="trend-win" label="Rolling window" value={win} min={10} max={40} step={5} onChange={setWin} format={(v) => `${v} games`} />
      </div>
      <div className="rich-legend">
        {series.map((s) => (
          <span key={s.who}><i className="line" style={{ background: PLAYER_COLOR[s.who] }} />{s.who}</span>
        ))}
      </div>
      <div ref={ref} className="rich-plot">
        <svg width={w} height={h} onMouseMove={onMove} onMouseLeave={() => setHx(null)} role="img" aria-label={`Rolling ${stat} over ${win} games`}>
          <rect x={x(poStart)} y={m.t} width={Math.max(0, x(t1) - x(poStart))} height={h - m.b - m.t} fill={C.wash} />
          <text x={x(poStart) + 6} y={m.t + 14} className="rich-ann">Playoffs</text>
          <YAxis y={y} ticks={ticks(vlo, vhi, 5)} x0={m.l} x1={w - m.r} format={(v) => (stat === 'Turnovers / 36' ? v : `${v}%`)} height={h} />
          {monthTicks.map((t) => (
            <text key={t} x={x(t)} y={h - m.b + 18} textAnchor="middle" className="rich-tick">{MONTHS[new Date(t).getUTCMonth()]}</text>
          ))}
          {S.lg != null && (
            <g>
              <line x1={m.l} x2={w - m.r} y1={y(S.lg)} y2={y(S.lg)} stroke={C.gold} strokeWidth={1.5} />
            </g>
          )}
          {series.map((s) => (
            <g key={s.who}>
              <path d={path(s.pts)} fill="none" stroke={PLAYER_COLOR[s.who]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.pts.length > 0 && (
                <circle cx={x(s.pts[s.pts.length - 1].t)} cy={y(s.pts[s.pts.length - 1].v)} r={4} fill={PLAYER_COLOR[s.who]} stroke="#fff" strokeWidth={2} />
              )}
            </g>
          ))}
          {S.lg != null && <text x={m.l + 4} y={y(S.lg) - 5} className="rich-ann halo">League average</text>}
          {hx != null && (
            <g>
              <line x1={hx} x2={hx} y1={m.t} y2={h - m.b} stroke={C.ink} strokeWidth={1} opacity={0.4} />
              {series.map((s) => {
                const p = near(s.pts, ht)
                return p ? <circle key={s.who} cx={x(p.t)} cy={y(p.v)} r={4.5} fill={PLAYER_COLOR[s.who]} stroke="#fff" strokeWidth={2} /> : null
              })}
            </g>
          )}
        </svg>
        {hx != null && (
          <Tip x={hx} y={m.t + 10} w={w}>
            <strong>{new Date(ht).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</strong>
            {series.map((s) => {
              const p = near(s.pts, ht)
              return p ? (
                <div key={s.who}>
                  <i className="tip-sw" style={{ background: PLAYER_COLOR[s.who] }} />
                  {s.who}: {S.fmt(p.v)} <span className="muted">over his last {win} games</span>
                </div>
              ) : null
            })}
          </Tip>
        )}
      </div>
    </Frame>
  )
}
