# College Football Savant 1.1.0: stability of every new stat

*`python -m pipeline.cfb.xstudy`, BUILD-1.1 section 3. Tier A: 1.0.0's method on 2014-2025. Tier B: split-half within 2025 week 9 on and 2026, stepped up to a typical starter's full season; year-to-year not measurable yet, and settle points will firm up as seasons accumulate.*

Verdicts: CONTEXT 101, dropped 42, full bar 22, hatched 22 (of 187 player stats).

Reliability is the split-half correlation stepped up to a full season (Tier B: to a typical starter's full season). Settle point: the sample at which his own number and the position average carry equal weight.

## Tier A: every season the data has

| stat | slots | group | player-seasons | typical sample | reliability | settle point | year-to-year: stayed | transferred | verdict |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| Passer efficiency rating (`qb_rating`) | QB | Passing: Efficiency | 1688 | 266 attempts | 0.54 | 158 | 0.12 | 0.17 | full bar |
| Adjusted net yards per attempt (`qb_anya`) | QB | Passing: Efficiency | 1688 | 285 dropbacks | 0.53 | 188 | 0.11 | 0.12 | full bar |
| Touchdown rate (`qb_td_rate`) | QB | Passing: Efficiency | 1688 | 266 attempts | 0.46 | 251 | 0.04 | 0.11 | hatched |
| First-down rate (`qb_fd_rate`) | QB | Passing: Efficiency | 1688 | 285 dropbacks | 0.57 | 188 | 0.15 | 0.19 | full bar |
| Third- and fourth-down conversion (`qb_third`) | QB | Passing: Situational | 1688 | 82 dropbacks | 0.34 | 119 | 0.12 | 0.26 | hatched |
| Red-zone touchdown rate (`qb_rz_td`) | QB | Passing: Situational | 1688 | 30 dropbacks | 0.14 | 168 | 0.02 | -0.01 | dropped |
| Short-yardage conversion (`qb_short`) | QB | Passing: Situational | 1684 | 13 plays | 0.06 | 75 | 0.04 | 0.06 | dropped |
| Two-minute drill EPA (`qb_twomin`) | QB | Passing: Situational | 1687 | 29 dropbacks | 0.11 | 178 | 0.01 | 0.09 | dropped |
| EPA when the game is in doubt (`qb_doubt`) | QB | Passing: Situational | 1684 | 122 dropbacks | 0.22 | 335 | -0.00 | 0.16 | CONTEXT |
| Middle-8 EPA (`qb_mid8`) | QB | Passing: Situational | 1688 | 51 dropbacks | 0.13 | 224 | 0.04 | 0.02 | dropped |
| Points per drive (`qb_d_pts`) | QB | Passing: Drives | 1688 | 95 drives | 0.62 | 47 | 0.21 | 0.09 | full bar |
| Touchdown-drive rate (`qb_d_td`) | QB | Passing: Drives | 1688 | 95 drives | 0.61 | 50 | 0.19 | 0.07 | full bar |
| Three-and-out rate (`qb_d_3out`) | QB | Passing: Drives | 1688 | 95 drives | 0.40 | 126 | 0.11 | 0.02 | hatched |
| Total EPA (`qb_tot_epa`) | QB | Value | 1688 | 10 season | 0.56 | 7 | 0.37 | 0.18 | full bar |
| Win probability added (`qb_wpa`) | QB | Value | 1688 | 10 season | 0.27 | 22 | 0.16 | 0.06 | CONTEXT |
| Touchdowns over expected (`qb_tdoe`) | QB | Value | 1688 | 10 season | 0.41 | 13 | 0.24 | 0.12 | hatched |
| First-down rate on runs (`qb_rush_fd`) | QB | Rushing | 1688 | 48 rushes | 0.33 | 75 | 0.08 | 0.05 | hatched |
| Fumble rate (`qb_fum`) | QB | Rushing | 1688 | 344 plays | 0.19 | 1496 | 0.07 | -0.02 | CONTEXT |
| Short-yardage run conversion (`qb_sneak`) | QB | Rushing | 1575 | 6 rushes | -0.05 | 71 | 0.09 | -0.00 | dropped |
| Team pass rate over expected (`qb_proe`) | QB | Context | 1685 | 247 team plays | 0.81 | 47 | 0.58 | 0.21 | CONTEXT (style) |
| Penalties (`qb_pen`) | QB | Context | 1688 | 640 team plays | 0.15 | 10000 | 0.12 | -0.06 | dropped |
| Line yards per carry (`rb_ly`) | RB | Where the yards come from | 2088 | 128 rushes | 0.43 | 168 | 0.09 | 0.12 | hatched |
| Second-level yards per carry (`rb_slv`) | RB | Where the yards come from | 2088 | 128 rushes | 0.46 | 141 | 0.18 | 0.11 | hatched |
| Open-field yards per carry (`rb_ofy`) | RB | Where the yards come from | 2088 | 128 rushes | 0.37 | 211 | 0.17 | 0.14 | hatched |
| Opportunity rate (`rb_opp_rate`) | RB | Where the yards come from | 2088 | 128 rushes | 0.40 | 188 | 0.12 | 0.14 | hatched |
| Highlight yards per opportunity (`rb_hly_opp`) | RB | Where the yards come from | 2088 | 61 opportunities | 0.34 | 106 | 0.15 | 0.11 | hatched |
| First-down rate (`rb_fd`) | RB | Rushing: Efficiency | 2088 | 128 rushes | 0.44 | 158 | 0.12 | 0.04 | hatched |
| Power success (`rb_power`) | RB | Rushing: Situational | 2079 | 12 rushes | 0.04 | 841 | 0.04 | -0.08 | dropped |
| Red-zone carry share (`rb_rz_share`) | RB | Rushing: Situational | 2088 | 61 team rushes | 0.68 | 34 | 0.32 | 0.16 | CONTEXT (style) |
| Goal-line carry share (`rb_gl_share`) | RB | Rushing: Situational | 2088 | 18 team rushes | 0.57 | 13 | 0.30 | 0.14 | CONTEXT (style) |
| Touchdowns over expected (`rb_tdoe`) | RB | Value | 2088 | 11 season | 0.24 | 38 | 0.20 | 0.11 | CONTEXT |
| Win probability added (`rb_wpa`) | RB | Value | 2088 | 11 season | 0.18 | 60 | 0.10 | 0.09 | CONTEXT |
| Fumble rate (`rb_fum`) | RB | Rushing: Efficiency | 2088 | 143 touches | 0.04 | 2114 | -0.00 | 0.10 | dropped |
| Targets per game (`rb_tgt_g`) | RB | Receiving | 2088 | 11 games | 0.81 | 3 | 0.51 | 0.29 | CONTEXT (style) |
| Receiving yards per team pass attempt (`rb_rec_yptpa`) | RB | Receiving | 2088 | 315 team attempts | 0.69 | 158 | 0.43 | 0.26 | full bar |
| Penalties (`rb_pen`) | RB | Context | 2088 | 693 team plays | 0.12 | 5012 | 0.05 | -0.08 | dropped |
| First downs per target (`wr_fd_tgt`) | WR | Efficiency | 4646 | 55 targets | 0.35 | 106 | 0.10 | 0.07 | hatched |
| Red-zone target share (`wr_rz_share`) | WR | Situational | 409 | 25 team attempts | 0.32 | 50 |  |  | CONTEXT (style) |
| Third-down target share (`wr_third_share`) | WR | Situational | 409 | 66 team attempts | 0.52 | 60 |  |  | CONTEXT (style) |
| Touchdowns over expected (`wr_tdoe`) | WR | Value | 4646 | 11 season | 0.24 | 32 | 0.15 | 0.08 | CONTEXT |
| Win probability added (`wr_wpa`) | WR | Value | 4646 | 11 season | 0.29 | 27 | 0.19 | 0.03 | CONTEXT |
| Penalties (`wr_pen`) | WR | Context | 4646 | 674 team plays | 0.21 | 2371 | 0.14 | 0.00 | CONTEXT |
| First downs per target (`te_fd_tgt`) | TE | Efficiency | 1597 | 29 targets | 0.21 | 100 | 0.08 | 0.05 | CONTEXT |
| Red-zone target share (`te_rz_share`) | TE | Situational | 181 | 23 team attempts | 0.53 | 30 |  |  | CONTEXT (style) |
| Third-down target share (`te_third_share`) | TE | Situational | 181 | 58 team attempts | 0.55 | 47 |  |  | CONTEXT (style) |
| Touchdowns over expected (`te_tdoe`) | TE | Value | 1597 | 9 season | 0.13 | 75 | 0.03 | 0.11 | dropped |
| Win probability added (`te_wpa`) | TE | Value | 1597 | 9 season | 0.23 | 40 | 0.08 | 0.19 | CONTEXT |
| Penalties (`te_pen`) | TE | Context | 1597 | 590 team plays | 0.12 | 3350 | 0.05 | 0.03 | dropped |
| Solo tackles (`dl_solo`) | EDGE/IDL | Run defense | 9237 | 730 team def. plays | 0.61 | 562 | 0.37 | 0.26 | CONTEXT (style) |
| Assisted tackles (`dl_asst`) | EDGE/IDL | Run defense | 9237 | 730 team def. plays | 0.62 | 501 | 0.40 | 0.24 | CONTEXT (style) |
| Tackles for loss on runs (`dl_tfl_run`) | EDGE/IDL | Run defense | 9237 | 730 team def. plays | 0.39 | 1334 | 0.28 | 0.14 | hatched |
| Tackles for loss on passes (`dl_tfl_pass`) | EDGE/IDL | Pass rush | 9237 | 730 team def. plays | 0.56 | 596 | 0.46 | 0.32 | full bar |
| Fumble recoveries (`dl_frec`) | EDGE/IDL | Turnovers | 9237 | 730 team def. plays | 0.10 | 5012 | 0.05 | -0.03 | dropped |
| Interception return yards (`dl_int_yds`) | EDGE/IDL | Turnovers | 429 | 1 interceptions | 0.30 |  |  |  | CONTEXT |
| Interception value (`dl_int_epa`) | EDGE/IDL | Turnovers | 9237 | 12 season | 0.04 | 237 | 0.04 | 0.05 | dropped |
| Penalties (`dl_pen`) | EDGE/IDL | Discipline | 9237 | 730 team def. plays | 0.27 | 1884 | 0.22 | 0.17 | CONTEXT |
| Havoc share (`dl_havoc`) | EDGE/IDL | Value | 6870 | 99 team havoc plays | 0.59 | 67 | 0.47 | 0.37 | full bar |
| EPA per sack (`dl_sack_epa`) | EDGE/IDL | Pass rush | 6101 | 2 sacks | 0.05 | 45 | -0.03 | -0.07 | dropped |
| Yards lost per sack (`dl_sack_yds`) | EDGE/IDL | Pass rush | 6101 | 2 sacks | 0.04 | 106 | 0.04 | 0.06 | dropped |
| Third-down sack rate (`dl_sack3`) | EDGE/IDL | Pass rush | 9237 | 105 opp. 3rd-down dropbacks | 0.39 | 178 | 0.30 | 0.23 | hatched |
| Strip sacks (`dl_strip`) | EDGE/IDL | Pass rush | 4831 | 742 team def. plays | 0.14 | 4732 | 0.12 | 0.16 | dropped |
| Solo tackles (`lb_solo`) | LB | Run defense | 7164 | 729 team def. plays | 0.77 | 298 | 0.42 | 0.22 | CONTEXT (style) |
| Assisted tackles (`lb_asst`) | LB | Run defense | 7164 | 729 team def. plays | 0.77 | 266 | 0.45 | 0.14 | CONTEXT (style) |
| Tackles for loss on runs (`lb_tfl_run`) | LB | Run defense | 7164 | 729 team def. plays | 0.43 | 1000 | 0.25 | -0.02 | hatched |
| Tackles for loss on passes (`lb_tfl_pass`) | LB | Pass rush | 7164 | 729 team def. plays | 0.50 | 841 | 0.32 | 0.37 | hatched |
| Fumble recoveries (`lb_frec`) | LB | Turnovers | 7164 | 729 team def. plays | 0.08 | 10000 | 0.08 | 0.12 | dropped |
| Interception return yards (`lb_int_yds`) | LB | Turnovers | 1908 | 1 interceptions | -0.09 |  | 0.05 |  | dropped |
| Interception value (`lb_int_epa`) | LB | Turnovers | 7164 | 12 season | 0.22 | 45 | 0.16 | 0.13 | CONTEXT |
| Penalties (`lb_pen`) | LB | Discipline | 7164 | 729 team def. plays | 0.21 | 2512 | 0.16 | 0.04 | CONTEXT |
| Havoc share (`lb_havoc`) | LB | Value | 5307 | 98 team havoc plays | 0.61 | 67 | 0.34 | 0.17 | full bar |
| EPA per sack (`lb_sack_epa`) | LB | Pass rush | 4123 | 2 sacks | 0.04 | 10000 | -0.01 | 0.20 | dropped |
| Yards lost per sack (`lb_sack_yds`) | LB | Pass rush | 4123 | 2 sacks | 0.01 | 42 | -0.02 | -0.01 | dropped |
| Third-down sack rate (`lb_sack3`) | LB | Pass rush | 7164 | 104 opp. 3rd-down dropbacks | 0.35 | 237 | 0.25 | 0.24 | hatched |
| Strip sacks (`lb_strip`) | LB | Pass rush | 3869 | 741 team def. plays | 0.16 | 2512 | 0.13 |  | CONTEXT |
| Solo tackles (`db_solo`) | CB/S | Run defense | 9625 | 726 team def. plays | 0.69 | 501 | 0.40 | 0.13 | CONTEXT (style) |
| Assisted tackles (`db_asst`) | CB/S | Run defense | 9625 | 726 team def. plays | 0.71 | 335 | 0.52 | 0.33 | CONTEXT (style) |
| Tackles for loss on runs (`db_tfl_run`) | CB/S | Run defense | 9625 | 726 team def. plays | 0.28 | 2371 | 0.19 | 0.13 | CONTEXT |
| Tackles for loss on passes (`db_tfl_pass`) | CB/S | Pass rush | 9625 | 726 team def. plays | 0.25 | 1995 | 0.15 | 0.09 | CONTEXT |
| Fumble recoveries (`db_frec`) | CB/S | Turnovers | 9625 | 726 team def. plays | 0.09 | 6310 | 0.05 | 0.09 | dropped |
| Interception return yards (`db_int_yds`) | CB/S | Turnovers | 5529 | 1 interceptions | 0.13 |  | 0.02 | 0.19 | dropped |
| Interception value (`db_int_epa`) | CB/S | Turnovers | 9625 | 12 season | 0.30 | 32 | 0.19 | 0.14 | CONTEXT |
| Penalties (`db_pen`) | CB/S | Discipline | 9625 | 726 team def. plays | 0.30 | 1778 | 0.24 | 0.03 | CONTEXT |
| Havoc share (`db_havoc`) | CB/S | Value | 7158 | 98 team havoc plays | 0.50 | 106 | 0.27 | 0.10 | hatched |
| Long field-goal rate (`k_long_rate`) | K | Field goals | 903 | 2 attempts | 0.04 |  | 0.02 | 0.15 | dropped |
| Kickoff touchback rate (`k_ko_tb`) | K | Kickoffs | 1041 | 42 kickoffs | 0.79 | 15 | 0.47 | 0.45 | full bar |
| Kickoff EPA (`k_ko_epa`) | K | Kickoffs | 1040 | 42 kickoffs | 0.35 | 266 | -0.02 | 0.03 | hatched |
| Inside-20 rate (`p_in20`) | P | Placement | 1258 | 51 punts | 0.39 | 94 | 0.17 | 0.13 | hatched |
| Touchback rate (`p_tb`) | P | Placement | 1258 | 51 punts | 0.16 | 237 | 0.04 | 0.02 | CONTEXT |
| Return yards allowed per punt (`p_ret_allowed`) | P | Punting | 1258 | 47 punts | 0.33 | 79 | 0.11 | -0.07 | hatched |
| Return EPA over average (`ret_epa`) | RET | Returns | 2119 | 16 returns | 0.09 | 141 | 0.03 | 0.00 | dropped |
| Yards per kick return (`ret_kyds`) | RET | Returns | 1787 | 15 returns | 0.39 | 27 | 0.13 | 0.05 | hatched |
| Yards per punt return (`ret_pyds`) | RET | Returns | 1276 | 12 returns | 0.11 | 40 | 0.09 | -0.01 | dropped |
| 20-yard return rate (`ret_20`) | RET | Returns | 2119 | 16 returns | 0.71 | 5 | 0.39 | 0.35 | full bar |
| Return touchdowns (`ret_td`) | RET | Returns | 2120 | 9 season | 0.15 | 40 | 0.11 | 0.10 | dropped |
| Fair-catch rate (`ret_fc`) | RET | Fair catches and muffs | 1294 | 21 punts fielded | 0.38 | 32 | 0.22 | 0.12 | CONTEXT (style) |

## Tier B: the charted layer, 2025 week 9 on

| stat | slots | group | player-seasons | typical sample | reliability | settle point | year-to-year: stayed | transferred | verdict |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| Completion % over expected (`qb_cpoe`) | QB | Passing: Shot selection | 340 | 276 attempts | 0.37 | 298 | not yet | not yet | CONTEXT |
| Average depth of target (`qb_adot`) | QB | Passing: Shot selection | 340 | 276 attempts | 0.77 | 106 | not yet | not yet | CONTEXT (style) |
| Deep-throw rate (`qb_deep_rate`) | QB | Passing: Shot selection | 340 | 276 attempts | 0.62 | 178 | not yet | not yet | CONTEXT (style) |
| Behind-the-line throw rate (`qb_behind`) | QB | Passing: Shot selection | 340 | 276 attempts | 0.76 | 94 | not yet | not yet | CONTEXT (style) |
| Throws to the left (`qb_dir_l`) | QB | Passing: Shot selection | 340 | 276 attempts | 0.54 | 168 | not yet | not yet | CONTEXT (style) |
| Throws to the middle (`qb_dir_m`) | QB | Passing: Shot selection | 340 | 276 attempts | 0.60 | 150 | not yet | not yet | CONTEXT (style) |
| Throws to the right (`qb_dir_r`) | QB | Passing: Shot selection | 340 | 276 attempts | 0.53 | 119 | not yet | not yet | CONTEXT (style) |
| Completion rate, behind the line (`qb_b0_cmp`) | QB | Passing: By depth | 332 | 55 attempts | 0.08 | 10000 | not yet | not yet | dropped |
| Yards per attempt, behind the line (`qb_b0_ypa`) | QB | Passing: By depth | 332 | 55 attempts | -0.37 | 10000 | not yet | not yet | dropped |
| Completion rate, 0-9 air yards (`qb_b1_cmp`) | QB | Passing: By depth | 338 | 130 attempts | 0.13 | 158 | not yet | not yet | dropped |
| Yards per attempt, 0-9 air yards (`qb_b1_ypa`) | QB | Passing: By depth | 338 | 130 attempts | 0.37 | 133 | not yet | not yet | CONTEXT |
| Completion rate, 10-19 air yards (`qb_b2_cmp`) | QB | Passing: By depth | 338 | 72 attempts | 0.29 | 10000 | not yet | not yet | CONTEXT |
| Yards per attempt, 10-19 air yards (`qb_b2_ypa`) | QB | Passing: By depth | 338 | 72 attempts | 0.24 | 10000 | not yet | not yet | CONTEXT |
| Completion rate, 20+ air yards (`qb_b3_cmp`) | QB | Passing: By depth | 328 | 48 attempts | 0.36 | 168 | not yet | not yet | CONTEXT |
| Yards per attempt, 20+ air yards (`qb_b3_ypa`) | QB | Passing: By depth | 328 | 48 attempts | 0.30 | 10000 | not yet | not yet | CONTEXT |
| Completed air yards per attempt (`qb_cair`) | QB | Passing: Shot selection | 340 | 276 attempts | 0.70 | 211 | not yet | not yet | full bar |
| YAC share (`qb_yac_share`) | QB | Passing: Shot selection | 340 | 2031 yards | 0.74 | 891 | not yet | not yet | CONTEXT (style) |
| Pressure rate faced (`qb_press_rate`) | QB | Passing: Pressure | 341 | 302 dropbacks | 0.60 | 168 | not yet | not yet | full bar |
| Pressure-to-sack rate (`qb_p2s`) | QB | Passing: Pressure | 333 | 53 pressures | 0.67 | 24 | not yet | not yet | full bar |
| EPA per dropback when pressured (`qb_press_epa`) | QB | Passing: Pressure | 333 | 53 dropbacks | 0.37 | 79 | not yet | not yet | CONTEXT |
| EPA per dropback when clean (`qb_clean_epa`) | QB | Passing: Pressure | 340 | 256 dropbacks | 0.34 | 531 | not yet | not yet | CONTEXT |
| Shotgun rate (`qb_shotgun`) | QB | Passing: Formation and tempo | 341 | 302 dropbacks | 0.89 | 14 | not yet | not yet | CONTEXT (style) |
| EPA per dropback, shotgun (`qb_shot_epa`) | QB | Passing: Formation and tempo | 341 | 290 dropbacks | 0.43 | 562 | not yet | not yet | CONTEXT |
| EPA per dropback, under center (`qb_uc_epa`) | QB | Passing: Formation and tempo | 129 | 28 dropbacks | -0.12 |  | not yet | not yet | dropped |
| No-huddle rate (`qb_nohuddle`) | QB | Passing: Formation and tempo | 341 | 302 dropbacks | 0.93 | 14 | not yet | not yet | CONTEXT (style) |
| EPA per dropback, no-huddle (`qb_nh_epa`) | QB | Passing: Formation and tempo | 330 | 208 dropbacks | 0.12 | 944 | not yet | not yet | dropped |
| Runs to the left (`rb_dir_l`) | RB | Rushing: Direction | 505 | 108 rushes | 0.60 | 56 | not yet | not yet | CONTEXT (style) |
| Success rate, left (`rb_succ_l`) | RB | Rushing: Direction | 399 | 31 rushes | 0.06 | 10000 | not yet | not yet | dropped |
| Runs to the middle (`rb_dir_m`) | RB | Rushing: Direction | 505 | 108 rushes | 0.69 | 38 | not yet | not yet | CONTEXT (style) |
| Success rate, middle (`rb_succ_m`) | RB | Rushing: Direction | 497 | 69 rushes | 0.26 | 67 | not yet | not yet | CONTEXT |
| Runs to the right (`rb_dir_r`) | RB | Rushing: Direction | 505 | 108 rushes | 0.52 | 79 | not yet | not yet | CONTEXT (style) |
| Success rate, right (`rb_succ_r`) | RB | Rushing: Direction | 404 | 29 rushes | 0.18 | 47 | not yet | not yet | CONTEXT |
| EPA per rush, shotgun (`rb_shot_epa`) | RB | Rushing: Efficiency | 501 | 98 rushes | 0.19 | 562 | not yet | not yet | CONTEXT |
| EPA per rush, under center (`rb_uc_epa`) | RB | Rushing: Efficiency | 141 | 26 rushes | 0.49 |  | not yet | not yet | CONTEXT |
| Average depth of target (`rb_adot`) | RB | Receiving | 365 | 29 targets | 0.52 | 25 | not yet | not yet | CONTEXT (style) |
| YAC per catch (`rb_yac`) | RB | Receiving | 324 | 24 catches | 0.07 | 67 | not yet | not yet | dropped |
| Average depth of target (`wr_adot`) | WR | Opportunity | 1002 | 55 targets | 0.67 | 24 | not yet | not yet | CONTEXT (style) |
| Air-yards share (`wr_air_share`) | WR | Opportunity | 1004 | 3059 team air yards | 0.82 | 794 | not yet | not yet | CONTEXT (style) |
| Opportunity score (WOPR) (`wr_wopr`) | WR | Opportunity | 1004 | 366 team attempts | 0.86 | 67 | not yet | not yet | CONTEXT (style) |
| Deep-target share (`wr_deep_share`) | WR | Opportunity | 1002 | 55 targets | 0.49 | 53 | not yet | not yet | CONTEXT (style) |
| End-zone target share (`wr_ez_share`) | WR | Situational | 861 | 26 team attempts | 0.56 | 16 | not yet | not yet | CONTEXT (style) |
| YAC per reception (`wr_yac`) | WR | After the catch | 942 | 36 catches | 0.35 | 75 | not yet | not yet | CONTEXT |
| YAC over expected (`wr_yacoe`) | WR | After the catch | 942 | 36 catches | 0.18 | 335 | not yet | not yet | CONTEXT |
| Catch rate, short (`wr_catch_short`) | WR | By depth | 982 | 44 targets | 0.31 | 158 | not yet | not yet | CONTEXT |
| Catch rate, deep (`wr_catch_deep`) | WR | By depth | 679 | 18 targets | 0.07 | 36 | not yet | not yet | dropped |
| EPA per target, short (`wr_epa_short`) | WR | By depth | 982 | 44 targets | 0.14 | 10000 | not yet | not yet | dropped |
| EPA per target, deep (`wr_epa_deep`) | WR | By depth | 679 | 18 targets | -0.00 | 27 | not yet | not yet | dropped |
| Targets to the left (`wr_dir_l`) | WR | Opportunity | 1002 | 55 targets | 0.71 | 20 | not yet | not yet | CONTEXT (style) |
| Targets to the middle (`wr_dir_m`) | WR | Opportunity | 1002 | 55 targets | 0.45 | 53 | not yet | not yet | CONTEXT (style) |
| Targets to the right (`wr_dir_r`) | WR | Opportunity | 1002 | 55 targets | 0.72 | 20 | not yet | not yet | CONTEXT (style) |
| Average depth of target (`te_adot`) | TE | Opportunity | 465 | 31 targets | 0.54 | 40 | not yet | not yet | CONTEXT (style) |
| Air-yards share (`te_air_share`) | TE | Opportunity | 465 | 3094 team air yards | 0.83 | 794 | not yet | not yet | CONTEXT (style) |
| Opportunity score (WOPR) (`te_wopr`) | TE | Opportunity | 465 | 367 team attempts | 0.87 | 56 | not yet | not yet | CONTEXT (style) |
| Deep-target share (`te_deep_share`) | TE | Opportunity | 465 | 31 targets | 0.42 | 71 | not yet | not yet | CONTEXT (style) |
| End-zone target share (`te_ez_share`) | TE | Situational | 400 | 27 team attempts | 0.37 | 22 | not yet | not yet | CONTEXT (style) |
| YAC per reception (`te_yac`) | TE | After the catch | 409 | 24 catches | 0.35 | 150 | not yet | not yet | CONTEXT |
| YAC over expected (`te_yacoe`) | TE | After the catch | 409 | 24 catches | 0.26 | 71 | not yet | not yet | CONTEXT |
| Catch rate, short (`te_catch_short`) | TE | By depth | 452 | 29 targets | -0.05 | 56 | not yet | not yet | dropped |
| Catch rate, deep (`te_catch_deep`) | TE | By depth | 126 | 18 targets | -2.86 |  | not yet | not yet | dropped |
| EPA per target, short (`te_epa_short`) | TE | By depth | 452 | 29 targets | 0.14 | 266 | not yet | not yet | dropped |
| EPA per target, deep (`te_epa_deep`) | TE | By depth | 126 | 18 targets | -0.64 |  | not yet | not yet | dropped |
| Targets to the left (`te_dir_l`) | TE | Opportunity | 465 | 31 targets | 0.28 | 67 | not yet | not yet | CONTEXT (style) |
| Targets to the middle (`te_dir_m`) | TE | Opportunity | 465 | 31 targets | 0.36 | 34 | not yet | not yet | CONTEXT (style) |
| Targets to the right (`te_dir_r`) | TE | Opportunity | 465 | 31 targets | 0.34 | 133 | not yet | not yet | CONTEXT (style) |
| Hurries per game (`dl_hur_g`) | EDGE/IDL | Pass rush | 2135 | 12 games | 0.55 | 12 | not yet | not yet | CONTEXT (style) |
| Hurries per opponent dropback (`dl_hur_db`) | EDGE/IDL | Pass rush | 2135 | 316 opp. dropbacks | 0.52 | 335 | not yet | not yet | full bar |
| Pressures per game (`dl_press_g`) | EDGE/IDL | Pass rush | 2135 | 12 games | 0.69 | 6 | not yet | not yet | CONTEXT (style) |
| Pressures per opponent dropback (`dl_press_db`) | EDGE/IDL | Pass rush | 2135 | 316 opp. dropbacks | 0.66 | 158 | not yet | not yet | full bar |
| Share of team pressures (`dl_press_share`) | EDGE/IDL | Pass rush | 2135 | 51 team pressures | 0.67 | 24 | not yet | not yet | full bar |
| Pressure-to-sack rate (`dl_p2s`) | EDGE/IDL | Pass rush | 631 | 20 pressures | 0.04 |  | not yet | not yet | dropped |
| Average depth of tackle (`dl_tk_depth`) | EDGE/IDL | Run defense | 1871 | 26 tackles | 0.37 | 24 | not yet | not yet | CONTEXT |
| Run-stop rate (`dl_rstop_rate`) | EDGE/IDL | Run defense | 1820 | 24 run tackles | 0.22 | 45 | not yet | not yet | CONTEXT |
| Break-ups per opponent dropback (`dl_pbu_db`) | EDGE/IDL | Credited coverage | 2135 | 316 opp. dropbacks | 0.31 | 562 | not yet | not yet | CONTEXT |
| Air yards on credited throws (`dl_cov_air`) | EDGE/IDL | Credited coverage | 324 | 12 throws | -0.09 |  | not yet | not yet | CONTEXT (style) |
| EPA on credited throws (`dl_cov_epa`) | EDGE/IDL | Credited coverage | 324 | 12 throws | 0.15 |  | not yet | not yet | dropped |
| Hurries per game (`lb_hur_g`) | LB | Pass rush | 1476 | 12 games | 0.56 | 11 | not yet | not yet | CONTEXT (style) |
| Hurries per opponent dropback (`lb_hur_db`) | LB | Pass rush | 1476 | 317 opp. dropbacks | 0.51 | 335 | not yet | not yet | full bar |
| Pressures per game (`lb_press_g`) | LB | Pass rush | 1476 | 12 games | 0.65 | 7 | not yet | not yet | CONTEXT (style) |
| Pressures per opponent dropback (`lb_press_db`) | LB | Pass rush | 1476 | 317 opp. dropbacks | 0.62 | 224 | not yet | not yet | full bar |
| Share of team pressures (`lb_press_share`) | LB | Pass rush | 1476 | 51 team pressures | 0.62 | 25 | not yet | not yet | full bar |
| Pressure-to-sack rate (`lb_p2s`) | LB | Pass rush | 378 | 16 pressures | 0.32 |  | not yet | not yet | CONTEXT |
| Average depth of tackle (`lb_tk_depth`) | LB | Run defense | 1274 | 44 tackles | 0.37 | 71 | not yet | not yet | CONTEXT |
| Run-stop rate (`lb_rstop_rate`) | LB | Run defense | 1229 | 41 run tackles | 0.30 | 71 | not yet | not yet | CONTEXT |
| Break-ups per opponent dropback (`lb_pbu_db`) | LB | Credited coverage | 1476 | 317 opp. dropbacks | 0.34 | 501 | not yet | not yet | CONTEXT |
| Air yards on credited throws (`lb_cov_air`) | LB | Credited coverage | 905 | 24 throws | 0.35 | 282 | not yet | not yet | CONTEXT (style) |
| EPA on credited throws (`lb_cov_epa`) | LB | Credited coverage | 905 | 24 throws | 0.25 | 10000 | not yet | not yet | CONTEXT |
| Average depth of tackle (`db_tk_depth`) | CB/S | Run defense | 2021 | 38 tackles | 0.31 | 47 | not yet | not yet | CONTEXT |
| Run-stop rate (`db_rstop_rate`) | CB/S | Run defense | 1703 | 24 run tackles | 0.26 | 27 | not yet | not yet | CONTEXT |
| Break-ups per opponent dropback (`db_pbu_db`) | CB/S | Credited coverage | 2332 | 315 opp. dropbacks | 0.54 | 251 | not yet | not yet | full bar |
| Air yards on credited throws (`db_cov_air`) | CB/S | Credited coverage | 1825 | 29 throws | 0.33 | 34 | not yet | not yet | CONTEXT (style) |
| EPA on credited throws (`db_cov_epa`) | CB/S | Credited coverage | 1825 | 29 throws | 0.21 | 50 | not yet | not yet | CONTEXT |
| Muff rate (`ret_muff`) | RET | Fair catches and muffs | 396 | 31 chances | 0.18 | 158 | not yet | not yet | CONTEXT |

## Team stats

| stat | tier | team-seasons | reliability | verdict |
|---|---|---:|---:|---|
| Seconds per play (`sec_play`) | A | 1565 | 0.77 | CONTEXT (style) |
| Pass rate over expected (`proe`) | A | 1564 | 0.84 | CONTEXT (style) |
| Early-down pass rate (`early_pass`) | A | 1564 | 0.82 | CONTEXT (style) |
| Offense points per drive (`off_d_pts`) | A | 1565 | 0.71 | full bar |
| Defense points per drive allowed (`def_d_pts`) | A | 1565 | 0.64 | full bar |
| Offense touchdown-drive rate (`off_d_td`) | A | 1565 | 0.70 | full bar |
| Defense touchdown-drive rate allowed (`def_d_td`) | A | 1565 | 0.64 | full bar |
| Offense three-and-out rate (`off_3out`) | A | 1565 | 0.54 | full bar |
| Defense three-and-outs forced (`def_3out`) | A | 1565 | 0.45 | hatched |
| Offense explosive pass rate (`off_expl_pass`) | A | 1565 | 0.57 | full bar |
| Defense explosive passes allowed (`def_expl_pass`) | A | 1565 | 0.34 | hatched |
| Offense explosive run rate (`off_expl_rush`) | A | 1565 | 0.51 | full bar |
| Defense explosive runs allowed (`def_expl_rush`) | A | 1565 | 0.48 | hatched |
| Offense two-minute EPA (`off_twomin`) | A | 1565 | 0.21 | CONTEXT |
| Defense two-minute EPA allowed (`def_twomin`) | A | 1565 | 0.21 | CONTEXT |
| Offense middle-8 EPA (`off_mid8`) | A | 1565 | 0.32 | hatched |
| Defense middle-8 EPA allowed (`def_mid8`) | A | 1565 | 0.27 | CONTEXT |
| Kickoff EPA per game (`st_ko`) | A | 1565 | 0.23 | CONTEXT |
| Kick return EPA per game (`st_kr`) | A | 1565 | 0.25 | CONTEXT |
| Punt EPA per game (`st_pu`) | A | 1565 | 0.34 | hatched |
| Punt return EPA per game (`st_pr`) | A | 1565 | 0.19 | CONTEXT |
| Field-goal EPA per game (`st_fg`) | A | 1565 | 0.14 | dropped |
| Fourth-down go rate over expected (`fd4_goe`) | A | 1565 | 0.68 | CONTEXT (style) |
| Fourth downs that follow the recommendation (`fd4_follow`) | A | 1565 | 0.33 | hatched |
| Expected points given up on fourth downs, per game (`fd4_eplost`) | A | 1565 | 0.42 | hatched |
| Two-point try rate (`two_rate`) | A | 1565 | 0.28 | CONTEXT (style) |
| Two-point conversion rate (`two_conv`) | A | 1258 | -0.03 | dropped |
| Timeouts per game (`to_g`) | A | 1565 | 0.63 | CONTEXT (style) |
| Late-half timeout share (`to_late`) | A | 1553 | 0.49 | CONTEXT (style) |
| Offense pressure rate allowed (`off_press`) | B | 274 | 0.63 | full bar |
| Defense pressure rate (`def_press`) | B | 274 | 0.51 | full bar |
| Offense hurry rate allowed (`off_hur`) | B | 274 | 0.61 | full bar |
| Offense average depth of target (`off_adot`) | B | 274 | 0.75 | CONTEXT (style) |
| Defense average depth of target allowed (`def_adot`) | B | 274 | 0.45 | CONTEXT (style) |
| Defense YAC per catch allowed (`def_yac`) | B | 274 | 0.32 | CONTEXT |
| Defense deep-throw rate allowed (`def_deep`) | B | 274 | 0.46 | CONTEXT |
| Shotgun rate (`shotgun`) | B | 274 | 0.96 | CONTEXT (style) |
| No-huddle rate (`nohuddle`) | B | 274 | 0.95 | CONTEXT (style) |
| EPA per play, shotgun (`shot_epa`) | B | 274 | 0.64 | full bar |
| EPA per play, under center (`uc_epa`) | B | 254 | -0.05 | dropped |
| Run success, left (`ol_succ_l`) | B | 274 | 0.25 | CONTEXT |
| Line yards, left (`ol_ly_l`) | B | 274 | 0.11 | dropped |
| Stuff rate, left (`ol_stuff_l`) | B | 274 | 0.08 | dropped |
| Defense EPA per run allowed, left (`def_run_l`) | B | 274 | 0.33 | CONTEXT |
| Run success, middle (`ol_succ_m`) | B | 274 | 0.53 | full bar |
| Line yards, middle (`ol_ly_m`) | B | 274 | 0.40 | CONTEXT |
| Stuff rate, middle (`ol_stuff_m`) | B | 274 | 0.45 | CONTEXT |
| Defense EPA per run allowed, middle (`def_run_m`) | B | 274 | 0.48 | CONTEXT |
| Run success, right (`ol_succ_r`) | B | 274 | 0.35 | CONTEXT |
| Line yards, right (`ol_ly_r`) | B | 274 | 0.29 | CONTEXT |
| Stuff rate, right (`ol_stuff_r`) | B | 274 | 0.23 | CONTEXT |
| Defense EPA per run allowed, right (`def_run_r`) | B | 274 | 0.25 | CONTEXT |
