#!/bin/bash
# cloud_run.sh — one cloud refresh, or a slate watcher (GitHub Actions; see
# .github/workflows/basketball-savant-cloud.yml).
#
#   cloud_run.sh once [--force]   refresh and publish if a new final has settled (or always,
#                                 with --force)
#   cloud_run.sh watch HOURS [--force]
#                                 stay up and check every 5 minutes until every one of today's
#                                 games is published; after HOURS, hand over to a fresh watcher.
#                                 --force rebuilds on the first pass regardless
#
# Why a watcher: GitHub runs frequent scheduled workflows only when it has spare capacity. On
# Oct 26, 2026 it ran 7 of the ~98 "every 15 minutes" slots, none between 8:52pm ET and the
# end of the slate, so the night's games never landed. One start per game day is all a watcher
# needs; a late start only means it begins checking later.
set -uo pipefail
cd "${GITHUB_WORKSPACE:?}"
BB=pipeline/basketball
: "${RUNNER_TEMP:=/tmp}"
git config user.name "basketball-savant-bot"      # commits and rebases both need it
git config user.email "bot@wcehoops.com"

run_once() {
  export TRACKING_SHA
  TRACKING_SHA=$(git ls-remote origin refs/heads/tracking-data | cut -f1)
  python3 $BB/cloud_publish.py check . ${1:-}
  local rc=$?
  [ $rc -eq 10 ] || return $rc            # 0: nothing new to publish

  # The Mac's latest tracking, Synergy, hustle and matchup tables (only it can fetch them).
  local TR="$RUNNER_TEMP/tracking"
  rm -rf "$TR"; mkdir -p "$TR"
  if [ -n "$TRACKING_SHA" ] && git fetch -q --depth 1 origin tracking-data 2>/dev/null; then
    git archive FETCH_HEAD | tar -x -C "$TR"
    echo "$(ls "$TR" | wc -l) files from the Mac"
  else
    echo "no tracking upload yet"
  fi

  local RUN="$RUNNER_TEMP/savant-run"
  rm -rf "$RUN"; mkdir -p "$RUN/out"
  # the Data Room's NBA tables for the season (cloud_refresh.py writes them, publish.sh uploads them)
  export DATAROOM_HOSTED="$RUNNER_TEMP/dataroom"; rm -rf "$DATAROOM_HOSTED"
  cp $BB/seed/out/* "$RUN/out/"
  (cd "$RUN" && python3 -W ignore "$GITHUB_WORKSPACE/$BB/cloud_refresh.py" \
      --cache "$GITHUB_WORKSPACE/.espn-cache" --public "$GITHUB_WORKSPACE/public" --tracking "$TR") \
    || { echo "::error::the rebuild failed"; return 1; }

  python3 $BB/cloud_publish.py stage . "$RUN" || return 1
  # Basketball Coaching Savant, the season in progress: ESPN games -> game files -> a merge-mode
  # build. continue-on-error: a failure here cannot block the Basketball Savant publish. The
  # saved bundles it merges into live in the bcs-bundles branch (the Mac's full build pushes them).
  local BCSOUT="$RUNNER_TEMP/bcs-out"
  if [ ! -d "$BCSOUT/bundles" ] && git fetch -q --depth 1 origin bcs-bundles 2>/dev/null; then
    mkdir -p "$BCSOUT" && git archive FETCH_HEAD | tar -x -C "$BCSOUT"
  fi
  # A coaching failure is an ::error:: (red in the run's annotations, and the Data Room check in
  # basketball-savant-freshness.yml fails the next day), but the step goes on: Basketball Savant
  # still publishes. refresh_live.py exits nonzero when the Data Room it wrote is behind the
  # ESPN games it read, so a silent skip (Nov 2026: "2026-27: no schedule", rc=0, the Data Room
  # stuck at Oct 31 for days) can't pass for success again.
  local BCS_OK=0
  if [ -d "$BCSOUT/bundles" ]; then
    if BCS_ESPN_CACHE="$GITHUB_WORKSPACE/.espn-cache/bcs" BCS_OUT="$BCSOUT" \
      python3 -W ignore $BB/coaching/refresh_live.py --public "$GITHUB_WORKSPACE/public" --out "$BCSOUT" --tracking "$TR"; then
      BCS_OK=1
    else
      echo "::error::the Basketball Coaching Savant refresh failed; Basketball Savant publishes without it (see the coaching lines above)"
    fi
  else
    echo "::error::coaching refresh skipped: no bcs-bundles branch (run the full build on the Mac and push it)"
  fi
  # The Data Room: upload this season's player-games and shots if they changed, then the catalog
  # (the coaching tables' counts too, so this runs after the coaching pass). Never fails the run.
  bash pipeline/dataroom/publish.sh nba "$(python3 -c "import json;print(json.load(open('public/savant-current.json'))['seasons'][0])")" || true
  git add public/dataroom/catalog.json.gz public/dataroom/parquet.json.gz 2>/dev/null
  git add public/savant-current.json public/savant-proj.json public/savant-teams-current.json \
          public/lineups public/savant-ext data/savant-refresh.json $BB/seed/espn_ids.json
  # The coaching files. Only after a good coaching pass: a failed one may have written some
  # files and not others, and the last good set online beats a mixed one.
  if [ $BCS_OK = 1 ]; then
    git add public/bcs/index.json public/bcs/c public/bcs/t public/bcs/ww "public/bcs/data/games" "public/bcs/data/decisions" "public/bcs/data/units" public/bcs/data/coaches.json public/bcs/data/dictionary.json 2>/dev/null
    # The two big Data Room tables (stints, rotation: ~2 MB a season by April) go once the
    # night's slate is all in (and on the morning rebuilds), not on every pass mid-slate, so the
    # repo doesn't take ~5 copies a night; they are never more than a slate behind the games table.
    python3 $BB/cloud_publish.py pending . >/dev/null
    if [ $? -ne 10 ] || [ "$(date -u +%u)" = "1" ]; then
      git add public/bcs/data/stints public/bcs/data/rotation 2>/dev/null
    else
      # not this pass: back to what main has (the next pass rebuilds them), so the tree is clean
      # for the pull --rebase below
      git checkout -q -- public/bcs/data/stints public/bcs/data/rotation 2>/dev/null
      git clean -fdq public/bcs/data/stints public/bcs/data/rotation 2>/dev/null
    fi
  else
    # leave the tree clean, or the pull --rebase below refuses to run and a push race loses
    # this pass's Basketball Savant commit
    git checkout -q -- public/bcs 2>/dev/null; git clean -fdq public/bcs 2>/dev/null
  fi
  if git diff --cached --quiet; then echo "nothing changed"; return 0; fi
  local SEASON THROUGH MSG
  read SEASON THROUGH < <(python3 -c "import json;d=json.load(open('public/savant-current.json'));print(d['seasons'][0], d.get('through') or 'latest')")
  if git diff --cached --quiet -- public/savant-current.json public/savant-ext; then MSG="Basketball Savant: heartbeat ($SEASON through $THROUGH)"
  else MSG="Basketball Savant: refresh $SEASON (through $THROUGH)"; fi
  git commit -q -m "$MSG"
  for i in 1 2 3 4; do
    if git push -q origin HEAD:main; then echo "pushed: $MSG"; return 0; fi
    git pull -q --rebase origin main || { git rebase --abort; break; }
  done
  # Didn't land: go back to what main really has, so the next pass sees the games as
  # unpublished and tries again (rather than trusting this run's own heartbeat).
  echo "::warning::push failed; starting the next pass from origin/main"
  git fetch -q origin main && git reset -q --hard FETCH_HEAD
  return 1
}

case "${1:-once}" in
  once)
    run_once "${2:-}"
    rc=$?; [ $rc -eq 10 ] && rc=0; exit $rc ;;
  watch)
    end=$(( $(date +%s) + ${2:-5} * 3600 ))
    last=0
    first="${3:-}"
    while :; do
      run_once "$first"; last=$?; first=""
      [ $last -eq 1 ] && echo "::warning::this check failed; trying again in 5 minutes"
      python3 $BB/cloud_publish.py pending .
      [ $? -eq 10 ] || { echo "slate done"; exit $(( last == 1 )); }
      if [ "$(date +%s)" -ge "$end" ]; then
        gh workflow run basketball-savant-cloud.yml --ref main -f mode=watch \
          && echo "handed over to a fresh watcher" || echo "::error::couldn't start the next watcher"
        exit 0
      fi
      sleep 300
    done ;;
esac
