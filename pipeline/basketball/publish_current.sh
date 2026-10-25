#!/bin/bash
# publish_current.sh — the nightly Basketball Savant refresh, end to end.
#
#   1. refresh_current.py rebuilds the season in progress into out/current.json
#      (exit 3 = no regular-season games yet: a quiet success, nothing to publish)
#   2. the file is copied into a dedicated worktree of the site repo that always tracks
#      origin/main — never into ~/western-conference-elitists itself, so whatever branch or
#      uncommitted work is sitting there is never touched
#   3. if the data changed (the `generated` stamp alone doesn't count), it is committed as
#      basketball-savant-bot and pushed to main; Vercel deploys from there
#
# Two launchd jobs call it:
#   com.wcehoops.basketball-savant        4:30am and 10:30am ET, always runs (catches the
#                                         tracking tables, which finish overnight, and corrections)
#   com.wcehoops.basketball-savant-watch  every 15 minutes with --watch: runs only when a game
#                                         has been final 30+ minutes and isn't published yet
#                                         (slate_watch.py), so each slate shows up within the hour
# Logs to logs/refresh.log (the watcher's quiet checks go to logs/watch.log). logs/last-ok
# records the last good run; the GitHub freshness check (basketball-savant-freshness.yml) is
# what tells Adam when runs stop landing.
set -uo pipefail

SAVANT="$HOME/Basketball-Savant"
SITE="$HOME/western-conference-elitists"
WT="$SITE/.worktrees/savant-bot"
PY="${PYTHON:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"

cd "$SAVANT" || exit 1
mkdir -p logs

# One run at a time: the watcher and the scheduled run share the worktree.
LOCK="$SAVANT/logs/.publish.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK"   # stale lock
  else echo "$(date '+%H:%M') another run is in progress; skipping"; exit 0; fi
fi
trap 'rm -rf "$LOCK"' EXIT

WATCH=""
if [ "${1:-}" = "--watch" ]; then
  WATCH=1
  "$PY" slate_watch.py check >> logs/watch.log 2>&1
  [ $? -eq 10 ] || exit 0          # nothing new is final; stay quiet
  exec >> logs/refresh.log 2>&1    # a refresh is due: log it with the others
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') (after a slate) ==="
else
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
fi

# DRY_RUN=1: publish whatever out/current.json already holds, commit in the worktree, but
# don't push (for testing the git side without touching main).
if [ -n "${DRY_RUN:-}" ]; then rc=0; else "$PY" -u refresh_current.py; rc=$?; fi
NOGAMES=""
if [ $rc -eq 3 ]; then echo "no games yet; publishing preseason projections only"; NOGAMES=1; fi
if [ $rc -ne 0 ]; then echo "refresh failed (exit $rc)"; exit $rc; fi

# A worktree of the site repo pinned to origin/main (detached, so no branch is ever locked).
grep -qx '.worktrees/' "$SITE/.git/info/exclude" 2>/dev/null || echo '.worktrees/' >> "$SITE/.git/info/exclude"
git -C "$SITE" fetch -q origin main || { echo "fetch failed"; exit 1; }
if [ ! -d "$WT" ]; then
  git -C "$SITE" worktree add -q --detach "$WT" origin/main || { echo "worktree add failed"; exit 1; }
fi
cd "$WT" || exit 1
git checkout -q --detach -f origin/main || { echo "checkout failed"; exit 1; }

# Projections (Fantasy tab and connector): rebuilt every run, published next to the data.
(cd "$SAVANT" && SAVANT_PUBLIC="$WT/public" "$PY" -u projections.py build) || echo "projections failed; publishing the data without them"
[ -f "$SAVANT/out/savant-proj.json" ] && cp "$SAVANT/out/savant-proj.json" public/savant-proj.json

# Teams and Lineups tabs: the season in progress (schedule ahead included), every run.
mkdir -p "$SAVANT/out/site"
(cd "$SAVANT" && "$PY" -u teams_engine.py current "$SAVANT/out/site") || echo "teams failed; publishing without them"
[ -f "$SAVANT/out/site/savant-teams-current.json" ] && cp "$SAVANT/out/site/savant-teams-current.json" public/savant-teams-current.json
if [ -d "$SAVANT/out/site/lineups" ]; then mkdir -p public/lineups && cp "$SAVANT"/out/site/lineups/*.json public/lineups/ 2>/dev/null; fi

# Publish only real changes: compare everything except the `generated` stamp.
if [ -n "$NOGAMES" ]; then
  MSG=""
  for f in public/savant-proj.json public/savant-teams-current.json public/lineups; do [ -e "$f" ] && git add "$f"; done
  if git diff --cached --quiet; then echo "projections unchanged"; exit 0; fi
  if [ -n "${DRY_RUN:-}" ]; then echo "DRY_RUN: would push preseason projections"; exit 0; fi
  git -c user.name="basketball-savant-bot" -c user.email="bot@wcehoops.com" commit -q -m "Basketball Savant: preseason projections $(date '+%Y-%m-%d')"
  git push -q origin HEAD:main || { git fetch -q origin main && git rebase -q origin/main && git push -q origin HEAD:main; } || { echo "push failed"; exit 1; }
  echo "pushed preseason projections"; exit 0
fi
if ! "$PY" - "$SAVANT/out/current.json" public/savant-current.json <<'EOF'
import json, sys
new = json.load(open(sys.argv[1]))
try:
    old = json.load(open(sys.argv[2]))
except Exception:
    sys.exit(1)                       # nothing published yet -> publish
strip = lambda d: {k: v for k, v in d.items() if k != "generated"}
sys.exit(0 if strip(new) == strip(old) else 1)
EOF
then
  cp "$SAVANT/out/current.json" public/savant-current.json
  MSG="refresh"
else
  echo "data unchanged since the last publish"
  MSG=""
fi

# Heartbeat: data/savant-refresh.json says the Mac ran, even on days with no games (the
# All-Star break), so the freshness alarm only fires when runs actually stop. Rewritten at
# most once every ~20 hours so a quiet stretch doesn't commit twice a day.
mkdir -p data
"$PY" - "$SAVANT/out/current.json" data/savant-refresh.json <<'EOF'
import datetime as dt, json, os, sys
cur = json.load(open(sys.argv[1]))
now = dt.datetime.now(dt.timezone.utc)
try:
    last = dt.datetime.fromisoformat(json.load(open(sys.argv[2]))["last_ok"])
except Exception:
    last = None
if last is None or (now - last).total_seconds() > 20 * 3600 or os.environ.get("FORCE_BEAT"):
    json.dump({"last_ok": now.isoformat(timespec="seconds"), "season": cur["seasons"][0],
               "through": cur.get("through")}, open(sys.argv[2], "w"), indent=1)
EOF
for f in public/savant-current.json public/savant-proj.json public/savant-teams-current.json public/lineups data/savant-refresh.json; do [ -e "$f" ] && git add "$f"; done
if git diff --cached --quiet; then
  echo "nothing to commit"
else
  SEASON=$("$PY" -c "import json;print(json.load(open('$SAVANT/out/current.json'))['seasons'][0])")
  THROUGH=$("$PY" -c "import json;print(json.load(open('$SAVANT/out/current.json')).get('through') or 'latest')")
  if [ -n "$MSG" ]; then SUBJ="Basketball Savant: refresh $SEASON (through $THROUGH)"; else SUBJ="Basketball Savant: heartbeat ($SEASON, no new games)"; fi
  git -c user.name="basketball-savant-bot" -c user.email="bot@wcehoops.com" commit -q -m "$SUBJ"
  if [ -n "${DRY_RUN:-}" ]; then echo "DRY_RUN: would push: $SUBJ"; git log --oneline -1; date '+%Y-%m-%dT%H:%M:%S%z' > "$SAVANT/logs/last-ok"; exit 0; fi
  for attempt in 1 2 3; do
    if git push -q origin HEAD:main; then echo "pushed: $SUBJ"; break; fi
    echo "push rejected (attempt $attempt); rebasing on origin/main"
    git fetch -q origin main && git rebase -q origin/main || { git rebase --abort; exit 1; }
    [ $attempt -eq 3 ] && { echo "push failed"; exit 1; }
  done
fi
cd "$SAVANT" && "$PY" slate_watch.py mark     # tonight's games that made it in are done
date '+%Y-%m-%dT%H:%M:%S%z' > "$SAVANT/logs/last-ok"
exit 0
