# Football Savant — metric research

Groundwork for `public/football-savant.html`, the successor to Basketball Savant.
This document is the *why* behind the metric table that ships in the tool: what the
football measurement landscape actually looks like, which numbers survive contact with
a small sample, and which of them we can honestly compute from open data.

---

## 1. What carries over from Basketball Savant

Basketball Savant's core argument is that a raw number means nothing until you know
three things about it:

| Idea | How Basketball Savant expresses it | Football translation |
|---|---|---|
| **Rank, not value** | every bar is a percentile against a qualified population | same — but the population *must* be positional, because a football league-wide percentile is meaningless |
| **Layer** | `ingredient` / `output` / `expected` / `context` tags on every row | same taxonomy; football has more `expected` metrics (xYAC, xComp, RYOE) than basketball does |
| **Sample honesty** | `thr` per metric; below it the bar is hatched "stabilizing" | football samples are *an order of magnitude smaller* — a full NFL season is ~17 games. This matters more here, not less |
| **Era gating** | `tier`/`since` hides a metric in seasons that never tracked it | football's tracking eras are sharper: 1999 / 2012 / 2016 / 2018 |
| **Volume as context** | minutes-per-game band + minutes share | snap counts, snap share, route/dropback/coverage volume |

The single biggest structural difference: **basketball is one position problem, football is
eleven**. Basketball Savant can show one metric table to every player because a center and a
point guard still both shoot, pass and rebound. A cornerback and a center share *no* box score
at all. So Football Savant's metric table has to be **position-scoped**, and its comparison
population has to be position-scoped by default rather than as a toggle.

---

## 2. The three families of football number

Everything below falls into one of three buckets. Mixing them without labelling them is the
most common way football stats lie.

**A. Volume / opportunity.** Carries, targets, dropbacks, snaps, routes, coverage snaps,
pass-rush snaps. Not skill. But it is the denominator of everything else and the thing most
correlated with fantasy and with contract value, so it belongs on the page as `context`.

**B. Efficiency / rate.** Yards per attempt, EPA per play, success rate, pressure rate,
yards per coverage snap. This is where most real signal lives.

**C. Over-expected.** A model predicts what an average player would have done with the same
inputs; the metric is the residual. CPOE, RYOE, YAC over expected, FG over expected. These
isolate the player from his situation better than anything else — and they are also the most
model-dependent, so they deserve to be labelled as modelled, not measured.

Basketball Savant already has a word for each of these (`ingredient`, `output`, `expected`).
The taxonomy transfers cleanly.

---

## 3. Universal / cross-position

| Metric | What it is | Read |
|---|---|---|
| **EPA per play** | expected points added, from a model of down/distance/field position/time | the closest thing football has to a common currency. Works for any player who touches the ball |
| **Success rate** | share of plays gaining ≥40% of yards-to-go on 1st, ≥60% on 2nd, 100% on 3rd/4th | the "did this play keep us on schedule" metric. EPA's partner: EPA is *how much*, success rate is *how often* |
| **Snaps / snap share** | plays on the field, and share of team plays | football's minutes. Availability and role in one number |
| **Availability** | games played / games possible | football's most undervalued stat. Positional injury rates differ enormously |
| **Penalties** | flags and yards | small but real, and one of the few stable individual negatives (see the Open Source Football penalty stability work) |
| **Approximate Value (AV)** | Pro-Football-Reference's single-number career currency | crude, but the only long-history all-position number that exists |
| **DVOA / DYAR** | Football Outsiders / FTN: value per play vs. league baseline, opponent-adjusted (DVOA) and its cumulative form (DYAR) | the definitive rate-vs-total pairing. DVOA = per play, DYAR = total. A backup with three great games has high DVOA, small DYAR |
| **PFF WAR / grades** | −2..+2 per play, rolled to 0–100 and to a wins value | the most widely cited all-position evaluation. Licensed — not open data |

**Positional value** context worth putting on the page: after QB, the highest average WAR
sits at WR, DB and TE; RB is the clearest market-vs-value gap in the other direction. A
percentile is *within position*, so the page should never imply a 90th-percentile RB and a
90th-percentile QB are equally valuable.

---

## 4. Quarterback

The best-measured position in the sport. Roughly in order of how much analysts trust them:

**Core**
- **EPA per dropback** — includes sacks and scrambles, which is why it beats any passing-only rate.
- **CPOE** (completion % over expected) — models each throw's difficulty from air distance,
  sideline distance, receiver separation, pressure distance, and time to throw. **Stickier
  year-to-year than EPA** (~0.41 y/y in the early tracking seasons vs ~0.3 for rushing EPA).
- **EPA + CPOE composite** — the standard blend: EPA supplies value, CPOE supplies the
  accuracy signal that survives into next season. This is the single best public QB number.
- **ANY/A** (adjusted net yards per attempt) — `(yds + 20·TD − 45·INT − sack yds) / (att + sacks)`.
  Pre-tracking-era compatible and still correlates hard with winning.
- **Success rate** on dropbacks.
- **ESPN Total QBR** — 0–100, play-level, opponent- and situation-adjusted, splits credit
  between QB and teammates and weights for clutch. Divisive but genuinely different from EPA.

**Style / ingredient**
- **aDOT** and **intended air yards per attempt** — how far downfield he's actually trying to go.
- **Air yards to sticks** — intended depth relative to the first-down marker. Reveals checkdown QBs.
- **Time to throw** — the master variable behind sack rate, pressure rate and aDOT.
- **Aggressiveness** (NGS) — share of throws into tight coverage (defender within 1 yard).
- **Play-action rate and PA yardage**; **RPO rate**.
- **Scramble rate**, **rushing EPA**, **designed-run share** — mobility is a real part of the job now.

**Pressure and protection (the QB's own share of it)**
- **Pressure rate** and **times blitzed / hurried / hit** (PFR charting).
- **Sack rate** — much more a QB stat than an OL stat; time-to-throw drives it.
- **Pocket time** — average seconds until throw/sack/scramble.
- **Clean pocket vs. under pressure splits** — critical finding: *clean-pocket* performance is
  stable year to year, *under-pressure* performance is volatile. Read pressure splits as a
  description of a season, not a prediction of the next one.

**Accuracy (charting)**
- **Bad throw %** and **on-target %** (PFR) — throwaways and spikes excluded.
- **Drop %** on his own passes — the correction that makes completion % fair.
- **Turnover-worthy play rate** and **big-time throw rate** (PFF, licensed) — the best public-facing
  pair of "how often did he risk it / how often did it pay".

**Legacy**
- **Passer rating** — bounded 0–158.3, over-weights completions, ignores sacks and rushing.
  Keep it as a familiar anchor, never as an argument.

**Sample:** analysts conventionally require **100+ attempts** in a season before reading a QB
rate at all. Rate metrics on <150 dropbacks belong hatched.

---

## 5. Running back

The position where the box score lies hardest, because line quality dominates.

- **RYOE / rush yards over expected per attempt** (NGS) — expected yards from the tracking-derived
  positions of every blocker and defender at handoff; the residual is the back. The single best
  attempt at separating runner from blocking.
- **Yards before contact / attempt (YBC)** — that's the offensive line's number, not his.
- **Yards after contact / attempt (YAC)** — that *is* his, and it's sticky.
- **Broken/missed tackles forced**, and **attempts per broken tackle** — the other sticky one.
- **Rushing success rate** — the essential companion to RYOE: a back can post big RYOE off three
  breakaways while most carries die. High RYOE + low success rate = boom/bust, and you should
  be able to see that shape on the page.
- **EPA per rush** — noisy (y/y r ≈ 0.30), keep it labelled as such.
- **Explosive run rate** (10+, 20+, 40+) and **stuff rate** (≤0 yards).
- **8+ defenders in the box %** (NGS) — pure context: heavy boxes mean his numbers were earned harder.
- **Time behind line of scrimmage** (NGS) — decisiveness.
- **Receiving work**: targets, target share, receiving EPA, YAC. The modern separator between a
  two-down back and a starter.
- **Pass-blocking** — real, and essentially unavailable outside PFF.

---

## 6. Wide receiver and tight end

**The gold standard is per-route, not per-target.**

- **YPRR** (yards per route run) — the best simple receiver number in existence. Its denominator
  (routes) is large and stable, so it isn't hostage to how often the QB happened to look his way.
- **TPRR** (targets per route run) — **the stickiest of the three**: it stabilizes in ~7 games /
  ~185 routes. Yards per target, by contrast, needs ~205 targets (≈39 games) to be half skill.
  So: TPRR ≫ YPRR ≫ YPT in how fast they become meaningful.
- **Routes run** and **route participation %** — the volume denominator, and a role tell.

Routes run are PFF/charting data and are **not in open nflverse data**. Where routes aren't
available, the honest substitutes are per-snap and per-team-attempt rates, clearly labelled.

**Open-data receiving metrics that do work**
- **Target share** and **air yards share**.
- **WOPR** — weighted opportunity rating, `1.5·target share + 0.7·air yards share`. The best
  single opportunity number available publicly.
- **RACR** — receiving yards / air yards. Efficiency of turning intended depth into real yards.
- **aDOT** — average depth of target; the role descriptor that reframes everything else.
- **Receiving EPA** and **EPA per target**.
- **YAC and YAC over expected** (NGS) — xYAC models the field at catch point; the residual is him.
- **Average separation** and **average cushion** (NGS) — how open he gets, and how much respect
  he's given pre-snap. Read together: big cushion + big separation is a different player from
  small cushion + big separation.
- **Catch rate** and **drop %** — drops are charted (PFR), and drop rate is noisier than fans think.
- **Contested-catch rate** and **broken tackles after catch** (PFR `brk_tkl`).
- **First-down rate per target / per reception** — moves the chains, ignores garbage yards.
- **Passer rating when targeted** (PFR `rat`) — the receiver-side mirror of the CB stat.

**Tight ends** need one extra axis that no public dataset holds well: **inline vs. slot vs. wide
alignment share** and run-blocking snaps. Without it, a blocking TE and a slot TE get compared
on receiving numbers as if they had the same job. This is a known limitation to state on the page,
not to paper over.

---

## 7. Offensive line

The hardest position group to measure, and the reason most "OL rankings" are really team
rankings wearing a player's name. But "unmeasurable from open data" — which is what a first
pass concludes — turns out to be wrong, and the distinction that matters is *whose* number
each one is.

**Charted, and genuinely individual — not open data**
- **Pass block win rate (PBWR)** — ESPN/NGS: share of pass blocks sustained ≥2.5 seconds.
- **Run block win rate (RBWR)** — beat your assignment in the run game.
- **Pressures / sacks / hurries allowed**, charted to the man who gave them up.
- **Blown-block rate**, and who he was actually assigned to.

Nobody publishes who beat whom on a given snap. That is the real gap, and no amount of
open data closes it.

**Individual, and open**
- **Penalties by type.** Play-by-play attributes a flag to a player, 92–100% complete back
  to 1999. False starts and offensive holding together are about 40% of all offensive
  penalties and are overwhelmingly called on blockers. This is the one production line on a
  lineman's record that is unambiguously his.
- **Snaps, snap share, availability.** A lineman's durability is a large part of his value.
- **Games started** — no open source has a start column, but a game in which he took at
  least half his unit's offensive snaps is a good proxy.
- **Positions played** — snap counts carry a position per game, so tackle/guard/centre
  versatility is visible. It is worth a roster place on its own.

**The unit's, on his snaps — open, via participation data**

nflverse's participation release carries the exact eleven offensive players on the field
for every play from 2016, plus a `was_pressure` flag. Joining it to play-by-play gives, for
each lineman, what the offense did while he was blocking:

- **pressure rate allowed**, **sack rate allowed**
- **EPA per dropback**, **dropback success rate**
- **yards per carry**, **rush success rate**, **stuffed rate**
- **pass rushers faced** and **defenders in the box faced** — the context that says whether
  those rates were earned against four rushers or six

The catch, and it is a big one: five linemen are on the field together, so their on-field
numbers are near-identical. Two teammates who never leave the field post exactly the same
pressure rate. This is unit performance attributed to presence, which is a much weaker claim
than a grade, and it has to be labelled that way.

**The one thing that tries to separate them: on/off**

Subtract a lineman from his team's totals and you have what the offense did *without* him.
The difference — pressure rate with him minus pressure rate without him — is the only
open-data number that even attempts to isolate one blocker from the four beside him. It is
the same idea as basketball's on/off net, and it carries the same two caveats: it is noisy,
and it does not exist at all for a player who never left the field. About 60% of qualified
linemen have a usable off-field sample in a given season; for the rest the honest answer is
no number.

Measured across 2016–2025, on-field pressure rate for qualified linemen spreads from roughly
20% to 42%, so there is real signal in the on-field rates even before differencing.

## 8. Interior defensive line and edge

- **Pressures** and **pressure rate** (pressures / pass-rush snaps) — **far more stable and more
  predictive than sacks**. Sacks are the tail of the pressure distribution.
- **Pass rush win rate (PRWR)** — beat your block within 2.5 seconds.
- **Pass rush productivity** — `(sacks + 0.75·(hits + hurries)) / pass-rush snaps`. The classic
  weighting that stops sack totals from dominating.
- **Sacks, QB hits, QB knockdowns, hurries** (PFR charting has hrry / qbkd / prss).
- **Get-off / time to pressure** — tracking-era, mostly NGS-internal.
- **Run stop rate / stop rate** — tackles constituting a "failure" for the offense, per run snap.
- **Tackles for loss** and **TFL rate**.
- **Double-team rate** — the context that explains a great nose tackle's ordinary counting stats.
- **Missed tackle %** (PFR `m_tkl_percent`) — reliability.
- **Batted passes** (PFR `bats`) — small, real, and fun.

Alignment matters as much as it does for TEs: an interior rusher and a wide-9 edge shouldn't
share a percentile pool. Position groups need to be finer than "DL".

---

## 9. Linebacker

- **Stop rate** and **run stop %** — the run-defense equivalent of success rate, from the defense's side.
- **Tackle volume** is a role stat, not a skill stat — it mostly measures snaps and scheme.
- **Missed tackle rate** — the LB stat that is actually about the player.
- **Coverage snaps, targets allowed, yards per coverage snap, EPA allowed** — modern LBs live or die here.
- **Blitz rate** and **pressure rate when blitzing** — separates a rusher from a pure off-ball LB.
- **Average depth of target covered (dADOT)** — reveals whether he's covering RBs in the flat or TEs down the seam.

## 10. Cornerback and safety

The most misread group, because a shutdown corner's reward is *not being thrown at*.

- **Targets per coverage snap** — the "do they avoid him" number. Read *first*.
- **Completion % allowed**, and **completion % allowed over expected** — the CPOE mirror.
- **Yards allowed per coverage snap** — the key rate, but it's polluted by drops and bad throws,
  which is exactly why the next one exists.
- **Forced incompletion rate** — incompletions the defender actually caused (breakup, contest),
  as opposed to ones he was lucky to get. The cleanest ball-skills stat there is.
- **Passer rating allowed** (PFR `rat`) — the familiar summary, same caveats as passer rating itself.
- **EPA allowed per target** and **ANY/A allowed per coverage snap** — the ANY/A idea transplanted
  to the coverage side; the best single coverage number available.
- **dADOT** — the depth he's asked to defend. A slot corner and a boundary corner are different jobs.
- **Yards after catch allowed** — tackling inside coverage.
- **Interceptions and pass breakups** — combine as **ball production**, but interceptions are famously
  unstable year to year; PBUs are the steadier half.
- **Missed tackle %**.
- **Snap alignment split** (boundary / slot / box / deep) — the essential context, mostly licensed.

## 11. Kicker, punter, returner

- **FG% over expected (FGOE)** — a logistic model on distance, then weather, surface and altitude;
  the residual is the kicker. Raw FG% mostly measures where his coach let him kick from.
- **FG% by distance bucket** (0–19 … 60+) and **long**.
- **Game-winning FG attempts / makes** — descriptive, tiny sample, keep it as trivia.
- **Touchback rate** and kickoff placement.
- **Punting: gross vs. net average, inside-20 rate, touchback rate, return yards allowed.**
  Net average combined with inside-20 rate is the most predictive simple pair.
- **Hang time** and **flight-based / EPA punting models** — the research-grade version, which
  models expected net after bounce and return. Hang time is not in open data.
- **Return: yards per return, return TDs, expected return yards.**

## 12. Athletic testing / pre-draft

- **Combine**: height, weight, arm length, hand size, 40-yard dash, **10-yard split** (a better
  predictor than the full 40 for most positions), vertical, broad jump, 3-cone, 20-yard shuttle, bench.
- **RAS (Relative Athletic Score)** — Kent Lee Platte's 0–10 composite, normalizing every measurable
  against everyone tested at that position since 1987. A 9.50 means 95th-percentile athlete *for
  that position*. It is a percentile scale, which makes it the natural cousin of everything else on
  a Savant page.
- **Speed score** — `(weight × 200) / 40-time⁴`, for RBs; **height-adjusted speed score** for WRs.
- **Draft capital** — round and pick. Not a skill measure, but the best single prior for a young player.

**Important caveat to print on the page:** athletic testing is a *prior*, not a performance measure.
It is measured once, years before the seasons it's shown next to.

---

## 13. Sample size — the part football gets wrong most often

A 17-game NFL season gives a WR ~100 targets, a RB ~200 carries, a CB ~70 targets, a QB ~550
dropbacks. That is one to two weeks of a basketball season. Concretely:

| Metric | Roughly stabilizes at |
|---|---|
| TPRR | ~185 routes (≈7 games) |
| YPRR | between TPRR and YPT |
| Yards per target | ~205 targets (≈39 games — i.e. **more than two seasons**) |
| QB rate stats | 100+ attempts as a floor; 150+ dropbacks to read seriously |
| Pressure rate (rusher) | stabilizes much faster than sack rate |
| Sacks | essentially never, at single-season volume |
| Interceptions (thrown or caught) | essentially never |
| CPOE | ~0.41 year-to-year — high, for football |
| Rushing EPA/play | ~0.30 year-to-year |
| Under-pressure QB splits | volatile; descriptive only |

This is why the "stabilizing" hatch is *more* load-bearing in Football Savant than in Basketball
Savant, and why the tool should carry per-metric attempt thresholds rather than one global rule.

---

## 14. Data availability and era tiers

What is actually obtainable from open data (nflverse), and when it starts:

| Tier | Since | What unlocks |
|---|---|---|
| 1 | **1999** | full box score, EPA and success rate from play-by-play, air yards / target share / WOPR / RACR / PACR, ANY/A, kicking and punting detail |
| 2 | **2012** | snap counts and snap share (offense / defense / special teams) |
| 3 | **2016** | Next Gen Stats tracking: time to throw, aggressiveness, air yards to sticks, expected completion % and CPOE, separation, cushion, xYAC and YAC over expected, RYOE, 8+ box rate, time to LOS |
| 4 | **2018** | PFR charting: pressure/blitz/hurry/hit, pocket time, bad-throw and on-target %, drops, RPO and play-action, YBC/YAC splits, broken tackles, and the full coverage line for defenders (targets, cmp% allowed, yds/target, passer rating allowed, dADOT, missed tackle %) |

Also **2016**: the participation release — the eleven offensive and eleven defensive players
on the field for every play, `was_pressure`, pass-rusher count, defenders in the box, offensive
formation and personnel. This is what makes any offensive-line measurement possible at all,
and it is the single most under-used open football dataset.

One trap worth recording: `receiver_player_id` is only populated on **completions** between
2000 and 2011, because the old gamebooks named a receiver only when the pass was caught. So
targets — and every per-target rate — genuinely begin in 2012, and a tool that shows a 2005
catch rate is inventing it.

Also open: ESPN Total QBR (2006+), the combine table (1987+ measurements, 2000+ full testing),
injuries, depth charts, and FTN charting (2022+, with play-action / RPO / screen / box-count /
QB-out-of-pocket flags).

**Not open, and worth saying so out loud on the page:** routes run and therefore YPRR/TPRR,
PFF grades and WAR, ESPN's PBWR/RBWR/PRWR win rates, PFF's turnover-worthy plays and big-time
throws, punt hang time, and coverage alignment splits. A tool that pretends to have these is
lying; a tool that names the gap is more credible than one that doesn't.

A near miss worth knowing about: the participation data has a `route` column, which looks at
first like it unlocks YPRR. It doesn't — it holds the route run by the **targeted** receiver
only, one per pass play, not the routes run by all five eligibles. It is still useful, as a
route-tree distribution for a receiver's targets, but routes run remain out of reach.

---

## 15. The metric set Football Savant ships

Position-scoped, layer-tagged, era-gated, each with its own stabilization threshold.

- **Context (all positions):** games, snaps, snap share, availability, penalties.
- **Passing:** EPA/dropback, CPOE, EPA+CPOE composite, ANY/A, success rate, Y/A, TD%, INT%,
  sack rate, aDOT, air yards to sticks, time to throw, aggressiveness, expected completion %,
  on-target %, bad-throw %, pressure rate, pocket time, blitz rate faced, play-action rate,
  RPO rate, scramble rate, passer rating, QBR, deep-attempt rate, first-down rate.
- **Rushing:** EPA/carry, success rate, YPC, RYOE/att, yards before contact, yards after contact,
  broken tackles, attempts per broken tackle, explosive rate, stuff rate, 8+ box rate,
  time to LOS, first-down rate, fumble rate.
- **Receiving:** target share, air yards share, WOPR, targets per snap, aDOT, YPT, RACR,
  receiving EPA/target, catch rate, drop %, separation, cushion, YAC, YAC over expected,
  broken tackles, first-down rate, passer rating when targeted, explosive rate.
- **Blocking (OL, TE):** pass-block and run-block snaps, games started, positions played,
  false starts and holding per game; and on his snaps — pressure rate allowed, sack rate
  allowed, EPA per dropback, dropback success rate, pass rushers faced, yards per carry,
  rush success rate, stuffed rate, defenders in the box; plus pressure rate, EPA per
  dropback and rush success rate as on/off differentials.
- **Pass rush:** pressures, pressure rate, pass-rush productivity, sacks, QB hits, hurries,
  TFL, TFL rate, missed tackle %, batted passes.
- **Run defense / tackling:** tackles per snap, solo rate, TFL rate, missed tackle %, forced fumbles.
- **Coverage:** targets per coverage snap, completion % allowed, yards per coverage snap,
  yards per target allowed, passer rating allowed, dADOT, YAC allowed, interceptions,
  passes defended, ball-production rate, missed tackle %.
- **Kicking / punting:** FG%, FG% by bucket, FG over expected, long, PAT%, gross and net punt
  average, inside-20 rate, touchback rate, return yards allowed.
- **Athletic (prior):** height, weight, 40, 10-split, vertical, broad, 3-cone, shuttle, bench,
  speed score, draft round and pick.

Sources: [nfelo](https://www.nfeloapp.com/analysis/what-are-the-best-metrics-for-nfl-quarterbacks/),
[NFL Next Gen Stats glossary](https://nextgenstats.nfl.com/glossary),
[Football Outsiders / FTN DVOA methods](https://ftnfantasy.com/nfl/dvoa-explainer),
[PFF WAR](https://www.pff.com/war),
[ESPN win-rate metrics](https://www.espn.com/nfl/story/_/id/46138675/2025-nfl-win-rates-top-teams-players-rankings-pass-run-block),
[Intentional Rounding on YPRR/TPRR stabilization](https://intentionalrounding.com/when-do-yards-per-route-run-targets-per-route-run-and-yards-per-target-stabilize/),
[SumerSports on YPRR](https://sumersports.com/the-zone/revisiting-yards-per-route-run/),
[Open Source Football expected FG](https://opensourcefootball.com/posts/2020-09-09-creating-an-expected-field-goal-metric/),
[Pasteur et al., flight-based punter metric](https://content.iospress.com/articles/journal-of-sports-analytics/jsa164),
[Relative Athletic Score](https://ras.football/),
[nflverse data releases](https://github.com/nflverse/nflverse-data/releases).
