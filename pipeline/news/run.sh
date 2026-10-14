#!/bin/bash
# WCE news pipeline runner (launchd, com.wcehoops.news, 3x a day).
#
# Runs inside a dedicated worktree of the site repo, ~/western-conference-elitists/.worktrees/news-bot,
# which the launchd job resets to origin/main before every run (see com.wcehoops.news.plist).
# It never touches a working copy anyone edits by hand. Until Oct 14 2026 the job pulled into
# ~/nba_prospect_model/website, an old copy that had diverged from main on Aug 3; every run
# since failed at `git pull --ff-only`, so news.json sat at July 31 for ten weeks.
#
# Builds public/news.json and, if it changed, commits it as wce-news-bot and pushes to main
# (Vercel redeploys). A failed run exits non-zero, so `launchctl list` shows it.
set -uo pipefail

PY="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
WT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$HOME/Library/Logs/wce-news"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/run.log" 2>&1
echo "===== $(date '+%Y-%m-%d %H:%M:%S') run start ($(git -C "$WT" rev-parse --short HEAD)) ====="

# Optional overrides (WCE_OLLAMA_URL / WCE_OLLAMA_MODEL / ...) in a file outside the repo.
[ -f "$HOME/.wce-news.env" ] && . "$HOME/.wce-news.env"

cd "$WT" || { echo "worktree not found: $WT"; exit 1; }

"$PY" -m pipeline.news.build_news || { echo "pipeline failed"; exit 1; }

if git diff --quiet -- public/news.json; then
  echo "news.json unchanged — nothing to deploy"
  echo "===== run end ====="
  exit 0
fi

git add public/news.json
git -c user.name="wce-news-bot" -c user.email="bot@wcehoops.com" \
  commit -q -m "news: refresh feed $(date '+%Y-%m-%d %H:%M')" -m "Automated run of the WCE news pipeline." \
  || { echo "commit failed"; exit 1; }
for attempt in 1 2 3; do
  if git push -q origin HEAD:main; then echo "pushed news.json — Vercel will redeploy"; break; fi
  echo "push rejected (attempt $attempt); rebasing on origin/main"
  git fetch -q origin main && git rebase -q origin/main || { git rebase --abort; echo "rebase failed"; exit 1; }
  [ $attempt -eq 3 ] && { echo "git push failed"; exit 1; }
done
echo "===== run end ====="
