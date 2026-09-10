#!/usr/bin/env bash
# Rebuild the in-progress season only, and drop the results straight into public/.
#
# This is what the GitHub Action runs every morning and after every game night. It
# never touches the 1999–2025 archive: that lives in public/football-savant-data.json,
# built by a full local run, and stays byte-identical until the next one. The current
# season goes to its own small file, public/football-savant-current.json, which the page
# fetches alongside the archive and merges in. Committing a few hundred KB twice a day
# keeps the repository's history sane; committing 42 MB twice a day would not.
#
#   ./refresh_current.sh          # current season (August onward = this calendar year)
#   ./refresh_current.sh 2026     # a specific season
#
# Exit 0 with "nothing to build" if nflverse hasn't posted the season yet.
set -eu
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
PUB="$REPO/public"

if [ $# -ge 1 ]; then Y=$1
else
  Y=$(date +%Y); [ "$(date +%m)" -ge 8 ] || Y=$((Y-1))
fi
export NFL_RAW="${NFL_RAW:-raw}" NFL_AGG="${NFL_AGG:-agg}"
export NFL_SEASONS="$Y"
mkdir -p "$NFL_RAW" "$NFL_AGG"

echo "== fetch ($Y)"
NFL_REFRESH="$Y" ./fetch.sh

if [ ! -s "$NFL_RAW/reg_$Y.csv" ] || [ ! -s "$NFL_RAW/pbp/pbp_$Y.parquet" ]; then
  echo "nothing to build: nflverse has no $Y season tables yet"
  exit 0
fi

echo "== play-by-play aggregates"
python3 pbp_agg.py "$Y"
echo "== on-field aggregates (skips if participation isn't published yet)"
python3 onfield_agg.py "$Y"

echo "== field maps -> public/football-maps/"
NFL_MAPS="$PUB/football-maps" python3 maps.py

echo "== build -> public/football-savant-current.json"
NFL_OUT="$PUB/football-savant-current.json" python3 build.py

python3 - "$PUB/football-savant-current.json" <<'EOF'
import json, sys
j = json.load(open(sys.argv[1]))
for s, blk in j['data'].items():
    q = sum(1 for p in blk['players'] if p['qualified'])
    wk = blk.get('week')
    print('%s: %d players, %d qualified%s' % (s, len(blk['players']), q,
          ', through week %d' % wk if wk else ', season complete'))
EOF
