import { useState } from 'react'
import { C, Frame, playerColor, scale, useJson, useWidth } from './kit.jsx'

export default function UsageBuilder({ base, data, initial = [], title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const [pick, setPick] = useState(initial)
  const [ref, w] = useWidth()
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const roster = d.roster.filter((r) => r.usg != null)
  const chosen = pick.map((s) => roster.find((r) => r.short === s)).filter(Boolean)
  const total = chosen.reduce((a, r) => a + r.usg, 0)
  const over = total - 100
  const max = Math.max(130, Math.ceil((total + 6) / 10) * 10)
  const pad = 8
  const x = scale(0, max, pad, w - pad)
  const toggle = (s) =>
    setPick((p) => (p.includes(s) ? p.filter((q) => q !== s) : p.length >= 5 ? p : [...p, s]))

  let acc = 0
  const segs = chosen.map((r) => {
    const s = { r, x0: x(acc), x1: x(acc + r.usg) }
    acc += r.usg
    return s
  })
  const table = {
    cols: [
      { k: 'name', label: 'Player' },
      { k: 'usg', label: 'Usage %', align: 'r' },
      { k: 'ast', label: 'Assist %', align: 'r' },
      { k: 'tov', label: 'Turnover %', align: 'r' },
    ],
    rows: roster.map((r) => ({ name: r.name, usg: r.usg?.toFixed(1), ast: r.ast?.toFixed(1), tov: r.tov?.toFixed(1) })),
  }
  return (
    <Frame title={title} caption={caption} source={source} table={table}>
      <div className="rich-chips" role="group" aria-label="Choose five players">
        {roster.map((r) => {
          const on = pick.includes(r.short)
          return (
            <button key={r.short} type="button" aria-pressed={on} disabled={!on && pick.length >= 5} className={on ? 'on' : ''} onClick={() => toggle(r.short)}>
              <span className="sw" style={{ background: playerColor(r.short) }} aria-hidden="true" />
              {r.short}
              <span className="v">{r.usg.toFixed(1)}</span>
            </button>
          )
        })}
      </div>
      <div ref={ref} className="rich-usage">
        <svg width={w} height={92} role="img" aria-label={`Combined usage ${total.toFixed(1)} percent`}>
          <rect x={x(0)} y={30} width={x(max) - x(0)} height={30} fill={C.wash} rx={4} />
          {segs.map(({ r, x0, x1 }, i) => {
            const width = Math.max(0, x1 - x0 - 2)
            const full = `${r.short} ${r.usg.toFixed(1)}`
            const num = r.usg.toFixed(1)
            const label = width > full.length * 6.6 + 10 ? full : width > num.length * 6.6 + 8 ? num : ''
            const fits = Boolean(label)
            return (
              <g key={r.short}>
                <rect x={x0 + (i ? 1 : 0)} y={30} width={width} height={30} rx={i === segs.length - 1 ? 4 : 0} fill={playerColor(r.short)} opacity={0.92}>
                  <title>{`${r.name}: ${r.usg.toFixed(1)}% usage`}</title>
                </rect>
                {fits && (
                  <text x={x0 + width / 2 + (i ? 1 : 0)} y={49} textAnchor="middle" className="rich-seg-label">{label}</text>
                )}
              </g>
            )
          })}
          <line x1={x(100)} x2={x(100)} y1={18} y2={70} stroke={C.gold} strokeWidth={2} />
          <text x={x(100)} y={13} textAnchor="middle" className="rich-ann">100%</text>
          {over > 0 && (
            <g>
              <line x1={x(100)} x2={x(total)} y1={78} y2={78} stroke={C.ink} strokeWidth={1} />
              <line x1={x(total)} x2={x(total)} y1={73} y2={83} stroke={C.ink} strokeWidth={1} />
              <text x={(x(100) + x(total)) / 2} y={90} textAnchor="middle" className="rich-ann">+{over.toFixed(1)} to give up</text>
            </g>
          )}
        </svg>
      </div>
      <div className="rich-readout">
        <div>
          <span className="k">Combined usage</span>
          <span className="big">{total.toFixed(1)}%</span>
        </div>
        <div>
          <span className="k">{chosen.length < 5 ? `Pick ${5 - chosen.length} more` : over > 0 ? 'Over the 100% budget' : 'Room left'}</span>
          <span className="big">{chosen.length < 5 ? '' : `${over > 0 ? '+' : ''}${over.toFixed(1)}`}</span>
        </div>
      </div>
    </Frame>
  )
}
