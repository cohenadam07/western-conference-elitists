# College Football Savant: the stat expansion catalog

*Nov 10, 2026. Measured on Adam's Mac against the raw play-by-play, the play-participant files and the box scores. Nothing is built yet. This is the menu for College Football Savant 1.1.*

## Where 1.0.0 stands

- **68 player stats** today. By position: QB 14, RB 7, WR 8, TE 8, defense 26, K/P 3, plus garbage-time share rows.
- **Football Savant's QB card has about 80 stats** in 14 groups (Josh Allen, 2025), and its edge card has about 40.

The gap has two causes:
1. **Much of what Football Savant shows comes from NFL tracking and charting data** (Next Gen Stats, PFR charting) that college football doesn't have.
2. **1.0.0 left a lot of free play-by-play unused.** That part is fixable.

## The big finding: ESPN started charting college games in late 2025

From **week 9 of 2025** onward (96% of plays from then on, and 96% of 2026 games), ESPN's college play text switched to a fully charted format, for example:

> `No Huddle-Shotgun #1 J.Craig pass incomplete short middle to #88 K.Pimpton thrown to UNC01 QB hurried by #11 J.Harvey`
>
> `Shotgun #2 W.Jordan rush right for 9 yards gain to the USC32 (#4 D.Lee)`

Every play now carries:
- **Formation:** shotgun or under center.
- **Tempo:** no-huddle.
- **Pass depth and direction:** short or deep; left, middle or right.
- **Where the ball was caught or thrown to:** this gives air yards and yards after the catch, on completions and incompletions alike.
- **Run direction:** left, middle or right.
- **Who hurried the QB.**
- **Who broke up the pass.**
- **Tacklers:** named on 63% of plays, with assisted tackles marked on 18%.
- **Penalized players.**
- **Returners.**

Measured share of non-sack passes with depth and direction:

| Seasons | Share |
|---|---|
| 2014–2024 | 0% |
| 2025 weeks 1–8 | about 1% |
| 2025 weeks 9–16 | 90–96% |
| 2026 | 96.3% |

So a second, Football Savant-style layer is possible from late 2025 on. It would be labeled "tracked from 2025 week 9", the same way Football Savant handles stats that start in later seasons.

---

## Tier A: new stats from data every season already has (2014 on)

No new source needed. These come from play-by-play fields, the play-participant files (tacklers, penalized player, returner, forced-by, recoverer) and box scores that 1.0.0 already downloads.

### Quarterbacks
- **Passer rating, ANY/A** (adjusted net yards per attempt), **TD rate** and **first-down rate**.
- **Situational:**
  - third- and fourth-down conversion
  - red-zone TD rate
  - short-yardage conversion
  - two-minute drill EPA
  - EPA when the game is in doubt
  - middle-8 EPA (the last 4 minutes of the first half and the first 4 of the second)
- **Drives:**
  - points per drive
  - touchdown-drive rate
  - three-and-out rate
- **Value:**
  - total EPA
  - win probability added
  - touchdowns over expected (expected TDs from where each play started)
- **Rushing:**
  - first-down rate on runs
  - fumble rate
  - sneak and short-yardage conversion
- **Pass rate over expected** for his team (`xpass` is already in the data). This goes in CONTEXT.

### Running backs
- **Where the yards come from,** Connelly's split, already computed per play:
  - **line yards:** yards credited to the offensive line
  - **second-level yards:** 5–10 yards past the line
  - **open-field yards:** 10+ yards past the line
  - **highlight yards per opportunity**
- **Opportunity rate:** the share of runs reaching 4+ yards.
- **Power success:** conversions on 3rd/4th-and-short and at the goal line.
- **Touches:** red-zone and goal-line carry share, touchdowns over expected, first-down rate, fumble rate.
- **Receiving:** targets per game, yards per route proxy, YAC once charting is available (Tier B).

### Receivers and tight ends
- First-down rate per target.
- Red-zone and end-zone target share.
- Touchdowns over expected.
- Third-down target share ("go-to" usage).
- Win probability added.

### Defenders (honest about pre-2024 stat crews, as in 1.0.0)
- **Solo vs assisted tackles:** assists are named in participant data from 2014. Same completeness caveat as today.
- **Tackles for loss split** into run and pass.
- **Sack value:** EPA per sack, yards lost per sack, third-down sacks, strip sacks.
- **Turnovers created:** interception return yards and EPA; fumble recoveries.
- **Penalties per game,** from the named penalized player, every season.
- **Havoc share:** his share of his team's havoc plays.

### Special teams: entirely missing in 1.0.0
- **Kick and punt returners:**
  - return EPA, yards per return
  - 20+ yard return rate
  - return touchdowns
  - fair-catch rate, muffs
- **Kickers:**
  - FG over expected (1.0.0 has this)
  - long-range FG rate
  - kickoff touchback rate and EPA
- **Punters:**
  - net EPA (1.0.0 has this)
  - inside-20 rate
  - touchback rate
  - return yards allowed
- An **all-purpose / returner slot** on the card. All-Savant already has the all-purpose slot.

### Everyone
- **Per-player penalties.**
- **Career trajectory:** percentile by year, by class.
- **Production vs recruiting rank:** who outplays his stars.
- **Transfer before/after:** the same player's numbers at each school.

### Team page (toward Football Savant team-profile parity)
- **Offense:**
  - pace (seconds per play)
  - pass rate over expected
  - early-down pass rate
  - drive stats
  - points per scoring opportunity
  - explosive-play rate by type
- **Defense:**
  - **what it allows to each position:** QB, RB, WR, TE production allowed, opponent-adjusted
  - explosives allowed
  - line yards and stuff rate allowed
  - havoc
- **Decisions,** which also feed the future College Football Coaching Savant:
  - **fourth-down go rate over expected** (`go_boost` and the recommendation are already in the data)
  - two-point decisions
  - timeout use
- **Special teams by phase:** kickoff, kick return, punt, punt return, FG. EPA for each.
- **Situational:** red-zone, third-down, two-minute, middle-8, field position, turnover luck (exists).

---

## Tier B: the charting layer (2025 week 9 on, labeled as such)

### Quarterbacks
- **Shot selection:**
  - average depth of target (aDOT)
  - deep-throw rate (passes charted "deep")
  - behind-the-line throw rate (screen proxy)
  - throw direction mix
- **By depth:** completion % and yards per attempt behind the line, 0–9, 10–19 and 20+ air yards.
- **Real CPOE:** a WCE completion model on air yards, direction and down/distance. Today's CPOE has no air yards and stays CONTEXT.
- **YAC:** share of yards after the catch, and completed air yards per attempt.
- **Pressure:**
  - **hurry rate faced:** hurries plus sacks per dropback, college's pressure stand-in
  - **pressure-to-sack rate**
  - **EPA per dropback when hurried vs clean**
- **Formation and tempo:**
  - shotgun rate and under-center rate, with EPA from each
  - no-huddle rate and EPA

### Running backs
- **Run-direction mix** (left, middle, right) and **success by direction**.
- **Shotgun vs under-center rushing efficiency.**
- Receiving: aDOT, YAC per catch.

### Receivers and tight ends
- **Opportunity:**
  - aDOT
  - air-yards share
  - an opportunity score blending target share and air-yards share (WOPR, the fantasy-world standard)
- **After the catch:** YAC per reception, **YAC over expected** (WCE model), deep-target share.
- **Efficiency by depth:** catch rate and EPA per target, short vs deep.
- **Where he wins:** target direction mix (left, middle, right).

### Defenders
- **Pass rush:**
  - **hurries** and **pressures** (hurries plus sacks) per game and per opponent dropback
  - **share of team pressures**
  - **pressure-to-sack rate**
- **Run defense:** **average depth of tackle** (yards from the line where he made it), run-stop rate.
- **Coverage (partial):** passes broken up per opponent dropback, and **air yards and EPA on throws where he's the named breakup or tackler.** This is labeled "credited coverage". It still can't see the corner who was never thrown at.

### Offensive line unit
- **Hurry rate and sack rate allowed.**
- **Run success and line yards by direction**, which tells you which side of the line moves people.
- **Shotgun vs under-center splits.**

### Team page
- Pressure rate generated and allowed.
- aDOT, YAC and deep passes allowed.
- Run defense by direction.
- Formation and tempo identity.

---

## Tier C: not possible with free college data

Listed so the page can say so, the way Football Savant's "what the page can't see" note does:
- time to throw and pocket time
- true pressure, beyond credited hurries
- play-action, RPO, screen tags (only the behind-the-line proxy above)
- man vs zone, blitz
- drops, on-target throws
- routes run and yards per route run
- **snap counts and snap share**
- missed tackles
- targets allowed in coverage
- on/off splits (no participation data)
- PFF-style grades
- scrambles vs designed runs (no tag)

**Athletic testing** exists only for players who reached the NFL combine. Football Savant already has it, and 1.0.0 already links 4,360 college players to their Football Savant cards, so the card can show combine numbers for those players and say so.

---

## College-only features Football Savant doesn't have

1. **NFL translation.**
   - "College profiles most like his among players who made the NFL", with how those players did. It uses the 4,360 college-to-NFL links.
   - A draft-day view during the season.
2. **Production vs pedigree.** Percentile production against recruiting rank: who's outplaying his stars, and who isn't.
3. **Transfer impact.** Before and after for every transfer, plus a team "portal haul" value.
4. **Devy fantasy** (optional). College fantasy points and expected fantasy points per game for devy and campus leagues.

---

## What has to be proven first

Same rule as 1.0.0: a stat gets a full bar only if the split-half test says it's real.
- **Tier A** stats run through the existing backtest on 2014–2025.
- **Tier B** has one season and a half of history, so its settle points come from 2026 plus late 2025, measured split-half within the season.
  - Settle points are re-measured each season.
  - The labels carry an expiration ("tracked from 2025 week 9; settle points will firm up as seasons accumulate").
- The charting depends on ESPN's feed staying in the new format. The refresh heartbeat should alarm if the depth/direction share drops below 90% on any game day.

## Rough size

| Tier | New player stats | New team stats |
|---|---|---|
| A | about 45 | about 30 |
| B | about 40 | about 15 |

Together that takes the QB card from 14 stats to roughly 50, and every position to Football Savant-like depth where free data allows.
