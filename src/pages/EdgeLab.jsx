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
const LIVE = '/api/analytics/history?section=edge-live'
const POLL_MS = 30000 // while bets are open
const JOB = '/api/analytics/snapshot'

const ARMS = ['model', 'claude_wce', 'claude_box']
const ARM_SHORT = { model: 'WCE model', claude_wce: 'Claude + WCE', claude_box: 'Claude, box only' }
const TICK_NAME = { model: 'WCE model', claude_wce: 'Claude + WCE', claude_box: 'Claude, box' }
const STAT = { pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', pra: 'PRA' }
const FIRST_READ = 300 // bets per arm before CLV says much

/* ---------------------------------------------------------------- format */

const cents = (x, signed = true) => (x == null ? '—' : Math.abs(x) < 0.0005 ? '0.0¢' : `${signed && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}¢`)
const pct = (x, d = 0) => (x == null ? '—' : `${x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`)
const units = (x) => (x == null ? '—' : Math.abs(x) < 0.005 ? '0.00u' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}u`)
const price = (x) => (x == null ? '—' : `${Math.round(x * 100)}¢`)
const usd = (x) => (x == null ? '—' : `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const usd0 = (x) => `$${Math.round(x).toLocaleString('en-US')}`
const usdSigned = (x) => (x == null ? '—' : Math.abs(x) < 0.005 ? '$0.00' : `${x > 0 ? '+' : '−'}\u2060${usd(Math.abs(x))}`)
const pctSigned = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(2)}%`)
const clock = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const shortDate = (d) => { const [, m, day] = d.split('-'); return `${+m}/${+day}` }
const secsAgo = (iso, now) => {
  if (!iso) return null
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`
}
const tipTime = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const ago = (iso) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

const tStat = (t) => (t == null || !Number.isFinite(t) ? '—' : `${t < 0 ? '−' : ''}${Math.abs(t).toFixed(1)}`)

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


/* ---------------------------------------------------------------- portfolios */

// The night's line (every point the page or a cron recorded) or the whole history (one point
// per settled night). Points share their x across the three arms, so one scrub reads all three.
function portfolioSeries(pf, view) {
  if (!pf) return []
  const now = Date.parse(pf.at)
  const eq = Object.fromEntries(ARMS.map((a) => [a, pf.arms[a].equity]))
  if (view === 'night') {
    if (!pf.night) return []
    const pts = []
    if (pf.nightOpen) pts.push({ x: Date.parse(pf.nightStart || pf.ticks[0]?.t || pf.at), e: pf.nightOpen, label: 'Bets placed' })
    for (const t of pf.ticks) pts.push({ x: Date.parse(t.t), e: t.e })
    if (pf.live) pts.push({ x: now, e: eq, label: 'Now' })
    else pts.push({ x: Math.max(pf.nightEnd ? Date.parse(pf.nightEnd) : now, ...pts.map((p) => p.x + 1)), e: eq, label: 'Settled' })
    return pts.filter((p, i, arr) => i === 0 || p.x > arr[i - 1].x)
  }
  const start = Object.fromEntries(ARMS.map((a) => [a, pf.config.start]))
  const pts = [{ x: 0, e: start, label: 'Start' }]
  pf.closes.forEach((c, i) => pts.push({ x: i + 1, e: Object.fromEntries(ARMS.map((a) => [a, c[a]])), label: shortDate(c.date) }))
  const last = pts[pts.length - 1].e
  if (ARMS.some((a) => Math.abs(last[a] - eq[a]) >= 0.005)) pts.push({ x: pts.length, e: eq, label: pf.live ? 'Now' : 'Latest' })
  return pts
}

// On a night the lines show each arm's change since its bets went in, so all three start
// level; over all history they show dollars from the common start.
function PortfolioChart({ pts, view, rel, base, live, scrub, setScrub }) {
  const [ref, width] = useElementWidth()
  const height = 230
  const pad = { top: 14, right: 14, bottom: 26, left: 58 }
  const w = Math.max(width - pad.left - pad.right, 10)
  const h = height - pad.top - pad.bottom
  if (pts.length < 2) {
    return <div className="el-chart" ref={ref}><p className="el-muted el-small el-chart-empty">{view === 'night' ? 'The line starts once tonight\'s bets are placed and moves as games play.' : 'One point per night, once the first night settles.'}</p></div>
  }
  const xs = pts.map((p) => p.x)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const v = (p, a) => p.e[a] - (rel ? rel[a] : 0)
  const vals = pts.flatMap((p) => ARMS.map((a) => v(p, a))).concat(base)
  let lo = Math.min(...vals), hi = Math.max(...vals)
  const padY = Math.max((hi - lo) * 0.12, 2)
  lo -= padY; hi += padY
  const X = (v) => (x1 === x0 ? w / 2 : ((v - x0) / (x1 - x0)) * w)
  const Y = (v) => h - ((v - lo) / (hi - lo)) * h
  const ticks = [lo + padY, (lo + hi) / 2, hi - padY]
  const fmt = (x) => (rel ? `${x > 0.5 ? '+' : x < -0.5 ? '−' : ''}$${Math.abs(Math.round(x)).toLocaleString('en-US')}` : `$${Math.round(x).toLocaleString('en-US')}`)
  const label = (p) => p.label || (view === 'night' ? clock(p.x) : '')
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left - pad.left
    let best = 0
    pts.forEach((p, i) => { if (Math.abs(X(p.x) - px) < Math.abs(X(pts[best].x) - px)) best = i })
    setScrub(best)
  }
  const last = pts.length - 1
  const at = scrub == null ? null : pts[scrub]
  return (
    <div className="el-chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Each arm's portfolio value" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setScrub(null)} style={{ touchAction: 'pan-y' }}>
        <g transform={`translate(${pad.left},${pad.top})`}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line className="el-grid" x1={0} x2={w} y1={Y(t)} y2={Y(t)} />
              <text className="el-axis" x={-8} y={Y(t)} dy="0.32em" textAnchor="end">{fmt(t)}</text>
            </g>
          ))}
          <line className="el-zero" x1={0} x2={w} y1={Y(base)} y2={Y(base)} />
          {ARMS.map((a) => (
            <path key={a} className={`el-line el-${a}`} d={pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(v(p, a)).toFixed(1)}`).join(' ')} />
          ))}
          {ARMS.map((a) => (
            <g key={a}>
              {live && <circle className={`el-pulse el-${a}`} cx={X(pts[last].x)} cy={Y(v(pts[last], a))} r={4} />}
              <circle className={`el-end el-${a}`} cx={X(pts[last].x)} cy={Y(v(pts[last], a))} r={3.5} />
            </g>
          ))}
          {at && (
            <g>
              <line className="el-scrub" x1={X(at.x)} x2={X(at.x)} y1={0} y2={h} />
              {ARMS.map((a) => <circle key={a} className={`el-end el-${a}`} cx={X(at.x)} cy={Y(v(at, a))} r={4} />)}
            </g>
          )}
          <text className="el-axis" x={0} y={h + 18} textAnchor="start">{label(pts[0])}</text>
          <text className="el-axis" x={w} y={h + 18} textAnchor="end">{label(pts[last])}</text>
        </g>
      </svg>
    </div>
  )
}

function Portfolios({ pf, error, now }) {
  const [view, setView] = useState('night')
  const [scrub, setScrub] = useState(null)
  const pts = useMemo(() => portfolioSeries(pf, view), [pf, view])
  useEffect(() => setScrub(null), [view])
  if (!pf) {
    return (
      <section className="el-panel el-pf">
        <header className="el-panel-head"><h3>Portfolios</h3></header>
        <p className="el-muted el-small">{error ? `Couldn't load the portfolios: ${error}` : 'Loading…'}</p>
      </section>
    )
  }
  const cfg = pf.config
  const base = view === 'night' && pf.nightOpen ? pf.nightOpen : Object.fromEntries(ARMS.map((a) => [a, cfg.start]))
  const shown = scrub != null && pts[scrub] ? pts[scrub] : null
  const value = (a) => (shown ? shown.e[a] : pf.arms[a].equity)
  const ago = secsAgo(pf.marksAt, now)
  const anyBets = ARMS.some((a) => pf.arms[a].open + pf.arms[a].settled > 0)
  return (
    <section className="el-panel el-pf">
      <header className="el-panel-head">
        <div className="el-pf-title">
          <h3>Portfolios</h3>
          {pf.live
            ? <span className="el-live"><i />Live{ago ? ` · prices ${ago}` : ''}</span>
            : <span className="el-muted el-small">{pf.night ? `No open bets · last slate ${shortDate(pf.night)}` : 'No bets yet'}</span>}
        </div>
        <div className="el-seg">
          <button className={view === 'night' ? 'on' : ''} onClick={() => setView('night')}>{pf.live ? 'Tonight' : 'Last slate'}</button>
          <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>All</button>
        </div>
      </header>
      <div className="el-tickers">
        {ARMS.map((a) => {
          const v = value(a), d = v - base[a]
          const arm = pf.arms[a]
          return (
            <div key={a} className={`el-tick el-tick-${a}`}>
              <span className="el-tick-name"><i className={`el-sw el-${a}`} />{TICK_NAME[a]}</span>
              <b className="el-tick-val">{usd(v)}</b>
              <span className={`el-tick-chg ${d > 0.004 ? 'up' : d < -0.004 ? 'down' : ''}`}>{usdSigned(d)} ({pctSigned(d / base[a])})</span>
              <span className="el-tick-sub">{arm.open ? `${arm.open} open, ${usd(arm.openStake)} in play` : `${arm.settled} settled bets`}</span>
            </div>
          )
        })}
      </div>
      <p className="el-pf-when el-muted">{shown ? (view === 'night' ? (shown.label && shown.label !== 'Now' ? shown.label : clock(shown.x)) : shown.label) : view === 'night' ? (pf.live ? 'Change since tonight\'s bets were placed' : 'Change over the last slate') : `Change since the ${usd0(cfg.start)} start`}</p>
      {anyBets ? <PortfolioChart pts={pts} view={view} rel={view === 'night' ? base : null} base={view === 'night' ? 0 : cfg.start} live={pf.live && view === 'night'} scrub={scrub} setScrub={setScrub} /> : <p className="el-muted el-small">The portfolios start moving with the first bets.</p>}
      {pf.marksError && <p className="el-warn">Kalshi didn't answer just now ({pf.marksError}); open bets are held at the last prices it gave.</p>}
      <p className="el-muted el-small el-pf-note">
        Each arm started with {usd0(cfg.start)}. Bets are sized by edge: {cfg.kellyFraction === 0.25 ? 'quarter' : `${cfg.kellyFraction}×`} Kelly from the bankroll going into the night,
        at most {pct(cfg.maxBet, 1)} on one bet, {pct(cfg.maxGame, 0)} on one game and {pct(cfg.maxNight ?? 1, 0)} on one night (a big slate gives each game less; a game's bets shrink together past its share). Open bets are valued at Kalshi's mid right now;
        the night locks in when it settles.
      </p>
    </section>
  )
}

/* ---------------------------------------------------------------- pieces */

// The three arms side by side: easier to compare than three cards, and it fits a phone.
function Scoreboard({ arms, scope, setScope, commonGames, settledGames }) {
  const rows = [
    ['Avg CLV', (a) => <b className="el-big">{cents(a.clvMean)}</b>, 'Closing mid at tip-off minus the price paid, per bet. It is the market move below minus the spread paid.'],
    ['Std. error', (a) => (a.clvSe != null ? `±${cents(a.clvSe, false)}` : '—'), 'How far the average could be off by chance alone.'],
    ['t', (a) => tStat(a.clvT), 'The average divided by its standard error. Beyond ±2 is more than noise.'],
    ['Market move', (a) => <b>{cents(a.moveMean)}</b>, 'How far Kalshi\'s mid moved toward the bet between the moment it was made and tip-off. The part of CLV that is about the forecast, with the spread taken out.'],
    ['Move t', (a) => tStat(a.moveT), 'The market move divided by its standard error. Beyond +2 means the market keeps moving the arm\'s way: an edge.'],
    ['Spread paid', (a) => (a.spreadPaid == null ? '—' : cents(-a.spreadPaid)), 'Half the bid-ask spread: what buying at the ask costs against the mid. A taker always pays it; CLV = market move − spread paid.'],
    ['Beat the close', (a) => pct(a.beatRate)],
    ['Bets', (a) => `${a.bets}${a.voids ? ` (${a.voids} void)` : ''}`],
    ['With a close', (a) => a.clvBets, 'Bets with a two-sided quote at tip-off, the ones CLV is measured on.'],
    ['Record', (a) => `${a.wins}–${a.losses}`],
    ['ROI', (a) => (a.roi == null ? '—' : pct(a.roi, 1))],
    ['P&L (units)', (a) => units(a.pnl), 'Every bet counted as one unit, fee included, so the arms compare on picks alone. The portfolios above size by edge.'],
    ['Knows more than market', (a) => (a.info ? `${a.info.weight < 0 ? '−' : ''}${Math.abs(a.info.weight * 100).toFixed(0)}% (t ${tStat(a.info.t)})` : '—'), 'How much of the arm\'s disagreement with Kalshi\'s price to keep in a blend of the two, fitted on every scored forecast. 0% means the arm knows nothing the price doesn\'t; above 0 with t past 2 means it does, even if its own numbers score worse than the market. Forecasts in one game move together, so read this t generously.'],
    ['Blend vs market', (a) => (a.info?.blendSkill == null || !(a.info.weight > 0) ? '—' : `+${(a.info.blendSkill * 100).toFixed(1)}%`), 'How much better the blend (market + that share of the arm\'s disagreement) scores than the market alone. It only means something once the t above is past 2.'],
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

function BetRow({ b, st }) {
  const r = b.result
  const outcome = r ? r.outcome : 'open'
  const live = !r && st?.open
  return (
    <tr className={`el-${outcome}`}>
      <td className="el-left"><i className={`el-sw el-${b.arm}`} title={ARM_SHORT[b.arm]} />{b.player}</td>
      <td>{b.side === 'yes' ? '' : 'NO '}{STAT[b.stat]} {b.k}+</td>
      <td>{price(b.price)}</td>
      <td>{pct(b.side === 'yes' ? b.p : 1 - b.p)}</td>
      <td>{cents(b.edge)}</td>
      <td>{st ? usd(st.stake) : '—'}</td>
      <td>{live ? (st.mark != null ? price(st.mark) : '—') : r?.closeMid != null ? price(b.side === 'yes' ? r.closeMid : 1 - r.closeMid) : '—'}</td>
      <td>{r ? cents(r.clv) : '—'}</td>
      <td>{r ? (r.actual != null ? `${r.actual} · ` : '') + outcome : 'open'}</td>
      <td className={live ? `el-livepnl ${st.pnl > 0 ? 'up' : st.pnl < 0 ? 'down' : ''}` : ''}>{st ? usdSigned(st.pnl) : r ? units(r.pnl) : '—'}</td>
    </tr>
  )
}

function armSummary(bets, settled, stOf) {
  const out = []
  for (const arm of ARMS) {
    const bs = bets.filter((b) => b.arm === arm)
    if (!bs.length) continue
    const sts = bs.map(stOf).filter(Boolean)
    const dollars = sts.length === bs.length ? sts.reduce((t, x) => t + x.pnl, 0) : null
    if (!settled) {
      const staked = sts.reduce((t, x) => t + x.stake, 0)
      const live = dollars != null && sts.some((x) => x.mark != null) ? `, now ${usdSigned(dollars)}` : ''
      out.push([arm, `${bs.length} bet${bs.length === 1 ? '' : 's'}${sts.length ? `, ${usd(staked)} staked${live}` : ''}`])
      continue
    }
    const done = bs.filter((b) => b.result && b.result.outcome !== 'void')
    const w = done.filter((b) => b.result.outcome === 'win').length
    const pnl = done.reduce((t, b) => t + b.result.pnl, 0)
    const clvs = done.map((b) => b.result.clv).filter((c) => c != null)
    out.push([arm, `${w}–${done.length - w}, ${dollars != null ? usdSigned(dollars) : units(pnl)}, CLV ${clvs.length ? cents(clvs.reduce((t, c) => t + c, 0) / clvs.length) : '—'}`])
  }
  return out
}

const PILL = { pending: 'waiting for Claude', decided: 'waiting on results', settled: 'settled' }

function decidedWhen(g) {
  if (g.status === 'pending') return g.preparedAt ? ` · prepared ${Math.max(0, Math.round((Date.parse(g.tip) - Date.parse(g.preparedAt)) / 60000))} min before tip` : ''
  if (g.leadMin == null) return ''
  return g.leadMin > 0 ? ` · decided ${g.leadMin} min before tip` : ' · decided at tip, on the prepared quotes'
}

function GameCard({ g, armFilter, stakes }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState(false)
  if (g.status === 'pending') {
    return (
      <section className="el-game">
        <header>
          <div><b>{g.away} at {g.home}</b><span className="el-muted"> · {tipTime(g.tip)}{decidedWhen(g)} · {g.markets} markets</span></div>
          <span className="el-pill el-pill-pending">{PILL.pending}</span>
        </header>
        <p className="el-muted el-small">Prepared and waiting for the scheduled task's answers. All three arms are priced at the same moment once both answers are in, or 15 minutes before tip with whatever has arrived.</p>
      </section>
    )
  }
  const bets = g.bets.filter((b) => armFilter === 'all' || b.arm === armFilter)
  const errors = Object.entries(g.arms || {}).filter(([, a]) => a?.error)
  const stOf = (b) => stakes?.[`${g.key}|${b.arm}|${b.ticker}`]
  const summary = armSummary(bets, g.status === 'settled', stOf)
  return (
    <section className="el-game">
      <header>
        <div>
          <b>{g.away} at {g.home}</b>
          <span className="el-muted"> · {tipTime(g.tip)}{decidedWhen(g)} · {g.markets} markets</span>
        </div>
        <span className={`el-pill el-pill-${g.status}`}>{PILL[g.status] || g.status}</span>
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
            <thead><tr><th className="el-left">Player</th><th>Bet</th><th>Paid</th><th>Thought</th><th>Edge</th><th>Stake</th><th>{g.status === 'settled' ? 'Close' : 'Now'}</th><th>CLV</th><th>Result</th><th>P&amp;L</th></tr></thead>
            <tbody>{bets.map((b) => <BetRow key={`${b.arm}${b.ticker}`} b={b} st={stOf(b)} />)}</tbody>
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
  const [pf, setPf] = useState(null)
  const [pfError, setPfError] = useState('')
  const [now, setNow] = useState(() => Date.now())

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

  // The portfolios: once on open, then every 30 seconds while any bet is open and the tab is
  // in view. Each ask also re-reads the games every few minutes, so a game that settles or a
  // new slate shows up without a manual refresh.
  const loadLive = useCallback(async (secret) => {
    if (!secret) return
    try {
      const res = await fetch(LIVE, { headers: { 'x-analytics-key': secret } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setPf(json)
      setPfError('')
    } catch (e) {
      setPfError(String(e.message || e))
    }
  }, [])
  useEffect(() => { if (key) loadLive(key) }, [key, loadLive])
  const isLive = Boolean(pf?.live)
  useEffect(() => {
    if (!key || !isLive) return
    let n = 0
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      loadLive(key)
      n += 1
      if (n % 10 === 0) load(key)
    }, POLL_MS)
    const onVis = () => { if (!document.hidden) loadLive(key) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [key, isLive, loadLive, load])
  useEffect(() => {
    if (!isLive) return
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [isLive])

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
      await Promise.all([load(key), loadLive(key)])
    } catch (e) {
      setError(`${job === 'edge-picks' ? 'Picks' : 'Settle'} run failed: ${e.message || e}`)
    } finally {
      setBusy('')
    }
  }

  const s = data?.status
  // Tonight in tip-off order; settled games newest first.
  const pending = useMemo(() => (data?.recent || []).filter((g) => g.status !== 'settled').slice().reverse(), [data])
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
            <button onClick={() => { load(key); loadLive(key) }} disabled={!!busy}>Refresh</button>
            <button onClick={() => runJob('edge-picks')} disabled={!!busy}>{busy === 'edge-picks' ? 'Running…' : 'Run picks now'}</button>
            <button onClick={() => runJob('edge-settle')} disabled={!!busy}>{busy === 'edge-settle' ? 'Settling…' : 'Settle now'}</button>
          </div>
        </div>

        {error && <p className="el-error">{error}</p>}
        {!data && !error && <p className="el-muted">Loading…</p>}

        {s && (
          <p className="el-status">
            Last run {ago(s.lastRun)} ({s.lastJob?.replace('edge-', '') || '—'}, <b className={`el-st-${s.lastStatus}`}>{s.lastStatus || '—'}</b>)
            {' · '}{s.gamesDecided} games decided{s.gamesPending ? `, ${s.gamesPending} waiting for Claude` : ''}, {s.gamesSettled} settled
            {' · '}Claude {s.mode === 'task' ? <b>via the scheduled task (last answer {ago(s.lastAnswer)})</b> : s.mode === 'api' ? <b>via the API ({s.model})</b> : <b className="el-st-error">off</b>}
            {' · '}bets need {cents(s.minEdge, false)} of edge after fees
          </p>
        )}
        {s?.mode === 'off' && (
          <p className="el-warn">The two Claude arms are switched off (EDGE_CLAUDE=off). The WCE model arm runs either way.</p>
        )}
        {s?.mode === 'task' && s.gamesDecided > 0 && !s.lastAnswer && (
          <p className="el-warn">The scheduled task hasn't sent an answer yet. Games it doesn't answer before tip are decided with the WCE model alone and left out of the head-to-head table.</p>
        )}
        {s?.lastError && <p className="el-warn">Last run said: {s.lastError}</p>}

        {data && (
          <>
            <Portfolios pf={pf} error={pfError} now={now} />

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

            {pending.length > 0 && <h2>Tonight</h2>}
            {pending.map((g) => <GameCard key={g.key} g={g} armFilter={armFilter} stakes={pf?.stakes} />)}
            {settled.length > 0 && <h2>Settled, last ten nights</h2>}
            {settled.map((g) => <GameCard key={g.key} g={g} armFilter={armFilter} stakes={pf?.stakes} />)}
            {!data.recent.length && <p className="el-muted">No games yet. Each game is prepared a few hours before tip, answered by the scheduled task on your Claude account, and priced the moment both answers are in.</p>}

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
                        {[r.note, r.queued?.length ? `prepared ${r.queued.join(', ')}` : '', r.decided?.length ? `decided ${r.decided.join(', ')}` : '',
                          r.closed?.length ? `closed ${r.closed.join(', ')}` : '', r.bets ? `${r.bets} bets` : '',
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
              The portfolios size the same bets by edge in dollars; the table counts every bet as one unit. Paper only: nothing here places an order.
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
.el-pill-pending { background: rgba(154,122,46,0.14); color: var(--a-claude_wce); }
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

.el-pf { padding-bottom: 12px; }
.el-pf-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.el-live { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--win); font-weight: 600; }
.el-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--win); animation: el-blink 1.6s ease-in-out infinite; }
@keyframes el-blink { 50% { opacity: .25; } }
.el-tickers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 4px 0 8px; }
.el-tick { border: 1px solid var(--hair); border-radius: 10px; padding: 9px 10px; display: grid; gap: 1px; min-width: 0; }
.el-tick-model { box-shadow: inset 0 3px 0 var(--a-model); } .el-tick-claude_wce { box-shadow: inset 0 3px 0 var(--a-claude_wce); } .el-tick-claude_box { box-shadow: inset 0 3px 0 var(--a-claude_box); }
.el-tick-name { font-size: 12px; color: var(--ink-2); display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.el-tick-val { font-size: 22px; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.el-tick-chg { font-size: 13px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
.el-tick-chg.up, .el-livepnl.up { color: var(--win); } .el-tick-chg.down, .el-livepnl.down { color: var(--loss); }
.el-tick-sub { font-size: 11px; color: var(--muted); }
.el-pf-when { font-size: 12px; margin: 2px 0 0; min-height: 18px; }
.el-pf-note { margin-top: 8px; }
.el-chart-empty { padding: 30px 0; text-align: center; }
.el-end { stroke: var(--surface); stroke-width: 1.5; }
.el-end.el-model, .el-pulse.el-model { fill: var(--a-model); } .el-end.el-claude_wce, .el-pulse.el-claude_wce { fill: var(--a-claude_wce); } .el-end.el-claude_box, .el-pulse.el-claude_box { fill: var(--a-claude_box); }
.el-pulse { transform-box: fill-box; transform-origin: center; animation: el-ping 1.8s ease-out infinite; }
@keyframes el-ping { 0% { transform: scale(1); opacity: .55; } 100% { transform: scale(3.2); opacity: 0; } }
.el-scrub { stroke: var(--muted); stroke-width: 1; }
@media (prefers-reduced-motion: reduce) { .el-pulse, .el-live i { animation: none; } }
@media (max-width: 520px) {
  .el-root { padding: 18px 12px 48px; }
  .el-root .el-tickers { gap: 6px; }
  .el-root .el-tick { padding: 8px 7px; }
  .el-root .el-tick-val { font-size: 16px; }
  .el-root .el-tick-chg { font-size: 11px; }
  .el-root .el-tick-name { font-size: 11px; }
  .el-root .el-board { padding: 6px 6px 10px; }
  .el-root .el-score td, .el-root .el-score th { padding: 6px 3px; font-size: 12px; }
  .el-root .el-score .el-sw { display: block; margin: 0 0 3px auto; }
  .el-root .el-big { font-size: 17px; }
}
`
