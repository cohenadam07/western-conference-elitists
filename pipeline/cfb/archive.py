"""The raw archive: a month's ESPN responses as one bundle, on Adam's Mac only (Adam, Nov 10 2026: raw ESPN
stays off GitHub, as College Basketball Savant's does; BUILD's "cfb-raw release asset" is dropped).

    python -m pipeline.cfb.archive pull              fetch the season being played into the Mac's cache (the cloud's
                                                     copy lives in the Actions cache, which expires)
    python -m pipeline.cfb.archive pack 2026-11      -> ~/College-Football-Savant/archive/cfb-raw-2026-11.tar
    python -m pipeline.cfb.archive verify 2026-11    every member decompresses and parses; prints the count

A month's bundle holds every cached response written that month (summaries, plays pages, scoreboards,
rosters), so a later ESPN cutoff or correction never erases what the site was built from. Run `pull` weekly and
`pack` on the 1st (a launchd job, or by hand).
"""
import gzip
import json
import sys
import tarfile
import datetime as dt
from .paths import HOME, RAW
from . import config as C

DIR = HOME / "archive"


def path(month):
    return DIR / f"cfb-raw-{month}.tar"


def members(month):
    y, m = int(month[:4]), int(month[5:7])
    out = []
    for p in sorted((RAW / "espn_live").glob("*.json.gz")):
        t = dt.datetime.fromtimestamp(p.stat().st_mtime)
        if (t.year, t.month) == (y, m):
            out.append(p)
    return out


def pack(month):
    DIR.mkdir(parents=True, exist_ok=True)
    ms = members(month)
    tmp = path(month).with_suffix(".tmp")
    with tarfile.open(tmp, "w") as tf:
        for p in ms:
            tf.add(p, arcname=p.name)
    tmp.replace(path(month))
    print(f"{path(month)}: {len(ms)} responses, {path(month).stat().st_size / 1e6:.1f} MB")


def verify(month):
    n = 0
    with tarfile.open(path(month)) as tf:
        for m in tf.getmembers():
            json.loads(gzip.decompress(tf.extractfile(m).read()).decode("utf8"), strict=False)
            n += 1
    print(f"{path(month)}: {n} responses, every one parses")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "pull":
        from .espn_feed import build_season
        out = build_season(C.CURRENT, write=False)
        print(f"{C.CURRENT}: {len(out['sources'])} finals in the Mac's cache")
    elif cmd == "pack":
        pack(sys.argv[2] if len(sys.argv) > 2 else (dt.date.today().replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m"))
    elif cmd == "verify":
        verify(sys.argv[2])
