#!/bin/bash
# publish_bundles.sh — after a full build on the Mac, push the saved bundles (out/bcs/bundles)
# and the registry to the bcs-bundles branch, where the cloud's merge-mode refresh reads them.
# Force-pushed like tracking-data: a snapshot, no history.
set -euo pipefail
OUT="${BCS_OUT:-$HOME/Basketball-Savant/out/bcs}"
SITE="${SITE:-$HOME/western-conference-elitists}"
IDX="$OUT/.bundles.index"
( export GIT_DIR="$SITE/.git" GIT_WORK_TREE="$OUT" GIT_INDEX_FILE="$IDX"
  cd "$OUT"
  rm -f "$IDX"
  git add -f bundles registry.json preseason_odds.json br_coaches.json nba_headers.json 2>/dev/null
  TREE=$(git write-tree)
  COMMIT=$(git -c user.name="basketball-savant-bot" -c user.email="bot@wcehoops.com" commit-tree "$TREE" -m "coaching bundles $(date -u +%Y-%m-%dT%H:%M)")
  git push -q -f origin "$COMMIT:refs/heads/bcs-bundles" && echo "pushed bcs-bundles" )
