// Shared pieces for the interactive article charts: sizing, scales, ticks, colors, the
// tooltip and the frame every chart sits in (title, caption, source, and a data-table view).
import { useCallback, useEffect, useRef, useState } from 'react'

// Player identity colors. Validated as a set (scripts in the dataviz method): blue, orange and
// green pass every all-pairs check on white; violet joins them only where series are adjacent
// (lines), never in a scatter. Everyone else is the neutral gray.
export const PLAYER_COLOR = {
  Castle: '#2a78d6',
  Harper: '#eb6834',
  Fox: '#199e70',
  Wemby: '#6250d6',
}
export const C = {
  ink: '#191b1f',
  muted: '#4e535b',
  faint: '#676c75',
  grid: '#e6e4df',
  axis: '#c9c6bf',
  surface: '#ffffff',
  wash: '#f4f3f0',
  gold: '#c2a263',
  goldDeep: '#96793f',
  navy: '#22395a',
  neutral: '#b5b1a8',
  neutralDark: '#8d8a83',
  pos: '#bc3a2c',
  neg: '#1c4e86',
}
export const playerColor = (short) => PLAYER_COLOR[short] || C.neutralDark

// Width of a container, kept in sync with the layout.
// Measures an element's width. A callback ref, so it attaches whenever the element mounts:
// most charts render a loading frame first and only mount the measured element once their
// data arrives, which a mount-time effect would miss.
export function useWidth(initial = 640) {
  const [w, setW] = useState(initial)
  const ro = useRef(null)
  const ref = useCallback((el) => {
    if (ro.current) {
      ro.current.disconnect()
      ro.current = null
    }
    if (!el) return
    if (el.clientWidth) setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    ro.current = new ResizeObserver((entries) => {
      const cw = Math.round(entries[0].contentRect.width)
      if (cw > 0) setW(cw)
    })
    ro.current.observe(el)
  }, [])
  return [ref, w]
}

export function scale(d0, d1, r0, r1) {
  const k = (r1 - r0) / (d1 - d0 || 1)
  const f = (v) => r0 + (v - d0) * k
  f.invert = (p) => d0 + (p - r0) / k
  return f
}

// Clean tick values between lo and hi.
export function ticks(lo, hi, count = 5) {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

export const fmt = {
  pct1: (v) => (v == null || Number.isNaN(v) ? '' : `${v.toFixed(1)}%`),
  dec1: (v) => (v == null || Number.isNaN(v) ? '' : v.toFixed(1)),
  dec3: (v) => (v == null || Number.isNaN(v) ? '' : v.toFixed(3)),
  signed: (v) => (v == null || Number.isNaN(v) ? '' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`),
}

export function useJson(url) {
  const [state, set] = useState({ data: null, error: null })
  useEffect(() => {
    if (!url) return
    let alive = true
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then((data) => alive && set({ data, error: null }))
      .catch((error) => alive && set({ data: null, error }))
    return () => {
      alive = false
    }
  }, [url])
  return state
}

// A floating label that follows the pointer inside a chart.
export function Tip({ x, y, w, children }) {
  if (x == null) return null
  const left = Math.min(Math.max(x + 14, 4), Math.max(4, w - 220))
  return (
    <div className="rich-tip" style={{ left, top: Math.max(0, y - 10) }} role="status">
      {children}
    </div>
  )
}

// Segmented control used above charts.
export function Seg({ options, value, onChange, label }) {
  return (
    <div className="rich-seg" role="group" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o
        const l = typeof o === 'object' ? o.label : o
        return (
          <button key={v} type="button" aria-pressed={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {l}
          </button>
        )
      })}
    </div>
  )
}

export function Slider({ label, value, min, max, step = 1, onChange, format = (v) => v, id }) {
  return (
    <label className="rich-slider" htmlFor={id}>
      <span className="rich-slider-label">{label}</span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="rich-slider-val">{format(value)}</span>
    </label>
  )
}

// The frame: title, the chart, caption, source, and an optional data-table view so every
// value can be read without hovering.
export function Frame({ title, caption, source, table, children, wide = false }) {
  const [showTable, setShowTable] = useState(false)
  return (
    <figure className={`rich-figure${wide ? ' rich-wide' : ''}`}>
      <div className="rich-figure-head">
        <span className="rich-fig-kicker">Interactive</span>
        <h4 className="rich-figure-title">{title}</h4>
      </div>
      <div className="rich-figure-body">{showTable && table ? <DataTable {...table} /> : children}</div>
      <figcaption className="rich-figcaption">
        {caption && <p>{caption}</p>}
        <div className="rich-figcaption-row">
          {source && <span className="rich-source">Source: {source}</span>}
          {table && (
            <button type="button" className="rich-linkbtn" onClick={() => setShowTable((s) => !s)}>
              {showTable ? 'Show chart' : 'Show data'}
            </button>
          )}
        </div>
      </figcaption>
    </figure>
  )
}

export function DataTable({ cols, rows, sortable = false, highlight, compact = false, max }) {
  const [sort, setSort] = useState(null)
  const [limit, setLimit] = useState(max || Infinity)
  let shown = rows
  if (sort) {
    const { k, dir } = sort
    shown = [...rows].sort((a, b) => {
      const av = a[`${k}__sort`] ?? a[k]
      const bv = b[`${k}__sort`] ?? b[k]
      const an = typeof av === 'number' ? av : parseFloat(String(av).replace(/[^\d.-]/g, ''))
      const bn = typeof bv === 'number' ? bv : parseFloat(String(bv).replace(/[^\d.-]/g, ''))
      const both = !Number.isNaN(an) && !Number.isNaN(bn)
      const c = both ? an - bn : String(av).localeCompare(String(bv))
      return dir === 'asc' ? c : -c
    })
  }
  const total = shown.length
  shown = shown.slice(0, limit)
  return (
    <div className={`rich-table-wrap${compact ? ' compact' : ''}`}>
      <table className="rich-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.k} className={c.align === 'r' ? 'r' : ''} scope="col">
                {sortable ? (
                  <button
                    type="button"
                    onClick={() => setSort((s) => (s && s.k === c.k ? { k: c.k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { k: c.k, dir: 'desc' }))}
                    aria-label={`Sort by ${c.label}`}
                  >
                    {c.label}
                    <span aria-hidden="true" className="rich-sort">{sort && sort.k === c.k ? (sort.dir === 'desc' ? '▼' : '▲') : ''}</span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className={highlight && highlight(r) ? 'hl' : ''}>
              {cols.map((c) => (
                <td key={c.k} className={c.align === 'r' ? 'r' : ''}>
                  {c.render ? c.render(r) : r[c.k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total > limit && (
        <button type="button" className="rich-linkbtn rich-more" onClick={() => setLimit(Infinity)}>
          Show all {total} rows
        </button>
      )}
    </div>
  )
}

// Horizontal axis with gridlines, drawn inside an <svg>.
export function XAxis({ x, ticks: tv, y0, y1, format = (v) => v, label, width }) {
  return (
    <g className="rich-axis">
      {tv.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={y0} y2={y1} stroke={C.grid} />
          <text x={x(t)} y={y1 + 16} textAnchor="middle">{format(t)}</text>
        </g>
      ))}
      {label && (
        <text x={width / 2} y={y1 + 34} textAnchor="middle" className="rich-axis-label">{label}</text>
      )}
    </g>
  )
}

export function YAxis({ y, ticks: tv, x0, x1, format = (v) => v, label, height }) {
  return (
    <g className="rich-axis">
      {tv.map((t) => (
        <g key={t}>
          <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke={C.grid} />
          <text x={x0 - 8} y={y(t) + 4} textAnchor="end">{format(t)}</text>
        </g>
      ))}
      {label && (
        <text transform={`translate(12 ${height / 2}) rotate(-90)`} textAnchor="middle" className="rich-axis-label">{label}</text>
      )}
    </g>
  )
}

export const ord = (n) => {
  const v = Math.round(n)
  const s = v % 100 >= 11 && v % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'
  return `${v}${s}`
}

// Diverging color around a center: blue below, red above, gray at the center (WCE's percentile
// convention: red is good).
function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}
export function diverging(v, center, span) {
  const t = Math.max(-1, Math.min(1, (v - center) / span))
  return t >= 0 ? mix('#ece9e3', C.pos, t) : mix('#ece9e3', C.neg, -t)
}
export const textOn = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? C.ink : '#ffffff'
}

// Greedy direct-label placement for a handful of dots. Each label tries eight spots around its
// dot and takes the first one that stays inside the plot and clears every dot and every label
// placed before it; if none is clear it takes the spot with the least overlap. Items earlier in
// the list get first pick, so pass the most important dots first.
export function placeLabels(items, { x0, x1, y0, y1, charW = 6.6, lineH = 13, gap = 4 } = {}) {
  const box = (x, y, anchor, text) => {
    const tw = text.length * charW
    const left = anchor === 'start' ? x : anchor === 'end' ? x - tw : x - tw / 2
    return { l: left, r: left + tw, t: y - lineH + 3, b: y + 3 }
  }
  const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))
  const dots = items.map((it) => ({ l: it.cx - it.r, r: it.cx + it.r, t: it.cy - it.r, b: it.cy + it.r }))
  const placed = []
  const out = {}
  for (const it of items) {
    const r = it.r + gap
    const cands = [
      [it.cx + r, it.cy + 4, 'start'],
      [it.cx - r, it.cy + 4, 'end'],
      [it.cx, it.cy - r - 1, 'middle'],
      [it.cx, it.cy + r + lineH - 2, 'middle'],
      [it.cx + r - 2, it.cy - r + 1, 'start'],
      [it.cx + r - 2, it.cy + r + lineH - 4, 'start'],
      [it.cx - r + 2, it.cy - r + 1, 'end'],
      [it.cx - r + 2, it.cy + r + lineH - 4, 'end'],
    ]
    let best = null
    for (const [x, y, anchor] of cands) {
      const b = box(x, y, anchor, it.text)
      const outside = Math.max(0, x0 - b.l) + Math.max(0, b.r - x1) + Math.max(0, y0 - b.t) + Math.max(0, b.b - y1)
      const hit = placed.reduce((s, p) => s + area(b, p), 0) + dots.reduce((s, d) => s + area(b, d), 0)
      const cost = outside * 1000 + hit
      if (!best || cost < best.cost) best = { x, y, anchor, b, cost }
      if (cost === 0) break
    }
    placed.push(best.b)
    out[it.id] = { x: best.x, y: best.y, textAnchor: best.anchor }
  }
  return out
}
