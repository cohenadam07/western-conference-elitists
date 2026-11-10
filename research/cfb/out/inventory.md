# Release-file inventory

Source: github.com/sportsdataverse/sportsdataverse-data release assets (parquet).

## espn_cfb_pbp

Seasons 2004–2026; missing: none; 506 columns (sample file `play_by_play_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 87,214 | 499 |
| 2005 | 110,646 | 498 |
| 2006 | 114,879 | 498 |
| 2007 | 131,598 | 498 |
| 2008 | 139,094 | 498 |
| 2009 | 143,935 | 498 |
| 2010 | 142,445 | 499 |
| 2011 | 148,090 | 498 |
| 2012 | 154,904 | 498 |
| 2013 | 159,038 | 499 |
| 2014 | 155,687 | 507 |
| 2015 | 158,578 | 507 |
| 2016 | 155,725 | 507 |
| 2017 | 155,575 | 507 |
| 2018 | 158,400 | 507 |
| 2019 | 157,010 | 507 |
| 2020 | 100,459 | 506 |
| 2021 | 147,434 | 507 |
| 2022 | 149,600 | 507 |
| 2023 | 153,899 | 507 |
| 2024 | 163,565 | 507 |
| 2025 | 166,360 | 506 |
| 2026 | 119,146 | 506 |

<details><summary>Columns</summary>

season (int64), game_id (int64), game_play_number (int64), pos_team_id (int64), pos_team (string), def_pos_team_id (int64), def_pos_team (string), pos_team_score (int64), def_pos_team_score (int64), half (int64), period (int64), down (int64), distance (int64), EPA (double), wpa (double), wp_before (double), wp_after (double), def_wp_before (double), def_wp_after (double), penalty_detail (string), yds_penalty (string), penalty_1st_conv (bool), new_series (bool), firstD_by_kickoff (bool), firstD_by_poss (bool), firstD_by_penalty (bool), firstD_by_yards (bool), def_EPA (double), rz_play (bool), scoring_opp (bool), middle_8 (bool), stuffed_run (bool), change_of_pos_team (bool), downs_turnover (bool), pos_score_diff_start (int64), pos_score_pts (int64), home_wp_before (double), away_wp_before (double), home_wp_after (double), away_wp_after (double), end_of_half (bool), orig_play_type (string), offense_score_play (bool), defense_score_play (bool), pos_score_diff (int64), change_of_poss (bool), rusher_player_name (string), yds_rushed (int64), passer_player_name (string), receiver_player_name (string), yds_receiving (int64), yds_sacked (int64), sack_players (string), sack_player_name (string), sack_player_name2 (string), pass_breakup_player_name (string), interception_player_name (string), yds_int_return (int64), fumble_player_name (string), fumble_forced_player_name (string), fumble_recovered_player_name (string), yds_fumble_return (int64), punter_player_name (string), yds_punted (int64), yds_punt_return (int64), yds_punt_gained (int64), punt_block_player_name (string), punt_block_return_player_name (string), fg_kicker_player_name (string), yds_fg (int64), fg_block_player_name (string), fg_return_player_name (null), kickoff_player_name (string), yds_kickoff (int64), yds_kickoff_return (int64), rush (bool), rush_td (bool), pass (bool), pass_td (bool), completion (bool), pass_attempt (bool), target (bool), sack (bool), int (bool), int_td (bool), turnover_vec (bool), kickoff_play (bool), scoring_play (bool), td_play (bool), touchdown (bool), safety (bool), fumble_vec (bool), kickoff_tb (bool), kickoff_onside (bool), kickoff_oob (bool), kickoff_fair_catch (bool), kickoff_downed (bool), kickoff_safety (bool), punt (bool), punt_play (bool), punt_tb (bool), punt_oob (bool), punt_fair_catch (bool), punt_downed (bool), punt_safety (bool), punt_blocked (bool), penalty_safety (bool), fg_made (bool), fg_make_prob (double), penalty_flag (bool), penalty_declined (bool), penalty_no_play (bool), penalty_offset (bool), penalty_text (string), lead_wp_before2 (double), lead_wp_before (double), lead_pos_team2 (int64), id (int64), sequenceNumber (int64), text (string), awayScore (int64), homeScore (int64), scoringPlay (bool), priority (bool), modified (string), wallclock (string), teamParticipants (string), isPenalty (bool), statYardage (int64), isTurnover (bool), type.id (string), type.text (string), type.abbreviation (string), period.number (int64), clock.displayValue (string), start.down (int64), start.distance (int64), start.yardLine (int64), start.yardsToEndzone (int64), start.team.id (int64), end.down (int64), end.distance (int64), end.yardLine (int64), end.yardsToEndzone (int64), end.downDistanceText (string), end.shortDownDistanceText (string), end.possessionText (string), end.team.id (int64), start.downDistanceText (string), start.shortDownDistanceText (string), start.possessionText (string), scoringType.name (string), scoringType.displayName (string), scoringType.abbreviation (string), pointAfterAttempt.id (double), pointAfterAttempt.text (string), pointAfterAttempt.abbreviation (string), pointAfterAttempt.value (double), drive.id (string), drive.displayResult (string), drive.isScore (bool), drive.team.shortDisplayName (string), drive.team.displayName (string), drive.team.name (string), drive.team.abbreviation (string), drive.yards (int64), drive.offensivePlays (int64), drive.result (string), drive.description (string), drive.shortDisplayResult (string), drive.timeElapsed.displayValue (string), drive.start.period.number (int64), drive.start.period.type (string), drive.start.yardLine (int64), drive.start.clock.displayValue (string), drive.start.text (string), drive.end.period.number (int64), drive.end.period.type (string), drive.end.yardLine (int64), drive.end.clock.displayValue (string), seasonType (int64), week (int64), status_type_completed (bool), homeTeamId (int64), awayTeamId (int64), homeFinalScore (int64), awayFinalScore (int64), homeTeamName (string), awayTeamName (string), homeTeamMascot (string), awayTeamMascot (string), homeTeamAbbrev (string), awayTeamAbbrev (string), homeTeamNameAlt (string), awayTeamNameAlt (string), gameSpread (double), homeFavorite (bool), gameSpreadAvailable (bool), overUnder (double), overUnderAvailable (bool), homeTeamSpread (double), clock.minutes (int64), clock.seconds (int64), lag_half (int64), lead_half (int64), start.TimeSecsRem (int64), start.adj_TimeSecsRem (int64), lead_text (string), lead_start_team (string), lead_start_yardsToEndzone (int64), lead_start_down (int64), lead_start_distance (int64), lead_scoringPlay (bool), text_dupe (bool), end_state_missing (bool), start.pos_team.id (int64), start.def_pos_team.id (int64), end.def_pos_team.id (int64), end.pos_team.id (int64), start.pos_team.name (string), start.def_pos_team.name (string), end.pos_team.name (string), end.def_pos_team.name (string), start.is_home (bool), end.is_home (bool), homeTimeoutCalled (bool), awayTimeoutCalled (bool), end.homeTeamTimeouts (int64), end.awayTeamTimeouts (int64), start.homeTeamTimeouts (int64), start.awayTeamTimeouts (int64), end.TimeSecsRem (int64), end.adj_TimeSecsRem (int64), start.posTeamTimeouts (int64), start.defPosTeamTimeouts (int64), end.posTeamTimeouts (int64), end.defPosTeamTimeouts (int64), firstHalfKickoffTeamId (int64), start.yard (int64), end.yard (int64), lag_scoringPlay (bool), down_1 (bool), down_2 (bool), down_3 (bool), down_4 (bool), down_1_end (bool), down_2_end (bool), down_3_end (bool), down_4_end (bool), td_check (bool), forced_fumble (bool), is_home (bool), lag_HA_score_diff (int64), HA_score_diff (int64), net_HA_score_pts (int64), H_score_diff (int64), A_score_diff (int64), lag_homeScore (int64), lag_awayScore (int64), start.homeScore (int64), start.awayScore (int64), end.homeScore (int64), end.awayScore (int64), start.pos_team_score (int64), start.def_pos_team_score (int64), start.pos_score_diff (int64), end.pos_team_score (int64), end.def_pos_team_score (int64), end.pos_score_diff (int64), start.pos_team_receives_2H_kickoff (bool), end.pos_team_receives_2H_kickoff (bool), penalty_in_text (bool), penalty_count (int64), penalty_declined_count (int64), penalty_all_declined (bool), penalty_enforcement (string), penalty_negated_play (bool), pass_breakup (bool), pass_depth (string), pass_direction (string), rush_direction (string), qb_hurry (bool), fg_attempt (bool), pos_unit (string), def_pos_unit (string), sp (bool), play (bool), cleaned_text (string), kneel_down (bool), scrimmage_play (bool), pos_score_diff_end (int64), fumble_lost (bool), fumble_recovered (bool), field_goal_result (string), extra_point_result (string), two_point_conv_result (string), defensive_two_point_attempt (bool), defensive_two_point_conv (bool), yds_punted_source (string), yds_kickoff_source (string), yds_punt_return_source (string), air_yardsToEndzone (int64), air_yards (int64), yards_after_catch (int64), kickoff_return_player_name (string), punt_return_player_name (string), xp_attempt (bool), xp_made (bool), xp_kicker_player_name (string), kicking_team (int64), return_team (int64), fumble_or_muff (bool), recovery_team (int64), recovery_team_2 (int64), penalty_spot_yardline (int64), penalty_spot_side (string), penalty_spot_yardsToEndzone (int64), fumbling_team (int64), int_turnover (bool), pos_fumble_lost (bool), def_fumble_lost (bool), is_pos_team_turnover (bool), is_def_pos_team_turnover (bool), is_turnover (bool), turnover_team (int64), is_st_turnover (bool), is_blocked_punt_turnover (bool), is_blocked_fg_turnover (bool), sack_team (int64), interception_team (int64), pass_breakup_team (int64), forced_fumble_team (int64), fumble_recovery_team (int64), punt_return_team (int64), kick_return_team (int64), fg_team (int64), punt_team (int64), penalized_team (int64), penalty_yards_signed (int64), penalty_side (string), penalty_yards_net (int64), penalty_team_id (int64), new_down (int64), new_distance (int64), under_2 (bool), goal_to_go (bool), stopped_run (bool), opportunity_run (bool), highlight_run (bool), adj_rush_yardage (int64), line_yards (double), second_level_yards (double), open_field_yards (int64), highlight_yards (double), opp_highlight_yards (double), short_rush_success (bool), short_rush_attempt (bool), early_down (bool), late_down (bool), power_rush_attempt (bool), power_rush_success (bool), early_down_pass (bool), early_down_rush (bool), late_down_pass (bool), late_down_rush (bool), standard_down (bool), passing_down (bool), TFL (bool), TFL_pass (bool), TFL_rush (bool), havoc (bool), first_down_yards (bool), first_down_penalty (bool), first_down_earned (bool), start.pos_team_spread (double), start.elapsed_share (double), start.spread_time (double), end.pos_team_spread (double), end.elapsed_share (double), end.spread_time (double), penalty_assessed_on_kickoff (bool), start.yardsToEndzone.touchback (int64), EP_start_touchback (double), EP_start (double), EP_end (double), EP_penalty_cf (double), penalty_cf_yardsToEndzone (int64), lag_EP_end (double), EP_between (double), EPA_scrimmage (double), EPA_rush (double), EPA_pass (double), EPA_explosive (bool), EPA_non_explosive (double), EPA_explosive_pass (bool), EPA_explosive_rush (bool), first_down_created (bool), EPA_success (bool), EPA_success_early_down (bool), EPA_success_early_down_pass (bool), EPA_success_early_down_rush (bool), EPA_success_late_down (bool), EPA_success_late_down_pass (bool), EPA_success_late_down_rush (bool), EPA_success_standard_down (bool), EPA_success_passing_down (bool), EPA_success_pass (bool), EPA_success_rush (bool), EPA_success_EPA (double), EPA_success_standard_down_EPA (double), EPA_success_passing_down_EPA (double), EPA_success_pass_EPA (double), EPA_success_rush_EPA (double), EPA_middle_8_success (bool), EPA_middle_8_success_pass (bool), EPA_middle_8_success_rush (bool), EPA_penalty (double), EPA_penalty_direct (double), EPA_sp (double), EPA_fg (double), EPA_punt (double), EPA_kickoff (double), start.ExpScoreDiff_touchback (double), start.ExpScoreDiff (double), start.ExpScoreDiff_Time_Ratio_touchback (double), start.ExpScoreDiff_Time_Ratio (double), end.ExpScoreDiff (double), end.ExpScoreDiff_Time_Ratio (double), wp_touchback (double), wp_before_naive (double), wp_touchback_naive (double), wp_after_naive (double), def_wp_before_naive (double), home_wp_before_naive (double), away_wp_before_naive (double), lead_wp_before_naive (double), lead_wp_before2_naive (double), def_wp_after_naive (double), home_wp_after_naive (double), away_wp_after_naive (double), wpa_naive (double), cp (double), cp_game_state (double), cp_model (string), cpoe (double), era (int64), xpass (double), pass_oe (double), drive_start (double), drive_stopped (bool), drive_play_index (int64), drive_offense_plays (int64), prog_drive_EPA (double), prog_drive_WPA (double), drive_offense_yards (int64), drive_total_yards (int64), qbr_epa (double), weight (double), non_fumble_sack (bool), sack_epa (double), pass_epa (double), rush_epa (double), pen_epa (double), sack_weight (double), pass_weight (double), rush_weight (double), pen_weight (double), action_play (bool), athlete_name (string), rusher_player_id (int64), passer_player_id (int64), receiver_player_id (int64), fumble_player_id (int64), sack_player_id (int64), sack_player_id2 (int64), interception_player_id (int64), pass_breakup_player_id (int64), fumble_forced_player_id (int64), fumble_recovered_player_id (int64), fg_kicker_player_id (int64), punter_player_id (int64), kickoff_player_id (int64), kickoff_return_player_id (int64), punt_return_player_id (int64), fg_block_player_id (int64), punt_block_player_id (int64), fg_return_player_id (null), punt_block_return_player_id (int64), go_wp (double), first_down_prob (double), wp_succeed (double), wp_fail (double), make_fg_wp (double), miss_fg_wp (double), fg_wp (double), punt_wp (double), go_boost (double), go_wp_diff (double), fg_wp_diff (double), punt_wp_diff (double), fourth_down_recommendation (string), two_pt_wp (double), xp_wp (double), prob_2pt (double), two_pt_recommendation (string), two_pt_wp_diff (double)

</details>

## espn_cfb_play_participants

Seasons 2014–2026; missing: none; 89 columns (sample file `play_participants_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2014 | 148,402 | 68 |
| 2015 | 149,361 | 68 |
| 2016 | 148,403 | 68 |
| 2017 | 145,749 | 68 |
| 2018 | 148,007 | 68 |
| 2019 | 146,588 | 68 |
| 2020 | 94,204 | 68 |
| 2021 | 143,829 | 68 |
| 2022 | 145,684 | 68 |
| 2023 | 143,798 | 68 |
| 2024 | 151,764 | 68 |
| 2025 | 154,815 | 72 |
| 2026 | 110,744 | 89 |

<details><summary>Columns</summary>

game_id (int64), play_id (int64), kicker_player_name (string), returner_player_name (string), tackler_player_name (string), rusher_player_name (string), passer_player_name (string), receiver_player_name (string), assisted_by_player_name (string), scorer_player_name (string), pat_scorer_player_name (string), punter_player_name (string), pass_defender_player_name (string), sacked_by_player_name (string), penalized_player_name (string), pat_passer_player_name (string), kicker_player_id (string), returner_player_id (string), tackler_player_id (string), rusher_player_id (string), passer_player_id (string), receiver_player_id (string), assisted_by_player_id (string), scorer_player_id (string), pat_scorer_player_id (string), punter_player_id (string), pass_defender_player_id (string), sacked_by_player_id (string), penalized_player_id (string), pat_passer_player_id (string), kicker_player_names (string), returner_player_names (string), tackler_player_names (string), rusher_player_names (string), passer_player_names (string), receiver_player_names (string), assisted_by_player_names (string), scorer_player_names (string), pat_scorer_player_names (string), punter_player_names (string), pass_defender_player_names (string), sacked_by_player_names (string), penalized_player_names (string), pat_passer_player_names (string), kicker_player_ids (string), returner_player_ids (string), tackler_player_ids (string), rusher_player_ids (string), passer_player_ids (string), receiver_player_ids (string), assisted_by_player_ids (string), scorer_player_ids (string), pat_scorer_player_ids (string), punter_player_ids (string), pass_defender_player_ids (string), sacked_by_player_ids (string), penalized_player_ids (string), pat_passer_player_ids (string), season (int64), week (int64), recoverer_player_name (string), fumbler_player_name (string), forced_by_player_name (string), recoverer_player_id (string), fumbler_player_id (string), forced_by_player_id (string), recoverer_player_names (string), fumbler_player_names (string), forced_by_player_names (string), recoverer_player_ids (string), fumbler_player_ids (string), forced_by_player_ids (string), kicker_position_id (string), returner_position_id (string), penalized_position_id (string), passer_position_id (string), receiver_position_id (string), assisted_by_position_id (string), tackler_position_id (string), punter_position_id (string), rusher_position_id (string), pass_defender_position_id (string), scorer_position_id (string), pat_scorer_position_id (string), sacked_by_position_id (string), recoverer_position_id (string), fumbler_position_id (string), forced_by_position_id (string), pat_passer_position_id (string)

</details>

## espn_cfb_player_box

Seasons 2004–2026; missing: none; 56 columns (sample file `player_box_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 23,981 | 41 |
| 2005 | 24,809 | 46 |
| 2006 | 27,032 | 46 |
| 2007 | 28,762 | 46 |
| 2008 | 29,130 | 46 |
| 2009 | 32,099 | 46 |
| 2010 | 32,438 | 46 |
| 2011 | 31,999 | 46 |
| 2012 | 32,681 | 46 |
| 2013 | 33,609 | 46 |
| 2014 | 34,091 | 46 |
| 2015 | 33,938 | 46 |
| 2016 | 40,719 | 56 |
| 2017 | 40,016 | 56 |
| 2018 | 40,131 | 56 |
| 2019 | 39,436 | 56 |
| 2020 | 25,715 | 56 |
| 2021 | 44,043 | 56 |
| 2022 | 40,598 | 56 |
| 2023 | 57,239 | 56 |
| 2024 | 78,993 | 56 |
| 2025 | 80,498 | 56 |
| 2026 | 58,862 | 56 |

<details><summary>Columns</summary>

completions/passingAttempts (string), passingYards (string), yardsPerPassAttempt (string), passingTouchdowns (string), interceptions (string), category (string), athlete_id (int64), athlete_name (string), jersey (string), team_id (int64), rushingAttempts (string), rushingYards (string), yardsPerRushAttempt (string), rushingTouchdowns (string), longRushing (string), receptions (string), receivingYards (string), yardsPerReception (string), receivingTouchdowns (string), longReception (string), totalTackles (string), soloTackles (string), sacks (string), tacklesForLoss (string), passesDefended (string), hurries (string), defensiveTouchdowns (string), interceptionYards (string), interceptionTouchdowns (string), kickReturns (string), kickReturnYards (string), yardsPerKickReturn (string), longKickReturn (string), kickReturnTouchdowns (string), fieldGoalsMade/fieldGoalAttempts (string), fieldGoalPct (string), longFieldGoalMade (string), extraPointsMade/extraPointAttempts (string), totalKickingPoints (string), punts (string), puntYards (string), grossAvgPuntYards (string), touchbacks (string), puntsInside20 (string), longPunt (string), puntReturns (string), puntReturnYards (string), yardsPerPuntReturn (string), longPuntReturn (string), puntReturnTouchdowns (string), game_id (int64), season (int64), fumbles (string), fumblesLost (string), fumblesRecovered (string), adjQBR (string)

</details>

## espn_cfb_team_box

Seasons 2004–2026; missing: none; 21 columns (sample file `team_box_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 1,424 | 21 |
| 2005 | 1,456 | 21 |
| 2006 | 1,576 | 21 |
| 2007 | 1,600 | 21 |
| 2008 | 1,624 | 21 |
| 2009 | 1,620 | 21 |
| 2010 | 1,620 | 21 |
| 2011 | 1,634 | 21 |
| 2012 | 1,704 | 21 |
| 2013 | 1,722 | 21 |
| 2014 | 1,746 | 21 |
| 2015 | 1,752 | 21 |
| 2016 | 1,758 | 21 |
| 2017 | 1,780 | 21 |
| 2018 | 1,796 | 21 |
| 2019 | 1,784 | 21 |
| 2020 | 1,384 | 21 |
| 2021 | 1,790 | 21 |
| 2022 | 1,808 | 21 |
| 2023 | 1,822 | 21 |
| 2024 | 1,932 | 21 |
| 2025 | 1,916 | 21 |
| 2026 | 1,370 | 21 |

<details><summary>Columns</summary>

firstDowns (string), thirdDownEff (string), fourthDownEff (string), totalYards (string), netPassingYards (string), completionAttempts (string), yardsPerPass (string), rushingYards (string), rushingAttempts (string), yardsPerRushAttempt (string), totalPenaltiesYards (string), turnovers (string), fumblesLost (string), interceptions (string), possessionTime (string), team_id (int64), team_abbreviation (string), team_name (string), home_away (string), game_id (int64), season (int64)

</details>

## espn_cfb_drives

Seasons 2004–2026; missing: none; 20 columns (sample file `drives_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 16,414 | 20 |
| 2005 | 16,080 | 20 |
| 2006 | 16,735 | 20 |
| 2007 | 18,916 | 20 |
| 2008 | 19,910 | 20 |
| 2009 | 20,270 | 20 |
| 2010 | 20,185 | 20 |
| 2011 | 20,844 | 20 |
| 2012 | 21,709 | 20 |
| 2013 | 22,783 | 20 |
| 2014 | 22,605 | 20 |
| 2015 | 22,949 | 20 |
| 2016 | 22,582 | 20 |
| 2017 | 22,610 | 20 |
| 2018 | 22,854 | 20 |
| 2019 | 22,474 | 20 |
| 2020 | 14,140 | 20 |
| 2021 | 20,585 | 20 |
| 2022 | 21,164 | 20 |
| 2023 | 21,749 | 20 |
| 2024 | 22,419 | 20 |
| 2025 | 22,498 | 20 |
| 2026 | 16,054 | 20 |

<details><summary>Columns</summary>

drive_id (string), team_id (int64), result (string), display_result (string), short_display_result (string), description (string), yards (int64), offensive_plays (int64), is_score (bool), start_period (int64), start_yard_line (int64), start_clock (string), start_text (string), end_period (int64), end_yard_line (int64), end_clock (string), time_elapsed (string), n_plays (int64), game_id (int64), season (int64)

</details>

## espn_cfb_game_rosters

Seasons 2004–2026; missing: none; 84 columns (sample file `game_rosters_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 43,010 | 72 |
| 2005 | 44,351 | 72 |
| 2006 | 48,042 | 72 |
| 2007 | 51,622 | 72 |
| 2008 | 52,740 | 74 |
| 2009 | 51,273 | 72 |
| 2010 | 51,905 | 72 |
| 2011 | 51,666 | 72 |
| 2012 | 53,341 | 77 |
| 2013 | 55,421 | 79 |
| 2014 | 173,004 | 79 |
| 2015 | 194,785 | 79 |
| 2016 | 194,766 | 79 |
| 2017 | 192,666 | 79 |
| 2018 | 198,633 | 79 |
| 2019 | 202,692 | 79 |
| 2020 | 131,518 | 78 |
| 2021 | 213,086 | 78 |
| 2022 | 211,705 | 73 |
| 2023 | 216,281 | 73 |
| 2024 | 231,077 | 73 |
| 2025 | 214,432 | 77 |
| 2026 | 152,114 | 84 |

<details><summary>Columns</summary>

athlete_id (int64), athlete_uid (string), athlete_guid (string), athlete_type (string), first_name (string), last_name (string), full_name (string), athlete_display_name (string), short_name (string), weight (double), display_weight (string), height (double), display_height (string), slug (string), jersey (string), linked (bool), active (bool), alternate_ids_sdr (string), birth_place_city (string), birth_place_state (string), birth_place_country (string), birth_country_alternate_id (string), birth_country_abbreviation (string), headshot_href (string), headshot_alt (string), flag_href (string), flag_alt (string), flag_rel (string), experience_years (double), experience_display_value (string), experience_abbreviation (string), status_id (string), status_name (string), status_type (string), status_abbreviation (string), hand_type (string), hand_abbreviation (string), hand_display_value (string), starter (bool), jersey_right (string), valid (bool), did_not_play (bool), display_name (string), athlete_href (string), position_href (string), statistics_href (string), team_id (int64), order (int64), home_away (string), winner (bool), team_guid (string), team_uid (string), team_slug (string), team_location (string), team_name (string), team_nickname (string), team_abbreviation (string), team_display_name (string), team_short_display_name (string), team_color (string), team_alternate_color (string), is_active (bool), is_all_star (bool), team_alternate_ids_sdr (string), logo_href (string), logo_dark_href (string), game_id (int64), season (int64), week (int64), citizenship (string), middle_name (string), age (double), date_of_birth (string), draft_display_text (string), draft_round (double), draft_year (double), draft_selection (double), nickname (string), position_id (int64), position_name (string), position_display_name (string), position_abbreviation (string), position_leaf (bool), position_parent_href (string)

</details>

## espn_cfb_betting

Seasons 2004–2026; missing: none; 9 columns (sample file `betting_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 712 | 9 |
| 2005 | 728 | 9 |
| 2006 | 788 | 9 |
| 2007 | 800 | 9 |
| 2008 | 812 | 9 |
| 2009 | 810 | 9 |
| 2010 | 810 | 9 |
| 2011 | 817 | 9 |
| 2012 | 852 | 9 |
| 2013 | 861 | 9 |
| 2014 | 873 | 9 |
| 2015 | 876 | 9 |
| 2016 | 879 | 9 |
| 2017 | 890 | 9 |
| 2018 | 898 | 9 |
| 2019 | 892 | 9 |
| 2020 | 692 | 9 |
| 2021 | 895 | 9 |
| 2022 | 904 | 9 |
| 2023 | 911 | 9 |
| 2024 | 966 | 9 |
| 2025 | 958 | 9 |
| 2026 | 685 | 9 |

<details><summary>Columns</summary>

game_id (int64), season (int64), week (int64), game_spread (double), over_under (double), home_favorite (bool), home_team_spread (double), game_spread_available (bool), odds_source (string)

</details>

## espn_cfb_schedules

Seasons 2004–2026; missing: none; 20 columns (sample file `cfb_schedule_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 712 | 20 |
| 2005 | 728 | 20 |
| 2006 | 788 | 20 |
| 2007 | 800 | 20 |
| 2008 | 812 | 20 |
| 2009 | 810 | 20 |
| 2010 | 810 | 20 |
| 2011 | 817 | 20 |
| 2012 | 852 | 20 |
| 2013 | 861 | 20 |
| 2014 | 873 | 20 |
| 2015 | 876 | 20 |
| 2016 | 879 | 20 |
| 2017 | 890 | 20 |
| 2018 | 898 | 20 |
| 2019 | 892 | 20 |
| 2020 | 692 | 20 |
| 2021 | 895 | 20 |
| 2022 | 904 | 20 |
| 2023 | 911 | 20 |
| 2024 | 966 | 20 |
| 2025 | 958 | 20 |
| 2026 | 685 | 20 |

<details><summary>Columns</summary>

game_id (int64), season (int64), week (int64), season_type (int64), game_date (string), neutral_site (bool), conference_competition (bool), home_id (int64), away_id (int64), home_team (string), away_team (string), home_abbreviation (string), away_abbreviation (string), home_score (int64), away_score (int64), home_winner (bool), away_winner (bool), venue (string), attendance (int64), status (string)

</details>

## espn_cfb_linescores

Seasons 2004–2026; missing: none; 5 columns (sample file `linescores_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 5,720 | 5 |
| 2005 | 5,822 | 5 |
| 2006 | 6,384 | 5 |
| 2007 | 6,452 | 5 |
| 2008 | 6,560 | 5 |
| 2009 | 6,550 | 5 |
| 2010 | 6,560 | 5 |
| 2011 | 6,620 | 5 |
| 2012 | 6,930 | 5 |
| 2013 | 6,994 | 5 |
| 2014 | 7,064 | 5 |
| 2015 | 7,106 | 5 |
| 2016 | 7,150 | 5 |
| 2017 | 7,132 | 5 |
| 2018 | 7,202 | 5 |
| 2019 | 7,232 | 5 |
| 2020 | 4,634 | 5 |
| 2021 | 7,234 | 5 |
| 2022 | 7,350 | 5 |
| 2023 | 7,396 | 5 |
| 2024 | 7,862 | 5 |
| 2025 | 7,782 | 5 |
| 2026 | 5,550 | 5 |

<details><summary>Columns</summary>

team_id (int64), period (int64), value (string), game_id (int64), season (int64)

</details>

## espn_cfb_rosters

Seasons 2004–2026; missing: none; 85 columns (sample file `cfb_rosters_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 6,822 | 85 |
| 2005 | 7,304 | 85 |
| 2006 | 7,543 | 85 |
| 2007 | 8,738 | 85 |
| 2008 | 9,409 | 85 |
| 2009 | 8,256 | 85 |
| 2010 | 8,110 | 85 |
| 2011 | 8,156 | 85 |
| 2012 | 8,288 | 85 |
| 2013 | 8,836 | 85 |
| 2014 | 22,417 | 85 |
| 2015 | 22,764 | 85 |
| 2016 | 23,660 | 85 |
| 2017 | 23,142 | 85 |
| 2018 | 24,101 | 85 |
| 2019 | 24,229 | 85 |
| 2020 | 16,947 | 85 |
| 2021 | 26,846 | 85 |
| 2022 | 26,415 | 85 |
| 2023 | 26,375 | 85 |
| 2024 | 27,477 | 85 |
| 2025 | 26,327 | 85 |
| 2026 | 26,101 | 85 |

<details><summary>Columns</summary>

season (int64), team_id (int64), athlete_id (int64), division (string), position_id (int64), position (string), position_abbreviation (string), position_name (string), position_leaf (bool), position_parent_id (int64), games_rostered (int64), athlete_uid (string), athlete_guid (string), athlete_type (string), first_name (string), middle_name (string), last_name (string), full_name (string), display_name (string), athlete_display_name (string), short_name (string), nickname (string), slug (string), jersey (string), jersey_right (string), weight (double), display_weight (string), height (double), display_height (string), age (double), date_of_birth (string), hand_type (string), hand_abbreviation (string), hand_display_value (string), linked (bool), active (bool), alternate_ids_sdr (string), birth_place_city (string), birth_place_state (string), birth_place_country (string), birth_country_alternate_id (string), birth_country_abbreviation (string), citizenship (string), flag_href (string), flag_alt (string), flag_rel (string), headshot_href (string), headshot_alt (string), experience_years (double), experience_display_value (string), experience_abbreviation (string), status_id (string), status_name (string), status_type (string), status_abbreviation (string), draft_display_text (string), draft_round (double), draft_year (double), draft_selection (double), draft_team_href (string), team_guid (string), team_uid (string), team_slug (string), team_location (string), team_name (string), team_nickname (string), team_abbreviation (string), team_display_name (string), team_short_display_name (string), team_color (string), team_alternate_color (string), team_alternate_ids_sdr (string), is_active (bool), is_all_star (bool), logo_href (string), logo_dark_href (string), athlete_href (string), position_href (string), cfbd_recruit_ids (string), cfbd_home_city (string), cfbd_home_state (string), cfbd_home_country (string), cfbd_home_latitude (string), cfbd_home_longitude (string), cfbd_home_county_fips (string)

</details>

## espn_cfb_power_index

Seasons 2005–2026; missing: none; 7 columns (sample file `power_index_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2005 | 1,392 | 7 |
| 2006 | 1,570 | 7 |
| 2007 | 1,577 | 7 |
| 2008 | 1,603 | 7 |
| 2009 | 1,612 | 7 |
| 2010 | 1,616 | 7 |
| 2011 | 1,624 | 7 |
| 2012 | 1,682 | 7 |
| 2013 | 1,704 | 7 |
| 2014 | 1,740 | 7 |
| 2015 | 1,746 | 7 |
| 2016 | 1,752 | 7 |
| 2017 | 1,774 | 7 |
| 2018 | 1,790 | 7 |
| 2019 | 1,778 | 7 |
| 2020 | 1,375 | 7 |
| 2021 | 1,784 | 7 |
| 2022 | 1,800 | 7 |
| 2023 | 1,820 | 7 |
| 2024 | 1,838 | 7 |
| 2025 | 1,868 | 7 |
| 2026 | 1,776 | 7 |

<details><summary>Columns</summary>

season (int64), game_id (int64), team_id (int64), teampredptdiff (double), gameprojection (double), matchupquality (double), teamadjgamescore (null)

</details>

## espn_cfb_teams

Seasons 2001–2026; missing: none; 54 columns (sample file `cfb_teams_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2001 | 435 | 54 |
| 2002 | 471 | 54 |
| 2003 | 484 | 54 |
| 2004 | 484 | 54 |
| 2005 | 240 | 54 |
| 2006 | 514 | 54 |
| 2007 | 633 | 54 |
| 2008 | 693 | 54 |
| 2009 | 701 | 54 |
| 2010 | 705 | 54 |
| 2011 | 713 | 54 |
| 2012 | 736 | 54 |
| 2013 | 745 | 54 |
| 2014 | 770 | 54 |
| 2015 | 771 | 54 |
| 2016 | 774 | 54 |
| 2017 | 773 | 54 |
| 2018 | 778 | 54 |
| 2019 | 781 | 54 |
| 2020 | 777 | 54 |
| 2021 | 793 | 54 |
| 2022 | 848 | 54 |
| 2023 | 857 | 54 |
| 2024 | 817 | 54 |
| 2025 | 819 | 54 |
| 2026 | 827 | 54 |

<details><summary>Columns</summary>

season (int64), team_id (int64), uid (string), guid (string), slug (string), abbreviation (string), display_name (string), short_display_name (string), name (string), nickname (string), location (string), color (string), alternate_color (string), is_active (bool), is_all_star (bool), is_exhibition (bool), division (string), is_fbs (bool), team_group_id (int64), team_group_name (string), conference_id (int64), conference_name (string), conference_short_name (string), conference_abbreviation (string), conference_midsize_name (string), conference_slug (string), conference_is_conference (bool), conference_parent_id (int64), team_logo (string), team_logo_dark (string), conference_logo (string), venue_id (int64), venue_name (string), venue_city (string), venue_state (string), venue_indoor (bool), venue_grass (bool), school (string), mascot (string), alt_name1 (string), alt_name2 (string), alt_name3 (string), cfbd_conference (string), classification (string), city (string), state (string), country_code (string), timezone (string), latitude (double), longitude (double), elevation (string), capacity (int64), dome (bool), grass (bool)

</details>

## cfb_fpi_weekly

Seasons 2005–2026; missing: none; 51 columns (sample file `cfb_fpi_weekly_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2005 | 2,023 | 51 |
| 2006 | 2,023 | 51 |
| 2007 | 2,023 | 51 |
| 2008 | 2,040 | 51 |
| 2009 | 1,920 | 51 |
| 2010 | 1,920 | 51 |
| 2011 | 1,920 | 51 |
| 2012 | 1,984 | 51 |
| 2013 | 2,142 | 51 |
| 2014 | 2,176 | 51 |
| 2015 | 2,048 | 51 |
| 2016 | 2,048 | 51 |
| 2017 | 2,080 | 51 |
| 2018 | 2,210 | 51 |
| 2019 | 2,210 | 51 |
| 2020 | 2,151 | 51 |
| 2021 | 2,080 | 51 |
| 2022 | 2,096 | 51 |
| 2023 | 2,128 | 51 |
| 2024 | 2,278 | 51 |
| 2025 | 2,312 | 51 |
| 2026 | 1,518 | 51 |

<details><summary>Columns</summary>

season (int64), season_type (int64), week (int64), team_id (int64), last_updated (string), run_date_time_key (int64), snapshot_out_of_sequence (bool), fpi (double), fpirank (double), projectedw (double), projectedl (double), projectedt (null), projectedwpctrank (double), probwinout (double), probwinconf (double), sosremainingrank (double), accomplishment (double), accomplishmentrank (double), adjwins (double), adjlosses (double), adjwinpctrank (double), gamecontrol (double), gamecontrolrank (double), adjavgingamewp (double), adjavgingamewprank (double), avgingamewp (double), avgingamewprank (double), avgsosrank (double), topsosrank (double), epaoffense (double), epadefense (double), epaspecialteams (double), probwindiv (double), probmakeplayoffs (double), probmaketitlegame (double), numwins (double), numlosses (double), numties (double), probwintitle (double), rankchange7days (double), prob6wins (double), rank (double), offefficiency (double), offefficiencyrank (double), defefficiency (double), defefficiencyrank (double), stefficiency (double), stefficiencyrank (double), totefficiency (double), totefficiencyrank (double), snapshot_is_contemporaneous (bool)

</details>

## cfb_team_talent

Seasons 2005–2026; missing: none; 7 columns (sample file `cfb_team_talent_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2005 | 121 | 7 |
| 2006 | 125 | 7 |
| 2007 | 129 | 7 |
| 2008 | 137 | 7 |
| 2009 | 150 | 7 |
| 2010 | 165 | 7 |
| 2011 | 182 | 7 |
| 2012 | 212 | 7 |
| 2013 | 238 | 7 |
| 2014 | 281 | 7 |
| 2015 | 291 | 7 |
| 2016 | 305 | 7 |
| 2017 | 310 | 7 |
| 2018 | 306 | 7 |
| 2019 | 307 | 7 |
| 2020 | 305 | 7 |
| 2021 | 308 | 7 |
| 2022 | 308 | 7 |
| 2023 | 309 | 7 |
| 2024 | 317 | 7 |
| 2025 | 320 | 7 |
| 2026 | 312 | 7 |

<details><summary>Columns</summary>

season (int64), team_id (string), team (string), talent_composite (double), talent_rank (int64), blue_chip_ratio (double), n_recruits (int64)

</details>

## cfb_returning_production

Seasons 2004–2026; missing: none; 9 columns (sample file `cfb_returning_production_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2004 | 108 | 9 |
| 2005 | 161 | 9 |
| 2006 | 166 | 9 |
| 2007 | 179 | 9 |
| 2008 | 186 | 9 |
| 2009 | 193 | 9 |
| 2010 | 199 | 9 |
| 2011 | 195 | 9 |
| 2012 | 197 | 9 |
| 2013 | 202 | 9 |
| 2014 | 210 | 9 |
| 2015 | 214 | 9 |
| 2016 | 214 | 9 |
| 2017 | 222 | 9 |
| 2018 | 218 | 9 |
| 2019 | 225 | 9 |
| 2020 | 223 | 9 |
| 2021 | 146 | 9 |
| 2022 | 233 | 9 |
| 2023 | 234 | 9 |
| 2024 | 229 | 9 |
| 2025 | 236 | 9 |
| 2026 | 236 | 9 |

<details><summary>Columns</summary>

season (int64), team_id (string), off_returning (double), def_returning (double), overall_returning (double), n_returning (int64), def_basis (string), overall_basis (string), is_estimated (bool)

</details>

## cfb_team_info

Seasons 2001–2026; missing: none; 43 columns (sample file `cfb_team_info_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2001 | 246 | 43 |
| 2002 | 247 | 43 |
| 2003 | 260 | 43 |
| 2004 | 256 | 43 |
| 2005 | 256 | 43 |
| 2006 | 257 | 43 |
| 2007 | 256 | 43 |
| 2008 | 256 | 43 |
| 2009 | 258 | 43 |
| 2010 | 258 | 43 |
| 2011 | 261 | 43 |
| 2012 | 261 | 43 |
| 2013 | 265 | 43 |
| 2014 | 687 | 43 |
| 2015 | 687 | 43 |
| 2016 | 687 | 43 |
| 2017 | 687 | 43 |
| 2018 | 687 | 43 |
| 2019 | 682 | 43 |
| 2020 | 637 | 43 |
| 2021 | 670 | 43 |
| 2022 | 672 | 43 |
| 2023 | 672 | 43 |
| 2024 | 679 | 43 |
| 2025 | 681 | 43 |
| 2026 | 684 | 43 |

<details><summary>Columns</summary>

team_id (int32), school (string), mascot (string), abbreviation (string), alt_name1 (string), alt_name2 (string), alt_name3 (string), conference (string), division (string), classification (string), color (string), alt_color (string), logo (string), logo_2 (string), logos_3 (string), logos_4 (string), logos_5 (string), logos_6 (string), logos_7 (string), logos_8 (string), logos_9 (string), logos_10 (string), logos_11 (string), logos_12 (string), logos_13 (string), logos_14 (string), logos_15 (string), logos_16 (string), twitter (string), venue_id (int32), venue_name (string), city (string), state (string), zip (string), country_code (string), timezone (string), latitude (double), longitude (double), elevation (string), capacity (int32), year_constructed (int32), grass (bool), dome (bool)

</details>

## cfb_schedules

Seasons 2001–2026; missing: none; 43 columns (sample file `cfb_schedules_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2001 | 709 | 43 |
| 2002 | 772 | 43 |
| 2003 | 1,338 | 43 |
| 2004 | 1,307 | 43 |
| 2005 | 1,337 | 43 |
| 2006 | 1,405 | 43 |
| 2007 | 1,471 | 43 |
| 2008 | 1,486 | 43 |
| 2009 | 1,470 | 43 |
| 2010 | 1,464 | 43 |
| 2011 | 1,503 | 43 |
| 2012 | 1,391 | 43 |
| 2013 | 1,540 | 43 |
| 2014 | 1,592 | 43 |
| 2015 | 1,544 | 43 |
| 2016 | 1,555 | 43 |
| 2017 | 1,567 | 43 |
| 2018 | 1,570 | 43 |
| 2019 | 1,627 | 43 |
| 2020 | 1,247 | 43 |
| 2021 | 2,462 | 43 |
| 2022 | 3,713 | 43 |
| 2023 | 3,734 | 43 |
| 2024 | 3,801 | 43 |
| 2025 | 3,831 | 43 |
| 2026 | 3,678 | 43 |

<details><summary>Columns</summary>

game_id (int64), season (int64), week (int64), season_type (string), season_type_id (int64), start_date (string), start_time_tbd (bool), completed (bool), neutral_site (bool), conference_game (bool), conference_competition (bool), attendance (int64), venue_id (int64), venue (string), status (string), home_id (int64), home_team (string), home_abbreviation (string), home_division (string), home_conference (string), home_points (int64), home_winner (bool), away_id (int64), away_team (string), away_abbreviation (string), away_division (string), away_conference (string), away_points (int64), away_winner (bool), fbs_game (bool), fbs_participant (bool), highlights (string), notes (string), playoff_competition (string), playoff_format (string), playoff_round (string), playoff_round_name (string), playoff_bracket_slot (string), playoff_home_seed (int64), playoff_away_seed (int64), playoff_bowl_name (string), home_rank (int64), away_rank (int64)

</details>

## cfbfastR_cfb_pbp

Seasons 2014–2026; missing: none; 362 columns (sample file `play_by_play_2026.parquet`).

| season | rows | columns |
|---|---:|---:|
| 2014 | 158,188 | 362 |
| 2015 | 160,236 | 362 |
| 2016 | 158,600 | 362 |
| 2017 | 158,663 | 362 |
| 2018 | 160,514 | 362 |
| 2019 | 159,920 | 362 |
| 2020 | 99,955 | 362 |
| 2021 | 163,444 | 362 |
| 2022 | 252,307 | 362 |
| 2023 | 254,090 | 362 |
| 2024 | 277,048 | 362 |
| 2025 | 293,200 | 362 |
| 2026 | 226,709 | 362 |

<details><summary>Columns</summary>

year (int32), week (int32), id_play (double), game_id (int32), game_play_number (double), half_play_number (double), drive_play_number (double), pos_team (string), def_pos_team (string), pos_team_score (int32), def_pos_team_score (int32), half (double), period (int32), clock_minutes (int32), clock_seconds (int32), play_type (string), play_text (string), down (double), distance (double), yards_to_goal (double), yards_gained (double), EPA (double), ep_before (double), ep_after (double), wpa (double), wp_before (double), wp_after (double), def_wp_before (double), def_wp_after (double), penalty_detail (string), yds_penalty (double), penalty_1st_conv (bool), new_series (double), firstD_by_kickoff (double), firstD_by_poss (double), firstD_by_penalty (double), firstD_by_yards (double), def_EPA (double), home_EPA (double), away_EPA (double), home_EPA_rush (double), away_EPA_rush (double), home_EPA_pass (double), away_EPA_pass (double), total_home_EPA (double), total_away_EPA (double), total_home_EPA_rush (double), total_away_EPA_rush (double), total_home_EPA_pass (double), total_away_EPA_pass (double), net_home_EPA (double), net_away_EPA (double), net_home_EPA_rush (double), net_away_EPA_rush (double), net_home_EPA_pass (double), net_away_EPA_pass (double), success (double), epa_success (double), rz_play (double), scoring_opp (double), middle_8 (bool), stuffed_run (double), change_of_pos_team (double), downs_turnover (double), turnover (double), pos_score_diff_start (double), pos_score_pts (double), log_ydstogo (double), ExpScoreDiff (double), ExpScoreDiff_Time_Ratio (double), half_clock_minutes (double), TimeSecsRem (double), adj_TimeSecsRem (double), Goal_To_Go (bool), Under_two (bool), home (string), away (string), home_wp_before (double), away_wp_before (double), home_wp_after (double), away_wp_after (double), end_of_half (double), pos_team_receives_2H_kickoff (double), lead_pos_team (string), lead_play_type (string), lag_pos_team (string), lag_play_type (string), orig_play_type (string), Under_three (bool), row (int32), drive_event_number (double), play_number (int32), wallclock (string), provider (string), spread (double), formatted_spread (string), over_under (double), drive_is_home_offense (bool), drive_start_offense_score (int32), drive_start_defense_score (int32), drive_end_offense_score (int32), drive_end_defense_score (int32), play (double), event (double), game_event_number (double), game_row_number (int32), half_play (double), half_event (double), half_event_number (double), half_row_number (int32), pos_unit (string), def_pos_unit (string), drive_play (double), drive_event (double), venue_id (int32), venue (string), neutral_site (bool), conference_game (bool), season_type (string), start_date (string), completed (bool), home_team_id (string), home_team (string), home_team_division (string), home_team_conference (string), home_team_pregame_elo (int32), away_team_id (string), away_team (string), away_team_division (string), away_team_conference (string), away_team_pregame_elo (int32), season (int32), team (string), conference (string), opponent (string), team_score (int32), opponent_score (int32), down_end (double), distance_end (double), log_ydstogo_end (double), yards_to_goal_end (double), TimeSecsRem_end (double), Goal_To_Go_end (bool), Under_two_end (bool), offense_score_play (double), defense_score_play (double), ppa (double), yard_line (int32), scoring (bool), pos_team_timeouts_rem_before (double), def_pos_team_timeouts_rem_before (double), pos_team_timeouts (double), def_pos_team_timeouts (double), pos_score_diff (int32), pos_score_diff_start_end (double), offense_play (string), defense_play (string), offense_receives_2H_kickoff (double), change_of_poss (double), score_pts (double), score_diff_start (double), score_diff (int32), offense_score (int32), defense_score (int32), offense_conference (string), defense_conference (string), off_timeout_called (double), def_timeout_called (double), offense_timeouts (double), defense_timeouts (double), off_timeouts_rem_before (double), def_timeouts_rem_before (double), rusher_player_name (string), yds_rushed (double), passer_player_name (string), receiver_player_name (string), yds_receiving (double), yds_sacked (double), sack_players (string), sack_player_name (string), sack_player_name2 (string), pass_breakup_player_name (string), interception_player_name (string), yds_int_return (double), fumble_player_name (string), fumble_forced_player_name (string), fumble_recovered_player_name (string), yds_fumble_return (double), punter_player_name (string), yds_punted (double), punt_returner_player_name (string), yds_punt_return (double), yds_punt_gained (double), punt_block_player_name (string), punt_block_return_player_name (string), fg_kicker_player_name (string), yds_fg (double), fg_block_player_name (string), fg_return_player_name (string), kickoff_player_name (string), yds_kickoff (double), kickoff_returner_player_name (string), yds_kickoff_return (double), new_id (double), orig_drive_number (int32), drive_number (int32), drive_result_detailed (string), new_drive_pts (double), drive_id (double), drive_result (string), drive_start_yards_to_goal (double), drive_end_yards_to_goal (int32), drive_yards (int32), drive_scoring (double), drive_pts (double), drive_start_period (int32), drive_end_period (int32), drive_time_minutes_start (int32), drive_time_seconds_start (int32), drive_time_minutes_end (int32), drive_time_seconds_end (int32), drive_time_minutes_elapsed (int32), drive_time_seconds_elapsed (int32), drive_numbers (double), number_of_drives (double), pts_scored (double), drive_result_detailed_flag (string), drive_result2 (string), drive_num (double), lag_drive_result_detailed (string), lead_drive_result_detailed (string), lag_new_drive_pts (double), id_drive (double), rush (double), rush_td (double), pass (double), pass_td (double), completion (double), pass_attempt (double), target (double), sack_vec (double), sack (double), int (double), int_td (double), turnover_vec (double), turnover_vec_lag (double), turnover_indicator (double), kickoff_play (double), receives_2H_kickoff (double), missing_yard_flag (bool), scoring_play (double), td_play (double), touchdown (double), safety (double), fumble_vec (double), kickoff_tb (double), kickoff_onside (double), kickoff_oob (double), kickoff_fair_catch (double), kickoff_downed (double), kickoff_safety (double), kick_play (double), punt (double), punt_play (double), punt_tb (double), punt_oob (double), punt_fair_catch (double), punt_downed (double), punt_safety (double), punt_blocked (double), penalty_safety (double), fg_inds (double), fg_made (bool), fg_make_prob (double), No_Score_before (double), FG_before (double), Opp_FG_before (double), Opp_Safety_before (double), Opp_TD_before (double), Safety_before (double), TD_before (double), No_Score_after (double), FG_after (double), Opp_FG_after (double), Opp_Safety_after (double), Opp_TD_after (double), Safety_after (double), TD_after (double), position_reception (string), position_target (string), position_completion (string), position_incompletion (string), position_sack_taken (string), position_sack (string), position_interception_thrown (string), position_interception (string), position_fumble (string), position_fumble_forced (string), position_fumble_recovered (string), position_pass_breakup (string), position_rush (string), position_touchdown (string), rush_player_id (double), rush_player (string), rush_yds (int32), reception_player_id (double), reception_player (string), reception_yds (int32), completion_player_id (double), completion_player (string), completion_yds (int32), interception_player_id (double), interception_player (string), interception_stat (int32), interception_thrown_player_id (double), interception_thrown_player (string), interception_thrown_stat (int32), touchdown_player_id (double), touchdown_player (string), touchdown_stat (int32), incompletion_player_id (double), incompletion_player (string), incompletion_stat (int32), target_player_id (double), target_player (string), target_stat (int32), fumble_recovered_player_id (double), fumble_recovered_player (string), fumble_recovered_stat (int32), fumble_forced_player_id (double), fumble_forced_player (string), fumble_forced_stat (int32), fumble_player_id (double), fumble_player (string), fumble_stat (int32), sack_player_id (double), sack_player (string), sack_stat (int32), sack_taken_player_id (double), sack_taken_player (string), sack_taken_stat (int32), pass_breakup_player_id (double), pass_breakup_player (string), pass_breakup_stat (int32), field_goal_attempt_player_id (string), field_goal_attempt_player (string), field_goal_attempt_stat (int32), field_goal_made_player_id (string), field_goal_made_player (string), field_goal_made_stat (int32), field_goal_missed_player_id (string), field_goal_missed_player (string), field_goal_missed_stat (int32), field_goal_blocked_player_id (string), field_goal_blocked_player (string), field_goal_blocked_stat (int32), penalty_flag (bool), penalty_declined (bool), penalty_no_play (bool), penalty_offset (bool), penalty_text (bool), penalty_play_text (string)

</details>
