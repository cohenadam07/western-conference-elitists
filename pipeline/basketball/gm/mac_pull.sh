#!/bin/bash
# mac_pull.sh — GM Savant's Mac lane (Module 8). The cloud is refused by Basketball-Reference and NBA.com, so the Mac
# fetches this season's pages, parses them here (pagefacts.py, luck.py) and sends only the parsed facts, encrypted
# (state_bundle.py, key in ~/.config/wce/gm-state.key = the GM_STATE_KEY repo secret), as gm-mac.enc on the gm-state
# pre-release; then it starts a cloud run. No fetched page ever leaves the Mac. launchd: launchd/com.wcehoops.gm-pull.plist.
#   mac_pull.sh            the season in progress: Basketball-Reference transactions, player totals and the league page,
#                          NBA.com player movement; the draft page in late June
#   mac_pull.sh --seed     also send the whole state (first run, or to reset the cloud from the Mac); asks nothing,
#                          so run it only when you mean to
set -uo pipefail
cd "$(dirname "$0")"
PY="${GM_PYTHON:-python3}"
set -a; source "${WCE_CONTROL_ROOM_ENV:-$HOME/.config/wce/control-room.env}" 2>/dev/null; set +a   # exported, so control-room.sh sees WCE_STATUS_KEY
bash ../../../.github/scripts/control-room.sh gm-mac-pull start 2>/dev/null || true
rc=0
# the launchd job runs from a clean checkout of main (.worktrees/savant-bot), whose out/ holds no pipeline state: it
# starts from the cloud's latest bundle (GM_SYNC_STATE=1, set in the plist). A seed never syncs: the Mac is the source.
if [ "${GM_SYNC_STATE:-}" = "1" ] && [ "${1:-}" != "--seed" ]; then
  T0=$(mktemp -d)
  if gh release download gm-state -p gm-state.enc -D "$T0" --clobber; then "$PY" state_bundle.py unpack "$T0/gm-state.enc" || rc=1; else echo "no gm-state.enc to start from"; rc=1; fi
  rm -rf "$T0"
fi
# while ~/.config/wce/gm-br-hold or the Contract tab's contracts-br-hold exists, Basketball-Reference is read from the
# cache only (fetch.py): see the note there
for h in "${GM_BR_HOLD:-$HOME/.config/wce/gm-br-hold}" "${CT_BR_HOLD:-$HOME/.config/wce/contracts-br-hold}"; do
  [ -e "$h" ] && echo "$(date '+%F %T') Basketball-Reference held ($(basename "$h")): cached pages only ($(head -1 "$h" 2>/dev/null))"
done
"$PY" - <<'PY' || rc=1
import datetime as dt, sys
sys.path.insert(0, '.')
from fetch import get
import br_tx
from ledger import NBA_FEED, draft_url
t = dt.date.today(); y = t.year + (1 if t.month >= 7 else 0)
urls = [br_tx.url(y), NBA_FEED, f'https://www.basketball-reference.com/leagues/NBA_{y}_totals.html',
        f'https://www.basketball-reference.com/leagues/NBA_{y}.html']     # the league page: opponents' shooting, for the luck adjustment
if '06-20' <= t.isoformat()[5:] <= '06-30':
    urls.append(draft_url(t.year))
bad = [u for u in urls if get(u, delay=4, max_age_h=3)[0] != 200]
if bad:
    sys.exit('not fetched: ' + ', '.join(bad))
PY
if [ "${1:-}" = "--seed" ]; then
  # the season totals pages Basketball Savant's own cache (cache_br) holds and ours lacks go into ours first, so their
  # facts are in the seed
  "$PY" - <<'PY'
import os, shutil, sys
sys.path.insert(0, '.')
from fetch import path_of
from br_more import CACHE_BR, BR
for y in range(1980, 2028):
    src, url = os.path.join(CACHE_BR, f'NBA_{y}_totals.html'), f'{BR}/leagues/NBA_{y}_totals.html'
    if os.path.exists(src) and not os.path.exists(path_of(url)):
        shutil.copy(src, path_of(url)); open(path_of(url) + '.url', 'w').write(url)
PY
  "$PY" pagefacts.py export || rc=1                       # every season
else
  "$PY" pagefacts.py export --season "$("$PY" -c "import datetime as d; t=d.date.today(); print(t.year + (t.month >= 7))")" || rc=1
fi
"$PY" luck.py > /dev/null || rc=1
# the title model's seasons (standings, schedules, playoff series): the NBA's game logs through the engine's cache, so
# from Basketball Savant's folder; a finished season joins from July 1 (titles_data.py)
GMDIR="$(pwd)"
(cd "${BASKETBALL_SAVANT:-$HOME/Basketball-Savant}" && PYTHONPATH="$GMDIR/.." "$PY" "$GMDIR/titles_data.py" > /dev/null) || rc=1
T=$(mktemp -d)
"$PY" state_bundle.py pack "$T/gm-mac.enc" --mac || rc=1
gh release view gm-state > /dev/null 2>&1 || gh release create gm-state --prerelease --title "GM Savant state (encrypted)" \
  --notes "Encrypted with the GM_STATE_KEY repo secret: parsed pipeline state only, never a fetched page (state_bundle.py)." || rc=1
[ $rc -eq 0 ] && { gh release upload gm-state "$T/gm-mac.enc" --clobber || rc=1; }
if [ "${1:-}" = "--seed" ] && [ $rc -eq 0 ]; then
  "$PY" state_bundle.py pack "$T/gm-state.enc" && gh release upload gm-state "$T/gm-state.enc" --clobber || rc=1
fi
rm -rf "$T"
[ $rc -eq 0 ] && gh workflow run gm-savant-cloud.yml >/dev/null 2>&1
bash ../../../.github/scripts/control-room.sh gm-mac-pull $([ $rc -eq 0 ] && echo success || echo failure) 2>/dev/null || true
exit $rc
