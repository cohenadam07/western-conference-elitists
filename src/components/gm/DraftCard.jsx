// THE PICK.
//
// You spend a season's worth of losing on it, hire scouts against a budget, spend workouts
// narrowing the fog on three names — and then clicking Draft produced a line in the ticker.
// The single most anticipated decision in a rebuild had less presentation than a waiver.
//
// What makes this a moment rather than a confirmation dialog is the gap: where your own board
// had him against where you took him. Reaching four spots for a man your department ranks
// twenty-second is a decision you should have to look at.
import { CITY, CLUB, clubInk } from '../../lib/gm/theme.js'

export default function DraftCard({ pick, prospect, boardRank, grade, projection, mine, onDone }) {
  const [city, nm] = CITY[mine] || [mine, '']
  const [c1] = CLUB[mine] || ['#5B6478']
  const reach = boardRank != null ? boardRank - pick : null

  return (
    <div className="fo-cast" role="dialog" aria-modal="true">
      <div className="fo-cast-in dc-in">
        <div className="dc-head" style={{ borderTopColor: c1 }}>
          <div className="fo-k">With the {pick === 1 ? 'first' : `number ${pick}`} pick</div>
          <div className="club">
            <span className="crest" style={{ background: c1, color: clubInk(mine) }}>{mine}</span>
            <span>{city} {nm} select</span>
          </div>
          <h3>{prospect.name}</h3>
          <div className="sub">
            {prospect.pos || '—'} · {prospect.age} · {prospect.school || prospect.regionLabel}
            {grade ? <span className="gr">{grade}</span> : null}
          </div>
        </div>

        <div className="dc-body">
          {projection && <p className="proj">{projection}</p>}
          {reach != null && (
            <p className={`board ${reach > 2 ? 'reach' : reach < -2 ? 'steal' : ''}`}>
              {reach > 2
                ? `Your department had him ${boardRank}th. You took him ${pick}. That is a reach of ${reach} places, and it is on you.`
                : reach < -2
                  ? `Your department had him ${boardRank}th and he was still there at ${pick}. Somebody else was wrong, or you were.`
                  : `Your department had him ${boardRank}th. You took him where they had him.`}
            </p>
          )}
          <p className="fo-faint">
            Everything above is your scouts&apos; opinion, not the truth. What he actually
            becomes is settled by the years, and you will find out the same way everybody does.
          </p>
        </div>

        <div className="dc-bar">
          <button type="button" className="fo-btn" onClick={onDone}>Back to the board</button>
        </div>
      </div>
    </div>
  )
}
