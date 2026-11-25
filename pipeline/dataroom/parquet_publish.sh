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
# The backfill cap (Adam, Nov 25 2026). A run builds, besides each table's season in progress, every season
# the manifest does not hold yet (a table added in a merge fills itself in on the next refresh). If those
# missing files would number more than BACKFILL_MAX_FILES or come to more than BACKFILL_MAX_MB (estimated
# from the table's bytes per row in the manifest, or BACKFILL_BYTES_PER_ROW where it has none), the run
# builds none of them, logs why, and still refreshes the season in progress. Change the numbers here, or
# set PARQUET_BACKFILL_MAX_FILES / PARQUET_BACKFILL_MAX_MB for one run.
BACKFILL_MAX_FILES="${PARQUET_BACKFILL_MAX_FILES:-200}"
BACKFILL_MAX_MB="${PARQUET_BACKFILL_MAX_MB:-500}"
BACKFILL_BYTES_PER_ROW="${PARQUET_BACKFILL_BYTES_PER_ROW:-100}"
# PARQUET_DRY_RUN=1 prints the plan (each table, its seasons, the backfill's files and estimated size) and
# stops: nothing built, uploaded, reported or changed. PARQUET_DRY_RUN=build also builds the files into a
# temporary folder for their exact sizes, then puts the manifest back; still no upload and no report.
DRY_RUN="${PARQUET_DRY_RUN:-}"
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
[ -n "$DRY_RUN" ] || trap finish EXIT
{ [ -d node_modules/@duckdb/node-api ] && [ -d node_modules/zod ]; } || npm ci --no-audit --no-fund >/dev/null 2>&1 \
  || { warn "Parquet: could not install DuckDB; the $SPORT copies were not refreshed"; exit 0; }
cp "$MAN" "$OUT/manifest.before" 2>/dev/null || true

# One line per table: the table, then the seasons to write: its season in progress (the season given, or
# its newest) and every season it should have that the manifest does not hold yet. A catalog table should
# have every season the catalog lists; an analysis-only table (pipeline/dataroom/parquet_sources.mjs EXTRA)
# every season its source has. The manifest gains a season only once its file is uploaded, so it never
# names a file the release lacks. The last line, "#BACKFILL files bytes over", sums the missing seasons;
# over the cap, they are left out and only the seasons in progress are written.
PLAN=$(node --input-type=module -e "
import { readManifest } from './pipeline/dataroom/parquet.mjs'
import { EXTRA } from './pipeline/dataroom/parquet_sources.mjs'
import { gunzipSync } from 'node:zlib'; import { readFileSync } from 'node:fs'
const cat = JSON.parse(gunzipSync(readFileSync('public/dataroom/catalog.json.gz')))
const man = readManifest()
const [sport, only, maxFiles, maxMb, perRowDefault] = process.argv.slice(1)
const extra = Object.keys(EXTRA).filter((k) => k.startsWith(sport + '.')).map((k) => k.split('.')[1])
const tables = new Set([...Object.keys(cat.sports[sport] || {}), ...extra])
const rows = [], detail = []
let files = 0, bytes = 0
for (const t of tables) {
  const key = sport + '.' + t
  const have = (man.tables[key] || {}).seasons || {}
  const catSeasons = ((cat.sports[sport] || {})[t] || {}).seasons || {}
  // an analysis-only table reads its seasons from its source; if that cannot be read, the table keeps the
  // seasons the manifest holds (its newest is refreshed, nothing is backfilled) and the plan says so
  let all
  try { all = extra.includes(t) ? (await EXTRA[key].seasons()).sort() : Object.keys(catSeasons).sort() } catch (e) {
    all = Object.keys(have).sort(); detail.push(key + ': its seasons could not be read (' + String(e.message || e).slice(0, 80) + '), so no backfill')
  }
  if (!all.length) continue
  const cur = (all.length === 1 && all[0] === 'all') || t === 'coaching_programs' ? 'all' : only && all.includes(only) ? only : all[all.length - 1]
  const missing = all.filter((s) => !have[s] && s !== cur)
  // the table's own bytes per row where the manifest holds a season of it; its average file where rows are unknown
  const held = Object.values(have), hr = held.reduce((n, x) => n + (x.rows || 0), 0), hb = held.reduce((n, x) => n + (x.bytes || 0), 0)
  const perRow = hr ? hb / hr : +perRowDefault, perFile = held.length ? hb / held.length : 1e6
  let tb = 0
  for (const s of missing) tb += catSeasons[s] && catSeasons[s].rows != null ? catSeasons[s].rows * perRow : perFile
  files += missing.length; bytes += tb
  if (missing.length) detail.push(key + ': ' + missing.length + ' (' + missing[0] + (missing.length > 1 ? ' to ' + missing[missing.length - 1] : '') + ', about ' + (tb / 1e6).toFixed(2) + ' MB)')
  rows.push([t, cur, missing])
}
const over = files > +maxFiles || bytes > +maxMb * 1e6
for (const [t, cur, missing] of rows) console.log(t + ' ' + [...new Set([...(over ? [] : missing), cur])].join(' '))
console.log('#BACKFILL ' + files + ' ' + Math.round(bytes) + ' ' + (over ? 1 : 0) + ' ' + (detail.join('; ') || 'none'))
process.exit(0)" "$SPORT" "$ONLY" "$BACKFILL_MAX_FILES" "$BACKFILL_MAX_MB" "$BACKFILL_BYTES_PER_ROW" 2>/dev/null)
PAIRS=$(grep -v '^#' <<< "$PLAN")
read -r _ BF_FILES BF_BYTES BF_OVER BF_DETAIL <<< "$(grep '^#BACKFILL ' <<< "$PLAN")"
BF_MB=$(awk "BEGIN{printf \"%.1f\", ${BF_BYTES:-0}/1e6}")
if [ "${BF_FILES:-0}" != 0 ]; then
  echo "Parquet: $SPORT backfill: ${BF_FILES} missing files, about ${BF_MB} MB: ${BF_DETAIL}"
fi

if [ -n "$DRY_RUN" ]; then
  echo "Parquet dry run ($SPORT): the cap is ${BACKFILL_MAX_FILES} files or ${BACKFILL_MAX_MB} MB; this run $([ "${BF_OVER:-0}" = 1 ] && echo "is OVER it and would build no missing season" || echo "is within it")."
  echo "$PAIRS" | while read -r t seasons; do [ -n "$t" ] && echo "  $SPORT.$t: $seasons"; done
  if [ "$DRY_RUN" = build ]; then
    while read -r t seasons; do
      [ -n "$t" ] || continue
      # shellcheck disable=SC2086
      node pipeline/dataroom/parquet.mjs "$SPORT" "$t" $seasons --out "$OUT" >/dev/null 2>"$OUT/err" || echo "  $SPORT.$t: build failed: $(tail -1 "$OUT/err" | cut -c1-200)"
    done <<< "$PAIRS"
    cp "$OUT/manifest.before" "$MAN"
    ls -l "$OUT"/*.parquet 2>/dev/null | awk '{n++; b+=$5; print "  built " $NF " " $5 " bytes"} END {printf "Parquet dry run: built %d files, %d bytes (%.2f MB), uploaded none; the manifest was put back.\n", n, b, b/1e6}'
  fi
  rm -rf "$OUT"
  exit 0
fi

dr_token_ok || { warn "Parquet: $DR_NO_TOKEN"; exit 0; }
[ "${BF_OVER:-0}" = 1 ] && warn "Parquet: $SPORT backfill skipped: ${BF_FILES} missing files, about ${BF_MB} MB, over the cap of ${BACKFILL_MAX_FILES} files or ${BACKFILL_MAX_MB} MB (pipeline/dataroom/parquet_publish.sh); only the seasons in progress were written. ${BF_DETAIL}"
[ -n "$PAIRS" ] || { echo "Parquet: no $SPORT tables"; exit 0; }

sha_of() { node --input-type=module -e "import { readManifest } from './pipeline/dataroom/parquet.mjs'; const e = readManifest().tables['$SPORT.$1']; console.log((e && e.seasons['$2'] && e.seasons['$2'].file_sha256) || '')" 2>/dev/null; }
ok=1
while read -r t seasons; do
  [ -n "$t" ] || continue
  for s in $seasons; do echo "$s $(sha_of "$t" "$s")"; done > "$OUT/before"
  # shellcheck disable=SC2086
  if ! node pipeline/dataroom/parquet.mjs "$SPORT" "$t" $seasons --out "$OUT" >/dev/null 2>"$OUT/err"; then
    warn "Parquet: $SPORT $t was not rewritten in full: $(grep -v '^\[savant\]' "$OUT/err" | tail -1 | cut -c1-300)"
  fi
  while read -r s before; do
    f="$OUT/$SPORT-$t-$s.parquet"
    [ -f "$f" ] || continue
    after=$(sha_of "$t" "$s")
    [ -n "$after" ] || continue
    if [ -n "$before" ] && [ "$before" = "$after" ]; then continue; fi
    for try in 1 2 3; do
      if gh release upload "$TAG" "$f" -R "$REPO" --clobber >/dev/null 2>&1; then echo "Parquet: uploaded $(basename "$f") ($(wc -c <"$f" | tr -d ' ') bytes)"; UP=$((UP+1)); break; fi
      [ $try = 3 ] && { warn "Parquet: upload of $(basename "$f") failed"; ok=0; }
      sleep 5
    done
  done < "$OUT/before"
done <<< "$PAIRS"
if [ $ok = 0 ] && [ -f "$OUT/manifest.before" ]; then
  cp "$OUT/manifest.before" "$MAN"; warn "Parquet: the manifest was put back (an upload failed)"
fi
exit 0
