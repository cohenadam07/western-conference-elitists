"""
projections.py — per-game projections for every player: rest of season, next 7 days, and
the next three seasons. Everything the Fantasy tab and the connector's projection tools read.

THE MODEL (one idea, applied the same way everywhere)
  A player's rate in each stat is a blend of what he has done and a prior, each weighted by
  sample, with the weights measured rather than chosen:
      rate = (n · x + k · prior) / (n + k)
  n is his sample (minutes, attempts), k is the sample the stat needs (the settle points
  from settle_points.py, converted to minutes where the stat is per-minute).
  * Preseason prior: his last three seasons weighted 5/4/3 by recency and by minutes
    (Tango's Marcel weights), regressed to his position's average with k, then moved by
    the average change for players of his age in that stat (an aging curve fitted on
    2010-11 onward game logs).
  * In season: this season's numbers blend into the preseason projection with the same k.
  * Minutes per game: preseason from the same 5/4/3 history plus age; in season, his recent
    games (last 10 weighted 60%, season 40%) blended with the preseason number at 10 games.
  * Shooting is built from its parts: FGA per 36, the 3PA share, 2P%, 3P%, FTA per FGA and
    FT%, each with its own k, so FG% and FT% stay consistent with the volume.

BACKTEST (python projections.py backtest): every season 2013-14 to 2025-26, projected from
the seasons before it, scored against what happened; plus in-season cuts at 10, 25 and 41
games projecting the rest of the season. Errors against simple baselines go to
out/projections_report.txt. The model ships only if it beats the baselines.

    python projections.py backtest
    python projections.py build [season]    # -> out/savant-proj.json (season defaults to current)
"""
import datetime as dt, json, math, os, sys
from collections import defaultdict
import numpy as np
import pandas as pd
import savant_engine as E
import savant_config as C
import extras_engine as X

POSS_PER_MIN = 2.08
# k in that stat's own sample unit (from settle_points.py, k with a last-season prior;
# per-75 stats converted from possessions to minutes)
K = {
    "fga36": 422 / POSS_PER_MIN,   # shot volume: usage's k
    "p3a": 42,                     # 3PA share of FGA, in FGA
    "p2": 237,                     # 2P%, in 2PA
    "p3": 133,                     # 3P%, in 3PA
    "ftr": 150,                    # FTA per FGA, in FGA
    "ft": 67,                      # FT%, in FTA
    "reb36": 668 / POSS_PER_MIN, "oreb_share": 708 / POSS_PER_MIN,
    "ast36": 596 / POSS_PER_MIN, "stl36": 1496 / POSS_PER_MIN, "blk36": 841 / POSS_PER_MIN,
    "tov36": 1000 / POSS_PER_MIN,
}
MPG_K_GAMES = 10
MARCEL = (5, 4, 3)
FIRST_LOG = 2010
OUT = os.path.join("out", "savant-proj.json")
REPORT = os.path.join("out", "projections_report.txt")


def season_label(y):
    return f"{y}-{str(y + 1)[2:]}"


# ---------------------------------------------------------------- data
def logs(season):
    gl = X.load_game_logs(season)
    gl = gl[gl["MIN"].astype(float) > 0].copy()
    gl["GAME_DATE"] = pd.to_datetime(gl["GAME_DATE"])
    return gl.sort_values(["PLAYER_ID", "GAME_DATE"])


COUNT = ["MIN", "FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PTS", "DD2", "TD3"]


def totals(df):
    t = df[COUNT].astype(float).sum()
    t["GP"] = len(df)
    return t


def rates(t):
    """Per-36 and shooting-part rates from totals, with the sample behind each."""
    m = max(t["MIN"], 1e-9)
    fga, fg3a, fta = t["FGA"], t["FG3A"], t["FTA"]
    p2a = fga - fg3a
    return {
        "fga36": (36 * fga / m, m), "p3a": ((fg3a / fga) if fga else None, fga),
        "p2": (((t["FGM"] - t["FG3M"]) / p2a) if p2a else None, p2a),
        "p3": ((t["FG3M"] / fg3a) if fg3a else None, fg3a),
        "ftr": ((fta / fga) if fga else None, fga), "ft": ((t["FTM"] / fta) if fta else None, fta),
        "reb36": (36 * t["REB"] / m, m), "oreb_share": ((t["OREB"] / t["REB"]) if t["REB"] else None, m),
        "ast36": (36 * t["AST"] / m, m), "stl36": (36 * t["STL"] / m, m), "blk36": (36 * t["BLK"] / m, m),
        "tov36": (36 * t["TOV"] / m, m),
    }


def per_game(r, mpg):
    """Per-game line from rates (a projection, or rates() output as (value, n) pairs) and minutes."""
    r = {k: ((v[0] or 0.0) if isinstance(v, tuple) else v) for k, v in r.items()}
    f = mpg / 36
    fga = r["fga36"] * f
    fg3a = fga * r["p3a"]
    fg2a = fga - fg3a
    fg3m = fg3a * r["p3"]
    fgm = fg2a * r["p2"] + fg3m
    fta = fga * r["ftr"]
    ftm = fta * r["ft"]
    reb = r["reb36"] * f
    out = dict(min=mpg, pts=2 * (fgm - fg3m) + 3 * fg3m + ftm, reb=reb, oreb=reb * r["oreb_share"],
               dreb=reb * (1 - r["oreb_share"]), ast=r["ast36"] * f, stl=r["stl36"] * f, blk=r["blk36"] * f,
               tov=r["tov36"] * f, fg3m=fg3m, fg3a=fg3a, fgm=fgm, fga=fga, ftm=ftm, fta=fta)
    return {k: round(float(v), 3) for k, v in out.items()}


WW_INV = {}


# ---------------------------------------------------------------- positions, ages
def position_age_index(seasons):
    """pid -> {season: (pos, age)} from the published Savant data (archive + current)."""
    # The site's published data: the bot's worktree of main when it exists (that is what is live),
    # else the main checkout. SAVANT_PUBLIC overrides.
    pub = os.environ.get("SAVANT_PUBLIC") or next(
        (p for p in (os.path.expanduser("~/western-conference-elitists/.worktrees/savant-bot/public"),
                     os.path.expanduser("~/western-conference-elitists/public")) if os.path.exists(os.path.join(p, "savant-data.json"))))
    path = os.path.join(pub, "savant-data.json")
    d = json.load(open(path))
    cur = os.path.join(pub, "savant-current.json")
    if os.path.exists(cur):
        c = json.load(open(cur))
        for s in c.get("seasons", []):
            d["data"][s] = c["data"][s]
    # injury beneficiaries: the with/without table turned around (who gains when X sits),
    # from the newest season that has one; the Fantasy tab's connector tool reads it
    global WW_INV
    WW_INV = {}
    for s in sorted(d["data"], reverse=True):
        rows = (d["data"][s] or {}).get("players", [])
        if not any(p.get("ww") for p in rows):
            continue
        inv = defaultdict(list)
        for p in rows:
            for r in p.get("ww") or []:
                w, o = r["w"], r["wo"]
                inv[str(r["id"])].append(dict(id=p["id"], gwo=r["gwo"], gw=r["gw"],
                                              d={k: round(o[k] - w[k], 1) for k in ("min", "pts", "reb", "ast", "usg")},
                                              wo={k: o[k] for k in ("min", "pts", "reb", "ast", "usg")}))
        WW_INV = dict(season=s, by=dict(inv))
        break
    idx = defaultdict(dict)
    for s in seasons:
        for p in (d["data"].get(s) or {}).get("players", []):
            if isinstance(p["id"], int):
                idx[p["id"]][s] = (p.get("pos") or "Wing", p.get("age"), p.get("birthdate"))
    return idx


def age_on(birthdate, season):
    if not birthdate:
        return None
    y, m, d_ = (int(x) for x in birthdate.split("-"))
    ref = dt.date(int(season[:4]) + 1, 2, 1)
    return (ref - dt.date(y, m, d_)).days / 365.25


# ---------------------------------------------------------------- aging
def fit_aging(by_season, ages, upto):
    """Average year-over-year change in each rate by age (players with 500+ minutes both
    years, weighted by the smaller minutes), smoothed with a cubic. Fitted only on season
    pairs that end before `upto`, so a backtest never sees its own future."""
    pts = defaultdict(list)
    seasons = sorted(by_season)
    for a, b in zip(seasons, seasons[1:]):
        if int(b[:4]) >= int(upto[:4]):
            continue
        for pid, ta in by_season[a].items():
            tb = by_season[b].get(pid)
            if tb is None or ta["MIN"] < 500 or tb["MIN"] < 500:
                continue
            age = ages.get((pid, b))
            if age is None:
                continue
            ra, rb = rates(ta), rates(tb)
            w = min(ta["MIN"], tb["MIN"])
            for k in K:
                if ra[k][0] is None or rb[k][0] is None:
                    continue
                pts[k].append((age, rb[k][0] - ra[k][0], w))
            pts["mpg"].append((age, tb["MIN"] / tb["GP"] - ta["MIN"] / ta["GP"], w))
    curves = {}
    for k, rows in pts.items():
        a = np.array(rows)
        if len(a) < 200:
            continue
        x = np.clip(a[:, 0], 19, 38)
        coef = np.polyfit(x, a[:, 1], 3, w=np.sqrt(a[:, 2]))
        curves[k] = coef
    return curves


def aging_delta(curves, k, age):
    if age is None or k not in curves:
        return 0.0
    return float(np.polyval(curves[k], min(max(age, 19), 38)))


# ---------------------------------------------------------------- the projection
def pos_means(by_season, pos_idx, season, positions=("Guard", "Wing", "Big")):
    """Minutes-weighted league rates by position for one season (the regression target)."""
    acc = {p: defaultdict(lambda: [0.0, 0.0]) for p in positions}
    for pid, t in by_season.get(season, {}).items():
        if t["MIN"] < 300:
            continue
        pos = (pos_idx.get(pid, {}).get(season) or ("Wing",))[0]
        r = rates(t)
        for k, (v, n) in r.items():
            if v is None or not n:
                continue
            acc.setdefault(pos, defaultdict(lambda: [0.0, 0.0]))
            acc[pos][k][0] += v * n
            acc[pos][k][1] += n
    return {p: {k: (s / n if n else None) for k, (s, n) in d.items()} for p, d in acc.items()}


def preseason(pid, season, by_season, pos_idx, curves, means_cache):
    """Projected rates and MPG for `season` from the three seasons before it."""
    y = int(season[:4])
    hist = [(by_season.get(season_label(y - i)) or {}).get(pid) for i in (1, 2, 3)]
    info = pos_idx.get(pid, {})
    pos, birth = "Wing", None
    for s in [season] + [season_label(y - i) for i in (1, 2, 3)]:
        if s in info:
            pos, birth = info[s][0], info[s][2]
            break
    prev = season_label(y - 1)
    if prev not in means_cache:
        means_cache[prev] = pos_means(by_season, pos_idx, prev)
    mu = means_cache[prev].get(pos) or {}
    age = age_on(birth, season)
    out, n_hist = {}, 0.0
    for k in K:
        num = den = 0.0
        for w, t in zip(MARCEL, hist):
            if t is None:
                continue
            v, n = rates(t)[k]
            if v is None or not n:
                continue
            num += w * v * n
            den += w * n
        prior = mu.get(k)
        if prior is None:
            prior = num / den if den else 0.0
        n_eff = den / MARCEL[0] if den else 0.0          # sample in last-season units
        x = num / den if den else prior
        r = (n_eff * x + K[k] * prior) / (n_eff + K[k])
        r += aging_delta(curves, k, age)
        out[k] = r
        n_hist = max(n_hist, n_eff)
    for k in ("p3a", "p2", "p3", "ft", "oreb_share"):
        out[k] = min(max(out[k], 0.0), 0.99)
    for k in ("fga36", "ftr", "reb36", "ast36", "stl36", "blk36", "tov36"):
        out[k] = max(out[k], 0.0)
    # minutes
    num = den = 0.0
    for w, t in zip(MARCEL, hist):
        if t is None or not t["GP"]:
            continue
        num += w * t["MIN"]
        den += w * t["GP"]
    mpg_hist = num / den if den else None
    games_hist = den / MARCEL[0] if den else 0.0
    base = 18.0 if mpg_hist is None else (games_hist * mpg_hist + MPG_K_GAMES * 18.0) / (games_hist + MPG_K_GAMES)
    mpg = max(4.0, min(38.0, base + aging_delta(curves, "mpg", age)))
    gp_hist = [t["GP"] for t in hist if t is not None]
    return dict(rates=out, mpg=mpg, pos=pos, age=age, history=bool(den), n_hist=n_hist,
                gp_rate=(sum(gp_hist) / (82 * len(gp_hist))) if gp_hist else 0.75)


def in_season(pre, games_df):
    """Blend this season's games into the preseason projection."""
    t = totals(games_df)
    r = rates(t)
    out = {}
    for k in K:
        v, n = r[k]
        if v is None or not n:
            out[k] = pre["rates"][k]
        else:
            out[k] = (n * v + K[k] * pre["rates"][k]) / (n + K[k])
    g = len(games_df)
    mins = games_df["MIN"].astype(float).values
    recent = 0.6 * mins[-10:].mean() + 0.4 * mins.mean() if g else pre["mpg"]
    mpg = (g * recent + MPG_K_GAMES * pre["mpg"]) / (g + MPG_K_GAMES)
    return out, mpg


# ---------------------------------------------------------------- loading history
def load_history(last):
    by_season, games = {}, {}
    for y in range(FIRST_LOG, int(last[:4]) + 1):
        s = season_label(y)
        try:
            gl = logs(s)
        except Exception as e:
            print(f"  {s}: game logs unavailable ({repr(e)[:60]})")
            continue
        games[s] = gl
        by_season[s] = {int(pid): totals(g) for pid, g in gl.groupby("PLAYER_ID")}
        print(f"  {s}: {len(gl):,} player-games", flush=True)
    return by_season, games


def ages_map(pos_idx):
    out = {}
    for pid, by in pos_idx.items():
        for s, (pos, age, birth) in by.items():
            out[(pid, s)] = age_on(birth, s)
    return out


# ---------------------------------------------------------------- backtest
STATS_OUT = ["pts", "reb", "ast", "stl", "blk", "fg3m", "tov", "min"]


def backtest():
    last = C.SEASONS[1] if C.SEASONS[0] != C.SEASONS[1] else C.SEASONS[0]
    by_season, games = load_history(last)
    pos_idx = position_age_index(list(by_season))
    ages = ages_map(pos_idx)
    lines = ["Projection backtest: per-game errors (mean absolute error, players weighted equally)", ""]
    pre_err = defaultdict(lambda: defaultdict(list))
    ins_err = defaultdict(lambda: defaultdict(list))
    for y in range(2013, int(last[:4]) + 1):
        s = season_label(y)
        curves = fit_aging(by_season, ages, s)
        means_cache = {}
        act = by_season[s]
        gsplit = {int(k): v for k, v in games[s].groupby("PLAYER_ID")}
        for pid, t in act.items():
            if t["MIN"] < 500 or t["GP"] < 20:
                continue
            pre = preseason(pid, s, by_season, pos_idx, curves, means_cache)
            if not pre["history"]:
                continue
            actual = per_game(rates(t), t["MIN"] / t["GP"])
            mine = per_game(pre["rates"], pre["mpg"])
            prev_t = by_season[season_label(y - 1)].get(pid)
            base = per_game(rates(prev_t), prev_t["MIN"] / prev_t["GP"]) if prev_t is not None and prev_t["GP"] else None
            for k in STATS_OUT:
                pre_err["model"][k].append(abs(mine[k] - actual[k]))
                if base:
                    pre_err["last season"][k].append(abs(base[k] - actual[k]))
            # in-season cuts
            g = gsplit[pid]
            for cut in (10, 25, 41):
                if len(g) < cut + 15:
                    continue
                first, rest = g.iloc[:cut], g.iloc[cut:]
                r, mpg = in_season(pre, first)
                tr = totals(rest)
                act_rest = per_game(rates(tr), tr["MIN"] / tr["GP"])
                mine = per_game(r, mpg)
                tf = totals(first)
                std = per_game(rates(tf), tf["MIN"] / tf["GP"])
                pre_only = per_game(pre["rates"], pre["mpg"])
                for k in STATS_OUT:
                    ins_err[(cut, "model")][k].append(abs(mine[k] - act_rest[k]))
                    ins_err[(cut, "season to date")][k].append(abs(std[k] - act_rest[k]))
                    ins_err[(cut, "preseason only")][k].append(abs(pre_only[k] - act_rest[k]))
        print(f"  backtested {s}", flush=True)
    hdr = "                         " + "".join(f"{k:>8}" for k in STATS_OUT)
    lines += ["PRESEASON: the whole season, projected from the seasons before it (players with 500+ min, 20+ games)", hdr]
    for name in ("model", "last season"):
        lines.append(f"{name:25}" + "".join(f"{np.mean(pre_err[name][k]):8.3f}" for k in STATS_OUT))
    n = len(pre_err["model"]["pts"])
    lines.append(f"({n:,} player-seasons)")
    for cut in (10, 25, 41):
        lines += ["", f"IN SEASON after {cut} games: projecting the rest of his season", hdr]
        for name in ("model", "season to date", "preseason only"):
            lines.append(f"{name:25}" + "".join(f"{np.mean(ins_err[(cut, name)][k]):8.3f}" for k in STATS_OUT))
        lines.append(f"({len(ins_err[(cut, 'model')]['pts']):,} player-seasons)")
    open(REPORT, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


# ---------------------------------------------------------------- schedule
def schedule(season):
    from nba_api.stats.endpoints import scheduleleaguev2 as S
    d = E.call_frames(S.ScheduleLeagueV2, dict(season=season, league_id="00"), frames=(0,))[0]
    d = d[d["gameId"].astype(str).str.zfill(10).str.startswith("002")]   # regular season (ids lose their zeros in the cache)
    out = []
    for _, r in d.iterrows():
        when = pd.to_datetime(r["gameDateEst"]).date() if "gameDateEst" in d.columns else pd.to_datetime(r["gameDate"]).date()
        h, a = str(r["homeTeam_teamTricode"]), str(r["awayTeam_teamTricode"])
        if not (h.isalpha() and a.isalpha() and len(h) == 3 and len(a) == 3 and h.isupper() and a.isupper()):
            continue                          # NBA Cup knockout games are on the schedule as TBD until set
        out.append((str(r["gameId"]), when, h, a))
    return out


def team_windows(sched, today, days=7):
    """tricode -> {next7: [dates], b2b: [dates that are a 2nd night], left: games left}"""
    by = defaultdict(list)
    for gid, d, h, a in sched:
        by[h].append(d); by[a].append(d)
    end = today + dt.timedelta(days=days)
    out = {}
    for tm, ds in by.items():
        ds = sorted(ds)
        nxt = [d for d in ds if today <= d < end]
        b2b = [d for d in nxt if (d - dt.timedelta(days=1)) in ds]
        out[tm] = dict(next7=[d.isoformat() for d in nxt], b2b=[d.isoformat() for d in b2b],
                       left=sum(1 for d in ds if d >= today))
    return out


# ---------------------------------------------------------------- injuries
def sleeper_injuries():
    """{(normalized name, team): status} from Sleeper's player file (fetched once per run;
    Sleeper asks for at most one pull a day of this file, and the nightly runs are well under)."""
    import requests, unicodedata
    try:
        pl = requests.get("https://api.sleeper.app/v1/players/nba", timeout=60).json()
    except Exception as e:
        print(f"  Sleeper injuries unavailable ({repr(e)[:60]})")
        return {}
    norm = lambda s: "".join(c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c)).lower().replace(".", "").replace("'", "").replace(" jr", "").replace(" sr", "").replace(" iii", "").replace(" ii", "").strip()
    by_name = defaultdict(list)       # normalized name -> [(sleeper team, sleeper id, injury status)]
    for sid, p in pl.items():
        if p.get("sport", "nba") != "nba" or not p.get("full_name"):
            continue
        by_name[norm(p["full_name"])].append((p.get("team") or "", str(sid), p.get("injury_status")))
    return by_name, norm


# Sleeper's team codes where they differ from the NBA's
SLEEPER_TEAM = {"GS": "GSW", "NO": "NOP", "SA": "SAS", "NY": "NYK", "PHO": "PHX", "UTAH": "UTA", "WSH": "WAS", "BKN": "BKN"}


def sleeper_match(by_name, norm, name, team):
    """(sleeper id, injury status) for an NBA player: unique name wins, else name + team."""
    c = by_name.get(norm(name)) or []
    if len(c) > 1:
        c = [x for x in c if SLEEPER_TEAM.get(x[0], x[0]) == team] or [x for x in c if x[0]]
    if len(c) == 1:
        return c[0][1], c[0][2]
    return None, None


# Expected share of a game he plays, by status: what fantasy managers act on.
STATUS_PLAY = {"Out": 0.0, "Doubtful": 0.15, "Questionable": 0.55, "Probable": 0.9, "GTD": 0.55, "Sus": 0.0, "IR": 0.0, "DTD": 0.55}


# ---------------------------------------------------------------- build
LOG_COLS = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "FG3M", "TOV", "FGM", "FGA", "FTM", "FTA", "OREB", "DREB", "DD2", "TD3"]


def build(season=None):
    season = season or C.SEASON
    E.FRESH_SEASON = season          # this season's game logs, roster and schedule: always fresh
    y = int(season[:4])
    last = season_label(y - 1)
    by_season, games = load_history(season)
    pos_idx = position_age_index(list(by_season) + [season])
    ages = ages_map(pos_idx)
    curves = fit_aging(by_season, ages, season)
    means_cache = {}
    cur_games = games.get(season)
    cur_split = {int(k): v for k, v in cur_games.groupby("PLAYER_ID")} if cur_games is not None and len(cur_games) else {}
    # roster: the league's current rosters, rookies included (PlayerIndex without the
    # historical flag lists rostered players, with draft position)
    from nba_api.stats.endpoints import playerindex as PI
    roster = E.call(PI.PlayerIndex, dict(season=season, league_id="00"), use_cache=False)
    fi = C.FIELD_MAP["index"]
    sched = schedule(season)
    today = dt.date.today()
    tw = team_windows(sched, today)
    inj = sleeper_injuries()
    slp_names, norm = inj if inj else ({}, lambda s: s)
    # rookie prior: first-season players of the last three seasons, minutes-weighted per position
    rook = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
    for yy in (y - 1, y - 2, y - 3):
        s = season_label(yy)
        prev_ids = set((by_season.get(season_label(yy - 1)) or {}).keys()) | set((by_season.get(season_label(yy - 2)) or {}).keys())
        for pid, t in (by_season.get(s) or {}).items():
            if pid in prev_ids or t["MIN"] < 200:
                continue
            pos = (pos_idx.get(pid, {}).get(s) or ("Wing",))[0]
            for k, (v, n) in rates(t).items():
                if v is not None and n:
                    rook[pos][k][0] += v * n
                    rook[pos][k][1] += n
    rookie_rates = {p: {k: s / n for k, (s, n) in d.items() if n} for p, d in rook.items()}
    # rookie minutes by draft slot, from the last three rookie classes
    def bucket(pick):
        try:
            pick = int(float(pick))
        except (TypeError, ValueError):
            return "undrafted"
        return "1-5" if pick <= 5 else "6-14" if pick <= 14 else "15-30" if pick <= 30 else "31-60"
    rmin = defaultdict(lambda: [0.0, 0.0])
    for yy in (y - 1, y - 2, y - 3):
        s = season_label(yy)
        try:
            idx = E.load_index(s)
        except Exception:
            continue
        for _, ir in idx.iterrows():
            if str(ir.get("FROM_YEAR")) != str(yy):
                continue
            t = (by_season.get(s) or {}).get(int(ir[fi["id"]]))
            b_ = bucket(ir.get("DRAFT_NUMBER"))
            rmin[b_][0] += (t["MIN"] / t["GP"]) if t is not None and t["GP"] else 0.0
            rmin[b_][1] += 1
    rookie_mpg = {b_: (v / n if n else 8.0) for b_, (v, n) in rmin.items()}
    print("  rookie minutes by draft slot:", {k: round(v, 1) for k, v in sorted(rookie_mpg.items())})

    players = {}
    for _, r in roster.iterrows():
        pid = int(r[fi["id"]])
        name = E._ascii(f"{E._s(r.get(fi['first']))} {E._s(r.get(fi['last']))}".strip())
        team = E._s(r.get(fi["team"]))
        pre = preseason(pid, season, by_season, pos_idx, curves, means_cache)
        pos = C.position_bucket(r.get(fi["pos"], "")) or pre["pos"]
        if not pre["history"]:
            rr = dict(rookie_rates.get(pos) or rookie_rates.get("Wing") or {})
            if not rr:
                continue
            first_year = str(r.get("FROM_YEAR")) == str(y)
            # a true rookie gets his draft slot's minutes; a veteran back after 3+ years away
            # (Europe, injury) gets a bench role until he plays
            mpg0 = rookie_mpg.get(bucket(r.get("DRAFT_NUMBER")), 8.0) if first_year else 10.0
            pre = dict(pre, rates={k: rr.get(k, 0.0) for k in K}, mpg=mpg0, pos=pos)
        g = cur_split.get(pid)
        if g is not None and len(g):
            ros_rates, mpg = in_season(pre, g)
            gp = len(g)
        else:
            ros_rates, mpg, gp = pre["rates"], pre["mpg"], 0
        team_w = tw.get(team, {"next7": [], "b2b": [], "left": 0})
        slp, status = sleeper_match(slp_names, norm, name, team)
        play = STATUS_PLAY.get(status, 1.0) if status else 1.0
        # three seasons ahead: age the rates and minutes a year at a time
        y3, rr, mp, age = [], dict(pre["rates"] if not gp else ros_rates), (pre["mpg"] if not gp else mpg), pre["age"]
        for i in range(3):
            if i > 0 and age is not None:
                for k in K:
                    rr[k] = max(0.0, rr[k] + aging_delta(curves, k, age + i))
                mp = max(4.0, min(38.0, mp + aging_delta(curves, "mpg", age + i)))
            y3.append(dict(season=season_label(y + i), pg=per_game(rr, mp)))
        recent = []
        hist_rows = []
        for s in (last, season):
            gg = (games.get(s) if s != season else cur_games)
            if gg is None or not len(gg):
                continue
            sub = gg[gg["PLAYER_ID"] == pid]
            hist_rows.append(sub)
        if hist_rows:
            hr = pd.concat(hist_rows)
            if "GAME_DATE" in hr.columns:            # the NBA returns newest first; the log runs oldest -> newest
                hr = hr.assign(_d=pd.to_datetime(hr["GAME_DATE"])).sort_values("_d")
            hr = hr.tail(60)
            recent = hr[LOG_COLS].astype(float).round(0).astype(int).values.tolist()
        players[pid] = dict(
            name=name, team=team, pos=pos, age=round(pre["age"], 1) if pre["age"] else None,
            rookie=not pre["history"], gp=gp, gp_rate=round(pre["gp_rate"], 3),
            pre=per_game(pre["rates"], pre["mpg"]), ros=per_game(ros_rates, mpg),
            games_left=team_w["left"], next7=team_w["next7"], b2b=team_w["b2b"],
            status=status, play=play, y3=y3, log=recent, slp=slp,
        )
    # every team's remaining games, [date, opponent, home?]: the page builds next-7, this
    # fantasy week, back-to-backs and Lock-In game sequences from this one table
    team_sched = defaultdict(list)
    for gid, d, h, a in sorted(sched, key=lambda g: g[1]):
        if d >= today:
            team_sched[h].append([d.isoformat(), a, 1])
            team_sched[a].append([d.isoformat(), h, 0])
    payload = dict(season=season, generated=dt.datetime.now(dt.timezone.utc).isoformat(), today=today.isoformat(),
                   log_cols=[c.lower() for c in LOG_COLS], players=players, sched=dict(team_sched), ww_inv=WW_INV,
                   method="projections.py: Marcel 5/4/3 history, regressed to position with settle-point k, aged; in season blended with this season at the same k. Backtest: out/projections_report.txt")
    s = json.dumps(payload, separators=(",", ":"))
    import safe_io
    safe_io.write_text(OUT, s)
    print(f"wrote {OUT}: {len(players)} players, {sum(1 for p in players.values() if p['rookie'])} without NBA history, "
          f"{sum(1 for p in players.values() if p['status'])} with an injury status; {len(s)/1e6:.1f} MB")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "backtest"
    if cmd == "backtest":
        backtest()
    elif cmd == "build":
        build(sys.argv[2] if len(sys.argv) > 2 else None)
