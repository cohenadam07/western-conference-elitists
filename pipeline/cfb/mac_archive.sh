#!/bin/bash
# mac_archive.sh — College Football Savant's private raw archive (launchd com.wcehoops.cfb-mac-archive, 5:23am).
# Every night: fetches the season being played into this Mac's cache, so the Mac holds every raw ESPN response the
# site was built from (the cloud's copy lives in the Actions cache, which expires). On the 1st: packs last month into
# ~/College-Football-Savant/archive/cfb-raw-YYYY-MM.tar and checks every member parses. Nothing here leaves the Mac
# (Adam, Nov 10 2026: raw ESPN stays off GitHub). Quiet outside the season window. Modeled on pipeline/college/mac_pull.sh.
# Log: ~/College-Football-Savant/logs/cfb-mac.log
set -uo pipefail
SITE="${SITE:-$HOME/western-conference-elitists}"
CODE="${CODE:-$SITE/.worktrees/savant-bot}"
PY="${PYTHON:-$HOME/College-Football-Savant/venv/bin/python}"
LOG="$HOME/College-Football-Savant/logs/cfb-mac.log"
mkdir -p "$(dirname "$LOG")"
[ -t 1 ] || exec >> "$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
cd "$CODE" || { echo "no code at $CODE"; exit 1; }
[ -f pipeline/cfb/archive.py ] || { echo "pipeline/cfb is not on main yet: nothing to do"; exit 0; }
free=$(df -k "$HOME" | tail -1 | awk '{print int($4/1048576)}')
[ "$free" -ge 8 ] || { echo "only ${free} GB free: skipped (BUILD ground rule 2)"; exit 0; }
if [ "$(date +%d)" = "01" ]; then
  M=$(date -v-1d +%Y-%m)
  "$PY" -m pipeline.cfb.archive pack "$M" && "$PY" -m pipeline.cfb.archive verify "$M" || echo "archive pack failed"
fi
if "$PY" -m pipeline.cfb.build active; then
  "$PY" -W ignore -m pipeline.cfb.archive pull || echo "archive pull failed"
else
  echo "offseason: no pull"
fi
