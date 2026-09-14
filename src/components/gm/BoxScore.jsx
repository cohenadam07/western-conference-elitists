// THE BOX SCORE.
//
// The engine returned one for every game and the season threw it away, so the only thing a
// result ever told you was who won. "What did he do last night" is the first question anybody
// asks after a score lands, and until this existed the game had no answer to it — while
// holding the answer in memory.
//
// It costs nothing on the save: a season is replayed from its seed on load, so the log is
// rebuilt rather than stored. See season.js `packBox`.
import { CITY, CLUB, clubInk } from '../../lib/gm/theme.js'
import { PName } from './ui.jsx'

const one = (x) => (x ?? 0).toFixed(1)
const pc = (m, a) => (a ? `${Math.round((m / a) * 100)}%` : '—')

const sum = (rows, k) => rows.reduce((t, r) => t + (r[k] || 0), 0)

function Side({ team, rows, score, mine }) {
  const [c1] = CLUB[team] || ['#5B6478']
  const [city, nm] = CITY[team] || [team, '']
  // Starters first, then everybody who played, by minutes. A box score ordered by points
  // reads like a leaderboard; ordered by minutes it reads like a rotation, which is what it
  // is and what a GM is actually looking at.
  const sorted = rows.slice().sort((a, b) => (b.st - a.st) || (b.min - a.min))
  return (
    <div className="bx-side">
      <div className="bx-head">
        <span className="fo-av sm" style={{ background: c1, color: clubInk(team) }}>{team}</span>
        <span className="nm">{city} {nm}{team === mine ? <i> · you</i> : null}</span>
        <b>{score}</b>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="fo-tbl bx-tbl">
          <thead><tr>
            <th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th>
            <th>STL</th><th>BLK</th><th>TO</th><th>FG</th><th>3PT</th><th>FT</th>
          </tr></thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={`${r.id}-${i}`} className={r.st ? 'bx-start' : undefined}>
                <td><PName name={r.n} />{r.st ? <span className="fo-tag">ST</span> : null}</td>
                <td className="n fo-faint">{one(r.min)}</td>
                <td className="n" style={{ fontWeight: 600 }}>{r.pts}</td>
                <td className="n">{r.reb}</td><td className="n">{r.ast}</td>
                <td className="n fo-faint">{r.stl}</td><td className="n fo-faint">{r.blk}</td>
                <td className="n fo-faint">{r.tov}</td>
                <td className="n fo-faint">{r.fgm}-{r.fga}</td>
                <td className="n fo-faint">{r.fg3m}-{r.fg3a}</td>
                <td className="n fo-faint">{r.ftm}-{r.fta}</td>
              </tr>
            ))}
            <tr className="tot">
              <td>Team</td>
              <td className="n">{one(sum(sorted, 'min'))}</td>
              <td className="n">{sum(sorted, 'pts')}</td>
              <td className="n">{sum(sorted, 'reb')}</td>
              <td className="n">{sum(sorted, 'ast')}</td>
              <td className="n">{sum(sorted, 'stl')}</td>
              <td className="n">{sum(sorted, 'blk')}</td>
              <td className="n">{sum(sorted, 'tov')}</td>
              <td className="n">{pc(sum(sorted, 'fgm'), sum(sorted, 'fga'))}</td>
              <td className="n">{pc(sum(sorted, 'fg3m'), sum(sorted, 'fg3a'))}</td>
              <td className="n">{pc(sum(sorted, 'ftm'), sum(sorted, 'fta'))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function BoxScore({ game, mine, onClose }) {
  if (!game) return null
  const home = game.lines.filter((r) => r.side === 'home')
  const away = game.lines.filter((r) => r.side === 'away')
  const mineWon = game.home === mine ? game.hs > game.as : game.as > game.hs
  return (
    <div className="fo-cast" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="fo-cast-in bx-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bx-score">
          <div className="ln">
            <span>{CITY[game.away]?.[1] || game.away}</span>
            <b className={game.as > game.hs ? 'win' : undefined}>{game.as}</b>
          </div>
          <div className="ln">
            <span>{CITY[game.home]?.[1] || game.home}</span>
            <b className={game.hs > game.as ? 'win' : undefined}>{game.hs}</b>
          </div>
          <div className="mt">
            {game.nPoss} possessions{game.cup ? ' · NBA Cup group game' : ''}
            {' · '}{mineWon ? 'you win' : 'you lose'}
          </div>
        </div>
        <Side team={game.away} rows={away} score={game.as} mine={mine} />
        <Side team={game.home} rows={home} score={game.hs} mine={mine} />
        <div className="bx-foot">
          <button type="button" className="fo-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
