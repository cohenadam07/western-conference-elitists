#!/bin/bash
# full_build.sh — every step in order, from the raw archive to public/cbb. The Mac's full build.
# Long pulls come first and separately (espn_cbb.py pull, cbbd_source.py history, torvik.py).
cd "$(dirname "$0")" || exit 1
export SSL_CERT_FILE="$(python3 -c 'import certifi;print(certifi.where())')"
ALL="2022-23 2023-24 2024-25 2025-26 2026-27"
DONE="2022-23 2023-24 2024-25 2025-26"
set -e
python3 -W ignore season.py $ALL
python3 -W ignore identity.py $ALL
python3 -W ignore positions.py $DONE
python3 -c "import positions as P;P.apply_cuts('2026-27')"
python3 -W ignore ratings.py build $ALL
python3 -W ignore ratings.py check 2023-24 2024-25 2025-26
python3 -W ignore settle.py $DONE
python3 -W ignore adjust.py
python3 -W ignore xfg.py check 2024-25 2025-26
python3 -W ignore xfg.py fit 2024-25 2025-26
python3 -W ignore rapm.py check 2024-25 2025-26
python3 -W ignore rapm.py fit 2024-25 2025-26
python3 -W ignore rapm.py build 2023-24 2024-25 2025-26 2026-27
python3 heads.py $ALL
python3 -W ignore build.py $ALL
echo "=== full build finished ==="
