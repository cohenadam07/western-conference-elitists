import { CITY, initials } from '../../lib/gm/theme.js'
import { Tip, Ticker, money, useCountUp } from './ui.jsx'
import Avatar from '../../lib/gm/avatar.jsx'

const ICON = {
  home: 'M3 10.5 12 3l9 7.5V21H3z',
  roster: 'M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M22 20v-2a4 4 0 0 0-3-3.9',
  trades: 'M7 7h13l-3-3M17 17H4l3 3',
  season: 'M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  league: 'M6 3h12v5a6 6 0 0 1-12 0zM9 21h6M12 14v7',
  draft: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM21 21l-5-5',
  market: 'M3 6h18l-1.5 9.5a2 2 0 0 1-2 1.7H6.5a2 2 0 0 1-2-1.7ZM8 6V4a4 4 0 0 1 8 0v2M9 21h.01M15 21h.01',
  finances: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  report: 'M4 20V10M10 20V4M16 20v-7M22 20h-2',
  job: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.6 1Z',
}

export const SCREENS = [
  ['home', 'Home', 'Everything that needs you today, in one place.'],
  ['roster', 'Roster', 'Your cap sheet — every contract, option year and apron line.'],
  ['rotation', 'Rotation', 'Two hundred and forty minutes a night, and what they cost a body.'],
  ['trades', 'Trade desk', 'Build a deal. The cap rules and the other team both answer live.'],
  ['market', 'Open market', 'Free agents, all year. The minimum-salary door never closes.'],
  ['season', 'Season', 'Play the 82, the deadline, the play-in and the bracket.'],
  ['draft', 'Offseason', 'The lottery, your pick, and re-signing your own expiring players.'],
  ['finances', 'Finances', 'Payroll, the tax bill, and what ownership will tolerate.'],
  ['report', 'Analytics', '53 metrics across 47 seasons — where every rating here comes from.'],
  ['job', 'The job', 'Which parts of the job you run and which the assistant handles.'],
]

// FOUR AREAS, NOT TEN TABS.
//
// Ten flat entries in a rail is a list of features, and a new player reading it has no idea
// which of them is his job today or how any of them relate. Every franchise mode worth playing
// groups the same screens into the handful of departments a front office actually has, and the
// grouping does most of the teaching on its own: the roster and the rotation are the team, the
// trade desk and free agency are how you change it, the season is where it is decided, and the
// money and your own standing are the club.
//
// Headings rather than an accordion. With nine screens there is nothing to collapse away —
// the problem was never the number of pixels, it was that the shape of the job was invisible.
// A heading fixes that and costs the user nothing, and nothing has to be opened before it can
// be clicked.
export const AREAS = [
  [null, ['home']],
  ['Team', ['roster', 'rotation']],
  ['Front office', ['trades', 'market', 'draft']],
  ['Season', ['season', 'report']],
  ['The club', ['finances', 'job']],
]

// Screens for parts of the job the user has delegated are hidden rather than shown broken:
// the rotation tab only exists if the rotation is yours.
export const screensFor = (levels = {}) => SCREENS.filter(([k]) => (
  k !== 'rotation' || (levels.rotations ?? 'manual') === 'manual'
))

// The rail, as areas. Anything in AREAS that the control surface has taken away simply is not
// there, and an area left with nothing in it does not draw a heading over an empty space.
export function railFor(levels = {}) {
  const live = new Map(screensFor(levels).map((row) => [row[0], row]))
  return AREAS
    .map(([label, keys]) => [label, keys.map((k) => live.get(k)).filter(Boolean)])
    .filter(([, rows]) => rows.length > 0)
}

export default function Shell({ save, screen, setScreen, badges = {}, strip, news, onQuit, children }) {
  const team = save.franchise.team
  const payroll = useCountUp(strip.payroll, 520)
  const trust = useCountUp(strip.trust, 520)
  const [city, name] = CITY[team] || [team, '']
  const rep = Math.max(1, Math.min(5, 3 + Math.round((strip?.market ?? 0))))

  return (
    <div className="fo-app">
      <aside className="fo-rail">
        <div className="fo-brand">
          <div className="m"><span className="fo-ball" /><h1>Front Office</h1></div>
          <div className="s">Build a champion</div>
        </div>

        <div className="fo-gm">
          <span className="pic"><Avatar gm={save.gm} size={34} /></span>
          <span className="who">
            <b>{save.gm.name || 'General manager'}</b>
            <span>General manager</span>
          </span>
        </div>

        <nav className="fo-nav">
          {railFor(save.controlSurface?.levels).map(([area, rows]) => (
            <div key={area || 'top'} className="fo-navgroup">
              {area && <div className="fo-navhead">{area}</div>}
              {rows.map(([k, label, tip]) => (
                <Tip key={k} tip={tip} as="div">
                  <button type="button" className="fo-navbtn"
                    aria-current={screen === k ? 'true' : undefined}
                    onClick={() => setScreen(k)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                      strokeLinecap="round" strokeLinejoin="round"><path d={ICON[k]} /></svg>
                    {label}
                    {badges[k] ? <span className="dot">{badges[k]}</span> : null}
                  </button>
                </Tip>
              ))}
            </div>
          ))}
        </nav>

        <div className="fo-club">
          <div className="r">
            <span className="fo-crest">{team}</span>
            <span>
              <span className="city">{city}</span>
              <span className="nm">{name}</span>
            </span>
          </div>
          <div className="rep">
            Reputation <b>{'★'.repeat(rep)}{'☆'.repeat(5 - rep)}</b>
          </div>
          {onQuit && (
            <Tip as="div" tip="Leave this franchise. Your career is saved either way — you choose whether to keep the file or delete it.">
              <button type="button" className="fo-quit" onClick={onQuit}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Quit franchise
              </button>
            </Tip>
          )}
        </div>
      </aside>

      <div className="fo-main">
        <div className="fo-strip">
          <div className="cell">
            <span className="k">Owner mandate</span>
            <Tip tip="Ownership judges you against the mandate, not raw wins. A 25-win rebuild can be a success; a 45-win title-or-bust season is a failure.">
              <span className="v fo-acc">🏆 {strip.mandate}</span>
            </Tip>
          </div>
          <div className="cell">
            <span className="k">Team payroll</span>
            <Tip tip={strip.payrollTip}>
              <span className="v">{money(payroll)} <small>· {strip.status}</small></span>
            </Tip>
          </div>
          <div className="cell">
            <span className="k">Owner trust</span>
            <Tip tip="Owner confidence, moved by results measured against your mandate. Fall far enough for long enough and you are fired.">
              <span className="v fo-trust">
                <svg width="24" height="24" viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="#242B3A" strokeWidth="4" />
                  <circle cx="18" cy="18" r="15" fill="none"
                    stroke={strip.trust >= 55 ? 'var(--good)' : strip.trust >= 30 ? 'var(--warn)' : 'var(--bad)'}
                    strokeWidth="4" strokeLinecap="round" strokeDasharray="94.2"
                    strokeDashoffset={(94.2 * (1 - trust / 100)).toFixed(1)}
                    transform="rotate(-90 18 18)" />
                </svg>
                <span>{Math.round(trust)}</span>
              </span>
            </Tip>
          </div>
          <div className="cell">
            <span className="k">Calendar</span>
            <span className="v">{strip.season} <small>· {strip.phase}</small></span>
          </div>
          {strip.advance && (
            <div className="cell act">
              <Tip right tip={strip.advanceWhy || 'Move the calendar on. Anything you leave undone is handled for you.'}>
                <span className={`k${strip.advanceBlock ? ' block' : ''}`}>
                  {strip.advanceBlock || 'Next'}
                </span>
              </Tip>
              <button className="fo-btn sm" type="button"
                disabled={strip.advanceDisabled} onClick={strip.onAdvance}>
                {strip.advance}
              </button>
            </div>
          )}
        </div>

        <div className="fo-scroll">{children}</div>
        <Ticker items={news} />
      </div>
    </div>
  )
}

export { initials }
