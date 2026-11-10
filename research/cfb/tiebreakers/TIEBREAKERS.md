# Conference championship game tiebreakers, 2026 season

Researched 2026-11-10. Every numbered step below is taken from the document named as its
source, read directly (PDF text extraction or page HTML), not from a summary. Text in
quotation marks or block quotes is verbatim. Anything labelled **Reading** is my
interpretation for an implementer and is not in the published text. Each section ends with a
"could not confirm" list. Nothing here is filled in from memory.

Contents

1. [Summary table](#1-summary-table)
2. [ACC](#2-acc)
3. [Big Ten](#3-big-ten)
4. [Big 12](#4-big-12)
5. [SEC](#5-sec)
6. [What is computable from results alone](#6-what-is-computable-from-results-alone)
7. [Group of 6](#7-group-of-6)
8. [Cross-cutting implementation notes](#8-cross-cutting-implementation-notes)

---

## 1. Summary table

| | ACC | Big Ten | Big 12 | SEC |
|---|---|---|---|---|
| Policy version in force | "As Amended July 1, 2026" (new for 2026) | 2024 document; no 2026 document found | 2024 policy, re-posted 2025-11-04; no 2026 document found | "Final 10.29.24"; still the document on the SEC's tiebreaker page |
| Confirmed for 2026 from an official source | Yes | **No** (carry-forward) | **No** (official page still says "2025") | Partly (official page still serves it on 2026-11-10; text not revised for nine games) |
| Conference games per team, 2026 | 9 for twelve teams, 8 for five | 9 | 9 | 9 |
| Teams | 17 | 18 | 16 | 16 |
| Head-to-head | Yes | Yes | Yes | Yes |
| Record vs common opponents | **Removed** | Yes | Yes | Yes |
| Common opponents in standings order | **Removed** | Yes | Yes | Yes |
| Opponents' conference win % | **Removed** | Yes | Yes | Yes |
| Total wins (12-game season) | No | No | Yes | No |
| Outside number | SportSource "Team Success Ranking" | SportSource "team Rating Score" | SportSource "team Rating Score" | SportSource "capped relative total scoring margin" (formula published) |
| Last step | Commissioner's draw | Random draw | Coin toss | Random draw |
| Explicit "lost to all the others is eliminated" rule | Yes | No | No | Yes |

---

## 2. ACC

**Source (official):** "Atlantic Coast Conference Football Tiebreaker Policy (As Amended July 1, 2026)", two pages.
- https://theacc.com/documents/2026/7/15//ACC_Football_Tiebreaker_Policy_Jully_2026.pdf
- same file: https://s3.amazonaws.com/sidearm.sites/acc.sidearmsports.com/documents/2026/7/15/ACC_Football_Tiebreaker_Policy_Jully_2026.pdf
- Release, 2026-07-15: https://theacc.com/news/2026/7/15/acc-announces-new-football-championship-tiebreaker-policy.aspx

**Changed for 2026: yes, completely.** The release says the policy "will take effect beginning
with the 2026 season". Record against common opponents, common opponents in standings order
and opponents' combined winning percentage are all gone. Only three criteria remain:
head-to-head, the SportSource ranking, a draw.

### 2.1 Who is in the game (verbatim)

> The Atlantic Coast Conference Football Champion will be decided by a game (the "ACC Football Championship Game") between the Top Two Teams.
>
> The Top Two Teams shall be the two ACC teams with the highest percentage of Conference wins during all regular-season Conference competition and/or team(s) which played an alternate number of Conference games and have either the same number of Conference wins or the same number of Conference losses as the team(s) with the highest percentage of Conference wins.
>
> To be among the Top Two Teams, a team must be eligible to compete in the postseason. Conference games against otherwise postseason ineligible teams will always be counted in the league standings and in application of the tiebreaker policy.
>
> If three (3) or more teams are tied with the highest percentage of wins or two (2) or more teams are tied with the second highest percentage of wins, the following tiebreaker shall be administered to determine the representative(s) in the ACC Football Championship Game.

### 2.2 The tiebreaker (verbatim; the PDF letters two consecutive items "b", reproduced as printed)

> **1. Defining Tied Teams:**
> a. Step 1: Identify the team or teams with the best Conference win percentage; plus,
> b. Step 2: Any team or teams which played an alternate number of Conference games and have either the same number of Conference wins or the same number of Conference losses as the team(s) identified in Step 1.
> c. No other teams may be defined as Tied Teams.
>
> **2. Once the Tied Teams have been identified:**
> a. In the event of a tie involving teams which played an alternate number of Conference games, all ties will be broken starting with the highest win percentage, working downward.
>
> b. **Two-Team Tie**
> i. The tied team which defeated the other tied team in head-to-head Conference competition.
> ii. The tied team with the better ranking in the Team Success Ranking provided by SportSource Analytics following the conclusion of all regular-season games.
> iii. The participant shall be chosen by a draw as administered by the Commissioner or Commissioner's designee.
>
> b. **Three (or More) Team Tie**
> i. If all the Tied Teams are common opponents:
> 1. The Tied Team with the best record among the Tied Teams; if necessary, the tiebreaker will restart, including the definition of tied teams.
> 2. The Tied Team with the best ranking in the Team Success Ranking provided by SportSource Analytics following the conclusion of regular-season games; if necessary, the tiebreaker will restart, including the definition of tied teams.
> 3. The participant shall be chosen by a draw as administered by the Commissioner or Commissioner's designee; if necessary, the tiebreaker will restart, including the definition of tied teams.
>
> ii. If all the Tied Teams are not common opponents:
> 1. The Tied Team which defeated each of the other Tied Teams is placed into the Championship Game and removed from the tie. The tied team which lost to each of the other Tied Teams is removed from the tie; if necessary, the tiebreaker will restart, including the definition of tied teams.
> 2. The Tied Team with the best ranking in the Team Success Ranking provided by SportSource Analytics following the conclusion of regular-season games is placed into the Championship Game and removed from the tie; if necessary, the tiebreaker will restart, including the definition of tied teams.
> 3. The participant shall be chosen by a draw as administered by the Commissioner or Commissioner's designee; if necessary, the tiebreaker will restart, including the definition of tied teams.

That is the whole policy. There is no appendix and there are no worked examples.

### 2.3 Answers to the specific questions

- **Two-team tie:** head-to-head, then Team Success Ranking, then draw.
- **Head-to-head when the tied teams have not all played each other (3+ teams):** a team that
  beat *each* of the others goes into the game and leaves the tie; a team that lost to *each*
  of the others is removed. Both can fire in the same pass. Otherwise go straight to the
  ranking.
- **Head-to-head when they have all played each other:** best record among the tied teams.
- **Common opponents / standings-order / opponents' win %:** not used.
- **Analytics step:** SportSource Analytics "Team Success Ranking". This is a different named
  metric from the "team Rating Score" the Big Ten and Big 12 cite. No formula is published.
- **Final step:** draw by the Commissioner or designee.
- **Restart or continue:** restart. Every step ends "if necessary, the tiebreaker will restart,
  including the definition of tied teams". So after any team is placed or removed, go back to
  section 1 (re-identify the Tied Teams) and start again; do not carry on to the next step
  with the survivors.
- **Second spot:** same procedure. Once one team is placed, the tiebreaker restarts for the
  remaining spot. A two-way tie for the best percentage needs no tiebreaker for
  participation; both are in.
- **Unbalanced schedule (2026 specifically):** per the release, Boston College, Clemson,
  Florida State, Georgia Tech and North Carolina play eight conference games; the other twelve
  play nine. From 2027, sixteen play nine and one plays eight on rotation. Section 1.b is what
  handles this: an 8-game team joins the tie if it matches the leader's win count *or* loss
  count (and likewise a 9-game team against an 8-game leader).
- **Ineligible teams:** cannot be in the Top Two; games against them still count for everyone
  else's standings and tiebreakers.
- **Conference opponents that do not count in standings:** the policy counts "regular-season
  Conference competition" only and says nothing more. See "could not confirm".

### 2.4 Could not confirm (ACC)

- **What "common opponents" means in 2.b.i/ii.** The phrase "If all the Tied Teams are common
  opponents" is not defined. FBSchedules glosses it as "(everyone played each other)", which
  is the only reading under which the two branches make sense, but that gloss is theirs, not
  the ACC's. https://fbschedules.com/acc-announces-new-football-tiebreaking-procedures/
- **How 2.a works mechanically.** "all ties will be broken starting with the highest win
  percentage, working downward" is one sentence with no example. Whether it means the higher
  percentage wins outright among Tied Teams with different game counts, or only fixes the
  order in which sub-ties are resolved, is not stated.
- **What "restart, including the definition of tied teams" does to the pool.** After one team
  is placed, "Step 1: Identify the team or teams with the best Conference win percentage" is
  presumably applied to the teams not yet placed, which could admit teams that were not in
  the original tie. The text does not say so explicitly.
- **Partial separation in branch i.1** (round robin, e.g. records 2-1, 2-1, 1-2, 1-2): the text
  names only "the Tied Team with the best record". Whether the 1-2 teams are dropped before
  the restart is not stated.
- **What the Team Success Ranking is and where it is published.** No public definition or
  feed found.
- **Whether any 2026 ACC-vs-ACC game is designated non-conference.** Not checked against the
  schedule.
- The pre-2026 ACC policy text was not re-read; the statement that the older steps were
  removed rests on the 2026 document not containing them plus the release's description of
  it as a "new" policy.
- A related-story headline on theacc.com dated 2026-11-09 reads "ACC Announces 2026 Football
  Championship Game Will Be Final Annual Game". I saw the headline only and did not read it.

---

## 3. Big Ten

**Source (official, but dated 2024):** "2024 Big Ten Football Championship Game Tiebreaker",
three pages, PDF created 2024-08-23.
- Original URL (now returns an error; bigten.org has since moved platforms):
  https://assets.contentstack.io/v3/assets/bltca750cef518bc6e4/blt2bf0c27b5714240c/66cc95d319b683cdf2088edf/2024_Big_Ten_Football_Tiebreaker_-_FINAL[10][72].pdf
- Read from the Wayback Machine capture of 2025-07-27:
  http://web.archive.org/web/20250727013201/https://assets.contentstack.io/v3/assets/bltca750cef518bc6e4/blt2bf0c27b5714240c/66cc95d319b683cdf2088edf/2024_Big_Ten_Football_Tiebreaker_-_FINAL[10][72].pdf
- Corroboration of the step list, 2024-08-26: https://www.elevenwarriors.com/ohio-state-football/2024/08/148547/head-to-head-results-record-against-common-conference-opponents-top-big-ten-football-tiebreakers
- 2025 application (Big Ten release of 2025-11-23, republished): https://rrsn.com/?p=62717
- 2026 game page (says only "Tiebreakers will be applied, if necessary. Each team plays nine conference games"):
  https://bigten.org/news/2026/8/19/championship-2026-discover-big-ten-football-championship-game-information.aspx

**No 2026 tiebreaker document was found.** Treat everything below as the 2024 text carried
forward. The Big Ten's own 2025 scenario release numbers its steps in a way that matches this
document, so it was unchanged for 2025.

### 3.1 Who is in the game (verbatim)

> The Big Ten championship will be decided by a game played between the two teams with the best winning percentage in conference games following the regular season.

### 3.2 Section A, two teams tied (verbatim)

> A. If two teams are tied the following steps in Section A will be followed until a determination is made:
> 1. If two teams are tied for the No. 1 position in the standings, both teams will participate in the championship game and the winner of the game between the two teams shall be the first-place team. If the two teams tied for the No. 1 position did not play, move to step A.3 below to determine the first-place team.
> 2. If two teams are tied for the No. 2 position in the standings, the winner of the game between the two tied teams shall be the representative. If the two teams did not play, move to next step in tiebreaker.
> 3. The records of the two tied teams will be compared based on record against all common conference opponents.
> 4. The records of the two tied teams will be compared based on record against common opponents with the best conference record and proceeding through the common conference opponents based on their order of finish within the conference standings.
> 5. The records of the two tied teams will be compared based on the best cumulative conference winning percentage of all conference opponents:
> (a) In the event of an unbalanced schedule (i.e., less than nine conference games are played), the records of the two tied teams will be compared based on the best cumulative conference winning percentage of all conference opponents, regardless of how many conference opponents each team played. If winning percentage is equal for all conference opponents, move to next step in tiebreaker.
> 6. The representative will be chosen by the by the highest ranking by SportSource Analytics (team Rating Score metric) following the regular season.
> 7. Random draw among the tied teams conducted by Commissioner or designee.

### 3.3 Section B, three or more teams tied (verbatim)

> B. If three or more teams are tied for first place in the standings, the following steps in Section B will be followed until a determination is made.
>
> After the head-to-head competition among the tied teams, if a tiebreaker step produces standings with a clear No. 1 team by itself among the tied teams, that team is selected for the championship game and the remaining teams still in contention revert to the beginning of the applicable tiebreaker procedures (e.g., if there are three teams, the No. 1 team is in the championship game and the other two teams go to the first step of the two-team tiebreaker procedures; if there are four teams, the No. 1 team is in the championship game and the other three teams go to the first step of the three-team tiebreaker procedures, etc.).
>
> If a tiebreaker step produces results with two teams tied for No. 1, they are both selected for the championship game. To decide the ranking of the two teams, they will progress through the two-team tiebreaker procedures.
>
> If a tiebreaker step produces results with two teams tied for a position other than No. 1, the winner of the game between the two tied teams shall be the representative. If the two teams did not play, move to two-team tiebreaker above. If three or more teams remain tied after any step, move to next step in tiebreaker with remaining tied teams.
>
> If a tiebreaker step produces results with one team being eliminated from proceeding to the next step in the tiebreaker process, the team that is eliminated shall not be pulled back into the tiebreaker for any future step(s).
>
> If all teams involved in the tie are tied after any step, all teams will continue to the next step in the tiebreaker procedures.
>
> 1. The records of the three (or more) tied teams will be compared based on winning percentage in games among the tied teams:
> (a) If all teams involved in the tie did not play each other, but one team defeated all other teams involved in the tie, the team that defeated all other teams in the tie is removed from the tiebreaker, and the remaining teams revert to the beginning of the applicable tiebreaker process (i.e., two team or three or more team tie).
> (b) If all teams involved in the tie did not play each other and no team defeated all other teams involved in the tie, move to the next step in tiebreaker.
> 2. The records of the three (or more) tied teams will be compared based on winning percentage against all common conference opponents played by all other teams involved in the tie.
> 3. The records of the three (or more) tied teams will be compared based on winning percentage against the next highest placed common opponent in the standings in order of finish:
> 4. The records of the three (or more) tied teams will be compared based on the best cumulative conference winning percentage of all conference opponents:
> (a) In the event of an unbalanced schedule (i.e., less than nine conference games are played), the records of the three (or more) tied teams will be compared based on the best cumulative conference winning percentage of all conference opponents, regardless of how many conference opponents each team played. If winning percentage is equal for all conference opponents, move to next step in tiebreaker.
> 5. The representative will be chosen by the by the highest ranking by SportSource Analytics (team Rating Score metric) following the regular season.
> 6. Random draw among the tied teams conducted by Commissioner or designee.

(Step B.3 ends with a colon and nothing after it in the PDF. That is how it is published.)

### 3.4 Ineligible teams (verbatim)

> A team or teams that are not eligible to participate in a postseason football bowl game because of NCAA and/or Big Ten sanctions shall not be eligible to participate in the Big Ten Football Championship Game. If one or both Big Ten teams with the highest winning percentage after the regular season is ineligible to play in the Big Ten Championship Game, then the participant(s) in the Big Ten Championship Game shall be determined by the following procedure:
> a) If the ineligible team is tied for the No. 1 position in the standings, then the teams in the No. 2 and No. 3 position in the standings shall be the Big Ten Championship Game representatives.
> b) If two or more teams are tied with an ineligible team for the No. 1 or No. 2 position in the standings, then the ineligible team is removed and the remaining teams revert to the tiebreak procedure.

The document also has a "championship game cannot be played" section that reuses steps A.1 to
A.7 to pick the CFP automatic qualifier. Not relevant to who plays in the game.

### 3.5 Answers to the specific questions

- **Head-to-head with an incomplete round robin (3+ teams):** only one rule. A team that beat
  all the others is taken out as the winner of that pass and the rest revert to the start.
  There is **no** "lost to all the others is eliminated" rule, unlike the SEC and ACC. If
  nobody beat everybody, head-to-head is skipped entirely, even when some of the tied teams
  did play. The 2025 release shows this: with Michigan, Ohio State and Oregon tied at 8-1 and
  Michigan having beaten Ohio State, the conference recorded "Tiebreaker Step #1 No
  head-to-head among 3 tied teams" and moved on.
- **Common opponents:** "all common conference opponents played by all other teams involved
  in the tie", i.e. opponents every tied team played. Compared by winning percentage (Section
  B) or record (Section A).
- **Standings order:** "next highest placed common opponent in the standings in order of
  finish". No rule is published for common opponents who are themselves tied in the
  standings (the Big 12 and SEC both publish one; the Big Ten does not).
- **Opponents' winning percentage:** "best cumulative conference winning percentage of all
  conference opponents". With an unbalanced schedule, use all opponents each team actually
  played.
- **Analytics step:** SportSource Analytics "team Rating Score metric" after the regular
  season. In the 2025 release the conference reached B.4 and stopped there; I found no
  instance of this step being used.
- **Final step:** random draw by the Commissioner or designee.
- **Restart or continue:** both, depending on the outcome of the step. A clear No. 1 is
  selected and the rest **restart** at the first step of the procedure matching their number.
  If no one is selected, the survivors **continue** to the next step, and a team eliminated at
  a step stays out.
- **Second spot:** same procedure, restarted among the remaining teams. Two teams tied for
  No. 1 are both in, and Section A only orders them. The 2025 release applied the Section B
  steps to a three-way tie for *second* behind an outright leader, so Section B is not
  limited to ties for first despite its heading.
- **2026:** nine conference games, eighteen teams (bigten.org 2026 game page). On 2026-11-09
  the Big Ten announced that 2026 is the final championship game:
  https://bigten.org/news/2026/11/9/2026-marks-the-final-discover-big-ten-football-championship-game.aspx

### 3.6 Could not confirm (Big Ten)

- **That this text governs 2026.** No 2026 document, release or page with the procedure was
  found on bigten.org. The 2025 release (bigten.org/fb/article/58967/) is no longer live and
  the archive blocked my request for it; I read a republished copy.
- **What makes a team "eliminated" at a step.** The preamble refers to a step "with one team
  being eliminated" but never says what eliminates a team. Eleven Warriors paraphrases it as
  "If two or more teams are tied ahead of a given team for a given tiebreaker, that given team
  is eliminated". That is their wording, not the conference's.
- **Step B.1 when the tied teams did all play each other.** The text says only that winning
  percentage among them is "compared". What follows from a partial separation is governed
  only by the preamble paragraphs above.
- **Tied groups of common opponents in A.4 / B.3.** Not addressed.
- **Whether "cumulative" means pooled wins over pooled games or the mean of the opponents'
  percentages.** Identical when every team plays nine games.
- **Whether an opponent's record includes its game against the tied team.** Not addressed.

---

## 4. Big 12

**Source (official):** "Big 12 Football Tiebreaking Procedures", the file the conference's
"Tiebreaker Policies" page links to as the "complete tiebreaker procedures".
- Page (linked from the football menu on 2026-11-10; its text still says "2025 Edward Jones Big 12 Football Championship"):
  https://big12sports.com/sports/2024/9/6/FB_0906243427.aspx?path=football
- PDF (uploaded 2025-11-04; file is still named "2024"):
  https://big12sports.com/documents/2025/11/4//Big_12_Football_2024_Tiebreaker_Policy.pdf
- Earlier upload, 2024-09-05: https://s3.amazonaws.com/big12sports.com/documents/2024/9/5/Big_12_Football_2024_Tiebreaker_Policy.pdf

I compared the two PDFs. The only difference is the first sentence ("For the 2024 football
season" became "Beginning with the 2024 football season with 16 teams"). The steps are
identical, so the policy did **not** change for 2025. **No 2026 version was found.**

### 4.1 Who is in the game (verbatim)

> Beginning with the 2024 football season with 16 teams, the Big 12 Conference football schedule does not include a full round-robin play rotation. The goal for determining the participants is to seed the two teams with the best Conference winning percentage. [...]
>
> When two or more teams are tied for first or second place the tiebreaking procedures apply.

### 4.2 Two-team tie (verbatim)

> If two teams are tied for first place both teams will participate in the championship game and the winner of the game between the two teams shall be the #1 seed. If the two teams tied for the No. 1 position did not play, the two-team tiebreaking procedures shall apply to determine the first-place team
>
> If there is not a tie for first place, but two teams are tied for second place, the two-team tiebreaker policy will apply, and the winner will be the #2 seed.
>
> a. Head-to-head competition among the two tied teams.
> b. Win percentage against all common conference opponents among the tied teams.
> c. Win percentage against the next highest placed common opponent in the standings (based on the record in all games played within the Conference), proceeding through the standings. When arriving at another group of tied teams while comparing records, use each team's win percentage against the collective tied teams as a group (prior to that group's own tie-breaking procedure) rather than the performance against individual tied teams.
> d. Combined win percentage in conference games of conference opponents (i.e., the strength of conference schedule).
> e. Total number of wins in a 12-game season. The following conditions will apply to the calculation of the total number of wins: Only one win against a team from the NCAA Football Championship Subdivision or lower division will be counted annually. Any games that are exempted from counting against the annual maximum number of football contests per NCAA rules. (Current Bylaw 17.10.5.2.1) shall not be included.
> f. Highest ranking by SportSource Analytics (team Rating Score metric) following the last weekend of regular-season games.
> g. Coin toss

### 4.3 Multiple-team ties (verbatim)

> In the event of a tie between more than two teams, the following procedures will be used. After one team has an advantage and is "seeded", all remaining teams in the multiple-team tiebreaker will repeat the tie-breaking procedure. If at any point the multiple-team tie is reduced to two teams, the two-team tie-breaking procedure will be applied.
>
> a. The records of the three (or more) tied teams will be compared based on winning percentage in games among the tied teams:
> 1. If all teams involved in the tie did not play each other, but one team defeated all other teams involved in the tie, the team that defeated all other teams in the tie is removed from the tiebreaker, and the remaining teams revert to the beginning of the applicable tiebreaker process (i.e., two team or three or more team tie).
> 2. If all teams involved in the tie did not play each other and no team defeated all other teams involved in the tie, move to the next step in tiebreaker.
> b. The records of the three (or more) tied teams will be compared based on winning percentage against all common conference opponents played by all other teams involved in the tie.
> c. Record of the three (or more) tied teams against the next highest placed common opponent in the standings (based on the record in all games played within the conference), proceeding through the standings. When arriving at another group of tied teams while comparing records, use each team's win percentage against the collective tied teams as a group (prior to that group's own tie-breaking procedure) rather than the performance against individual tied teams.
> d. Record of the three (or more) tied teams based on combined win percentage in conference games of conference opponents (i.e., strength of conference schedule)
> e. Total number of wins in a 12-game season. [same conditions as two-team step e]
> f. Highest ranking by SportSource Analytics (team Rating Score metric) following the last weekend of regular-season games.
> g. Coin toss

### 4.4 Answers to the specific questions

- **Head-to-head with an incomplete round robin:** same single rule as the Big Ten (the
  wording is identical). Beat all the others and you are taken out as the winner; otherwise
  skip to common opponents. No "lost to all" elimination.
- **Common opponents:** "all common conference opponents played by all other teams involved
  in the tie".
- **Standings order and tied groups lower down:** go down the standings by conference record.
  When the next position is a group of tied teams, use each team's winning percentage against
  that whole group, taken *before* the group's own tie is broken. This is the opposite of the
  SEC, which first tries to order the group by head-to-head.
- **Opponents' winning percentage:** "Combined win percentage in conference games of
  conference opponents".
- **Total wins:** a step no other Power 4 league has. Counts all regular-season wins, with at
  most one win over an FCS-or-lower opponent, and excluding NCAA-exempt games.
- **Analytics step:** SportSource "team Rating Score metric" after the last regular-season
  weekend.
- **Final step:** coin toss.
- **Restart or continue:** restart. "After one team has an advantage and is 'seeded', all
  remaining teams in the multiple-team tiebreaker will repeat the tie-breaking procedure",
  dropping to the two-team procedure when two are left.
- **Second spot:** same procedure, repeated among the remaining teams. A two-way tie for
  first puts both in; the procedure only sets the seed.
- **2026:** sixteen teams, nine conference games each (AP, 2026-01-21:
  https://www.foxsports.com/articles/cfb/2026-big-12-football-schedule-features-notre-damebyu-2-games-in-europe-and-9-league-games-per-team).

### 4.5 Could not confirm (Big 12)

- **That this text governs 2026.** The official page has not been updated from "2025".
- **Whether any 2026 game between two Big 12 members is designated non-conference.** One
  search turned up none, but I did not check all sixteen schedules. If one exists, the policy's standard
  ("the record in all games played within the Conference") would have to be read against the
  conference's designation of that game; the policy itself does not address it.
- **Partial separation.** The policy speaks only of "one team" gaining an advantage. Whether
  teams that finish behind at a step are dropped before the repeat (as the SEC spells out) is
  not stated.
- **Step a when the tied teams did all play each other and are not separated cleanly.** Not
  addressed beyond "compared based on winning percentage".
- **Which games are "exempted" under Bylaw 17.10.5.2.1** for a given team in 2026.

---

## 5. SEC

**Source (official):** "Southeastern Conference Official Football Tiebreakers", 22 pages, file
name "SEC Football Tiebreakers Final 10.29.24.pdf", PDF dated 2024-10-29.
- Page (embeds that PDF as of 2026-11-10): https://www.secsports.com/fbtiebreaker
- PDF: https://storage.googleapis.com/secsports-prod/upload/2024/10/29/f6fc7cd9-3031-4357-8754-80bfa4b9c4c0.pdf
- Original announcement, August 2024: https://www.secsports.com/news/2024/08/sec-announces-football-tie-breaking-process

This is by far the most fully specified of the four. Every worked example in it uses an
eight-game schedule ("all 8 of their Conference opponents"). **The document has not been
revised for the nine-game schedule that starts in 2026.** Nothing in the procedure itself
depends on the number of games.

### 5.1 Criteria, in order (verbatim)

> In the event of a tie for a place in the Conference championship game, the following procedures will be used in the following order:
> A. Head-to-head competition among the tied teams
> B. Record versus all common Conference opponents among the tied teams
> C. Record against highest (best) placed common Conference opponent in the Conference standings, and proceeding through the Conference standings among the tied teams
> D. Cumulative Conference winning percentage of all Conference opponents among the tied teams
> E. Capped relative total scoring margin (see Appendix A) per SportSource Analytics versus all Conference opponents among the tied teams
> F. Random draw of the tied teams
>
> If a tiebreaker step produces standings with two teams tied for first place in the Conference, they are both selected for the championship game. To decide the seeding of the two teams, they will progress through the Two-Team tiebreaker procedures, which will determine home/away designation for the Conference Championship Game

The document then gives three separate procedures. Which one applies depends on how many
teams are tied and for which place.

### 5.2 Procedure 1: two teams tied for second place

A. Head-to-head.
B. Record versus all common conference opponents.
C. Record against the highest-placed common conference opponent, proceeding through the
   standings. When the highest remaining place holds two or more opponents who are tied with
   each other:
   - "The tie lower in the standings will only be broken if the tiebreaker procedure for
     Head-to-head competition can break the tie" (two tied opponents enter the two-team
     procedure, three or more enter the three-team procedure, but only its head-to-head step
     is used).
   - "If the Head-to-head tiebreaker procedure fails to break the tie between the teams lower
     in the standings, the records of the tied teams against these common opponents will be
     combined".
   - "If there are 3 or more opponents tied, but not all of them are common opponents, only
     the record against common opponents will be considered".
D. Cumulative conference winning percentage of all conference opponents.
E. Capped relative total scoring margin.
F. Random draw.

### 5.3 Procedure 2: three or more teams tied for first place

Governing paragraphs (verbatim):

> After the head-to-head competition among the tied teams, if a tiebreaker step produces standings with a clear No. 1 team by itself, that team is selected for the championship game and the remaining teams still in contention revert to the beginning of the applicable tiebreaker procedures (e.g., if there are three tied teams, the No. 1 team is in the championship game and the other two teams go to the first step of the two-team tiebreaker procedures for second place; if there are four teams, the No. 1 team is in the championship game and the other three teams go to the first step of the three-team tiebreaker procedures for second place, etc.).
>
> If a tiebreaker step produces standings with two teams tied for No. 1, they are both selected for the championship game. To decide the seeding (home/away) of the two teams in the Conference Championship Game, they will progress through the Two-Team tiebreaker procedures.
>
> If the standings produced by any tiebreaker procedure result in a tie at the top that is insufficient for assigning a championship game participant, but includes one or more teams ranked below the tied teams, the tied teams at the top of the standings will revert to the beginning of the tiebreaker procedures and all other teams are eliminated.

**A. Head-to-head**
1. Complete round robin (all tied teams played each other):
   a. One team has sole possession of the best record: it is selected. Two teams left go to
      the start of Procedure 1; more than two go to the start of Procedure 3.
   b. Two teams tied for the best record: both are selected.
   c. Three or more tied for the best record: those teams revert to the start of Procedure 2,
      and every team without the best record is eliminated.
2. Not a complete round robin:
   a. "If one team beat all the other tied teams, it is selected for the championship game,
      and the other remaining teams return to the start of the tiebreaker procedures for
      second place".
   b. "If one team lost to all the other tied teams, it is eliminated and the other teams
      return to the start of the applicable tiebreaker procedures, unless there are only two
      teams remaining, in which case they are both selected for the championship game".
   c. Neither: all tied teams advance to B.

**B. Record versus all common conference opponents**
1. One team has sole possession of the best record: selected. The rest return to the start
   (two teams to Procedure 1, three or more to Procedure 3).
2. Two teams tied for the best record: both selected.
3. Three or more tied for the best record: they revert to the start of Procedure 2; the rest
   are eliminated.

**C. Record against the highest-placed common conference opponent, down the standings**
1. Tied opponents at the same place are handled exactly as in Procedure 1 step C (order them
   by head-to-head only; if that fails combine the records against them; if not all of the
   tied opponents are common, use only the common ones).
2. One tied team has sole possession of the best record against the best-placed common
   opponent(s): selected; the rest return to the start of the applicable procedure.
3. Two tied for the best record: both selected.
4. Three or more tied for the best record: they revert to the start of Procedure 2; the rest
   are eliminated.
5. All tied teams have the same record: move to the next common opponent(s) by order of
   finish, "until all common Conference opponents are exhausted".

**D. Cumulative conference winning percentage of all conference opponents**
1. Clear first place: selected; the rest revert to the start of the applicable procedure
   ("i.e., Head-to-Head").
2. Two-team tie for first: both selected.
3. More than two tied for first with teams below: the leaders revert to the start; the rest
   are eliminated.
4. More than two tied for first and nobody below: advance to E.

**E. Capped relative total scoring margin**
1. "After determining the first-place team using this step in the procedure, the remaining
   tied teams still in contention will revert to the start of the tiebreaker procedures".

**F. Random draw** (see 5.5).

### 5.4 Procedure 3: three or more teams tied for second place

Governing paragraphs: a clear No. 1 at any step after head-to-head is selected; a tie at the
top with teams below sends the leaders back to the start and eliminates the rest.

**A. Head-to-head**
1. Complete round robin:
   a. Sole best record: selected.
   b. Two tied for the best record: they revert to the start of Procedure 1; all others are
      eliminated.
   c. Three or more tied for the best record "and there are teams below the best record":
      the leaders revert to the start of Procedure 3; all others are eliminated.
2. Not a complete round robin:
   a. One team beat all the others: selected.
   b. One team lost to all the others: eliminated; the rest revert to the start of the
      procedures for second place.
   c. Neither: advance to B.

**B. Record versus all common conference opponents**
1. Sole best record: selected.
2. Two tied for best: they revert to the start of Procedure 1; the rest are eliminated.
3. Three or more tied for best: they revert to the start of Procedure 3; the rest are
   eliminated.

**C. Highest-placed common opponent, down the standings**
1. Tied opponents handled as in Procedure 1 step C.
2. Sole best record: selected; the rest are eliminated.
3. Two tied for best: they revert to the start of Procedure 1; the rest are eliminated.
4. Three or more tied for best: they revert to the start of Procedure 3; the rest are
   eliminated.
5. All the same: next common opponent(s), until exhausted.

**D. Cumulative conference winning percentage of all conference opponents**
1. Clear first: selected.
2. Two or more tied for first: they revert to the start; all others are eliminated.
3. More than two tied for first and nobody below: advance to E.

**E. Capped relative total scoring margin.** **F. Random draw.**

"Commissioner's Authority: Authority to interpret all tiebreaking procedures is vested only
in the Commissioner or his/her designee."

### 5.5 Random draw (verbatim, identical in all three procedures)

> 1. Each tied institution's Athletics Director will join a videoconference, with the Commissioner or his/her Designee. During the videoconference, each tied institution's name will be visibly placed into a drawing.
> 2. If there are two or more teams tied for one spot in the Conference Championship Game, then the Commissioner or his/her Designee will draw one name. The first name that is drawn wins the random draw and is placed in the Conference Championship Game as the away team.
> 3. If there are three or more teams tied for two spots in the Conference Championship Game, and a random draw is needed to determine both participants in the SEC Championship Game, then the Commissioner or his/her Designee will draw two names. The first name drawn is placed in the Conference Championship Game and will be the home team. The second name drawn is also placed in the Conference Championship Game and will be the away team.

### 5.6 Appendix A: capped relative scoring margin (verbatim)

> 1. At the end of the season, the score of each Conference game will be evaluated based on both teams' average scoring offense and defense. For both teams in each game, the Conference will calculate the relative scoring offense percentage and the relative scoring defense percentage, then calculate the margin (difference). This will then be averaged for each team across all its Conference games.
> 2. For each Conference game, the highest relative scoring offense percentage that can be achieved is 200%, and the lowest relative scoring defense percentage that can be achieved is 0%.

Worked example from the appendix: Team A beats Team B 31-28. Team B "averaged 24 points
scored per game for the season" and "21 points allowed per game for the season". Team A's
relative offense is 31/21 x 100 = 147.6%. Its relative defense is 28/24 x 100 = 116.7%.
Margin for that game is offense minus defense, +30.9%. Average that over all of Team A's
conference games. "if Team A had scored more than 42 points, their relative offensive scoring
percentage would exceed 200%. Due to the built-in cap, their offensive percentage would be
designated as 200% for the game." "On the defensive side, the best possible score is 0% (not
allowing any points), so no cap is required."

So, for team T against opponent O in one conference game:

```
off  = min(200, 100 * points_T / O_avg_points_allowed)
def  =          100 * points_O / O_avg_points_scored
game = off - def
metric(T) = mean of game over T's conference games      (higher is better)
```

### 5.7 Worked examples the document gives that settle a reading

- **Opponents' winning percentage (D) is the mean of the opponents' percentages:** "the
  average will be calculated from the winning percentage of all 8 of their Conference
  opponents".
- **A tie for second among B, C, with A alone in first:** B played A, C did not, so A is not a
  common opponent and is skipped. This confirms step C uses only opponents every tied team
  played.
- **Tied common opponents D and E, D beat E:** D is ranked above E and only the record
  against D is used.
- **Tied common opponents D and E, head-to-head cannot separate them:** combine the records
  against both.
- **D and E tied but only D is common:** use D only.
- **Three-way tie for first, A lost to B and C (incomplete round robin):** A is eliminated
  and B and C are both in; the two-team procedure sets home and away.
- **Four-way tie for first, records vs the one common opponent 1-0, 1-0, 1-0, 0-1:** the 0-1
  team is eliminated and the other three restart Procedure 2.
- **Four-way tie for first, records vs common opponents 2-0, 1-1, 1-1, 0-2:** the 2-0 team is
  in; the other three (including the 0-2 team) restart Procedure 3. A team is *not*
  eliminated merely for finishing last at a step when there is a sole leader.

### 5.8 Answers to the specific questions

- **Restart or continue:** restart, almost always. Whenever a step selects or eliminates
  anyone, the survivors go back to step A of whichever procedure fits their number and the
  place still open. They move to the next step only when the step leaves every team level.
- **Second spot:** Procedure 2 fills the first spot and hands the rest to Procedure 1 or 3.
  Two teams tied at the top of any step in Procedure 2 are both in. In Procedure 3 only one
  spot is open, so a two-way tie at the top goes to Procedure 1 instead.
- **2026:** sixteen teams, nine conference games each, first season of that format
  (https://fbschedules.com/2026-sec-football-schedule-announced/, read as a search summary,
  not opened).

### 5.9 Could not confirm (SEC)

- **Any revision for the nine-game schedule.** None found; the official page still embeds the
  10.29.24 file.
- **Appendix A inputs.** "Averaged ... per game for the season" does not say whether the
  opponent's averages are over all games or conference games only. The metric is also stated
  to be "per SportSource Analytics", so the official figure is theirs; the formula above
  reproduces the published method but is not guaranteed to match their number.
- **Appendix A edge case:** an opponent whose average points allowed or scored is zero.
- **Procedure 2 step E** says what happens "after determining the first-place team" but not
  what happens if the metric leaves two teams exactly level.
- **Procedure 1 has no branch text** for step C sub-outcomes; it is a straight two-team
  comparison, so none is needed.
- **Whether any 2026 SEC-vs-SEC game is designated non-conference.** Not checked; the policy
  does not mention the case.

---

## 6. What is computable from results alone

"Results" means every game's two teams, final score, and whether it is a conference game.

| Step | ACC | Big Ten | Big 12 | SEC |
|---|---|---|---|---|
| Conference winning percentage | results | results | results | results |
| Head-to-head (incl. beat-all / lost-to-all) | results | results | results | results |
| Record vs common opponents | not used | results | results | results |
| Common opponents in standings order | not used | results | results | results (needs the tied-opponent sub-rule in 5.2 C) |
| Opponents' conference winning percentage | not used | results | results | results |
| Total wins in a 12-game season | not used | not used | results **plus** each opponent's subdivision (FCS or lower) and which games are NCAA-exempt | not used |
| Analytics step | **outside:** SportSource Team Success Ranking | **outside:** SportSource team Rating Score | **outside:** SportSource team Rating Score | scores, via the published Appendix A formula; official value is SportSource's |
| Last step | random | random | random | random |
| Eligibility | **outside:** postseason-eligibility flag | **outside:** bowl-ineligible by NCAA or Big Ten sanction | not stated in the policy | not stated in the policy |

The ACC is the extreme case: once head-to-head fails, the only remaining criterion before the
draw is a number that is not published with the policy. A simulation of the ACC race cannot
be exact without that ranking or a stand-in for it.

---

## 7. Group of 6

Briefer, as asked. Each is from the conference's own document unless stated.

### American

Top two by conference winning percentage ("The two teams that complete the conference season
with the highest winning percentages"); eight conference games per team ("Each team will not
play five other conference teams"); a team must have played at least seven to be considered
in a tiebreak. A two-way tie for first puts both in. **Two-team tie for second:** (1)
head-to-head; (2) if one tied team is in the latest CFP rankings and does not lose on the
final weekend, it is in; if it loses, or neither is ranked, a composite average of "Connolly
SP+, SportSource TR116 Team Strength Ranking, ESPN SOR, KPI" decides; if both are ranked, the
higher-ranked one that does not lose; (3) winning percentage against all common conference
opponents; then overall winning percentage excluding exempt games; then coin toss.
**Multi-team:** mini round robin (teams stay tied unless they all played or one beat all the
others), then the same CFP and composite steps, common opponents, overall percentage,
drawing; drops to the two-team procedure when two remain.
Source: Section 10 of the football manual, PDF dated 2026-09-30, linked as "Tiebreaker
Policies" in the football menu: https://theamerican.org/documents/2026/9/30/26_FB_Tiebreakers.pdf

### Conference USA

"The top two teams with the highest conference winning percentage at the end of the regular
season". Teams that are not bowl eligible "(due to transition status, NCAA sanctions, etc.)"
cannot play in the game. One six-step list for all ties: (1) head-to-head; (2) winning
percentage against common conference opponents; (3) record against the common opponent(s)
with the best conference record, working down the standings; (4) average ranking across
Connelly SP+, SportSource Analytics, ESPN SOR and KPI; (5) opponents' combined conference
winning percentage; (6) coin toss. When a group of tied teams is met in the standings, use
the record against the whole group; if those records are equal or the games unequal, go to
the next percentage down. "If at any point the tie is broken in a multiple team tie, the
remaining teams will begin the process again at step #1."
Source: Football Regulations page, linked as "Tiebreaker Policy" in the football menu on
2026-11-10; PDF last modified 2025-11-16 despite the 2024 path:
https://s3.amazonaws.com/sidearm.sites/conferenceusa.com/documents/2024/9/19/CUSA_FB_Championship_Game_Tiebreaker_Policy.pdf
*Not confirmed:* that no newer version exists for 2026; which 2026 members are in transition
and therefore excluded.

### MAC

No divisions. "The participating teams shall be decided by conference winning percentage."
**Two teams:** (1) head-to-head; (2) winning percentage versus all common opponents; (3)
higher SportSource Analytics Team Rating Score; (4) common opponents by order of finish; (5)
combined conference winning percentage of conference opponents; (6) draw. **More than two:**
(1) combined head-to-head winning percentage if all tied teams played each other; (2) if they
did not, a tied team that beat each of the others advances; (3) winning percentage versus all
common opponents; (4) Team Rating Score; then as above.
Source: https://getsomemaction.com/sports/2025/11/12/FB_1112255434.aspx (page created
2025-11-12, live on 2026-11-10). 2026 game: December 5, Ford Field, "the top two teams in the
conference standings based on winning percentage"
(https://getsomemaction.com/news/2026/3/24/2026-mac-football-schedule-released.aspx, via
search summary).
*Not confirmed:* that this page was reissued for 2026; whether Sacramento State, in its first
season as a football-only member, is eligible for the game.

### Mountain West

"The two (2) eligible teams that complete the Conference regular season with the highest
Conference winning percentages". The 2026 document applies **CFP-Ranked Team Tiebreaker
Immunity** before anything else (I did not compare it with the 2025 text, so I cannot say
whether this is new): the highest-ranked tied team in the CFP rankings of Tuesday
2026-11-24 gets the spot (and hosts, if tied for first) provided it wins its final
regular-season game; one team at most, considered once. **Then, two teams:** (1)
head-to-head; (2) the higher CFP-ranked team that won its last game, otherwise the lower
equally weighted average rank across Connelly SP+, ESPN SOR, KPI and SportSource; (3) overall
winning percentage, counting at most one FCS win; then record against the next-highest-placed
team or tied group, common opponents, coin toss. **Three or more:** (1) mini round robin, in
which a team that beat all the others advances and a team that lost to all the others is
eliminated, restarting at step 1; (2) CFP rank or composite; (3) overall percentage; and so
on. An ineligible team is removed before any step.
Source: PDF dated 2026-10-12, linked as "Championship Tiebreakers" in the football menu:
https://themw.com/documents/2026/10/12/MW_Football_Championship_Tiebreaking_Procedures.pdf
*Not confirmed from an official source:* the 2026 football membership (FBSchedules lists Air
Force, Hawaii, Nevada, New Mexico, North Dakota State, Northern Illinois, San Jose State,
UNLV, UTEP, Wyoming) and whether North Dakota State is eligible (a Wikipedia mirror says not
until 2028).

### Pac-12

**2026 football members (eight):** Boise State, Colorado State, Fresno State, Oregon State,
San Diego State, Texas State, Utah State, Washington State. **It does hold a title game:**
Friday 2026-12-04, at the home stadium of the highest seed, between "the top two eligible
teams in the final regular-season standings". The conference schedule is a seven-game round
robin in weeks 5 to 12; the week 13 "home-and-home flex matchup ... will not count toward
conference standings". **Two-team tie:** (1) head-to-head; (2) winning percentage against the
next-highest-placed common opponent, down the standings, treating a tied group collectively;
(3) winning percentage against all common conference opponents; (4) highest CFP ranking on
the Tuesday before week 13; (5) SportSource team Rating Score; (6) coin toss. **Multi-team:**
(1) head-to-head by cumulative winning percentage among the tied teams; (2) common opponents;
(3) next-highest-placed common opponent; (4) opponents' combined conference winning
percentage; (5) SportSource Team Rating Score; (6) coin toss. Once a team is seeded the rest
restart; two left go to the two-team procedure.
Source: Pac-12 release, 2026-09-03:
https://pac-12.com/news/2026/9/3/pac-12-announces-commercial-and-operational-updates-ahead-of-its-2026-football-season-kickoff.aspx
Member list from the same release ("its eight programs") and
https://fbschedules.com/2026-pac-12-football-schedule-announced/.
Note the two lists put common opponents and standings order in opposite orders; that is how
they are published.

### Sun Belt

**Confirmed: still two seven-team divisions** (secondary coverage calls it the only FBS
league that still has them; I did not verify "only"). East: App State, Coastal
Carolina, Georgia Southern, Georgia State, James Madison, Marshall, Old Dominion. West:
Arkansas State, Louisiana, LA Tech, ULM, South Alabama, Southern Miss, Troy. The title game is
"between the east and west division champions", and a division champion is "the team with the
highest winning percentage in all conference games both divisional and non-divisional". It is
played at the home of the division champion with the better conference percentage. **Two-team
tie for a division:** (1) head-to-head; (2) divisional winning percentage; (3) record against
the next-highest team in the division, working down, tied groups taken collectively; then
common non-divisional opponents, CFP ranking or a composite of SportSource, KPI, SP+ and ESPN
SOR, overall percentage against FBS teams, coin toss. **Three or more:** (1) winning
percentage in games among the tied teams; (2) divisional percentage; (3) next-highest in the
division; then as above, ending in a draw. The multi-team procedure runs straight down
without reverting to the two-team list.
Source: https://sunbeltsports.org/sports/2018/8/30/FB_Tie-Breakers.aspx (the URL is dated
2018 but the page lists LA Tech, so it has been updated for 2026; it is the "Tiebreakers"
link in the football menu).

---

## 8. Cross-cutting implementation notes

These are readings, not published text.

1. **Three different restart models.** ACC: always restart from the definition of the tied
   teams. Big 12: restart after a team is seeded. Big Ten and SEC: restart when a step selects
   or eliminates someone, continue to the next step when it leaves everyone level. One shared
   loop will not fit all four.
2. **"Lost to all the others" exists only in the ACC and SEC.** Applying it to the Big Ten or
   Big 12 would be an invention.
3. **Tied groups of common opponents are handled three ways.** Big 12: treat the group as
   one, before its own tie is broken. SEC: try head-to-head to order the group, and only if
   that fails combine. Big Ten: silent.
4. **"Common opponent" always means played by every tied team.** The SEC examples confirm it
   and the Big Ten and Big 12 say "played by all other teams involved in the tie".
5. **The tied teams' games against each other** are not excluded from opponents' winning
   percentage by any of the three policies that use it. None says either way.
6. **Two teams tied for first are both in everywhere.** The two-team list then only sets
   seed, or home and away in the SEC.
7. **A tie game** is not mentioned by any Power 4 policy (overtime makes it impossible in
   practice). The Sun Belt and Mountain West count one as half a win and half a loss.
8. **Before trusting the Big Ten or Big 12 sections for 2026,** look for a conference release
   in the last two weeks of November. Both leagues published scenario releases at that point
   in 2025, and that is where a changed procedure would show.
