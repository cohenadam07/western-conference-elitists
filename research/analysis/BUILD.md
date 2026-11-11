# Prompt: server-side analysis for the WCE connector (WCE Pro)

*For Claude Code, opened in `/Users/adamcohen/western-conference-elitists`. Written Nov 11, 2026. This file is `~/WCE-Analysis/BUILD.md`; copy it to `research/analysis/BUILD.md` once you're on the branch.*

---

The Data Room (PR #66, merged) lets an AI pull the rows behind every Savant, at most 500 per call. That works for one player or one team. It breaks for whole-league questions, like "Do NBA teams shoot worse on the second night of a back-to-back, since 2010?" or "Which college QBs are clutch, and is it real?". Those would take thousands of calls.

This build runs the math on WCE's server instead. The AI sends one request; the server reads only the rows it needs, computes, and returns a small answer with sample sizes and how confident to be.

Read `DATA-ROOM.md` and `research/data-room/BUILD.md` first. You're extending that work.

## Adam's decisions (Nov 11, 2026)

1. **Two tools:**
   - **`savant_sql`:** read-only SQL over every Data Room table.
   - **`savant_analyze`:** statistics on top, with confidence built in.
2. **WCE Pro, but not for sale yet.**
   - The tools are listed only on connector addresses whose key carries the founder tier: Adam's and his co-founder's.
   - One setting opens them to every key holder later, as the free Pro beta works for `savant_query` today.
   - **Nothing is charged.** The data sources' terms limit commercial use, so no paywall, pricing page or payment code goes in. Monetizing comes later, through a clean data path (new sources, WCE's own data, or a license).
3. **Free hosting only.**
   - Use what we have: Vercel (the existing `api/mcp.js` function) and the GitHub release assets from the Data Room.
   - Paid options exist for later if it's slow (a bigger function, a hosted DuckDB service such as MotherDuck, a small always-on server). Don't use them; if speed forces the question, stop and report the numbers.
4. **The public connector doesn't change.** Its tools and up-front text stay exactly as they are.

## Ground rules

1. **Correct before fast.** Every SQL and analysis answer that has a Savant-page equivalent must match the page (§5).
2. **Security first:**
   - The AI writes the SQL, so treat it as untrusted.
   - It can read the Data Room tables and nothing else: no other URLs, no local files, no environment variables, no settings changes.
   - Prove each of those is blocked (§5).
3. **Free data and free hosting only.** Stop and ask Adam before anything that costs money.
4. **Disk and memory:**
   - Stop if the Mac's free space would drop below 8 GB.
   - Work in batches; the Mac has 8 GB of RAM.
   - On Vercel, cap DuckDB's memory well under the function's limit.
5. **Branch:** run `git fetch origin && git worktree add .claude/worktrees/analysis -b analysis origin/main`. Don't merge: connector changes need Adam's approval.
6. **Save usage:**
   - No subagents unless truly needed.
   - Don't re-read unchanged files.
   - Print summaries, not tables.

## 1. Spike first: prove the engine fits (stop and report if it doesn't)

Before building anything, answer three questions with measurements:

1. **Does DuckDB run inside `api/mcp.js` on Vercel?**
   - Package size against the function's limit.
   - Cold start time.
   - Memory use on a heavy query.
2. **Can DuckDB read Parquet from GitHub release assets with range requests,** following the redirect to GitHub's file host, so a query reads only the columns and row groups it needs?
   - Measure the bytes read for a narrow query (one player's season) and a broad one (one stat across all seasons).
   - If the redirect or range reads fail, find the best free alternative and report it before going on.
3. **How fast is it?**
   - Time a narrow query, a one-season league-wide query and an all-seasons league-wide query, cold and warm, on a Vercel preview.
   - **Targets:** most answers under 5 s; whole-league answers under 20 s; a hard stop before the function's time limit, with a message telling the AI how to narrow the question.
   - If whole-league answers can't get under 20 s for free, report the numbers and the paid options. Don't buy anything.

## 2. Parquet copies of every table

- **Convert every Data Room table to Parquet,** sorted so the usual filters skip the most data:
  - season and date first
  - then team
  - then player where it applies
- **Format:** one file per sport, table and season; sensible row-group sizes; statistics on.
- **Hosting:**
  - Large tables go to the same `dataroom` release tag, beside the JSON.
  - Small tables can live in `public/` if that's simpler. Report the size either way.
- **The JSON files stay.** `savant_data` keeps working exactly as it does.
- **Refresh:** each sport's existing refresh rewrites its in-progress season's Parquet with its JSON, under the same `continue-on-error` rule.
- **Check:** the Parquet and JSON for a season hold identical rows (count, then a checksum of the sorted rows).
- **Freshness:** the freshness check covers the Parquet copies too.

## 3. `savant_sql`

**What the AI sees:**
- One schema per sport: `nba`, `nfl`, `cfb`, `cbb`, `ufc`.
- Tables named as in the Data Room: `nfl.plays`, `nba.shots`, `cbb.games` and so on. Each is a view over all its seasons' files, with `season` as a column.
- The tool description tells the AI to read `savant_dictionary` first for columns.

**Rules:**
1. **One statement, `SELECT` or `WITH` only.** Reject everything else before it reaches the engine.
2. **Locked engine:**
   - External access off, except the allowlisted Data Room files.
   - No `read_csv`/`read_parquet` on other paths, no `getenv`, no `ATTACH`, no `INSTALL`/`LOAD`, no `COPY`, no `SET`/`PRAGMA`.
   - Configuration locked after setup.
   - A memory limit and a thread count that fit the function.
3. **Limits:**
   - Results are capped at 500 rows, saying how many there were in total.
   - Wall time is capped below the function's limit.
   - A query that would scan more than a set amount (say, every NFL play with no season filter, when the column list is huge) gets a clear message on how to narrow it, never a crash.
4. **Every answer includes:**
   - the rows
   - the row count and how many rows were scanned
   - "data through" for each table used (its newest row)
   - the time taken
   - a plain note on what the numbers are: every group total is computed, labeled as computed, as in `savant_query`

## 4. `savant_analyze`

A structured request. The AI describes the study, and the server runs it over the full data, reusing `savant_sql`'s engine and its locks.

**Studies to support (at least):**

| `study` | What it answers | Returns |
|---|---|---|
| `compare` | Is the gap between two groups real? (blitz vs no blitz, home vs away, before vs after a coach) | each group's mean or rate and sample; the difference with a 95% interval; a p-value from a permutation or bootstrap that resamples whole games, not plays; the effect size; a one-line verdict ("real", "probably noise", "too few") |
| `regress` | What moves an outcome, holding others fixed? (net rating on rest, travel and altitude) | coefficients with 95% intervals; standard errors clustered by game or team, whichever the AI names; R² or log-loss; sample; a warning when predictors are badly correlated |
| `stability` | Is this stat a skill or noise, and how many attempts until it settles? | split-half reliability and the settle point, using the same method and code as the Savant stability backtests (`player_study.py` and the basketball settle-point work), so a stat's answer matches the page's bar verdict |
| `trend` | Has it changed? (a player's corner-three rate this season vs last; a league-wide trend since 2010) | the values by period, with intervals; whether the change is beyond noise |
| `distribution` | Where does a value sit? | percentile within the pool the AI names, with the pool stated; the distribution's summary |

**Rules:**
- **Every answer:** states its sample sizes, warns when a group is too small (with the Savant settle points where they exist), and names what it can't account for (for example, "play-level, not adjusted for opponent").
- **Multiple comparisons:** when a study tests many groups at once, adjust for it and say so.
- **Wording:** plain-language interpretation first, then the numbers. No causal language unless the study design supports it ("associated with", not "causes").

## 5. Checks

All must pass before the PR:

- **Parity with the pages:**
  - At least 25 SQL queries whose answers exist on a Savant page (player-season totals and rates, team ratings, leaderboards) return the page's numbers, across every sport.
  - `stability` matches the published settle points for at least 10 stats.
- **Statistics:** `compare` and `regress` match a reference implementation (statsmodels or scipy, run in the check) on at least 20 cases, within rounding. That covers intervals and clustered errors too.
- **Security:** each of these is rejected or blocked, with a test for each:
  - writes (`INSERT`, `CREATE`, `COPY`)
  - `ATTACH`, `INSTALL`, `LOAD`, `SET`, `PRAGMA`
  - reading any URL or path outside the allowlist
  - `getenv` and any other way to see environment variables
  - multiple statements
  - a query built to exhaust memory
  - a query built to run past the time limit
- **Gating:**
  - The public address and ordinary key holders don't list either tool, and calls to them fail cleanly.
  - Founder-tier keys list and run both.
  - The one switch opens both to every key holder, tested both ways.
  - The public up-front text is byte-identical to main's.
  - The founder listing stays under the 90,000-character cap.
- **Speed:** the §1 timings, re-measured on the final preview, cold and warm.
- **Exam:** add 20 questions to `tools/savant-mcp/exam/questions.json` that only these tools can answer: whole-league, multi-season, needing an interval or a regression. Gold answers are computed by an independent script (pandas plus statsmodels over the JSON tables), never by the tools under test. The self-check passes on them.
- **Suites:** `check:savant` and `check:whats-new` pass.

## 6. The founder tier

- Add a `tier` field to key records in the Upstash keys hash: absent for everyone, `founder` for Adam and his co-founder.
- Write `tools/keys/tier.mjs <email> founder|none`. It sets the tier on every key an email holds. It reads the store credentials from the environment and never prints a key.
- **Don't set anyone's tier yourself.** In the PR, tell Adam the exact command to run for himself and his co-founder once it's merged. If his co-founder has no key yet, he gets one free at wcehoops.com/#ai first.
- `PRO_ANALYSIS_OPEN` (or similar), default off: when on, every valid key gets the two tools.

## 7. Build sequence

| Step | What | Checks |
|---|---|---|
| 1 | Worktree; read the inputs; the §1 spike on a Vercel preview | Report the numbers. Stop and ask Adam if DuckDB doesn't fit, range reads don't work, or it's too slow for free |
| 2 | Parquet copies, every table, every season; the refresh writes them | Row and checksum match with the JSON |
| 3 | `savant_sql` with the locked engine | Security tests; SQL parity |
| 4 | `savant_analyze` | Statistics parity; stability parity |
| 5 | Founder tier, the open switch, the gated listing | Gating tests |
| 6 | Exam questions and gold answers | Self-check |
| 7 | Connector version bump. **No** What's New line on the homepage: it's founders-only for now, so the line waits until it opens. Note it in `DATA-ROOM.md` | `check:savant` |
| 8 | `ANALYSIS.md` at the repo root (engine, hosting, limits, security, timings, exam score); push; open a PR; give Adam the preview link, the founder-tier command and the review list | None |

## 8. Review list for Adam

- The spike numbers: package size, cold start, bytes read, the timing table.
- Where the Parquet files live, and their size.
- Every security test and its result.
- Parity results: SQL against the pages, statistics against the reference, stability against the published settle points.
- Any study type cut, with the reason.
- Exam self-check on the 20 new questions.
- The founder-tier command to run after merge.
- Every judgment call.
