#!/bin/zsh
# checks.sh — every GM Savant check in one call (run after rebuild.sh): conservation (points and titles), the pipeline
# tests, the title model's leakage test, the page checks, the 375px tap walk, the connector, its coverage, the Data Room.
# Prints one line per check and exits 1 if any failed.
cd "$(dirname "$0")"
ROOT=../../..
fail=0
run() { local name=$1; shift; if "$@" > out/check_$name.log 2>&1; then echo "ok   $name"; else echo "FAIL $name (out/check_$name.log)"; tail -8 out/check_$name.log; fail=1; fi; }
run conserve python3 conserve.py
run pipeline python3 test_gm.py
run titles_leakage python3 titles.py leakage
run titles_conserve python3 -c "import json,sys; c=json.load(open('out/title_conservation.json')); g=[abs(r['gap']) for r in c['rows']]; print(len(g), max(g), sum(g)); sys.exit(0 if max(g) <= c['limits'][0] and sum(g) <= c['limits'][1] else 1)"
run grade_leakage python3 grade.py leakage
run page node --test $ROOT/tools/savant-gm/check.mjs
run tap node $ROOT/tools/savant-gm/tap.mjs $ROOT/public
run connector node --test $ROOT/tools/savant-mcp/check.mjs
run coverage node --test $ROOT/tools/savant-mcp/coverage.mjs
run dataroom node --test $ROOT/tools/dataroom/check.mjs
exit $fail
