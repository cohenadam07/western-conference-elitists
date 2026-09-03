import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Private analytics archive for wcehoops.com.
 *
 * Reads /api/analytics/history, which serves the Redis archive that the daily
 * cron keeps topped up — so this shows every day since the archive started,
 * not just Vercel's rolling 30-day window.
 *
 * Self-contained: no chart library, no Tailwind classes, no new dependencies.
 */

const STORAGE_KEY = 'wce-analytics-key';
const ENDPOINT = '/api/analytics/history';

const RANGES = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '180d', label: '6 months', days: 180 },
  { id: '365d', label: '1 year', days: 365 },
  { id: 'all', label: 'All time', days: null },
];

const DIM_ORDER = ['path', 'route', 'referrer', 'country', 'device', 'browser', 'os'];

/* ---------------------------------------------------------------- utils */

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const fmtInt = (n) => (n ?? 0).toLocaleString('en-US');

function fmtDate(dateStr, style = 'short') {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(style === 'long' ? { year: 'numeric' } : {}),
  });
}

function niceTicks(max, count = 4) {
  if (!max || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  // Counts are integers, so never step below 1 (avoids duplicate rounded ticks).
  const step = Math.max((norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag, 1);
  const top = Math.ceil(max / step) * step; // always covers the peak
  const ticks = [];
  for (let v = 0; v <= top + step * 0.001; v += step) ticks.push(Math.round(v));
  return ticks;
}

// Roll daily rows up to week (ISO Monday) or month buckets.
function bucketize(daily, grain) {
  if (grain === 'day') return daily.map((d) => ({ ...d, label: d.date }));
  const out = new Map();
  for (const row of daily) {
    const d = new Date(`${row.date}T00:00:00Z`);
    let key;
    if (grain === 'week') {
      const shift = (d.getUTCDay() + 6) % 7; // Monday start
      key = iso(d.getTime() - shift * 86400000);
    } else {
      key = `${row.date.slice(0, 7)}-01`;
    }
    const cur = out.get(key) || { date: key, pageviews: 0, visitors: 0, label: key };
    cur.pageviews += row.pageviews;
    cur.visitors += row.visitors;
    out.set(key, cur);
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(720);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/* --------------------------------------------------------------- charts */

function TrendChart({ rows, grain }) {
  const [wrapRef, width] = useElementWidth();
  const [hover, setHover] = useState(null);
  const height = 300;
  const pad = { top: 16, right: 16, bottom: 30, left: 52 };
  const plotW = Math.max(width - pad.left - pad.right, 10);
  const plotH = height - pad.top - pad.bottom;

  const max = Math.max(1, ...rows.map((r) => Math.max(r.pageviews, r.visitors)));
  const ticks = niceTicks(max);
  const yMax = ticks[ticks.length - 1] || 1;

  const x = (i) => (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const y = (v) => plotH - (v / yMax) * plotH;

  const line = (key) =>
    rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(r[key]).toFixed(2)}`).join(' ');
  const area = `${line('pageviews')} L${x(rows.length - 1).toFixed(2)},${plotH} L${x(0).toFixed(2)},${plotH} Z`;

  const labelEvery = Math.max(1, Math.ceil(rows.length / 6));

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left - pad.left;
    const i = rows.length === 1 ? 0 : Math.round((px / plotW) * (rows.length - 1));
    const idx = Math.min(Math.max(i, 0), rows.length - 1);
    setHover({ idx, px: pad.left + x(idx) });
  };

  const h = hover ? rows[hover.idx] : null;

  return (
    <div className="wa-chart-wrap" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Pageviews and visitors by ${grain}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <g transform={`translate(${pad.left},${pad.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="wa-grid" x1={0} x2={plotW} y1={y(t)} y2={y(t)} />
              <text className="wa-axis" x={-10} y={y(t)} dy="0.32em" textAnchor="end">
                {fmtInt(t)}
              </text>
            </g>
          ))}

          <path className="wa-area" d={area} />
          <path className="wa-line wa-s1" d={line('pageviews')} />
          <path className="wa-line wa-s2" d={line('visitors')} />

          {rows.map((r, i) =>
            i % labelEvery === 0 || i === rows.length - 1 ? (
              <text
                key={r.date}
                className="wa-axis"
                x={x(i)}
                y={plotH + 20}
                textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}
              >
                {grain === 'month' ? r.date.slice(0, 7) : fmtDate(r.date)}
              </text>
            ) : null
          )}

          {h && (
            <g>
              <line className="wa-crosshair" x1={x(hover.idx)} x2={x(hover.idx)} y1={0} y2={plotH} />
              <circle className="wa-dot wa-s1" cx={x(hover.idx)} cy={y(h.pageviews)} r={5} />
              <circle className="wa-dot wa-s2" cx={x(hover.idx)} cy={y(h.visitors)} r={5} />
            </g>
          )}
        </g>
      </svg>

      {h && (
        <div
          className="wa-tooltip"
          style={{
            left: Math.min(Math.max(hover.px, 70), Math.max(width - 70, 70)),
          }}
        >
          <div className="wa-tt-date">
            {grain === 'month'
              ? new Date(`${h.date}T00:00:00Z`).toLocaleDateString('en-US', {
                  timeZone: 'UTC',
                  month: 'long',
                  year: 'numeric',
                })
              : `${grain === 'week' ? 'Week of ' : ''}${fmtDate(h.date, 'long')}`}
          </div>
          <div className="wa-tt-row">
            <span className="wa-swatch wa-s1" /> Pageviews <b>{fmtInt(h.pageviews)}</b>
          </div>
          <div className="wa-tt-row">
            <span className="wa-swatch wa-s2" /> Visitors <b>{fmtInt(h.visitors)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

function DimensionPanel({ title, rows, note }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows.slice(0, 50) : rows.slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.pageviews));
  const total = rows.reduce((s, r) => s + r.pageviews, 0) || 1;

  return (
    <section className="wa-panel">
      <header className="wa-panel-head">
        <h3>{title}</h3>
        {note && <span className="wa-note">{note}</span>}
      </header>
      {rows.length === 0 ? (
        <p className="wa-empty">No data yet.</p>
      ) : (
        <ol className="wa-bars">
          {shown.map((r) => (
            <li key={r.key} title={`${r.key} — ${fmtInt(r.pageviews)} pageviews`}>
              <span className="wa-bar-fill" style={{ width: `${(r.pageviews / max) * 100}%` }} />
              <span className="wa-bar-key">{r.key}</span>
              <span className="wa-bar-val">
                {fmtInt(r.pageviews)}
                <em>{((r.pageviews / total) * 100).toFixed(1)}%</em>
              </span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 8 && (
        <button className="wa-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : `Show all ${Math.min(rows.length, 50)}`}
        </button>
      )}
    </section>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="wa-tile">
      <div className="wa-tile-label">{label}</div>
      <div className="wa-tile-value">{value}</div>
      {sub && <div className="wa-tile-sub">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ container */

export default function AnalyticsArchive() {
  const [key, setKey] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [draft, setDraft] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState('30d');
  const [grain, setGrain] = useState('auto');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    document.title = 'Analytics archive — WCE';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const load = useCallback(
    async (secret, rangeId) => {
      if (!secret) return;
      setLoading(true);
      setError('');
      const preset = RANGES.find((r) => r.id === rangeId) || RANGES[1];
      const params = new URLSearchParams();
      if (preset.days) params.set('from', iso(Date.now() - (preset.days - 1) * 86400000));
      try {
        const res = await fetch(`${ENDPOINT}?${params}`, {
          headers: { 'x-analytics-key': secret },
        });
        if (res.status === 401) {
          setError('Wrong password.');
          setData(null);
          try {
            sessionStorage.removeItem(STORAGE_KEY);
          } catch { /* ignore */ }
          setKey('');
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setData(json);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (key) load(key, range);
  }, [key, range, load]);

  const submit = (e) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, v);
    } catch { /* ignore */ }
    setKey(v);
    setDraft('');
  };

  const daily = data?.daily || [];
  const effectiveGrain = useMemo(() => {
    if (grain !== 'auto') return grain;
    if (daily.length > 400) return 'month';
    if (daily.length > 120) return 'week';
    return 'day';
  }, [grain, daily.length]);

  const rows = useMemo(() => bucketize(daily, effectiveGrain), [daily, effectiveGrain]);

  const exportCsv = () => {
    const header = 'date,pageviews,visitors';
    const body = daily.map((d) => `${d.date},${d.pageviews},${d.visitors}`).join('\n');
    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wcehoops-analytics-${data?.range?.from || 'all'}-to-${data?.range?.to || ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!key) {
    return (
      <div className="wa-root wa-gate">
        <style>{CSS}</style>
        <form onSubmit={submit}>
          <h1>Analytics archive</h1>
          <p>Private. Enter the dashboard password.</p>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Password"
            autoFocus
          />
          <button type="submit">Unlock</button>
          {error && <p className="wa-error">{error}</p>}
        </form>
      </div>
    );
  }

  const t = data?.totals;
  const archive = data?.archive;

  return (
    <div className="wa-root">
      <style>{CSS}</style>
      <div className="wa-inner">

      <header className="wa-head">
        <div>
          <h1>Analytics archive</h1>
          <p className="wa-sub">
            wcehoops.com ·{' '}
            {archive?.firstSeen
              ? `archiving since ${fmtDate(archive.firstSeen, 'long')} (${fmtInt(archive.totalDays)} days)`
              : 'no data yet'}
            {archive?.lastRun && ` · last sync ${new Date(archive.lastRun).toLocaleString()}`}
          </p>
        </div>
        <div className="wa-head-actions">
          <button onClick={() => load(key, range)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={exportCsv} disabled={!daily.length}>
            Export CSV
          </button>
        </div>
      </header>

      {archive?.lastStatus && archive.lastStatus !== 'ok' && (
        <p className="wa-warn">
          Last sync reported <b>{archive.lastStatus}</b>
          {archive.lastError ? `: ${archive.lastError}` : ''}
        </p>
      )}
      {error && <p className="wa-error">{error}</p>}

      <div className="wa-controls">
        <div className="wa-seg" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={range === r.id ? 'on' : ''}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="wa-seg" role="group" aria-label="Granularity">
          {['auto', 'day', 'week', 'month'].map((g) => (
            <button key={g} className={grain === g ? 'on' : ''} onClick={() => setGrain(g)}>
              {g === 'auto' ? `Auto (${effectiveGrain})` : g}
            </button>
          ))}
        </div>
      </div>

      <div className="wa-tiles">
        <StatTile label="Pageviews" value={fmtInt(t?.pageviews)} sub="in selected range" />
        <StatTile
          label="Visits"
          value={fmtInt(t?.visits)}
          sub="daily uniques, summed"
        />
        <StatTile
          label="Pageviews / visit"
          value={t?.visits ? (t.pageviews / t.visits).toFixed(2) : '—'}
          sub="engagement depth"
        />
        <StatTile
          label="Best day"
          value={t?.bestDay?.date ? fmtInt(t.bestDay.pageviews) : '—'}
          sub={t?.bestDay?.date ? fmtDate(t.bestDay.date, 'long') : 'no data'}
        />
      </div>

      <section className="wa-panel wa-panel-wide">
        <header className="wa-panel-head">
          <h3>Traffic over time</h3>
          <div className="wa-legend">
            <span><i className="wa-swatch wa-s1" />Pageviews</span>
            <span><i className="wa-swatch wa-s2" />Visitors</span>
            <button className="wa-more" onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Hide table' : 'Table view'}
            </button>
          </div>
        </header>
        {rows.length ? (
          <TrendChart rows={rows} grain={effectiveGrain} />
        ) : (
          <p className="wa-empty">
            Nothing archived for this range yet. Run the snapshot job to backfill the last 30 days.
          </p>
        )}
        {showTable && rows.length > 0 && (
          <div className="wa-table-scroll">
            <table className="wa-table">
              <thead>
                <tr><th>Date</th><th>Pageviews</th><th>Visitors</th></tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>{fmtInt(r.pageviews)}</td>
                    <td>{fmtInt(r.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="wa-panels">
        {DIM_ORDER.filter((id) => data?.dimensions?.[id]).map((id) => (
          <DimensionPanel
            key={id}
            title={data.dimensions[id].label}
            rows={data.dimensions[id].rows}
            note={id === 'referrer' ? 'by pageviews' : null}
          />
        ))}
      </div>

      <footer className="wa-foot">
        Vercel keeps 30 days. This archive keeps everything since{' '}
        {archive?.firstSeen ? fmtDate(archive.firstSeen, 'long') : '—'} · {fmtInt(archive?.runs)} syncs.
      </footer>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- css */

const CSS = `
.wa-root {
  /* Matched to the site's tokens in src/index.css */
  --surface: #ffffff;
  --plane: #ecebe8;
  --ink: #191b1f;
  --ink-2: #4e535b;
  --muted: #676c75;
  --grid: #e6e4df;
  --hair: #dddbd5;
  --s1: #3a6ea8;   /* navy family, lifted so it clears the chart legibility gates */
  --s2: #bc3a2c;   /* site red */
  --s1-fill: rgba(58,110,168,0.13);
  color-scheme: light;
  background: var(--plane);
  color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  min-height: 100%;
  padding: 28px 20px 56px;
  box-sizing: border-box;
}
/* The site is light-only, so dark applies only if something explicitly stamps it. */
:root[data-theme="dark"] .wa-root, .dark .wa-root {
  --surface: #14161c; --plane: #0d0d0d; --ink: #ffffff; --ink-2: #c3c2b7;
  --muted: #898781; --grid: #2c2c2a; --hair: rgba(255,255,255,0.14);
  --s1: #6aa2df; --s2: #e2685a; --s1-fill: rgba(106,162,223,0.18);
  color-scheme: dark;
}
.wa-inner { max-width: 1180px; margin: 0 auto; }

.wa-root h1 { font-size: 22px; font-weight: 650; margin: 0; letter-spacing: -0.01em; }
.wa-root h3 { font-size: 13px; font-weight: 600; margin: 0; color: var(--ink-2);
  text-transform: uppercase; letter-spacing: 0.06em; }
.wa-sub { color: var(--muted); margin: 4px 0 0; font-size: 13px; }

.wa-head { display: flex; justify-content: space-between; align-items: flex-start;
  gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.wa-head-actions { display: flex; gap: 8px; }
.wa-root button { font: inherit; cursor: pointer; border-radius: 7px;
  border: 1px solid var(--hair); background: var(--surface); color: var(--ink-2);
  padding: 6px 11px; transition: background .12s, color .12s; }
.wa-root button:hover:not(:disabled) { color: var(--ink); background: var(--plane); }
.wa-root button:disabled { opacity: .5; cursor: default; }

.wa-controls { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }
.wa-seg { display: flex; background: var(--surface); border: 1px solid var(--hair);
  border-radius: 9px; padding: 3px; gap: 2px; flex-wrap: wrap; }
.wa-seg button { border: 0; background: transparent; padding: 5px 11px; border-radius: 6px;
  font-size: 13px; text-transform: capitalize; }
.wa-seg button.on { background: var(--ink); color: var(--surface); }
.wa-seg button.on:hover { background: var(--ink); color: var(--surface); }

.wa-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px; margin-bottom: 18px; }
.wa-tile { background: var(--surface); border: 1px solid var(--hair); border-radius: 12px;
  padding: 14px 16px; }
.wa-tile-label { font-size: 12px; color: var(--muted); text-transform: uppercase;
  letter-spacing: 0.06em; }
.wa-tile-value { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; margin-top: 4px; }
.wa-tile-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }

.wa-panel { background: var(--surface); border: 1px solid var(--hair); border-radius: 12px;
  padding: 16px; }
.wa-panel-wide { margin-bottom: 18px; }
.wa-panel-head { display: flex; justify-content: space-between; align-items: center;
  gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.wa-note { font-size: 12px; color: var(--muted); }

.wa-legend { display: flex; align-items: center; gap: 14px; font-size: 12px; color: var(--ink-2); }
.wa-legend span { display: inline-flex; align-items: center; gap: 6px; }
.wa-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.wa-swatch.wa-s1 { background: var(--s1); }
.wa-swatch.wa-s2 { background: var(--s2); }

.wa-chart-wrap { position: relative; width: 100%; }
.wa-chart-wrap svg { display: block; overflow: visible; }
.wa-grid { stroke: var(--grid); stroke-width: 1; }
.wa-axis { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.wa-area { fill: var(--s1-fill); stroke: none; }
.wa-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.wa-line.wa-s1 { stroke: var(--s1); }
.wa-line.wa-s2 { stroke: var(--s2); }
.wa-dot { stroke: var(--surface); stroke-width: 2; }
.wa-dot.wa-s1 { fill: var(--s1); }
.wa-dot.wa-s2 { fill: var(--s2); }
.wa-crosshair { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
.wa-tooltip { position: absolute; top: 8px; transform: translateX(-50%); pointer-events: none;
  background: var(--surface); border: 1px solid var(--hair); border-radius: 9px;
  padding: 8px 11px; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.14); white-space: nowrap; }
.wa-tt-date { color: var(--muted); margin-bottom: 5px; }
.wa-tt-row { display: flex; align-items: center; gap: 6px; color: var(--ink-2); }
.wa-tt-row b { margin-left: auto; padding-left: 14px; color: var(--ink);
  font-variant-numeric: tabular-nums; }

.wa-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 14px; }

.wa-bars { list-style: none; margin: 0; padding: 0; }
.wa-bars li { position: relative; display: flex; align-items: center; gap: 10px;
  padding: 6px 8px; border-radius: 6px; overflow: hidden; }
.wa-bar-fill { position: absolute; inset: 0 auto 0 0; background: var(--s1-fill); border-radius: 6px; }
.wa-bar-key { position: relative; flex: 1; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
.wa-bar-val { position: relative; color: var(--ink-2); font-variant-numeric: tabular-nums;
  display: flex; gap: 8px; align-items: baseline; }
.wa-bar-val em { font-style: normal; color: var(--muted); font-size: 12px;
  min-width: 44px; text-align: right; }
.wa-more { margin-top: 8px; font-size: 12px; padding: 4px 9px; }

.wa-table-scroll { overflow-x: auto; max-height: 340px; overflow-y: auto; margin-top: 14px; }
.wa-table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
.wa-table th, .wa-table td { text-align: right; padding: 5px 10px; border-bottom: 1px solid var(--grid); }
.wa-table th:first-child, .wa-table td:first-child { text-align: left; }
.wa-table th { color: var(--muted); font-weight: 500; font-size: 12px; position: sticky; top: 0;
  background: var(--surface); }

.wa-empty { color: var(--muted); margin: 8px 0; }
.wa-error { color: #d03b3b; margin: 8px 0; }
.wa-warn { color: #ec835a; margin: 0 0 12px; }
.wa-foot { color: var(--muted); font-size: 12px; margin-top: 24px; text-align: center; }

.wa-gate { display: grid; place-items: center; min-height: 70vh; }
.wa-gate form { background: var(--surface); border: 1px solid var(--hair); border-radius: 14px;
  padding: 28px; width: min(340px, 100%); display: grid; gap: 10px; }
.wa-gate p { color: var(--muted); margin: 0; font-size: 13px; }
.wa-gate input { font: inherit; padding: 9px 11px; border-radius: 8px;
  border: 1px solid var(--hair); background: var(--plane); color: var(--ink); }
.wa-gate button { padding: 9px; background: var(--ink); color: var(--surface); border: 0; }
.wa-gate button:hover { background: var(--ink); color: var(--surface); opacity: .9; }
`;
