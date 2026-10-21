import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

/**
 * Edge Lab — private. A forward test of whether WCE's analytics, read by Claude, beat the
 * prices on Kalshi's NBA player props. Paper bets only.
 *
 * Reads /api/analytics/history?section=edge behind the analytics password (the same one, and
 * the same saved session, as /analytics). The jobs that fill it live in api/analytics/_edge.js;
 * EDGE_LAB.md explains the method.
 *
 * Self-contained like AnalyticsArchive.jsx: no chart library, no Tailwind, no new packages.
 */

const STORAGE_KEY = 'wce-analytics-key' // shared with /analytics on purpose
const ENDPOINT = '/api/analytics/history?section=edge'
const JOB = '/api/analytics/snapshot'

const ARMS = ['model', 'claude_wce', 'claude_box']
const ARM_SHORT = { model: 'WCE model', claude_wce: 'Claude + WCE', claude_box: 'Claude, box only' }
const STAT = { pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', pra: 'PRA' }
const FIRST_READ = 300 // bets per arm before CLV says much

/* ---------------------------------------------------------------- format */

const cents = (x, signed = true) => (x == null ? '—' : Math.abs(x) < 0.0005 ? '0.0¢' : `${signed && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}¢`)
const pct = (x, d = 0) => (x == null ? '—' : `${x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`)
const units = (x) => (x == null ? '—' : Math.abs(x) < 0.005 ? '0.00u' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}u`)
const price = (x) => (x == null ? '—' : `${Math.round(x * 100)}¢`)
const tipTime = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const ago = (iso) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

function verdict(a) {
  if (!a.clvBets) return 'No settled bets yet.'
  if (a.clvBets < FIRST_READ) return `Too early to say: ${a.clvBets} of the ~${FIRST_READ} bets a first read needs.`
  if (a.clvT >= 2) return 'Beating the closing price by more than noise would explain.'
  if (a.clvT <= -2) return 'Losing to the closing price by more than noise would explain.'
  return 'No clear edge over the closing price yet.'
}

function useElementWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(640)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 0) setWidth(e.contentRect.width) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/* ---------------------------------------------------------------- charts */

function RunningChart({ daily, metric }) {
  const [ref, width] = useElementWidth()
  const height = 220
  const pad = { top: 12, right: 12, bottom: 26, left: 46 }
  const w = Math.max(width - pad.left - pad.right, 10)
  const h = height - pad.top - pad.bottom
  const val = (row, a) => (metric === 'clv' ? row[a].cumClv : row[a].cumPnl)
  const vals = daily.flatMap((r) => ARMS.map((a) => val(r, a)))
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
  const span = hi - lo || 1
  const x = (i) => (daily.length === 1 ? w / 2 : (i / (daily.length - 1)) * w)
  const y = (v) => h - ((v - lo) / span) * h
  const ticks = [lo, (lo + hi) / 2, hi]
  const fmt = (v) => (metric === 'clv' ? `${(v * 100).toFixed(0)}¢` : `${v.toFixed(1)}u`)
  return (
    <div className="el-chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={metric === 'clv' ? 'Running closing line value by arm' : 'Running profit and loss by arm'}>
        <g transform={`translate(${pad.left},${pad.top})`}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line className="el-grid" x1={0} x2={w} y1={y(t)} y2={y(t)} />
              <text className="el-axis" x={-8} y={y(t)} dy="0.32em" textAnchor="end">{fmt(t)}</text>
            </g>
          ))}
          <line className="el-zero" x1={0} x2={w} y1={y(0)} y2={y(0)} />
          {ARMS.map((a) => (
            <path key={a} className={`el-line el-${a}`} d={daily.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val(r, a)).toFixed(1)}`).join(' ')} />
          ))}
          {daily.length > 0 && [0, daily.length - 1].filter((v, i, s) => s.indexOf(v) === i).map((i) => (
            <text key={i} className="el-axis" x={x(i)} y={h + 18} textAnchor={i === 0 ? 'start' : 'end'}>{daily[i].date.slice(5)}</text>
          ))}
        </g>
      </svg>
    </div>
  )
}

function Calibration({ arms }) {
  const size = 200, pad = 26, inner = size - pad * 2
  const s = (v) => pad + v * inner
  return (
    <div className="el-calib">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Calibration: predicted against actual hit rate">
        <rect x={pad} y={pad} width={inner} height={inner} className="el-calbox" />
        <line x1={s(0)} y1={s(1)} x2={s(1)} y2={s(0)} className="el-diag" />
        {ARMS.map((a) => {
          const arm = arms.find((x) => x.arm === a)
          return (arm?.calibration || []).filter((b) => b.n >= 10).map((b) => (
            <circle key={`${a}${b.bin}`} className={`el-dot el-${a}`} cx={s(b.predicted)} cy={s(1 - b.actual)} r={Math.min(7, 2.5 + Math.sqrt(b.n) / 4)}>
              <title>{`${ARM_SHORT[a]}: said ${pct(b.predicted)}, hit ${pct(b.actual)} (${b.n})`}</title>
            </circle>
          ))
        })}
        <text className="el-axis" x={size / 2} y={size - 6} textAnchor="middle">forecast</text>
        <text className="el-axis" x={8} y={size / 2} textAnchor="middle" transform={`rotate(-90 8 ${size / 2})`}>hit rate</text>
      </svg>
    </div>
  )
}

/* ---------------------------------------------------------------- pieces */

// The three arms side by side: easier to compare than three cards, and it fits a phone.
function Scoreboard({ arms, scope, setScope, commonGames, settledGames }) {
  const rows = [
    ['Avg CLV', (a) => <b className="el-big">{cents(a.clvMean)}</b>, 'Closing mid at tip-off minus the price paid, per bet. The verdict.'],
    ['Std. error', (a) => (a.clvSe != null ? `±${cents(a.clvSe, false)}` : '—'), 'How far the average could be off by chance alone.'],
    ['t', (a) => (a.clvT != null ? `${a.clvT < 0 ? '−' : ''}${Math.abs(a.clvT).toFixed(1)}` : '—'), 'The average divided by its standard error. Beyond ±2 is more than noise.'],
    ['Beat the close', (a) => pct(a.beatRate)],
    ['Bets', (a) => `${a.bets}${a.voids ? ` (${a.voids} void)` : ''}`],
    ['With a close', (a) => a.clvBets, 'Bets with a two-sided quote at tip-off, the ones CLV is measured on.'],
    ['Record', (a) => `${a.wins}–${a.losses}`],
    ['ROI', (a) => (a.roi == null ? '—' : pct(a.roi, 1))],
    ['P&L', (a) => units(a.pnl), 'Units: each bet risks one unit, fee included.'],
    ['Brier vs market', (a) => (a.skill == null ? '—' : Math.abs(a.skill) < 0.0005 ? '0.0%' : `${a.skill > 0 ? '+' : '−'}${Math.abs(a.skill * 100).toFixed(1)}%`), 'Positive means its probabilities scored better than Kalshi\'s mid on every quoted market it priced.'],
    ['Forecasts scored', (a) => a.forecasts.toLocaleString('en-US')],
  ]
  const most = Math.max(0, ...arms.map((a) => a.clvBets || 0))
  return (
    <section className="el-panel el-board">
      <div className="el-board-head">
        <div className="el-seg">
          <button className={scope === 'common' ? 'on' : ''} onClick={() => setScope('common')}>Head to head ({commonGames})</button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Every game ({settledGames})</button>
        </div>
        <span className="el-muted el-small">{scope === 'common' ? 'Only games all three arms priced, so none gets an easier set of nights.' : 'Each arm over every game it priced.'}</span>
      </div>
      <div className="el-scroll">
        <table className="el-table el-score">
          <thead>
            <tr><th className="el-left" />{arms.map((a) => <th key={a.arm} className={`el-th-${a.arm}`}><i className={`el-sw el-${a.arm}`} />{ARM_SHORT[a.arm]}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(([label, f, tip]) => (
              <tr key={label}><td className="el-left el-muted" title={tip}>{label}</td>{arms.map((a) => <td key={a.arm}>{f(a)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="el-verdict">{arms.map((a) => (most >= FIRST_READ ? `${ARM_SHORT[a.arm]}: ${verdict(a)}` : null)).filter(Boolean).join(' ') || verdict({ clvBets: most })}</p>
    </section>
  )
}

function BetRow({ b }) {
  const r = b.result
  const outcome = r ? r.outcome : 'open'
  return (
    <tr className={`el-${outcome}`}>
      <td className="el-left"><i className={`el-sw el-${b.arm}`} title={ARM_SHORT[b.arm]} />{b.player}</td>
      <td>{b.side === 'yes' ? '' : 'NO '}{STAT[b.stat]} {b.k}+</td>
      <td>{price(b.price)}</td>
      <td>{pct(b.side === 'yes' ? b.p : 1 - b.p)}</td>
      <td>{cents(b.edge)}</td>
      <td>{r?.closeMid != null ? price(b.side === 'yes' ? r.closeMid : 1 - r.closeMid) : '—'}</td>
      <td>{r ? cents(r.clv) : '—'}</td>
      <td>{r ? (r.actual != null ? `${r.actual} · ` : '') + outcome : 'open'}</td>
      <td>{r ? units(r.pnl) : '—'}</td>
    </tr>
  )
}

function armSummary(bets, settled) {
  const out = []
  for (const arm of ARMS) {
    const bs = bets.filter((b) => b.arm === arm)
    if (!bs.length) continue
    if (!settled) { out.push([arm, `${bs.length} bet${bs.length === 1 ? '' : 's'}`]); continue }
    const done = bs.filter((b) => b.result && b.result.outcome !== 'void')
    const w = done.filter((b) => b.result.outcome === 'win').length
    const pnl = done.reduce((t, b) => t + b.result.pnl, 0)
    const clvs = done.map((b) => b.result.clv).filter((c) => c != null)
    out.push([arm, `${w}–${done.length - w}, ${units(pnl)}, CLV ${clvs.length ? cents(clvs.reduce((t, c) => t + c, 0) / clvs.length) : '—'}`])
  }
  return out
}

function GameCard({ g, armFilter }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState(false)
  const bets = g.bets.filter((b) => armFilter === 'all' || b.arm === armFilter)
  const errors = Object.entries(g.arms || {}).filter(([, a]) => a?.error)
  const summary = armSummary(bets, g.status === 'settled')
  return (
    <section className="el-game">
      <header>
        <div>
          <b>{g.away} at {g.home}</b>
          <span className="el-muted"> · {tipTime(g.tip)}{g.leadMin != null ? ` · decided ${g.leadMin} min before tip` : ''} · {g.markets} markets</span>
        </div>
        <span className={`el-pill el-pill-${g.status}`}>{g.status === 'settled' ? 'settled' : 'waiting on results'}</span>
      </header>
      {errors.map(([arm, a]) => <p key={arm} className="el-warn">{ARM_SHORT[arm]} failed: {a.error}</p>)}
      {summary.length ? (
        <div className="el-sum">{summary.map(([arm, text]) => <span key={arm}><i className={`el-sw el-${arm}`} />{ARM_SHORT[arm]}: {text}</span>)}</div>
      ) : <p className="el-muted el-small">No bets cleared the threshold{armFilter !== 'all' ? ' for this arm' : ''}.</p>}
      <div className="el-toggles">
        {bets.length > 0 && <button className="el-link" onClick={() => setOpen((v) => !v)}>{open ? 'Hide bets' : `Show ${bets.length} bets`}</button>}
        {(g.notes?.claude_wce || g.notes?.claude_box) && <button className="el-link" onClick={() => setNotes((v) => !v)}>{notes ? 'Hide' : 'Show'} Claude's notes</button>}
      </div>
      {open && (
        <div className="el-scroll">
          <table className="el-table">
            <thead><tr><th className="el-left">Player</th><th>Bet</th><th>Paid</th><th>Thought</th><th>Edge</th><th>Close</th><th>CLV</th><th>Result</th><th>P&amp;L</th></tr></thead>
            <tbody>{bets.map((b) => <BetRow key={`${b.arm}${b.ticker}`} b={b} />)}</tbody>
          </table>
        </div>
      )}
      {notes && ['claude_wce', 'claude_box'].filter((a) => g.notes[a]).map((a) => (
        <p key={a} className="el-note"><b>{ARM_SHORT[a]}:</b> {g.notes[a]}</p>
      ))}
    </section>
  )
}

/* ---------------------------------------------------------------- page */

export default function EdgeLab() {
  const [key, setKey] = useState(() => { try { return sessionStorage.getItem(STORAGE_KEY) || '' } catch { return '' } })
  const [draft, setDraft] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [metric, setMetric] = useState('clv')
  const [armFilter, setArmFilter] = useState('all')
  const [scope, setScope] = useState(null) // null until data says which view has something in it

  useEffect(() => {
    document.title = 'Edge Lab — WCE'
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  const load = useCallback(async (secret) => {
    if (!secret) return
    setError('')
    try {
      const res = await fetch(ENDPOINT, { headers: { 'x-analytics-key': secret } })
      if (res.status === 401) {
        setError('Wrong password.')
        setData(null)
        try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
        setKey('')
        return
      }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json)
    } catch (e) {
      setError(String(e.message || e))
    }
  }, [])

  useEffect(() => { if (key) load(key) }, [key, load])

  const submit = (e) => {
    e.preventDefault()
    const v = draft.trim()
    if (!v) return
    try { sessionStorage.setItem(STORAGE_KEY, v) } catch { /* ignore */ }
    setKey(v)
    setDraft('')
  }

  const runJob = async (job) => {
    setBusy(job)
    setError('')
    try {
      const res = await fetch(`${JOB}?job=${job}`, { headers: { 'x-analytics-key': key } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`)
      await load(key)
    } catch (e) {
      setError(`${job === 'edge-picks' ? 'Picks' : 'Settle'} run failed: ${e.message || e}`)
    } finally {
      setBusy('')
    }
  }

  const s = data?.status
  const pending = useMemo(() => (data?.recent || []).filter((g) => g.status !== 'settled'), [data])
  const settled = useMemo(() => (data?.recent || []).filter((g) => g.status === 'settled'), [data])

  if (!key) {
    return (
      <div className="el-root el-gate">
        <style>{CSS}</style>
        <form onSubmit={submit}>
          <h1>Edge Lab</h1>
          <p>Private. Enter the analytics password.</p>
          <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Password" autoFocus />
          <button type="submit">Unlock</button>
          {error && <p className="el-error">{error}</p>}
        </form>
      </div>
    )
  }

  return (
    <div className="el-root">
      <style>{CSS}</style>
      <div className="el-inner">
        <div className="el-head">
          <div>
            <h1>Edge Lab</h1>
            <p className="el-muted">Paper bets on Kalshi NBA player props. Do WCE's analytics, read by Claude, beat the price?</p>
          </div>
          <div className="el-actions">
            <button onClick={() => load(key)} disabled={!!busy}>Refresh</button>
            <button onClick={() => runJob('edge-picks')} disabled={!!busy}>{busy === 'edge-picks' ? 'Running…' : 'Run picks now'}</button>
            <button onClick={() => runJob('edge-settle')} disabled={!!busy}>{busy === 'edge-settle' ? 'Settling…' : 'Settle now'}</button>
          </div>
        </div>

        {error && <p className="el-error">{error}</p>}
        {!data && !error && <p className="el-muted">Loading…</p>}

        {s && (
          <p className="el-status">
            Last run {ago(s.lastRun)} ({s.lastJob?.replace('edge-', '') || '—'}, <b className={`el-st-${s.lastStatus}`}>{s.lastStatus || '—'}</b>)
            {' · '}{s.gamesDecided} games decided, {s.gamesSettled} settled
            {' · '}Claude {s.claude ? <b>on ({s.model})</b> : <b className="el-st-error">off</b>}
            {' · '}bets need {cents(s.minEdge, false)} of edge after fees
          </p>
        )}
        {s && !s.claude && (
          <p className="el-warn">The two Claude arms are off until ANTHROPIC_API_KEY is set in Vercel. The WCE model arm runs either way.</p>
        )}
        {s?.lastError && <p className="el-warn">Last run said: {s.lastError}</p>}

        {data && (
          <>
            <Scoreboard
              arms={(scope || (s.commonGames ? 'common' : 'all')) === 'common' ? data.armsCommon : data.arms}
              scope={scope || (s.commonGames ? 'common' : 'all')}
              setScope={setScope}
              commonGames={s.commonGames}
              settledGames={s.gamesSettled}
            />

            <section className="el-panel">
              <header className="el-panel-head">
                <h3>{metric === 'clv' ? 'Running closing line value' : 'Running profit and loss'}</h3>
                <div className="el-seg">
                  <button className={metric === 'clv' ? 'on' : ''} onClick={() => setMetric('clv')}>CLV</button>
                  <button className={metric === 'pnl' ? 'on' : ''} onClick={() => setMetric('pnl')}>P&amp;L</button>
                </div>
              </header>
              {data.daily.length ? <RunningChart daily={data.daily} metric={metric} /> : <p className="el-muted">Fills in after the first night settles.</p>}
              <div className="el-legend">{ARMS.map((a) => <span key={a}><i className={`el-sw el-${a}`} />{ARM_SHORT[a]}</span>)}</div>
            </section>

            <section className="el-panel el-row">
              <Calibration arms={data.arms} />
              <div className="el-calib-text">
                <h3>Calibration</h3>
                <p className="el-muted">Every quoted market each arm priced, bet or not, grouped by what it said. On the diagonal means its 60% calls hit 60% of the time. Groups need 10 results to show. “Brier vs market” in the table above scores the same forecasts against Kalshi's own mid at decision time.</p>
              </div>
            </section>

            <div className="el-filter">
              <span className="el-muted">Show bets from</span>
              <div className="el-seg">
                {['all', ...ARMS].map((a) => <button key={a} className={armFilter === a ? 'on' : ''} onClick={() => setArmFilter(a)}>{a === 'all' ? 'All arms' : ARM_SHORT[a]}</button>)}
              </div>
            </div>

            {pending.length > 0 && <h2>Waiting on results</h2>}
            {pending.map((g) => <GameCard key={g.key} g={g} armFilter={armFilter} />)}
            {settled.length > 0 && <h2>Settled, last ten nights</h2>}
            {settled.map((g) => <GameCard key={g.key} g={g} armFilter={armFilter} />)}
            {!data.recent.length && <p className="el-muted">No games decided yet. The picks job runs every hour from late morning and decides each game 20 to 150 minutes before tip.</p>}

            <h2>Runs</h2>
            <div className="el-scroll">
              <table className="el-table el-runs">
                <thead><tr><th className="el-left">When</th><th>Job</th><th>Status</th><th className="el-left">What happened</th></tr></thead>
                <tbody>
                  {data.runs.map((r, i) => (
                    <tr key={i}>
                      <td className="el-left">{new Date(r.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      <td>{r.job.replace('edge-', '')}</td>
                      <td className={`el-st-${r.status}`}>{r.status}</td>
                      <td className="el-left">
                        {[r.note, r.decided?.length ? `decided ${r.decided.join(', ')}` : '', r.bets ? `${r.bets} bets` : '',
                          r.settled?.length ? `settled ${r.settled.join(', ')}` : '', r.waiting?.length ? `waiting: ${r.waiting.join(', ')}` : '',
                          r.skipped?.length ? `skipped ${r.skipped.join(', ')}` : '', r.error].filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="el-foot">
              Three arms price the same markets without seeing a price: the WCE projection alone, Claude with WCE's analytics, and Claude with box scores only.
              Each takes at most one bet per player per game, at the ask, when its edge clears the threshold after Kalshi's fee. CLV is the closing mid at tip-off minus the price paid.
              Paper only: nothing here places an order.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

const CSS = `
.el-root {
  --surface: #ffffff; --plane: #ecebe8; --ink: #191b1f; --ink-2: #4e535b; --muted: #676c75;
  --grid: #e6e4df; --hair: #dddbd5;
  --a-model: #2f5f96; --a-claude_wce: #9a7a2e; --a-claude_box: #bc3a2c;
  --win: #1f7a4a; --loss: #b23a2c;
  color-scheme: light; background: var(--plane); color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  min-height: 100%; padding: 24px 16px 56px; box-sizing: border-box;
}
:root[data-theme="dark"] .el-root, .dark .el-root {
  --surface: #14161c; --plane: #0d0d0d; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --hair: rgba(255,255,255,0.14);
  --a-model: #6aa2df; --a-claude_wce: #d6b56a; --a-claude_box: #e2685a; --win: #5cc48b; --loss: #e2685a;
  color-scheme: dark;
}
.el-inner { max-width: 1120px; margin: 0 auto; }
.el-root h1 { font-size: 22px; font-weight: 650; margin: 0; letter-spacing: -0.01em; }
.el-root h2 { font-size: 16px; font-weight: 650; margin: 26px 0 10px; }
.el-root h3 { font-size: 12px; font-weight: 600; margin: 0; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.06em; }
.el-muted { color: var(--muted); }
.el-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
.el-head p { margin: 4px 0 0; }
.el-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.el-root button { font: inherit; cursor: pointer; border-radius: 7px; border: 1px solid var(--hair);
  background: var(--surface); color: var(--ink-2); padding: 6px 11px; }
.el-root button:hover:not(:disabled) { color: var(--ink); background: var(--plane); }
.el-root button:disabled { opacity: .5; cursor: default; }
.el-status { font-size: 13px; color: var(--ink-2); margin: 0 0 10px; }
.el-st-ok { color: var(--win); } .el-st-partial { color: #b8742a; } .el-st-error { color: var(--loss); }
.el-warn { color: #9a5a12; background: rgba(236,131,90,0.10); border-radius: 8px; padding: 8px 11px; margin: 0 0 10px; font-size: 13px; }
.el-error { color: #d03b3b; margin: 8px 0; }

.el-board { margin: 14px 0 12px; padding: 8px 10px 12px; }
.el-board-head { display: flex; align-items: center; gap: 4px 12px; flex-wrap: wrap; margin: 4px 2px 8px; }
.el-root .el-score th { font-size: 12px; white-space: normal; color: var(--ink); font-weight: 600; white-space: normal; vertical-align: bottom; border-bottom: 2px solid var(--hair); }
.el-th-model { box-shadow: inset 0 3px 0 var(--a-model); } .el-th-claude_wce { box-shadow: inset 0 3px 0 var(--a-claude_wce); } .el-th-claude_box { box-shadow: inset 0 3px 0 var(--a-claude_box); }
.el-score { table-layout: fixed; }
.el-score td, .el-score th { padding: 7px 8px; }
.el-score th:first-child, .el-score td:first-child { width: 30%; }
.el-score td.el-left { white-space: normal; }
.el-big { font-size: 22px; font-weight: 650; letter-spacing: -0.02em; }
.el-verdict { margin: 10px 2px 0; font-size: 13px; color: var(--ink-2); }
.el-sum { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.el-sum span { display: inline-flex; align-items: center; }
.el-toggles { display: flex; gap: 16px; }
.el-small { font-size: 13px; margin: 0; }
.el-sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex: none; margin-right: 6px; vertical-align: -1px; }
.el-sw.el-model { background: var(--a-model); } .el-sw.el-claude_wce { background: var(--a-claude_wce); } .el-sw.el-claude_box { background: var(--a-claude_box); }

.el-panel { background: var(--surface); border: 1px solid var(--hair); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
.el-panel-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.el-row { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.el-calib-text { flex: 1; min-width: 220px; } .el-calib-text p { font-size: 13px; margin: 6px 0 0; }
.el-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--ink-2); margin-top: 6px; }
.el-chart { width: 100%; } .el-chart svg { display: block; overflow: visible; }
.el-grid { stroke: var(--grid); } .el-zero { stroke: var(--muted); stroke-dasharray: 3 3; }
.el-axis { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.el-line { fill: none; stroke-width: 2.2; stroke-linejoin: round; stroke-linecap: round; }
.el-line.el-model { stroke: var(--a-model); } .el-line.el-claude_wce { stroke: var(--a-claude_wce); } .el-line.el-claude_box { stroke: var(--a-claude_box); }
.el-calbox { fill: none; stroke: var(--grid); } .el-diag { stroke: var(--muted); stroke-dasharray: 3 3; }
.el-dot { fill-opacity: .8; stroke: var(--surface); stroke-width: 1; }
.el-dot.el-model { fill: var(--a-model); } .el-dot.el-claude_wce { fill: var(--a-claude_wce); } .el-dot.el-claude_box { fill: var(--a-claude_box); }

.el-seg { display: inline-flex; background: var(--surface); border: 1px solid var(--hair); border-radius: 9px; padding: 3px; gap: 2px; flex-wrap: wrap; }
.el-seg button { border: 0; background: transparent; padding: 4px 10px; border-radius: 6px; font-size: 13px; }
.el-seg button.on, .el-seg button.on:hover { background: var(--ink); color: var(--surface); }
.el-filter { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 18px 0 4px; font-size: 13px; }

.el-game { background: var(--surface); border: 1px solid var(--hair); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
.el-game > header { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px; font-size: 13px; }
.el-pill { font-size: 11px; border-radius: 99px; padding: 2px 8px; background: var(--plane); color: var(--ink-2); white-space: nowrap; }
.el-pill-settled { background: rgba(31,122,74,0.12); color: var(--win); }
.el-scroll { overflow-x: auto; }
.el-table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
.el-table th, .el-table td { text-align: right; padding: 5px 8px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
.el-table th { color: var(--muted); font-weight: 500; font-size: 12px; }
.el-table .el-left { text-align: left; }
.el-runs td.el-left:last-child { white-space: normal; min-width: 260px; }
tr.el-win td:nth-last-child(-n+2) { color: var(--win); } tr.el-loss td:nth-last-child(-n+2) { color: var(--loss); }
tr.el-void td { color: var(--muted); }
.el-link { border: 0 !important; background: none !important; padding: 8px 0 0 !important; color: var(--a-model) !important; font-size: 13px; }
.el-note { font-size: 13px; color: var(--ink-2); margin: 6px 0 0; }
.el-foot { color: var(--muted); font-size: 12px; margin-top: 26px; max-width: 80ch; }

.el-gate { display: grid; place-items: center; min-height: 70vh; }
.el-gate form { background: var(--surface); border: 1px solid var(--hair); border-radius: 14px; padding: 28px; width: min(340px, 100%); display: grid; gap: 10px; box-sizing: border-box; }
.el-gate p { color: var(--muted); margin: 0; font-size: 13px; }
.el-gate input { font: inherit; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--hair); background: var(--plane); color: var(--ink); }
.el-gate button { padding: 9px; background: var(--ink) !important; color: var(--surface) !important; border: 0; }
@media (max-width: 520px) {
  .el-root { padding: 18px 12px 48px; }
  .el-root .el-board { padding: 6px 6px 10px; }
  .el-root .el-score td, .el-root .el-score th { padding: 6px 3px; font-size: 12px; }
  .el-root .el-score .el-sw { display: block; margin: 0 0 3px auto; }
  .el-root .el-big { font-size: 17px; }
}
`
