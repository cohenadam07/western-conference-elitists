#!/bin/bash
# pipeline/dataroom/parquet_publish.sh <sport> [season] — the Parquet copies of a sport's Data Room tables
# (savant_sql / savant_analyze; research/analysis/BUILD.md §2), rewritten for the season in progress after
# its JSON has been published:
#   1. each of the sport's tables (and its analysis-only tables) is written again for that season from the
#      same JSON savant_data serves (pipeline/dataroom/parquet.mjs: read back and checksummed against it)
#   2. every file whose bytes changed is uploaded to the "dataroom" release, beside the JSON
#   3. public/dataroom/parquet.json.gz (the engine's manifest) is left updated for the workflow's commit
# The same rule as the JSON: a failure is a ::warning:: and the script exits 0, so it can never block a
# Savant page. If any upload fails the manifest is put back as it was, so it never claims rows the
# release does not hold. Needs node, gh (GH_TOKEN) and @duckdb/node-api (installed here if missing).
set -u
SPORT="${1:?sport}"
ONLY="${2:-}"
cd "$(dirname "$0")/../.."
TAG=dataroom
REPO="${GITHUB_REPOSITORY:-cohenadam07/western-conference-elitists}"
OUT=$(mktemp -d)
MAN=public/dataroom/parquet.json.gz
# Run on its own (college basketball's cloud_run.sh), it checks in as dataroom-<sport> itself; under
# publish.sh (DATAROOM_PARENT set) its warnings go into publish.sh's one check-in instead.
. pipeline/dataroom/report.sh
WARN=(); UP=0
warn() { echo "::warning::$*"; WARN+=("$*"); }
finish() {
  if [ ${#WARN[@]} -gt 0 ]; then
    m="${#WARN[@]} problem$([ ${#WARN[@]} = 1 ] || echo s): $(printf '%s; ' "${WARN[@]}")"
    dr_report "$SPORT" failure "${m%; }"
  else
    dr_report "$SPORT" success "$([ $UP = 0 ] && echo "Nothing new to upload; the $SPORT Parquet copies are current" || echo "Uploaded $UP Parquet cop$([ $UP = 1 ] && echo y || echo ies)${ONLY:+ for $ONLY}")"
  fi
  rm -rf "$OUT"
}
trap finish EXIT
dr_token_ok || { warn "Parquet: $DR_NO_TOKEN"; exit 0; }

{ [ -d node_modules/@duckdb/node-api ] && [ -d node_modules/zod ]; } || npm ci --no-audit --no-fund >/dev/null 2>&1 \
  || { warn "Parquet: could not install DuckDB; the $SPORT copies were not refreshed"; exit 0; }
cp "$MAN" "$OUT/manifest.before" 2>/dev/null || true

# table and season pairs: every table of the sport, at the season given (or its newest)
PAIRS=$(node --input-type=module -e "
import { readManifest } from './pipeline/dataroom/parquet.mjs'
import { gunzipSync } from 'node:zlib'; import { readFileSync } from 'node:fs'
const cat = JSON.parse(gunzipSync(readFileSync('public/dataroom/catalog.json.gz')))
const man = readManifest()
const sport = process.argv[1], only = process.argv[2]
const tables = new Set([...Object.keys(cat.sports[sport] || {}), ...Object.keys(man.tables).filter((k) => k.startsWith(sport + '.') && man.tables[k].analysis_only).map((k) => k.split('.')[1])])
for (const t of tables) {
  const seasons = Object.keys(((cat.sports[sport] || {})[t] || {}).seasons || man.tables[sport + '.' + t]?.seasons || {}).sort()
  const s = t === 'coaching_programs' ? 'all' : only && (seasons.includes(only) || man.tables[sport + '.' + t]?.analysis_only) ? only : seasons[seasons.length - 1]
  if (s) console.log(t + ' ' + s)
}" "$SPORT" "$ONLY" 2>/dev/null)
[ -n "$PAIRS" ] || { echo "Parquet: no $SPORT tables"; exit 0; }

ok=1
while read -r t s; do
  [ -n "$t" ] || continue
  before=$(node --input-type=module -e "import { readManifest } from './pipeline/dataroom/parquet.mjs'; const e = readManifest().tables['$SPORT.$t']; console.log((e && e.seasons['$s'] && e.seasons['$s'].file_sha256) || '')" 2>/dev/null)
  if ! node pipeline/dataroom/parquet.mjs "$SPORT" "$t" "$s" --out "$OUT" >/dev/null 2>"$OUT/err"; then
    warn "Parquet: $SPORT $t $s was not rewritten: $(grep -v '^\[savant\]' "$OUT/err" | tail -1 | cut -c1-300)"; continue
  fi
  f="$OUT/$SPORT-$t-$s.parquet"
  after=$(node --input-type=module -e "import { readManifest } from './pipeline/dataroom/parquet.mjs'; console.log(readManifest().tables['$SPORT.$t'].seasons['$s'].file_sha256 || '')" 2>/dev/null)
  if [ -n "$before" ] && [ "$before" = "$after" ]; then continue; fi
  for try in 1 2 3; do
    if gh release upload "$TAG" "$f" -R "$REPO" --clobber >/dev/null 2>&1; then echo "Parquet: uploaded $(basename "$f") ($(wc -c <"$f" | tr -d ' ') bytes)"; UP=$((UP+1)); break; fi
    [ $try = 3 ] && { warn "Parquet: upload of $(basename "$f") failed"; ok=0; }
    sleep 5
  done
done <<< "$PAIRS"
if [ $ok = 0 ] && [ -f "$OUT/manifest.before" ]; then
  cp "$OUT/manifest.before" "$MAN"; warn "Parquet: the manifest was put back (an upload failed)"
fi
exit 0
