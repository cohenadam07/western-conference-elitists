import { useMemo, useState } from 'react'
import { C, Frame, PLAYER_COLOR, Seg, Slider, useJson, useWidth } from './kit.jsx'

const LINEUPS = {
  last: { label: "Last season's starters", five: ['Fox', 'Castle', 'Vassell', 'Champagnie', 'Wemby'] },
  phx: { label: 'Phoenix start', five: ['Fox', 'Castle', 'Harper', 'Vassell', 'Wemby'] },
  champ: { label: 'Three guards + Champagnie', five: ['Fox', 'Castle', 'Harper', 'Champagnie', 'Wemby'] },
  alt: { label: 'The alternative five', five: ['Harper', 'Castle', 'Vassell', 'Champagnie', 'Wemby'] },
}
const DRIVERS = ['Fox', 'Castle', 'Harper', 'Vassell']
// Court positions in a 100 x 94 half court (basket near the bottom).
const SPOTS = [
  { k: 'top', x: 50, y: 22 },
  { k: 'lw', x: 15, y: 40 },
  { k: 'rw', x: 85, y: 40 },
  { k: 'lc', x: 6, y: 84 },
  { k: 'rc', x: 94, y: 84 },
]
const DUNKER = { x: 66, y: 80 }

// For a given drive, the defense helps off whichever teammate's open three costs least.
function solve(five, driver, wop, q, v0, v1) {
  const others = five.filter((p) => p !== driver && p !== 'Wemby')
  const cost = others.map((p) => ({ p, ev: (1 - q) * v1 + q * 3 * (wop[p] / 100) }))
  cost.sort((a, b) => a.ev - b.ev)
  const best = cost[0]
  const helps = best && best.ev < v0
  return { cost, helper: helps ? best.p : null, ev: helps ? best.ev : v0 }
}

export default function SpacingCourt({ base, data, title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const [lu, setLu] = useState('phx')
  const [driver, setDriver] = useState('Fox')
  const [q, setQ] = useState(0.4)
  const [v0, setV0] = useState(1.25)
  const [v1, setV1] = useState(0.95)
  const [edits, setEdits] = useState({})
  const [showAssume, setShowAssume] = useState(false)
  const [ref, w] = useWidth()
  const wop = useMemo(() => {
    const o = {}
    if (d) for (const r of d.roster) o[r.short] = edits[r.short] ?? r.wop ?? 35
    return o
  }, [d, edits])
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const five = LINEUPS[lu].five
  const drv = five.includes(driver) ? driver : five.find((p) => DRIVERS.includes(p))
  const res = solve(five, drv, wop, q, v0, v1)
  const ref5 = LINEUPS.last.five
  const refDrv = ref5.includes(drv) ? drv : 'Fox'
  const refRes = solve(ref5, refDrv, wop, q, v0, v1)

  // Place players: driver at the top, the other three perimeter players on the wings and a corner,
  // Wembanyama in the dunker spot.
  const perim = five.filter((p) => p !== drv && p !== 'Wemby')
  const placed = [{ p: drv, ...SPOTS[0] }, { p: perim[0], ...SPOTS[1] }, { p: perim[1], ...SPOTS[2] }, { p: perim[2], ...SPOTS[3] }]
  if (five.includes('Wemby')) placed.push({ p: 'Wemby', ...DUNKER })
  const cw = Math.min(w, 560)
  const sx = (v) => (v / 100) * cw
  const ch = cw * 0.86
  const sy = (v) => (v / 94) * ch
  const basket = { x: 50, y: 88 }
  const helperSpot = placed.find((s) => s.p === res.helper)
  const color = (p) => PLAYER_COLOR[p] || C.neutralDark

  return (
    <Frame title={title} caption={caption} source={source}>
      <div className="rich-controls">
        <Seg label="Lineup" value={lu} onChange={setLu} options={Object.entries(LINEUPS).map(([k, v]) => ({ value: k, label: v.label }))} />
      </div>
      <div className="rich-controls">
        <span className="rich-ctl-label">Who drives</span>
        <Seg label="Driver" value={drv} onChange={setDriver} options={five.filter((p) => DRIVERS.includes(p))} />
      </div>
      <div className="rich-court-wrap" ref={ref}>
        <svg width={cw} height={ch} className="rich-court" role="img" aria-label={`Help defense: ${res.helper ? `the defense helps off ${res.helper}` : 'no help'}`}>
          <rect x={0} y={0} width={cw} height={ch} fill="#f7f4ec" rx={6} />
          {/* lines */}
          <g fill="none" stroke="#d8cfb9" strokeWidth={1.5}>
            <rect x={sx(33)} y={sy(57)} width={sx(34)} height={sy(37)} />
            <circle cx={sx(50)} cy={sy(57)} r={sx(12)} />
            <path d={`M ${sx(12)} ${sy(94)} L ${sx(12)} ${sy(76)} A ${sx(38.1)} ${sy(38.1)} 0 0 1 ${sx(88)} ${sy(76)} L ${sx(88)} ${sy(94)}`} />
            <line x1={sx(44)} x2={sx(56)} y1={sy(90)} y2={sy(90)} />
          </g>
          <circle cx={sx(basket.x)} cy={sy(basket.y)} r={sx(1.8)} fill="none" stroke={C.gold} strokeWidth={2} />
          {/* drive arrow */}
          <defs>
            <marker id="sp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill={C.ink} />
            </marker>
            <marker id="sp-arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill={C.pos} />
            </marker>
          </defs>
          <line x1={sx(50)} y1={sy(26)} x2={sx(52)} y2={sy(70)} stroke={C.ink} strokeWidth={2} markerEnd="url(#sp-arrow)" />
          {helperSpot && (
            <g>
              <line x1={sx(helperSpot.x + (helperSpot.x < 50 ? 5 : -5))} y1={sy(helperSpot.y + 4)} x2={sx(helperSpot.x < 50 ? 44 : 58)} y2={sy(70)} stroke={C.pos} strokeWidth={2} markerEnd="url(#sp-arrow-red)" />
              <text x={sx(helperSpot.x < 50 ? 30 : 70)} y={sy(63)} textAnchor="middle" className="rich-ann red">help</text>
            </g>
          )}
          {placed.map((s) => {
            const left = s.p === res.helper
            // Wing and corner labels hug the side of the court they sit on so they never run off it.
            const side = s.x <= 20 ? 'start' : s.x >= 80 ? 'end' : 'middle'
            const lx = sx(s.x) + (side === 'start' ? -12 : side === 'end' ? 12 : 0)
            const lxClamped = side === 'start' ? Math.max(4, lx) : side === 'end' ? Math.min(cw - 4, lx) : lx
            return (
              <g key={s.p}>
                <circle cx={sx(s.x)} cy={sy(s.y)} r={14} fill={color(s.p)} stroke={left ? C.pos : '#fff'} strokeWidth={left ? 3 : 2} />
                <text x={sx(s.x)} y={sy(s.y) + 4} textAnchor="middle" className="rich-court-initial">{s.p[0]}</text>
                <text x={lxClamped} y={sy(s.y) - 20} textAnchor={side} className="rich-court-name">{s.p}</text>
                {s.p !== drv && s.p !== 'Wemby' && (
                  <text x={lxClamped} y={sy(s.y) + (s.y > 80 ? -34 : 30)} textAnchor={side} className={`rich-court-pct${left ? ' red' : ''}`}>{wop[s.p].toFixed(1)}% open{left ? (cw < 420 ? ', left' : ' · left open') : ''}</text>
                )}
              </g>
            )
          })}
        </svg>
        <div className="rich-court-side">
          <div className="rich-readout col">
            <div>
              <span className="k">Defense helps off</span>
              <span className="big">{res.helper || 'nobody'}</span>
            </div>
            <div>
              <span className="k">Points per helped {drv} drive</span>
              <span className="big">{res.ev.toFixed(2)}</span>
            </div>
            {lu !== 'last' && (
              <div>
                <span className="k">vs. last season's starters ({refDrv} driving, help off {refRes.helper || 'nobody'})</span>
                <span className="big">{(res.ev - refRes.ev >= 0 ? '+' : '−') + Math.abs(res.ev - refRes.ev).toFixed(2)}</span>
              </div>
            )}
          </div>
          <table className="rich-mini">
            <thead><tr><th>If he's left open</th><th className="r">Drive worth</th></tr></thead>
            <tbody>
              {res.cost.map((c) => (
                <tr key={c.p} className={c.p === res.helper ? 'hl' : ''}><td>{c.p}</td><td className="r">{c.ev.toFixed(2)}</td></tr>
              ))}
              <tr><td>Nobody helps</td><td className="r">{v0.toFixed(2)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="rich-controls rich-controls-col">
        {five.filter((p) => p !== 'Wemby').map((p) => (
          <Slider key={p} id={`wop-${p}`} label={`${p}: wide-open 3P%`} value={wop[p]} min={25} max={55} step={0.5} onChange={(v) => setEdits((e) => ({ ...e, [p]: v }))} format={(v) => `${v.toFixed(1)}%`} />
        ))}
        <button type="button" className="rich-linkbtn" onClick={() => setShowAssume((s) => !s)}>{showAssume ? 'Hide' : 'Change'} the model's assumptions</button>
        {showAssume && (
          <>
            <Slider id="sp-q" label="Chance a helped drive becomes a kick-out (q)" value={q} min={0.1} max={0.8} step={0.05} onChange={setQ} format={(v) => v.toFixed(2)} />
            <Slider id="sp-v0" label="Points from an unhelped drive (V0)" value={v0} min={0.9} max={1.6} step={0.05} onChange={setV0} format={(v) => v.toFixed(2)} />
            <Slider id="sp-v1" label="Points when he finishes through help (V1)" value={v1} min={0.6} max={1.2} step={0.05} onChange={setV1} format={(v) => v.toFixed(2)} />
          </>
        )}
      </div>
    </Frame>
  )
}
