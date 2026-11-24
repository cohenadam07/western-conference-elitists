"""
all_savant_slots.py — who can fill which All-Savant slot, by the NBA's own positional rules
(NBA Savant 2.9.0, Adam, Nov 19 2026).

The All-Savant Team follows All-NBA's rules by era:
  through 2022-23  2 guards, 2 forwards, 1 center per team. A player can fill a slot when his share
                   of minutes there is at least 30%: guard = PG + SG, forward = SF + PF, center = C,
                   from Basketball Reference's 5-position estimate (the card's Position estimate
                   panel, 1996-97 on). Before 1996-97, and for a player-season without an estimate,
                   Basketball Reference's listed position for the season ("PF-C" = forward and
                   center). Each team is the highest total Savant value those slots allow
                   (savant-value.js teamByEra), the 1st team first, the 2nd from everyone left.
  2023-24 on       positionless, as All-NBA has been since: the top five by value, then the next five.

This writes public/savant-allsavant.json, the eligibility the page, the player pages and the
connector read (only qualified players, only positional seasons; those seasons are finished, so
the file only changes when the archive is rebuilt):

    {"schema": 1, "cutoff": 30, "positionless_from": "2023-24",
     "seasons": {"2010-11": {"<id>": "GF|59,41,0", "<id>": "FC|L:PF-C", ...}}}

  letters  the slots he can fill (G, F, C)
  after |  his guard / forward / center shares of minutes (the estimate), or L: and the position
           Basketball Reference lists for him that season

    cd ~/Basketball-Savant && python3 <repo>/pipeline/basketball/all_savant_slots.py [--public <repo>/public]

Tested on 38 seasons against the real All-NBA (research/all-savant-positions): 60.8% of our 1st and
2nd teamers made the real 1st or 2nd team and 73.4% an All-NBA team, against 60.3% and 71.3% for the
fixed 2 guards / 2 wings / 1 big it replaces; cutoffs from 20% to 50% all land within four picks.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

CUTOFF = 30
POSITIONLESS_FROM = "2023-24"


def shares(pe):
    """[PG, SG, SF, PF, C] minute shares -> (guard, forward, center)."""
    return pe[0] + pe[1], pe[2] + pe[3], pe[4]


def from_estimate(pe, cutoff=CUTOFF):
    g, f, c = shares(pe)
    out = "".join(k for k, v in (("G", g), ("F", f), ("C", c)) if v >= cutoff)
    if not out:                                  # cannot happen at 30% (three shares sum to 100)
        out = max((("G", g), ("F", f), ("C", c)), key=lambda kv: kv[1])[0]
    return out, (round(g), round(f), round(c))


def from_listed(listed, label=None):
    toks = set(re.findall(r"PG|SG|SF|PF|G|F|C", listed or ""))
    out = ""
    if toks & {"PG", "SG", "G"}:
        out += "G"
    if toks & {"SF", "PF", "F"}:
        out += "F"
    if "C" in toks:
        out += "C"
    if not out:                                  # no listed position: the site's own label
        out = {"Guard": "G", "Big": "C"}.get(label, "F")
    return out


def build(public, log=print):
    archive = json.load(open(os.path.join(public, "savant-data.json")))["data"]
    import br_fetch
    out = {}
    for season in sorted(archive):
        if season >= POSITIONLESS_FROM:
            continue
        pf = os.path.join(public, "savant-ext", "panels", f"{season}.json")
        pe = {}
        if os.path.exists(pf):
            pe = {int(k): v["pe"] for k, v in json.load(open(pf))["players"].items() if v.get("pe") and sum(v["pe"]) > 0}
        try:
            listed = {k: (r.get("pos") or "") for k, r in br_fetch.load_season(int(season[:4]) + 1).items()}
        except Exception:  # noqa: no table, the label stands in
            listed = {}
        rows = {}
        for p in archive[season]["players"]:
            if not p.get("qualified"):
                continue
            if p["id"] in pe:
                el, sh = from_estimate(pe[p["id"]])
                rows[str(p["id"])] = f"{el}|{sh[0]},{sh[1]},{sh[2]}"
            else:
                lp = listed.get(p.get("br_id")) or ""
                rows[str(p["id"])] = f"{from_listed(lp, p.get('pos'))}|L:{lp}"
        out[season] = rows
    doc = {"schema": 1, "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "cutoff": CUTOFF, "positionless_from": POSITIONLESS_FROM, "seasons": out}
    path = os.path.join(public, "savant-allsavant.json")
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    n = sum(len(v) for v in out.values())
    dual = sum(1 for v in out.values() for c in v.values() if len(c.split("|")[0]) > 1)
    log(f"  savant-allsavant.json: {len(out)} positional seasons, {n} qualified player-seasons, {dual} eligible at two or more slots, "
        f"{os.path.getsize(path) // 1024} KB")
    return doc


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    build(os.path.abspath(ap.parse_args().public))
