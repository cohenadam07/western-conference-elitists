// Read the accumulated archive. Password-gated.
//
// GET /api/analytics/history?key=<password>&from=2026-01-01&to=2026-09-03
//   from / to are optional; omit both for everything ever recorded.

import {
  DIMENSIONS,
  K_DAILY,
  K_META,
  kDim,
  parseJSONSafe,
  presentedSecret,
  redisPipeline,
  timingSafeEqual,
  toHash,
} from './_lib.js';

export const config = { maxDuration: 30 };

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export default async function handler(req, res) {
  const password = process.env.ANALYTICS_DASHBOARD_PASSWORD;
  if (!password) {
    return res.status(500).json({
      error: 'ANALYTICS_DASHBOARD_PASSWORD is not set — refusing to serve data unprotected.',
    });
  }
  if (!timingSafeEqual(presentedSecret(req), password)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const url = new URL(req.url, 'http://localhost');
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : null;
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : null;
  const wantDims = (url.searchParams.get('dims') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const dims = wantDims.length
    ? DIMENSIONS.filter((d) => wantDims.includes(d.id))
    : DIMENSIONS;

  try {
    const results = await redisPipeline([
      ['HGETALL', K_DAILY],
      ['HGETALL', K_META],
      ...dims.map((d) => ['HGETALL', kDim(d.id)]),
    ]);

    const dailyHash = toHash(results[0]?.result);
    const meta = toHash(results[1]?.result);

    const inRange = (date) => (!from || date >= from) && (!to || date <= to);

    const daily = Object.entries(dailyHash)
      .filter(([date]) => inRange(date))
      .map(([date, raw]) => {
        const v = parseJSONSafe(raw, { pv: 0, v: 0 });
        return { date, pageviews: Number(v.pv) || 0, visitors: Number(v.v) || 0 };
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const totals = daily.reduce(
      (acc, d) => {
        acc.pageviews += d.pageviews;
        acc.visits += d.visitors;
        if (d.pageviews > acc.bestDay.pageviews) acc.bestDay = { ...d };
        return acc;
      },
      { pageviews: 0, visits: 0, days: daily.length, bestDay: { date: null, pageviews: 0, visitors: 0 } }
    );

    const dimensions = {};
    dims.forEach((d, i) => {
      const hash = toHash(results[2 + i]?.result);
      const rollup = new Map();
      for (const [date, raw] of Object.entries(hash)) {
        if (!inRange(date)) continue;
        const rows = parseJSONSafe(raw, []);
        if (!Array.isArray(rows)) continue;
        for (const [key, pv, vis] of rows) {
          const cur = rollup.get(key) || { key, pageviews: 0, visits: 0 };
          cur.pageviews += Number(pv) || 0;
          cur.visits += Number(vis) || 0;
          rollup.set(key, cur);
        }
      }
      dimensions[d.id] = {
        label: d.label,
        rows: [...rollup.values()].sort((a, b) => b.pageviews - a.pageviews).slice(0, 100),
      };
    });

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      range: { from: from || daily[0]?.date || null, to: to || daily.at(-1)?.date || null },
      archive: {
        firstSeen: meta.firstSeen || null,
        totalDays: Number(meta.totalDays) || Object.keys(dailyHash).length,
        lastRun: meta.lastRun || null,
        lastStatus: meta.lastStatus || null,
        lastError: meta.lastError || '',
        runs: Number(meta.runs) || 0,
      },
      totals,
      daily,
      dimensions,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
