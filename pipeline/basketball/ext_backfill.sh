#!/bin/bash
# ext_backfill.sh — run once on Adam's Mac: pulls the October 2026 additions' history from
# stats.nba.com season by season (newest first) and pushes each finished season to the
# ext-seed branch, where the build that writes public/savant-ext/ picks it up.
#
#   bash ext_backfill.sh <code_dir> [first_season] [last_season] [phases]
#
# phases (ext_fetch.fetch_season): "league,teams,extra,shots" by default: every league- and
# team-level table, about 170 requests a season. "players" (a passing network per player,
# ~400 a season, 2013-14 on) and "games" (a defensive box score per game, ~1,230 a season,
# 2017-18 on) are slow on stats.nba.com and run as their own passes afterwards (ext_backfill_all.sh).
#
# <code_dir> holds this script and the ext_*.py modules; the rest of the engine comes from the
# savant-bot worktree (origin/main), the cache from ~/Basketball-Savant, as for the nightly job.
# Safe to re-run: every request is cached, every season export skips files already there.
set -uo pipefail
CODE="$1"; FIRST="${2:-2025-26}"; LAST="${3:-1996-97}"; PHASES="${4:-league,teams,extra,shots}"
SAVANT="$HOME/Basketball-Savant"
SITE="$HOME/western-conference-elitists"
WT="$SITE/.worktrees/savant-bot"
OUT="$SAVANT/ext/seed"
PY="${PYTHON:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"
mkdir -p "$OUT" "$SAVANT/logs"
LOG="$SAVANT/logs/ext-backfill.log"

push_seed() {
  local msg="$1"
  local IDX="$SAVANT/ext/seed.index"
  ( export GIT_DIR="$SITE/.git" GIT_WORK_TREE="$OUT" GIT_INDEX_FILE="$IDX"
    cd "$OUT" && git add -A . >/dev/null 2>&1
    TREE=$(git write-tree) || exit 1
    PARENT=$(git rev-parse -q --verify refs/heads/ext-seed)
    COMMIT=$(git -c user.name="basketball-savant-bot" -c user.email="bot@wcehoops.com" \
             commit-tree "$TREE" ${PARENT:+-p $PARENT} -m "$msg") || exit 1
    git update-ref refs/heads/ext-seed "$COMMIT"
    git push -q origin ext-seed:refs/heads/ext-seed && echo "pushed ext-seed: $msg" ) >> "$LOG" 2>&1
}

y1=${FIRST:0:4}; y2=${LAST:0:4}
cd "$SAVANT" || exit 1
for (( y=y1; y>=y2; y-- )); do
  s="$y-$(printf '%02d' $(( (y + 1) % 100 )))"
  PYTHONPATH="$CODE:$WT/pipeline/basketball" caffeinate -i "$PY" -u "$CODE/ext_backfill.py" "$OUT" "$s" "$s" "$PHASES" >> "$LOG" 2>&1
  push_seed "ext seed $s ($PHASES)"
done
echo "=== backfill $FIRST..$LAST ($PHASES) finished $(date) ===" >> "$LOG"
