// Daily snapshot job: pulls the last N days from Vercel Web Analytics and
// upserts them into Redis, so the archive keeps growing past Vercel's
// 30-day reporting window.
//
// Triggered by Vercel Cron (Authorization: Bearer $CRON_SECRET) or manually
// with ?key=<ANALYTICS_DASHBOARD_PASSWORD>&days=30

import {
  DIMENSIONS,
  K_DAILY,
  K_META,
  kDim,
  daysAgo,
  presentedSecret,
  queryVisits,
  redisPipeline,
  timingSafeEqual,
  toISODate,
} from './_lib.js';

export const config = { maxDuration: 60 };

// Keep this many rows per dimension per day. Vercel caps `limit` at 100 and
// buckets the tail into "Others", so 100 is the ceiling anyway.
const TOP_N = 60;
const DEFAULT_LOOKBACK = 30;

const rowDate = (row) => (row?.timestamp ? toISODate(row.timestamp) : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function authorize(req) {
  const secret = presentedSecret(req);
  const cronSecret = process.env.CRON_SECRET;
  const password = process.env.ANALYTICS_DASHBOARD_PASSWORD;
  if (cronSecret && timingSafeEqual(secret, cronSecret)) return true;
  if (password && timingSafeEqual(secret, password)) return true;
  // Vercel Cron requests carry the deployment's cron header even without a
  // configured secret; allow them only if no secret is configured at all.
  if (!cronSecret && !password) return true;
  return false;
}

export default async function handler(req, res) {
  if (!authorize(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const url = new URL(req.url, 'http://localhost');
  const requested = parseInt(url.searchParams.get('days') || '', 10);
  const lookback = Math.min(
    Math.max(Number.isFinite(requested) ? requested : DEFAULT_LOOKBACK, 1),
    400 // Pro/Plus reporting windows go to 12/24 months
  );

  const until = toISODate(Date.now());
  const since = daysAgo(lookback - 1);
  const startedAt = Date.now();
  const warnings = [];

  try {
    /* ---------- 1. daily totals ---------- */
    const dailyRows = await queryVisits({ by: ['day'], since, until });
    const daily = new Map();
    for (const row of dailyRows) {
      const date = rowDate(row);
      if (!date) continue;
      daily.set(date, { pv: num(row.pageviews), v: num(row.visitors) });
    }

    /* ---------- 2. per-day dimension breakdowns ---------- */
    // Two group-by dimensions in one call gets us every day at once.
    const dimResults = {};
    const settled = await Promise.allSettled(
      DIMENSIONS.map(async (dim) => {
        const rows = await queryVisits({
          by: ['day', dim.by],
          since,
          until,
          limit: 100,
        });
        const byDate = new Map();
        for (const row of rows) {
          const date = rowDate(row);
          if (!date) continue;
          const key = row[dim.by] == null || row[dim.by] === '' ? '(none)' : String(row[dim.by]);
          if (!byDate.has(date)) byDate.set(date, []);
          byDate.get(date).push([key, num(row.pageviews), num(row.visitors)]);
        }
        for (const [date, list] of byDate) {
          list.sort((a, b) => b[1] - a[1]);
          byDate.set(date, list.slice(0, TOP_N));
        }
        return [dim.id, byDate];
      })
    );

    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        dimResults[r.value[0]] = r.value[1];
      } else {
        warnings.push(`${DIMENSIONS[i].id}: ${r.reason?.message || r.reason}`);
      }
    });

    /* ---------- 3. upsert ---------- */
    // Only days the API actually returned are written, so days that have aged
    // out of Vercel's window keep whatever we last archived for them.
    const commands = [];

    if (daily.size) {
      const args = [];
      for (const [date, v] of daily) args.push(date, JSON.stringify(v));
      commands.push(['HSET', K_DAILY, ...args]);
    }

    for (const [id, byDate] of Object.entries(dimResults)) {
      if (!byDate.size) continue;
      const args = [];
      for (const [date, list] of byDate) args.push(date, JSON.stringify(list));
      commands.push(['HSET', kDim(id), ...args]);
    }

    const dates = [...daily.keys()].sort();
    commands.push([
      'HSET',
      K_META,
      'lastRun',
      new Date().toISOString(),
      'lastStatus',
      warnings.length ? 'partial' : 'ok',
      'lastError',
      warnings.join(' | '),
      'lastWindow',
      `${since}..${until}`,
      'lastDaysWritten',
      String(daily.size),
    ]);
    // firstSeen is the earliest date this archive has ever recorded.
    if (dates.length) {
      commands.push(['HSETNX', K_META, 'firstSeen', dates[0]]);
    }
    commands.push(['HINCRBY', K_META, 'runs', 1]);

    await redisPipeline(commands);

    // Recompute firstSeen from what's actually stored (cheap, keeps meta honest).
    const stored = await redisPipeline([['HKEYS', K_DAILY]]);
    const allDates = (stored[0]?.result || []).sort();
    if (allDates.length) {
      await redisPipeline([
        ['HSET', K_META, 'firstSeen', allDates[0], 'totalDays', String(allDates.length)],
      ]);
    }

    return res.status(200).json({
      ok: true,
      window: { since, until, lookback },
      daysFetched: daily.size,
      daysArchived: allDates.length,
      firstArchivedDate: allDates[0] || null,
      dimensions: Object.keys(dimResults),
      warnings,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    try {
      await redisPipeline([
        [
          'HSET',
          K_META,
          'lastRun',
          new Date().toISOString(),
          'lastStatus',
          'error',
          'lastError',
          String(err?.message || err).slice(0, 500),
        ],
      ]);
    } catch {
      /* meta write is best-effort */
    }
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
      hint:
        'Check VERCEL_ANALYTICS_TOKEN, VERCEL_ANALYTICS_PROJECT_ID, VERCEL_TEAM_ID ' +
        'and the Upstash env vars in Project Settings → Environment Variables.',
    });
  }
}

