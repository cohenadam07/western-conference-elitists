// LOTTERY NIGHT.
//
// The original design ranked this the third most important animation in the game, behind the
// championship and the game sim itself. What shipped was one line in the ticker — "Memphis
// win the lottery" — scrolling past at reading speed, for the single most consequential
// random event a rebuilding franchise experiences.
//
// The real ceremony is a reveal from the back: pick fourteen first, up to pick one, so the
// tension is about who is NOT in the envelope you are looking at. Every card carries the odds
// that club actually held and how far it moved, because a team jumping from 3% to fourth is
// the story, and without the odds on the face it is just a list.
import { useEffect, useState } from 'react'
import { CITY, CLUB, clubInk } from '../../lib/gm/theme.js'

export default function LotteryNight({ rows, mine, onDone }) {
  // Revealed from 14 up to 1, so `shown` counts how many envelopes are open.
  const [shown, setShown] = useState(0)
  const [auto, setAuto] = useState(true)
  const total = rows.length

  useEffect(() => {
    if (!auto || shown >= total) return undefined
    const t = setTimeout(() => setShown((n) => n + 1), shown === total - 1 ? 1500 : 620)
    return () => clearTimeout(t)
  }, [auto, shown, total])

  const done = shown >= total
  const order = rows.slice().reverse() // pick 14 first

  return (
    <div className="fo-cast" role="dialog" aria-modal="true">
      <div className="fo-cast-in lt-in">
        <div className="lt-head">
          <div className="fo-k">Draft lottery</div>
          <h3>The envelopes</h3>
          <p>
            Fourteen clubs, opened from the back. The odds on each card are the ones that team
            actually held going in — the four picks at the top are drawn, and everything below
            them is decided by record.
          </p>
        </div>

        <div className="lt-rows">
          {order.map((r, idx) => {
            const open = idx < shown
            const yours = r.team === mine
            const [c1] = CLUB[r.team] || ['#5B6478']
            return (
              <div key={r.pick} className={`lt-row${open ? ' open' : ''}${yours ? ' mine' : ''}`}>
                <span className="pk">{r.pick}</span>
                {open ? (
                  <>
                    <span className="cr" style={{ background: c1, color: clubInk(r.team) }}>
                      {r.team}
                    </span>
                    <span className="nm">
                      {(CITY[r.team] || [])[0]} {(CITY[r.team] || [])[1]}
                      {yours ? <b> · you</b> : null}
                    </span>
                    <span className="od">{r.odds != null ? `${r.odds.toFixed(1)}%` : '—'}</span>
                    <span className={`jp ${r.jump > 0 ? 'up' : r.jump < 0 ? 'dn' : ''}`}>
                      {r.jump > 0 ? `▲ ${r.jump}` : r.jump < 0 ? `▼ ${-r.jump}` : '—'}
                    </span>
                  </>
                ) : (
                  <span className="sealed">sealed</span>
                )}
              </div>
            )
          })}
        </div>

        <div className="lt-bar">
          {!done ? (
            <>
              <button type="button" className="fo-btn ghost sm"
                onClick={() => { setAuto(false); setShown((n) => Math.min(total, n + 1)) }}>
                Open the next one
              </button>
              <button type="button" className="fo-btn ghost sm"
                onClick={() => { setAuto(false); setShown(total) }}>Show me all of it</button>
            </>
          ) : (
            <button type="button" className="fo-btn" onClick={onDone}>
              {(() => {
                const me = rows.find((r) => r.team === mine)
                if (!me) return 'On to the draft'
                if (me.pick === 1) return 'You have the first pick · On to the draft'
                return `You pick ${me.pick}${me.jump > 0 ? ` — up ${me.jump}` : me.jump < 0 ? ` — down ${-me.jump}` : ''} · On to the draft`
              })()}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
