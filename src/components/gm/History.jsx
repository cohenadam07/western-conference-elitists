// THE FRANCHISE'S OWN MEMORY.
//
// Three things were being written to the save every single season and rendered nowhere:
// `seasons[]` (every year's record, seed, playoff run and champion), `honours[]` (every award
// a player of yours ever won — written with a comment saying "the record book wants them
// later"), and now the statistical archive. A franchise mode whose whole payoff is that
// season fourteen remembers season three had no screen that remembered anything.
//
// Four panels, in the order somebody actually asks: how has it gone, who did it, what did I
// do, and what is the best anybody has ever managed here.
import { useMemo, useState } from 'react'
import { CITY } from '../../lib/gm/theme.js'
import { allTimeCareers, allTimeSeasons, honourRoll, seasonsOf } from '../../lib/gm/history.js'
import { bySeason, KINDS } from '../../lib/gm/ledger.js'
import { Card, Tip, PName } from './ui.jsx'

const ROUND = ['missed the field', 'lost in round one', 'lost in the conference semis',
  'lost in the conference final', 'lost the Finals']

// What a season amounted to, in one phrase. The save stores series won and two flags; the
// sentence is derived so it can never disagree with the record.
function outcomeOf(s) {
  if (s.champion) return { text: 'CHAMPIONS', tone: 'win' }
  if (s.confTitle) return { text: 'lost the Finals', tone: 'near' }
  const n = s.playoffRounds || 0
  if (!s.made) return { text: ROUND[0], tone: 'out' }
  return { text: ROUND[Math.min(3, n)] || ROUND[0], tone: n >= 2 ? 'near' : 'in' }
}

const ALLTIME = [
  ['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'],
  ['stl', 'Steals'], ['blk', 'Blocks'],
]

export default function HistoryScreen({ save, mine }) {
  const [tab, setTab] = useState('seasons')
  const years = save.seasons || []
  const archive = save.history
  const moves = useMemo(() => bySeason(save.ledger), [save.ledger])
  const honours = useMemo(() => honourRoll(archive), [archive])
  const [city, nm] = CITY[mine] || [mine, '']

  const careers = useMemo(() => {
    const out = {}
    for (const [k] of ALLTIME) out[k] = allTimeCareers(archive, k, { n: 5 })
    return out
  }, [archive])

  const bestSeasons = useMemo(
    () => allTimeSeasons(archive, 'pts', { n: 5, min: 30 }), [archive])

  if (!years.length && !seasonsOf(archive).length) {
    return (
      <Card title="Franchise history">
        <div className="fo-empty">
          Nothing has been written here yet. The book starts with your first completed season —
          the record, who won the award votes, every move you made, and the numbers behind all
          of it.
        </div>
      </Card>
    )
  }

  return (
    <>
      <div className="fo-seg" style={{ marginTop: 14 }}>
        {[['seasons', 'Season by season'], ['honours', 'Awards'],
          ['moves', 'Transactions'], ['alltime', 'All-time']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={tab === k}
              onClick={() => setTab(k)}>{l}</button>
          ))}
      </div>

      {tab === 'seasons' && (
        <Card flush title={`${city} ${nm}`} note={`${years.length} season${years.length === 1 ? '' : 's'} on the book`}>
          <div style={{ overflowX: 'auto' }}>
            <table className="fo-tbl">
              <thead><tr>
                <th>Season</th><th>W</th><th>L</th><th>PCT</th>
                <th>DIFF</th><th>Outcome</th><th>Champion</th>
              </tr></thead>
              <tbody>
                {years.slice().reverse().map((s) => {
                  const o = outcomeOf(s)
                  const gp = (s.wins || 0) + (s.losses || 0)
                  return (
                    <tr key={s.season}>
                      <td>{s.season}</td>
                      <td className="n" style={{ fontWeight: 600 }}>{s.wins}</td>
                      <td className="n fo-faint">{s.losses}</td>
                      <td className="n fo-faint">{gp ? (s.wins / gp).toFixed(3).slice(1) : '—'}</td>
                      <td className="n fo-faint">{(s.pf != null && s.pa != null && gp)
                        ? `${s.pf - s.pa > 0 ? '+' : ''}${((s.pf - s.pa) / gp).toFixed(1)}` : '—'}</td>
                      <td className={`hs-out ${o.tone}`}>{o.text}</td>
                      <td className="n fo-faint">
                        {s.champion ? (CITY[s.champion]?.[0] || s.champion) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'honours' && (
        <Card title="Awards won by your players"
          note={honours.length ? `${honours.length} in all` : 'none yet'}>
          {!honours.length && (
            <div className="fo-empty">
              Nobody here has won a vote yet. The ballot is counted off the box scores at the
              end of every regular season.
            </div>
          )}
          <div className="hs-hon">
            {honours.slice().reverse().map((h, i) => (
              <div key={`${h.season}-${h.name}-${i}`} className="row">
                <span className="yr">{h.season}</span>
                <PName name={h.who} />
                <span className="aw">{h.name}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'moves' && (
        <Card title="Every move you have made"
          note={`${(save.ledger?.entries || []).length} on record`}>
          {!moves.size && (
            <div className="fo-empty">
              No transactions yet. Trades, signings, waivers and draft picks are written here as
              they happen — the ticker is the notification, this is the record.
            </div>
          )}
          {[...moves.entries()].reverse().map(([season, rows]) => (
            <div key={season} className="hs-year">
              <div className="fo-k">{season}</div>
              {rows.slice().reverse().map((e) => (
                <div key={`${e.seq}`} className="row">
                  <Tip tip={KINDS[e.kind] || e.kind}>
                    <span className={`kd ${e.kind}`}>{(KINDS[e.kind] || e.kind).slice(0, 9)}</span>
                  </Tip>
                  <span className="tx">{e.text}</span>
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}

      {tab === 'alltime' && (
        <>
          <Card title="All-time, in this league"
            note="every player-season the archive has kept, yours and everybody else's">
            <div className="lg-leads">
              {ALLTIME.map(([k, l]) => (
                <div key={k} className="lg-lead">
                  <div className="fo-k">{l} · career</div>
                  <ol>
                    {(careers[k] || []).map((r, i) => (
                      <li key={r.id}>
                        <span className="rk">{i + 1}</span>
                        <PName name={r.name} />
                        <span className="tm">{r.team}</span>
                        <b>{Math.round(r.total).toLocaleString('en-US')}</b>
                      </li>
                    ))}
                    {!(careers[k] || []).length && <li className="none">Not enough played yet.</li>}
                  </ol>
                </div>
              ))}
            </div>
          </Card>
          <Card title="The best years anybody has had"
            note="single seasons, ranked by scoring">
            <div className="hs-hon">
              {bestSeasons.map((r, i) => (
                <div key={`${r.season}-${r.id}`} className="row">
                  <span className="yr">{r.season}</span>
                  <PName name={r.name} />
                  <span className="aw">{r.pts.toFixed(1)} pts · {r.reb.toFixed(1)} reb · {r.ast.toFixed(1)} ast</span>
                </div>
              ))}
              {!bestSeasons.length && (
                <div className="fo-empty">Nothing qualifies yet — a full season has to be played.</div>
              )}
            </div>
          </Card>
        </>
      )}
    </>
  )
}
