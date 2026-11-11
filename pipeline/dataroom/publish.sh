#!/bin/bash
# pipeline/dataroom/publish.sh <sport> [season] — after a sport's refresh has written its Data Room files:
#   1. every hosted file (DATAROOM_HOSTED, default out/dataroom) whose bytes differ from what the
#      catalog says was published is uploaded as a GitHub release asset (tag "dataroom",
#      <sport>-<table>-<season>.json.gz, replacing the old one)
#   2. the catalog (public/dataroom/catalog.json.gz) is rescanned for that sport, so the workflow's
#      own commit step carries it with the small public tables
# A Data Room failure must never block a Savant page (research/data-room/BUILD.md §6 step 4): every
# error is a ::warning:: and the script exits 0. If an upload fails the catalog is left as it was,
# so the catalog never points at a file that is not there.
#
# Needs GH_TOKEN (the workflow's github.token with contents: write) and the gh CLI. Locally:
#   bash pipeline/dataroom/publish.sh nfl          (uses your gh login)
set -u
SPORT="${1:?sport}"
ONLY="${2:-}"
cd "$(dirname "$0")/../.."
export DATAROOM_HOSTED="${DATAROOM_HOSTED:-out/dataroom}"
TAG=dataroom
REPO="${GITHUB_REPOSITORY:-cohenadam07/western-conference-elitists}"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

# which hosted files changed: name and path, one per line
CHANGED=$(python3 - "$SPORT" "$ONLY" <<'PY'
import gzip, hashlib, json, os, sys
sport, only = sys.argv[1], sys.argv[2]
hosted = os.environ['DATAROOM_HOSTED']
cat = {}
p = 'public/dataroom/catalog.json.gz'
if os.path.exists(p):
    cat = json.load(gzip.open(p, 'rt'))['sports'].get(sport, {})
base = os.path.join(hosted, sport)
for t in sorted(os.listdir(base)) if os.path.isdir(base) else []:
    for fn in sorted(os.listdir(os.path.join(base, t))):
        if not fn.endswith('.json.gz'):
            continue
        s = fn[:-8]
        if only and s != only:
            continue
        f = os.path.join(base, t, fn)
        sha = hashlib.sha256(open(f, 'rb').read()).hexdigest()
        if ((cat.get(t) or {}).get('seasons') or {}).get(s, {}).get('sha256') != sha:
            print(f'{sport}-{t}-{s}.json.gz {f}')
PY
)
ok=1
if [ -n "$CHANGED" ]; then
  if ! gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
    gh release create "$TAG" -R "$REPO" --prerelease --title "WCE Data Room tables" \
      --notes "Data files for the WCE connector's Data Room (savant_data). Not a software release: the refresh workflows replace these assets in place. See research/data-room/BUILD.md." \
      >/dev/null 2>&1 || { echo "::warning::Data Room: could not create the $TAG release"; ok=0; }
  fi
  while read -r name file; do
    [ -n "$name" ] || continue
    cp "$file" "$STAGE/$name"
    for try in 1 2 3; do
      if gh release upload "$TAG" "$STAGE/$name" -R "$REPO" --clobber >/dev/null 2>&1; then echo "Data Room: uploaded $name ($(wc -c <"$file" | tr -d ' ') bytes)"; break; fi
      [ $try = 3 ] && { echo "::warning::Data Room: upload of $name failed"; ok=0; }
      sleep 5
    done
  done <<< "$CHANGED"
else
  echo "Data Room: no hosted $SPORT file changed"
fi
if [ $ok = 1 ]; then
  python3 pipeline/dataroom/catalog.py "$SPORT" ${ONLY:+--current "$ONLY"} >/dev/null 2>&1 \
    && echo "Data Room: catalog updated for $SPORT" || echo "::warning::Data Room: the $SPORT catalog update failed"
else
  echo "::warning::Data Room: $SPORT catalog left as it was (an upload failed)"
fi
exit 0
