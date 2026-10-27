#!/bin/bash
# ext_backfill_all.sh — the whole history pull for the October 2026 additions, in the order that
# gets the most onto the site soonest: every season's league and team tables first (fast), then
# the per-player passing networks, then the per-game defensive box scores (slow). Each season is
# pushed to ext-seed as it finishes; the ext-build workflow turns it into the site's files.
#
#   nohup bash ext_backfill_all.sh <code_dir> > /dev/null 2>&1 &
set -u
CODE="$1"
bash "$CODE/ext_backfill.sh" "$CODE" 2025-26 1996-97 league,teams,extra,shots
bash "$CODE/ext_backfill.sh" "$CODE" 2025-26 2013-14 players
bash "$CODE/ext_backfill.sh" "$CODE" 2025-26 2017-18 games
