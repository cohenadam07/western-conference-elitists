"""
teams_engine.py: the data behind Basketball Savant's Teams and Lineups tabs.

Teams (1996-97 on): ratings, four factors (own and allowed), shot diet by zone (own and
allowed), luck-adjusted net rating and expected wins, team play types (2015-16 on, offense and
defense), and for the season in progress the rest of the schedule (games left, back-to-backs,
road games, strength of schedule).

Lineups (2007-08 on): every team's 5-man and 2-man units with minutes, possessions, ratings,
the same luck adjustment (opponents' 3P% and FT% set to league average) and a sample-adjusted
net rating: the unit's adjusted net pulled toward its team's adjusted net by k possessions,
k measured here from split-season reliability (fit-k).

  python3 teams_engine.py fit-k               measure k for 5- and 2-man units -> out/lineup_k.json
  python3 teams_engine.py build-all [out]     every season -> <out>/savant-teams.json + <out>/lineups/<season>.json
  python3 teams_engine.py current [out]       the season in progress -> <out>/savant-teams-current.json + lineups
"""
import datetime as dt, json, os, sys, time
from collections import defaultdict

import numpy as np
import pandas as pd

import savant_config as C
import savant_engine as E
import extras_engine as X
import safe_io

ST = C.SEASON_TYPE
ZONES = [("ra", "Restricted Area"), ("paint", "In The Paint (Non-RA)"), ("mid", "Mid-Range"),
         ("c3", "Corner 3"), ("ab3", "Above the Break 3")]
PLAY_TYPES = ["Isolation", "Transition", "PRBallHandler", "PRRollman", "Postup", "Spotup",
              "Handoff", "Cut", "OffScreen", "OffRebound", "Misc"]
PYTH = 14.0                     # Pythagorean exponent for the NBA (Morey's 13.91, rounded)
LINEUP_MIN = {5: 25.0, 2: 100.0}  # minutes floor to be listed at all (keeps a season's file well under 1 MB)
# The season in progress (Adam, Oct 21 2026: everything populates from opening week). The floors
# above are season-long, so for the live season they are pro-rated by each team's games played,
# the same idea as the pro-rated player qualifier, and never go below LINEUP_MIN_LIVE. VIEW_MIN is
# what the Lineups tab and the connector show by default; the live file carries its pro-rated
# version as "view_min" (finished seasons carry none and the readers use 50 / 200).
LINEUP_MIN_LIVE = {5: 5.0, 2: 15.0}
VIEW_MIN = {5: 50.0, 2: 200.0}
LIVE = None                       # set by build_current to the season in progress


def lineup_floor(n, gp, games=82):
    share = min(1.0, max(0.0, (gp or 0) / games))
    return max(LINEUP_MIN_LIVE[n], LINEUP_MIN[n] * share)
K_PATH = os.path.join("out", "lineup_k.json")
K_DEFAULT = {"5": 1500.0, "2": 2500.0}


def season_label(y):
    return f"{y}-{str(y + 1)[2:]}"


def _teams():
    from nba_api.stats.static import teams as static_teams
    return {t["id"]: t for t in static_teams.get_teams()}


def _f(x):
    try:
        v = float(x)
        return round(v, 4) if np.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _flat(df):
    """Shot-location frames come back with two-level columns (zone, stat); the disk cache turns
    them into strings like "('Mid-Range', 'FGA')". Normalise both to 'Mid-Range|FGA'."""
    cols = []
    for c in df.columns:
        if isinstance(c, tuple):
            cols.append(f"{c[0]}|{c[1]}" if c[0] else str(c[1]))
        elif isinstance(c, str) and c.startswith("("):
            try:
                a, b = eval(c)          # noqa: S307 -- our own cache, written by pandas
                cols.append(f"{a}|{b}" if a else str(b))
            except Exception:
                cols.append(c)
        else:
            cols.append(str(c))
    df = df.copy()
    df.columns = cols
    return df


def team_tables(season):
    from nba_api.stats.endpoints import leaguedashteamstats as T
    out = {}
    for m in ("Advanced", "Four Factors", "Opponent", "Base"):
        out[m] = E.call(T.LeagueDashTeamStats, dict(season=season, season_type_all_star=ST,
                        measure_type_detailed_defense=m, per_mode_detailed="Totals")).set_index("TEAM_ID")
    return out


def shot_diet(season):
    from nba_api.stats.endpoints import leaguedashteamshotlocations as SL
    out = {}
    for m in ("Base", "Opponent"):
        try:
            df = _flat(E.call(SL.LeagueDashTeamShotLocations, dict(season=season, season_type_all_star=ST,
                       distance_range="By Zone", measure_type_simple=m, per_mode_detailed="Totals")))
            out[m] = df.set_index("TEAM_ID")
        except Exception as e:
            print(f"  shot zones {season} {m}: {repr(e)[:80]}")
    return out


def team_playtypes(season):
    from nba_api.stats.endpoints import synergyplaytypes as SP
    out = defaultdict(lambda: {"o": {}, "d": {}})
    if int(season[:4]) < 2015:
        return out
    for side, grp in (("o", "offensive"), ("d", "defensive")):
        for pt in PLAY_TYPES:
            try:
                df = E.call(SP.SynergyPlayTypes, dict(season=season, season_type_all_star=ST, player_or_team_abbreviation="T",
                            play_type_nullable=pt, type_grouping_nullable=grp, per_mode_simple="Totals"))
            except Exception:
                continue
            for _, r in df.iterrows():
                poss = _f(r.get("POSS"))
                if not poss:
                    continue
                out[int(r["TEAM_ID"])][side][pt] = [round(100 * (_f(r.get("POSS_PCT")) or 0), 1), round(_f(r.get("PPP")) or 0, 3),
                                                    round(100 * (_f(r.get("PERCENTILE")) or 0)), int(poss)]
    return out


def build_teams(season):
    tabs = team_tables(season)
    adv, ff, opp, base = tabs["Advanced"], tabs["Four Factors"], tabs["Opponent"], tabs["Base"]
    if not len(adv):
        return None
    lg3 = float(base["FG3M"].sum()) / max(1.0, float(base["FG3A"].sum()))
    lgft = float(base["FTM"].sum()) / max(1.0, float(base["FTA"].sum()))
    diet = shot_diet(season)
    pts = team_playtypes(season)
    meta = _teams()
    teams = []
    for tid, a in adv.iterrows():
        tid = int(tid)
        b, f, o = base.loc[tid], ff.loc[tid], opp.loc[tid]
        poss = _f(a["POSS"]) or 0.0
        ortg, drtg = _f(a["OFF_RATING"]), _f(a["DEF_RATING"])
        luck = 3 * ((_f(o["OPP_FG3M"]) or 0) - (_f(o["OPP_FG3A"]) or 0) * lg3) + ((_f(o["OPP_FTM"]) or 0) - (_f(o["OPP_FTA"]) or 0) * lgft)
        luck100 = 100 * luck / poss if poss else 0.0
        adj_d = drtg - luck100 if drtg is not None else None
        gp = int(a["GP"])
        pyth = lambda o_, d_: (o_ ** PYTH) / (o_ ** PYTH + d_ ** PYTH) if o_ and d_ else None
        p_w, x_w = pyth(ortg, drtg), pyth(ortg, adj_d)
        t = dict(id=tid, abbr=meta.get(tid, {}).get("abbreviation", ""), name=str(a["TEAM_NAME"]), gp=gp, w=int(a["W"]), l=int(a["L"]),
                 ortg=ortg, drtg=drtg, net=_f(a["NET_RATING"]), pace=_f(a["PACE"]), poss=round(poss),
                 adjd=round(adj_d, 2) if adj_d is not None else None,
                 adjnet=round(ortg - adj_d, 2) if ortg is not None and adj_d is not None else None,
                 luck=round(-luck100, 2),                         # + = opponents shot worse than average from 3/FT (good luck)
                 pythw=round(p_w * gp, 1) if p_w is not None else None, xw=round(x_w * gp, 1) if x_w is not None else None,
                 ts=_f(a["TS_PCT"]), astpct=_f(a["AST_PCT"]), ast_to=_f(a["AST_TO"]),
                 ff=dict(efg=_f(f["EFG_PCT"]), ftr=_f(f["FTA_RATE"]), tov=_f(f["TM_TOV_PCT"]), orb=_f(f["OREB_PCT"]),
                         oefg=_f(f["OPP_EFG_PCT"]), oftr=_f(f["OPP_FTA_RATE"]), otov=_f(f["OPP_TOV_PCT"]), oorb=_f(f["OPP_OREB_PCT"])),
                 fg3r=round((_f(b["FG3A"]) or 0) / max(1.0, _f(b["FGA"]) or 1), 3), fg3=_f(b["FG3_PCT"]), ft=_f(b["FT_PCT"]),
                 ofg3=_f(o["OPP_FG3_PCT"]), oft=_f(o["OPP_FT_PCT"]),
                 pt=pts.get(tid) or None)
        for side, key, pre in (("diet", "Base", ""), ("odiet", "Opponent", "OPP_")):
            d = diet.get(key)
            if d is None or tid not in d.index:
                continue
            row = d.loc[tid]
            tot = sum((_f(row.get(f"{z}|{pre}FGA")) or 0) for _, z in ZONES)
            if not tot:
                continue
            t[side] = {k: [round(100 * (_f(row.get(f"{z}|{pre}FGA")) or 0) / tot, 1), _f(row.get(f"{z}|{pre}FG_PCT"))] for k, z in ZONES}
        teams.append(t)
    lg = dict(ortg=float(np.average([t["ortg"] for t in teams], weights=[t["poss"] for t in teams])),
              pace=float(np.mean([t["pace"] for t in teams])), fg3=lg3, ft=lgft)
    return dict(teams=teams, lg=lg)


# ---------------------------------------------------------------- schedule (season in progress)
def schedule_block(season, teams):
    import projections as PJ
    sched = PJ.schedule(season)
    today = dt.date.today()
    meta = {t["abbr"]: t for t in teams} if teams else {}
    # team strength for SOS: this season's luck-adjusted net, pulled toward 60% of last season's by 20 games
    last = None
    try:
        last = build_teams(season_label(int(season[:4]) - 1))
    except Exception as e:
        print(f"  last season unavailable for SOS ({repr(e)[:60]})")
    prior = {t["abbr"]: 0.6 * (t["adjnet"] or 0) for t in (last or {}).get("teams", [])}
    strength = {}
    for ab in set(list(prior) + list(meta)):
        t = meta.get(ab)
        gp = t["gp"] if t else 0
        cur = (t["adjnet"] or 0) if t else 0
        strength[ab] = (gp * cur + 20 * prior.get(ab, 0)) / (gp + 20)
    by = defaultdict(list)
    for gid, d, h, a in sched:
        by[h].append((d, a, 1))
        by[a].append((d, h, 0))
    out = {}
    for ab, gs in by.items():
        gs.sort()
        left = [g for g in gs if g[0] >= today]
        dates = [g[0] for g in gs]
        b2b = [g for g in left if (g[0] - dt.timedelta(days=1)) in dates]
        # opponents on the 2nd night of a back-to-back (rest edge for us)
        opp_b2b = 0
        for d, o, h in left:
            od = [g[0] for g in by.get(o, [])]
            if (d - dt.timedelta(days=1)) in od:
                opp_b2b += 1
        sos = float(np.mean([strength.get(o, 0) for _, o, _ in left])) if left else None
        n7 = [g for g in left if g[0] < today + dt.timedelta(days=7)]
        out[ab] = dict(left=len(left), home=sum(1 for g in left if g[2]), b2b=len(b2b), oppb2b=opp_b2b,
                       sos=round(sos, 2) if sos is not None else None, next7=len(n7),
                       strength=round(strength.get(ab, 0), 2),
                       next=[[g[0].isoformat(), g[1], g[2]] for g in left[:10]])
    return out


# ---------------------------------------------------------------- lineups
def _lineup_frames(season, team_id, n, date_from=None, date_to=None):
    from nba_api.stats.endpoints import leaguedashlineups as LL
    p = dict(season=season, season_type_all_star=ST, group_quantity=n, per_mode_detailed="Totals", team_id_nullable=str(team_id))
    if date_from:
        p["date_from_nullable"] = date_from
    if date_to:
        p["date_to_nullable"] = date_to
    adv = E.call(LL.LeagueDashLineups, dict(p, measure_type_detailed_defense="Advanced"))
    if date_from or date_to:
        return adv, None
    opp = E.call(LL.LeagueDashLineups, dict(p, measure_type_detailed_defense="Opponent"))
    return adv, opp


def load_k():
    try:
        return json.load(open(K_PATH))["k"]
    except Exception:
        return dict(K_DEFAULT)


def build_lineups(season, team_info, lg3, lgft):
    k = load_k()
    out = {"5": [], "2": []}
    missing = []
    for tid, t in team_info.items():
        for n in (5, 2):
            try:
                adv, opp = _lineup_frames(season, tid, n)
            except Exception as e:
                print(f"  lineups {season} {t['abbr']} {n}: {repr(e)[:60]}", flush=True)
                missing.append(f"{t['abbr']}-{n}")
                time.sleep(20)                 # the NBA is throttling: back off before the next team
                continue
            if adv is None or not len(adv):
                continue
            o = opp.set_index("GROUP_ID") if opp is not None and len(opp) else None
            for _, r in adv.iterrows():
                mins = _f(r["MIN"]) or 0
                if mins < (lineup_floor(n, t.get("gp")) if season == LIVE else LINEUP_MIN[n]):
                    continue
                poss = _f(r["POSS"]) or 0
                if poss <= 0:
                    continue
                gid = str(r["GROUP_ID"])
                ids = [int(x) for x in gid.strip("-").split("-") if x]
                net = _f(r["NET_RATING"]) or 0.0
                adj = net
                if o is not None and gid in o.index:
                    oo = o.loc[gid]
                    luck = 3 * ((_f(oo["OPP_FG3M"]) or 0) - (_f(oo["OPP_FG3A"]) or 0) * lg3) + ((_f(oo["OPP_FTM"]) or 0) - (_f(oo["OPP_FTA"]) or 0) * lgft)
                    adj = net + 100 * luck / poss
                kk = float(k[str(n)])
                shr = (poss * adj + kk * (t.get("adjnet") or 0)) / (poss + kk)
                out[str(n)].append(dict(t=t["abbr"], ids=ids, names=str(r["GROUP_NAME"]).split(" - "), gp=int(r["GP"]), min=round(mins, 1),
                                        poss=int(poss), ortg=_f(r["OFF_RATING"]), drtg=_f(r["DEF_RATING"]), net=round(net, 1),
                                        adj=round(adj, 1), est=round(shr, 1), pace=_f(r["PACE"]), efg=_f(r["EFG_PCT"]),
                                        tov=_f(r["TM_TOV_PCT"]), orb=_f(r["OREB_PCT"]), ts=_f(r["TS_PCT"])))
    for n in out:
        out[n].sort(key=lambda x: -x["min"])
    res = dict(season=season, k=k, lg3=lg3, lgft=lgft, units=out, missing=missing)
    if season == LIVE:
        gps = sorted((t.get("gp") or 0) for t in team_info.values())
        share = min(1.0, (gps[len(gps) // 2] if gps else 0) / 82)
        res["view_min"] = {str(n): round(max(LINEUP_MIN_LIVE[n], VIEW_MIN[n] * share), 1) for n in (5, 2)}
    return res


# ---------------------------------------------------------------- k from split-season reliability
def fit_k(seasons=("2022-23", "2023-24", "2024-25")):
    meta = _teams()
    res = {}
    report = []
    for n in (5, 2):
        xa, xb, ia, ib = [], [], [], []
        for s in seasons:
            y = int(s[:4])
            split = f"01/15/{y + 1}"
            for tid in meta:
                try:
                    A, _ = _lineup_frames(s, tid, n, date_to=f"01/14/{y + 1}")
                    B, _ = _lineup_frames(s, tid, n, date_from=split)
                except Exception as e:
                    print(f"  {s} {tid} {n}: {repr(e)[:60]}")
                    continue
                if not len(A) or not len(B):
                    continue
                A, B = A.set_index("GROUP_ID"), B.set_index("GROUP_ID")
                # centre on the team's possession-weighted net in each half
                ca = np.average(A["NET_RATING"].astype(float), weights=A["POSS"].astype(float).clip(lower=0.1))
                cb = np.average(B["NET_RATING"].astype(float), weights=B["POSS"].astype(float).clip(lower=0.1))
                for g in A.index.intersection(B.index):
                    pa, pb = float(A.loc[g, "POSS"]), float(B.loc[g, "POSS"])
                    if pa < 25 or pb < 25:
                        continue
                    xa.append(float(A.loc[g, "NET_RATING"]) - ca); xb.append(float(B.loc[g, "NET_RATING"]) - cb)
                    ia.append(1 / pa); ib.append(1 / pb)
        xa, xb, ia, ib = map(np.array, (xa, xb, ia, ib))
        tau2 = float(np.mean(xa * xb))                        # covariance of the halves = true spread
        noise = float((np.mean(xa * xa) + np.mean(xb * xb) - 2 * tau2) / (np.mean(ia) + np.mean(ib)))
        k = noise / max(tau2, 1.0)
        res[str(n)] = round(k)
        report.append(f"{n}-man units: {len(xa)} with 25+ possessions in both halves of {', '.join(seasons)}; "
                      f"true spread SD {np.sqrt(max(tau2, 0)):.2f} per 100, noise {np.sqrt(noise):.0f} per 100 at one possession "
                      f"-> k = {k:.0f} possessions (half signal, half team average)")
    json.dump(dict(k=res, seasons=list(seasons), method="split-season covariance (before / after Jan 15)", report=report), open(K_PATH, "w"), indent=1)
    print("\n".join(report))
    return res


# ---------------------------------------------------------------- outputs
def season_bundle(season, with_sched=False):
    t0 = time.time()
    tb = build_teams(season)
    if not tb:
        return None, None
    if with_sched:
        try:
            sb = schedule_block(season, tb["teams"])
            for t in tb["teams"]:
                t["sched"] = sb.get(t["abbr"])
        except Exception as e:
            print(f"  schedule {season}: {repr(e)[:80]}")
    lu = None
    if int(season[:4]) >= 2007:
        lu = build_lineups(season, {t["id"]: t for t in tb["teams"]}, tb["lg"]["fg3"], tb["lg"]["ft"])
    print(f"{season}: {len(tb['teams'])} teams, "
          f"{(len(lu['units']['5']) if lu else 0)} 5-man / {(len(lu['units']['2']) if lu else 0)} 2-man units  ({time.time() - t0:.0f}s)", flush=True)
    return tb, lu


def write_lineups(out_dir, season, lu):
    if not lu:
        return
    d = os.path.join(out_dir, "lineups")
    os.makedirs(d, exist_ok=True)
    safe_io.dump_json(os.path.join(d, f"{season}.json"), lu)


def build_all(out_dir, first=1996):
    last = int(C.SEASON[:4])
    data, seasons = {}, []
    path = os.path.join(out_dir, "savant-teams.json")
    if os.path.exists(path):                                      # resume
        try:
            old = json.load(open(path))
            data, seasons = old["data"], old["seasons"]
        except Exception:
            pass
    for y in range(last, first - 1, -1):
        s = season_label(y)
        lf = os.path.join(out_dir, "lineups", f"{s}.json")
        complete = os.path.exists(lf) and not json.load(open(lf)).get("missing")
        if s in data and (complete or y < 2007):
            continue
        tb, lu = season_bundle(s)
        if not tb:
            continue
        data[s] = tb
        if s not in seasons:
            seasons.append(s)
        seasons.sort(reverse=True)
        write_lineups(out_dir, s, lu)
        safe_io.dump_json(path, dict(generated=dt.datetime.now(dt.timezone.utc).isoformat(), seasons=seasons, data=data,
                                     lineup_seasons=[x for x in seasons if int(x[:4]) >= 2007], k=load_k()))


def build_current(out_dir, season=None):
    global LIVE
    season = season or C.SEASON
    E.FRESH_SEASON = season
    LIVE = season
    tb, lu = season_bundle(season, with_sched=True)
    if not tb:
        print(f"{season}: no games yet")
        # still publish the schedule block so the Teams tab shows rest/SOS before tip-off
        try:
            last = build_teams(season_label(int(season[:4]) - 1))
            sb = schedule_block(season, [])
            tb = dict(teams=[dict(abbr=ab, sched=v, gp=0) for ab, v in sb.items()], lg={}, preseason=True)
        except Exception as e:
            print(f"  preseason schedule failed ({repr(e)[:80]})")
            return 3
    safe_io.dump_json(os.path.join(out_dir, "savant-teams-current.json"),
                      dict(generated=dt.datetime.now(dt.timezone.utc).isoformat(), seasons=[season], data={season: tb}, k=load_k()))
    write_lineups(out_dir, season, lu)
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "current"
    out = sys.argv[2] if len(sys.argv) > 2 else "out"
    if cmd == "fit-k":
        fit_k()
    elif cmd == "build-all":
        build_all(out)
    elif cmd == "current":
        sys.exit(build_current(out))
