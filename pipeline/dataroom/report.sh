# pipeline/dataroom/report.sh — sourced by publish.sh and parquet_publish.sh. The Data Room's own
# Control Room light, one per sport (dataroom-nba, -nfl, -cfb, -cbb, -ufc on /control).
#
# Why it exists (Nov 15, 2026): a Data Room failure is only a ::warning:: so it can never block a
# Savant page, and the refresh that ran it still ends green. College football's uploads failed on
# every run from Nov 11 to Nov 15 (its workflow step had no GH_TOKEN) and nothing looked wrong until
# the connector's tables were 4 days behind. Now every publish checks in: red on the first failed
# upload, with the reason, and the feed sends the phone push.

# A GitHub runner's gh has no login of its own: the step must pass the job's token.
dr_token_ok() {
  [ -z "${GITHUB_ACTIONS:-}" ] && return 0
  [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]
}
DR_NO_TOKEN='no GitHub token in this step, so nothing could be uploaded. Add "GH_TOKEN: ${{ github.token }}" to the env of the workflow step that runs the Data Room'

# dr_report <sport> <success|failure> <detail>. Quiet, and never fails: without a key or a GitHub
# identity token (a run on the Mac) control-room.sh simply doesn't report. DATAROOM_PARENT is set
# when publish.sh runs parquet_publish.sh, so one publish makes one check-in.
dr_report() {
  [ -n "${DATAROOM_PARENT:-}" ] && return 0
  bash .github/scripts/control-room.sh "dataroom-$1" "$2" "$3" >/dev/null 2>&1 || true
  return 0
}
