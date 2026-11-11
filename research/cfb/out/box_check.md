# Box-score cross-checks (BUILD-1.1 step 3)

*`python -m pipeline.cfb.xcheck`. Play-by-play against ESPN's box scores, FBS-vs-FBS games, garbage time in; bar: within 2%.*

| season | kick returns | kick return yds | punt returns | punt return yds | punts | penalized player named | returns the play text describes |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2009 | +0.0% | +0.0% | +0.0% | +0.0% | +0.3% | 0% | 64% |
| 2010 | +0.0% | +0.0% | +0.0% | +0.0% | +0.6% | 0% | 75% |
| 2011 | +0.0% | +0.0% | +0.0% | +0.0% | +0.2% | 0% | 62% |
| 2012 | +0.0% | +0.0% | +0.0% | +0.0% | +0.3% | 0% | 89% |
| 2014 | +0.0% | +0.0% | +0.0% | +0.0% | +0.2% | 53% | 97% |
| 2015 | +0.0% | +0.0% | +0.0% | +0.0% | -0.0% | 52% | 96% |
| 2016 | +0.0% | +0.0% | +0.0% | +0.0% | +0.4% | 51% | 96% |
| 2017 | +0.0% | +0.0% | +0.0% | +0.0% | +0.7% | 50% | 97% |
| 2018 | +0.0% | +0.0% | +0.0% | +0.0% | +0.9% | 51% | 89% |
| 2019 | +0.0% | +0.0% | +0.0% | +0.0% | +0.5% | 52% | 89% |
| 2020 | +0.0% | +0.0% | +0.0% | +0.0% | +0.8% | 51% | 87% |
| 2021 | +0.0% | +0.0% | +0.0% | +0.0% | +0.9% | 59% | 91% |
| 2022 | +0.0% | +0.0% | +0.0% | +0.0% | +1.4% | 57% | 97% |
| 2023 | +0.0% | +0.0% | +0.0% | +0.0% | +0.8% | 61% | 51% |
| 2024 | +0.0% | +0.0% | +0.0% | +0.0% | +0.9% | 60% | 96% |
| 2025 | +0.0% | +0.0% | +0.0% | +0.0% | +1.3% | 66% | 96% |
| 2026 | +0.0% | +0.0% | +0.0% | +0.0% | -0.5% | 64% | 99% |

Gap = the site's number less the box's, as a share of the box. **Every count is within 2%.**

Returns: counts, yards and touchdowns are the box score's, because the play text of some seasons stops at "kickoff for 62 yds" (2,725 kickoffs in 2023) and misses returns the box lists. Per-return rates (EPA, 20-yard returns, fair catches, muffs) come from the returns the play text describes, whose share of the box's is the last column.

Penalties: the box score has no per-player penalty line, so a player's penalties cannot be checked against it. The team page's penalty stats are the team box's (as in 1.0.0). A player's are the accepted penalties ESPN names him on: the penalized-player column is the share of the play-by-play's accepted penalties that name anyone. Play-by-play penalty rows against the team box:

| season | play-by-play accepted penalties vs team box |
|---|---:|
| 2009 | -0.6% |
| 2010 | -0.4% |
| 2011 | -0.0% |
| 2012 | -0.4% |
| 2014 | -3.0% |
| 2015 | -3.4% |
| 2016 | -2.9% |
| 2017 | -2.8% |
| 2018 | -3.3% |
| 2019 | -3.6% |
| 2020 | -2.9% |
| 2021 | -4.4% |
| 2022 | -7.9% |
| 2023 | -10.7% |
| 2024 | -7.7% |
| 2025 | -3.2% |
| 2026 | -1.2% |
