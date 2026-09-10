#!/usr/bin/env bash
# Pull every nflverse source Football Savant needs into raw/ (about 750 MB for all seasons).
#
# Idempotent: a file that is already there and non-empty is skipped, so a failed run can
# just be re-run. The exception is an in-progress season, which changes every night:
#
#   NFL_REFRESH=2026 ./fetch.sh      re-download that season's files, plus the files that
#                                    ship all-seasons-in-one (PFR, NGS, players, QBR,
#                                    schedule, combine), before the usual fetch
#   NFL_SEASONS=2026 ./fetch.sh      only pull that season's per-season files
#                                    ("1999-2026", "2024,2025" also work; default: all)
#
# The season-total stat table (reg_<y>.csv, under 1 MB) is pulled for every season up to
# the last one asked for regardless, because the FG-over-expected curve pools all of them.
#
# A 404 is reported as MISS and is not an error: the first days of a new season, nflverse
# has no files for it yet, and the build simply won't include it.
set -u
BASE="https://github.com/nflverse/nflverse-data/releases/download"
OUT="${NFL_RAW:-raw}"
mkdir -p "$OUT" "$OUT/part" "$OUT/pbp"
THIS_YEAR=$(date +%Y); THIS_MONTH=$(date +%m)
if [ "$THIS_MONTH" -ge 8 ]; then CUR=$THIS_YEAR; else CUR=$((THIS_YEAR-1)); fi
FIRST=1999; LAST=$CUR
case "${NFL_SEASONS:-}" in
  "") ;;
  *-*) FIRST=${NFL_SEASONS%-*}; LAST=${NFL_SEASONS#*-} ;;
  *,*) echo "fetch.sh: comma lists are not supported here; use a range" >&2; exit 2 ;;
  *) FIRST=$NFL_SEASONS; LAST=$NFL_SEASONS ;;
esac

if [ -n "${NFL_REFRESH:-}" ]; then
  y=$NFL_REFRESH
  rm -f "$OUT/reg_$y.csv" "$OUT/wk_$y.csv" "$OUT/snaps_$y.csv" \
        "$OUT/part/part_$y.csv" "$OUT/pbp/pbp_$y.parquet" \
        "$OUT"/adv_*.csv "$OUT"/ngs_*.csv "$OUT"/ngs_*.csv.gz \
        "$OUT/players.csv" "$OUT/qbr.csv" "$OUT/schedules.csv" "$OUT/combine.csv"
  echo "refreshing $y"
fi

get(){ # url_path outfile
  if [ -s "$OUT/$2" ]; then echo "have $2"; return; fi
  code=$(curl -sSL -m 300 --retry 3 --retry-delay 5 -o "$OUT/$2.tmp" -w "%{http_code}" "$BASE/$1")
  if [ "$code" = "200" ]; then mv "$OUT/$2.tmp" "$OUT/$2"; echo "ok   $2 ($(wc -c <"$OUT/$2") bytes)";
  else rm -f "$OUT/$2.tmp"; echo "MISS $2 ($code)"; fi
}

for y in $(seq 1999 "$LAST"); do get "stats_player/stats_player_reg_$y.csv" "reg_$y.csv"; done

# Everything else per season, only for the seasons being built.
for y in $(seq "$FIRST" "$LAST"); do
  get "stats_player/stats_player_week_$y.csv" "wk_$y.csv"
  [ "$y" -ge 2012 ] && get "snap_counts/snap_counts_$y.csv" "snaps_$y.csv"
  # Participation: the eleven on the field per play, plus was_pressure. 2016 on. Since
  # 2023 it is published after the season, so an in-progress season will MISS — expected.
  [ "$y" -ge 2016 ] && get "pbp_participation/pbp_participation_$y.csv" "part/part_$y.csv"
  # Play-by-play, as parquet — a twentieth the size of the CSV and column-selectable
  get "pbp/play_by_play_$y.parquet" "pbp/pbp_$y.parquet"
done

# All-seasons-in-one files
for k in pass rush rec def; do get "pfr_advstats/advstats_season_$k.csv" "adv_$k.csv"; done
# Next Gen Stats ship gzipped
for k in passing rushing receiving; do
  if [ ! -s "$OUT/ngs_$k.csv" ]; then
    code=$(curl -sSL -m 300 --retry 3 --retry-delay 5 -o "$OUT/ngs_$k.csv.gz" -w "%{http_code}" "$BASE/nextgen_stats/ngs_$k.csv.gz")
    if [ "$code" = "200" ] && gunzip -f "$OUT/ngs_$k.csv.gz"; then echo "ok   ngs_$k.csv";
    else rm -f "$OUT/ngs_$k.csv.gz"; echo "MISS ngs_$k.csv ($code)"; fi
  else echo "have ngs_$k.csv"; fi
done
get "combine/combine.csv" "combine.csv"
get "players/players.csv" "players.csv"
get "espn_data/qbr_season_level.csv" "qbr.csv"
get "schedules/games.csv" "schedules.csv"
