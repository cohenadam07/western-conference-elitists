# GM Savant — Module 8 report (Nov 23, 2026)

Branch `gm-savant`, last commit `8cc5ffa`. Not merged and not deployed. Nothing is scheduled to run until you approve the merge.

## 1. Memory: what was crashing the Mac, and the fix

The Mac has 8 GB. Five steps each peaked at 1.1–1.3 GB on their own. The replay ran two of those builds at once (the day-by-day sandbox and its reference) next to everything else that was open. That is what got killed, and most likely what crashed the laptop before.

Peak memory and time for each step, measured alone, before and after:

| step | before | after |
|---|---|---|
| grade | 1,131 MB, 182 s | 565 MB, 42 s |
| gm5 | 1,120 MB, 55 s | 580 MB, 18 s |
| gm5_detail | 1,182 MB, 240 s | 594 MB, 45 s |
| repeat6 | 1,118 MB, 489 s | 598 MB, 37 s |
| build_page | 1,291 MB, 373 s | 689 MB, 42 s |
| model_data (nightly) | 1,008 MB | 187 MB (current season only) |
| ledger / credit / catalog | 167 / 45 / 302 MB | 149 / 47 / 318 MB |
| **whole chain** | **~23 min** | **~3.5 min** |

What changed:

1. **The player-game tables now load by season**, one season at a time, holding only the columns that are used (656 MB → 227 MB for all 31 seasons). A grade.py bug also reloaded them all on many calls.
2. **The nightly value update recomputes only the season in progress.** Past seasons are reused while their inputs are unchanged.
3. **Two dead weights are gone:** sklearn was loaded but only needed for the yearly refit (152 MB), and a 126 MB snapshot file was loaded and never read.
4. **The speedups came from one bug.** A date check scanned every game, 60,000 times a run (11 minutes).
5. **The replay now runs its builds one after the other**, never two at once.

Proof that nothing moved: I rebuilt with the old code in a sandbox and compared checksums of all 406 output files, ignored files included. 268 are byte-identical. The other 138 differ only in two fields I changed on purpose:

- **Best and worst trade partner** are now rounded, with ties broken by name. They used to flip between runs.
- **`risk_sd_at_time` no longer writes `NaN`.** `NaN` isn't valid JSON, so 27 GMs' pages couldn't be opened in a browser. The page writer now refuses to write it.

## 2. The rebuild and the replay, run alone

- **Full rebuild:** clean. The largest step was 699 MB.
- **Replay setup:** the 2026 deadline week (Feb 1–7), fed in day by day, each night incremental. It was compared with one full build as of Feb 7, which ran first and alone. The largest step was 722 MB.
- **It matches the single build exactly:**
  - Ledger: 39,238 of 39,238 events.
  - Decisions: 30,505 of 30,505, with identical at-the-time and as-it-turned-out grades.
  - The 30 active GMs whose teams traded that week have identical decision logs.
- **No information from after Feb 7:** zero decisions are dated after Feb 7.
- **Every output file:**
  - 197 of 402 files are byte-identical.
  - The other 205 differ only in `frozen_on`, the day each grade was frozen. That is by design: the replay froze each grade on the day the decision appeared, while the reference froze everything on Feb 7.
- **The second-source gate worked:** the Feb 4 Koprivica trade and the Hayes suspension stayed held all week. On Feb 7 the run exited with the 48-hour warning that lights the Control Room.

The replay also found three ways an at-the-time grade could see the future. All are fixed:

1. **Season length.** The pick model simulated a season using however many games the data held (about 50 on Feb 1, about 53 on Feb 7, about 15 for 2026-27 today), not the scheduled length.
2. **Pick notes.** A pick's notes and original owner piled up from later trades: a February 2026 "was HOU own" note reached the 2019 Westbrook trade. Notes now carry the date they were first stated.
3. **Undated sources.** An as-of build saw 16 press-sourced trades from Aug–Nov 2026 and 6 coach hires. Both are now cut at the day.

Bugs fixed along the way:

- **Grading order.** A cache kept a cut-short value when an asset came back the same day, so 18 trades and signings were graded on the cut value. Results now don't depend on grading order. The largest change is 1.3%.
- **Duplicates.** 11 decisions were listed twice; Ginóbili's 2013 re-signing counted twice for San Antonio, for example. Each now counts once.

## 3. The nightly update: GitHub Actions, only what changed

It runs in `gm-savant-cloud.yml`: after each Basketball Savant refresh, once a day, and every two hours around the deadline, the draft and free agency. Each night does only what changed:

1. **Nothing new since the last clean run that day:** nothing is rebuilt.
2. **Tonight's values:**
   - Savant value for the season in progress (`model_data.py --current`), plus that season's luck-adjusted margins.
   - This nightly re-mark was missing from the Module 8 build until now.
3. **Ledger and credit** run only when a transaction, hold or front-office change is new.
4. **Grades:**
   - Frozen at-the-time grades are never recomputed.
   - An as-it-turned-out grade that touches nothing live is carried over. Live means an asset still held, or any season from the current one on.
   - On a quiet night that is 12,716 of 16,936 carried over and 4,220 recomputed.
   - If history itself changes, nothing is carried over. That happened on 5 of the 7 replay nights, because new signings revise last summer's inferred departures. Those nights were correct, just not faster.
5. **GM numbers and page:** only page files whose content changed get committed.
6. **Mondays:** a full rebuild plus the repeatability test, so anything an incremental night missed is caught within a week.

Tested: a full night, a first incremental night and a carried-over night give identical decisions, and the replay above ran incrementally. The cloud night runs in about 2–3 minutes.

**Inputs that live only on the Mac, and how the cloud gets them:**

1. **The fetch cache** (`~/Basketball-Savant/cache_gm`, 206 MB, 1,883 pages) holds 47 seasons of Basketball-Reference transactions, draft and league pages, Wikipedia, ESPN, NBA.com, and the Data Room's player-game tables. It goes to the cloud once in the state bundle (`gm-state.tar.gz` on the `gm-state` pre-release), seeded by `mac_pull.sh --seed`. After that, the cloud uploads a new bundle after every clean run.
2. **Season totals pages for 1980–2023** (44 pages) exist only in Basketball Savant's own cache (`cache_br`). The seed now copies them into the GM cache, so the cloud never needs `cache_br`.
3. **Game dates before this season** came from stats.nba.com on the Mac (`games.py`). They're in `out/` and travel in the state bundle. The current season comes nightly from ESPN's scoreboard, which the cloud can reach.
4. **Pages the cloud is refused**, Basketball-Reference (it blocks runners) and NBA.com player movement, come from the Mac lane each night. These are this season's transactions, player totals and league page, plus the NBA.com feed. `mac_pull.sh` (launchd) uploads them as `gm-mac.tar.gz`, and the cloud merges them, newer copy winning.
5. **What the cloud gets on its own:**
   - ESPN transactions and scoreboard.
   - The season's player-game table, from the Data Room release.
   - Savant values, Coaching Savant's files and news, from the main checkout.

Two code paths pointed at Mac folders and are fixed: the player-game tables and the season totals pages.

## 4. Presti: the −6,881 was a bug, now fixed

Charging rights and conveyed picks at full careers counted every drafted player twice, once in the trade and again in drafting. A pick that conveys is now worth its slot's expectation in the trade, and the drafting grade (career minus slot) goes to the team that chose. His trades now total **−344 as they turned out and +491 at the time**, ranked 93rd of 161. His GM Value Added is +6,921 (it was +6,858; pick values moved a little with the fixes).

1. **(a) Do seasons sum to zero?** Yes. Summed over every team's side, no season's trades total more than 169 points as they turned out, or 0.3 at the time. Only 2 of 1,966 trades don't net to zero, both three-team trades where one side's asset leaves the books. So there's no positive average being charged 110 times.
2. **(b) Do drafted players flow back?** Yes. His trades brought in 54 picks that became players:
   - **29 he used himself.** Each is credited to the trade at exactly the slot's expectation (29 of 29 check out), so trade plus draft equals the career, counted once. Examples: Ibaka 175, Jalen Williams 185, Steven Adams 299.
   - **25 he traded on before the draft.** The trade gets whatever each pick turned into.
   - **2 are a ledger gap.** Dillon Jones and Otega Oweh leave the books through a repair, meaning the trade that moved them out is missing, so they count 0. That's open.
3. **(c) How are unconveyed picks valued?** With the pick model as of today: the original owner's slot odds from a simulation of the seasons left, times the slot curve, minus known protection. He holds 19 and has given 12, a net of +32. The largest are Houston's 2027 second (131), San Antonio's 2027 first (90) and Denver's 2027 first (48).
4. **(d) Houston, trade by trade:** 7 trades, −2,240 as they turned out. The Harden trade is **−2,599** (−685 at the time). The Westbrook trade is **+669** (−47 at the time).

His ten biggest trades (as they turned out, then at the time):

1. **2019 Paul George to the Clippers** for Gilgeous-Alexander, Gallinari, Tre Mann, Jalen Williams and more: +2,708 / +366
2. **2012 Harden to Houston:** −2,599 / −685
3. **2016 Ibaka to Orlando** for Oladipo, Sabonis and İlyasova: +2,287 / +734
4. **2017 Oladipo and Sabonis to Indiana for Paul George:** +1,157 / +454
5. **2019 Westbrook to Houston** for Paul and picks: +669 / −47
6. **2007 Kurt Thomas trade** (Ibaka's 2008 first, Pondexter's 2010 first): +453 / +530
7. **2020 Steven Adams to New Orleans:** +438 / +201
8. **2020 Chris Paul to Phoenix:** −436 / +642
9. **2009 Chucky Atkins trade** (Taj Gibson's first): +425 / +454
10. **2008 Szczerbiak and West to Cleveland:** −418 / −540

All-time trade leaders (10+ trades, as they turned out):

- **Top:** Carl Scheer (DEN 1979) +6,132, Carroll Dawson (HOU 1996) +5,498, Koby Altman (CLE 2017) +5,032, Daryl Morey (HOU 2007) +4,659, Bob Whitsitt (OKC 1986) +4,636.
- **Bottom:** Bryan Colangelo (PHO 1994) −5,080, Dell Demps (NOP 2010) −4,627, Jerry Krause (CHI 1985) −4,265, Glen Grunwald (TOR 1997) −3,230, David Griffin (NOP 2019) −3,220.

`python3 audit_trades.py "<name>" <partner>` runs the same checks for any GM. Module 9's spot-check of ten GMs can use it.

## 5. Not done, or waiting on you

1. **Nothing runs until merge.** The three workflows only start once this is on main, and I haven't uploaded anything to the `gm-state` release.
2. **The first cloud run needs `mac_pull.sh --seed`.** It uploads the cache and state to the release. That's an outward-facing step, so it waits for your go.
3. **The Mac lane's launchd job isn't installed**, so the nightly Basketball-Reference and NBA.com pages won't flow until it is.
4. **Turned-out grades in a replay use today's season values**, because Savant values aren't kept day by day. At-the-time grades and the ledger are fully as-of.
5. **Still open from before:**
   - 31 pick protections not found.
   - The new-season cap rollover waits for the Contract tab.
   - No 375-px visual check: the browser extension wasn't connected.
   - The two ledger gaps above (Dillon Jones, Otega Oweh).
