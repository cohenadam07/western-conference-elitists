#!/usr/bin/env bash
# Builds the Control Room page's scripts: tools/control-room/*.ts -> public/control/*.js
# (plain ES modules, no bundler; public/control.html loads page.js). Run from the repo root:
#   bash tools/control-room/build.sh
# draw.ts is shared with the /wce Claude mod (its hooks/draw.ts): change one, copy to the other.
set -euo pipefail
cd "$(dirname "$0")/../.."
npx -y -p typescript@5.6 tsc \
  --target es2020 --module esnext --moduleResolution bundler --lib es2020,dom,dom.iterable \
  --strict --noUncheckedIndexedAccess --skipLibCheck \
  --outDir public/control \
  tools/control-room/page.ts tools/control-room/draw.ts tools/control-room/types.ts
rm -f public/control/types.js
echo "built public/control/: $(ls public/control | tr '\n' ' ')"
