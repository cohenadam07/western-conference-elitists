"""
lines.py — closing lines for the seasons ESPN's pickcenter has none (2023-24, 2024-25).

CBBD /lines stops at 3,000 rows a call, so a season takes a few calls by date window. Rows are
inputs to the market rating; they are never served. Written to ref/lines-<season>.json as
{ESPN event id: [home spread, total]}, joined by date and CBBD team id -> ESPN team id.

    python3 lines.py 2023-24 2024-25
"""
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as C  # noqa: E402
import espn_cbb as E  # noqa: E402

REF = os.path.join(C.HOME, "ref")
WINDOWS = [("-10-28", "-12-20", 0), ("-12-20", "-02-05", 1), ("-02-05", "-04-12", 1)]


def pull(season):
    y = int(season[:4])
    out_rows = []
    for a, b, bump in WINDOWS:
        ya = y + (1 if a[1:3] in ("01", "02", "03", "04") else 0)
        yb = y + (1 if b[1:3] in ("01", "02", "03", "04") else 0)
        r, _ = C.get("/lines", season=y + 1, startDateRange=f"{ya}{a}T00:00:00Z", endDateRange=f"{yb}{b}T00:00:00Z")
        out_rows += r
    ids = {}
    teams = json.load(open(os.path.join(REF, "teams-2026.json")))
    for t in teams:
        ids[t["id"]] = str(t["sourceId"])
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    key = {}
    for d, evs in seen.items():
        for e in evs:
            k = {t["side"]: t["id"] for t in e["teams"]}
            key[(k.get("home"), k.get("away"), d)] = e["id"]
            nd = (dt.date.fromisoformat(d) + dt.timedelta(1)).isoformat()
            key.setdefault((k.get("home"), k.get("away"), nd), e["id"])     # late tips are the next UTC day
    out = {}
    miss = 0
    for r in out_rows:
        ls = [x for x in r.get("lines") or [] if x.get("spread") is not None]
        if not ls:
            continue
        h, a = ids.get(r.get("homeTeamId")), ids.get(r.get("awayTeamId"))
        gid = key.get((h, a, (r.get("startDate") or "")[:10]))
        if gid is None:
            miss += 1
            continue
        out[gid] = [ls[0]["spread"], ls[0].get("overUnder")]
    json.dump(out, open(os.path.join(REF, f"lines-{season}.json"), "w"))
    print(season, "rows", len(out_rows), "lines joined", len(out), "unjoined", miss, "ledger", C.calls_this_month())


def load(season):
    p = os.path.join(REF, f"lines-{season}.json")
    return json.load(open(p)) if os.path.exists(p) else {}


if __name__ == "__main__":
    for s in sys.argv[1:]:
        pull(s)
