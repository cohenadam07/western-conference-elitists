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
import { digestTokenOk, jobForSchedule, readPortfolios, researchTokenOk, runAnswer, runArm, runPicks, runQueue, runReview, runSettle, taskTokenOk } from './_edge.js';

// 300 s is the Hobby ceiling; the Edge Lab's picks job (Claude calls) is the one that needs it.
export const config = { maxDuration: 300 };

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

// A POST body: Vercel parses JSON into req.body; anything else is read off the stream.
async function readBody(req) {
  if (req.body != null) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const job = url.searchParams.get('job') || jobForSchedule(req.headers['x-vercel-cron-schedule']);

  // The Edge Lab's scheduled task (on Adam's Claude account) can do exactly two things here,
  // with its own token: fetch the prompts waiting to be answered, and post an answer.
  if (job === 'edge-queue' || job === 'edge-answer') {
    const token = req.headers['x-edge-token'];
    if (!taskTokenOk(Array.isArray(token) ? token[0] : token) && !authorize(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      if (job === 'edge-queue') {
        const out = await runQueue({ ahead: url.searchParams.get('ahead'), format: url.searchParams.get('format') });
        return res.status(out.ok ? 200 : 500).json(out);
      }
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST the answer as JSON' });
      const out = await runAnswer({ task: url.searchParams.get('task'), body: await readBody(req) });
      return res.status(out.ok ? 200 : out.status || 500).json(out);
    } catch (err) {
      return res.status(500).json({ ok: false, job, error: String(err?.message || err) });
    }
  }

  // The weekly researcher (a second scheduled task), with its own token: read the review, add
  // or retire a rule arm. Nothing else.
  // The morning email (a third scheduled task) can read the review and nothing else.
  if (job === 'edge-review' || job === 'edge-arm') {
    const first = (h) => (Array.isArray(h) ? h[0] : h);
    const research = researchTokenOk(first(req.headers['x-edge-research']));
    const digest = job === 'edge-review' && digestTokenOk(first(req.headers['x-edge-digest']));
    if (!research && !digest && !authorize(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      if (job === 'edge-review') return res.status(200).json(await runReview({ nights: Number(url.searchParams.get('nights')) || 0 }));
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST the change as JSON' });
      const out = await runArm({ body: await readBody(req) });
      return res.status(out.ok ? 200 : out.status || 500).json(out);
    } catch (err) {
      return res.status(500).json({ ok: false, job, error: String(err?.message || err) });
    }
  }

  if (!authorize(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // The Edge Lab's jobs share this function so the lab costs no function slot (see
  // api/analytics/_edge.js and EDGE_LAB.md). Its crons are told apart by the schedule header
  // Vercel sends; a manual run passes ?job=edge-picks or ?job=edge-settle, optionally with
  // &games=<key,key> to act on those games now, or &lead=<minutes> to widen the picks window.
  // A point on the portfolios' line during late games (cron), or by hand.
  if (job === 'edge-tick') {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const out = await readPortfolios({ record: true });
      return res.status(200).json({ ok: true, job, night: out.night, live: out.live, openBets: out.openBets, marksError: out.marksError,
        equity: Object.fromEntries(Object.entries(out.arms).map(([a, v]) => [a, v.equity])) });
    } catch (err) {
      return res.status(500).json({ ok: false, job, error: String(err?.message || err) });
    }
  }

  if (job === 'edge-picks' || job === 'edge-settle') {
    const games = (url.searchParams.get('games') || '').split(',').map((g) => g.trim()).filter(Boolean);
    const lead = Number(url.searchParams.get('lead')) || undefined;
    const keys = games.length ? games : undefined;
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const out = job === 'edge-picks' ? await runPicks({ lead, keys }) : await runSettle({ keys });
      return res.status(out.ok ? 200 : 500).json(out);
    } catch (err) {
      return res.status(500).json({ ok: false, job, error: String(err?.message || err) });
    }
  }

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

