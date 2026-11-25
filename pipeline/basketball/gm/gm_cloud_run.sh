#!/bin/bash
# gm_cloud_run.sh — GM Savant's refresh in the cloud (.github/workflows/gm-savant-cloud.yml). Module 8.
#
# The repo and its releases are public, so no fetched page ever comes here. What the job carries between nights is
# state_bundle.py's encrypted bundle (gm-state.enc on the gm-state pre-release: the pipeline's parsed outputs and the
# parsed page facts, AES-256 with the GM_STATE_KEY repo secret). Basketball-Reference and NBA.com, which refuse the
# cloud, arrive only as parsed facts from the Mac lane (gm-mac.enc, mac_pull.sh). ESPN is fetched here; the
# player-game tables come from the public Data Room release. The page files are committed to main like Basketball
# Savant's; the bundle goes back up only after a clean pass, so a failed run never replaces a good one.
#   gm_cloud_run.sh [--light | --full]     only what changed (the default), or everything (Mondays)
#   GM_DRY_RUN=1 ...                       the same run anywhere (a Mac rehearsal): everything up to the commit, then
#                                          no commit, no push and no bundle upload; RUNNER_TEMP defaults to a temp dir
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
DRY="${GM_DRY_RUN:-}"
export RUNNER_TEMP="${RUNNER_TEMP:-$(mktemp -d)}"
GM=pipeline/basketball/gm
export GM_CACHE="$RUNNER_TEMP/gm-cache"            # ESPN pages and the Data Room tables: this run only, never uploaded
export GM_FACTS_ONLY=1
[ -n "${GM_STATE_KEY:-}" ] || { echo "::error::no GM_STATE_KEY secret"; exit 1; }
[ -n "$DRY" ] || { git config user.name "gm-savant-bot"; git config user.email "bot@wcehoops.com"; }
mkdir -p "$GM_CACHE/dataroom" "$GM/out"
gh release download gm-state -p gm-state.enc -D "$RUNNER_TEMP" --clobber || { echo "::error::no gm-state.enc: seed it from the Mac (mac_pull.sh --seed)"; exit 1; }
[ -n "$DRY" ] || export MIN_FREE_GB=${MIN_FREE_GB:-4}   # peak.py's disk guard: GitHub runners have about 14 GB free, under the Mac's 15 GB floor
python3 $GM/state_bundle.py unpack "$RUNNER_TEMP/gm-state.enc" || exit 1
if gh release download gm-state -p gm-mac.enc -D "$RUNNER_TEMP" --clobber 2>/dev/null; then
  python3 $GM/state_bundle.py unpack "$RUNNER_TEMP/gm-mac.enc"       # this season's facts and luck margins from the Mac
fi
# every season's player-game table from the Data Room (the in-season model reads them; Basketball Savant's refresh
# rewrites the season in progress nightly)
gh release download dataroom -p "nba-player_games-*.json.gz" -D "$GM_CACHE/dataroom" --clobber \
  || echo "::warning::no Data Room player-game tables: in-season grades fall back to the season-start projection"
python3 $GM/gm_update.py ${1:-}
rc=$?                                                       # 0 clean, 2 warning (unconfirmed over 48h), else failed
if [ $rc -ne 0 ] && [ $rc -ne 2 ]; then exit $rc; fi
if [ -n "$DRY" ]; then
  echo "dry run: gm_update.py rc=$rc; would commit:"; git status --short public/gms public/gm-savant.html public/dataroom/catalog.json.gz data/gm-refresh.json | head -20
  echo "dry run: would upload gm-state.enc ($(python3 $GM/state_bundle.py pack "$RUNNER_TEMP/gm-state.enc" | tail -1))"
  exit $rc
fi
git add public/gms public/gm-savant.html public/dataroom/catalog.json.gz data/gm-refresh.json
# A run that found nothing new changes only the heartbeat's time (last_ok). That alone is not worth a commit, unless
# main's heartbeat is getting old: the freshness alarm (gm-savant-freshness.yml) goes off at 30 hours, so after 20 the
# heartbeat is committed on its own. (Nov 25, 2026: three runs with no news committed 32 files each.)
if [ "$(git diff --cached --name-only)" = "data/gm-refresh.json" ] && python3 - <<'PY'
import datetime as dt, json, subprocess, sys
old = json.loads(subprocess.check_output(['git', 'show', 'HEAD:data/gm-refresh.json']))
new = json.load(open('data/gm-refresh.json'))
age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(old['last_ok'])).total_seconds() / 3600
sys.exit(0 if {**old, 'last_ok': None} == {**new, 'last_ok': None} and age < 20 else 1)
PY
then
  git reset -q -- data/gm-refresh.json
  echo "nothing new since the last refresh ($(git show HEAD:data/gm-refresh.json | python3 -c "import json,sys;print(json.load(sys.stdin)['last_ok'])")): no commit"
fi
if ! git diff --cached --quiet; then
  git commit -q -m "NBA GM Savant: refresh ($(python3 -c "import json;d=json.load(open('data/gm-refresh.json'));print(d['asof'], 'through', d['through'])"))"
  # Main moves while the run works (about 30 minutes): replay the refresh commit on main's newest and push again.
  # The run leaves tracked state files in pipeline/basketball/gm/out changed, so the rebase sets them aside
  # (autostash). The Data Room catalog is the one file other refreshes also write: on a conflict there, main's
  # catalog is kept and NBA is rescanned on top, so both refreshes' entries survive. (Nov 25, 2026: the first
  # refresh to finish could not push, because "git pull --rebase" refused the changed state files.)
  pushed=
  for i in 1 2 3 4; do
    git push -q origin HEAD:main && { pushed=1; break; }
    git fetch -q origin main
    git -c rebase.autoStash=true rebase -q origin/main && continue
    if [ "$(git diff --name-only --diff-filter=U)" = "public/dataroom/catalog.json.gz" ]; then
      git checkout -q --ours public/dataroom/catalog.json.gz    # in a rebase, "ours" is main's side
      python3 pipeline/dataroom/catalog.py nba > /dev/null && git add public/dataroom/catalog.json.gz \
        && GIT_EDITOR=true git rebase --continue > /dev/null && continue
    fi
    git rebase --abort 2> /dev/null
    break
  done
  # A refresh that did not reach main fails the run and keeps the state where it was, so the state never runs
  # ahead of the page: the next run redoes the day from the same start.
  [ -n "$pushed" ] || { echo "::error::the refresh commit could not be pushed to main; the state was not uploaded"; exit 1; }
fi
python3 $GM/state_bundle.py pack "$RUNNER_TEMP/gm-state.enc" && gh release upload gm-state "$RUNNER_TEMP/gm-state.enc" --clobber
exit $rc
