#!/bin/bash
# WCE news pipeline runner (invoked by the launchd job 3x/day).
# Pulls latest, rebuilds public/news.json, and — if it changed — commits and
# pushes main so Vercel redeploys wcehoops.com.
set -uo pipefail

REPO="/Users/adamcohen/nba_prospect_model/website"
PY="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
LOG_DIR="$REPO/pipeline/news/logs"
RUN_LOG="$LOG_DIR/run.log"

mkdir -p "$LOG_DIR"
exec >>"$RUN_LOG" 2>&1
echo "===== $(date '+%Y-%m-%d %H:%M:%S') run start ====="

# Optional config overrides (WCE_OLLAMA_URL / WCE_OLLAMA_MODEL / etc.) live in a
# gitignored env file, not the plist or the repo. WCE lines use a local Ollama
# model; if Ollama isn't running the pipeline still completes with null lines.
[ -f "$HOME/.wce-news.env" ] && . "$HOME/.wce-news.env"

cd "$REPO" || { echo "repo not found: $REPO"; exit 1; }

# Stay current with main; skip the run on a diverged tree rather than force it.
git pull --ff-only origin main || { echo "git pull failed — skipping run"; exit 1; }

"$PY" -m pipeline.news.build_news || { echo "pipeline failed"; exit 1; }

if git diff --quiet -- public/news.json; then
  echo "news.json unchanged — nothing to deploy"
  echo "===== run end ====="
  exit 0
fi

git add public/news.json
git commit -m "news: refresh feed $(date '+%Y-%m-%d %H:%M')" \
  -m "Automated run of the WCE news pipeline." || { echo "commit failed"; exit 1; }
git push origin main || { echo "git push failed"; exit 1; }
echo "pushed news.json — Vercel will redeploy"
echo "===== run end ====="
