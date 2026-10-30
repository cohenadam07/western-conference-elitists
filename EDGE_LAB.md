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
| **Claude + WCE** | The game facts below, plus WCE's analytics: the WCE projection and usage for every rotation player, the WCE model's number for every market, Basketball Savant percentiles (vs. his position), team ratings with ranks, and what each player's numbers did in past games his injured teammates missed (`ww_inv`). |
| **Claude, box only** | The game facts below, plus box scores: every rotation player's averages over his last 60 games, and the last five box lines of each player with markets. Nothing from WCE. |

Both Claude arms get the same **game facts**, so the only difference between them is WCE's
analytics:
- **The injury report:** ESPN's status, the date of the update, and the news note for every listed player on both teams.
- **The rotations:** every player with a real role on both teams (out players included), most minutes first, with his minutes in his last five games and his games this season.
- **The schedule:** whether either team played the night before (a back-to-back), and both records.

Each prompt tells Claude to work out tonight's minutes for both teams before pricing anything:
who is out or limited, who takes those minutes and shots, and whose role tonight differs from
his averages.

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
- **Market move and spread paid.** CLV splits into two parts: the **spread paid** (the ask
  minus the mid when the bet was made, which every taker pays) and the **market move** (the
  mid at tip-off minus the mid when the bet was made, for the side taken). CLV = market move −
  spread paid. The market move is the part that is about the forecast: a positive move with t
  past 2 means the market keeps coming to the arm. Whether that beats the spread is what decides
  if the edge pays as a taker.
- **Knows more than market (the information test).** Over every scored forecast, the result's
  surprise against Kalshi's mid (result − mid) is fitted on the arm's disagreement with it
  (arm − mid), with no intercept. The slope is the share of the arm's disagreement a blend of
  the two should keep: 0% means the arm knows nothing the price doesn't, 100% means take its
  number as is. An arm can score worse than the market on its own (negative Brier skill) and
  still know something the market doesn't (a positive weight): it is then right in direction
  but overconfident, and a blend beats the price. "Blend vs market" is how much. Forecasts in
  one game move together (a player's ladder), so the t is generous. If a weight holds up past
  t ≈ 3 over a few weeks, the natural next betting rule is to bet the blend, as a fresh,
  pre-registered run.
- **Record, ROI, P&L.** Shown, but at -110-style prices you need ~1,500 bets before a hit rate
  separates from luck.
- **Brier vs. market and calibration.** Every quoted market each arm priced (bet or not) is scored
  against the result, next to Kalshi's own mid at decision time. Thousands of these pile up every
  week, so this is the earliest signal of whether an arm's probabilities are better than the
  market's.

**Portfolios (dollars).** Next to the unit scoreboard, each arm runs its own paper portfolio
from **$1,000**, sizing the same bets by edge instead of one unit apiece:

- Each bet starts at **quarter Kelly**: full Kelly for a contract bought at cost *c* (price plus
  fee) with edge *e* is *e* / (1 − *c*) of the bankroll; the portfolio stakes a quarter of that.
- The bankroll is the arm's **settled balance going into the night**, so a stake is fixed the
  moment it is bet and never changes with later results.
- Each game's share is **5%** of that bankroll, or **25% / games on the slate** when that is
  smaller (11 games get 2.27% each), so a full slate never puts more than a quarter of the
  bankroll in play. The slate's size is stored on each game when it is decided, so a stake
  never changes after it is bet. When one arm's bets on a game add up past its share, they all
  shrink by the same factor (bigger edges stay bigger); then no single bet is more than **1.5%**.
  (The night cap came in on Oct 22, after the first night put 45–55% in play; history was
  re-sized, and the first night's in-game line, recorded under the old sizing, was dropped.)
- Open bets are **marked live** at Kalshi's mid (or its settlement once a market resolves, or the
  last trade if there is no two-sided quote). The night locks in when it settles.

The page's "Tonight" chart is each arm's change since the night's bets went in, one point a
minute while the page is open (plus a cron point at 11pm, 12am and 1am ET, and the settle's
final point); "All" is one point per settled night. The unit P&L in the scoreboard stays,
because it compares the arms on picks alone; the portfolios add sizing on top. The sizing
(`PORTFOLIO` in `_edge-model.js`) is replayed over every bet on every read, so changing it
re-sizes history too: change it between tests, not during one.

A player who never takes the court is a void: Kalshi pays out a fair price, and the bet is left
out of P&L and CLV. A close needs a two-sided quote; the page shows how many bets had one.

**One moment for all three.** When both Claude answers are in, the site reads Kalshi's quotes
right then and prices every arm's bets at those same quotes, so no arm gets a better or worse
moment than another.

**Head to head.** The scoreboard defaults to games all three arms priced, so the Claude arms
are never scored on a different set of nights. A game the scheduled task doesn't answer before
tip is decided 15 minutes out with the WCE model alone and stays out of the head-to-head table.

## Experiments (since Oct 23, 2026)

The three arms above stay the head-to-head scoreboard. Everything tried since is an
**experiment**, scored only on games after it started, each with its own $1,000 portfolio.

- **Rule arms** are betting rules over forecasts the lab already makes, so they cost nothing:
  a source (`model`, `claude_wce`, `claude_box`, `claude_rc`, or `claude_avg`, the two original
  Claude arms averaged), optionally a **blend** with the market (bet on mid + w × (source − mid),
  with w the source's information weight fitted only on games settled before that night, 0 to 1,
  and no bets until 1,000 forecasts are scored), a side, a list of stats, an edge floor and
  ceiling, and a price range. They bet at the same moment and quotes as the arms they read from.
- **The report-card arm (`claude_rc`)** is a fourth Claude forecaster: Claude + WCE, shown its
  own track record before each game (calibration, its lean against the market, its record by
  stat; Claude + WCE's record until it has 1,000 scored forecasts of its own). Its control is
  Claude + WCE on the same games. It adds one answer per game to the scheduled task;
  `EDGE_RC=off` switches it off. A game waits only for the Claude arms it was prepared for.
- **The bar.** An arm graduates when its CLV t clears the one-sided 5% point divided across
  every arm ever tried (Bonferroni), over at least 300 bets with a close: 2.13 with 3 arms
  tried, 2.54 with 9, 2.81 with 20. Each new arm raises it for all of them, so "we found an
  edge" can't just mean "we tried enough times". A graduated arm still has to hold its edge on
  its next fresh bets before anything goes near real money.
- **Kalshi's own lean** is shown beside them: how far the YES price sat above how often YES
  hit, over every scored market. It tests the retail-overs idea without any forecaster.
- **The researcher.** A second scheduled task ("Edge Lab: weekly researcher", Mondays) reads
  `job=edge-review` and may add or retire rule arms with `job=edge-arm`, with its own passcode
  (header `x-edge-research`; only its SHA-256 is in the code, `EDGE_RESEARCH_TOKEN_SHA256`
  replaces it). The site enforces at most 2 new arms a week and 12 live, no duplicate rules,
  and no retirement before 21 days and 200 bets with a close. It never adds a Claude arm (those
  cost plan usage); it writes those up as proposals. Its log is `claude/edge-lab-research.md`
  in the project; its instructions are `tools/edge/research-prompt.md` (passcode left out).
- **The morning email.** A third scheduled task ("Edge Lab: morning email", 7:47 am ET Sunday
  to Friday; Sunday's covers Friday and Saturday nights) reads `job=edge-review&nights=N`
  with its own read-only passcode (header `x-edge-digest`, hash only in code,
  `EDGE_DIGEST_TOKEN_SHA256` replaces it) and writes Adam a summary: portfolios, the scoreboard
  with what it means, experiments, last night game by game with Claude's notes, anything that
  went wrong, and a read. Its final message is emailed to him. With `nights`, the review adds
  each night's games in full, the portfolios and the run log. Instructions:
  `tools/edge/digest-prompt.md` (passcode left out).
- The registry is `wce:edge:arms`. The five rule arms registered when experiments began (r1 to
  r5: two blends, the two Claudes averaged, big disagreements only, NO side only) are written
  in `SEED_RULES` in `_edge.js` with their reasons.

## How it runs

Everything runs inside `api/analytics/snapshot.js`, so the lab costs **no serverless function
slot** (the Hobby cap is 12 and the site uses 11). The page reads through
`api/analytics/history.js?section=edge`, and the live portfolios through `?section=edge-live`. The code is in `api/analytics/_edge*.js`.

A game goes **prepared → pending → decided → settled**:

| Step | Who, when | What happens |
|---|---|---|
| prepare | Vercel cron, hourly 14:00–02:00 UTC (games 20–150 min out), or the scheduled task's queue call (games 15 min to 3 h 45 min out), whichever comes first | The markets worth forecasting, the WCE model's number for each, and both Claude prompts. The game waits as **pending**. |
| answer | The scheduled task on Adam's Claude account, 12:43, 4:43, 5:43, 6:43 and 7:43 pm ET | Fetches every pending prompt, has a fresh subagent answer each one (one per game per arm, so the box-score arm never sees a WCE number), and posts the answers back. The second answer for a game **decides** it at Kalshi's quotes of that moment. |
| close | Every Vercel picks run | A game still pending 15 minutes before tip is decided with whatever answers it has. |
| settle | Vercel cron, 11:00 UTC (7am EDT) | Results from Kalshi, the closing quote from Kalshi's minute candles at the tip, P&L and CLV per bet, aggregates per game. |
| mark | The page every 30 s while bets are open; crons at 03:00, 04:00, 05:00 UTC; after each picks run and settle | Values every open bet at Kalshi's prices of the moment (shared for 20 s), and adds a point to the night's portfolio line (at most one a minute). |

Vercel tells its crons apart by the `x-vercel-cron-schedule` header. The 07:00 analytics snapshot
is untouched.

**The scheduled task.** It lives in Adam's Claude account (Scheduled tasks), runs in the cloud,
and needs nothing on his computer. It talks to two calls on the site:

```
GET  /api/analytics/snapshot?job=edge-queue                      prompts waiting to be answered
POST /api/analytics/snapshot?job=edge-answer&task=<game>.<arm>    one answer, as JSON
```

The task asks for the queue with `&format=data`: each game comes back as data only (the game
facts and the markets), with no instructions in it. The forecasting job itself, the rules,
the answer format and the rule against looking anything up, is written into the task's own
instructions (`tools/edge/task-prompt.md`, the passcode left out), and each subagent is told
the file is data. That keeps a downloaded file from ever steering what an agent does, and it
makes plain to the run's own permission check what the run is: Adam's own site, a passcode
he made for this one job, forecasts only. (On Oct 21 that check blocked the 4:43 pm run's
first fetch under the older format, where subagents were told to "do exactly what the file
says"; the 6:52 run of the same task went through.) Without `format=data` the queue still
returns the older self-contained texts.

The task runs at 12:43, 4:43, 5:43, 6:43 and 7:43 pm ET; the extra evening runs are backups,
so one blocked run can't cost a slate, and a run with nothing to price ends in seconds. It
sends a push notification with its one-line-per-game summary, or the exact error if a step
was blocked. It never places an order: it only sends forecasts.

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

Settled games carry an aggregate version (`aggV`); when a new field is added, older games are
recomputed from their stored bets and forecasts on the next page read, without asking Kalshi
again.

**Storage**, in the Upstash Redis the site already uses, under `wce:edge:*`: one small record per
game, the forecasts and bets as one JSON value per game, the last 200 runs, a short ledger row
per bet for the portfolios (`wce:edge:ledger`, filled in from the bets for games decided before
it existed), and each night's portfolio line (`wce:edge:ticks:<date>`, kept 60 days). Roughly 20–40 KB
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
/api/analytics/snapshot?job=edge-tick                     mark open bets now and add a point to the line
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
- **Claude's model** is whatever the scheduled task runs on: Claude Sonnet 5.5, chosen Oct 21.
  Changing it mid-test changes the arm, and results from before and after can't be pooled. If
  Sonnet shows no edge, Opus is the next thing to try, as a fresh run.
- **Wide closing quotes** make a noisy CLV on thin markets; bets only go on markets quoted within
  10¢, but the close can be wider. A quote that never moved in the day before tip leaves no
  minute candle; then the quote the bet was made at, still standing, is the close.
- **Kalshi's prop menu** is mostly starters and rotation players. That is the market being
  tested, not the whole NBA prop market.

## Checks

`npm run check:edge` covers the arithmetic offline: the negative binomial, the fee, the bet rule,
settlement and CLV (and its split into market move and spread paid), the scoring, the
information test, the portfolio sizing, caps and marks, the Kalshi parsing, the player join, Claude's answer parsing and
coherence, the scheduled task's texts and token, and that the box-score prompt never carries a
WCE number.

## Next

The same pipeline takes other markets: sportsbook prop prices next to Kalshi's (needs a paid
odds feed), then NFL props from Football Savant and UFC from UFC Savant.
