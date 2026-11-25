#!/bin/zsh
# rebuild.sh — the whole GM Savant rebuild in one call, for unattended runs: free disk before and after, every chain
# step one at a time (run_chain.sh, which stops cleanly below 15 GB free), each step's peak memory and the status file.
# Same variables as run_chain.sh (SKIP_PAGE, ONLY_STEPS, FIRST_STEPS, EXTRA_STEPS).
#   zsh rebuild.sh               everything
#   ONLY_STEPS="titles,gm5" zsh rebuild.sh
cd "$(dirname "$0")"
echo "disk before: $(df -g . | tail -1 | awk '{print $4}') GB free"
zsh run_chain.sh; rc=$?
cat out/chain_peaks.txt
cat out/chain_status.txt
echo "disk after: $(df -g . | tail -1 | awk '{print $4}') GB free"
echo "rc=$rc"
exit $rc
