// The championship. Section 14 of the design doc calls this the one animation everything
// else builds toward, so it is not a toast: the banner rises, the confetti falls in the
// franchise's own colours, and the badge mints in front of you.
import { useEffect, useRef } from 'react'
import { CLUB, CITY, clubInk } from '../../lib/gm/theme.js'

export default function Celebration({ team, season, record, path, badges, onDone }) {
  const cvs = useRef(null)

  useEffect(() => {
    const c = cvs.current
    if (!c) return undefined
    const x = c.getContext('2d')
    if (!x) return undefined
    const reduce = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false
    const [a, b] = CLUB[team] || ['#00A2E8', '#EF3B24']
    const cols = [a, b, '#FFFFFF', '#F6A93B']
    let w = 0, h = 0, raf = 0, t0 = performance.now()
    const size = () => {
      const r = c.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1)
      c.width = Math.max(1, r.width * d); c.height = Math.max(1, r.height * d)
      x.setTransform(d, 0, 0, d, 0, 0); w = r.width; h = r.height
    }
    size()
    const bits = Array.from({ length: 150 }, (_, i) => ({
      x: Math.random() * w, y: -Math.random() * h * 1.2,
      vx: (Math.random() - 0.5) * 26, vy: 40 + Math.random() * 110,
      s: 3 + Math.random() * 5, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 6,
      c: cols[i % cols.length],
    }))
    const frame = (now) => {
      const dt = Math.min(0.05, (now - t0) / 1000); t0 = now
      x.clearRect(0, 0, w, h)
      for (const p of bits) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt
        if (p.y > h + 12) { p.y = -12; p.x = Math.random() * w }
        x.save(); x.translate(p.x, p.y); x.rotate(p.r)
        x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 1.7)
        x.restore()
      }
      raf = requestAnimationFrame(frame)
    }
    if (reduce) {
      for (const p of bits) { p.y = Math.random() * h }
      frame(performance.now()); cancelAnimationFrame(raf)
    } else raf = requestAnimationFrame(frame)
    window.addEventListener('resize', size)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size) }
  }, [team])

  const [city, name] = CITY[team] || [team, '']
  const [acc] = CLUB[team] || ['#00A2E8']

  return (
    <div className="fo-party">
      <canvas ref={cvs} className="confetti" />
      <div className="in">
        <div className="banner" style={{ background: `linear-gradient(180deg,${acc},#0A0C11)` }}>
          <span className="k">NBA Champions</span>
          <b>{city}</b>
          <b className="nm">{name}</b>
          <span className="yr">{season}</span>
        </div>
        <div className="txt">
          <div className="fo-k">Season complete</div>
          <h2>You won it.</h2>
          <p>{record} in the regular season{path && path.length
            ? `, then ${path.map((r) => `${r.won ? 'beat' : 'lost to'} ${r.opp} ${r.w}–${r.l}`).join(', ')}`
            : ''}.</p>
          {!!badges?.length && (
            <div className="mint">
              {badges.map((b, i) => (
                <span key={b.id} className="badge" style={{ animationDelay: `${0.5 + i * 0.18}s`, borderColor: acc }}>
                  <i style={{ background: acc, color: clubInk(team) }}>★</i>{b.name}
                </span>
              ))}
            </div>
          )}
          <button className="fo-btn" type="button" onClick={onDone}>Raise the banner</button>
        </div>
      </div>
    </div>
  )
}
