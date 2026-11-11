"""Step 11. The site files under public/cfb/, split by season and team and loaded on demand.

    python -m pipeline.cfb.site history         # 2014-2025 and the static files (the Mac; needs history)
    python -m pipeline.cfb.site season 2026     # one season's files (what a refresh writes)
    python -m pipeline.cfb.site sizes           # file counts and sizes

    registry.json            every stat's label, group, unit, settle point, start season, explainer
    index.json               seasons, how far each goes, which is current
    search.json              players through last season and every team (this season's names are in s/)
    honours.json             finished seasons' All-Savant accolades by player
    s/<season>.json          every graded player: values in four variants, samples, Savant value
    teams/<season>.json      the all-teams table
    t/<season>/<team>.json   roster, schedule with pregame win probability, game logs
    p/<00-99>.json           careers through last season and the bio, by the last two digits of the id
    allsavant/<season>.json  the sets, the Savant Heisman, the non-QB Player of the Year
    playoff/<season>.json    the objective field; for the season being played, leaders and odds
    games/<season>.json      every game with a team line each side

Files are gzip level 9 with mtime 0 and no wall-clock time inside, so the same inputs give the
same bytes (the refresh test depends on it). Vercel serves `x.json` from `x.json.gz`.

Never written: a CFBD row, an AP pick, FPI, PPA, a committee ranking. Recruiting appears only as
stars and class rank (BUILD decision 6); team talent is ours, computed from those (identity.py).
"""
import os
import sys
import gzip
import json
import math
import numpy as np
from pathlib import Path
import pandas as pd
from scipy.stats import norm
from .paths import WORK, REPO
from . import config as C
from . import numbers as N
from . import playoff as PO
from . import teamgame
from .player_study import opp_effects
from .resume import FCS_RATING
from .rating import fw_of

PUB = Path(os.environ["CFB_PUB"]) if os.environ.get("CFB_PUB") else REPO / "public" / "cfb"    # refresh_check writes elsewhere
SLOT_ORDER = {s: i for i, s in enumerate(C.SLOTS)}
LOGCOLS = {
    "qb": ["db", "att", "cmp", "yards", "td", "ints", "sacks", "epa", "succ", "q_rush", "q_rush_yds", "q_rush_td", "q_rush_epa"],
    "rush": ["rush", "yards", "td", "epa", "succ", "expl", "stuff", "r_tgt", "r_rec", "r_yards", "r_td", "r_epa"],
    "rec": ["tgt_eff", "rec", "yards", "td", "epa_eff", "expl", "t_att", "t_db"],
    "dfn": ["e_tkl", "e_sack", "e_tfl_all", "int", "e_pd", "ff", "e_hur", "stop", "dplays"],
    "kick": ["fga", "made", "fgoe", "long"],
    "punt": ["punts", "gross", "poe"],
}
PCOLS = ["id", "name", "team", "slot", "cls", "jersey", "gp", "qual", "ht", "wt", "fr", "inferred", "head", "pos"]
TCOLS = ["id", "school", "abbr", "conf", "w", "l", "cw", "cl", "rating", "off", "def", "st", "resume", "resume_rank", "sos", "talent",
         "talent_rank", "ret_off", "ret_def", "coach", "games", "rating_rank"]
# team stat -> (numerator, denominator, side); side "d" reads the opponent's row
TEAM_FORM = {
    "off_epa": ("epa", "epa_n", "o"), "def_epa": ("epa", "epa_n", "d"), "off_sr": ("succ", "plays", "o"), "def_sr": ("succ", "plays", "d"),
    "off_epa_db": ("epa_pass", "db", "o"), "def_epa_db": ("epa_pass", "db", "d"), "off_epa_rush": ("epa_rush", "rush", "o"),
    "def_epa_rush": ("epa_rush", "rush", "d"), "off_pass_sr": ("succ_pass", "db", "o"), "def_pass_sr": ("succ_pass", "db", "d"),
    "off_rush_sr": ("succ_rush", "rush", "o"), "def_rush_sr": ("succ_rush", "rush", "d"), "off_expl_rate": ("expl", "plays", "o"),
    "def_expl_rate": ("expl", "plays", "d"), "off_expl": ("epa_succ", "succ", "o"), "def_expl": ("epa_succ", "succ", "d"),
    "off_stuff": ("stuff", "rush", "o"), "def_stuff": ("stuff", "rush", "d"), "off_ly": ("ly", "rush", "o"), "def_ly": ("ly", "rush", "d"),
    "off_sack": ("sacks", "db", "o"), "def_sack": ("sacks", "db", "d"), "off_havoc": ("havoc", "plays", "o"), "def_havoc": ("havoc", "plays", "d"),
    "off_third": ("third_conv", "third", "o"), "def_third": ("third_conv", "third", "d"), "off_ppo": ("opp_pts", "opps", "o"),
    "def_ppo": ("opp_pts", "opps", "d"), "off_rz": ("rz_td", "rz", "o"), "def_rz": ("rz_td", "rz", "d"), "off_fp": ("start", "drives", "o"),
    "def_fp": ("start", "drives", "d"), "st_epa": ("st_epa", "g", "o"), "pen_rate": ("pen_n", "plays", "o"), "pen_yds": ("pen_yds", "g", "o"),
    "pace": ("plays", "g", "o"), "giveaways": ("to_box", "plays", "o"), "takeaways": ("to_box", "plays", "d"),
    "int_thrown": ("int_box", "db", "o"), "int_made": ("int_box", "db", "d"), "fum_lost": ("fl_box", "plays", "o"),
}


from . import config_x as CX                                   # noqa: E402
TEAM_FORM.update({k: (num, den, side) for (k, _l, _g, _t, _u, _lo, _w, num, den, side) in CX.TEAM_X})
CENTRED = {"proe"}             # shown against the season's FBS average (a league-wide drift is nobody's)
POS_ALLOW = {"def_qb": ("qb", "QB", "epa", "db", "epa_pass", "db"), "def_rb": ("rush", "RB", "epa", "rush", "epa_rush", "rush"),
             "def_wr": ("rec", "WR", "epa_eff", "tgt_eff", "epa_pass", "db"), "def_te": ("rec", "TE", "epa_eff", "tgt_eff", "epa_pass", "db")}


def rnd(x, d=4):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    f = round(f, d)
    return int(f) if f == int(f) else f


def lst(a, d=4):
    return [rnd(v, d) for v in a]


def jdump(path, doc):
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf8")     # a NaN is not JSON: fail here, not in the browser
    path = str(path) + ".gz"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "wb") as fh:
        fh.write(gzip.compress(raw, 9, mtime=0))
    os.replace(path + ".tmp", path)
    return os.path.getsize(path)


def jload(path):
    p = str(path) + ".gz"
    if not os.path.exists(p):
        return None
    with gzip.open(p, "rt", encoding="utf8") as fh:
        return json.load(fh)


def heads():
    from .heads import load
    return load()[0]


def trim(arr, d):
    """An array aligned to the player list -> {o: first index with a value, v: the values to the last one}."""
    ok = np.where(~np.isnan(arr))[0]
    if not len(ok):
        return None
    a, b = int(ok[0]), int(ok[-1]) + 1
    return a, lst(arr[a:b], d)


# ---------------------------------------------------------------- one season's context
class Ctx:
    """Everything a season's files are written from."""

    def __init__(self, y, state, extra, weekly=None, preds=None):
        self.y, self.state, self.extra = y, state, extra
        self.cur = y == C.CURRENT
        D = N.build(y, state)
        pl = D["players"]
        pl["team"] = D["team"]
        pl["gp"], pl["qual"] = D["gp"], D["qual"]
        order = np.lexsort((pl.pid.to_numpy(), pl.slot.map(SLOT_ORDER).to_numpy()))
        self.order = order
        self.D, self.pl = D, pl.iloc[order].reset_index(drop=True)
        self.A = N.all_savant(D)
        g = pd.read_parquet(WORK / "games.parquet")
        self.g_all = g[g.season == y]
        g = g[(g.season == y) & (g.home_fbs | g.away_fbs)].sort_values(["date", "game_id"]).reset_index(drop=True)
        self.g = g
        self.fbs = D["fbs"]
        from .rating import weekly_for, preds_for
        w = pd.read_parquet(weekly_for(y)) if weekly is None else weekly
        self.weekly = w[w.season == y]
        w = w[(w.season == y) & (w.fw == 99999)].set_index("team")
        self.rt = w
        p = pd.read_parquet(preds_for(y)) if preds is None else preds
        self.preds = p[p.season == y].set_index("game_id") if len(p) else p
        self.hfa, self.sigma = float(w.hfa.iloc[0]), float(w.sigma.iloc[0])
        fin = g[g.final]
        self.through = None if not len(fin) else str(fin.date.max().tz_convert("America/New_York").date())
        self.week = int(fin[fin.season_type == 2].week.max()) if len(fin[fin.season_type == 2]) else 0
        self.rank = w.rating.rank(ascending=False, method="min").astype(int)
        self.final = (not self.cur) or bool(len(g) and g.final.all())
        self.meta = state["team_meta"]
        self.heads = heads()

    def wp_home(self, r):
        """Pregame chance the home team wins, from our ratings before the game (as of today for one not played)."""
        R, site = self.rt.rating, 0 if r.neutral_site else 1
        if r.game_id in self.preds.index:
            return float(norm.cdf(self.preds.pred[r.game_id] / self.sigma))
        rh = R.get(r.home, FCS_RATING) if r.home_fbs else FCS_RATING
        ra = R.get(r.away, FCS_RATING) if r.away_fbs else FCS_RATING
        if pd.isna(rh) or pd.isna(ra):
            return None
        return float(norm.cdf((rh - ra + self.hfa * site) / self.sigma))


# ---------------------------------------------------------------- s/<season>.json
def season_doc(X):
    D, pl, order = X.D, X.pl, X.order
    v = D["value"].set_index("pid").reindex(pl.pid)
    doc = {"season": X.y, "through": X.through, "final": X.final, "week": X.week, "scale": rnd(D["scale"], 4), "cols": PCOLS,
           "players": [[int(r.pid), r.name if isinstance(r.name, str) else f"Player {int(r.pid)}", int(r.team), r.slot,
                        r.cls_y if isinstance(r.cls_y, str) else None, r.jersey if isinstance(r.jersey, str) else None, int(r.gp),
                        int(bool(r.qual)), rnd(r.height, 0), rnd(r.weight, 0), int(bool(r.fr)) if not pd.isna(r.fr) else 0,
                        int(bool(r.inferred)) if not pd.isna(r.inferred) else 0, int(int(r.pid) in X.heads),
                        r.pos if isinstance(r.pos, str) and r.pos not in ("-", "") else None] for r in pl.itertuples()],
           "values": {}, "samples": {}}
    for k, var in D["values"].items():
        o = {}
        st = C.by_key()[k]
        dp = N.UNIT_DP.get(st.unit, 4)
        for tag, arr in var.items():
            t = trim(arr[order], dp)
            if t:
                o[tag] = t[1]
                o["o" + tag] = t[0]
        if o:
            doc["values"][k] = o
    for k, arr in D["samples"].items():
        t = trim(arr[order], 2)
        if t:
            doc["samples"][k] = {"o": t[0], "v": t[1]}
    doc["value"] = {"v": lst(v.value, 2), "rate": lst(v.srate, 5), "n": lst(v.n, 1), "ret": lst(v.ret_value, 2),
                    "repl": {s: rnd(g.repl.iloc[0], 5) for s, g in D["value"].groupby("slot") if g.repl.notna().any()},
                    "mean": {s: rnd(g.mu.iloc[0], 5) for s, g in D["value"].groupby("slot") if g.mu.notna().any()}}
    doc["teams"] = {str(int(t)): [r.school, r.abbreviation, r.conference, (X.meta.get(str(int(t))) or {}).get("color"),
                                  (X.meta.get(str(int(t))) or {}).get("alt"), (X.meta.get(str(int(t))) or {}).get("nick")]
                    for t, r in X.fbs.iterrows()}
    doc["weights"] = {k: rnd(x, 3) for k, x in D["weights"].items()}
    return doc


# ---------------------------------------------------------------- teams/<season>.json
def allowed_by_position(D, tg):
    """What each defence allowed to QBs, RBs, WRs and TEs, raw and opponent-adjusted (BUILD-1.1 section 4): the
    position's production against it, then a ridge on offence and defence (as every 1.0.0 team adjustment) so the
    offences it happened to face are taken out. Returns ({key: {"r": Series, "a": Series}}, reconciliation)."""
    from .team_study import ridge_adjust
    F = D["frames"][""]
    slot = dict(zip(D["players"].pid, D["players"].slot))
    site_ = tg.drop_duplicates(["game_id", "team"]).set_index(["game_id", "team"]).site
    out, rec = {}, {}
    for key, (tab, sl, num, den, _, _) in POS_ALLOW.items():
        d = F[tab]
        d = d[d.pid.map(slot) == sl]
        g = d.groupby(["game_id", "team", "opp"])[[num, den]].sum().reset_index()
        g = g[g[den] > 0]
        g["site"] = [site_.get((a, b), 0) for a, b in zip(g.game_id, g.team)]
        g["yv"] = g[num] / g[den]
        raw = g.groupby("opp")[[num, den]].sum()
        o, dfn, h, mu = ridge_adjust(g, "yv", den, 1.0 * g[den].mean())
        out[key] = {"r": raw[num] / raw[den], "a": pd.Series({t: mu + v for t, v in dfn.items()})}
        rec[key] = (float(raw[num].sum()), float(d[num].sum()), float(raw[den].sum()), float(d[den].sum()))
    return out, rec


def team_values(y, D=None):
    out = {}
    for tag, filt in (("", "cfbd"),):
        tg = teamgame.load(filt, [y])
        tg["g"] = 1.0
        tg["d_g"] = 1.0
        for pre in ("", "d_"):
            if pre + "fd4_go" in tg.columns:
                tg[pre + "fd4_goe_n"] = tg[pre + "fd4_go"] - tg[pre + "fd4_xgo"]
        for c in set(v[0] for v in TEAM_FORM.values()) | set(v[1] for v in TEAM_FORM.values()):
            for pre in ("", "d_"):
                if pre + c not in tg.columns:
                    tg[pre + c] = np.nan
        teams = sorted(tg.team.unique())
        a = tg.groupby("team").sum(numeric_only=True)
        for key, (num, den, side) in TEAM_FORM.items():
            pre = "" if side == "o" else "d_"
            raw = (a[pre + num] / a[pre + den].where(a[pre + den] > 0)).reindex(teams)
            o = {"r": raw}
            if key in C.TEAM_ADJ:
                off, dfn, mu = opp_effects(tg, num, den).get(y, ({}, {}, np.nan))
                eff = off if side == "o" else dfn
                o["a"] = pd.Series({t: mu + eff.get(t, 0.0) for t in teams})
            if key in CENTRED:
                lg = a[pre + num].sum() / a[pre + den].sum() if a[pre + den].sum() > 0 else 0.0
                o = {"r": raw - lg}
            out[key] = o
        if D is not None:
            pos, _ = allowed_by_position(D, tg)
            for key, v in pos.items():
                out[key] = {"r": v["r"].reindex(teams), "a": v["a"].reindex(teams)}
        g = a.g
        out["to_margin"] = {"r": ((a.d_to_box - a.to_box) / g).reindex(teams)}
        fum = a.fum_all + a.d_fum_all
        out["fum_rec"] = {"r": (((a.fum_all - a.fl_box) + a.d_fl_box) / fum.where(fum > 0)).reindex(teams)}
    return teams, out, a.g.reindex(teams)


def records(g, fbs):
    f = g[g.final]
    rows = {int(t): dict(w=0, l=0, cw=0, cl=0) for t in fbs.index}
    for r in f.itertuples():
        for me, won in ((r.home, r.home_margin > 0), (r.away, r.home_margin < 0)):
            if me in rows:
                rows[me]["w" if won else "l"] += 1
                if r.conference_game and r.fbs_game:
                    rows[me]["cw" if won else "cl"] += 1
    return rows


def teams_doc(X, res):
    teams, vals, games = team_values(X.y, X.D)
    rec = records(X.g, X.fbs)
    rs = res.set_index("team")
    ex = X.extra
    tal = ex.get("talent", {}).get(str(X.y), {})
    ret = ex.get("returning", {}).get(str(X.y), {})
    co = ex.get("coaches", {}).get(str(X.y), {})
    ids = [int(t) for t in X.fbs.index]
    rows = []
    for t in ids:
        f, r, w = X.fbs.loc[t], rec[t], X.rt
        tl, rt_ = tal.get(str(t)), ret.get(str(t))
        rows.append([t, f.school, f.abbreviation, f.conference, r["w"], r["l"], r["cw"], r["cl"], rnd(w.rating.get(t), 2), rnd(w.off.get(t), 2),
                     rnd(w["def"].get(t), 2), rnd(w.st.get(t), 2), rnd(rs.resume.get(t), 5), None if t not in rs.index else int(rs["rank"][t]),
                     rnd(rs.sos.get(t), 4), None if not tl else rnd(tl[0], 1), None if not tl else tl[1], None if not rt_ else rnd(rt_[0], 3),
                     None if not rt_ else rnd(rt_[1], 3), co.get(str(t)), int(games.get(t, 0) or 0), None if t not in X.rank.index else int(X.rank[t])])
    doc = {"season": X.y, "through": X.through, "final": X.final, "week": X.week, "cols": TCOLS, "teams": rows, "values": {}}
    scale = {k: N.UNIT_SCALE.get(u, 1.0) for k, _, _, _, u, _, _ in C.TEAM_STATS}
    dps = {k: N.UNIT_DP.get(u, 4) for k, _, _, _, u, _, _ in C.TEAM_STATS}
    for k, o in vals.items():
        doc["values"][k] = {tag: lst(s.reindex(ids).to_numpy(dtype=float) * scale[k], dps[k]) for tag, s in o.items()}
    return doc


# ---------------------------------------------------------------- t/<season>/<team>.json
def team_docs(X, alls):
    D, pl = X.D, X.pl
    F = D["frames"]["_all"]
    slot = dict(zip(pl.pid, pl.slot))
    val = D["value"].set_index("pid").value
    ppl = D["people"]
    ppl = ppl[ppl.fbs.fillna(False).astype(bool)] if "fbs" in ppl.columns else ppl
    pos = D["positions"].set_index("pid")
    g = X.g
    ol = alls["ol_units"].set_index("team") if len(alls["ol_units"]) else None
    olrank = None if ol is None else ol.value.rank(ascending=False, method="min")
    usage = {}
    for sl, (key, _) in C.QUAL.items():
        s = D["samples"].get(key + "_g")
        if s is None:
            continue
        for i, p in enumerate(D["players"].pid):
            if D["players"].slot.iloc[i] == sl and not np.isnan(s[i]):
                usage[int(p)] = float(s[i])
    names = {}
    for r in g.itertuples():
        names[int(r.home)], names[int(r.away)] = r.home_team, r.away_team
    out = {}
    for t in [int(x) for x in X.fbs.index]:
        gg = g[(g.home == t) | (g.away == t)]
        sched, gi = [], {}
        for r in gg.itertuples():
            home = r.home == t
            opp = int(r.away if home else r.home)
            wp = X.wp_home(r)
            wp = None if wp is None else (wp if home else 1 - wp)
            pf, pa = (r.home_pts, r.away_pts) if home else (r.away_pts, r.home_pts)
            gi[r.game_id] = len(sched)
            sched.append([int(r.game_id), str(r.date.tz_convert("America/New_York").date()), int(r.week), int(r.season_type), opp,
                          0 if r.neutral_site else (1 if home else -1), int(bool(r.conference_game)), int(bool(r.final)),
                          rnd(pf, 0) if r.final else None, rnd(pa, 0) if r.final else None, rnd(wp, 3),
                          None if opp not in X.rank.index else int(X.rank[opp]), None if opp in X.fbs.index else names.get(opp)])
        ros = ppl[ppl.team == t].drop_duplicates("pid")
        roster = []
        for r in ros.sort_values(["name", "pid"]).itertuples():
            p = int(r.pid)
            sl = slot.get(p) or (pos.slot.get(p) if p in pos.index else None)
            roster.append([p, r.name if isinstance(r.name, str) else None, r.pos if isinstance(r.pos, str) else None,
                           sl if isinstance(sl, str) else None, r.jersey if isinstance(r.jersey, str) else None,
                           r.cls_y if isinstance(r.cls_y, str) else None, rnd(r.height, 0), rnd(r.weight, 0), int(p in X.heads),
                           r.birth_place_city if isinstance(getattr(r, "birth_place_city", None), str) else None,
                           r.birth_place_state if isinstance(getattr(r, "birth_place_state", None), str) else None,
                           rnd(usage.get(p), 1), rnd(val.get(p), 2)])
        logs = {}
        for tab, cols in LOGCOLS.items():
            d = F[tab]
            d = d[(d.team == t) & d.pid.isin(set(pl.pid))]
            d = d[d.pid.map(slot).map(N.SLOT_TABLE) == tab]
            for p, x in d.groupby("pid"):
                rows = []
                for r in x.sort_values(["date", "game_id"]).itertuples():
                    if r.game_id in gi:
                        rows.append([gi[r.game_id]] + [rnd(getattr(r, c), 3) or 0 for c in cols])
                if rows:
                    logs[str(int(p))] = rows
        f = X.fbs.loc[t]
        doc = {"season": X.y, "team": t, "name": f.school, "abbr": f.abbreviation, "conf": f.conference, "through": X.through,
               "coach": X.extra.get("coaches", {}).get(str(X.y), {}).get(str(t)),
               "sched_cols": ["gid", "date", "week", "stype", "opp", "site", "conf", "final", "pf", "pa", "wp", "opp_rank", "opp_name"],
               "sched": sched,
               "roster_cols": ["id", "name", "pos", "slot", "jersey", "cls", "ht", "wt", "head", "city", "state", "usage", "value"],
               "roster": roster, "logcols": LOGCOLS, "logs": logs,
               "ol": None if ol is None or t not in ol.index else {"value": rnd(ol.value[t], 2), "pass_pro": rnd(ol.pass_pro_pts[t] * ol.games[t], 2),
                                                                   "run_block": rnd(ol.run_block_pts[t] * ol.games[t], 2), "rank": int(olrank[t]),
                                                                   "of": int(len(ol))}}
        out[t] = doc
    return out


# ---------------------------------------------------------------- allsavant/<season>.json
def allsavant_doc(X, A):
    pl = X.pl.set_index("pid")

    def row(r):
        o = dict(r)
        if r.get("pid") is not None:
            p = pl.loc[r["pid"]]
            o.update(name=p["name"], cls=p.cls_y if isinstance(p.cls_y, str) else None, head=int(r["pid"] in X.heads))
        return o

    doc = {"season": X.y, "through": X.through, "final": X.final, "week": X.week,
           "national": {str(t): [row(r) for r in A["national"] if r["tier"] == t] for t in (1, 2, 3)},
           "conference": {c: [row(r) for r in rows] for c, rows in A["conference"].items()},
           "freshman": [row(r) for r in A["freshman"]],
           "heisman": [row(r) for r in A["heisman"]], "non_qb": [row(r) for r in A["non_qb"]],
           "warning": (C.PRE_BOX_WARNING + (" " + C.EARLY_DEF_NOTE if X.y in C.NO_TACKLERS else "")) if X.y < 2024 else None, "note": C.DEFENDER_NOTE,
           "standing": None if X.final else f"as of week {X.week}"}
    return doc


def honour_rows(y, A):
    out = []
    for r in A["national"]:
        if r["pid"] is not None:
            out.append((r["pid"], y, f"nat{r['tier']}", f"{['', '1st', '2nd', '3rd'][r['tier']]}-team All-Savant"))
    for c, rows in A["conference"].items():
        out += [(r["pid"], y, "conf", f"All-{c} Savant") for r in rows if r["pid"] is not None]
    out += [(r["pid"], y, "fr", "Freshman All-Savant") for r in A["freshman"] if r["pid"] is not None]
    if A["heisman"]:
        out.append((A["heisman"][0]["pid"], y, "heisman", "Savant Heisman"))
    if A["non_qb"]:
        out.append((A["non_qb"][0]["pid"], y, "nonqb", "Non-QB Player of the Year"))
    return out


# ---------------------------------------------------------------- playoff/<season>.json
def playoff_doc(X):
    """Returns (doc, resume table)."""
    y = X.y
    base = {"season": y, "through": X.through, "final": X.final, "week": X.week, "rules": PO.RULES_TEXT,
            "cols": ["team", "rank", "w", "l", "resume", "rating", "rating_rank", "sos"]}
    if not X.cur:
        S, r, champs, fld = PO.history(y)
        tg = S.team_games(S.g)
        p, B = PO.bubble_probs(S.ratings(S.champ_fw)[0], *S.ratings(S.champ_fw)[1:], tg.o.to_numpy(), tg.site.to_numpy())
        sos = (1 - tg.assign(p=p).groupby("t").p.mean())
        r["sos"] = r.ti.map(sos)
        r["rating_rank"] = r.rating.rank(ascending=False, method="min").astype(int)
        teams = S.teams
        base.update(bubble=rnd(B, 2), champions={c: int(teams[t]) for c, t in sorted(champs.items())})
    else:
        S = PO.Live(y, X.state, games=X.g_all, weekly=X.weekly,
                    fbs=X.fbs.reset_index().rename(columns={"team": "team_id"}).assign(season=y))
        r, B = S.resume()
        lead = S.leaders()
        fld = S.field(r, lead)
        odds, tb = S.simulate()
        teams = S.teams
        t_id = lambda i: int(teams[i])
        base.update(bubble=rnd(B, 2), sims=PO.N_SIMS, standing=None if X.final else f"if the season ended today (through week {X.week})",
                    leaders={c: dict(first=t_id(v["first"]), second=t_id(v["second"]), set=v["set"],
                                     champion=None if v["champion"] is None else t_id(v["champion"]),
                                     how={str(t_id(k)): (None if h is None else dict(step=h["step"], name=h["name"], outside=h["outside"],
                                                                                    tied_with=[t_id(z) for z in h["tied_with"]]))
                                          for k, h in v["how"].items()},
                                     standings=v["standings"]) for c, v in sorted(lead.items())},
                    odds={str(int(o.team)): [rnd(o.p_field, 4), rnd(o.p_bye, 4), rnd(o.p_host, 4), rnd(o.p_conf, 4)] for o in odds.itertuples()},
                    odds_cols=["field", "bye", "host", "conf"], tiebreak_share={c: rnd(v, 3) for c, v in sorted(tb.items())})
        r = r.copy()
    info = r.set_index("ti")
    infield = {t for _, t, _ in fld}
    base["field"] = [dict(seed=s, team=int(teams[t]), how=h, w=int(info.wins[t]), l=int(info.losses[t]), resume=rnd(info.resume[t], 5),
                          rating=rnd(info.rating[t], 2), rank=int(info["rank"][t])) for s, t, h in fld]
    base["first_out"] = [int(teams[t]) for t in r.ti if t not in infield][:4]
    base["table"] = [[int(teams[x.ti]), int(x.rank), int(x.wins), int(x.losses), rnd(x.resume, 5), rnd(x.rating, 2), int(x.rating_rank),
                      rnd(x.sos, 4)] for x in r.itertuples()]
    out = r.assign(team=[int(teams[t]) for t in r.ti])
    return base, out


# ---------------------------------------------------------------- games/<season>.json
def games_doc(X):
    tg = pd.read_parquet(WORK / "teamgame.parquet")
    tg = tg[(tg.season == X.y) & (tg.filt == "all")].set_index(["game_id", "team"])
    rows, names = [], {}

    def line(gid, t):
        if (gid, t) not in tg.index:
            return [None] * 6
        r = tg.loc[(gid, t)]
        return [int(r.plays), rnd(r.epa / max(r.epa_n, 1), 3), rnd(100 * r.succ / max(r.plays, 1), 1), rnd(100 * r.expl / max(r.plays, 1), 1),
                rnd(r.to_box, 0), rnd(r.yards, 0)]

    for r in X.g.itertuples():
        for t, nm, f in ((r.home, r.home_team, r.home_fbs), (r.away, r.away_team, r.away_fbs)):
            if not f:
                names[str(int(t))] = nm
        rows.append([int(r.game_id), str(r.date.tz_convert("America/New_York").date()), int(r.week), int(r.season_type), int(r.home), int(r.away),
                     rnd(r.home_pts, 0) if r.final else None, rnd(r.away_pts, 0) if r.final else None, int(bool(r.neutral_site)),
                     int(bool(r.conference_game)), int(bool(r.final)), rnd(X.wp_home(r), 3)] + line(r.game_id, r.home) + line(r.game_id, r.away))
    return {"season": X.y, "through": X.through,
            "cols": ["gid", "date", "week", "stype", "home", "away", "hp", "ap", "neutral", "conf", "final", "wp_home", "h_plays", "h_epa", "h_sr",
                     "h_expl", "h_to", "h_yards", "a_plays", "a_epa", "a_sr", "a_expl", "a_to", "a_yards"],
            "rows": rows, "names": names, "notes": ["Team lines are FBS-vs-FBS games with play-by-play; garbage time is included in a game's own line."]}


# ---------------------------------------------------------------- writers
def write_season(y, state, extra, weekly=None, preds=None, only=None):
    """Writes one season's files. Returns (Ctx, sizes, honours)."""
    X = Ctx(y, state, extra, weekly, preds)
    sizes = {}
    pdoc, res = playoff_doc(X)
    sizes[f"playoff/{y}"] = jdump(PUB / "playoff" / f"{y}.json", pdoc)
    sizes[f"s/{y}"] = jdump(PUB / "s" / f"{y}.json", season_doc(X))
    sizes[f"teams/{y}"] = jdump(PUB / "teams" / f"{y}.json", teams_doc(X, res))
    sizes[f"allsavant/{y}"] = jdump(PUB / "allsavant" / f"{y}.json", allsavant_doc(X, X.A))
    sizes[f"games/{y}"] = jdump(PUB / "games" / f"{y}.json", games_doc(X))
    tot = 0
    for t, doc in team_docs(X, X.A).items():
        tot += jdump(PUB / "t" / str(y) / f"{t}.json", doc)
    sizes[f"t/{y}/*"] = tot
    return X, sizes, honour_rows(y, X.A)


def index_entry(X):
    pl = X.pl
    return {"season": X.y, "through": X.through, "final": X.final, "week": X.week, "players": int(len(pl)), "qualified": int(pl.qual.sum()),
            "games": int(X.g.final.sum()), "defense_warning": X.y < 2024, "box_defense": X.y >= 2024}


def write_index(entries):
    """Merge season entries into index.json (a refresh replaces only its own season's entry)."""
    old = jload(PUB / "index.json") or {"seasons": []}
    by = {e["season"]: e for e in old["seasons"]}
    for e in entries:
        by[e["season"]] = e
    seasons = [by[k] for k in sorted(by, reverse=True)]
    doc = {"version": C.VERSION, "current": C.CURRENT, "default_season": C.CURRENT, "first_season": C.FIRST_SEASON, "seasons": seasons,
           "not_on_site": {str(k): v for k, v in sorted(C.DROPPED.items())}}
    return jdump(PUB / "index.json", doc)


def registry_doc():
    stats = []
    for s in C.STATS:
        d = s._asdict()
        d["slots"] = d.pop("pos")
        for k in ("table", "num", "den"):
            d.pop(k)
        d["adj"] = bool(s.adj)
        stats.append(d)
    tg_order = []
    for t in C.TEAM_STATS:
        if t[2] not in tg_order:
            tg_order.append(t[2])
    return {"version": C.VERSION, "first_season": C.FIRST_SEASON, "current": C.CURRENT, "groups": C.GROUPS, "stats": stats,
            "card_groups": CX.CARD_GROUPS, "headline": CX.HEADLINE, "cant_see": {k: [[i, CX.TIER_C[i]] for i in v] for k, v in CX.CANT_SEE.items()},
            "tier_b_note": CX.TIER_B_NOTE, "pools_extra": C.POOLS_EXTRA, "team_groups": tg_order,
            "team_stats": [dict(key=k, label=l, group=g, verdict=v, unit=u, lower=lo, what=w, adj=k in C.TEAM_ADJ, tier=C.TEAM_TIER.get(k, "1.0"),
                                start=2025 if C.TEAM_TIER.get(k) == "B" else C.FIRST_SEASON)
                           for k, l, g, v, u, lo, w in C.TEAM_STATS],
            "slots": C.SLOTS, "slot_name": C.SLOT_NAME, "wider": C.WIDER, "wider_name": C.WIDER_NAME, "min_pool": C.MIN_POOL,
            "qual": {k: list(v) for k, v in C.QUAL.items()}, "games_full": C.GAMES_FULL, "power4": C.POWER4,
            "pre_box_warning": C.PRE_BOX_WARNING, "early_def_note": C.EARLY_DEF_NOTE, "no_tacklers": C.NO_TACKLERS, "defender_note": C.DEFENDER_NOTE, "pbu_off": C.PBU_OFF, "ff_off": C.FF_OFF,
            "garbage_rule": "a margin above 38 points in the second quarter, 28 in the third, 22 in the fourth",
            "logcols": LOGCOLS, "replacement_percentile": 25,
            "value_k": {k: v for k, v in __import__("pipeline.cfb.value", fromlist=["KSET"]).KSET.items()}}


def sizes():
    tot, n, big = 0, 0, []
    for root, _, files in os.walk(PUB):
        for f in files:
            s = os.path.getsize(os.path.join(root, f))
            tot += s
            n += 1
            big.append((s, os.path.relpath(os.path.join(root, f), PUB)))
    big.sort(reverse=True)
    print(f"public/cfb: {n} files, {tot / 1e6:.1f} MB; largest: " + ", ".join(f"{p} {s / 1e6:.2f} MB" for s, p in big[:5]))
    by = {}
    for s, p in big:
        k = p.split("/")[0] if "/" in p else p
        a = by.setdefault(k, [0, 0])
        a[0] += 1
        a[1] += s
    for k, (c, s) in sorted(by.items()):
        print(f"  {k}: {c} files, {s / 1e6:.2f} MB")
    return tot, n, big[0] if big else None


if __name__ == "__main__":
    from .state import load_state
    if sys.argv[1] == "sizes":
        sizes()
    elif sys.argv[1] == "season":
        from .build import extras
        st = load_state()
        X, sz, _ = write_season(int(sys.argv[2]), st, extras())
        write_index([index_entry(X)])
        print(sz)
