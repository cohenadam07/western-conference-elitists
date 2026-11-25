# GM Savant — the pipeline

Every NBA head of basketball operations since 1979-80, judged like a fund manager. Built in gated
modules; this folder holds what is built so far. Nothing here reads, imports or copies Front Office
(`cap_engine.py`, `value_engine.py`, `trade_engine.py`, `fa_engine.py`, `franchise.py`,
`contracts_2026_27.json`, the September pick curve).

## Module 1: tenures and shared credit

| file | what |
|---|---|
| `fetch.py` | the one door outside: cached under `~/Basketball-Savant/cache_gm/`, spaced requests, a 403 or 429 is returned and never retried around |
| `br_execs.py` | Basketball-Reference's executive pages: per person and team-season, the games he was in charge for |
| `br_tx.py` | Basketball-Reference's season transaction pages, 1979-80 on (also the Module 2 backbone before 2000) |
| `espn_tx.py` | ESPN's transactions by calendar year, Nov 2000 on (cloud-reachable; the daily lane later) |
| `games.py` | every team's regular-season game dates from the NBA's game log (Mac lane), to pin a mid-season handover between two games |
| `fo_events.py` | front-office lines from both feeds as dated events (action, title, level) |
| `wiki.py` | dated sentences from each executive's Wikipedia article (the revision read is linked; the press citation inside the sentence is kept as the primary source). One request every 6 s; stops on a 429 |
| `tenures.py` | the spine: Basketball-Reference's team-seasons placed on the game line, dated from the lines, the games or the off-season |
| `credit.py` | co-decision-makers, the day-by-day credit table, confidence, the executive tree |
| `facts.py` | hand-checked facts, each with the page it was read from and what it says |
| `releases.py` | reads a list of team releases: publication date and the sentences carrying titles or reporting lines |
| `checks1.py` | the invariants: one team at a time, weights add to 1, no No. 2 credited, every lead sourced, every tenure sourced |
| `report1.py` | the Module 1 numbers |

```
python3 br_tx.py fetch && python3 br_execs.py fetch && python3 espn_tx.py
cd ~/Basketball-Savant && PYTHONPATH=<repo>/pipeline/basketball python3 <repo>/pipeline/basketball/gm/games.py
python3 fo_events.py && python3 wiki.py && python3 tenures.py && python3 credit.py && python3 report1.py
```

Outputs in `out/`: `gm_tenures.json` (nba.gm_tenures), `gm_credit.json` (the credit segments),
`gm_tree.json` (the executive tree).

### Rules, and why

- **Franchise = the operating club.** Charlotte 1988-2002 is New Orleans' line for the ledger, labeled
  "Charlotte Hornets (1988–2002)" on the page with a note that the NBA's official history assigns it to
  Charlotte (`facts.TEAM_LABELS`) (12 of 14 players carried
  over to New Orleans 2002-03; none from New Orleans to the 2004 Bobcats). ESPN's `CHA` before July 2004
  is that club too.
- **Handover dates, best first:** a dated line naming him at that team; a Wikipedia sentence dated inside
  the window; the two games around the handover; the off-season alone. Basketball-Reference's season
  filing cannot date an off-season move: it files Ainge (hired May 9, 2003) under the old season and
  Pritchard (hired May 1, 2017) under the new one.
- **Basketball-Reference's game counts overlap at a handover** (MacKinnon 59 + Weltman 24 = 83). A lone
  executive 1-3 games short is the whole season; an interim up to two games longer than his gap takes it;
  two interims with the same count share the spell; uncovered games between a departure and an arrival
  (12 or fewer) are the handover window.
- **Inside an undated window**, outgoing and incoming share credit equally and the segment says
  `date_unknown`. A **vacancy** is a dated departure and a dated hire with nobody between; decisions in it
  are uncredited and listed.
- **Second people in charge** are ESPN's dated lead hires (president of basketball operations, general
  manager) at a team where Basketball-Reference lists someone else that day, plus `facts.EXTRA_TENURES`. A
  spell ends at the earliest sourced evidence he left: a dated departure, the day before he becomes the
  listed head or takes a job elsewhere, or a `facts.DATES` end. With no such evidence it stays open (rule 8,
  replaced Nov 22).
- **Who gets the credit when two are in charge (Nov 22):** a clear lead takes all of it and the other is a
  No. 2, written to `out/gm_under.json` ("under [lead]"), shown on his page and never counted. The lead is
  decided by a sourced reporting line or final-say statement (`facts.HIERARCHY`), else by a clearly higher
  sourced title (president > executive VP > senior VP > GM or VP of basketball operations). Equal credit
  only for real co-leads (a source names them as joint heads, or equal titles), undated handovers and
  same-day handovers. Where no title or line is sourced the segment is split equally and flagged.
- **One team at a time:** `checks1.py` fails if anyone (head or No. 2) holds jobs at two franchises on the
  same day; a same-day move (left one, joined the other on that dated day) is allowed.
- **Names:** same first name and a near-identical surname is one person (ESPN's "D'Allesandro"). A shared
  surname with a first name that starts the other's is flagged, never merged (Don, Donn and Donnie Nelson).
- **Credit** splits equally among the people in charge that day. `CREDIT_SPLITS` and `OWNER_FLAGS` take an
  entry only with a source; both are empty.
- **Confidence:** `clear` both ends dated to the day or pinned between games (or in office);
  `likely` an end known only to the off-season or assumed; `disputed` the sources conflict.

## Module 2: the asset ledger

| file | what |
|---|---|
| `br_more.py` | every draft page (1979 on) and the season totals the Mac's cache lacks |
| `ledger.py` | the ledger: Basketball-Reference's transaction HTML parsed into double-entry events (every team anchor says give or receive), drafts converting picks to players, an opening balance from the 1979-80 rosters, NBA.com trades Basketball-Reference lacks when ESPN confirms them, inferred lapses |
| `ledger_checks.py` | trades balance, NBA.com agreement, today's rosters against ESPN, past rosters against who played, pick chains, counts and gaps -> `out/ledger_report.txt` |
| `ledger_trees.py` | `python3 ledger_trees.py <asset> [depth] [team]`: what a team did with an asset, and what that became |

Rules worth knowing:
- **Draft day:** a pick traded on draft day goes before the selection; a trade Basketball-Reference dates within 75 days after the draft that moves a named pick to the team the draft page says selected with it is treated as agreed before the pick. Rights trades (the player, after he is picked) follow the draft.
- **Same-day order:** events on one date run in the order that makes each giver hold what it gives (a signing never waits for a waiver).
- **A gap is repaired and logged, never hidden:** when a giver does not hold an asset on our books, the ledger moves it and writes the gap (`out/ledger_gaps.json`).
- **Lapses are inferred** (`lapsed (inferred)`): a player's rights end at the close of his last season with a team when a whole later season passes with no games for it and no later move involving it. The Contract tab's expiry dates replace these.
- **Unsigned draft rights are kept** (a stash) and labeled; most are 1980s late-round picks who never signed.

## Module 3: the models

| file | what |
|---|---|
| `model_data.py` | every player-season with its Savant value (via tools/savant-value/value.py), on an 82-game footing too |
| `proj.py` | the projection model: P(in the league) x E[value | in the league], five seasons ahead; `eval` (out of sample, split by player), `fit` (one version per season, fit only on outcomes through it) |
| `picks.py` | the pick value curve: log-linear in slot, the latest five complete drafts (chosen by forward-chained tests); one version per season |
| `lottery.py` | where an unconveyed pick lands: measured team-strength regression, in-season blend (m = 20 games), each era's lottery rules, protections |
| `snapshots.py` | point-in-time projections for every ledger decision, with the model version and inputs |

Results: `out/proj_eval.txt`, `out/picks_eval.txt`, `out/lottery_eval.txt`. Model versions: `out/models/`.

## Module 4: grading every decision

`grade.py` grades every trade side, draft pick, signing (two-way, 10-day, Exhibit 10 named), re-signing,
extension, inferred departure, waiver, release, claim and coach hire, credited by `credit.py`'s weights on the
agreement date. Ten seasons, 5% a year (chosen; measurable once salaries exist). At the time: the snapshots as
of the agreement date, dropped where the snapshot was early-era. How it turned out: what each asset produced for
the team (its share of the player's minutes), then the share of whatever it was traded for, and so on, with
today's projection for what is still held. Coach hires: Coaching Savant's wins above roster talent (per 82,
weighted by games), 2002-03 on, at 31.7 points a win (measured from game margins). `python3 grade.py leakage`
recomputes 300 at-the-time trade grades with every later season deleted (0 mismatches). `report4.py` writes
`out/decisions_report.txt`. Pending the Contract tab: extensions, re-signings, let-walk decisions and
sign-and-trades (value kept or lost, not value over cost); control years.

## Module 5: the GM numbers

`gm5.py`: spells (a person credited at a team), GM Value Added = produced (team season value x his weight on each
game date) + left (holdings on his last day, projected then) - inherited (holdings on his first day), ten seasons at
0%, 5%, 10%; also "above an average GM" (the league's average team value that season taken off production).
Repeatability: grades taken against the league average for that decision type that season, each person's decisions
split by date, halves correlated (95% interval); shrinkage k = half size x (1 - r) / r; only repeating skills get
percentiles. `gm5_detail.py`: drafting (hit, bust, finds, passed on), trades (windows, buying/selling, partners), free
agency (stars/role), role players, development (shared with the coach), coach hiring, luck (lottery, games missed,
grade gap), style. Outputs: `out/gm_spells.json`, `out/gm_skills.json`, `out/gm_detail.json`, `out/gm_repeatability.txt`.
Re-signings (Module 5 fix): a signing by the team that held his rights just before (previous contract or draft rights).

## Module 6: review report

`repeat6.py` (repeatability four ways: date halves, odd/even, decisions that matter at 300+ points at stake or
weighted by stake, per spell; minimum detectable correlation at 80% power) -> `out/gm_repeatability.*`.
`report6.py` -> `out/review_report.txt`. Headline is GM Value Added above an average GM (`gm_value_added`, ranked
with two or more seasons); the spec formula is `gmva_original` (Data Room only); `gm_value_added_margin` takes
production from game margin (56 value points per margin point, measured) instead of player value.
Fixes in this module: inverted zero-game tenures (credit.repair_inverted), sourced hierarchy beats an undated
handover, unplayed first-rounders valued from their slot, left/inherited valued at the edges of full charge, the
pre-2017 unknown-protections flag on every future pick.

## Module 7: the page, the connector, the Data Room

`build_page.py` -> `public/gms/` (gzipped; vercel.json serves `/gms/*.json` from the `.gz`): `index.json` (every GM,
the headline boards, a board per skill, the executive tree, repeatability, page notes), `g/<gm>.json` (spell cards,
portfolio, inherited and left, the trees of the biggest moves, every decision with both grades, today's roster and
picks for active GMs), `data/<table>/<season>.json` + `data/dictionary.json` (the Data Room tables). The page is
`page/body.html` + `page/app.js` + `page/extra.css`; `page/assemble.py` copies Coaching Savant's styles and writes
`public/gm-savant.html`. Connector: `api/_gm.js` (five tools; 89,881 of the 90,000-character cap, so a sixth tool
has to trim something). Data Room: `gms` source in `api/_dataroom.js` and `pipeline/dataroom/catalog.py`.
Rebuild order: `./run_chain.sh` (writes `out/chain_status.txt`), then `python3 build_page.py`, `python3 page/assemble.py`,
`python3 ../../dataroom/catalog.py nba`.

## Module 8: self-updating

- `gm_update.py`: one pass. Refetches the season in progress (Basketball-Reference transactions, ESPN transactions,
  NBA.com player movement, the draft page on draft night, yesterday's ESPN scoreboard for game dates and margins);
  holds every new Basketball-Reference transaction until ESPN, NBA.com or a WCE news headline agrees (`ledger_hold.json`,
  `pending.json`; 48 hours unconfirmed is a warning, exit 2); opens front-office changes as tenures "pending
  confirmation" (`fo_pending.json`, read by credit.py) until a second source agrees; rebuilds with `GM_FREEZE=1`
  (at-the-time grades frozen in `out/frozen_at_time.json` with their model versions); writes `data/gm-refresh.json`.
- Cloud first: `.github/workflows/gm-savant-cloud.yml` (after every Basketball Savant refresh, daily, every 2 hours in
  the draft / free-agency and deadline windows, every 20 minutes on draft nights) runs `gm_cloud_run.sh`, which carries
  the state as `gm-state.tar.gz` on the `gm-state` pre-release and commits the page files to main. The Mac lane
  (`mac_pull.sh`, `launchd/com.wcehoops.gm-pull.plist`, not installed) sends only the pages the cloud is refused.
  First run: `./mac_pull.sh --seed`.
- `gm-savant-freshness.yml` + `tools/savant-mcp/freshness.mjs --only gm`: the alarm. Control Room jobs: gm-savant,
  gm-savant-freshness, gm-savant-refit, gm-mac-pull.
- `gm_refit.py` + `gm-savant-refit.yml`: yearly after the Finals; a refit more than 1% worse does not ship.
- New season (thresholds table, market price): waits for the Contract tab's salary tables.
- `gm_replay.py A B`: the proof, a week replayed day by day in a sandbox and compared with the real build
  (`out/replay_report.txt`). The ledger can be built as of a day with `GM_ASOF`.
