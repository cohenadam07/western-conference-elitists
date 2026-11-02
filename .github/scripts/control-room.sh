#!/usr/bin/env bash
# control-room.sh — a job checking in with the WCE Control Room (wcehoops.com/api/status).
#
#   bash .github/scripts/control-room.sh <job id> <start|success|failure|cancelled> [detail]
#
# Called at the start and the end of every GitHub workflow (the end step runs `if: always()`
# with the job's status) and by the Mac's launchd jobs (pipeline/news/run.sh,
# pipeline/basketball/publish_tracking.sh). The feed sends the phone push itself, once per
# failure streak; if the feed can't be reached and this is a failure, this script pushes to
# ntfy directly, so a down site never silences an alert.
#
# Settings, from the environment:
#   WCE_STATUS_KEY   the feed's key (on the Mac, from ~/.config/wce/control-room.env). GitHub
#                    workflows don't need it: they use GitHub's signed identity token instead.
#   WCE_NTFY_TOPIC   Adam's private ntfy topic, for the direct-push fallback. Optional (a GitHub
#                    secret, if set; on the Mac, the same env file).
#   WCE_SOURCE       github | mac (worked out when not set)
#
# It never fails the job: every error is caught, and it always exits 0.
set -u
job="${1:-}"; state="${2:-}"; detail="${3:-}"
[ -n "$job" ] && [ -n "$state" ] || { echo "control room: usage: control-room.sh <job> <state> [detail]"; exit 0; }
PY="${PYTHON:-python3}"

# Who we are: the key (the Mac), or, in a GitHub workflow with `id-token: write`, GitHub's own
# signed token for this run, which the feed checks against GitHub's public keys. No secret needed.
auth="${WCE_STATUS_KEY:-}"
if [ -z "$auth" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
  auth=$(curl -sS -f -m 10 -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=wcehoops-status" 2>/dev/null \
    | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["value"])' 2>/dev/null || true)
fi
[ -n "$auth" ] || { echo "control room: no key and no GitHub identity token; not reporting"; exit 0; }

run=""
if [ -n "${GITHUB_RUN_ID:-}" ]; then
  run="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
fi
src="${WCE_SOURCE:-}"
[ -n "$src" ] || { [ -n "${GITHUB_ACTIONS:-}" ] && src=github || src=mac; }

# When the run started, so the end can tell its own commit from one it merely pulled.
if [ "$state" = start ] && [ -n "${RUNNER_TEMP:-}" ]; then date +%s > "$RUNNER_TEMP/control-room-start" 2>/dev/null || true; fi

if [ -z "$detail" ] && [ -n "${GITHUB_ACTIONS:-}" ]; then
  case "$state" in
    start)
      case "${GITHUB_EVENT_NAME:-}" in
        schedule) detail="Started on schedule" ;;
        workflow_dispatch) detail="Started on request" ;;
        push) detail="Started by a code change" ;;
        *) detail="Started" ;;
      esac ;;
    success)
      # What the run published: the commit it pushed, if it moved HEAD.
      head=$(git rev-parse HEAD 2>/dev/null || true)
      began=$(cat "${RUNNER_TEMP:-/nonexistent}/control-room-start" 2>/dev/null || echo 0)
      made=$(git log -1 --format=%ct 2>/dev/null || echo 0)
      if [ -n "$head" ] && [ -n "${GITHUB_SHA:-}" ] && [ "$head" != "$GITHUB_SHA" ] && [ "$made" -ge "$began" ]; then
        detail="Published: $(git log -1 --format=%s 2>/dev/null)"
      else
        detail="Ran clean; nothing new to publish"
      fi ;;
    failure)
      # Which step broke, from this run's own record (public repo; GH_TOKEN is the job's token).
      if command -v gh >/dev/null 2>&1 && [ -n "${GH_TOKEN:-}" ]; then
        steps=$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs" \
          --jq '[.jobs[].steps[] | select(.conclusion == "failure") | .name] | join(", ")' 2>/dev/null || true)
        [ -n "$steps" ] && detail="Failed at: $steps"
      fi
      [ -n "$detail" ] || detail="The run failed" ;;
    cancelled) detail="Cancelled (stopped by hand, or it hit its time limit)" ;;
  esac
fi

body=$("$PY" - "$job" "$state" "$detail" "$run" "$src" <<'PY' 2>/dev/null
import json, sys
job, state, detail, run, src = sys.argv[1:6]
print(json.dumps({"job": job, "state": state, "detail": detail[:300], "run": run, "source": src}))
PY
)
[ -n "$body" ] || { echo "control room: couldn't build the check-in (no python3?)"; exit 0; }

if resp=$(curl -sS -f -m 15 -X POST "${WCE_STATUS_URL:-https://wcehoops.com/api/status}" \
    -H "Authorization: Bearer ${auth}" -H 'Content-Type: application/json' \
    --data "$body" 2>&1); then
  echo "control room: $job $state: ${resp:0:200}"
else
  echo "control room: the feed didn't take the check-in ($job $state): ${resp:0:200}"
  if [ "$state" = failure ] && [ -n "${WCE_NTFY_TOPIC:-}" ]; then
    curl -sS -m 10 -o /dev/null "https://ntfy.sh/${WCE_NTFY_TOPIC}" \
      -H "Title: WCE: $job failed" -H "Priority: high" -H "Tags: rotating_light" \
      ${run:+-H "Click: $run"} \
      -d "${detail:-It failed.} (wcehoops.com didn't answer the check-in either.)" \
      && echo "control room: pushed to the phone directly" || true
  fi
fi
exit 0
