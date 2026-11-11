# College Football Savant 1.1.0: the expansion's models

*`python -m pipeline.cfb.xmodels fit`. Every model is WCE's, fitted once and frozen in `pipeline/cfb/state/expansion.json`.*

## Expected touchdowns

Logistic on where the snap is, the down and the distance (features in `expand.td_X`). Fitted on 2014-2024 FBS-vs-FBS scrimmage plays outside garbage time; calibrated on 2025.

**rush**: 2025 has 48,917 plays. Fitted on 2014-2024 the model expected 2,307 touchdowns against 2,288 actual (log-loss 0.1227); calibrated on 2025 with one intercept shift of -0.012, it expects 2,288. Log-loss 0.1227 against 0.1889 for a flat rate. Largest decile gap 0.006.

| decile | n | predicted | actual | gap |
|---:|---:|---:|---:|---:|
| 1 | 4,892 | 0.004 | 0.004 | +0.001 |
| 2 | 4,892 | 0.005 | 0.004 | -0.001 |
| 3 | 4,891 | 0.006 | 0.006 | -0.001 |
| 4 | 4,892 | 0.007 | 0.008 | +0.000 |
| 5 | 4,892 | 0.009 | 0.010 | +0.001 |
| 6 | 4,891 | 0.012 | 0.009 | -0.003 |
| 7 | 4,892 | 0.017 | 0.016 | -0.002 |
| 8 | 4,891 | 0.028 | 0.024 | -0.003 |
| 9 | 4,892 | 0.064 | 0.065 | +0.002 |
| 10 | 4,892 | 0.315 | 0.321 | +0.006 |

**dropback**: 2025 has 48,884 plays. Fitted on 2014-2024 the model expected 2,333 touchdowns against 2,217 actual (log-loss 0.1433); calibrated on 2025 with one intercept shift of -0.062, it expects 2,217. Log-loss 0.1432 against 0.1846 for a flat rate. Largest decile gap 0.008.

| decile | n | predicted | actual | gap |
|---:|---:|---:|---:|---:|
| 1 | 4,889 | 0.005 | 0.006 | +0.001 |
| 2 | 4,888 | 0.007 | 0.009 | +0.002 |
| 3 | 4,888 | 0.008 | 0.012 | +0.003 |
| 4 | 4,889 | 0.011 | 0.007 | -0.003 |
| 5 | 4,888 | 0.014 | 0.013 | -0.001 |
| 6 | 4,888 | 0.019 | 0.015 | -0.004 |
| 7 | 4,889 | 0.028 | 0.021 | -0.007 |
| 8 | 4,888 | 0.044 | 0.045 | +0.001 |
| 9 | 4,888 | 0.079 | 0.079 | -0.001 |
| 10 | 4,889 | 0.238 | 0.246 | +0.008 |

**target**: 2025 has 45,965 plays. Fitted on 2014-2024 the model expected 2,328 touchdowns against 2,216 actual (log-loss 0.1492); calibrated on 2025 with one intercept shift of -0.060, it expects 2,216. Log-loss 0.1491 against 0.1932 for a flat rate. Largest decile gap 0.009.

| decile | n | predicted | actual | gap |
|---:|---:|---:|---:|---:|
| 1 | 4,597 | 0.005 | 0.006 | +0.001 |
| 2 | 4,596 | 0.008 | 0.010 | +0.003 |
| 3 | 4,597 | 0.009 | 0.012 | +0.003 |
| 4 | 4,596 | 0.011 | 0.008 | -0.004 |
| 5 | 4,597 | 0.015 | 0.014 | -0.001 |
| 6 | 4,596 | 0.021 | 0.016 | -0.005 |
| 7 | 4,596 | 0.030 | 0.024 | -0.006 |
| 8 | 4,597 | 0.047 | 0.046 | -0.000 |
| 9 | 4,596 | 0.085 | 0.085 | +0.000 |
| 10 | 4,597 | 0.252 | 0.261 | +0.009 |

## Expected pass rate

Gradient boosting on down, distance, yard line, score, both clocks, quarter and win probability (`expand.XPASS_FEATS`; a logistic was tried first and calibrated worse: AUC 0.703, a 4-point decile gap). Fitted on 2014-2024, checked on 2025. Pass rate over expected is also centred on each season's FBS mean, so a league-wide drift is not credited to any one team.

2025: AUC 0.726; log-loss 0.6048; largest decile gap 0.018; correlation with the release file's own `xpass` on 97,796 plays: 0.983.

| decile | n | predicted | actual | gap |
|---:|---:|---:|---:|---:|
| 1 | 9,780 | 0.136 | 0.141 | +0.004 |
| 2 | 9,780 | 0.300 | 0.318 | +0.018 |
| 3 | 9,779 | 0.381 | 0.387 | +0.006 |
| 4 | 9,780 | 0.423 | 0.429 | +0.006 |
| 5 | 9,779 | 0.445 | 0.450 | +0.005 |
| 6 | 9,780 | 0.482 | 0.477 | -0.006 |
| 7 | 9,779 | 0.551 | 0.550 | -0.001 |
| 8 | 9,780 | 0.645 | 0.640 | -0.005 |
| 9 | 9,779 | 0.763 | 0.750 | -0.013 |
| 10 | 9,780 | 0.850 | 0.857 | +0.007 |

## Tier B: completion probability (CPOE with air yards)

Logistic on air yards (hinged at -5, 0, 5, 10, 15, 20, 30, 40), direction, down and distance, formation, hurried, home or away, and whether the throw went to the end zone (`expand.cmp_X`). Charted throws, 2025 week 9 to 2026: 51,789 throws in 953 games, 5-fold cross-validation by game.

- Out-of-fold log-loss **0.5374**, against **0.6318** for 1.0.0's depth-and-side cells fitted on the same folds: better.
- Largest decile gap 0.017 (bar 0.03).

| decile | n | predicted | actual | gap |
|---:|---:|---:|---:|---:|
| 1 | 5,179 | 0.102 | 0.113 | +0.010 |
| 2 | 5,179 | 0.376 | 0.363 | -0.013 |
| 3 | 5,179 | 0.539 | 0.525 | -0.014 |
| 4 | 5,179 | 0.621 | 0.623 | +0.002 |
| 5 | 5,179 | 0.673 | 0.678 | +0.005 |
| 6 | 5,178 | 0.729 | 0.735 | +0.007 |
| 7 | 5,179 | 0.764 | 0.767 | +0.004 |
| 8 | 5,179 | 0.793 | 0.776 | -0.017 |
| 9 | 5,179 | 0.839 | 0.852 | +0.014 |
| 10 | 5,179 | 0.893 | 0.895 | +0.002 |

## Tier B: expected yards after the catch (YACOE)

Ridge regression on air yards (hinged), direction, depth (room to the end zone), down and distance, formation (`expand.yac_X`). 32,763 charted catches, 5-fold cross-validation by game, against mean YAC by air-yard band and direction fitted on the same folds.

- Out-of-fold RMSE **7.14** yards against **7.27** for the baseline (MAE 4.45 against 4.57).
- Largest decile gap 0.32 yards (bar 1.0).

| decile | n | predicted | actual | gap |
|---:|---:|---:|---:|---:|
| 1 | 3,277 | 1.51 | 1.83 | +0.318 |
| 2 | 3,276 | 3.33 | 3.27 | -0.061 |
| 3 | 3,276 | 3.74 | 3.55 | -0.181 |
| 4 | 3,276 | 4.18 | 3.87 | -0.314 |
| 5 | 3,277 | 4.72 | 4.81 | +0.091 |
| 6 | 3,276 | 5.30 | 5.08 | -0.222 |
| 7 | 3,276 | 6.06 | 6.23 | +0.162 |
| 8 | 3,276 | 6.95 | 7.14 | +0.194 |
| 9 | 3,276 | 8.08 | 8.14 | +0.061 |
| 10 | 3,277 | 9.94 | 9.89 | -0.046 |
