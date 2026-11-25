#!/bin/zsh
# run_chain.sh — rebuild every GM Savant output in order, one step at a time (never two at once: each needs up to
# ~0.6 GB). out/chain_status.txt records each step as it finishes, with the commit it ran on; a step without a "done"
# line did not finish and its output is not trusted. out/chain_peaks.txt has each step's peak memory and time;
# out/chain_hashes.txt the checksum of every output, ignored files included (hashes.py).
#   SKIP_PAGE=1 ./run_chain.sh      the pipeline only, not the page files
cd "$(dirname "$0")"
S=out/chain_status.txt
echo "start $(date -u +%FT%TZ) $(git rev-parse --short HEAD)" > $S; : > out/chain_peaks.txt
steps=(${FIRST_STEPS:-ledger} credit grade conserve holding draftstyle titles_ref titles titles_dec gm5 gm5_detail repeat6 report6 ${=EXTRA_STEPS})
[ -z "$SKIP_PAGE" ] && steps+=(build_page page/assemble "../../dataroom/catalog nba")
# ONLY_STEPS="gm5_detail,build_page,../../dataroom/catalog nba": just these, comma-separated, in order (a partial rebuild)
[ -n "$ONLY_STEPS" ] && steps=(${(s:,:)ONLY_STEPS})
for step in $steps; do
  args=(${=step}); script=$args[1].py
  echo "running $step $(date -u +%FT%TZ)" >> $S
  if PEAK_LOG=out/chain_peaks.txt python3 peak.py $script ${args[2,-1]} > out_${${args[1]}:t}.log 2>&1; then echo "done $step $(date -u +%FT%TZ)" >> $S
  else echo "FAILED $step $(date -u +%FT%TZ)" >> $S; tail -5 out_${${args[1]}:t}.log; exit 1; fi
done
python3 hashes.py > out/chain_hashes.txt
echo "complete $(date -u +%FT%TZ)" >> $S
