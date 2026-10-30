// Read the accumulated archive. Password-gated.
//
// GET /api/analytics/history?key=<password>&from=2026-01-01&to=2026-09-03
//   from / to are optional; omit both for everything ever recorded.
//
// The answer also carries `connector`: the AI connector's usage log for the same range
// (api/_usage.js). It is read alongside the archive and can fail on its own without taking
// the page down: on a failure `connector` is { error }. `connector.keys` is who holds a
// connector key and how much they use it (api/_keys.js), always over all time, so its
// "active in the last 30 days" does not depend on the range asked for.

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
import { readUsage } from '../_usage.js';
import { readKeySummary } from '../_keys.js';
import { readEdge, readPortfolios } from './_edge.js';

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

  // The Edge Lab page (/edge) reads through here, behind the same password.
  if (url.searchParams.get('section') === 'edge') {
    try {
      const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : null;
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json(await readEdge({ from }));
    } catch (err) {
      return res.status(500).json({ error: String(err?.message || err) });
    }
  }

  // The Edge Lab's portfolios, marked at Kalshi's prices of the moment. The page asks every
  // 30 seconds while bets are open, and each ask adds a point to the night's line (at most
  // one a minute, however many pages are open).
  if (url.searchParams.get('section') === 'edge-live') {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json(await readPortfolios({ record: true }));
    } catch (err) {
      return res.status(500).json({ error: String(err?.message || err) });
    }
  }

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
    const [results, connector, keys] = await Promise.all([
      redisPipeline([
        ['HGETALL', K_DAILY],
        ['HGETALL', K_META],
        ...dims.map((d) => ['HGETALL', kDim(d.id)]),
      ]),
      readUsage({ from, to }).catch((err) => ({ error: String(err?.message || err) })),
      readKeySummary().catch((err) => ({ error: String(err?.message || err) })),
    ]);
    // Per-key counts reach the page as people (keys.top), not as raw key ids.
    if (connector && !connector.error) {
      delete connector.perKey;
      connector.keys = keys;
    }

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
      connector,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
