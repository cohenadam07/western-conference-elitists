"""
context.py — play context for College Basketball Savant (Nov 2026): what the box score can't say.

From one season's working files (rebuilt/<season>/shots.pkl, poss.pkl, stints.json.gz) it writes:

  public/cbb/ctx/<season>/<team>.json   the team's play context and each player's:
      starts      possessions by how they began (after a made basket, a defensive rebound, a steal,
                  a dead-ball turnover, a made last free throw, a period start), own and allowed,
                  with points; "other" is where the feed missed how the last one ended
      transition  live-ball possessions (after a defensive rebound or a steal) whose first shot,
                  free throw or turnover comes within 8 seconds
      ato         possessions run out of a team's own timeout (not a media timeout), whose first
                  action is a shot or a turnover, not free throws
      clutch      the last five minutes (overtime included) within five points, on both ends
      clock       field-goal attempts by seconds into the possession (an estimate of the shot
                  clock, which the feed doesn't carry): 0-10, 10-20, 20+
      shots       2 ft by 2 ft bins of field-goal attempts, [col, row, attempts, makes]
      rotation    the share of games he was on the floor in each minute of regulation (40 values)
  public/cbb/ctx/<season>/league.json   D1 baselines (bin FG%, points per possession by start,
      eFG by clock bucket) and each team's D1 rank on every context number
  public/cbb/pos/<season>/<team>.json   the Data Room's possessions table, one row per possession

A season with stints but no possession log (2023-24 and 2024-25 until the Mac re-runs season.py
with the possession log) gets rotation only. Everything here is WCE-derived from ESPN play-by-play;
no raw feed and no CBBD row is written.

    python3 context.py <season> [--public PATH]
"""
import argparse
import gzip
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402

PUBLIC = os.path.join(HERE, "..", "..", "public")
REB = os.path.join(CC.HOME, "rebuilt")
KINDS = ("made", "dreb", "steal", "tov", "ft", "period", "other")
LIVE = ("dreb", "steal")
TRANSITION_SECONDS = 8.0       # rebuild.py's transition window
CLOCK_BUCKETS = (("early", 0.0, 10.0), ("mid", 10.0, 20.0), ("late", 20.0, 1e9))
BIN, XMAX, YMIN, YMAX = 2.0, 50.0, -2.0, 40.0
REG = 2400.0


def jdump(path, doc):
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf8")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    path += ".gz"
    with open(path + ".tmp", "wb") as fh:
        fh.write(gzip.compress(raw, 9, mtime=0))
    os.replace(path + ".tmp", path)
    return os.path.getsize(path)


def r1(x):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), 1)


def r3(x):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), 3)


def bucket(t):
    if t is None or not math.isfinite(t) or t < 0:
        return None
    for name, lo, hi in CLOCK_BUCKETS:
        if lo <= t < hi:
            return name
    return None


def efg_pts(made, three):
    return made * (3 if three else 2)


def load(season):
    d = os.path.join(REB, season)
    S = pd.read_pickle(os.path.join(d, "shots.pkl")) if os.path.exists(os.path.join(d, "shots.pkl")) else None
    P = pd.read_pickle(os.path.join(d, "poss.pkl")) if os.path.exists(os.path.join(d, "poss.pkl")) else None
    if S is not None and "t_in" not in S.columns:
        S = None                    # shots from before the possession log
    st = []
    p = os.path.join(d, "stints.json.gz")
    if os.path.exists(p):
        with gzip.open(p, "rt") as fh:
            st = json.load(fh)
    G = pd.read_pickle(os.path.join(d, "games.pkl")) if os.path.exists(os.path.join(d, "games.pkl")) else None
    return S, P, st, G


def rotation(stints):
    """{team: {eid: [share of games on the floor in each regulation minute]}, team: games}."""
    on = defaultdict(lambda: defaultdict(lambda: np.zeros(40)))
    games = defaultdict(int)
    for gid, home, away, rows in stints:
        games[home] += 1
        games[away] += 1
        g_on = defaultdict(lambda: defaultdict(lambda: np.zeros(40)))   # this game, capped at a full minute
        for r in rows:
            period, start, end, h5, a5 = r[0], r[1], r[2], r[3], r[4]
            if period not in (1, 2):
                continue
            t0 = (period - 1) * 1200.0 + (1200.0 - start)
            t1 = (period - 1) * 1200.0 + (1200.0 - end)
            if t1 <= t0:
                continue
            for m in range(int(t0 // 60), min(40, int(math.ceil(t1 / 60)))):
                a, b = max(t0, m * 60.0), min(t1, (m + 1) * 60.0)
                if b > a:
                    for team, five in ((home, h5), (away, a5)):
                        for e in five:
                            g_on[team][e][m] += (b - a) / 60.0
        for team, pl in g_on.items():                # overlapping stints (old lineup feeds) can't count twice
            for e, arr in pl.items():
                on[team][e] += np.minimum(arr, 1.0)
    out = {}
    for team, players in on.items():
        n = max(1, games[team])
        out[team] = {e: [round(float(v) / n, 3) for v in arr] for e, arr in players.items() if arr.sum() / n >= 0.5}
    return out, dict(games)


def bins(df):
    """[[col, row, attempts, makes], ...] over the half court, 2 ft squares."""
    d = df[df.x.notna() & df.y.notna()]
    if not len(d):
        return []
    c = np.clip(((d.x.values.astype(float)) // BIN).astype(int), 0, int(XMAX // BIN) - 1)
    yy = d.y.values.astype(float)
    keep = (yy >= YMIN) & (yy < YMAX)
    r = ((yy - YMIN) // BIN).astype(int)
    m = d.made.values.astype(int)
    agg = defaultdict(lambda: [0, 0])
    for ci, ri, mi, k in zip(c, r, m, keep):
        if k:
            a = agg[(int(ci), int(ri))]
            a[0] += 1
            a[1] += int(mi)
    return [[k[0], k[1], v[0], v[1]] for k, v in sorted(agg.items())]


def clock_split(df):
    out = {}
    for name, lo, hi in CLOCK_BUCKETS:
        d = df[(df.t_in >= lo) & (df.t_in < hi)]
        fga = int(len(d))
        pts = int(sum(efg_pts(m, t) for m, t in zip(d.made, d.three)))
        out[name] = [fga, int(d.made.sum()), pts]
    return out


def starts_table(P):
    """{kind: [possessions, points]} for these possessions."""
    out = {k: [0, 0] for k in KINDS}
    for k, n, pts in P.groupby("kind").pts.agg(["count", "sum"]).reset_index().itertuples(index=False):
        if k in out:
            out[k] = [int(n), int(pts)]
    return out


def build(season, public=PUBLIC, log=print):
    S, P, stints, G = load(season)
    rot, games = rotation(stints) if stints else ({}, {})
    teams = set(rot)
    has_pbp = S is not None and P is not None and len(P) > 0
    dates = {}
    if G is not None:
        dates = dict(zip(G.gid.astype(str), G.date.astype(str)))
    through = max(dates.values()) if dates else None
    if has_pbp:
        S = S[S.g == 0].copy()                  # garbage time out, the site's default
        S["t_in"] = pd.to_numeric(S.t_in, errors="coerce")
        P = P.copy()
        P["secs"] = (P.start - P.end).clip(lower=0)
        P["first"] = pd.to_numeric(P["first"], errors="coerce")
        P["to_first"] = (P.start - P["first"]).where(P["first"].notna())
        P["is_tr"] = P.kind.isin(LIVE) & (P.to_first <= TRANSITION_SECONDS)
        P["is_ato"] = (P.ato == 2) & P.first_kind.isin(["fga", "tov"])
        P["opp"] = P.gid.map(dict(zip(G.gid, G.home)) if G is not None else {})
        home = dict(zip(G.gid, G.home)) if G is not None else {}
        away = dict(zip(G.gid, G.away)) if G is not None else {}
        P["opp"] = [away.get(g) if t == home.get(g) else home.get(g) for g, t in zip(P.gid, P.team)]
        Pn = P[P.g == 0]
        teams |= set(Pn.team.unique())
    d1 = None
    tp = os.path.join(public, "cbb", "teams", f"{season}.json.gz")
    if os.path.exists(tp):
        d1 = {r["id"] for r in json.loads(gzip.decompress(open(tp, "rb").read()))["teams"]}
    league = {"season": season, "through": through, "pbp": has_pbp}
    team_docs = {}
    if has_pbp:
        # league baselines: D1 teams' own possessions and shots (games against non-D1 opponents count)
        Ld = Pn if d1 is None else Pn[Pn.team.isin(d1)]
        Sd = S if d1 is None else S[S.team.isin(d1)]
        lb = bins(Sd)
        league["bins"] = lb
        league["starts"] = starts_table(Ld)
        league["clock"] = clock_split(Sd)
        tr = Ld[Ld.is_tr]
        league["transition"] = [int(len(tr)), int(tr.pts.sum())]
        a = Ld[Ld.is_ato]
        league["ato"] = [int(len(a)), int(a.pts.sum())]
        league["poss"] = [int(len(Ld)), int(Ld.pts.sum())]
    for team in sorted(t for t in teams if t and (d1 is None or t in d1)):
        doc = {"season": season, "team": team, "through": through, "games": games.get(team), "pbp": has_pbp, "rotation": rot.get(team, {})}
        if has_pbp:
            own, opp_ = Pn[Pn.team == team], Pn[Pn.opp == team]
            sh_own, sh_opp = S[S.team == team], S[S.opp == team]
            tr_o = own[own.is_tr]
            tr_d = opp_[opp_.is_tr]
            live_o, live_d = own[own.kind.isin(LIVE)], opp_[opp_.kind.isin(LIVE)]
            cl_o, cl_d = P[(P.team == team) & (P.clutch == 1)], P[(P.opp == team) & (P.clutch == 1)]
            ato = own[own.is_ato]
            doc.update({
                "poss": [int(len(own)), int(own.pts.sum()), int(len(opp_)), int(opp_.pts.sum())],
                "starts": {"own": starts_table(own), "opp": starts_table(opp_)},
                "transition": {"own": [int(len(tr_o)), int(tr_o.pts.sum()), int(len(live_o))], "opp": [int(len(tr_d)), int(tr_d.pts.sum()), int(len(live_d))]},
                "ato": [int(len(ato)), int(ato.pts.sum())],
                "clutch": {"own": [int(len(cl_o)), int(cl_o.pts.sum())], "opp": [int(len(cl_d)), int(cl_d.pts.sum())], "games": int(pd.concat([cl_o.gid, cl_d.gid]).nunique())},
                "clock": {"own": clock_split(sh_own), "opp": clock_split(sh_opp)},
                "shots": {"own": bins(sh_own), "opp": bins(sh_opp)},
            })
            # players: shots, clock, clutch and after-timeout, on the team's own shots
            pl = {}
            lo = P[(P.lineup_ok == 1)]
            cl_on = defaultdict(lambda: [0, 0, 0, 0])   # clutch possessions on the floor: own poss, pts, opp poss, pts
            for r in lo[(lo.clutch == 1) & ((lo.team == team) | (lo.opp == team))].itertuples(index=False):
                mine = r.team == team
                for e in (r.five if mine else r.dfive):
                    c = cl_on[e]
                    if mine:
                        c[0] += 1
                        c[1] += int(r.pts)
                    else:
                        c[2] += 1
                        c[3] += int(r.pts)
            for eid, d in sh_own.groupby("eid"):
                if eid is None:
                    continue
                cl = d[d.clutch == 1]
                at = d[d.ato == 2]
                pl[eid] = {"fga": int(len(d)), "shots": bins(d), "clock": clock_split(d),
                           "clutch_fg": [int(len(cl)), int(cl.made.sum()), int(sum(efg_pts(m, t) for m, t in zip(cl.made, cl.three)))],
                           "ato_fg": [int(len(at)), int(at.made.sum())]}
            for e, c in cl_on.items():
                pl.setdefault(e, {})["clutch_on"] = c
            doc["players"] = pl
            # the Data Room rows
            rows = []
            for r in P[P.team == team].itertuples(index=False):
                rows.append([str(r.gid), dates.get(str(r.gid)), r.opp, int(r.period), r1(r.start), r1(r.end), r1(r.first) if r.first == r.first else None, r.kind, ["none", "media", "team"][int(r.ato)], int(r.pts), int(r.g), int(r.clutch), int(r.margin), list(r.five), list(r.dfive)])
            jdump(os.path.join(public, "cbb", "pos", season, f"{team}.json"), {"season": season, "team": team, "through": through,
                  "cols": ["gid", "date", "opp", "period", "start", "end", "first_action", "start_kind", "timeout_before", "pts", "garbage", "clutch", "margin", "five", "opp_five"], "rows": rows})
        team_docs[team] = doc
    # D1 ranks on the context numbers (teams with 5+ games), 1 = best for the team
    if has_pbp:
        def ppp(x):
            return x[1] / x[0] if x and x[0] else None
        metrics = {
            "transition_ppp": (lambda d: ppp(d["transition"]["own"]), False),
            "transition_share": (lambda d: d["transition"]["own"][0] / d["transition"]["own"][2] if d["transition"]["own"][2] else None, False),
            "transition_ppp_allowed": (lambda d: ppp(d["transition"]["opp"]), True),
            "ato_ppp": (lambda d: ppp(d["ato"]), False),
            "clutch_net": (lambda d: (100 * (ppp(d["clutch"]["own"]) or 0) - 100 * (ppp(d["clutch"]["opp"]) or 0)) if d["clutch"]["own"][0] >= 20 and d["clutch"]["opp"][0] >= 20 else None, False),
            "early_share": (lambda d: d["clock"]["own"]["early"][0] / max(1, sum(v[0] for v in d["clock"]["own"].values())), False),
            "late_efg": (lambda d: d["clock"]["own"]["late"][2] / 2 / d["clock"]["own"]["late"][0] if d["clock"]["own"]["late"][0] else None, False),
        }
        ranks = {}
        for k, (f, low) in metrics.items():
            vals = {t: f(d) for t, d in team_docs.items() if (d.get("games") or 0) >= 5 or (d.get("poss") and d["poss"][0] >= 300)}
            vals = {t: v for t, v in vals.items() if v is not None}
            order = sorted(vals.values(), reverse=not low)
            for t, v in vals.items():
                ranks.setdefault(t, {})[k] = [r3(v), 1 + sum(1 for x in order if (x < v if low else x > v)), len(order)]
        league["ranks"] = ranks
    n = 0
    for team, doc in team_docs.items():
        if has_pbp:
            doc["ranks"] = league.get("ranks", {}).get(team, {})
        n += jdump(os.path.join(public, "cbb", "ctx", season, f"{team}.json"), doc)
    n += jdump(os.path.join(public, "cbb", "ctx", season, "league.json"), league)
    log(f"context {season}: {len(team_docs)} teams, play-by-play {'yes' if has_pbp else 'rotation only'}, {n / 1e6:.1f} MB")
    return {"teams": len(team_docs), "pbp": has_pbp, "through": through}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("seasons", nargs="+")
    ap.add_argument("--public", default=PUBLIC)
    a = ap.parse_args()
    for s in a.seasons:
        build(s, a.public)
