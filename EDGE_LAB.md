# Edge Lab

A private, forward-only test of one question: **do WCE's analytics, read by Claude, beat the
prices on NBA player props?** It lives at `/edge`, behind the analytics password, and it only
ever places paper bets. Nothing in it can trade.

## The test

Every game, about two hours before tip, three forecasters price the same Kalshi prop markets
(points, rebounds, assists, threes, and points + rebounds + assists). None of them sees a price.

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

**Head to head.** The scoreboard defaults to games all three arms priced, so the Claude arms
are never scored on a different set of nights (they miss games while the API key is unset). If a
Claude call fails, the game is not recorded and the next run tries it again, as long as it is
more than 40 minutes from tip; a second failure records the game without that arm.

## How it runs

Both jobs run inside `api/analytics/snapshot.js`, so the lab costs **no serverless function
slot** (the Hobby cap is 12 and the site uses 11). The page reads through
`api/analytics/history.js?section=edge`. The code is in `api/analytics/_edge*.js`.

| Job | When (UTC) | What it does |
|---|---|---|
| picks | 14:00 through 02:00, one cron per hour | Decides every game tipping 20–150 minutes out that hasn't been decided. Hobby crons fire anywhere in their hour; a 130-minute window covers the worst gap between two runs. A run with nothing due settles anything finished instead. |
| settle | 11:00 (7am EDT) | Results from Kalshi, the closing quote from Kalshi's minute candles at the tip, P&L and CLV per bet, aggregates per game. |

Vercel tells the crons apart by the `x-vercel-cron-schedule` header. The 07:00 analytics snapshot
is untouched.

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

Already in the project and reused: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `CRON_SECRET`,
`ANALYTICS_DASHBOARD_PASSWORD`.

New:

| Variable | |
|---|---|
| `ANTHROPIC_API_KEY` | Turns the two Claude arms on. Without it the WCE model arm still runs and the page says the Claude arms are off. Create one at console.anthropic.com. |
| `EDGE_CLAUDE_MODEL` | Optional. Defaults to `claude-sonnet-5-5`. |
| `EDGE_MIN_EDGE` | Optional. The bet threshold, default `0.03`. |

**Cost.** A game's prompt is about 3,000 tokens for the WCE arm and 1,200 for the box arm, and
each answer about 1,500–2,000 tokens. With Sonnet 5.5 ($2 / $10 per million) that is roughly
5¢ a game for both arms, or $15–20 a month on a full schedule. Opus 5.5 is about double.

## Running it by hand

From the page: **Run picks now** and **Settle now**. Or with the password as a header:

```
/api/analytics/snapshot?job=edge-picks                    the normal window
/api/analytics/snapshot?job=edge-picks&lead=600           decide anything tipping in the next 10 h
/api/analytics/snapshot?job=edge-picks&games=26OCT21MINMIA  decide that game now
/api/analytics/snapshot?job=edge-settle
```

Game keys are Kalshi's: two-digit year, month, day, away, home.

## What to keep in mind when reading it

- **Early season.** Until rosters settle, the market knows about new roles that a projection
  built on last season doesn't. Expect the WCE model arm to look worst in the first weeks.
- **Injury news.** ESPN's feed is read at decision time, two hours before tip. Late scratches
  after that aren't in any arm's information, which is the point: it is the information you
  would really have had.
- **Wide closing quotes** make a noisy CLV on thin markets; bets only go on markets quoted within
  10¢, but the close can be wider. A quote that never moved in the day before tip leaves no
  minute candle; then the quote the bet was made at, still standing, is the close.
- **Kalshi's prop menu** is mostly starters and rotation players. That is the market being
  tested, not the whole NBA prop market.

## Checks

`npm run check:edge` covers the arithmetic offline: the negative binomial, the fee, the bet rule,
settlement and CLV, the scoring, the Kalshi parsing, the player join, Claude's answer parsing and
coherence, and that the box-score prompt never carries a WCE number.

## Next

The same pipeline takes other markets: sportsbook prop prices next to Kalshi's (needs a paid
odds feed), then NFL props from Football Savant and UFC from UFC Savant.
