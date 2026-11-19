"""
inject_synergy_ids.py — fill the Synergy-based parts of the card for players the Synergy feed
filed under an id the NBA's tables don't know (synergy_ids.fix), without rebuilding any season:
Shot-making (m["syn"]) and the play-type panel (p["pt"]) in savant-data.json, the defensive play
types ("dpt") and the play-type panel's extra columns ("ptx") in savant-ext/panels/<season>.json.

    cd ~/Basketball-Savant && python3 <repo>/pipeline/basketball/inject_synergy_ids.py \\
        [--public <repo>/public] [--dry] [--report <file.json>]

Runs each finished Synergy season (2015-16 on) from the engine's cache. For a season where the
remap finds someone, it recomputes Shot-making, the play-type panel and the two panels for the
whole season exactly as the builders do, twice: with the remap and without it. Every OTHER player
must come out identical in the two (the fix moves nobody else), and only the remapped players'
cells are written; everyone else's published cells are left as they are. (Comparing with the
published file instead is not a test of the fix: a rebuild of 2017-18 differs from it for 7
players by one percentile point, with or without the remap, because the NBA's own percentiles
have drifted since that season was built.) --dry writes nothing; --report saves the before / after.

It also stamps every finished season's panels file with "nis" for the players the NBA's feed
leaves out of every Synergy table (synergy_ids.not_in_synergy), so the card can say why their
play-type panels and Shot-making are blank; the nightly panels pass does the same in season.
"""
import argparse
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import savant_engine as E  # noqa: E402
import extras_engine as XE  # noqa: E402
import ext_engine as XN  # noqa: E402
import ext_files as XFL  # noqa: E402
import ext_fetch as F  # noqa: E402
import synergy_ids as S  # noqa: E402

FIRST = "2015-16"


def remapped_in(season):
    """Touch every Synergy table of the season so synergy_ids records who it remaps."""
    before = len(S.REMAPPED)
    for pt in F.SYN_DEF:
        F.synergy(pt, "defensive", season)
    for pt in F.SYN_OFF:
        F.synergy(pt, "offensive", season)
    return {nba: (syn_id, name) for s, syn_id, nba, name in S.REMAPPED[before:] if s == season}


def rebuild(season, players):
    """Shot-making (as load_synergy), the play-type panel (as the archive build, finished season)
    and the dpt / ptx panels (as ext_engine), for the whole season."""
    syn = E.load_synergy(season)
    work = copy.deepcopy(players)
    XE.apply_playtypes(season, work, live=False)
    pan = {p["id"]: {} for p in players}
    XN._panels_nba(season, pan, False)
    return syn, {p["id"]: p for p in work}, pan


def season_fix(season, archive, panels_doc):
    ids = remapped_in(season)
    if not ids:
        return None
    players = archive["data"][season]["players"]
    by_id = {p["id"]: p for p in players}
    syn, wby, pan = rebuild(season, players)
    real = S.fix
    S.fix = lambda df, season_: df                 # the same rebuild without the remap
    try:
        syn0, wby0, pan0 = rebuild(season, players)
    finally:
        S.fix = real
    moved = []
    for pid in by_id:                               # the fix may move nobody else
        if pid in ids:
            continue
        if syn.get(pid) != syn0.get(pid):
            moved.append((pid, "syn"))
        if wby[pid].get("pt") != wby0[pid].get("pt"):
            moved.append((pid, "pt"))
        for key in ("dpt", "ptx"):
            if pan[pid].get(key) != pan0[pid].get(key):
                moved.append((pid, key))
    report = []
    for pid, (syn_id, name) in ids.items():
        p = by_id.get(pid)
        if not p:
            report.append(dict(season=season, id=pid, name=name, skipped="not in the archive"))
            continue
        old_pan = panels_doc["players"].get(str(pid)) or {}
        report.append(dict(
            season=season, id=pid, name=name, synergy_id=syn_id,
            before=dict(syn=((p.get("m") or {}).get("syn") or {}).get("season"), pt=p.get("pt"),
                        dpt=old_pan.get("dpt"), ptx=old_pan.get("ptx")),
            after=dict(syn=dict(v=syn[pid][0], n=syn[pid][1]) if pid in syn else None, pt=wby[pid].get("pt"),
                       dpt=pan[pid].get("dpt"), ptx=pan[pid].get("ptx"))))
    return dict(ids=ids, moved=moved, report=report, syn=syn, work=wby, pan=pan)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--report")
    a = ap.parse_args()
    public = os.path.abspath(a.public)
    apath = os.path.join(public, "savant-data.json")
    archive = json.load(open(apath))
    reports, changed = [], False
    nis_all = {}
    for season in sorted(s for s in archive["seasons"] if s >= FIRST):
        ppath = XFL.panels_path(public, season)
        pdoc = json.load(open(ppath)) if os.path.exists(ppath) else {"players": {}}
        r = season_fix(season, archive, pdoc)
        nis = S.not_in_synergy(season, archive["data"][season]["players"])
        names = {p["id"]: p["name"] for p in archive["data"][season]["players"]}
        nis_all[season] = sorted(names.get(i, str(i)) for i in nis)
        print(f"  {season}: not in the NBA's Synergy tables (500+ min): {nis_all[season] or 'nobody'}")
        if not a.dry and os.path.exists(ppath):
            for pid, pan in list(pdoc["players"].items()):
                pan.pop(XFL.NIS, None)
                if not pan:
                    del pdoc["players"][pid]
            for pid in nis:
                pdoc["players"].setdefault(str(pid), {})[XFL.NIS] = 1
            if r is None:
                XFL.write(ppath, pdoc)
        if r is None:
            continue
        print(f"  {season}: remapped {[(v[1], k) for k, v in r['ids'].items()]}; other players moved: {len(r['moved'])}")
        if r["moved"]:
            print(f"    NOT WRITTEN: the rebuild moves other players too, e.g. {r['moved'][:5]}")
            reports += r["report"]
            continue
        reports += r["report"]
        if a.dry:
            continue
        by_id = {p["id"]: p for p in archive["data"][season]["players"]}
        for pid in r["ids"]:
            p = by_id.get(pid)
            if not p:
                continue
            if pid in r["syn"]:
                v, n = r["syn"][pid]
                wins = next((list(x["m"]["syn"]) for x in archive["data"][season]["players"] if (x.get("m") or {}).get("syn")), ["season"])
                p.setdefault("m", {})["syn"] = {w: {"v": v, "n": n} for w in wins}
            if r["work"][pid].get("pt"):
                p["pt"] = r["work"][pid]["pt"]
            pan = pdoc["players"].setdefault(str(pid), {})
            for key in ("dpt", "ptx"):
                if r["pan"][pid].get(key):
                    pan[key] = r["pan"][pid][key]
        XFL.write(ppath, pdoc)
        changed = True
    if changed:
        import safe_io
        safe_io.write_text(apath, json.dumps(archive, separators=(",", ":")))
    if a.report:
        json.dump(dict(remapped=reports, not_in_synergy=nis_all), open(a.report, "w"), indent=1)
    print(f"  {'dry run, nothing written' if a.dry else 'written' if changed else 'nothing to write'}; {len(reports)} player-seasons")


if __name__ == "__main__":
    main()
