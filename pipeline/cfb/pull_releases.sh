#!/bin/bash
# College Football Savant research: download the sportsdataverse-data release files.
# No key, no quota. Parquet only. Raw files live OUTSIDE the repo and never go in git.
#   bash pipeline/cfb/pull_releases.sh            # everything the backtest reads
set -u
RAW="${CFB_RAW:-$HOME/College-Football-Savant/raw}"
LOG="${CFB_LOGS:-$HOME/College-Football-Savant/logs}/pull_releases.log"
REPO=sportsdataverse/sportsdataverse-data
mkdir -p "$RAW" "$(dirname "$LOG")"

# tag : glob of the assets we want
TAGS=(
  "espn_cfb_pbp:play_by_play_*.parquet"
  "espn_cfb_play_participants:play_participants_*.parquet"
  "espn_cfb_player_box:player_box_*.parquet"
  "espn_cfb_team_box:team_box_*.parquet"
  "espn_cfb_drives:drives_*.parquet"
  "espn_cfb_game_rosters:game_rosters_*.parquet"
  "espn_cfb_betting:betting_*.parquet"
  "espn_cfb_schedules:cfb_schedule_*.parquet"
  "espn_cfb_linescores:linescores_*.parquet"
  "espn_cfb_rosters:cfb_rosters_*.parquet"
  "espn_cfb_power_index:power_index_*.parquet"
  "espn_cfb_teams:cfb_teams_*.parquet"
  "cfb_fpi_weekly:cfb_fpi_weekly_*.parquet"
  "cfb_team_talent:*.parquet"
  "cfb_returning_production:*.parquet"
  "cfb_team_info:*.parquet"
  "cfb_schedules:*.parquet"
  "cfb_groups:*.parquet"
  "cfb_poll_analytics:*.parquet"
  "cfbfastR_cfb_pbp:play_by_play_*.parquet"
)
for entry in "${TAGS[@]}"; do
  tag="${entry%%:*}"; pat="${entry#*:}"
  mkdir -p "$RAW/$tag"
  echo "$(date -u +%FT%TZ) start $tag ($pat)" >> "$LOG"
  for try in 1 2 3; do
    if gh release download "$tag" -R "$REPO" -p "$pat" -D "$RAW/$tag" --skip-existing >> "$LOG" 2>&1; then
      break
    fi
    echo "$(date -u +%FT%TZ) retry $try $tag" >> "$LOG"; sleep 10
  done
  n=$(ls "$RAW/$tag" | wc -l | tr -d ' '); sz=$(du -sh "$RAW/$tag" | cut -f1)
  echo "$(date -u +%FT%TZ) done  $tag files=$n size=$sz" >> "$LOG"
done
echo "$(date -u +%FT%TZ) ALL DONE" >> "$LOG"
