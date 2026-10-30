#!/bin/bash
# finish_backfill.sh — carry the 2.1.0 stats back through the older seasons, then publish.
#
# The Oct 14 backfill was throttled by stats.nba.com once three jobs were hitting it at once,
# so it stopped with the new card stats in 2009-10..2025-26 and team/lineup files for
# 2018-19..2025-26. This runs the rest alone, in its own worktree of the site (never the bot's,
# never the working copy), and pushes only the archive files: savant-data.json,
# savant-teams.json and past seasons' lineups. The bot never touches those, so the two can't
# collide. Every pass is resumable and cached; running it twice is cheap.
set -uo pipefail
SAVANT="$HOME/Basketball-Savant"
SITE="$HOME/western-conference-elitists"
WT="$SITE/.worktrees/backfill"
PY="${PYTHON:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"
cd "$SAVANT" || exit 1
exec >> logs/backfill.log 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') finish_backfill"

git -C "$SITE" fetch -q origin main || { echo "fetch failed"; exit 1; }
[ -d "$WT" ] || git -C "$SITE" worktree add -q --detach "$WT" origin/main || { echo "worktree add failed"; exit 1; }
(cd "$WT" && git checkout -q --detach -f origin/main) || exit 1

# card stats: every season, twice (the second pass fills whatever the NBA refused the first time)
for pass in 1 2; do
  "$PY" -u build_extras.py "$WT/public/savant-data.json" --only scoring,onoffadj,playtypes,xfg || echo "extras pass $pass failed"
done
# teams and lineups: resumes, and redoes any season with a team the NBA refused
for pass in 1 2; do
  "$PY" -u teams_engine.py build-all "$WT/public" || echo "teams pass $pass failed"
done
"$PY" -u trim_lineups.py "$WT/public"

# publish on top of the latest main
TMP=$(mktemp -d)
cp "$WT/public/savant-data.json" "$WT/public/savant-teams.json" "$TMP/" && cp -R "$WT/public/lineups" "$TMP/" || exit 1
cd "$WT" || exit 1
git fetch -q origin main && git checkout -q --detach -f origin/main || exit 1
CUR=$("$PY" -c "import json;print(json.load(open('public/savant-proj.json'))['season'])" 2>/dev/null || echo none)
cp "$TMP/savant-data.json" "$TMP/savant-teams.json" public/
mkdir -p public/lineups
for f in "$TMP"/lineups/*.json; do [ "$(basename "$f" .json)" = "$CUR" ] || cp "$f" public/lineups/; done
"$PY" -c "import json,glob;[json.load(open(f)) for f in ['public/savant-data.json','public/savant-teams.json']+glob.glob('public/lineups/*.json')]" || { echo "a file doesn't parse; not publishing"; exit 1; }
git add public/savant-data.json public/savant-teams.json public/lineups
if git diff --cached --quiet; then echo "nothing new"; exit 0; fi
git -c user.name="basketball-savant-bot" -c user.email="bot@wcehoops.com" commit -q -m "Basketball Savant: 2.1.0 stats, teams and lineups for the older seasons"
git push -q origin HEAD:main || { git fetch -q origin main && git rebase -q origin/main && git push -q origin HEAD:main; } || { echo "push failed"; exit 1; }
echo "pushed $(git rev-parse --short HEAD) at $(date '+%H:%M')"
rm -rf "$TMP"
