// The gamecast — watching a simulated game instead of being told its result.
//
// Nothing here decides anything. The game was already played by the possession engine;
// this reads the play stream it emitted and draws it. That distinction matters: the seed
// produces the identical game whether or not anyone watches, which is what lets the
// server verify a claimed season by replaying it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CLUB, CITY, clubInk } from '../../lib/gm/theme.js'

// Court is 94 x 50 feet; the drawing works in those units and scales to the canvas.
const W = 94, H = 50, RIM_X = 5.25, RIM_Y = 25

// Where five players stand when their team has the ball, attacking to the right.
const OFF_SPOTS = [[58, 25], [70, 6], [70, 44], [80, 14], [84, 34]]
const DEF_SPOTS = [[50, 25], [60, 9], [60, 41], [72, 16], [76, 32]]
const flip = ([x, y]) => [W - x, y]

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2)
const lerp = (a, b, t) => a + (b - a) * t

// A deterministic wobble so the same possession always looks the same, without spending
// a draw from the simulation's RNG — which would change the game itself.
const wob = (i, k) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/* --------------------------------------------------------------- play → beats */

function beatsFor(play, idx, dir) {
  const spots = OFF_SPOTS.map((s) => (dir > 0 ? s : flip(s)))
  const rim = dir > 0 ? [W - RIM_X, RIM_Y] : [RIM_X, RIM_Y]
  const back = dir > 0 ? [12, 25] : [W - 12, 25]
  const beats = []
  const push = (ms, ball, o = {}) => beats.push({ ms, ball, ...o })

  push(300, back, { note: null, phase: 'bring' })
  const first = spots[Math.floor(wob(idx, 1) * 5)]
  push(240, first, { phase: 'swing' })

  for (const [j, e] of (play.ev || []).entries()) {
    const s = spots[Math.floor(wob(idx, j + 2) * 5)]
    if (e.k === 'tov') {
      push(200, s, { phase: 'swing' })
      push(420, dir > 0 ? [RIM_X + 6, 25] : [W - RIM_X - 6, 25],
        { phase: 'steal', flash: 'steal', text: `Turnover — ${e.n}`, kind: 'tov' })
    } else if (e.k === 'ft') {
      push(260, dir > 0 ? [W - 20, 25] : [20, 25], { phase: 'foul', text: `Foul — ${e.n} to the line`, kind: 'foul' })
      push(360, rim, { phase: 'shot', flash: e.made > 0 ? 'make' : 'miss',
        text: `${e.n} — ${e.made} of ${e.att} at the line`, kind: e.made > 0 ? 'score' : 'miss' })
    } else if (e.k === '3' || e.k === '2') {
      const three = e.k === '3'
      const from = three
        ? [lerp(spots[0][0], rim[0], 0.12) + (wob(idx, j + 5) - 0.5) * 14,
          6 + wob(idx, j + 6) * 38]
        : [lerp(rim[0], spots[0][0], 0.22), 18 + wob(idx, j + 7) * 14]
      push(230, from, { phase: 'set', shooter: from })
      push(three ? 420 : 320, rim, { phase: 'shot', arc: true, shooter: from,
        flash: e.made ? (three ? 'three' : e.rim ? 'dunk' : 'make') : 'miss',
        text: e.made
          ? `${e.n} ${three ? 'from deep' : e.rim ? 'at the rim' : 'from mid'} — good` +
            (e.ast ? ` (${e.ast})` : '') + (e.hot ? ' 🔥' : '')
          : `${e.n} ${three ? 'from three' : ''} — off the mark`,
        kind: e.made ? (three ? 'three' : 'score') : 'miss' })
    } else if (e.k === 'orb') {
      push(300, [lerp(rim[0], spots[0][0], 0.14), 25 + (wob(idx, j + 8) - 0.5) * 16],
        { phase: 'reb', flash: 'reb', text: `${e.n} — offensive board`, kind: 'reb' })
    } else if (e.k === 'drb') {
      push(300, [lerp(rim[0], spots[0][0], 0.16), 25 + (wob(idx, j + 9) - 0.5) * 18],
        { phase: 'reb', text: `${e.n} — defensive rebound`, kind: 'quiet' })
    }
  }
  return beats
}

/* ------------------------------------------------------------------ the court */

// Real geometry, in feet: a 94 x 50 floor, hoops 5.25 from each baseline, a 16-foot key
// 19 deep, and a three-point line that is an arc of 23.75 broken by 22-foot corners. Eyeballed
// courts read as wrong even to people who could not tell you why.
const KEY_W = 16, KEY_D = 19, FT_R = 6, ARC_R = 23.75, CORNER_Y = 22
const CORNER_X = Math.sqrt(ARC_R * ARC_R - CORNER_Y * CORNER_Y)
const ARC_A = Math.asin(CORNER_Y / ARC_R)

function drawCourt(x, w, h, acc) {
  const s = w / W
  const u = (v) => v * s
  x.fillStyle = '#0B0E14'; x.fillRect(0, 0, w, h)
  const g = x.createRadialGradient(w / 2, h / 2, u(4), w / 2, h / 2, u(52))
  g.addColorStop(0, 'rgba(255,255,255,.045)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.fillRect(0, 0, w, h)

  const line = 'rgba(255,255,255,.17)'
  x.lineWidth = Math.max(1, s * 0.2)
  x.strokeStyle = line
  x.strokeRect(u(1), u(1), u(W - 2), u(H - 2))
  x.beginPath(); x.moveTo(u(W / 2), u(1)); x.lineTo(u(W / 2), u(H - 1)); x.stroke()
  x.beginPath(); x.arc(u(W / 2), u(H / 2), u(FT_R), 0, Math.PI * 2); x.stroke()

  for (const d of [1, -1]) {
    const base = d > 0 ? 0 : W                 // the baseline this basket sits on
    const hx = base + d * RIM_X                // the hoop
    const kx = d > 0 ? 0 : W - KEY_D
    x.strokeStyle = line
    x.strokeRect(u(kx), u(H / 2 - KEY_W / 2), u(KEY_D), u(KEY_W))
    x.beginPath(); x.arc(u(base + d * KEY_D), u(H / 2), u(FT_R), 0, Math.PI * 2); x.stroke()

    // three-point line: corners, then the arc between them
    x.beginPath()
    x.moveTo(u(base), u(H / 2 - CORNER_Y))
    x.lineTo(u(hx + d * CORNER_X), u(H / 2 - CORNER_Y))
    x.stroke()
    x.beginPath()
    x.moveTo(u(base), u(H / 2 + CORNER_Y))
    x.lineTo(u(hx + d * CORNER_X), u(H / 2 + CORNER_Y))
    x.stroke()
    x.beginPath()
    if (d > 0) x.arc(u(hx), u(H / 2), u(ARC_R), -ARC_A, ARC_A)
    else x.arc(u(hx), u(H / 2), u(ARC_R), Math.PI - ARC_A, Math.PI + ARC_A, false)
    x.stroke()

    // backboard and rim
    x.strokeStyle = 'rgba(255,255,255,.3)'; x.lineWidth = Math.max(1.4, s * 0.28)
    x.beginPath()
    x.moveTo(u(base + d * 4), u(H / 2 - 3)); x.lineTo(u(base + d * 4), u(H / 2 + 3))
    x.stroke()
    x.strokeStyle = acc; x.lineWidth = Math.max(1.6, s * 0.34)
    x.beginPath(); x.arc(u(hx), u(H / 2), u(0.75), 0, Math.PI * 2); x.stroke()
  }
}

function drawDot(x, s, px, py, color, ink, label, glow) {
  if (glow) {
    x.beginPath(); x.arc(px, py, s * 1.9, 0, 7)
    x.fillStyle = glow; x.fill()
  }
  x.beginPath(); x.arc(px, py, s, 0, 7)
  x.fillStyle = color; x.fill()
  x.lineWidth = Math.max(1, s * 0.16); x.strokeStyle = 'rgba(0,0,0,.5)'; x.stroke()
  if (label) {
    x.fillStyle = ink; x.font = `700 ${s * 0.95}px "Barlow Semi Condensed",sans-serif`
    x.textAlign = 'center'; x.textBaseline = 'middle'
    x.fillText(label, px, py + s * 0.05)
  }
}

/* ----------------------------------------------------------------- component */

export default function GameCast({ game, trace, box, mine, onDone }) {
  const { home, away } = game
  const cvs = useRef(null)
  const st = useRef({ i: 0, b: 0, t: 0, ball: [W / 2, H / 2], flash: null, fl: 0 })
  const [speed, setSpeed] = useState(2)
  const [pos, setPos] = useState(0)
  const [feed, setFeed] = useState([])
  const [done, setDone] = useState(false)
  const speedRef = useRef(2)
  useEffect(() => { speedRef.current = speed }, [speed])

  // Flatten the trace into one list of plays, each already knowing the score after it.
  const plays = useMemo(() => {
    const out = []
    for (const t of trace) {
      for (const p of t.plays || []) {
        out.push({ ...p, h: t.h, a: t.a, wp: t.wp, q: t.q, p: t.p })
      }
    }
    return out
  }, [trace])

  const cur = plays[Math.min(pos, plays.length - 1)] || { h: 0, a: 0, q: 1, wp: 0.5, p: 0 }
  const myHome = home === mine
  const acc = CLUB[mine]?.[0] || '#00A2E8'
  const oppAcc = CLUB[myHome ? away : home]?.[0] || '#8B93A7'

  useEffect(() => {
    const c = cvs.current
    if (!c) return undefined
    // Playback advances whether or not there is anything to draw on. Keeping the clock
    // inside the draw call meant a context that could not be created — a headless DOM, a
    // printing context — froze the game rather than just the picture.
    const x = c.getContext('2d')
    let raf = 0, prev = performance.now()
    const S = st.current
    let cache = { idx: -1, beats: [] }

    const size = () => {
      const r = c.getBoundingClientRect()
      const d = Math.min(2, window.devicePixelRatio || 1)
      c.width = Math.max(1, r.width * d); c.height = Math.max(1, r.height * d)
      if (x) x.setTransform(d, 0, 0, d, 0, 0)
      return [r.width || 640, r.height || 340]
    }
    let [w, h] = size()
    const onResize = () => { [w, h] = size() }
    window.addEventListener('resize', onResize)

    const frame = (now) => {
      const dt = Math.min(120, now - prev); prev = now
      const play = plays[S.i]
      if (!play) {
        setDone(true)
      } else {
        if (cache.idx !== S.i) {
          cache = { idx: S.i, beats: beatsFor(play, S.i, play.side === 'home' ? 1 : -1) }
        }
        const beat = cache.beats[S.b] || cache.beats[cache.beats.length - 1]
        S.t += dt * speedRef.current
        if (beat && S.t >= beat.ms) {
          S.t = 0
          if (beat.flash) { S.flash = beat.flash; S.fl = 1 }
          if (beat.text) {
            setFeed((f) => [{ id: `${S.i}-${S.b}`, text: beat.text, kind: beat.kind,
              h: play.h, a: play.a, q: play.q }, ...f].slice(0, 40))
          }
          S.ball = beat.ball
          S.b++
          if (S.b >= cache.beats.length) { S.b = 0; S.i++; setPos(S.i) }
        }
      }

      // ---- draw
      if (!x) { raf = requestAnimationFrame(frame); return }
      const sc = w / W
      drawCourt(x, w, h, acc)
      const dir = play ? (play.side === 'home' ? 1 : -1) : 1
      const offColor = play && play.side === (myHome ? 'home' : 'away') ? acc : oppAcc
      const defColor = '#39415A'
      const spots = (play ? OFF_SPOTS : OFF_SPOTS).map((s) => (dir > 0 ? s : flip(s)))
      const dspots = DEF_SPOTS.map((s) => (dir > 0 ? s : flip(s)))
      const r = Math.max(4, sc * 1.5)
      dspots.forEach(([sx, sy], i) => {
        const j = (S.i + i) % 5
        drawDot(x, r, (sx + (wob(S.i, i) - 0.5) * 3) * sc, (sy + (wob(S.i, i + 20) - 0.5) * 3) * sc,
          defColor, '#0A0C11', '', null)
        void j
      })
      spots.forEach(([sx, sy], i) => {
        drawDot(x, r, (sx + (wob(S.i, i + 40) - 0.5) * 3) * sc, (sy + (wob(S.i, i + 60) - 0.5) * 3) * sc,
          offColor, clubInk(play && play.side === 'home' ? home : away), '', null)
      })

      // the ball, eased toward the current beat
      const target = (cache.beats[S.b] || {}).ball || S.ball
      const beat = cache.beats[S.b]
      const t = beat ? ease(Math.min(1, S.t / beat.ms)) : 1
      let bx = lerp(S.ball[0], target[0], t)
      let by = lerp(S.ball[1], target[1], t)
      if (beat && beat.arc) by -= Math.sin(t * Math.PI) * 7
      x.beginPath(); x.arc(bx * sc, by * sc, Math.max(3.2, sc * 1.05), 0, 7)
      x.fillStyle = '#F6A93B'; x.fill()
      x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 1; x.stroke()

      // flashes: what just happened, said in light rather than words
      if (S.fl > 0) {
        S.fl = Math.max(0, S.fl - dt / 460)
        const rim = dir > 0 ? [W - RIM_X, RIM_Y] : [RIM_X, RIM_Y]
        const a = S.fl
        if (S.flash === 'make' || S.flash === 'three' || S.flash === 'dunk') {
          const col = S.flash === 'three' ? '#F6A93B' : offColor
          x.strokeStyle = col; x.globalAlpha = a; x.lineWidth = 2 + (1 - a) * 3
          x.beginPath(); x.arc(rim[0] * sc, rim[1] * sc, (2 + (1 - a) * 16) * sc, 0, 7); x.stroke()
          if (S.flash === 'three') {
            for (let k = 0; k < 8; k++) {
              const ang = (k / 8) * Math.PI * 2
              x.beginPath()
              x.moveTo((rim[0] + Math.cos(ang) * 3) * sc, (rim[1] + Math.sin(ang) * 3) * sc)
              x.lineTo((rim[0] + Math.cos(ang) * (4 + (1 - a) * 12)) * sc,
                (rim[1] + Math.sin(ang) * (4 + (1 - a) * 12)) * sc)
              x.stroke()
            }
          }
          x.globalAlpha = 1
        } else if (S.flash === 'miss') {
          x.strokeStyle = '#6C7690'; x.globalAlpha = a * 0.8; x.lineWidth = 2
          x.beginPath(); x.arc(rim[0] * sc, rim[1] * sc, (2 + (1 - a) * 8) * sc, 0, 7); x.stroke()
          x.globalAlpha = 1
        } else if (S.flash === 'steal') {
          x.strokeStyle = '#E2574C'; x.globalAlpha = a; x.lineWidth = 2
          for (let k = 0; k < 5; k++) {
            const yy = (14 + k * 6) * sc
            x.beginPath(); x.moveTo((bx - dir * 14 * (1 - a) - 10) * sc, yy)
            x.lineTo((bx - dir * 14 * (1 - a)) * sc, yy); x.stroke()
          }
          x.globalAlpha = 1
        } else if (S.flash === 'reb') {
          x.strokeStyle = '#4FB477'; x.globalAlpha = a; x.lineWidth = 2
          x.beginPath(); x.arc(bx * sc, by * sc, (3 + (1 - a) * 7) * sc, 0, 7); x.stroke()
          x.globalAlpha = 1
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays])

  const clock = (() => {
    const q = Math.min(4, cur.q || 1)
    const per = plays.length / 4
    const within = (pos % per) / per
    const secs = Math.max(0, Math.round(720 * (1 - within)))
    return { q, label: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` }
  })()

  const finish = () => { onDone(); }
  const skip = () => { st.current.i = plays.length; setPos(plays.length); setDone(true) }

  const hs = done ? game.hs : cur.h
  const as = done ? game.as : cur.a
  const wp = done ? (game.hs > game.as ? 1 : 0) : cur.wp
  const myWp = Math.round((myHome ? wp : 1 - wp) * 100)

  const top = (side) => {
    const roster = side === 'home' ? home : away
    return Object.entries(box || {})
      .map(([id, b]) => ({ id, ...b }))
      .filter((b) => b.pts)
      .sort((a, b) => b.pts - a.pts).slice(0, 3).map((b) => ({ ...b, roster }))
  }
  void top

  return (
    <div className="fo-cast">
      <div className="fo-cast-in">
        <div className="fo-cast-score">
          {/* WHICH ONE IS YOU.
              The scoreboard named both clubs and marked neither, so the first game a new
              general manager ever watched gave him no way to tell which side he was on — the
              only hint anywhere was the win-probability label further down the card. The dots
              do not help: the team with the ball wears its own colour and the defenders are
              neutral, which is right for reading the play and useless for reading the score. */}
          <div className={`side${away === mine ? ' ours' : ''}`}>
            <span className="crest" style={{ background: CLUB[away]?.[0], color: clubInk(away) }}>{away}</span>
            <span className="nm">{CITY[away][1]}</span>
            {away === mine && <span className="you">you</span>}
          </div>
          <div className="mid">
            <div className="pts"><b className={as > hs ? 'up' : ''}>{as}</b><i>–</i><b className={hs > as ? 'up' : ''}>{hs}</b></div>
            <div className="clk">{done ? 'FINAL' : `Q${clock.q} · ${clock.label}`}</div>
          </div>
          <div className={`side right${home === mine ? ' ours' : ''}`}>
            {home === mine && <span className="you">you</span>}
            <span className="nm">{CITY[home][1]}</span>
            <span className="crest" style={{ background: CLUB[home]?.[0], color: clubInk(home) }}>{home}</span>
          </div>
        </div>

        <div className="fo-cast-court"><canvas ref={cvs} /></div>

        <div className="fo-cast-wp">
          <div className="bar">
            <div className="fill" style={{ width: `${myWp}%`, background: acc }} />
          </div>
          <span className="fo-k">{mine} win probability · {myWp}%</span>
        </div>

        <div className="fo-cast-feed">
          {feed.length === 0 && <div className="fo-empty">Tip-off.</div>}
          {feed.map((f) => (
            <div key={f.id} className={`row ${f.kind || ''}`}>
              <span className="q">Q{Math.min(4, f.q)}</span>
              <span className="tx">{f.text}</span>
              <span className="sc">{f.a}–{f.h}</span>
            </div>
          ))}
        </div>

        <div className="fo-cast-bar">
          {!done ? (
            <>
              <span className="fo-k">Speed</span>
              {[1, 2, 4, 8].map((s) => (
                <button key={s} type="button" className="fo-opt" aria-pressed={speed === s}
                  onClick={() => setSpeed(s)}>{s}×</button>
              ))}
              <button className="fo-btn ghost sm" type="button" onClick={skip}>Skip to final</button>
            </>
          ) : (
            <button className="fo-btn" type="button" onClick={finish}>
              {game.hs === game.as ? 'Final' : `${(game.hs > game.as ? home : away)} win ${Math.max(game.hs, game.as)}–${Math.min(game.hs, game.as)}`} · Continue
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
