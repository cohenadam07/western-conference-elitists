# Edge Lab

A private, forward-only test of one question: **do WCE's analytics, read by Claude, beat the
prices on NBA player props?** It lives at `/edge`, behind the analytics password, and it only
ever places paper bets. Nothing in it can trade.

## The test

Every game, a few hours before tip, three forecasters price the same Kalshi prop markets
(points, rebounds, assists, threes, and points + rebounds + assists). None of them sees a price.
The two Claude arms run on Adam's Claude account through a scheduled task, not a paid API key
(see below).

| Arm | What it gets |
|---|---|
| **WCE model** | The WCE projection (`savant-proj.json`, the Fantasy tab's rest-of-season line) turned into a probability with a negative binomial whose spread comes from the player's own last 60 games. No Claude. |
| **Claude + WCE** | Claude, given the WCE projection and the WCE model's number for every market, Basketball Savant percentiles (vs. his position), team ratings with ranks, ESPN's injury list with the news blurb, and what each player's numbers did in past games his injured teammates missed (`ww_inv`). |
| **Claude, box only** | Claude, given per-game averages over the last 60 games, the last five box lines, and ESPN's injury statuses. Nothing from WCE. |

Comparing the arms answers three questions at once: is the WCE projection any good on its own
(model vs. market), does Claude add anything on top of it (Claude + WCE vs. model), and is it the
analytics or just Claude (Claude + WCE vs. Claude, box only).

**Bets.** Each arm takes at most one bet per player per game: the market and side with the
biggest edge, priced at the ask (what a taker pays), after Kalshi's taker fee
(0.07 × P × (1 − P) per contract), and only when that edge is at least 3 points. Quotes wider
than 10¢ or priced outside 5–95¢ are never bet. Every bet risks one unit, fee included.

**Scoring.**

- **CLV (the verdict).** The Kalshi mid at tip-off minus the price paid. Beating the closing price
  consistently is the standard proof of an edge, and it says something within a few hundred bets.
  The page shows the average, its standard error and t; |t| above 2 is more than noise. Bets are
  paid at the ask and measured against the mid, so each one starts half a spread behind: a
  positive average has had to overcome that.
- **Record, ROI, P&L.** Shown, but at -110-style prices you need ~1,500 bets before a hit rate
  separates from luck.
- **Brier vs. market and calibration.** Every quoted market each arm priced (bet or not) is scored
  against the result, next to Kalshi's own mid at decision time. Thousands of these pile up every
  week, so this is the earliest signal of whether an arm's probabilities are better than the
  market's.

A player who never takes the court is a void: Kalshi pays out a fair price, and the bet is left
out of P&L and CLV. A close needs a two-sided quote; the page shows how many bets had one.

**One moment for all three.** When both Claude answers are in, the site reads Kalshi's quotes
right then and prices every arm's bets at those same quotes, so no arm gets a better or worse
moment than another.

**Head to head.** The scoreboard defaults to games all three arms priced, so the Claude arms
are never scored on a different set of nights. A game the scheduled task doesn't answer before
tip is decided 15 minutes out with the WCE model alone and stays out of the head-to-head table.

## How it runs

Everything runs inside `api/analytics/snapshot.js`, so the lab costs **no serverless function
slot** (the Hobby cap is 12 and the site uses 11). The page reads through
`api/analytics/history.js?section=edge`. The code is in `api/analytics/_edge*.js`.

A game goes **prepared → pending → decided → settled**:

| Step | Who, when | What happens |
|---|---|---|
| prepare | Vercel cron, hourly 14:00–02:00 UTC (games 20–150 min out), or the scheduled task's queue call (games 15 min to 3 h 45 min out), whichever comes first | The markets worth forecasting, the WCE model's number for each, and both Claude prompts. The game waits as **pending**. |
| answer | The scheduled task on Adam's Claude account, 12:43, 4:43 and 7:43 pm ET | Fetches every pending prompt, has a fresh subagent answer each one (one per game per arm, so the box-score arm never sees a WCE number), and posts the answers back. The second answer for a game **decides** it at Kalshi's quotes of that moment. |
| close | Every Vercel picks run | A game still pending 15 minutes before tip is decided with whatever answers it has. |
| settle | Vercel cron, 11:00 UTC (7am EDT) | Results from Kalshi, the closing quote from Kalshi's minute candles at the tip, P&L and CLV per bet, aggregates per game. |

Vercel tells its crons apart by the `x-vercel-cron-schedule` header. The 07:00 analytics snapshot
is untouched.

**The scheduled task.** It lives in Adam's Claude account (Scheduled tasks), runs in the cloud,
and needs nothing on his computer. It talks to two calls on the site:

```
GET  /api/analytics/snapshot?job=edge-queue                      prompts waiting to be answered
POST /api/analytics/snapshot?job=edge-answer&task=<game>.<arm>    one answer, as JSON
```

Both take the header `x-edge-token`, a token that can do nothing else (it can't read the page,
run picks or settle). Only its SHA-256 is in the code (`TASK_TOKEN_SHA256` in `_edge.js`); the
token itself is in the task's instructions. To replace it, set `EDGE_TASK_TOKEN_SHA256` in
Vercel to the new token's SHA-256 and update the task. An answer must price at least 80% of a
game's markets or it is refused (the task then asks a fresh subagent once more).

Usage: each run is one session plus two short subagents per game. It counts against the plan's
limits, not a bill. Games before about 1pm ET (holiday matinees) fall before the first run and
are decided with the WCE model alone.

`api/analytics/snapshot.js` now allows 300 seconds, which on Hobby requires Fluid compute (on
by default for projects created since 2025; Settings → Functions shows it). Without it the
deployment is refused, the live site keeps running on the previous one, and the fix is to turn
Fluid compute on. Every Kalshi call carries a deadline, so a run stops itself and writes down
what happened before the function limit.

**Data, all free and keyless:** Kalshi's public market data (quotes, candles, results), ESPN's
scoreboard (tip times) and injury feed, Sleeper (only to map Kalshi's player ids to the
projection file, once a day), and the site's own files (`savant-proj.json`,
`savant-teams*.json`, `savant-api/basketball/v1/`).

**Storage**, in the Upstash Redis the site already uses, under `wce:edge:*`: one small record per
game, the forecasts and bets as one JSON value per game, and the last 200 runs. Roughly 20–40 KB
per game, so a full season is well inside the free tier.

## Setup

Nothing new is required. Already in the project and reused: `KV_REST_API_URL`,
`KV_REST_API_TOKEN`, `CRON_SECRET`, `ANALYTICS_DASHBOARD_PASSWORD`.

Optional:

| Variable | |
|---|---|
| `EDGE_MIN_EDGE` | The bet threshold, default `0.03`. |
| `EDGE_TASK_TOKEN_SHA256` | Replaces the scheduled task's token (see above). |
| `EDGE_CLAUDE` | `off` switches the Claude arms off; `task` (the default) or `api`. |
| `ANTHROPIC_API_KEY`, `EDGE_CLAUDE_MODEL` | The other way to run the Claude arms: with a key set, the picks job calls the API itself and the scheduled task has nothing to do. About 5¢ a game for both arms on Sonnet 5.5 (`claude-sonnet-5-5`, the default model). |

## Running it by hand

From the page: **Run picks now** (prepares games in the window and closes any about to tip) and
**Settle now**. Or with the password as a header:

```
/api/analytics/snapshot?job=edge-picks                    the normal window
/api/analytics/snapshot?job=edge-picks&lead=600           prepare anything tipping in the next 10 h
/api/analytics/snapshot?job=edge-picks&games=26OCT21MINMIA  prepare that game now
/api/analytics/snapshot?job=edge-queue&ahead=600          what the task would be handed, 10 h out
/api/analytics/snapshot?job=edge-settle
```

To run the Claude arms early on a given day, run the scheduled task by hand from Claude's
Scheduled tasks list.

Game keys are Kalshi's: two-digit year, month, day, away, home.

## What to keep in mind when reading it

- **Early season.** Until rosters settle, the market knows about new roles that a projection
  built on last season doesn't. Expect the WCE model arm to look worst in the first weeks.
- **Injury news.** ESPN's feed is read when a game is prepared, one to four hours before tip.
  Late scratches after that aren't in any arm's information, which is the point: it is the
  information you would really have had.
- **Claude's model** is whatever the scheduled task runs on. Changing it mid-test changes the
  arm; the page's notes and the run log show when answers came in.
- **Wide closing quotes** make a noisy CLV on thin markets; bets only go on markets quoted within
  10¢, but the close can be wider. A quote that never moved in the day before tip leaves no
  minute candle; then the quote the bet was made at, still standing, is the close.
- **Kalshi's prop menu** is mostly starters and rotation players. That is the market being
  tested, not the whole NBA prop market.

## Checks

`npm run check:edge` covers the arithmetic offline: the negative binomial, the fee, the bet rule,
settlement and CLV, the scoring, the Kalshi parsing, the player join, Claude's answer parsing and
coherence, the scheduled task's texts and token, and that the box-score prompt never carries a
WCE number.

## Next

The same pipeline takes other markets: sportsbook prop prices next to Kalshi's (needs a paid
odds feed), then NFL props from Football Savant and UFC from UFC Savant.
