# UFC Savant — data and metric research (Sep 9, 2026)

Groundwork for `public/ufc-savant.html`, the fourth Savant. Same argument as Basketball and
Football Savant — every number is a percentile against a qualified comparison group, every
row is tagged with what kind of number it is, thin samples are hatched, and a metric the era
never tracked is absent rather than zero. What changes is that a fighter has no season and
no team, and his comparison group is his weight class.

Everything marked **verified** was fetched live from a cloud container on Sep 9, 2026.

---

## 1. Data sources

### ufcstats.com — the primary source (verified)
The official FightMetric feed. The only free source with **per-round** stats for every UFC
fight since 1993: per fighter per round — knockdowns, sig. strikes landed/attempted, total
strikes, takedowns landed/attempted, sub attempts, reversals, control time, sig. strikes by
target (head/body/leg) and by position (distance/clinch/ground). Fight-level: method, round,
time, referee, a "Details" string (finish description, or three judges' scores for decisions).
Fighter-level: height, weight, reach, stance, DOB, and eight career rates (SLpM, Str. Acc.,
SApM, Str. Def., TD Avg., TD Acc., TD Def., Sub. Avg.).

Coverage: 790 events, ~8,900 fights, ~41,800 fighter-rounds, current through the Sep 5, 2026
card (updated within days of each event). UFC only, plus scattered WEC/Strikeforce/Pride
bouts. **Control time is 0% populated before 1999, 58% in 1999, 100% from 2000** — so any
control-time metric is era-gated to 2000+. Strike and target fields are ~85–100% back to 1994.

**2026 gotcha:** the site now front-loads a JavaScript proof-of-work challenge ("Checking your
browser…"): SHA-256 of `nonce:n` must start with `00`, then `POST /__c` with `nonce`, `n`,
which sets a 7-day `_fmc` cookie. Every pre-2026 GitHub scraper is broken out of the box. It
is ~15 lines of Python to solve and takes milliseconds; with the cookie, 14 fight pages in 6s
with no throttling, from a cloud IP. **GitHub Actions is viable** — unlike stats.nba.com.

URL patterns: events `ufcstats.com/statistics/events/completed?page=all`; event
`/event-details/{16-hex}` (rows carry `data-link` to each fight); fight `/fight-details/{id}`
(four tables: totals, totals per round, sig strikes by target/position, sig strikes per round);
fighter `/fighter-details/{id}`; fighter index `/statistics/fighters?char=a&page=all`.
The per-round table mislabels the Td column "Td %" — parse by column position, not header.

**Ready-made mirror (verified):** `github.com/Greco1899/scrape_ufc_stats` runs a daily Cloud
Run job and commits fresh CSVs (`ufc_fight_stats.csv` ~7 MB round-level, `ufc_fight_results.csv`,
`ufc_event_details.csv`, `ufc_fighter_tott.csv`, `ufc_fighter_details.csv`). Already had the
Sep 5 card. Caveat: joins are by name text, and it is one hobbyist's unpaid job — use it for
the bootstrap, keep our own PoW-aware scraper keyed on ufcstats hex IDs as the fallback.

### ESPN core API — secondary, richer per-fight (verified)
`sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events?dates=YYYYMMDD` → bouts →
`competitors/{id}/statistics` gives 41 fields per fighter per fight including the full
**3×3 position × target matrix** (ufcstats only gives the two marginals), takedown slams,
guard advances (half guard / side / mount / back), reversals, time in control. No per-round
split. Athlete bios and eventlogs available; career endpoint 404s. `site.api.espn.com`
scoreboard is Akamai-blocked from cloud; the core API is not.

### Others
- UFC.com athlete pages: 403 to plain fetch; richer fighter summary (KD avg, avg fight time,
  finish counts). Its TD accuracy definition disagrees with ufcstats — never mix the two.
- octagon-api.com and TheSportsDB: free JSON for bios, rankings, headshot images. No stats.
- Kaggle (mdabbert ultimate-ufc-dataset, jossilva3110 1994–2026): derived from ufcstats,
  lag by weeks/months. Bootstrap only.
- Sherdog: all-promotion records, no strike stats, scrapable.
- Tapology: robots.txt bans AI crawlers; treat as off-limits. Fight Matrix: CIRRS ratings,
  no API. Sportradar MMA: paid.

**Recommendation:** GitHub Action pulls Greco1899 CSVs (fallback: own scraper), computes
every rate from round rows, optionally enriches per fight from ESPN for the 3×3 matrix and
guard advances, and uses octagon-api/TheSportsDB for headshots.

---

## 2. What matters, per the analysts
Sources: Reed Kuhn's *Fightnomics*, Fight Matrix, ESPN's striking-differential work.

1. **Sig. strike differential per minute** (SLpM − SApM) — the single most cited number.
2. **Knockdown rate** (per 15 min, or per 100 sig strikes landed) — heavily weight-class
   dependent; percentile within division.
3. **Accuracy vs. defense gap**, and **pace** (combined sig strikes/min).
4. **Takedowns per 15, TD accuracy, TD defense** — TD defense is what lets a striker keep
   his game plan.
5. **Control time per 15** and control-time differential.
6. **Sub attempts per 15**, reversals.
7. **Position split** (distance/clinch/ground) and **target split** (head/body/leg; ~80% of
   strikes go to the head, so body/leg share is a stylistic signature).
8. **Finish rate, finished-loss rate, average fight time, durability** (KO losses per 100
   sig strikes absorbed).
9. **Round-by-round output/absorption** — fade vs. late-surge profile. Round-level only.
10. Reach differential (2.5"+ matters), southpaw (~57% win rate), age (decline ~32), activity.
11. Opponent quality: an in-house Elo over the results table is trivial and gives the
    adjustment the raw rates lack.

Derivable from ufcstats fight totals: 1–8 and 10. Needs round-level: 9, fatigue curves.
Needs ESPN: slams, guard passes, the 9-cell matrix. Not available anywhere free: strike
type/power, damage, per-round judge scores beyond the Details string.

---

## 3. Structural translation from Football Savant

| Football Savant | UFC Savant |
|---|---|
| Season | Window: **UFC career**, **last 5 fights**, **last 3 fights** (plus a per-fight view) |
| Position cohort | **Weight class** (men's and women's divisions; catchweight folded into nearest) |
| Snap share band | **Cage time** band (minutes fought) |
| Qualification threshold | e.g. ≥3 UFC fights and ≥20 minutes; hatched "stabilizing" below |
| Era gates 1999/2013/2016 | 1994 strikes, **2000 control time**, ESPN matrix (recent) |
| Team panel | Division panel (ranked roster, upcoming card) |
| Comps | Style comps within division (same layer vector distance) |
| Field map | **Strike map**: 3×3 position × target grid, plus round-by-round output curve |
| Leaderboard builder | Same, filtered by division / window / min minutes / age / stance |

## 4. Proposed metric panels

**Context** — UFC fights, minutes fought, avg fight time, age, reach, height, stance, record,
finish rate, activity (fights/yr). Layer: context.

**Striking** — SLpM, SApM, differential/min, sig accuracy, sig defense, knockdowns per 15,
KD per 100 landed, head/body/leg share, distance/clinch/ground share, pace. Layer: output
(rates) / ingredient (shares).

**Grappling** — TD per 15, TD accuracy, TD defense, control time per 15, control differential,
sub attempts per 15, reversals per 15, guard advances per 15 (ESPN era only). 

**Durability & finishing** — finish rate, finishes by KO / sub, finished-loss rate, KO losses
per 100 absorbed, decision win rate, first-round finish rate.

**Rounds** — output by round 1/2/3 (and 4/5 for title fights), fade index (R3 vs R1 output),
absorption by round.

**Value** — in-house Elo, Elo vs. division, strength of schedule (mean opponent Elo).

Lower-is-better (scale reversed): SApM, finished-loss rate, KO losses per 100 absorbed,
absorption by round.
