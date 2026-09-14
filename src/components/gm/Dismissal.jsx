// BEING FIRED.
//
// The one ending this game has, and it used to be `push('<b>You have been fired.</b>')` — a
// line pushed onto a forty-second marquee, in the middle of a state reset, on a screen that
// had already navigated back to Home. A career could end and the user could miss it entirely.
//
// The original design put "Firing" last on its list of animation moments with a one-line
// note: "It should sting." It does not need confetti in reverse. It needs the club's name, the
// number of seasons, the record, and the sentence ownership actually wrote — the same graded
// mandate that made the decision — held on screen until the user acknowledges it.
import { CITY, CLUB, clubInk } from '../../lib/gm/theme.js'
import Avatar from '../../lib/gm/avatar.jsx'

export default function Dismissal({ save, verdict, onDone }) {
  const team = save.franchise.team
  const [city, nm] = CITY[team] || [team, '']
  const [c1] = CLUB[team] || ['#5B6478']
  const r = save.records
  const yrs = r.seasonsCompleted
  const pct = (r.totalWins + r.totalLosses)
    ? (r.totalWins / (r.totalWins + r.totalLosses)).toFixed(3).slice(1) : '—'

  return (
    <div className="fo-cast" role="dialog" aria-modal="true">
      <div className="fo-cast-in ds-in">
        <div className="ds-head" style={{ '--club': c1 }}>
          <span className="crest" style={{ background: c1, color: clubInk(team) }}>{team}</span>
          <div>
            <div className="fo-k">{city} {nm}</div>
            <h3>You have been relieved of your duties</h3>
          </div>
          <span className="pic"><Avatar gm={save.gm} size={44} /></span>
        </div>

        <div className="ds-body">
          {verdict?.line && <p className="say">“{verdict.line}”</p>}
          {verdict?.of > 0 && (
            <p className="fo-muted">
              Of the {verdict.of} other things ownership asked for, you delivered {verdict.kept}.
            </p>
          )}
          <p className="fo-muted">
            Owner confidence finished at {save.status.ownerConfidence.toFixed(1)}. Below −3.0 the
            job is not yours.
          </p>

          <div className="ds-cells">
            {[['Seasons', yrs], ['Record', `${r.totalWins}–${r.totalLosses}`], ['Win %', pct],
              ['Playoffs', r.playoffAppearances], ['Series won', r.playoffSeriesWon],
              ['Titles', r.championships], ['Trades', r.tradesMade]].map(([k, v]) => (
                <div key={k}><span className="fo-k">{k}</span><b>{v}</b></div>
              ))}
          </div>

          {r.championships > 0 && (
            <p className="ds-note">
              {r.championships === 1 ? 'A banner hangs that did not before you got here.'
                : `${r.championships} banners hang that did not before you got here.`} They fired
              you anyway. That happens.
            </p>
          )}
          {!r.championships && r.playoffAppearances > 0 && (
            <p className="ds-note">
              {r.playoffAppearances} trip{r.playoffAppearances === 1 ? '' : 's'} to the
              postseason and no banner. The record book keeps both.
            </p>
          )}
        </div>

        <div className="ds-bar">
          <button type="button" className="fo-btn" onClick={onDone}>
            Clear out the office
          </button>
        </div>
      </div>
    </div>
  )
}
