# Analytics Archive

Vercel's Web Analytics keeps a rolling 30-day window. This adds a daily job that
pulls that window and **upserts** it into the existing Upstash Redis, so history
accumulates instead of resetting — plus a private dashboard at `/analytics`.

Nothing is scraped: it uses Vercel's official
[Web Analytics REST API](https://vercel.com/docs/analytics/web-analytics-api).

## What's installed

| File | What it is |
|---|---|
| `api/analytics/_lib.js` | Redis REST + Vercel API + auth helpers. Zero dependencies. |
| `api/analytics/snapshot.js` | The daily job. Fetches and upserts. |
| `api/analytics/history.js` | Password-gated read endpoint. |
| `src/pages/AnalyticsArchive.jsx` | The dashboard. No chart library, no new packages. |

Also wired: the `/analytics` route in `src/App.jsx`, the `crons` entry in
`vercel.json`, and `Disallow: /analytics` in `public/robots.txt`.

## Remaining setup — environment variables

Project Settings → Environment Variables, set for **Production**:

| Variable | Where to get it |
|---|---|
| `VERCEL_ANALYTICS_TOKEN` | vercel.com/account/tokens → Create Token, scoped to whoever owns wcehoops. |
| `VERCEL_ANALYTICS_PROJECT_ID` | `prj_dSRz3SHX46QxsOZ51kMBWdru0yeV` |
| `VERCEL_TEAM_ID` | `team_SGFwo9EvFolJJ1JSESkUFoDY` — the Hobby team that owns this project. Required. |
| `CRON_SECRET` | Any long random string — `openssl rand -hex 32`. Vercel sends it automatically on cron requests. |
| `ANALYTICS_DASHBOARD_PASSWORD` | Whatever you'll type into the dashboard. |

The Upstash variables already in the project (`KV_REST_API_URL` /
`KV_REST_API_TOKEN`) are picked up automatically — the same pair
`api/leaderboard.js` uses.

Account context: Hobby plan, scope `cohenadam07s-projects`, project slug
`western-conference-elitists`. Hobby means a 1-month reporting window (which is
why this archive exists) and one cron firing per day.

## First run (backfill)

After deploying, hit this once to pull in the 30 days Vercel still has:

```
https://wcehoops.com/api/analytics/snapshot?days=30&key=YOUR_DASHBOARD_PASSWORD
```

Expect `"ok": true` and `daysArchived: 30`. Then open `/analytics`.

The cron runs at `0 7 * * *` (7:00 UTC ≈ 3am ET), after the previous UTC day
closes. On Hobby, crons fire once per day at an approximate time within the
scheduled hour — fine here, since each run re-reads the whole 30-day window and
self-heals a missed or late run.

## How the accumulation works

- `wce:wa:daily` — hash, field = `2026-09-03`, value = `{"pv":238,"v":167}`.
- `wce:wa:dim:path`, `:route`, `:referrer`, `:country`, `:device`, `:browser`,
  `:os` — hash, field = date, value = that day's top 60 rows.
- Each run **overwrites only the days the API returned.** Days that have aged out
  of Vercel's window are never touched, so they persist. Days still inside the
  window get corrected as Vercel's numbers settle.
- Re-running is idempotent — nothing double-counts.

About 4 KB per day across all seven dimensions ≈ 1.5 MB/year. Upstash's free
tier is 256 MB.

## A note on "visitors"

Vercel dedupes visitors *within the window you query*. The archive stores daily
visitor counts, so summing them across a month gives visits (daily uniques,
summed), not monthly uniques — a daily reader counts 30 times. The dashboard
labels that tile "Visits" for exactly this reason. Pageviews sum exactly. True
monthly uniques would need a separate `by=month` query.

## Troubleshooting

`/api/analytics/history?key=…` returns an `archive` block with `lastRun`,
`lastStatus` and `lastError`. The dashboard shows a banner when a sync was
partial or failed.

- **401 from the snapshot URL** — `key` doesn't match `ANALYTICS_DASHBOARD_PASSWORD`.
- **403 from the Vercel API** — token lacks access to the project, or
  `VERCEL_TEAM_ID` is set on a personal project (or missing on a team project).
- **402 from the Vercel API** — the endpoint is gated to a paid plan on this
  account. The archive design still holds; the fetch layer would need to move to
  the CSV export flow instead.
