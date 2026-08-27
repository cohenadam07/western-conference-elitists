#!/usr/bin/env bash
# Pull every nflverse source Football Savant needs into raw/ (about 750 MB).
# Idempotent: a file that is already there and non-empty is skipped, so a failed run
# can just be re-run.
set -u
BASE="https://github.com/nflverse/nflverse-data/releases/download"
OUT="${NFL_RAW:-raw}"
mkdir -p "$OUT"
get(){ # url_path outfile
  if [ -s "$OUT/$2" ]; then echo "have $2"; return; fi
  code=$(curl -sSL -m 300 -o "$OUT/$2.tmp" -w "%{http_code}" "$BASE/$1")
  if [ "$code" = "200" ]; then mv "$OUT/$2.tmp" "$OUT/$2"; echo "ok   $2 ($(stat -c%s "$OUT/$2") bytes)";
  else rm -f "$OUT/$2.tmp"; echo "MISS $2 ($code)"; fi
}
for y in $(seq 1999 2025); do
  get "stats_player/stats_player_reg_$y.csv" "reg_$y.csv"
  get "stats_player/stats_player_week_$y.csv" "wk_$y.csv"
done
for y in $(seq 2012 2025); do get "snap_counts/snap_counts_$y.csv" "snaps_$y.csv"; done
for k in pass rush rec def; do get "pfr_advstats/advstats_season_$k.csv" "adv_$k.csv"; done
# Next Gen Stats ship gzipped and all-seasons-in-one
mkdir -p "$OUT"
for k in passing rushing receiving; do
  if [ ! -s "$OUT/ngs_$k.csv" ]; then
    curl -sSL -m 300 -o "$OUT/ngs_$k.csv.gz" "$BASE/nextgen_stats/ngs_$k.csv.gz" \
      && gunzip -f "$OUT/ngs_$k.csv" 2>/dev/null || gunzip -f "$OUT/ngs_$k.csv.gz"
    echo "ok   ngs_$k.csv"
  fi
done
# Participation: the eleven on the field per play, plus was_pressure. 2016 on.
# This is what makes offensive-line measurement possible at all.
mkdir -p "$OUT/part"
for y in $(seq 2016 2025); do
  f="$OUT/part/part_$y.csv"
  [ -s "$f" ] && continue
  code=$(curl -sSL -m 300 -o "$f.tmp" -w "%{http_code}" "$BASE/pbp_participation/pbp_participation_$y.csv")
  if [ "$code" = "200" ]; then mv "$f.tmp" "$f"; echo "ok   part_$y.csv";
  else rm -f "$f.tmp"; echo "MISS part_$y ($code)"; fi
done
# Play-by-play, as parquet — a twentieth the size of the CSV and column-selectable
mkdir -p "$OUT/pbp"
for y in $(seq 1999 2025); do
  f="$OUT/pbp/pbp_$y.parquet"
  [ -s "$f" ] && continue
  code=$(curl -sSL -m 300 -o "$f.tmp" -w "%{http_code}" "$BASE/pbp/play_by_play_$y.parquet")
  if [ "$code" = "200" ]; then mv "$f.tmp" "$f"; echo "ok   pbp_$y.parquet";
  else rm -f "$f.tmp"; echo "MISS pbp_$y ($code)"; fi
done
get "combine/combine.csv" "combine.csv"
get "players/players.csv" "players.csv"
get "espn_data/qbr_season_level.csv" "qbr.csv"
