# NFL translation: does the comp group's NFL value track the player's own?

*`python -m pipeline.cfb.feat check`. College finals 2014-2021 by players who reached the NFL; each player's five comps found among the other NFL-linked final seasons at his position (leave-one-out).*

- Players tested: 781
- Spearman rank correlation of the comps' mean NFL Savant value per season with his own: **0.110** (p = 0.0022)
- Outcome averages shown on the card: **yes**, except at positions whose own correlation is not above zero: EDGE, IDL, S (comps shown there without NFL outcome averages).

| position | correlation | players |
|---|---:|---:|
| QB | 0.278 | 37 |
| RB | 0.058 | 67 |
| WR | 0.062 | 108 |
| TE | 0.214 | 33 |
| EDGE | -0.079 | 105 |
| IDL | -0.052 | 99 |
| LB | 0.137 | 98 |
| CB | 0.132 | 140 |
| S | -0.010 | 94 |
