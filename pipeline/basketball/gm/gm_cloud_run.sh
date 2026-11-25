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
if ! git diff --cached --quiet; then
  git commit -q -m "NBA GM Savant: refresh ($(python3 -c "import json;d=json.load(open('data/gm-refresh.json'));print(d['asof'], 'through', d['through'])"))"
  for i in 1 2 3 4; do git push -q origin HEAD:main && break; git pull -q --rebase origin main || { git rebase --abort; break; }; done
fi
python3 $GM/state_bundle.py pack "$RUNNER_TEMP/gm-state.enc" && gh release upload gm-state "$RUNNER_TEMP/gm-state.enc" --clobber
exit $rc
