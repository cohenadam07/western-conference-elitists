"""
repair.py — put back the accents a refresh dropped, in the files already published (one-off, Nov
2026; the refreshes keep them from then on through pipeline/accents.py).

    python3 tools/accents/repair.py [--dry]

For every sport audit.py covers, each player id's de-accented spelling is replaced by its accented
twin (accents.canonical), and only in that sport's own files:
  Basketball Savant  savant-data.json, savant-current.json, savant-proj.json
  Football Savant    football-savant-current.json (the archive already has the accents)
  College Football   public/cfb/** (season, search, player and team files)
  College Basketball public/cbb/** (nothing to do today)
Other products that show the same players (Coaching Savant, news, articles, dynasty) never had the
accented spelling from their own sources and are left alone.

Every fixed spelling belongs to one id in its sport (audit.py checks no other id uses it), so a file
is fixed by parsing and rewriting it when that round-trips byte-for-byte, and otherwise by replacing
the exact JSON string, written the way the file writes non-ASCII (escaped or not).
"""
import argparse
import glob
import gzip
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, HERE)
import accents as A  # noqa: E402
import audit as AU  # noqa: E402

PUB = os.path.join(ROOT, "public")
FILES = {"Basketball Savant": ["savant-data.json", "savant-current.json", "savant-proj.json"],
         "Football Savant": ["football-savant-current.json"],
         "College Football Savant": ["cfb/**/*.json*"],
         "College Basketball Savant": ["cbb/**/*.json*"]}


def fixes_for(sport):
    by, users = defaultdict(dict), defaultdict(set)
    for s, i, n in AU.SPORTS[sport]():
        by[i][s] = n
        users[n].add(i)
    out = {}
    for i, seasons in by.items():
        for n, to in A.canonical(seasons.values()).items():
            if n != to:
                if users[n] - {i}:
                    raise SystemExit(f"{sport}: {n!r} is also another player's name; not safe to replace")
                out[n] = to
    return out


def _read(p):
    raw = gzip.open(p).read() if p.endswith(".gz") else open(p, "rb").read()
    return raw.decode("utf-8")


def _write(p, text):
    data = text.encode("utf-8")
    if p.endswith(".gz"):
        with gzip.GzipFile(p, "wb", mtime=0) as f:
            f.write(data)
    else:
        with open(p, "wb") as f:
            f.write(data)


def fix_file(p, fixes):
    t = _read(p)
    escaped = "\\u00" in t or "\\u01" in t
    n = 0
    for bad, good in fixes.items():
        needle = json.dumps(bad)
        if needle not in t:
            continue
        repl = json.dumps(good, ensure_ascii=escaped)
        n += t.count(needle)
        t = t.replace(needle, repl)
    return t, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    for sport, globs in FILES.items():
        fixes = fixes_for(sport)
        files = sorted({f for g in globs for f in glob.glob(os.path.join(PUB, g), recursive=True) if os.path.isfile(f)})
        touched, strings = 0, 0
        for p in files:
            if not fixes:
                break
            t, n = fix_file(p, fixes)
            if n:
                json.loads(t)                       # still valid JSON
                if not a.dry:
                    _write(p, t)
                touched += 1
                strings += n
        print(f"{sport}: {len(fixes)} spellings fixed, {strings} occurrences in {touched} files" + (" (dry run)" if a.dry else ""))
        for bad, good in list(fixes.items())[:20]:
            print(f"    {bad} -> {good}")


if __name__ == "__main__":
    main()
