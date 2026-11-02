#!/bin/bash
# mac_pull.sh — rung 2: ESPN from Adam's Mac (launchd com.wcehoops.cbb-mac-pull, 5am ET and on wake).
# It does nothing until the heartbeat says the cloud is blocked (data/cbb-refresh.json on main:
# espn_cloud_blocked). Then it pulls that game day's finals and force-pushes the raw files as one
# parentless commit to cbb-data, modeled on publish_tracking.sh. Vercel skips that branch
# (no package.json: scripts/vercel-ignore.sh). DRY_RUN=1 forces the path and stops before the push.
# Log: ~/Basketball-Savant/logs/cbb-mac.log
set -uo pipefail
SITE="${SITE:-$HOME/western-conference-elitists}"
SAVANT="$HOME/Basketball-Savant"
CODE="${CODE:-$SITE/.worktrees/savant-bot/pipeline/college}"
PY="${PYTHON:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"
OUT="$SAVANT/out/cbb/mac-push"
[ -t 1 ] || exec >> "$SAVANT/logs/cbb-mac.log" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
export SSL_CERT_FILE="$("$PY" -c 'import certifi;print(certifi.where())')"
# Mondays: this season's ages, onto cbb-bundles. T-Rank refuses GitHub's runners, and a birthdate may
# not go on a public branch, so the Mac works out the age and sends only that.
if [ "$(date +%u)" = "1" ] || [ "${AGES:-}" = "1" ]; then
  A="$SAVANT/out/cbb/ages-push"; rm -rf "$A"; mkdir -p "$A"
  git -C "$SITE" fetch -q origin cbb-bundles && git -C "$SITE" archive FETCH_HEAD | tar -x -C "$A"
  (cd "$CODE" && "$PY" espn_cbb.py pull 2026-27 >/dev/null && "$PY" -W ignore season.py 2026-27 >/dev/null && "$PY" -W ignore cloud_cbb.py ages "$A/identity") \
    && cd "$A" && git init -q . && git add -A && git -c user.name=wcehoops-mac -c user.email=bot@wcehoops.com commit -qm "cbb-bundles: ages $(date +%F)" \
    && { [ "${DRY_RUN:-}" = "1" ] && echo "ages: dry run, not pushed" || git push -qf "https://github.com/cohenadam07/western-conference-elitists.git" HEAD:refs/heads/cbb-bundles; }
  cd "$SAVANT" || exit 1
fi
BLOCKED=$(curl -fsS https://raw.githubusercontent.com/cohenadam07/western-conference-elitists/main/data/cbb-refresh.json 2>/dev/null | "$PY" -c 'import json,sys;print(json.load(sys.stdin).get("espn_cloud_blocked",False))' 2>/dev/null)
if [ "$BLOCKED" != "True" ] && [ "${DRY_RUN:-}" != "1" ]; then echo "cloud is fine"; exit 0; fi
rm -rf "$OUT"; mkdir -p "$OUT"
"$PY" - "$OUT" "$CODE" <<'PY' || exit 1
import datetime as dt, shutil, sys, os
out, code = sys.argv[1], sys.argv[2]
sys.path.insert(0, code)
import config as C, espn_cbb as E
seen = E.sweep(C.CURRENT)
days = {(dt.date.today() - dt.timedelta(n)).isoformat() for n in range(3)}
evs = [e for e in E.finals(seen) if e["date"] in days]
E.pull_summaries(C.CURRENT, {d: [e for e in evs if e["date"] == d] for d in days})
for e in evs:
    p = E.raw_path(C.CURRENT, e["id"])
    if os.path.exists(p):
        shutil.copy(p, out)
shutil.copy(os.path.join(E.ROOT, C.CURRENT, "days.json"), out)
print(len(evs), "finals packed")
PY
cd "$OUT" || exit 1
git init -q . && git add -A && git -c user.name=wcehoops-mac -c user.email=bot@wcehoops.com commit -qm "cbb-data $(date +%F)"
if [ "${DRY_RUN:-}" = "1" ]; then echo "dry run: $(git ls-files | wc -l | tr -d ' ') files in one parentless commit ($(git rev-list --count HEAD)); not pushed"; exit 0; fi
git push -qf "https://github.com/cohenadam07/western-conference-elitists.git" HEAD:refs/heads/cbb-data && echo pushed
