# GM Savant: the private bundle, the conservation check, and Module 9 (Nov 23, 2026)

Branch `gm-savant`. Not merged. Nothing is uploaded, nothing scheduled is installed, and no secret is set.

## 1. The cloud bundle: parsed facts only, encrypted

`mac_pull.sh --seed` no longer uploads the page cache. The cloud now carries only what the pipeline reads out of each page, as plain data (`pagefacts.py`):

- every transaction paragraph as text, with the players and teams it links and its parse;
- each season's totals rows (player, team, minutes, name);
- the drafts;
- NBA.com's movement rows;
- the team links.

Every reader uses the page when it has one, and the facts when it doesn't. In the cloud it uses facts only.

**What's in it, and how big:**

| Bundle | Files | On disk | Packed and encrypted |
|---|---|---|---|
| Full state (`gm-state.enc`) | 255 | 53.7 MB | 7.9 MB |
| Mac lane, nightly (`gm-mac.enc`) | 6 | 0.6 MB | 0.5 MB |

The full state is 50 parsed outputs and state files (49.1 MB), 99 facts files (2.3 MB) and 106 model fits (2.3 MB). Two files are left out: `snapshots.json`, which grading never reads, and `br_tx.json`, which only the Module 1 report uses. The nightly Mac bundle is this season's facts plus the luck margins.

**How it's kept private:**
- It's encrypted with AES-256, using a key derived from the `GM_STATE_KEY` repo secret (PBKDF2). The release asset is ciphertext.
- The packer refuses anything that looks like page markup.
- No GM workflow runs on pull requests, so forks never see the secret.

**Tested:**
- All six readers give the same answer from pages and from facts (`pagefacts.py check`).
- I unpacked the encrypted bundle into an empty sandbox with no page cache and built the whole chain from facts only. It is identical on all 404 output files.

**A choice for you before merge:** three tracked pipeline files carry plain transaction text from the fetched pages: `ledger_trades.json` (1.1 MB), `fo_events.json` and `wiki_events.json`. None is a raw page, and the page already shows each decision's text with its source link. I'd untrack them so they live only in the bundle, but I haven't.

## 2. The conservation check, and what it found

`conserve.py` checks every team-season from 1980-81 to 2025-26. The value credited to all of the team's decisions, plus the moves no one decided, must equal what its players actually produced. Each decision is credited what it brought in minus what it sent out, at each asset's own production from that day on.

The moves no one decided are booked and credited to no GM:
- the rosters of 1979;
- each team's own picks;
- draft-night conversions;
- retirements;
- the ledger's repairs.

**Before:** 134 of 1,292 team-seasons balanced, and 75,352 points were off (9%).
**After:** 1,282 balance. 80 points are off across 10 team-seasons, mostly one namesake pair the ledger spells alike (Ron Harper and Ron Harper Jr.) and one Greg Foster waiver chain.

The check now runs in the chain and in the nightly update. It fails the build past 50 points in one team-season, or 150 in all.

**Fixed in the credit rules:**
1. **Valuation.** Value is now the asset's own production, never followed into what it was traded for. Following it double-counted every trade's return.
2. **Draft-rights re-signings, extensions, and signing your own draft pick** move no value, so they add nothing. A re-signing still shows the value it kept, labelled as not added.
3. **Sign-and-trades.** The receiving team's signing of a player it already holds through the trade adds nothing.
4. **Same-day reacquisitions** no longer depend on grading order. Before, 18 trades were graded on a cut-short value.
5. **Sales for cash** (52 of them) were never graded. They are now graded like trades.
6. **Draft rights:**
   - Rights given up before the season are valued at what the player went on to produce.
   - Rights count only while still with the drafting team, or a team it traded them to.
   - A twice-drafted player (Sabonis, 1985 and 1986) is valued from each draft.
   - A team drafting a player it already had adds nothing.
7. **Projections** cover only seasons not yet complete.

**Fixed in the ledger:**
1. **Free-agent departures** are now inferred per stint. Ariza's 2007–09 Lakers stint never ended, because he went back to the Lakers in 2021.
2. **A signing or re-draft while the player was on another team's books** now ends that team's holding: Donaldson in 1983, Eaton in 1982.
3. **Opening balances** come before the departure rules. Before, no 1979 stint could end.
4. **A player's draft** comes first on its day.
5. **Roster repairs:** where a player played for a team the books never had him at (Jordan's 1995 return, two-way conversions), he's moved there, credited to no GM.
6. **Stale repairs** are recomputed from the corrected books.
7. **Minute shares** use regular-season minutes only. Playoff rows had tilted traded players toward their playoff team, and league leaders' minutes, wrapped in bold, weren't being read (Harden 2015-16).
8. **Namesakes** get their own value, in 36 groups.

**Trade leaderboard (10+ trades, as they turned out):**
- **Before, top:** Scheer +6,132, Dawson +5,498, Altman +5,032, Morey +4,659, Whitsitt +4,636.
- **Before, bottom:** B. Colangelo −5,080, Demps −4,627, Krause −4,265, Grunwald −3,230, Griffin −3,220.
- **After, top:** Ainge (BOS) +6,020, Scheer +4,632, Walsh +4,594, Baylor +4,143, Morey +3,856.
- **After, bottom:** Krause −5,449, Grunwald −4,094, Demps −3,645, Griffin −3,410, B. Colangelo −3,373.

**Drafting leaderboard (10+ picks, over slot):** nearly unchanged, since drafting was already conserved by the earlier pick fix.
- **Top:** West +6,485 (was +6,414), Whitsitt +5,492, Popovich +4,874, Inman +4,744, Embry +4,106.
- **Bottom:** Baylor −8,482, Ferry −3,096, Babcock −2,472, Cho −2,433 (was −2,650), Winger −2,418.

**The headline did not stay unchanged.** 270 of 291 spells moved: the median by 3 points, the largest Ted Podleski (LAC 1981) −395, Danny Ferry (NOP 2019) −255 and Don Nelson (DAL 1997) −247. The credit rules never enter the headline. It moved for two other reasons:
1. **Corrected holdings: 4,929 of the 5,413 points.** The ledger had kept players on teams they had left, so GMs' "inherited" and "left" values were wrong. I measured this by rerunning with the scale held fixed.
2. **The margin-to-value scale moved from 60.3 to 60.1.** It is fitted on team value, which changed with the corrected minute shares.

The full before/after leaderboards are in `out/conservation_report.txt`.

## 3. Dillon Jones and Otega Oweh: fixed

- **Dillon Jones.** Oklahoma City's Feb 8, 2024 trade sent Dallas an unnamed 2024 first. The ledger took the first one it found, the Houston pick that became Topić. It now takes the one the receiver goes on to trade: Dallas sent that pick to Washington, where it became Jones. On the same day, an unnamed pick arriving now comes before a named one leaving. The Topić pick stays with Oklahoma City until it uses it.
- **Otega Oweh.** Basketball-Reference books the 2026 second on Charlotte's January 2024 Rozier trade. Its own note says Charlotte "sent pick to resolve dispute" later, and in 2024 the pick was Oklahoma City's; it reached Charlotte through New York. With no date given, it's booked as its own Charlotte decision on the last possible day, the day before the 2026 draft at which Miami used it.

## 4. The launchd job: written, not installed

`launchd/com.wcehoops.gm-pull.plist` (`plutil -lint`: OK) sets every variable inside the plist:
- `PATH`, plus the full path to `python3`;
- `HOME`, `USER`, `LANG`, `LC_ALL` and Python's encoding;
- `TZ=America/New_York`;
- `GM_CACHE`, `GM_CACHE_BR` and `GM_FACTS`;
- `GH_REPO`, plus gh's prompt and notifier switches.

It runs `mac_pull.sh` directly, not through a login shell. The two secrets are named by path only, because the repo is public: `GM_STATE_KEY_FILE` and `WCE_CONTROL_ROOM_ENV`. It runs at 6:10am and 4:10pm, and when loaded. The install and remove commands are in its header.

## 5. Module 9

**Tests:**
- **`npm run check:savant-gm`**, 11 of 11 pass:
  - the files are whole, with no `NaN`;
  - the headline equals production plus left minus inherited at every discount rate, and the player-value line likewise;
  - the boards are in order;
  - every photo has its credit line;
  - every explainer is wired and complete;
  - all five connector tools answer through a real MCP client, with numbers read back from the files.
- **`npm run test:gm-pipeline`**, 11 of 11 pass:
  - ledger balance;
  - every move has a source;
  - conservation;
  - zero-sum trades;
  - unique ids;
  - credit weights;
  - every day credited once;
  - sources;
  - frozen grades never change;
  - an incremental night equals a full one (`GM_TEST_SLOW=1`);
  - the replay matched.

  The incremental test caught one real bug: a decision listed twice kept the wrong copy's carried value. It's fixed.
- **Also pass:** the connector suite (20 of 20), coverage, the Data Room check (8 of 8), the changelog check (9 of 9), freshness for GM (4 checked), and the build.

**Version and changelog:**
- GM Savant 1.0.0.
- The connector goes to 3.9.0 (five GM tools).
- A GM Savant 1.0.0 entry is added to `src/data/updates.json`. Main has moved on since this branch was cut, so expect a small conflict at the top of that file on merge.

**Spot-check of ten GMs** (`out/spot_check.txt`): Presti, Morey (Houston and Philadelphia), Riley, Ainge (Boston and Utah), Krause, West (Lakers and Memphis), Buford, Rose, Pelinka, Podleski.
- Every tenure has its source.
- Every team-season they ran balances, except four of under 6 points: Ainge's Boston in 2015 (+5.2), Buford's Spurs in 2015 (−5.3), and Krause's Bulls in 2000 and 2002 (+1.6, −3.7).
- What reads right:
  - Presti is first (+6,912) and West second (+5,071).
  - The Harden trade is −2,935 for Oklahoma City and +2,935 for Houston, as a zero-sum trade should be.
  - Riley's 2010 LeBron sign-and-trade is +3,478 and the 2014 let-walk −2,681. Under conserved accounting, entry and exit are separate entries, and together they net to his four Miami seasons.
  - Krause's 2002 Brad Miller and Ron Artest trade is −2,169.
- What to watch: 25–45% of each GM's decisions carry a low-confidence flag, mostly pending the Contract tab.

**Replay:** I reran the deadline week alone after all of this. The largest step was 754 MB. It matches the one full build exactly:
- ledger: 40,019 of 40,019 events;
- decisions: 31,288 of 31,288, with both grades identical;
- the 30 active GMs' decision logs are identical;
- nothing is dated after Feb 7;
- of 508 output files, 303 are byte-identical and 205 differ only in `frozen_on` (the date each grade was frozen).

One caveat about the nightly savings: only quiet nights carry grades over (25,529 of 27,979 on Feb 2). New transactions keep revising last summer's inferred departures, and when that history changes the night recomputes everything. Those nights are correct, just not faster.

## 6. Waiting on you

1. **The merge.**
2. **The state key.** You create it, and the same value goes in the file and in the secret:
   - `openssl rand -base64 48 > ~/.config/wce/gm-state.key`
   - `gh secret set GM_STATE_KEY < ~/.config/wce/gm-state.key`
3. **The first seed:** `mac_pull.sh --seed`. It now uploads only the encrypted facts and state.
4. **Installing the launchd job**, using the commands in the plist's header.
5. **Whether to untrack** `ledger_trades.json`, `fo_events.json` and `wiki_events.json` (section 1).
6. **Still open:**
   - the 10 residual team-seasons;
   - the 31 pick protections not found;
   - the cap rollover, which waits for the Contract tab;
   - a 375-px visual check.
