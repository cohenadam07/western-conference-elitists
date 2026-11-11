# College Football Savant: research and backtest plan

*Nov 10, 2026. Nothing is built and no numbers have been computed yet. This doc covers what should be on the page, where the data comes from, what the backtest has to prove before anything ships, and how the two headline features (All-Savant teams and the objective playoff field) work. The first Claude Code prompt, which runs the data pull and the backtest, is the companion doc `claude/college-football-savant-backtest-prompt.md`.*

---

## 0. Adam's decisions (Nov 10)

1. **FBS only.** 138 teams in 2026 ([SP+ 2026](https://abc7chicago.com/post/2026-college-football-sp-rankings-138-fbs-teams/19826490/)).
2. **The playoff ranking seeds by résumé** (a strength-of-record score) and shows our power rating beside it. **Ours only:** no committee rankings on the page.
3. **The playoff section shows both** an "if the season ended today" bracket on top and simulated playoff odds for every team.
4. **All-Savant:** national 1st, 2nd and 3rd teams; one team per conference; a Freshman team; a Savant Heisman. **Offensive line picked as a unit.** Defenders graded on opponent-adjusted disruption. Pure individual value, no credit for team success (the College Basketball Savant rule).
5. **Free data only.** No paid tier of anything.
6. **Theme: Sticker Bomb**, inspired by the CFB Kick Off 2026 graphic: dark navy field, sticker-cut cards, electric-blue banner bars, heavy condensed caps. Real school logos appear only beside team names. The sticker texture is built from our own shapes and team-color chips, never a collage of logos.
7. **One full launch**, not a staged one.
8. **Recruiting and portal on player cards:** yes ("4★ recruit · transferred from X in 2025"), plus a team talent column.
9. **Store coach data from day one** for a future College Football Coaching Savant.
10. **Standing WCE defaults apply:** opponent-adjusted and position-adjusted percentiles with the pool named; schedule strength on every card; as much history as the play-by-play supports; self-refreshing; headshots; version number; `cfb_` connector tools (Adam approves connector changes before merge); a spot in the Football dropdown of the site ribbon; its own theme, shared later by any other college football page.

---

## 1. The short version

- **ESPN is the primary feed again**, as it is for College Basketball Savant. Its core play feed attaches athlete ids to each play by role: passer, rusher, tackler and so on ([cfbfastR on ESPN core plays](https://rdrr.io/cran/cfbfastR/man/espn_cfb_pbp_v2.html)). That is what makes player-level EPA and defender credit possible without a paid source.
- **History is free and keyless.** The sportsdataverse release files carry ESPN-derived play-by-play with EPA, WPA and participant ids back to **2004**, plus a cleaner FBS-only file from 2014 ([cfbfastR loaders](https://ftp.fau.de/cran/web/packages/cfbfastR/news/news.html)). The backtest runs on these files with zero API calls.
- **CollegeFootballData (CFBD) is a supporting source, not the backbone.** Its free tier is 1,000 calls a month ([review](https://sportsapis.dev/apis/collegefootballdata)), and that quota is **shared with College Basketball Savant, which already budgets up to 600 of it**. College Football Savant gets **at most 300 calls a month**, spent on recruiting, the portal, team talent, coaches and conference history.
- **The big honest limit:** no free source grades offensive linemen, tracks snaps, or charts coverage. That is why the OL is picked as a unit and defenders are graded on what the play-by-play credits them with.
- **WCE computes every Savant number itself:** its own expected-points model, opponent adjustment, power rating, résumé score and Savant value. Outside numbers (CFBD's PPA and WEPA, ESPN's FPI, cfbfastR's EPA) are used only to validate ours, never displayed or served.

---

## 2. Data sources

| Source | Cost / access | What it gives | History | Role |
|---|---|---|---|---|
| **ESPN site + core API** | Free, no key, undocumented | Scoreboard (FBS group), game summaries, box scores, core play-by-play with participant ids by role, drives, rosters with season-scoped athlete records, standings, DraftKings lines in game summaries, headshots | Live | **Primary.** Same automated-access risk Adam already accepted for Basketball and College Basketball Savant |
| **sportsdataverse-data releases** | Free GitHub release files, no key | ESPN-derived play-by-play (469 columns incl. EPA/WPA and participant ids), play participants, player and team box scores, drives, game rosters, betting lines, linescores, FPI | pbp 2004+; classic FBS EPA file 2014+ | **History and the backtest.** Release tags were dated June 4, so they look like an off-season build; in-season freshness is unverified, so the current season comes from ESPN directly |
| **CollegeFootballData** | Free key, 1,000 calls/month **shared with CBBD** | Recruiting, transfer portal, team talent, coaches (1886+), conference history, rosters (2004+), lines, advanced team stats (2001+), havoc (2004+), player usage (2013+), enriched passing/rushing (2025+) ([data availability](https://api.collegefootballdata.com/data-availability.md)) | Varies | **Secondary.** Inputs only. Its terms forbid a mirror or substitute API, so its rows never reach the page or connector raw |
| **CFBD PPA / WEPA** | Same key | CFBD's EPA (PPA) and opponent-adjusted EPA (WEPA). Both proprietary, with fitted tables not published ([PPA](https://apinext.collegefootballdata.com/ppa), [WEPA](https://api.collegefootballdata.com/wepa)) | 2001+ | **Validation only.** Our EP model should correlate strongly with PPA; we never show PPA |
| **ESPN FPI / SP+** | Free to view | Power ratings | — | **Validation only** for our power rating |
| stats.ncaa.org | — | Official box and play-by-play | — | **No.** Returned 403 from the cloud and Adam's home network in the Nov 2 CBB tests |
| Sports-Reference, PFF, KenPom-style paid tools | — | — | — | **No** (terms or paywall) |

**The CFBD key.** College Basketball Savant's key lives in `~/.config/wce/cbbd.key`, and its build prompt notes the free quota is shared with CollegeFootballData, so it is very likely one account and one key. Confirm with a single call to `api.collegefootballdata.com` and read the `X-CallLimit-Remaining` header before anything else uses it.

**Headshots and logos.** ESPN serves college football headshots at `a.espncdn.com/i/headshots/college-football/players/full/{athleteId}.png`, the same pattern ESPN's own roster pages use ([ESPN Army roster](https://africa.espn.com/college-football/team/roster/_/id/349)). Coverage is unmeasured; check each URL once at build time and fall back to the initials badge in team colors, as on College Basketball Savant. Team logos come from ESPN's team logo path beside team names only (decision 6).

---

## 3. What belongs on the page

### Player card (mirrors College Basketball Savant)

1. **Header:** name, team, conference, class, position, height and weight, hometown, **recruiting stars and rank**, **school history with transfers marked**, headshot, and an NFL link to Football Savant when the player reaches the NFL (match on name + school + draft year through CFBD draft picks and Football Savant's ids).
2. **Controls:** pool (FBS at his position by default; Power 4 only; same conference); adjusted or raw; garbage time on or off; season.
3. **Percentile bars**, thick and colored blue → red, with the stat's value at the end of the row; hatched below the settle point with a diamond where it is likely to settle; a thin tick where he would sit before opponent adjustment (the College Basketball Savant signature). Groups depend on position:
   - **QB:** EPA per dropback, success rate, sack rate, interception rate, scramble and designed-run value, yards per attempt, explosive pass rate, passing-down vs standard-down EPA. Completion % over expected only from 2025, when CFBD's enriched passing adds pass detail ([data availability](https://api.collegefootballdata.com/data-availability.md)); before that it shows "not tracked".
   - **RB:** EPA per rush, success rate, explosive run rate, stuff rate (runs stopped at or behind the line), receiving value, share of team rushes.
   - **WR/TE:** EPA per target, catch rate, target share, explosive catch rate, yards per team pass attempt (the college stand-in for yards per route run, since routes aren't tracked).
   - **Defenders:** disruption value (§6), sacks, tackles for loss, run stops, QB hurries, passes defensed, interceptions, forced fumbles, all per team defensive play.
   - **Specialists:** field goals over expected by distance; net punting value.
   - **CONTEXT rows:** usage share, schedule strength faced, garbage-time share.
4. **Splits:** home / road / neutral, conference vs non-conference, vs our top 25, by month.
5. **Game log, career across schools, comps, and an explainer for every stat.**

### Team page and table

- Our power rating (offense, defense, special teams), our résumé score, schedule strength and record, five factors (efficiency, explosiveness, field position, finishing drives, turnovers), havoc, pace, turnover luck flagged as luck, team talent (CFBD composite), returning production.
- Roster strip with headshots, and a depth chart by position from usage.
- Head coach stored as data now (decision 9); shown as a plain line.

### The playoff page (§7)

### All-Savant (§6)

### Leaderboards, front page, search

The same pattern as College Basketball Savant.

---

## 4. The stability backtest: what it has to prove

Adam asked for backtesting the stability of stats before anything ships. The rule is the one WCE already uses: **a stat only gets a full percentile bar if it measures something real about the player or team, not noise.** The backtest measures that directly, on 2014–2025 FBS seasons from the release files, with 2004–2013 as an extension once data completeness is confirmed.

### Four tests for every stat

1. **Split-half reliability.** Split each team's or player's games into odd and even halves, correlate the halves across all players, and step the result up to a full season with the Spearman-Brown formula. Repeat 200 times with random splits and report the mean and spread.
2. **Settle point.** The sample size (plays, dropbacks, targets, rushes, team defensive plays) at which the player's own number and the FBS prior carry equal weight. This is the same method `settle_points.py` uses on the NBA side. Below it, bars are hatched.
3. **Year-to-year correlation** for players who stay at the same school and for transfers separately. Transfers are the cleanest natural test of opponent adjustment.
4. **Predictive value.** Does a team stat measured through week N predict margin in the remaining games better than the raw scoring margin through week N? For players, does the first half of the season predict the second?

### What the existing research predicts, to be confirmed or refuted

- **Success rate should be the most stable efficiency measure; explosiveness and turnovers much less so.** In Connelly's own split, 2015's top-10 offenses lost about 14% of their explosiveness (IsoPPP) from the first seven games to the last seven, but only about 2.8% of their success rate ([summary of Connelly](https://mgoblog.com/comment/4574706)). A Football Study Hall test found success rate and explosiveness were steadier game to game than field position, finishing drives and turnovers ([Football Study Hall](https://www.footballstudyhall.com/2015/7/30/9074771/8887897777)).
- **Sample sizes are small.** Connelly's split-half test on conference games noted most teams play only eight conference games, so one strange game blurs a bucket ([Connelly](https://cur.at/hGIdcJ2?m=web)). Expect wide intervals for teams and very wide ones for most players.
- **Turnover margin and fumble recoveries should behave like luck.** If the backtest confirms that, they are shown as CONTEXT labeled "luck", never as a quality percentile.

### Stats to test

- **Team (offense and defense, pass and rush where relevant):** EPA per play, success rate, explosiveness, explosive play rate, havoc rate, stuff rate, line yards, points per trip inside the 40, starting field position, turnover margin, fumble recovery rate, interceptions per pass defensed, third-down rate, red-zone touchdown rate, sack rate, penalty rate, special-teams EPA.
- **Players:** every stat named in §3, by position.
- **Ratings:** our power rating against closing spreads and FPI (§7); our Savant value by position (§6).

### What the backtest decides

| Result | What the page does |
|---|---|
| Reliable within a season (split-half ≥ 0.5 at a typical starter's sample) | Full percentile bar |
| Reliable only late in the season | Bar, hatched below its settle point |
| Unreliable at any realistic sample | CONTEXT row or dropped |
| Behaves like luck | CONTEXT row labeled "luck" |

The backtest writes its results to `research/cfb/BACKTEST.md` in the repo, and the card design waits for it.

---

## 5. How plays are valued: WCE's own expected-points model

- **Why our own:** CFBD's PPA is proprietary and unpublished ([PPA](https://apinext.collegefootballdata.com/ppa)), and the release files' EPA comes from cfbfastR's model. Numbers WCE computes itself are WCE's to show and serve through the connector, the same principle College Basketball Savant follows.
- **The model:** an expected-points model in the open nflfastR style, fit on 2014–2024 FBS plays. Inputs: down, distance, yard line, time left in the half, score margin, and home/away. Outcome: the next score in the half. A win-probability model fits the same way and drives garbage time and the playoff simulation.
- **Checks:** calibrated by decile on held-out 2025 plays; correlation with cfbfastR's EPA and CFBD's PPA reported (expect high, not identical).
- **The scoring environment shifted.** A user analysis of CFBD data found average PPA per play rose from about 0.04 (2004–2013) to about 0.14 (2014–2024) ([r/CFBAnalysis](https://reddit.birdcat.cafe/r/CFBAnalysis/rising)). Whether that is real or a data artifact is unknown, so percentiles are computed **within each season only** and never pooled across eras.
- **Garbage time:** excluded from percentiles by default, using the Connelly-style margin-by-quarter rule CFBD applies (confirm its exact thresholds on first run); the WP model is the cross-check.

---

## 6. All-Savant teams

### The shape: the AP All-America team

The 2025 AP team had **27 players on its first team** ([AP via News4Jax](https://www.news4jax.com/sports/2025/12/15/big-ten-puts-10-on-ap-all-america-first-team-led-by-4-from-ohio-state-and-hoosier-star-mendoza/)), in this shape ([On3 list](https://www.on3.com/news/ap-reveals-first-team-second-team-third-team-all-americans-for-2025)):

- **Offense:** QB, 2 RB, 3 WR, TE, 2 OT, 2 OG, C, K, all-purpose.
- **Defense:** 2 edge, 2 DL, 3 LB, 2 CB, 2 S, an extra DB, P.

**Our version:** the same shape, except the five OL spots become one **offensive line unit** (decision 4). That gives 23 players and one line per team, for each of the 1st, 2nd and 3rd teams.

### Savant value: one number per player

The same idea as Football Savant: **expected points above a replacement-level player at his position**, opponent-adjusted, counted on the plays he was credited with. The replacement level is set per position, for example the 80th-best FBS QB by playing time.

- **QB, RB, WR, TE:** EPA on his credited plays, adjusted for the opponent's defense, minus replacement. **Usage counts:** missed games and small roles cost value, matching the "missed games count against a player" rule on the NBA All-Savant team.
- **Defenders: disruption value.** The play-by-play names defenders on sacks, tackles for loss, interceptions, passes defensed, forced fumbles and run stops. A defender's value is his share of the EPA the offense lost on plays he disrupted, opponent-adjusted for the offense he faced. This is honest about what free data can see: it credits playmakers, not a cornerback who was never targeted. Every defender card says so.
- **Edge vs interior DL and the extra DB:** ESPN roster positions are loose ("DL", "DB"). Bucket by roster position plus stat profile (sack share vs run-stop share; slot vs boundary usage where visible), with a borderline list for review, as College Basketball Savant did for guards, wings and bigs.
- **Offensive line unit:** opponent-adjusted team rushing success and stuff rate avoided, sack rate allowed and pressure proxies (sacks plus hurries), scaled to points. Football Savant picks its pre-2016 lines the same way.
- **Kicker and punter:** field goals over expected by distance; punt value against expected.
- **All-purpose:** the best non-QB by combined rushing, receiving and return value.

**Backtest check:** Savant value must be stable year to year at each position (it is pure individual value, so it can't lean on team success). For 2014–2025 we also report how many AP first-teamers each Savant team overlaps with, as a sanity check, not a target. The basketball version found the AP favors stars on top teams, and Adam chose pure individual value anyway.

### The sets

- **National 1st, 2nd and 3rd teams.**
- **Conference teams:** one per FBS conference, conference membership by season from CFBD (realignment keeps moving teams). Independents are eligible nationally only.
- **Freshman team:** players listed as freshmen, including redshirt freshmen, as the FWAA Freshman All-America team does. Confirm how ESPN marks redshirts.
- **Savant Heisman:** the single highest Savant value. Expect it to lean QB, like the real Heisman; the explainer says so.
- **Accolades on the card:** a player who finishes a season on an All-Savant team carries it on his page, the same rule as Basketball Savant.
- **In-season label:** before the final week the teams are a standing ("as of week N"), as Football Savant does.

---

## 7. The objective playoff field

### The 2026 rules, from the CFP's own page

- **Automatic bids:** the ACC, Big Ten, Big 12 and SEC champions, plus the **highest-ranked team** from the American, Conference USA, MAC, Mountain West, Pac-12 or Sun Belt ([CFP format](https://collegefootballplayoff.com/sports/2024/5/29/12-team-format.aspx)).
- **Notre Dame** gets a bid if it ranks in the top 12, leaving six at-large bids. Otherwise seven at-large bids go to the best remaining teams.
- **Seeding is straight by ranking.** Seeds 1–4 get byes; 5–12 play on the higher seed's campus. Any automatic qualifier ranked outside the top 12 is placed in order at the bottom. No re-seeding and no rematch avoidance.
- **One conflict, resolved in favor of the official page.** FootballScoop reported that the Group of Six bid goes to the highest-ranked G5 **champion** ([FootballScoop](https://www.footballscoop.com/2026/08/06/college-football-playoff-announces-format-change-power-4-notre-dame)). The CFP's own page says only "highest-ranked team" from those conferences, and The Athletic's reporting (via SI) says it need not be a champion ([SI](https://www.si.com/college/boise-state/football/college-football-playoff-changes-format-for-group-of-six-representation)). The build follows the CFP page and keeps the rule as a config switch.

### The two numbers

**1. Résumé score (seeds the field).** Our version of strength of record. ESPN's metric is the chance that an average top-25 team would have a team's record or better against its schedule ([ESPN](https://africa.espn.com/college-football/story/_/id/11907851/alabama-crimson-tide-rank-first-strength-record-college-football)), and the committee added a "record strength" metric to its analysis in 2025 ([NBC Sports](https://www.nbcsports.com/college-football/news/the-college-football-playoff-tweaked-its-strength-of-schedule-metric-will-that-help)). Ours asks the playoff question directly:

- **Benchmark: a bubble team,** meaning the 12th-best team by our power rating. The question it answers: "How likely is it that the team right on the playoff line would have done at least this well against this schedule?" Lower probability means a stronger résumé. (ESPN uses an average top-25 team; SP+ uses a top-five team. The bubble team fits "who should make the playoff" best.)
- **Math:** for each game, the bubble team's win probability against that opponent at that site, from our power rating. The chance of matching or beating the actual win count comes from the exact sum over games (a Poisson-binomial distribution).
- **Wins and losses only.** Margin never enters the résumé score, only the opponent strengths behind it. That is what makes it "deserving" rather than "best".
- **Ties in the résumé score** break on the power rating.

**2. Power rating (shown beside it).** Our predictive team strength in points per game against an average FBS team:

- opponent-adjusted offense and defense EPA per play, from a ridge regression on every FBS game, scaled to points with pace;
- special teams;
- a preseason prior from last season, returning production and team talent, fading as games accumulate;
- recency weighting and home field tuned by the backtest.

**Backtest:** predicted margins on held-out games, 2014–2025, scored against the closing spread (from the release files' betting table) and ESPN FPI by mean absolute error. It must land within 0.5 points of FPI's error or beat it, the same bar College Basketball Savant's team ratings had to clear.

### "If the season ended today"

1. Rank every FBS team by résumé score.
2. **Conference champions before title games are played:** the team leading each conference by conference record, with the conference's published tiebreakers. Implementing four Power 4 tiebreaker rulebooks exactly is the hardest small problem in this build, so start from ESPN's standings order (which applies tiebreakers in its display; confirm on first run) and flag any team whose spot depends on a tiebreaker.
3. Apply the 2026 rules in §7.1 to produce the 12, seeds, byes and first-round matchups.

### Playoff odds

- Simulate the remaining regular season, conference title games and the selection rules **20,000 times**, with game outcomes drawn from the power rating plus its uncertainty. Title-game participants come from each simulated standings table.
- At the end of each simulated season, rank by résumé score and apply the 2026 rules.
- Show each team's chance of: making the field, earning a bye, winning its conference, and hosting a first-round game.
- **Backtest:** run the simulator from each week of 2014–2025 and check calibration (teams given 30% should make the retroactive field about 30% of the time).

### Retroactive fields

Applying 2026 rules to 2014–2025 with our résumé score gives every past season an objective field. Whether these go on the page as history is open decision 3. The committee's actual picks stay off the page (decision 2) but are listed in the backtest report so Adam can see where "objective" diverged.

---

## 8. Refresh

- **GitHub Actions, like Football Savant.** Nothing in college football needs the home network; ESPN and CFBD both answer from the cloud.
- **Schedule (UTC):** a daily run at about 10:00 from late August to the title game; an extra Sunday run at about 08:00 after West Coast Saturday games. The daily run also picks up the Tuesday–Friday weeknight games.
- **Each run:** ESPN scoreboard → summaries and core plays for each final → rebuild the current season → recompute ratings, résumé, simulation and All-Savant standings → commit only if the data changed.
- **ESPN volume:** about 60–70 FBS games on a big Saturday, a few calls each, so a few hundred calls. No quota.
- **CFBD budget: at most 300 calls a month** (the other 700 belong to College Basketball Savant's 600 plus headroom). Weekly portal and roster updates plus a one-time recruiting backfill fit comfortably. Every call is counted and logged.
- **Fallback ladder (same idea as College Basketball Savant):** archive every raw ESPN response; ESPN from Adam's Mac if the cloud is blocked; the release files and CFBD as last resorts for history.

---

## 9. Theme: Sticker Bomb

From the CFB Kick Off 2026 graphic Adam shared:

- **Field:** deep navy (close to WCE navy), with a faint diagonal repeat of the product name, like the edge text on the graphic.
- **Headline bars:** an electric-blue banner with heavy condensed all-caps type and a thin white keyline, the graphic's "CFB KICK OFF 2026" bar.
- **Sticker cards:** player, team and All-Savant cards sit on white die-cut "stickers" with a slight random rotation, a white border, a hard drop shadow and a subtle paper texture. Rotation is turned off for data tables and honors reduced motion.
- **Team-color chips** do the sticker-collage work in the background: abstract shapes in each conference's team colors, never logos (decision 6).
- **Logos** appear only beside team names, small.
- **Data stays Savant.** Percentile bars use the standard blue → red scale on white surfaces. The house style's data rules (pools named, hatching, "not tracked" kept apart from zero) are unchanged. The gold underline rule appears in section titles to tie it to WCE.
- **Type:** a heavy condensed display face for headlines (to choose in the mockups), with IBM Plex Sans and Mono kept for body and numbers.

Mockups come next, before the build.

---

## 10. Risks and unknowns

- **ESPN's terms** forbid automated access, the same standing risk as the other ESPN-fed products.
- **No snap counts.** Every player rate uses team plays or games as the denominator. A part-time player's rates are approximate, and the explainers say so.
- **Defender credit is only as good as ESPN's play text.** Coverage of tacklers, hurries and passes defensed by season is unmeasured; the backtest measures it first.
- **The release files' in-season freshness** is unverified, so the live season always comes from ESPN directly.
- **CFBD quota pressure.** If College Basketball Savant ever needs more than 600 calls, college football's 300 shrinks.
- **Positions:** edge vs interior DL and slot vs boundary DB are inferred.
- **Conference tiebreakers** before title games are approximate until each rulebook is implemented.
- **Name check:** no search for an existing "College Football Savant" product or trademark has been run.

---

## 11. Open decisions for Adam

1. **History at launch:** 2014–2026 at launch, with 2004–2013 backfilled behind the same gates? (Recommended. The 2014+ file is the cleaner one.)
2. **Résumé benchmark:** the bubble team (12th-best), as recommended, or ESPN's average top-25 team?
3. **Retroactive fields 2014–2025** on the page as history: yes or no?
4. **Display font** for the Sticker Bomb headlines: chosen from the mockups.

---

## Sources

- [CFP: About the 12-team format](https://collegefootballplayoff.com/sports/2024/5/29/12-team-format.aspx); [FootballScoop on the 2026 changes](https://www.footballscoop.com/2026/08/06/college-football-playoff-announces-format-change-power-4-notre-dame); [SI on the Group of Six bid](https://www.si.com/college/boise-state/football/college-football-playoff-changes-format-for-group-of-six-representation)
- [CFBD data availability](https://api.collegefootballdata.com/data-availability.md); [CFBD PPA](https://apinext.collegefootballdata.com/ppa); [CFBD WEPA](https://api.collegefootballdata.com/wepa); [CFBD tiers review](https://sportsapis.dev/apis/collegefootballdata)
- [cfbfastR news (release loaders)](https://ftp.fau.de/cran/web/packages/cfbfastR/news/news.html); [espn_cfb_pbp_v2](https://rdrr.io/cran/cfbfastR/man/espn_cfb_pbp_v2.html); [sportsdataverse-data releases](https://github.com/sportsdataverse/sportsdataverse-data/releases)
- [AP 2025 All-America (News4Jax)](https://www.news4jax.com/sports/2025/12/15/big-ten-puts-10-on-ap-all-america-first-team-led-by-4-from-ohio-state-and-hoosier-star-mendoza/); [On3 full list](https://www.on3.com/news/ap-reveals-first-team-second-team-third-team-all-americans-for-2025)
- [ESPN on strength of record](https://africa.espn.com/college-football/story/_/id/11907851/alabama-crimson-tide-rank-first-strength-record-college-football); [NBC Sports on record strength](https://www.nbcsports.com/college-football/news/the-college-football-playoff-tweaked-its-strength-of-schedule-metric-will-that-help); [SP+ 2026](https://abc7chicago.com/post/2026-college-football-sp-rankings-138-fbs-teams/19826490/)
- [Football Study Hall: five factors as predictors](https://www.footballstudyhall.com/2015/7/30/9074771/8887897777); [Connelly on split-half tests](https://cur.at/hGIdcJ2?m=web); [IsoPPP vs success rate drift](https://mgoblog.com/comment/4574706)
- Project docs: `claude/college-basketball-savant-research.md`, `claude/college-basketball-savant-build-prompt.md`, `claude/football-savant-refresh.md`
