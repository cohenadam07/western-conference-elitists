#!/bin/bash
# cloud_run.sh — College Football Savant's refresh on GitHub Actions (college-football-savant-refresh.yml).
#   cloud_run.sh once     refresh the season being played from ESPN; commit and push only if a file changed
#   cloud_run.sh dry      the same refresh, nothing committed: the end-to-end test
# The cloud holds no history: past seasons' files are already in public/cfb, and what the current season
# needs from them is committed in pipeline/cfb/state (state.py). Raw ESPN responses stay in the Actions cache
# and on Adam's Mac (pipeline/cfb/archive.py), never in git or a release (Adam, Nov 10 2026).
set -uo pipefail
cd "${GITHUB_WORKSPACE:?}"
export CFB_HOME="$GITHUB_WORKSPACE/.cfb-home"
mkdir -p "$CFB_HOME"
git config user.name "college-football-bot"
git config user.email "bot@wcehoops.com"

dataroom() {
  # The connector's Data Room, the season being played: plays and team-games from the tables the
  # refresh just wrote (pipeline/dataroom/cfb.py), uploaded by publish.sh. Never fails the run.
  local y; y=$(python3 -c "from pipeline.cfb import config as C; print(C.CURRENT)") || return 0
  export DATAROOM_HOSTED="${RUNNER_TEMP:-/tmp}/dataroom"
  python3 -W ignore pipeline/dataroom/cfb.py plays "$y" && python3 -W ignore pipeline/dataroom/cfb.py games "$y" \
    && bash pipeline/dataroom/publish.sh cfb "$y" || echo "::warning::the Data Room's college football tables failed"
  return 0
}

publish() {
  dataroom
  git add public/dataroom 2>/dev/null
  git add public/cfb data/cfb-refresh.json pipeline/cfb/state/heads.json
  git diff --cached --quiet && { echo "nothing changed"; return 0; }
  git commit -q -m "College Football Savant: refresh $(date -u +%F)"
  for i in 1 2 3 4; do
    git push -q origin HEAD:main && { echo pushed; return 0; }
    git pull -q --rebase origin main || { git rebase --abort; break; }
  done
  git fetch -q origin main && git reset -q --hard FETCH_HEAD
  return 1
}

case "${1:-once}" in
  once)
    python3 -m pipeline.cfb.build active || { echo "offseason: nothing to refresh"; exit 0; }
    python3 -W ignore -m pipeline.cfb.build refresh || exit 1
    publish ;;
  dry)
    python3 -W ignore -m pipeline.cfb.build refresh; rc=$?
    git status --short public/cfb data | head -20; git status --short public/cfb | wc -l; du -sh public/cfb
    exit $rc ;;
esac
