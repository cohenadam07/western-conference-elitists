import { useEffect, useRef, useState } from 'react'

/* Primitives for the Front Office interface. Deliberately plain CSS classes (gm.css)
   rather than Tailwind — this screen should share nothing with the rest of the site. */

// A figure that counts up to its value is the cheapest way to make a screen feel alive,
// and it doubles as a signal that the number just changed.
export function useCountUp(value, ms = 480) {
  const [v, setV] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now(), a = from.current, b = value
    if (a === b) return undefined
    let raf = 0
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms)
      const e = 1 - ((1 - t) ** 3)
      setV(a + (b - a) * e)
      if (t < 1) raf = requestAnimationFrame(step)
      else { from.current = b; setV(b) }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return v
}

export const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US')
export const short = (n) => (n < 0 ? '−$' : '$') + (Math.abs(n || 0) / 1e6).toFixed(1) + 'M'

export function Card({ title, note, children, flush, style }) {
  return (
    <section className="fo-card" style={style}>
      {title && <h3><span className="tick" />{title}{note && <span className="note">{note}</span>}</h3>}
      <div className={`fo-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  )
}

/* Every number on this screen can explain itself — the design brief asked for it and it
   is also how a user learns the CBA without reading it. */
// A className passed in is MERGED rather than replacing `fo-tip`. Spreading rest over the
// top silently dropped the tooltip class from any wrapper that also wanted styling of its
// own, which is a failure that looks like nothing at all.
export function Tip({ tip, children, right, as: As = 'span', className = '', ...rest }) {
  return (
    <As className={`fo-tip${right ? ' right' : ''}${className ? ` ${className}` : ''}`}
      data-tip={tip} tabIndex={0} {...rest}>
      {children}
    </As>
  )
}

export function Ring({ value, size = 64, label = 'OVR', floor = 50, stroke = 'var(--acc)' }) {
  const r = 15.5, C = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, ((value || 0) - floor) / (100 - floor)))
  return (
    <span className="fo-ring" style={{ width: size, height: size, display: 'inline-block' }}>
      <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" stroke="#222836" strokeWidth="3.4" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={stroke} strokeWidth="3.4"
          strokeLinecap="round" strokeDasharray={C.toFixed(1)}
          strokeDashoffset={(C * (1 - pct)).toFixed(1)} transform="rotate(-90 18 18)"
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.8,.3,1)' }} />
      </svg>
      <span className="lbl"><b>{Math.round(value || 0)}</b><span>{label}</span></span>
    </span>
  )
}

export function Donut({ parts, center, sub, size = 158 }) {
  const R = size * 0.37, CX = size / 2, CY = size / 2, W = size * 0.12
  const sum = parts.reduce((s, p) => s + p.v, 0) || 1
  let a = -Math.PI / 2
  const arcs = parts.map((p, i) => {
    const a1 = a + (p.v / sum) * Math.PI * 2
    const x0 = CX + R * Math.cos(a), y0 = CY + R * Math.sin(a)
    const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1)
    const d = `M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${a1 - a > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`
    a = a1 + 0.035
    return <path key={i} d={d} fill="none" stroke={p.c} strokeWidth={W} />
  })
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Payroll breakdown">
      {arcs}
      <text x={CX} y={CY - 3} textAnchor="middle" fill="#EAEDF3"
        fontFamily="Inter Tight" fontSize={size * 0.13} fontWeight="700">{center}</text>
      <text x={CX} y={CY + 14} textAnchor="middle" fill="#5B6478"
        fontFamily="IBM Plex Mono" fontSize={size * 0.052} letterSpacing="1.6">{sub}</text>
    </svg>
  )
}

/* The arena is drawn, not photographed — 30 licensed building shots is an asset problem,
   and a canvas recolours itself to whichever club you took. */
export function Arena() {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    // No 2d context means no arena — a headless DOM, a printing context, an old browser.
    // The rest of the screen must still render, so this returns rather than throwing.
    const x = cv.getContext('2d')
    if (!x) return undefined
    let W = 0, H = 0, raf = 0
    const lights = Array.from({ length: 46 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.9,
      p: Math.random() * 6.3, s: 0.6 + Math.random() * 1.6 }))
    const crowd = Array.from({ length: 130 }, () => ({ x: Math.random(), y: Math.random() }))
    const size = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d)
      x.setTransform(d, 0, 0, d, 0, 0); W = r.width; H = r.height
    }
    const draw = (t) => {
      if (!W) size()
      const acc = getComputedStyle(cv).getPropertyValue('--acc').trim() || '#00A2E8'
      const sky = x.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#080A10'); sky.addColorStop(0.55, '#0C1119'); sky.addColorStop(1, '#12161F')
      x.fillStyle = sky; x.fillRect(0, 0, W, H)
      const g = x.createRadialGradient(W * 0.72, H * 0.52, 10, W * 0.72, H * 0.52, W * 0.55)
      g.addColorStop(0, acc + '55'); g.addColorStop(1, 'transparent')
      x.fillStyle = g; x.fillRect(0, 0, W, H)
      x.fillStyle = '#0A0D14'
      x.beginPath(); x.moveTo(W * 0.42, H); x.lineTo(W * 0.46, H * 0.42)
      x.quadraticCurveTo(W * 0.74, H * 0.24, W * 1.02, H * 0.44)
      x.lineTo(W * 1.02, H); x.closePath(); x.fill()
      for (let i = 0; i < 5; i++) {
        const yy = H * 0.46 + i * H * 0.085
        x.strokeStyle = acc + (i % 2 ? '22' : '3A'); x.lineWidth = 2.5
        x.beginPath(); x.moveTo(W * 0.47, yy)
        x.quadraticCurveTo(W * 0.74, yy - H * 0.13, W * 1.02, yy + H * 0.02); x.stroke()
      }
      x.save(); x.globalCompositeOperation = 'lighter'
      for (const l of lights) {
        x.fillStyle = acc
        x.globalAlpha = 0.28 + 0.22 * Math.sin(t / 700 * l.s + l.p)
        x.beginPath(); x.arc(W * 0.47 + l.x * W * 0.55, H * 0.44 + l.y * H * 0.5, l.r, 0, 7); x.fill()
      }
      x.globalAlpha = 1; x.restore()
      x.fillStyle = '#070910'; x.fillRect(0, H * 0.82, W, H * 0.18)
      x.fillStyle = '#0E1119'
      for (const c of crowd) {
        const h = 8 + c.y * 14
        x.globalAlpha = 0.5 + c.y * 0.5
        x.fillRect(c.x * W, H * 0.83 + c.y * H * 0.15 - h, 2.4 + c.y * 1.6, h)
      }
      x.globalAlpha = 1
      const sh = x.createLinearGradient(0, H * 0.82, 0, H)
      sh.addColorStop(0, acc + '18'); sh.addColorStop(1, 'transparent')
      x.fillStyle = sh; x.fillRect(0, H * 0.82, W, H * 0.18)
      raf = requestAnimationFrame(draw)
    }
    const reduce = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : true
    size()
    if (reduce) draw(0)
    else raf = requestAnimationFrame(draw)
    window.addEventListener('resize', size)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size) }
  }, [])
  return <canvas ref={ref} />
}

export function Ticker({ items }) {
  const line = items.map((t, i) => <i key={i} dangerouslySetInnerHTML={{ __html: t }} />)
  return (
    <div className="fo-ticker">
      <span className="tag">League wire</span>
      <div className="win"><div>{line}{line}</div></div>
    </div>
  )
}
