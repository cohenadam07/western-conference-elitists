#!/bin/bash
# vercel-ignore.sh — Vercel's Ignored Build Step for this site (vercel.json "ignoreCommand").
# Exit 0 skips the commit; exit 1 builds it.
#
# Why: every deployment carries all of public/ (about 280 MB built), and the data bots used to
# deploy every commit they made, about 20 a day. Vercel keeps a few days of deployments, so
# that came to 22 GB of Deployment Storage against the Hobby plan's 10 GB (Nov 2, 2026).
#
# So production skips commits from the data bots, and .github/workflows/deploy-batch.yml ships
# what they've committed a few times a day (an empty "deploy:" commit, which builds here like
# any other). Everything else builds at once, as before:
#   - code changes (Adam's commits, Claude's, merged pull requests)
#   - the deploy batch's own commits
#   - any commit with [deploy] in its first line
#   - every preview deployment
# A misjudged commit only changes when it goes live: a skipped one ships with the next batch.
#
# Branches with no package.json (tracking-data, bcs-bundles: data the cloud refresh reads, not
# a site) are skipped, which is what the project's dashboard setting did before this file
# took over from it.
#
# The bots' commit addresses; keep in step with BOTS in .github/scripts/deploy_batch.py.
BOTS=" bot@wcehoops.com actions@users.noreply.github.com "

if [ ! -f package.json ]; then
  echo "skip: no package.json (a data branch, not the site)"; exit 0
fi
if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "build: ${VERCEL_ENV:-unknown} deployment"; exit 1
fi
author=$(git log -1 --format=%ae 2>/dev/null | tr '[:upper:]' '[:lower:]')
subject=$(git log -1 --format=%s 2>/dev/null)
case "$subject" in
  *"[deploy]"*) echo "build: [deploy] in the commit message"; exit 1 ;;
esac
if [ -n "$author" ] && [[ "$BOTS" == *" $author "* ]]; then
  echo "skip: data commit from $author ($subject). It goes live with the next deploy batch (deploy-batch.yml)."
  exit 0
fi
echo "build: ${author:-unknown author} ($subject)"
exit 1
