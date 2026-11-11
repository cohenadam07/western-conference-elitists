# The charted layer: parser checks

*`python -m pipeline.cfb.charting check`. Tier B is tracked from 2025 week 9.*

## 2025

- FBS-vs-FBS games: 807; charted at 80% or more: 393; under: 414 (they contribute nothing to Tier B).
- Weeks 1-8: 2 of 411 games charted; week 9 on: 391 of 396 (mean charted share 96.6%).
- Air yards against the release file: 23,058 throws in both; median absolute difference 0.00 yards; within 1 yard on 100.0% (bar: median <= 1 on >= 95%).
- Air yards + YAC = gain within 1 yard on 99.5% of 14,454 completions (bar 98%); both spots parsed on 98.2% of completions.
- Named defenders resolved to a roster id: 53,790 of 54,261 = 99.1% (bar 95%).
- The text's first tackler is among ESPN's own tacklers on 98.3% of 34,665 plays that name both.

Games under 80% charted (week 9 of 2025 on):

| game | week | charted share | plays |
|---|---:|---:|---:|
| Texas A&M Aggies at LSU Tigers | 9 | 0.0% | 118 |
| Ole Miss Rebels at Oklahoma Sooners | 9 | 0.0% | 143 |
| Alabama Crimson Tide at South Carolina Gamecocks | 9 | 0.0% | 132 |
| Ole Miss Rebels at Georgia Bulldogs | 1 | 0.0% | 141 |
| Coastal Carolina Chanticleers at Louisiana Tech Bulldogs | 1 | 0.0% | 136 |

## 2026

- FBS-vs-FBS games: 562; charted at 80% or more: 560; under: 2 (they contribute nothing to Tier B).
- Air yards against the release file: 32,726 throws in both; median absolute difference 0.00 yards; within 1 yard on 99.8% (bar: median <= 1 on >= 95%).
- Air yards + YAC = gain within 1 yard on 99.5% of 20,821 completions (bar 98%); both spots parsed on 98.7% of completions.
- Named defenders resolved to a roster id: 76,877 of 77,612 = 99.1% (bar 95%).
- The text's first tackler is among ESPN's own tacklers on 99.2% of 49,261 plays that name both.

Games under 80% charted (week 9 of 2025 on):

| game | week | charted share | plays |
|---|---:|---:|---:|
| East Carolina Pirates at Alabama Crimson Tide | 1 | 0.0% | 114 |
| SMU Mustangs at Florida State Seminoles | 1 | 0.0% | 131 |


**All checks pass: yes**
