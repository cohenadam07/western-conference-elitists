# GM Savant: drafting against the board, holding, draft style (Nov 23, 2026)

Branch `gm-savant`, last commit `502765e`. Not merged, not pushed.

Everything was rebuilt alone from the ledger, every step under 0.52 GB, with 21 GB of disk free throughout. **GM Value Added is unchanged in all 207 spells.** The new grades are comparisons with an average GM, not value that moved, so the conservation check is unchanged too (largest team-season gap 41.2 against a limit of 50; all gaps 79.8 against 150).

## 1. The inherited sentence

A card now carries one sentence when what a GM took over is at least twice everything else in his number (production plus what he left). It names the inherited players who made up most of it. 12 spells carry it:

- **Krause (Chicago Bulls), −2,864:** "Krause inherited Michael Jordan; this number credits only what he added beyond the roster he took over."
- **Kupchak (Los Angeles Lakers), −4,841:** "Kupchak inherited Kobe Bryant and Shaquille O'Neal; …"
- **West (Memphis Grizzlies), −2,552:** "West inherited Pau Gasol, Shane Battier and Jason Williams; …"

For finished tenures, the Inherited and Left-behind lists are now valued the way the headline is: what the team got from each player and pick.

## 2. The board collection

Every board is the source's last capture before draft day in the Internet Archive. Big boards come first. A mock is used only in 2008, where no second big board was archived.

| Drafts | Sources |
|---|---|
| 2008 | NBADraft.net big board (June 16) + DraftExpress mock (May 9; it says team needs are not yet taken into account) |
| 2010–2017 | NBADraft.net + DraftExpress Top 100 (DraftExpress shows its top 25 in 2015 and 2016) |
| 2018–2025 | NBADraft.net + ESPN Best Available (its archived top 25) + Tankathon |
| 2026 | ESPN + Tankathon |
| 2005, 2009 | one board each (NBADraft.net), so they keep the slot grade |
| before 2008 otherwise | no usable second source, so the slot grade |

That's 18 drafts and 1,073 picks graded against the consensus.

**Searched and not usable:**
- NBA.com's 2003–08 "Draft Board" pages and CBS SportsLine's prospect rankings: their archived pages hold no names (drawn by Flash or script).
- DraftExpress's 2005–07 mocks: first archived after each draft.
- ESPN Insider: behind a login.

So **Darko at No. 2 (2003) stays on the slot grade**, as do Oden and Thabeet. Each such pick says "graded against the slot: no consensus board exists for this draft."

**Matching board names to players:**
- exact name, then last name plus first initial;
- then the closest spelling, for cases like "Giannis Adetokunbo";
- three renames and nicknames entered by hand: Enes Kanter → Enes Freedom, Nah'Shon → Bones Hyland, Carlton → Bub Carrington.

First-rounders who are on no board are genuinely off them: George Hill, Bruno Caboclo, Santi Aldama, Yang Hansen and three others. They count as ranked just past each board's end.

## 3. How the grade works, and what I measured instead of typing

- **At the time:** the expected value by board rank is fit only on earlier board drafts. 2008 and 2010 use the slot curve as a stand-in, because they have no two earlier board drafts.
- **Ties:** two boards often tie on the average rank (Rose and Beasley both 1.5 in 2008). Both players count as the best available. Before this fix, ties were broken alphabetically and created false reaches.
- **Easy picks:**
  - The pass rate in each spot (pick range × how split the boards were) is pulled toward its pick range's rate.
  - The prior weight comes from how well each choice predicted later drafts, within that pick range, earlier drafts only.
  - At No. 1 the data can't yet tell unanimous from split boards. Before 2025: 0 of 4 unanimous first picks were passed over, against 4 of 12 split ones, and the measured weight is 32.
  - That's why **Flagg gets +36 at the time**, which you accepted as designed.

## 4. The five repeatability tests on the new skills

| Skill | Grade | date | oddeven | stakes | stake-weighted | spell | Verdict |
|---|---|---|---|---|---|---|---|
| Drafting | turned out | −0.18 [−0.34, −0.00] | −0.14 | +0.01 | −0.19 | −0.14 | does not repeat |
| Drafting | at the time | **+0.31 [+0.07, +0.52]** | **+0.35 [+0.10, +0.55]** | +0.27 | +0.06 | **+0.27** | repeats |
| Deviation success | turned out | −0.03 | −0.07 | +0.21 | −0.03 | +0.18 | does not repeat |
| Deviation success | at the time | +0.16 | +0.34 * | +0.53 * | +0.06 | +0.06 | unclear |
| Holding | turned out | +0.02 | +0.24 * | −0.01 | +0.17 * | −0.01 | unclear |
| Holding | at the time | +0.15 | +0.32 * | +0.24 * | +0.27 * | +0.01 | unclear |
| Fit picks | both | | | | | | not testable (2 people with 8+ fit picks) |

\* the interval excludes zero. Each cell is the correlation across people, with the 95% interval where it matters.

**Two artifacts, found and fixed before these numbers:**
1. **Holds counted by window made holding look repeatable** (oddeven r = 0.58). A deadline and the offseason after it are the same player kept, so alternating windows puts one player in both halves. Counted once per player kept, it falls to 0.08 in that check. The unit is now the player kept.
   - The oddeven and stake splits still pass at +0.24. Alternating players who were kept in the same windows samples the same roster twice, so I read the date split (+0.02) as the clean one.
2. **Draft grades were compared only within the season.** Bad teams keep picking high, and a top pick's grade is bigger either way. Compared within the same pick range, drafting-at-the-time drops from +0.46 to +0.31 and still repeats. So every draft grade is now compared with picks in the same range.

**What "drafting at the time repeats" means:** that grade measures a pick against the boards. So GMs keep agreeing, or disagreeing, with the boards. How their picks turn out against the boards does not repeat. The page's repeat sentence, generated from these verdicts, now says exactly that in all three places. It had been reading "Only holding, re-signing and extensions repeat", which counted any single passed test.

## 5. Cooper Flagg

- **Pick grade:** No. 1, 2025, Dallas (Nico Harrison). The boards were unanimous: rank 1 on all three.
  - As an easy pick he's credited what an average GM gave up at No. 1: **+36 at the time, +87 as it turned out**.
  - Under the old slot grade, his projection beat the slot by +147. That's now gone from drafting.
- **Lottery luck: +197.** The No. 1 slot is worth 347, and Dallas's pre-lottery odds gave an expected 151. Harrison's lottery luck in all is +178.

## 6. Ten famous picks under the new grade

| Pick | Board | At the time | As it turned out | Old slot grade |
|---|---|---|---|---|
| 2013 No. 15 MIL Giannis Antetokounmpo | rank 11, **the best available** | +100 | +338 (easy pick) | +2,186 |
| 2003 No. 2 DET Darko Miličić | no board | — | −818 (slot) | −818 |
| 2013 No. 1 CLE Anthony Bennett | rank 4; Alex Len was No. 1 | −206 | +1 (Len did no better) | −955 |
| 2014 No. 1 MIN Andrew Wiggins | rank 2; Joel Embiid No. 1 | −101 | −1,410 | −873 |
| 2018 No. 2 SAC Marvin Bagley III | rank 4; Luka Dončić No. 2 | −96 | −2,655 | −582 |
| 2020 No. 2 GSW James Wiseman | rank 6; LaMelo Ball No. 1 | −292 | −1,374 | −814 |
| 2012 No. 2 CHA Michael Kidd-Gilchrist | rank 5; Andre Drummond No. 2 | −127 | −1,018 | −566 |
| 2010 No. 9 UTA Gordon Hayward | rank 24; Patrick Patterson No. 8 | −262 (a reach) | +543 | +446 |
| 2017 No. 3 BOS Jayson Tatum | rank 5; Josh Jackson No. 2 | −119 | +1,578 | +794 |
| 2014 No. 41 DEN Nikola Jokić | rank 47; Jordan Clarkson No. 23 | −104 (a reach) | +2,776 | +2,763 |

Oden (2007) and Thabeet (2009) have no consensus board, so they keep the slot grade (−921 and −778).

## 7. Where Milwaukee's credit for Giannis lands

He was the consensus best available at 15, so drafting credits only +338 as it turned out. The rest isn't lost:

- **GM Value Added (Hammond, 2008–2017):** Giannis is **3,246 of the 4,838** in what Hammond left behind. It's on the card's Left-behind list. His play is also in the team's production in Hammond's seasons.
- **For Horst,** Giannis is 1,805 of what he inherited. Only what Horst added beyond that is his.
- **Holding:** +34 as it turned out (+21 at the time) for Hammond over 8 windows, and +22 (+14) for Horst over 5.
- **Development:** Hammond's 2016 extension counts Giannis beating his projection in the seasons Hammond was in charge.
  - That turned up a bug: development ran on into the successors' seasons. Hammond was credited 5,190 for Giannis through 2026.
  - Fixed, Hammond's development is 1,383 in all.
- **The conservation check** still books Giannis's whole career minus his slot to the 2013 draft. The new grade is a comparison on top of that, not a replacement.

## 8. Presti holding Shai Gilgeous-Alexander, and the Kings' Haliburton trade

- **SGA at OKC:** kept through 8 windows from age 21 to 24.
  - At his projection (800–1,500 points), teams traded a player like him about 3.8% of the time and lost about 420–455 when they did.
  - That's about +16 a window: **+109 as it turned out, +101 at the time**.
  - Presti's holding in all is +1,301 over 266 windows and 73 players. The biggest are Westbrook +132, Ibaka +129 and Adams +111.
- **Haliburton (Sacramento, Feb 8, 2022, age 21):** traded with a projection of 1,362, in a cell where teams traded such players 3.3% of the time.
  - The trade (to Indiana for Sabonis, Holiday, Lamb and a second) grades −794 at the time and −1,535 as it turned out.
  - Haliburton was 78% of what Sacramento sent out, so the value lost on him is **1,189 as it turned out, 616 at the time**.
  - That's in McNair's trade grade, not in holding: holding credits only players kept.

## 9. The drafting leaderboard, before and after

**Before** (against the slot):
- **Top:** West +6,485, Whitsitt +5,492, Popovich +4,874, Inman +4,744, Embry +4,106, B. Colangelo (PHO) +4,086, F. Layden +3,676, Presti +3,589, J. Colangelo +3,453, Ujiri +3,190
- **Bottom:** Baylor −8,482, Ferry −3,096, Babcock −2,472, Grant −2,449, Cho −2,433, Winger −2,418, B. Colangelo (TOR) −2,360, Salyers −2,307, Divac −1,996, Paxson −1,975

**After** (against the board from 2008, the slot before):
- **Top:** West +6,485, Whitsitt +5,492, Inman +4,744, **Connelly +4,442** (new), Popovich +4,165, Embry +4,106, B. Colangelo (PHO) +4,086, Presti +4,065, Ujiri +4,049, F. Layden +3,676
- **Bottom:** Baylor −9,159, **Divac −3,396**, Ferry −3,096, **Petrie −2,521** (new), Babcock −2,472, **B. Wright (SAS) −2,388** (new), Grant −2,317, Salyers −2,307, B. Colangelo (TOR) −2,269, **Pritchard −2,226** (new)

Pre-2008 GMs are unchanged. The movers are all board-era GMs: Connelly (Jokić at 41 beat the best available by +2,776), Divac (Bagley over Dončić, −2,655), Petrie, and Brian Wright.

## 10. Who leaves the board most and least (31 GMs with 15+ board picks)

Across the league, GMs passed on the consensus best available in 832 of 1,073 board picks. Those picks beat the player passed on 46% of the time, −28 on average.

**Least off the board:**
- **Dennis Lindsey:** 60% of 20 picks. Beat the player passed on 50% of the time, −583.
- **Jon Horst:** 65% of 17. 55%, +481.
- **David Griffin:** 67% of 21. 64%, +1,957, the best record here. 5 fit picks, +1,247.

**Most off the board:**
- **Ernie Grunfeld:** 94% of 16. 47%, −796.
- **Gar Forman:** 93% of 15. 50%, −152.
- **Sean Marks:** 92% of 24. 36%, −1,598.

**Talent against fit** (league-wide, inferred from roster needs):

| Kind | Picks | Over the slot | Minutes a season for his team (2008–22 drafts, first four seasons) |
|---|---|---|---|
| Talent (the best available) | 241 | +1 | 755 |
| Fit | 153 | −80 | 713 |
| Other passes | 679 | −10 | 547 |

Fit picks turned out worse than talent picks on value, and about the same on minutes.

## 11. Other fixes this round

- **The season in progress had a trade "deadline":** its latest trade so far, Nov 8, 2026, which mislabeled this season's trades. A deadline now exists only once its season is over.
- **Development** counts only the seasons the GM was in charge for (see 7).
- **Disk guard:**
  - Every heavy step runs through `peak.py`, which now refuses to start below 15 GB free. It exits with code 75 and says how much is free.
  - The cloud runner sets its own 4 GB floor, since GitHub's machines have about 14 GB.
  - The Data Room catalog is 18 KB and already gzipped, so it didn't need chunking. Its earlier failure was the full disk.
- **The explainers check:** no duplicate keys, and every entry's text matches its title. The source file, the page's embedded copy and EXPLAINERS.md agree.
  - One real mismatch: "Second-round finds" said "above the slot" while summing the new grade. Fixed.
  - The new tap test checks that every explainer button opens its own entry.
- **The tap test** lives in `tools/savant-gm/tap.mjs` now: 14/14 at 375px.

## Checks

| Check | Result |
|---|---|
| Conservation | passes (41.2 / 79.8 within the 50 / 150 limits) |
| `check:savant-gm` | 11 of 11 |
| `tools/savant-gm/tap.mjs` | 14 of 14 |
| `test:gm-pipeline` | 11 OK (the slow incremental test skipped) |
| Connector | 20 of 20 |
| Coverage | 1 of 1 |
| Data Room | 8 of 8 |

Stopped here.
