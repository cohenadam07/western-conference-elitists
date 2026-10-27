#!/bin/bash
# publish_tracking.sh — run on Adam's Mac by launchd (com.wcehoops.basketball-savant-tracking):
# 4:30am and 10:30am ET, and once on wake if the Mac slept through a slot.
#
# Exports the NBA tables the cloud can't reach (export_tracking.py) and force-pushes them as a
# single commit to the tracking-data branch. That push starts the cloud refresh
# (basketball-savant-cloud.yml), which folds them into the season file. The Mac never writes
# the site's files itself, so the cloud and the Mac can't overwrite each other.
#
# The engine code comes from the repo (a worktree pinned to origin/main), so the Mac and the
# cloud always make the same requests; the cache and models stay in ~/Basketball-Savant.
# Log: ~/Basketball-Savant/logs/tracking.log
set -uo pipefail

SAVANT="$HOME/Basketball-Savant"
SITE="$HOME/western-conference-elitists"
WT="$SITE/.worktrees/savant-bot"
OUT="$SAVANT/out/tracking-export"
PY="${PYTHON:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"

mkdir -p "$SAVANT/logs"
exec >> "$SAVANT/logs/tracking.log" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="

LOCK="$SAVANT/logs/.publish.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK"
  else echo "another run is in progress; skipping"; exit 0; fi
fi
trap 'rm -rf "$LOCK"' EXIT

# Fresh engine code from main.
git -C "$SITE" fetch -q origin main || { echo "fetch failed"; exit 1; }
if [ ! -d "$WT" ]; then git -C "$SITE" worktree add -q --detach "$WT" origin/main || exit 1; fi
git -C "$WT" checkout -q --detach -f origin/main || { echo "checkout failed"; exit 1; }

cd "$SAVANT" || exit 1
PYTHONPATH="$WT/pipeline/basketball" "$PY" -u "$WT/pipeline/basketball/export_tracking.py" "$OUT" || { echo "export failed"; exit 1; }
[ -f "$OUT/manifest.json" ] || { echo "no manifest; nothing to push"; exit 1; }

# One parentless commit with just these files, so the branch never grows a history.
IDX=$(mktemp -u)   # a path only: git creates the index itself
export GIT_DIR="$SITE/.git" GIT_WORK_TREE="$OUT" GIT_INDEX_FILE="$IDX"
(cd "$OUT" && git add -A .) && TREE=$(git write-tree) || { rm -f "$IDX"; echo "write-tree failed"; exit 1; }
THROUGH=$("$PY" -c "import json;print(json.load(open('$OUT/manifest.json')).get('through'))")
COMMIT=$(git -c user.name="basketball-savant-bot" -c user.email="bot@wcehoops.com" commit-tree "$TREE" -m "Basketball Savant tracking tables (through $THROUGH)")
unset GIT_WORK_TREE GIT_INDEX_FILE
rm -f "$IDX"
git push -q -f origin "$COMMIT:refs/heads/tracking-data" && echo "pushed tracking tables through $THROUGH" || { echo "push failed"; exit 1; }
date '+%Y-%m-%dT%H:%M:%S%z' > "$SAVANT/logs/tracking-last-ok"
# Start the cloud refresh now rather than at its next 15-minute check (which would also find it).
cd "$SITE" && gh workflow run basketball-savant-cloud.yml --ref main -f mode=once -f force=false >/dev/null 2>&1 \
  && echo "started the cloud refresh" || echo "couldn't start the cloud refresh (its 15-minute check will pick this up)"
