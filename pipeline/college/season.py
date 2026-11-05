"""
season.py — every game of a season through rebuild.py, into the tables everything else reads.

    python3 season.py 2025-26 2024-25 ...

Writes to <COLLEGE_HOME>/rebuilt/<season>/: games, pg (player-game), tg (team-game), shots (pickles)
and stints.json.gz (lineups and RAPM), plus gates.json with every check of §10 steps 3 and 4.

Game-level gates, the spec's rule (§5): a game that fails is excluded from what it can't support
and kept for the rest. Box lines always count.

  pbp_ok      the play-by-play agrees with the record: it adds up to the final score, and at least
              85% of the box's players have the same shooting line (the line that takes 2023-24 on
              over the 99% gate at a cost of about 2% of games; 2022-23 would need 95% and a third
              of its games, so that season fails the gate and keeps its card stats, §3). Before 2025-26 ESPN's two
              records of a low-major game are sometimes written up separately: in about 5% of
              2022-23 games each adds to the final and they disagree man by man, and no parser can
              reconcile that. Fails -> out of everything built from the play-by-play.
  lineup_ok   pbp_ok, has lineups, 90%+ of plays with five firm men on each D1 side, and at most 2
              players more than a minute off the box. Fails -> out of on/off, lineups and RAPM.

The .pkl files are this pipeline's own intermediate tables, written and read on this machine or
in the same cloud run. Nothing downloaded is ever unpickled.
"""
import concurrent.futures as cf
import gzip
import json
import os
import sys
import time
from collections import Counter

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import cbbd_client as CC  # noqa: E402
import espn_cbb as E  # noqa: E402
import join as J  # noqa: E402
import normalize as N  # noqa: E402
import rebuild as R  # noqa: E402

OUT = os.path.join(CC.HOME, "rebuilt")
POSS_COLS = ["gid", "lineup_ok", "team", "period", "start", "end", "kind", "ato", "pts", "g", "clutch", "margin", "five", "dfive", "first", "first_kind"]
BOX = ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "tov", "stl", "blk", "pf")


def flags(gate, final_pbp):
    ok_score = gate["score_ok"] or final_pbp
    ok_box = gate["box_players"] > 0 and gate["box_match"] >= 0.85 * gate["box_players"]
    pbp_ok = bool(ok_score and ok_box and gate["plays"] >= 150)
    firm = gate.get("clean")
    five_ok = all(v >= 0.9 for v in gate["five"].values()) if gate["five"] else False
    lineup_ok = bool(pbp_ok and gate["lineups"] != "none" and five_ok and (firm is None or firm >= 0.9) and gate["minutes_off"] <= 2)
    return pbp_ok, lineup_ok


def _one(a):
    season, ev = a
    g = N.load_game(season, ev)
    joined = J.apply(g)
    r = R.rebuild_game(g)
    gate = r["gate"]
    final_pbp = bool(r["team"]) and all(t["pbp"]["pts"] == t["pts"] for t in r["team"])
    pbp_ok, lineup_ok = flags(gate, final_pbp) if r["team"] else (False, False)
    # The box tier's gate: the player lines add up to the final, both teams, after recovery.
    def adds_up(players):
        return bool(g["players"]) and all(sum(p["pts"] for p in players if p["team"] == t and not p["dnp"]) == g["teams"][t]["score"] for t in (g["home"], g["away"]) if t not in g["non_d1"])
    box_ok = adds_up(g["players"])
    box_raw = adds_up([p for p in g["players"] if not p.get("filled")])
    home, away = g["home"], g["away"]
    m = g["meta"]
    game = dict(gid=g["gid"], date=g["date"], home=home, away=away, hs=g["teams"][home]["score"] if home else 0, as_=g["teams"][away]["score"] if away else 0,
                neutral=m["neutral"], confgame=m["confgame"], stype=m["stype"], note=m["note"], venue=m["venue"], venue_name=m["venue_name"],
                spread=(g["line"] or {}).get("spread"), total=(g["line"] or {}).get("total"), non_d1=len(g["non_d1"]), nd=",".join(g["non_d1"]),
                plays=gate["plays"], pbp_ok=pbp_ok, lineup_ok=lineup_ok, lineups=gate.get("lineups", "none"), ot=gate.get("ot", 0),
                loc=gate.get("loc", 0), fga=gate.get("fga", 0), score_ok=bool(gate.get("score_ok") or final_pbp),
                firm=gate.get("clean"), five=min(gate["five"].values()) if gate.get("five") else None, minutes_off=gate.get("minutes_off", 0),
                box_ok=box_ok, box_raw=box_raw, filled=g.get("filled", 0), box_match=gate.get("box_match", 0), box_players=gate.get("box_players", 0), players=gate.get("players", 0),
                fixes=gate.get("fixes", 0), joined_locs=(joined or {}).get("locs", 0))
    names = {p["eid"]: p["name"] for p in g["players"]}
    pos = {p["eid"]: p["pos"] for p in g["players"]}
    tinfo = {k: {x: v.get(x) for x in ("abbr", "name", "loc", "color", "alt", "conf")} for k, v in g["teams"].items()}
    pg = []
    for x in r["rows"]:
        d = dict(gid=g["gid"], eid=x["eid"], team=x["team"], sec=x["sec"], min=x["min"], starter=x["starter"], pos_o=x["poss"][0], pos_d=x["poss"][1], pos_og=x["poss"][2], pos_dg=x["poss"][3])
        for k, v in x["box"].items():
            d["b_" + k] = v
        for pre, src in (("c_", x["c"]), ("g_", x["cg"]), ("t_", x["t"]), ("o_", x["o"]), ("tg_", x["tg"]), ("og_", x["og"])):
            if src:
                for k, v in src.items():
                    d[pre + k] = v
        pg.append(d)
    tg = []
    for t in r["team"]:
        d = dict(gid=g["gid"], team=t["team"], opp=t["opp"], home=t["home"], pts=t["pts"], opp_pts=t["opp_pts"], poss=t["poss"], opp_poss=t["opp_poss"], poss_g=t["poss_g"], ot=t["ot"])
        for k, v in t["box"].items():
            d["b_" + k] = v
        for k, v in t["pbp"].items():
            d["p_" + k] = v
        for k, v in t["pbp_g"].items():
            d["pg_" + k] = v
        tg.append(d)
    shots = [dict(s, gid=g["gid"]) for s in r["shots"]]
    plog = [[g["gid"], int(lineup_ok)] + row for row in r.get("poss", [])] if pbp_ok else []
    return game, pg, tg, shots, [g["gid"], home, away, r["stints"]] if lineup_ok else None, names, pos, tinfo, plog


def run(season, log=print, workers=8):
    t0 = time.time()
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    fin = [e for e in E.finals(seen) if os.path.exists(E.raw_path(season, e["id"]))]
    games, pg, tg, shots, stints, plog = [], [], [], [], [], []
    names, poss, teams = {}, {}, {}
    with cf.ProcessPoolExecutor(workers) as ex:
        for g, p, t, s, st, nm, ps, ti, pl in ex.map(_one, [(season, e) for e in fin], chunksize=40):
            games.append(g)
            plog.extend(pl)
            pg.extend(p)
            tg.extend(t)
            shots.extend(s)
            if st:
                stints.append(st)
            names.update(nm)
            for k, v in ps.items():
                if v:
                    poss[k] = v
            teams.update(ti)
    d = os.path.join(OUT, season)
    os.makedirs(d, exist_ok=True)
    G = pd.DataFrame(games).fillna({"spread": float("nan")})
    G.to_pickle(os.path.join(d, "games.pkl"))
    PG = pd.DataFrame(pg)
    PG.to_pickle(os.path.join(d, "pg.pkl"))
    TG = pd.DataFrame(tg)
    TG.to_pickle(os.path.join(d, "tg.pkl"))
    S = pd.DataFrame(shots)
    S.to_pickle(os.path.join(d, "shots.pkl"))
    # the possession log, games that pass the play-by-play gate (fives only where lineups pass too)
    pd.DataFrame(plog, columns=POSS_COLS).to_pickle(os.path.join(d, "poss.pkl"))
    with gzip.open(os.path.join(d, "stints.json.gz"), "wt") as fh:
        json.dump(stints, fh, separators=(",", ":"))
    json.dump({"names": names, "pos": poss, "teams": teams}, open(os.path.join(d, "ids.json"), "w"))
    g_ = gates(season, G, PG, TG)
    json.dump(g_, open(os.path.join(d, "gates.json"), "w"), indent=1)
    log(f"{season}: {len(G)} games, {len(PG)} player-games, {len(S)} shots, {len(stints)} lineup games ({time.time() - t0:.0f}s)")
    return g_


def gates(season, G, PG, TG):
    d1 = G[G.non_d1 == 0]
    with_pbp = d1[d1.plays > 0]
    ok = d1[d1.pbp_ok]
    L = d1[d1.lineups != "none"]
    lo = d1[d1.lineup_ok]
    if "c_fga" not in PG:            # a season with no play-by-play at all (2004-05 and earlier)
        for k in ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"):
            PG["c_" + k] = PG["g_" + k] = float("nan")
    in_ok = PG[PG.gid.isin(set(ok.gid)) & PG.c_fga.notna()]
    same = pd.Series(True, index=in_ok.index)
    for k in ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"):
        same &= (in_ok["c_" + k] + in_ok["g_" + k]) == in_ok["b_" + k]
    allp = PG[PG.gid.isin(set(with_pbp.gid)) & PG.c_fga.notna()]
    sam2 = pd.Series(True, index=allp.index)
    for k in ("pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"):
        sam2 &= (allp["c_" + k] + allp["g_" + k]) == allp["b_" + k]
    pl = PG[PG.gid.isin(set(lo.gid))]
    played = pl[(pl["min"] > 0) | (pl.sec > 0)]
    within = (abs(played.sec / 60 - played["min"]) <= 1).mean() if len(played) else None
    tm = PG[PG.gid.isin(set(lo.gid))].groupby(["gid", "team"]).agg(sec=("sec", "sum"), m=("min", "sum")).reset_index().merge(G[["gid", "ot"]], on="gid")
    tm["want"] = 200 + 25 * tm.ot
    tg_ok = TG[TG.gid.isin(set(ok.gid))]
    ts = tg_ok.groupby("team").agg(p=("poss", "sum"), fga=("b_fga", "sum"), o=("b_oreb", "sum"), t=("b_tov", "sum"), f=("b_fta", "sum"), n=("gid", "count"))
    ts = ts[ts.n >= 10]
    dev = ts.p / (ts.fga - ts.o + ts.t + 0.475 * ts.f) - 1
    return dict(season=season, d1_games=len(d1), box_gate_raw=round(float(d1.box_raw.mean()), 4), box_gate=round(float(d1.box_ok.mean()), 4), filled_lines=int(d1.filled.sum()), pbp_games=len(with_pbp), pbp_rate=round(len(with_pbp) / max(1, len(d1)), 4),
                score_rate=round(float(with_pbp.score_ok.mean()), 4) if len(with_pbp) else None,
                pbp_ok_games=len(ok), pbp_ok_rate=round(len(ok) / max(1, len(with_pbp)), 4),
                coord_rate=round(float(ok["loc"].sum() / max(1, ok.fga.sum())), 4),
                box_rate_raw=round(float(sam2.mean()), 4) if len(sam2) else None, box_rate=round(float(same.mean()), 4) if len(same) else None,
                lineup_games=len(L), lineup_ok_games=len(lo), lineup_ok_rate_of_d1=round(len(lo) / max(1, len(d1)), 4),
                five_rate=round(float((L.five == 1).mean()), 4) if len(L) else None,
                firm_rate=round(float(L.firm.mean()), 4) if len(L) and L.firm.notna().any() else None,
                minutes_within_1=None if within is None else round(float(within), 4),
                team_minutes_ok=round(float((abs(tm.sec / 60 - tm.want) <= 1).mean()), 4) if len(tm) else None,
                team_box_minutes_ok=round(float((abs(tm.m - tm.want) <= 5).mean()), 4) if len(tm) else None,
                poss_team_seasons_within_2pct=round(float((abs(dev) <= 0.02).mean()), 4), poss_bias=round(float(dev.mean()), 4),
                sources=dict(Counter(d1.lineups)), line_games=int(G.spread.notna().sum()))


if __name__ == "__main__":
    for s in sys.argv[1:]:
        g = run(s, log=lambda m: print(time.strftime("%H:%M:%S"), m, flush=True))
        print(json.dumps(g))
