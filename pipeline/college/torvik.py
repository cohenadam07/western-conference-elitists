"""
torvik.py — birthdates, from T-Rank's public player file, and nothing else.

The rules (build prompt, ground rule 4), which this module is the only place to enforce:
  * One URL: https://barttorvik.com/getadvstats.php?year=YYYY&csv=1
  * At most once a week per season, at least 10 seconds apart, with a User-Agent naming
    wcehoops.com and a contact.
  * Only the last column is used, as an input to age. The name, team and jersey are kept only to
    match the row to an ESPN player. Every other column is dropped in memory here: no Torvik
    rating is ever written to disk, displayed or served.
  * No other page of his, no .json file.

Written to <COLLEGE_HOME>/torvik/<season>.json: [[name, team, jersey, birthdate], ...]
Stamped so a second run within seven days does nothing.
"""
import csv
import io
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402

URL = "https://barttorvik.com/getadvstats.php?year={year}&csv=1"
UA = "wcehoops.com College Basketball Savant (birthdates for age; weekly; contact keys@wcehoops.com)"
GAP = 10.0
WEEK = 7 * 86400
DIR = os.path.join(CC.HOME, "torvik")
DOB = re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4}$|^\d{4}-\d{2}-\d{2}$")


def path(season):
    return os.path.join(DIR, f"{season}.json")


def due(season):
    p = path(season)
    return not os.path.exists(p) or time.time() - os.path.getmtime(p) >= WEEK


def parse(text):
    """The file has no header: name first, team second, jersey found by position, birthdate last."""
    out = []
    bad = 0
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 10:
            continue
        name, team, dob = row[0].strip(), row[1].strip(), row[-1].strip()
        if not name:
            continue
        if dob and not DOB.match(dob):
            bad += 1
            dob = ""
        out.append([name, team, dob])
    return out, bad


def fetch(seasons, log=print):
    os.makedirs(DIR, exist_ok=True)
    first = True
    for s in seasons:
        if not due(s):
            log(f"torvik {s}: fetched within the week, left alone")
            continue
        if not first:
            time.sleep(GAP)
        first = False
        year = int(s[:4]) + 1
        req = urllib.request.Request(URL.format(year=year), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode("utf8", "replace")
        rows, bad = parse(text)
        if not rows:
            log(f"torvik {s}: no rows; keeping the last copy")
            continue
        tmp = path(s) + ".tmp"
        json.dump(rows, open(tmp, "w"), separators=(",", ":"))
        os.replace(tmp, path(s))
        log(f"torvik {s}: {len(rows)} rows, {sum(1 for r_ in rows if r_[2])} with a birthdate, {bad} unreadable")


if __name__ == "__main__":
    fetch(sys.argv[1:])
