// THE REST OF THE LEAGUE.
//
// The engine has produced a complete box score for every one of the 1,230 games since the
// season started keeping them, and until this screen existed not one counting stat reached a
// user. You could not see your own leading scorer. You could not answer "who is the best
// available shooter" without opening a trade with all twenty-nine clubs one at a time. The
// data was correct, complete, and invisible.
//
// Three views, because there are three different questions: who is having the best year
// (Leaders), find me a specific kind of player (Players), and what does that club actually
// look like (Teams).
import { useMemo, useState } from 'react'
import { allLines } from '../../lib/gm/box.js'
import { standings, TEAMS } from '../../lib/gm/season.js'
import { CITY, CLUB } from '../../lib/gm/theme.js'
import { teamSalary, status, statusLabel } from '../../lib/gm/cap.js'
import { Card, Tip, PName, money, short } from './ui.jsx'

const pc = (x) => (x ? `${(x * 100).toFixed(1)}` : '—')
const one = (x) => (x ?? 0).toFixed(1)
const RATE = new Set(['fgPct', 'fg3Pct', 'ts'])

// THE QUALIFYING FLOOR.
//
// Without one the three-point leaderboard is a man who took one shot in November and the
// whole board is noise. The NBA's own qualifiers are per-game rate floors measured against
// games played; this is the same idea, scaled to however far into the season you are, so the
// board is readable in week three as well as in April.
const QUALIFY = (played) => Math.max(5, Math.round(played * 0.55))

const LEADER_CATS = [
  ['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'],
  ['stl', 'Steals'], ['blk', 'Blocks'], ['ts', 'True shooting'],
]

const COLUMNS = [
  ['n', 'Player', 1], ['team', 'Team', 1], ['g', 'G'], ['mpg', 'MIN'],
  ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'],
  ['tov', 'TO'], ['fgPct', 'FG%'], ['fg3Pct', '3P%'], ['ts', 'TS%'],
]

function LeaderCard({ cat, label, rows, mine }) {
  return (
    <div className="lg-lead">
      <div className="fo-k">{label}</div>
      <ol>
        {rows.map((r, i) => (
          <li key={r.id} className={r.team === mine ? 'mine' : undefined}>
            <span className="rk">{i + 1}</span>
            <PName name={r.n} />
            <span className="tm">{r.team}</span>
            <b>{RATE.has(cat) ? pc(r[cat]) : one(r[cat])}</b>
          </li>
        ))}
        {!rows.length && <li className="none">Nothing played yet.</li>}
      </ol>
    </div>
  )
}

function LeagueTable({ lines, mine, played }) {
  const [sort, setSort] = useState('pts')
  const [asc, setAsc] = useState(false)
  const [q, setQ] = useState('')
  const [team, setTeam] = useState('')
  const [qualified, setQualified] = useState(true)
  const floor = QUALIFY(played)

  const rows = useMemo(() => {
    let out = lines.slice()
    if (team) out = out.filter((r) => r.team === team)
    if (q) {
      const needle = q.toLowerCase()
      out = out.filter((r) => (r.n || '').toLowerCase().includes(needle))
    }
    // The floor applies to rate columns only. Sorting by games played and then hiding
    // everybody who has not played enough games is a filter arguing with itself.
    if (qualified && sort !== 'g') out = out.filter((r) => r.g >= floor)
    const dir = asc ? 1 : -1
    out.sort((a, b) => (sort === 'n' || sort === 'team'
      ? dir * String(b[sort] ?? '').localeCompare(String(a[sort] ?? ''))
      : dir * ((b[sort] || 0) - (a[sort] || 0))))
    return out.slice(0, 250)
  }, [lines, sort, asc, q, team, qualified, floor])

  const head = ([k, label, isName]) => (
    <th key={k} className={sort === k ? 'on' : undefined}
      style={isName ? undefined : { textAlign: 'right' }}>
      <button type="button" className="lg-sort" onClick={() => {
        if (sort === k) setAsc(!asc)
        else { setSort(k); setAsc(k === 'n' || k === 'team') }
      }}>{label}{sort === k ? (asc ? ' ▲' : ' ▼') : ''}</button>
    </th>
  )

  return (
    <Card flush title="Every player in the league"
      note={`${rows.length} shown${qualified && sort !== 'g' ? ` · ${floor}+ games` : ''}`}>
      <div className="lg-filters">
        <input className="fo-input" placeholder="Search a name" value={q}
          onChange={(e) => setQ(e.target.value)} />
        <select className="fo-input" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All 30 clubs</option>
          {TEAMS.map((t) => <option key={t} value={t}>{(CITY[t] || [])[0] || t}</option>)}
        </select>
        <Tip tip={`Hides anyone under ${floor} games. Without a floor the percentage columns are led by a man who took one shot in November.`}>
          <label className="lg-check">
            <input type="checkbox" checked={qualified}
              onChange={(e) => setQualified(e.target.checked)} />
            Qualified only
          </label>
        </Tip>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: '62vh' }}>
        <table className="fo-tbl">
          <thead><tr>{COLUMNS.map(head)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.team === mine ? 'on' : undefined}>
                <td><PName name={r.n} /></td>
                <td className="n fo-faint">{r.team}</td>
                <td className="n fo-faint">{r.g}</td>
                <td className="n fo-faint">{one(r.mpg)}</td>
                <td className="n" style={{ fontWeight: 600 }}>{one(r.pts)}</td>
                <td className="n">{one(r.reb)}</td>
                <td className="n">{one(r.ast)}</td>
                <td className="n fo-faint">{one(r.stl)}</td>
                <td className="n fo-faint">{one(r.blk)}</td>
                <td className="n fo-faint">{one(r.tov)}</td>
                <td className="n fo-faint">{pc(r.fgPct)}</td>
                <td className="n fo-faint">{pc(r.fg3Pct)}</td>
                <td className="n">{pc(r.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="fo-empty">
            {q || team ? 'Nobody matches that. Try clearing the filters.'
              : 'No games have been played yet. Come back once the season is under way.'}
          </div>
        )}
      </div>
    </Card>
  )
}

function TeamBook({ save, lines, mine, table }) {
  const [pick, setPick] = useState(mine)
  const roster = save.league?.rosters?.[pick] || []
  const payroll = teamSalary(roster)
  const st = status(payroll)
  const rec = table.find((r) => r.team === pick)
  const stats = useMemo(
    () => new Map(lines.filter((r) => r.team === pick).map((r) => [r.n, r])), [lines, pick])
  const [city, nm] = CITY[pick] || [pick, '']

  return (
    <>
      <Card title="Every club" note="The whole league, not only the one you run">
        <div className="lg-clubs">
          {TEAMS.map((t) => {
            const r = table.find((x) => x.team === t)
            const [tc] = CLUB[t] || ['#5B6478']
            return (
              <button key={t} type="button" aria-pressed={t === pick}
                className={`lg-club${t === mine ? ' own' : ''}`}
                style={{ '--club': tc }} onClick={() => setPick(t)}>
                <span className="ab">{t}</span>
                <span className="ct">{(CITY[t] || [])[0] || t}</span>
                <span className="rc">{r ? `${r.w}–${r.l}` : '0–0'}</span>
              </button>
            )
          })}
        </div>
      </Card>

      <Card flush title={`${city} ${nm}`}
        note={`${rec ? `${rec.w}–${rec.l}` : 'no games yet'} · ${money(payroll)} · ${statusLabel(st)}`}>
        <div style={{ overflowX: 'auto' }}>
          <table className="fo-tbl">
            <thead><tr>
              <th>Player</th><th>Pos</th><th>Age</th><th>Yrs</th>
              <th>G</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>TS%</th>
              <th>Salary</th>
            </tr></thead>
            <tbody>
              {roster.map((p, i) => {
                const s = stats.get(p.n)
                return (
                  <tr key={`${p.uid || p.n}-${i}`}>
                    <td><PName p={p} />{p.o && <span className="fo-tag">{p.o}</span>}</td>
                    <td className="n fo-faint">{p.pos || '—'}</td>
                    <td className="n fo-faint">{typeof p.a === 'number' ? p.a.toFixed(1) : '—'}</td>
                    <td className="n fo-faint">{p.yr ?? '—'}</td>
                    <td className="n fo-faint">{s ? s.g : '—'}</td>
                    <td className="n fo-faint">{s ? one(s.mpg) : '—'}</td>
                    <td className="n" style={{ fontWeight: 600 }}>{s ? one(s.pts) : '—'}</td>
                    <td className="n">{s ? one(s.reb) : '—'}</td>
                    <td className="n">{s ? one(s.ast) : '—'}</td>
                    <td className="n">{s ? pc(s.ts) : '—'}</td>
                    <td className="n">{short(p.s || 0)}</td>
                  </tr>
                )
              })}
              <tr className="tot">
                <td colSpan={10}>Team payroll</td>
                <td className="n">{money(payroll)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

export default function LeagueScreen({ save, season, mine }) {
  const [view, setView] = useState('leaders')
  const lines = useMemo(() => allLines(season?.stats), [season?.stats])
  const played = useMemo(() => (season
    ? Math.max(0, ...TEAMS.map((t) => (season.rec[t]?.w || 0) + (season.rec[t]?.l || 0)))
    : 0), [season])
  const table = useMemo(() => {
    if (!season) return []
    const st = standings(season)
    return [...st.East, ...st.West]
  }, [season])

  const floor = QUALIFY(played)
  const leaders = useMemo(() => {
    const out = {}
    const pool = lines.filter((r) => r.g >= floor)
    for (const [k] of LEADER_CATS) {
      out[k] = pool.slice().sort((a, b) => (b[k] || 0) - (a[k] || 0)).slice(0, 5)
    }
    return out
  }, [lines, floor])

  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>The league</h2>
        <p>Every player, every club, and every number the engine has actually produced this
          season. These are not ratings — they are what happened in the games that were
          played, folded up night by night, and they are the same numbers the award ballot is
          argued from.</p>
      </div>

      <div className="fo-seg">
        {[['leaders', 'Leaders'], ['players', 'Players'], ['teams', 'Teams']].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={view === k}
            onClick={() => setView(k)}>{l}</button>
        ))}
      </div>

      {view === 'leaders' && (
        <Card title="Who is having the best year"
          note={played ? `through ${played} games · ${floor}+ games to qualify`
            : 'the season has not started'}>
          <div className="lg-leads">
            {LEADER_CATS.map(([k, l]) => (
              <LeaderCard key={k} cat={k} label={l} rows={leaders[k] || []} mine={mine} />
            ))}
          </div>
        </Card>
      )}

      {view === 'players' && <LeagueTable lines={lines} mine={mine} played={played} />}
      {view === 'teams' && <TeamBook save={save} lines={lines} mine={mine} table={table} />}
    </div>
  )
}
