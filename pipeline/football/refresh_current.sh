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
echo "== FTN charting aggregates (skips if the season isn't charted yet)"
python3 ftn_agg.py "$Y"
echo "== offensive line spots from the depth charts"
python3 line_agg.py "$Y"
echo "== on-field aggregates (skips if participation isn't published yet)"
python3 onfield_agg.py "$Y"

echo "== field maps -> public/football-maps/"
NFL_MAPS="$PUB/football-maps" python3 maps.py

echo "== build -> public/football-savant-current.json"
NFL_OUT="$PUB/football-savant-current.json" python3 build.py

python3 - "$PUB/football-savant-current.json" "$NFL_RAW/schedules.csv" "$Y" <<'EOF'
import csv, datetime, json, sys

j = json.load(open(sys.argv[1]))
for s, blk in j['data'].items():
    q = sum(1 for p in blk['players'] if p['qualified'])
    wk = blk.get('week')
    print('%s: %d players, %d qualified%s' % (s, len(blk['players']), q,
          ', through week %d' % wk if wk else ', season complete'))

# Staleness guard. The failure this job is most likely to have is the quiet one: nflverse
# serves a stale file, or a fetch 404s, the build succeeds on last week's numbers, nothing
# changes, the Action goes green and the site sits frozen with nobody the wiser. So the
# run ends by asking the schedule a question it can answer: which regular-season games
# kicked off more than two days ago and still have no score? Two days is generous - the
# feeds settle overnight - so a handful of those means the data is behind, and the job
# should go red and send mail rather than pass quietly.
try:
    rows = list(csv.DictReader(open(sys.argv[2])))
except OSError:
    sys.exit(0)
today = datetime.date.today()
behind = []
for r in rows:
    if r.get('season') != sys.argv[3] or r.get('game_type') != 'REG':
        continue
    try:
        d = datetime.date.fromisoformat(r['gameday'])
    except (KeyError, ValueError):
        continue
    if (today - d).days > 2 and not (r.get('home_score') or '').strip():
        behind.append('week %s %s at %s (%s)' % (r.get('week'), r.get('away_team'),
                                                 r.get('home_team'), r['gameday']))
if len(behind) > 3:
    print('\nSTALE: %d regular-season games finished more than two days ago and still have'
          ' no score in the data.' % len(behind))
    for b in behind[:8]:
        print('  ' + b)
    print('The build ran, but it ran on old numbers. Check nflverse before trusting the page.')
    sys.exit(1)
if behind:
    print('\n%d game(s) not yet scored — within tolerance:' % len(behind), '; '.join(behind))
EOF
