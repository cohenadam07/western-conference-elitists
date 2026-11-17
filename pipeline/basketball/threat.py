"""
threat.py — the offensive threat score behind mtchc (Matchup difficulty, creation-weighted).

    T = threat_table(rows, season, pool_min, k)      # one season, every offensive player

`rows` is {pid: {"min": minutes, "pos": "Guard"|"Wing"|"Big", "v": {key: value}}}, the season's
own card values (Basketball Savant's player-season numbers, never re-derived here). Three parts:

    Scoring   pts (Points / 75), ts (True shooting %)
    Creation  ast (Assist %), potast (Potential assists / 75), astpts75 (Assist points
              created / 75), top75 (Time of possession / 75; left out in 2024-25, when the
              NBA's time of possession runs ~40% long: ext_config.BROKEN_SEASONS)
    Overall   obpm (Offensive BPM) and, from 2025-26, gravity: the average of gravonp and
              gravoni (on-ball perimeter and interior). Off-ball gravity is spacing, not
              creating, and stays out. A player the NBA publishes no gravity for is OBPM alone.

ts is published raw; subtracting the season's league TS% would change no z-score, so it isn't.

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
  4. Each part is pulled toward the league mean (0) by minutes / (minutes + k[part]).
  5. threat = the equal-weight average of the three shrunk parts. A part with no input at
     all counts as 0, the league mean.
"""
import math
import statistics

PARTS = ("score", "create", "overall")
INPUTS = {
    "score": ("pts", "ts"),
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
# k (score 562, create 188, overall 473) times the possession family's factor (1.259) is the
# k_last the page would show; times the family's mean share (0.355) it is k_mean, the k for a
# prior at the mean, which is what this shrinkage is. Nov 17, 2026. k = 500 for every part
# was the fallback and is not needed: against these, the 500+ minute ranking is the same
# (Spearman 0.998) and players under 500 minutes are shrunk about twice as hard.
K = {"score": 251, "create": 84, "overall": 211}
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


def parts_table(rows, season, pool_min, gravity=True):
    """{pid: {part: standardised value or None}} plus {part: {recipe: pool size}}."""
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
        adj = {pid: v / (scale.get(rec[pid]) or base[1]) for pid, v in raw.items()}
        ms = _mean_sd([adj[pid] for pid in inpool])
        for pid in rows:
            out[pid][part] = (adj[pid] - ms[0]) / ms[1] if pid in adj else None
        recipes[part] = sizes
    return out, recipes


def shrink(value, minutes, k):
    return value * minutes / (minutes + k) if value is not None else 0.0


def threat_table(rows, season, pool_min, k=K, gravity=True):
    """{pid: {"score", "create", "overall" (shrunk), "raw": {part: unshrunk}, "threat"}}."""
    P, recipes = parts_table(rows, season, pool_min, gravity)
    out = {}
    for pid, r in rows.items():
        s = {part: shrink(P[pid][part], r["min"], k[part]) for part in PARTS}
        s["raw"] = P[pid]
        s["threat"] = sum(s[part] for part in PARTS) / len(PARTS)
        out[pid] = s
    return out, recipes
