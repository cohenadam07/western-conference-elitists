#!/bin/bash
# cloud_run.sh — one College Basketball Savant refresh, or a slate watcher (GitHub Actions; see
# .github/workflows/college-basketball-savant-cloud.yml).
#   cloud_run.sh once [--force]    refresh and publish if a new final has settled
#   cloud_run.sh watch HOURS       check every 5 minutes until today's slate is published; college
#                                  days run from about noon to 3am ET, so a watcher hands over to a
#                                  fresh one after HOURS
#   cloud_run.sh dry               a full refresh with no commit: the end-to-end test
set -uo pipefail
cd "${GITHUB_WORKSPACE:?}"
CC=pipeline/college
: "${RUNNER_TEMP:=/tmp}"
# Both folders are kept by actions/cache: the CBBD ledger has to outlive a run, or the cap means nothing.
export COLLEGE_HOME="$GITHUB_WORKSPACE/.cbb-home" ESPN_CBB_CACHE="$GITHUB_WORKSPACE/.espn-cbb-cache"
git config user.name "college-savant-bot"
git config user.email "bot@wcehoops.com"

seed() {
  # finished seasons' working files (the Mac's full build pushes them, cloud_cbb.py bundle)
  if git fetch -q --depth 1 origin cbb-bundles 2>/dev/null; then
    mkdir -p "$COLLEGE_HOME" && git archive FETCH_HEAD | tar -x -C "$COLLEGE_HOME"
  fi
  [ -d "$COLLEGE_HOME/ratings" ] || { echo "::error::no cbb-bundles branch yet"; exit 1; }
  # rung 2: the Mac's raw files, when it has pushed any
  if git fetch -q --depth 1 origin cbb-data 2>/dev/null; then
    S=$(python3 -c "import sys;sys.path.insert(0,'$CC');import config;print(config.CURRENT)")
    mkdir -p "$ESPN_CBB_CACHE/$S/raw" "$ESPN_CBB_CACHE/$S/from-mac"
    git archive FETCH_HEAD | tar -x -C "$ESPN_CBB_CACHE/$S/from-mac"
    cp -n "$ESPN_CBB_CACHE/$S/from-mac"/*.json.gz "$ESPN_CBB_CACHE/$S/raw/" 2>/dev/null
  fi
}

publish() {
  git add public/cbb data/cbb-refresh.json
  git diff --cached --quiet && { echo "nothing changed"; return 0; }
  git commit -q -m "College Basketball Savant: refresh $(date -u +%F)"
  for i in 1 2 3 4; do
    git push -q origin HEAD:main && { echo pushed; return 0; }
    git pull -q --rebase origin main || { git rebase --abort; break; }
  done
  git fetch -q origin main && git reset -q --hard FETCH_HEAD
  return 1
}

once() {
  if [ "${1:-}" != "--force" ]; then
    python3 $CC/cloud_cbb.py check . ; [ $? -eq 10 ] || return 0
  fi
  python3 -W ignore $CC/cloud_cbb.py refresh . || return 1
  publish
}

seed
case "${1:-once}" in
  once) once "${2:-}"; exit $? ;;
  dry)  python3 -W ignore $CC/cloud_cbb.py refresh . ; rc=$?; git status --short public/cbb data | head -20; du -sh public/cbb; exit $rc ;;
  watch)
    end=$(( $(date +%s) + ${2:-5} * 3600 ))
    while :; do
      once; [ $? -eq 1 ] && echo "::warning::this check failed; trying again in 5 minutes"
      python3 $CC/cloud_cbb.py pending . ; [ $? -eq 10 ] || { echo "slate done"; exit 0; }
      if [ "$(date +%s)" -ge "$end" ]; then
        gh workflow run college-basketball-savant-cloud.yml --ref main -f mode=watch; exit 0
      fi
      sleep 300
    done ;;
esac
