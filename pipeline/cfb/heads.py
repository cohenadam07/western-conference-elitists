"""Headshots, checked once (BUILD decision 8): which ESPN athlete ids have a college-football headshot.

    python -m pipeline.cfb.heads            # HEAD every player not yet checked; writes pipeline/cfb/state/heads.json

ESPN's path is https://a.espncdn.com/i/headshots/college-football/players/full/<athlete id>.png.
A roster row's `headshot_href` is that same path whether or not the image exists, so each id is
asked once (a HEAD request, six at a time) and the answer is kept: the page shows the photo
only for an id on the list, and an initials badge in team colours for everyone else. A network
error is never stored as an answer; that id is simply asked again next run.
"""
import json
import pandas as pd
from .espn_http import head_status, pmap
from .paths import WORK, REPO
from . import config as C

URL = "https://a.espncdn.com/i/headshots/college-football/players/full/{}.png"
FILE = REPO / "pipeline" / "cfb" / "state" / "heads.json"


def load():
    if FILE.exists():
        d = json.loads(FILE.read_text())
        return set(d["yes"]), set(d["no"])
    return set(), set()


def wanted():
    """Everyone the site can show a card for: a stat in an FBS game since 2014, or on this season's roster."""
    ids = set()
    for t in ("qb", "rush", "rec", "dfn", "kick", "punt"):
        ids |= set(pd.read_parquet(WORK / f"pg_{t}_all.parquet", columns=["pid"]).pid.astype(int))
    from .numbers import people
    p = people(C.CURRENT)
    ids |= set(p[p.fbs].pid.astype(int))
    return ids


def check(ids, chunk=3000):
    yes, no = load()
    todo = sorted(i for i in ids if i not in yes and i not in no)
    print(f"{len(ids)} players, {len(yes) + len(no)} already checked, {len(todo)} to ask", flush=True)
    for k in range(0, len(todo), chunk):
        part = todo[k:k + chunk]
        for a, (st, ct, ln) in zip(part, pmap(lambda a: head_status(URL.format(a)), part)):
            if st == 200 and (ct or "").startswith("image"):
                yes.add(a)
            elif isinstance(st, int) and st in (403, 404):
                no.add(a)
        FILE.parent.mkdir(parents=True, exist_ok=True)
        FILE.write_text(json.dumps({"yes": sorted(yes), "no": sorted(no)}, separators=(",", ":")))
        print(f"  {min(k + chunk, len(todo))} of {len(todo)} asked; with a headshot so far {len(yes)}, without {len(no)}", flush=True)
    return yes, no


if __name__ == "__main__":
    check(wanted())
