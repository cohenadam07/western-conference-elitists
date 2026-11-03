#!/bin/bash
# full_build.sh — every step in order, from the raw archive to public/cbb. The Mac's full build.
# Long pulls come first and separately (espn_cbb.py pull, cbbd_source.py history, torvik.py).
cd "$(dirname "$0")" || exit 1
export SSL_CERT_FILE="$(python3 -c 'import certifi;print(certifi.where())')"
BOX="2013-14 2014-15 2015-16 2016-17 2017-18 2018-19 2019-20 2020-21 2021-22"
LIVE="2022-23 2023-24 2024-25 2025-26"
ALL="$BOX $LIVE 2026-27"
set -e
[ "${SKIP_SEASONS:-}" = "1" ] || python3 -W ignore season.py $ALL
python3 -W ignore identity.py $ALL
python3 heads.py $ALL
python3 -W ignore bpi_pull.py 2025-26 2024-25 2023-24 || true
python3 -W ignore ratings.py build $ALL
python3 -W ignore ratings.py check 2023-24 2024-25 2025-26
python3 -W ignore positions.py $LIVE
python3 -c "
import positions as P
for s in '$BOX 2026-27'.split(): P.apply_cuts(s)"
python3 -W ignore settle.py $BOX $LIVE
python3 -W ignore adjust.py
python3 -W ignore xfg.py check 2024-25 2025-26
python3 -W ignore xfg.py fit 2024-25 2025-26
python3 -W ignore rapm.py check 2024-25 2025-26
python3 -W ignore rapm.py fit 2024-25 2025-26
python3 -W ignore rapm.py build $ALL
python3 -W ignore confidence.py
rm -f seed/value_model.json
python3 -W ignore build.py $ALL
python3 -W ignore college_value.py test
python3 -W ignore team_fit.py compare
python3 -W ignore team_fit.py fit
python3 -W ignore build.py $ALL
python3 -W ignore ap_check.py overlap
python3 -W ignore team_fit.py drivers
python3 -W ignore college_value.py dump
echo "=== full build finished ==="
