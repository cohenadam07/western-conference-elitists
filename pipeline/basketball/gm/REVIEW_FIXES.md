# GM Savant: fixes before the merge (Nov 23, 2026)

Branch `gm-savant`, commit `ecfd789`. Not merged.

## 1. GM Value Added, two versions: built now

It wasn't built before. The headline values what a GM inherited and left as projected on those days. That is the at-the-time version, and it stays the headline for every tenure.

**What "as it turned out" changes** (finished tenures only):
- Production is unchanged.
- What he inherited and left is valued at what those players and picks went on to produce:
  - a player at his own production from that day, wherever he played;
  - a pick at its slot's expectation once used.
- It uses the same ten seasons, the same 5% discount, and the same free-agent rule.

**Where it appears:**
- on every finished tenure's card, as a tile and a row in the discount table;
- as a third board, "As it turned out", on the home page and the leaderboard;
- in the connector's GM profile;
- in a new explainer, with the GM Value Added explainer describing both.

**The three GMs you asked about:**

| | At the time | As it turned out |
|---|---|---|
| Kevin Pritchard (POR) | +3,276 (left 5,567, inherited 2,729) | +1,667 (left 3,604, inherited 2,375) |
| Isiah Thomas (TOR) | +2,882 (left 3,643) | +4,632 (left 5,393) |
| Pat Williams (ORL) | +3,741 (left 3,769) | +2,920 (left 2,948) |

- **Pritchard:** the roster he left in Portland turned out far below its projection.
- **Isiah Thomas:** what he left in Toronto outperformed its projection.
- **Toronto and Orlando** were expansion teams, so neither inherited anything.

**All-time, the 179 finished tenures of two or more seasons:**

At the time:
- **Top:** West (LAL 1982) +5,071, Popovich (SAS 1994) +4,911, J. Colangelo (PHO 1979) +4,794, Embry (CLE 1986) +4,507, P. Williams (PHI 1979) +3,852, Schlenk (ATL 2017) +3,804, P. Williams (ORL 1989) +3,741, Walsh (IND 1986) +3,677, S. Layden (UTA 1989) +3,580, Whitsitt (OKC 1986) +3,552
- **Bottom:** Baylor (LAC 1986) −4,612, Griffin (NOP 2019) −3,628, Grunfeld (WAS 2003) −3,371, Sund (ATL 2008) −3,259, King (BRK 2010) −2,933, Weaver (DET 2020) −2,887, Higgins (CHO 2007) −2,866, Grant (CLE 2010) −2,724, Grunwald (TOR 1997) −2,520, Vandeweghe (BRK 2008) −2,478

As it turned out:
- **Top:** Popovich +5,934, F. Layden (UTA 1979) +4,948, Whitsitt +4,841, I. Thomas (TOR 1995) +4,632, Walsh +4,350, Auerbach (BOS 1979) +4,223, J. Colangelo +3,731, L. Riley (GSW 2009) +3,722, Hinkie (PHI 2013) +3,446, Connelly (DEN 2013) +3,444
- **Bottom:** Baylor −6,246, Grant −4,423, Rivers (LAC 2013) −4,422, Demps (NOP 2010) −4,391, Kupchak (LAL 2000) −4,310, Twardzik (GSW 1995) −4,038, Reed (BRK 1990) −3,377, Grunfeld (MIL 1999) −3,182, Budenholzer (ATL 2014) −3,171, Higgins −3,159

The two versions correlate at 0.58, and the median tenure moves 1,139 points. Hindsight cuts both ways:
- Kupchak inherited a Kobe Bryant who turned out even better than projected, so he falls.
- Hinkie left picks that turned out well, so he rises.

## 2. Explainers: refit numbers come from the data

The explainers, the skills intro and the How-it-works notes now take every number a refit can move from the build itself. `assemble.py` fills each `{{placeholder}}` from the page's index and stops the build if one is left. `EXPLAINERS.md` is generated from the same filled text.

Numbers now filled from the data:
- the margin scale (60.1);
- points per win;
- the first pick curve's drafts;
- the implied discount. It used to be a typed "21% (10 trades)". It's now measured on every build from trades of one pick for a later pick in the same round, and reads **31% a year, from 6 trades**;
- the repeat sentence.

**The repeat sentence is now in all three places** (Percentile, Is it skill?, and the skills intro): "Only re-signing repeats, and that likely reflects having stars to re-sign." One correction from the data: after today's conservation rewrite, re-signing repeats in **one** of the five tests, not four. The page said "four of five" in typed text, which is now replaced by the count from the data.

## 3. Tap, not hover

- At the time, Low confidence and Graded by now say "tap".
- The grade's model, the low-confidence reason and the Graded-by versions are buttons that open the same popover as the explainers. So are the repeatability cells, which had used hover tooltips too.
- The portfolio chart takes a tap and shows his big moves near that point.
- **Tested at 375px in jsdom: 12 of 12 pass.** The browser extension wasn't connected, so this isn't on a real phone.

## 4. Trade windows from each season's dates

- **Deadline:** the 30 days up to that season's last in-season trade day, read from the transactions. For example, 2021: March 25; 2012: March 15.
- **Offseason:** from the regular season's last game to the next season's first. 2020's ran from Aug 14 to Dec 22, so the November 2020 draft-night trades are offseason.
- **Other:** everything else.

## 5. Wording

- **Free agency:** "Salaries aren't counted yet."
- **Trades, as they turned out:** "Draft rights traded before a player's first season also count at the slot's expectation." It also now explains own-production valuation. "Followed through later trades" was out of date after the conservation rewrite, and so was the same phrase in "How it turned out".
- **Drafting:** drafts from 1990 on use a curve fit only on earlier drafts. Earlier ones use the first curve, fit on the 1980-85 drafts, so a 1980-85 draft is judged partly against itself. The 1979 draft isn't graded.
- **Re-signing:** says it's shown, not added.
- **Repeatability:** "Smallest seen" is now "smallest it can detect".
- **Skills section:** "Skills overlap, so they don't add up to GM Value Added."
- **Spelling:** US spelling throughout (favor, judgment; three code comments too).

## 6. The three files

`ledger_trades.json`, `fo_events.json` and `wiki_events.json` are untracked and ignored. They travel only in the encrypted bundle.

The branch has never been pushed, so no published history needed cleaning. **But** its earlier commits still contain the files, so pushing or merging the branch as-is would publish them through that history. A squash merge avoids it, or I can rewrite the branch's history before anything is pushed. I haven't done either.

## 7. Draft-night credit: Krause

**His ten biggest trades** (as they turned out, then at the time):
1. **2002 Artest, Miller, Mercer and Ollie to Indiana for Jalen Rose:** −2,169 / −461
2. **1999 Barry to Seattle for Hawkins:** −1,364 / +333
3. **2001 Brand to the Clippers for Chandler** (draft night): −872 / −649
4. **1999 Pippen to Houston:** −758 / −425
5. **1988 Oakley to New York:** −712 / no at-the-time grade (before 1990)
6. **1988 Threatt for Vincent:** −538 / +41
7. **1986 Oldham to New York:** +456 / none
8. **1986 Colter for Threatt:** +414 / none
9. **1997 Simpkins for Burrell:** +390 / +94
10. **1999 Longley to Phoenix:** +306 / +694

**The draft-night trades split correctly:**
- **2001, Brand for Chandler:**
  - Chandler's rights count at the #2 slot's expectation in the trade (+738).
  - His career below that slot (−170) is Chicago's draft grade, since Chicago held his rights when the season began.
  - Brand counts at his own production from the trade on (−1,663).
  - The trade nets −872, and nothing is counted twice.
- **1987, Pippen** (not in his top ten by size):
  - Pippen's rights count at the #5 slot (+500), and Polynice's at the #8 slot (−399), so the trade is +6.
  - Pippen's career beyond his slot (+1,693) is Krause's drafting grade.
  - Polynice's (−129) goes to Seattle.

So a draft-night deal is judged as a trade on the slots exchanged, and what each player became beyond his slot is a drafting grade, credited to whoever held his rights when the season began.

## Checks after this round

Everything was rebuilt alone, with every step under 0.6 GB.

| Check | Result |
|---|---|
| Conservation | passes (41.2 / 79.8 within the 50 / 150 limits) |
| `test:gm-pipeline` | 11 of 11 |
| `check:savant-gm` | 11 of 11 (new: the turned-out identity, no unfilled placeholders, no hover-only details) |
| Connector | 20 of 20 |
| Coverage | passes (`openTip` excluded with a reason) |
| Data Room | 8 of 8 |
| Build | clean |

Stopped for your go on the merge.
