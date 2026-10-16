import { useState } from 'react'
import { DataTable, Frame, PLAYER_COLOR, Seg, Slider, useJson } from './kit.jsx'

const CORE = ['Fox', 'Castle', 'Harper', 'Wemby', 'Vassell', 'Champagnie', 'K. Johnson', 'Barnes', 'Kornet']
const signed = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`

export default function LineupExplorer({ base, data, title, caption, source }) {
  const { data: d } = useJson(`${base}/${data}`)
  const [size, setSize] = useState(5)
  const [part, setPart] = useState('rs')
  const [inc, setInc] = useState([])
  const [minMin, setMinMin] = useState(10)
  if (!d) return <Frame title={title} caption={caption} source={source}><div className="rich-chart-loading" /></Frame>
  const units = (d[`${part}${size}`] || []).filter((u) => u.min >= minMin && inc.every((p) => u.p.includes(p)))
  const rows = units.map((u) => ({
    players: u.p.map((n) => n.replace(/^[A-Z]\. /, '')).join(' · '),
    min: Math.round(u.min),
    poss: u.poss,
    pm: u.pm > 0 ? `+${u.pm}` : `${u.pm}`,
    pm__sort: u.pm,
    ortg: u.ortg.toFixed(1),
    drtg: u.drtg.toFixed(1),
    net: signed(u.net),
    adj: signed(u.adj),
    est: signed(u.est),
    trio: ['Fox', 'Castle', 'Harper'].every((p) => u.p.includes(p)),
  }))
  const cols = [
    { k: 'players', label: 'Players' },
    { k: 'min', label: 'Min', align: 'r' },
    { k: 'poss', label: 'Poss', align: 'r' },
    { k: 'pm', label: '+/−', align: 'r' },
    { k: 'ortg', label: 'ORtg', align: 'r' },
    { k: 'drtg', label: 'DRtg', align: 'r' },
    { k: 'net', label: 'Net', align: 'r' },
    { k: 'adj', label: 'Luck-adj', align: 'r' },
    { k: 'est', label: 'Sample-adj', align: 'r' },
  ]
  const toggle = (p) => setInc((s) => (s.includes(p) ? s.filter((q) => q !== p) : s.length >= size ? s : [...s, p]))
  return (
    <Frame title={title} caption={caption} source={source} wide>
      <div className="rich-controls">
        <Seg label="Group size" value={size} onChange={(v) => { setSize(v); setInc((s) => s.slice(0, v)) }} options={[2, 3, 4, 5].map((v) => ({ value: v, label: `${v}-man` }))} />
        <Seg label="Games" value={part} onChange={setPart} options={[{ value: 'rs', label: 'Regular season' }, { value: 'po', label: 'Playoffs' }]} />
      </div>
      <div className="rich-chips" role="group" aria-label="Must include">
        <span className="rich-ctl-label">Must include</span>
        {CORE.map((p) => (
          <button key={p} type="button" aria-pressed={inc.includes(p)} className={inc.includes(p) ? 'on' : ''} onClick={() => toggle(p)}>
            <span className="sw" style={{ background: PLAYER_COLOR[p] || '#8d8a83' }} aria-hidden="true" />
            {p}
          </button>
        ))}
        {inc.length > 0 && <button type="button" className="rich-linkbtn" onClick={() => setInc([])}>Clear</button>}
      </div>
      <div className="rich-controls">
        <Slider id="lu-min" label="At least" value={minMin} min={0} max={200} step={5} onChange={setMinMin} format={(v) => `${v} min`} />
        <span className="rich-ctl-note">{rows.length} {rows.length === 1 ? 'group' : 'groups'} · click a column to sort</span>
      </div>
      {rows.length ? (
        <DataTable cols={cols} rows={rows} sortable compact max={15} highlight={(r) => r.trio} />
      ) : (
        <p className="rich-empty">No {size}-man group with those players reached {minMin} minutes. Lower the minutes or switch to the playoffs.</p>
      )}
    </Frame>
  )
}
