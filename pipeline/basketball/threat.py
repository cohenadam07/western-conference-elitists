"""
threat.py — the offensive threat score behind mtchc (Matchup difficulty, creation-weighted).

    T = threat_table(rows, season, pool_min, k)      # one season, every offensive player

`rows` is {pid: {"min": minutes, "pos": "Guard"|"Wing"|"Big", "tsa": true-shooting attempts,
"v": {key: value}}}, the season's own card values (Basketball Savant's player-season numbers,
never re-derived here; tsa is the sample the card's ts carries). Three parts:

    Scoring   pts (Points / 75) and pae, points above average efficiency: pts x (ts - the
              season's league TS%). League TS% is attempt-weighted over every player, the way
              Savant value (tools/savant-value/value.py) takes it: sum of points / (2 x sum of
              attempts). Raw TS% let a low-usage big with a .700 TS reach the top of Scoring on
              efficiency alone (77 player-seasons, 2017-18 to 2025-26, in a season's top 60
              with below-average Points / 75); pae weighs the efficiency by the volume it was on.
    Creation  ast (Assist %), potast (Potential assists / 75), astpts75 (Assist points
              created / 75), top75 (Time of possession / 75; left out in 2024-25, when the
              NBA's time of possession runs ~40% long: ext_config.BROKEN_SEASONS)
    Overall   obpm (Offensive BPM) and, from 2025-26, gravity: the average of gravonp and
              gravoni (on-ball perimeter and interior). Off-ball gravity is spacing, not
              creating, and stays out. A player the NBA publishes no gravity for is OBPM alone.


Steps, within one season:
  1. Each input is z-scored with the mean and SD of the players with pool_min+ minutes (500,
     or 500 x team games / 82 in the season in progress), and the z applied to everyone.
  2. Inside a part the available z-scores are averaged equally (in Overall, the two gravity
     z-scores first, then that with OBPM).
  3. Re-standardised. An average of two z-scores has less spread than one, so players whose
     part was built from fewer inputs (no gravity, a missing tracking stat) would sit at a
     different spread from everyone else. Each recipe (the set of inputs that were present)
     is scaled to unit spread around its own pool mean, so its level is kept, and the part
     is then centred and scaled once over the whole pool. A recipe with fewer than
     MIN_RECIPE pool players is not rescaled.
  3b. Overall is then taken net of Scoring (overall_mode "resid", the default): within the
     season Overall is regressed on Scoring over the pool, and the residual, re-standardised,
     is Overall. OBPM is mostly a scoring measure (Overall and Scoring correlated 0.81-0.87
     every season), so the equal-weight version counted scoring about twice. Adam's call,
     Nov 17, 2026, made on that basis rather than on a test. "equal" keeps the old part.
  4. Each part is pulled toward the league mean (0) by minutes / (minutes + k[part]).
  5. threat = the equal-weight average of the three shrunk parts. A part with no input at
     all counts as 0, the league mean.
"""
import math
import statistics

PARTS = ("score", "create", "overall")
INPUTS = {
    "score": ("pts", "pae"),
    "create": ("ast", "potast", "astpts75", "top75"),
    "overall": ("obpm", "gravonp", "gravoni"),
}
GRAVITY = ("gravonp", "gravoni")
POOL_MIN = 500
MIN_RECIPE = 30
# Shrinkage k, in minutes, per part. Measured, not chosen, with the settle-point method every
# other stat uses (tools/savant-settle/measure.py season_to_season, then its calibration):
# each qualified player's part, shrunk by n / (n + k), predicting his part next season,
# 2013-14 to 2025-26 (2,748 season pairs, median 1,788 minutes). The fitted season-to-season
# k (score 562, create 188, overall net of scoring 708) times the possession family's factor
# (1.259) is the k_last the page would show; times the family's mean share (0.355) it is
# k_mean, the k for a prior at the mean, which is what this shrinkage is. Nov 17, 2026.
# Scoring with pae in place of ts fits the same k as with ts (562, a grid point). The
# equal-weight Overall (overall_mode "equal", kept for comparison) fits 473 -> k_mean 211.
# k = 500 for every part was the fallback and is not needed: against the first fit the 500+
# minute ranking was the same (Spearman 0.998) and players under 500 minutes were shrunk
# about twice as hard.
K = {"score": 251, "create": 84, "overall": 316}
K_EQUAL = {"score": 251, "create": 84, "overall": 211}
LEFT_OUT = {"top75": {"2024-25"}}        # = ext_config.BROKEN_SEASONS["top75"]


def pool_line(team_games=None):
    """500 minutes for a finished season; pro-rated to the median team's games in one in progress."""
    if team_games is None:
        return POOL_MIN
    return POOL_MIN * team_games / 82


def _ok(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _mean_sd(xs):
    if len(xs) < 2:
        return None
    m = statistics.fmean(xs)
    sd = statistics.pstdev(xs)
    return (m, sd) if sd > 0 else None


def league_ts(rows):
    """Attempt-weighted league TS%: sum(ts x tsa) / sum(tsa) = points / (2 x attempts)."""
    num = den = 0.0
    for r in rows.values():
        ts, n = r["v"].get("ts"), r.get("tsa")
        if _ok(ts) and _ok(n) and n > 0:
            num += ts * n
            den += n
    return num / den if den else None


def with_pae(rows):
    """rows with v["pae"] = pts x (ts - league TS%) where both exist (a copy; rows untouched)."""
    lg = league_ts(rows)
    out = {}
    for pid, r in rows.items():
        v = dict(r["v"])
        pts, ts = v.get("pts"), v.get("ts")
        v["pae"] = pts * (ts - lg) if lg is not None and _ok(pts) and _ok(ts) else None
        out[pid] = dict(r, v=v)
    return out


def zscores(rows, season, pool_min, keys):
    """{key: {pid: z}} over every player with a value, scaled by the pool's mean and SD."""
    out = {}
    for k in keys:
        if season in LEFT_OUT.get(k, ()):
            out[k] = {}
            continue
        vals = {pid: r["v"].get(k) for pid, r in rows.items()}
        vals = {pid: float(v) for pid, v in vals.items() if _ok(v)}
        ms = _mean_sd([v for pid, v in vals.items() if rows[pid]["min"] >= pool_min])
        out[k] = {} if ms is None else {pid: (v - ms[0]) / ms[1] for pid, v in vals.items()}
    return out


def _raw_part(part, pid, Z, gravity=True):
    """(average z, recipe) or (None, ()) for one player's part."""
    if part == "overall":
        g = [Z[k][pid] for k in GRAVITY if gravity and pid in Z.get(k, {})]
        comps, recipe = [], []
        if pid in Z.get("obpm", {}):
            comps.append(Z["obpm"][pid]); recipe.append("obpm")
        if g:
            comps.append(sum(g) / len(g)); recipe.append("grav")
    else:
        recipe = [k for k in INPUTS[part] if pid in Z.get(k, {})]
        comps = [Z[k][pid] for k in recipe]
    if not comps:
        return None, ()
    return sum(comps) / len(comps), tuple(recipe)


def _resid(P, rows, pool_min):
    """Overall net of Scoring: OLS over the pool, residual for everyone, re-standardised."""
    pool = [pid for pid in rows if rows[pid]["min"] >= pool_min
            and P[pid]["overall"] is not None and P[pid]["score"] is not None]
    if len(pool) < MIN_RECIPE:                                # nothing to regress on: leave it
        return None
    xs = [P[pid]["score"] for pid in pool]
    ys = [P[pid]["overall"] for pid in pool]
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    a = my - b * mx
    res = {pid: P[pid]["overall"] - (a + b * (P[pid]["score"] or 0.0))
           for pid in rows if P[pid]["overall"] is not None}
    ms = _mean_sd([res[pid] for pid in pool])
    for pid in rows:
        P[pid]["overall"] = (res[pid] - ms[0]) / ms[1] if pid in res else None
    return b


def parts_table(rows, season, pool_min, gravity=True, overall_mode="resid"):
    """{pid: {part: standardised value or None}} plus {part: {recipe: pool size}}."""
    rows = with_pae(rows)
    Z = zscores(rows, season, pool_min, [k for p in PARTS for k in INPUTS[p]])
    out = {pid: {} for pid in rows}
    recipes = {}
    for part in PARTS:
        raw, rec = {}, {}
        for pid in rows:
            v, r = _raw_part(part, pid, Z, gravity)
            if v is not None:
                raw[pid], rec[pid] = v, r
        inpool = [pid for pid in raw if rows[pid]["min"] >= pool_min]
        sizes = {}
        for r in set(rec.values()):
            sizes[r] = sum(1 for pid in inpool if rec[pid] == r)
        scale = {}
        for r, n in sizes.items():
            ms = _mean_sd([raw[pid] for pid in inpool if rec[pid] == r]) if n >= MIN_RECIPE else None
            scale[r] = ms[1] if ms else None
        base = _mean_sd([raw[pid] for pid in inpool])
        if base is None:                                      # no pool to scale it by: no part
            for pid in rows:
                out[pid][part] = None
            recipes[part] = sizes
            continue
        adj = {pid: v / (scale.get(rec[pid]) or base[1]) for pid, v in raw.items()}
        ms = _mean_sd([adj[pid] for pid in inpool])
        for pid in rows:
            out[pid][part] = (adj[pid] - ms[0]) / ms[1] if pid in adj else None
        recipes[part] = sizes
    if overall_mode == "resid":
        recipes["overall_on_score"] = _resid(out, rows, pool_min)
    return out, recipes


def shrink(value, minutes, k):
    return value * minutes / (minutes + k) if value is not None else 0.0


def threat_table(rows, season, pool_min, k=K, gravity=True, overall_mode="resid"):
    """{pid: {"score", "create", "overall" (shrunk), "raw": {part: unshrunk}, "threat"}}."""
    P, recipes = parts_table(rows, season, pool_min, gravity, overall_mode)
    out = {}
    for pid, r in rows.items():
        s = {part: shrink(P[pid][part], r["min"], k[part]) for part in PARTS}
        s["raw"] = P[pid]
        s["threat"] = sum(s[part] for part in PARTS) / len(PARTS)
        out[pid] = s
    return out, recipes


def defender_table(pairs, T):
    """mtchc and its parts for every defender, from (def_id, off_id, partial possessions).

    The partial-possession-weighted average of the threat (and of each shrunk part) of the
    offensive players he guarded, the same weights mtch uses. An offensive player with no row
    in T counts at the league mean (0) and still counts toward the sample. Because threat is
    the average of the three parts, mtchc = (mtchc_score + mtchc_create + mtchc_overall) / 3
    exactly. n is his matchup possessions."""
    acc = {}
    for d, o, w in pairs:
        if not w or w <= 0:
            continue
        t = T.get(o)
        a = acc.setdefault(d, [0.0, 0.0, 0.0, 0.0, 0.0])
        if t is not None:
            a[0] += w * t["threat"]; a[1] += w * t["score"]; a[2] += w * t["create"]; a[3] += w * t["overall"]
        a[4] += w
    return {d: {"mtchc": a[0] / a[4], "mtchc_score": a[1] / a[4], "mtchc_create": a[2] / a[4],
                "mtchc_overall": a[3] / a[4], "n": a[4]} for d, a in acc.items() if a[4] > 0}
