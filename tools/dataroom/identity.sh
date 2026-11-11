#!/bin/bash
# tools/dataroom/identity.sh — a refresh of the current season is byte-identical to a full build
# (research/data-room/BUILD.md §6 step 4).
#
#   bash tools/dataroom/identity.sh [ufc] [cfb] [nfl] [nba]      (default: every sport it can run here)
#
# Each sport's refresh step (the workflows' "Data Room" steps, pipeline/basketball/cloud_refresh.py,
# pipeline/cfb/cloud_run.sh) calls the same builder function as the full build, for one season. So
# the check builds the current season twice, once as the full build writes it (into A) and once as
# the refresh step does (into B, a fresh directory, nothing carried over), and compares the bytes.
# A difference means something in the build depends on the run (a time stamp, a dict order, a
# leftover file) and the refresh would rewrite history it didn't change.
#
# Needs the inputs each builder reads: the work tables in ~/College-Football-Savant/work (cfb), the
# nflverse files under NFL_RAW (nfl), the ESPN cache under NBA_ESPN_CACHE and SSL_CERT_FILE (nba).
# A sport whose inputs are not on this machine is reported as skipped, never as passed.
set -u
cd "$(dirname "$0")/../.."
SPORTS="${*:-ufc cfb nfl nba}"
A=$(mktemp -d); B=$(mktemp -d)
trap 'rm -rf "$A" "$B"' EXIT
fail=0
same() {   # same <label> <dirA> <dirB>
  local diffs; diffs=$(cd "$2" && find . -name '*.json.gz' | sort | while read -r f; do cmp -s "$f" "$3/$f" || echo "$f"; done)
  local n; n=$(cd "$2" && find . -name '*.json.gz' | wc -l | tr -d ' ')
  if [ "$n" = 0 ]; then echo "FAIL  $1: nothing was built"; fail=1
  elif [ -n "$diffs" ]; then echo "FAIL  $1: differs: $diffs"; fail=1
  else echo "ok    $1: $n file(s) byte-identical"; fi
}
for s in $SPORTS; do
  case $s in
    ufc)
      DATAROOM_PUBLIC="$A/ufc" python3 pipeline/dataroom/ufc.py >/dev/null && DATAROOM_PUBLIC="$B/ufc" python3 pipeline/dataroom/ufc.py >/dev/null
      same "ufc fights and rounds, every year" "$A/ufc" "$B/ufc" ;;
    cfb)
      Y=$(python3 -c "from pipeline.cfb import config as C; print(C.CURRENT)")
      if [ ! -d "${CFB_HOME:-$HOME/College-Football-Savant}/work" ]; then echo "skip  cfb: no work tables here"; continue; fi
      for d in "$A/cfb" "$B/cfb"; do DATAROOM_HOSTED="$d" DATAROOM_PUBLIC="$d" python3 -W ignore pipeline/dataroom/cfb.py plays "$Y" >/dev/null && DATAROOM_HOSTED="$d" DATAROOM_PUBLIC="$d" python3 -W ignore pipeline/dataroom/cfb.py games "$Y" >/dev/null; done
      same "cfb plays and games $Y" "$A/cfb" "$B/cfb" ;;
    nfl)
      Y=$(date +%Y); [ "$(date +%m)" -ge 8 ] || Y=$((Y-1))
      if [ ! -s "${NFL_RAW:-pipeline/football/raw}/pbp/pbp_$Y.parquet" ]; then echo "skip  nfl: no $Y play-by-play under NFL_RAW"; continue; fi
      for d in "$A/nfl" "$B/nfl"; do for t in plays games player_games; do DATAROOM_HOSTED="$d" DATAROOM_PUBLIC="$d" python3 pipeline/dataroom/nfl.py $t "$Y" >/dev/null; done; done
      same "nfl plays, games and player-games $Y" "$A/nfl" "$B/nfl" ;;
    nba)
      if [ -z "${NBA_ESPN_CACHE:-}" ]; then echo "skip  nba: set NBA_ESPN_CACHE to an ESPN cache (the cloud's .espn-cache/<season>)"; continue; fi
      S=$(python3 -c "import json;print(json.load(open('public/savant-current.json'))['seasons'][0])")
      for d in "$A/nba" "$B/nba"; do (mkdir -p "$d/run/out" && cp pipeline/basketball/seed/out/* "$d/run/out/" 2>/dev/null; cd "$d/run" && DATAROOM_HOSTED="$d/out" python3 -W ignore "$OLDPWD/tools/dataroom/nba_current.py" "$S" "$NBA_ESPN_CACHE" >/dev/null); done
      same "nba player-games and shots $S" "$A/nba/out" "$B/nba/out" ;;
  esac
done
exit $fail
