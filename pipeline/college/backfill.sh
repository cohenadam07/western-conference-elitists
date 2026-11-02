#!/bin/bash
# backfill.sh — seasons before the launch window, newest first, through the same parser and gates.
# ESPN direct: hoopR-mbb-data is built from these same responses and a direct pull archives the raw
# file, costs about 2 minutes a season and needs no second parser. Each season's gates land in
# <home>/rebuilt/<season>/gates.json. A season joins the site only after Adam has seen those.
cd "$(dirname "$0")" || exit 1
export SSL_CERT_FILE="$(python3 -c 'import certifi;print(certifi.where())')"
for y in 2021 2020 2019 2018 2017 2016 2015 2014 2013 2012 2011 2010 2009 2008 2007 2006; do
  s="$y-$(printf %02d $(( (y + 1) % 100 )))"
  python3 -W ignore espn_cbb.py pull "$s" && python3 -W ignore season.py "$s"
done
echo "=== backfill finished ==="
