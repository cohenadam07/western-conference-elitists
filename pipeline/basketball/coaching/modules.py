"""
modules.py — from coach-team-seasons to coaches: career figures, the pools they are ranked in,
the style fingerprint and comps, the arrival effect, development against the aging curve, the
coaching tree's suggested mentors, the Leaders boards and the rule-written scouting report.

Every percentile here names its pool:
  season pool   coach-team-seasons of the same season with 41+ games (MIN_SEASON_GAMES)
  career pool   head coaches with 3+ seasons and 150+ games inside the stat's own window

A "how good" stat is graded; a "how much" stat is a tendency. Career values are games-weighted
means of season values, and a season with no value for a stat is left out of the mean (the
count of seasons covered is kept). Nothing is typed in: the fair-minutes line, the projection
from parts and the run-stopping baseline are all fitted here from the seasons' own data, and
each fit is written to the build notes with its sample and its out-of-sample score.
"""
import math
from collections import defaultdict

import numpy as np

import config as CF

AGING = None   # savant_config.AGING, set by build


def pct_rank(pairs):
    """{id: midrank percentile 1..99} for [(id, value)]; the page's own rule."""
    vals = sorted(v for _, v in pairs)
    n = len(vals)
    out = {}
    if n < 2:
        return out
    import bisect
    for i, v in pairs:
        lo = bisect.bisect_left(vals, v); hi = bisect.bisect_right(vals, v)
        p = 100.0 * (lo + 0.5 * (hi - lo)) / n
        out[i] = int(min(99, max(1, round(p))))
    return out


def _g(d, *path):
    for k in path:
        if d is None:
            return None
        d = d.get(k) if isinstance(d, dict) else None
    return d


def season_values(c, lg):
    """{stat key: (value, sample)} for one coach-team-season dict (cts.py), with league context lg."""
    v = {}
    R, M, I, RO, MV, U, NB = (c.get(k) for k in ("results", "management", "identity", "rotation", "mvi", "units", "nba"))
    g = R["g"] if R else 0
    if R:
        v["winpct"] = (R["pct"] * 100 if R["pct"] is not None else None, g)
        v["net"] = (R["net"], g); v["adj_net"] = (R["adj_net"], g)
        v["close_pct"] = (100.0 * R["close_w"] / R["close_g"] if R["close_g"] else None, R["close_g"])
    E = c.get("expect") or {}
    if E.get("w_talent") is not None:
        v["w_talent"] = (E["w_talent"], g)
    if E.get("w_market") is not None:
        v["w_market"] = (E["w_market"], g)
    if E.get("w_spread") is not None:
        v["w_spread"] = (E["w_spread"], E.get("spread_g") or 0)
    sp = _g(c, "splits", "market_n") or {}
    if sp.get("cover") is not None:
        v["ats"] = (100.0 * sp["cover"], sp["games"])
    if RO:
        sc = RO.get("off_script")
        v["stability"] = (100.0 * (1 - sc) if sc is not None else None, RO["games"])
        v["chosen_dev"] = (100.0 * RO["by_cause"]["choice"] if RO["by_cause"].get("choice") is not None else None, RO["games"])
        v["after_loss"] = (100.0 * (RO["after_loss"] - RO["after_win"]) if RO.get("after_loss") is not None and RO.get("after_win") is not None else None, RO["games"])
        v["hot_hand"] = (RO["hot"]["extra_q4"], RO["hot"]["n"])
        sh = RO["shape"]
        v["depth10"] = (sh["depth10"], RO["games"]); v["top5share"] = (100.0 * sh["top5"], RO["games"]); v["starters_min"] = (sh["starters_min"], RO["games"])
        v["spell"] = (sh["spell"], RO["games"]); v["first_sub"] = (sh["first_sub"] / 60.0 if sh.get("first_sub") is not None else None, RO["games"]); v["all_bench"] = (sh["all_bench"], RO["games"])
        cl = RO["closing"]
        v["closes_best"] = (cl.get("gap"), cl.get("gap_n") or 0)
        v["closes_near"] = (100.0 * cl.get("near", 0) / cl["gap_n"] if cl.get("gap_n") else None, cl.get("gap_n") or 0)
        v["sit_q1"] = (RO["sits"]["q1_2"][0] / 60.0 if RO["sits"]["q1_2"][0] is not None else None, RO["sits"]["q1_2"][1])
        if RO.get("overplay") is not None:
            v["overplay"] = (RO["overplay"], RO["games"])
        if RO.get("left_table") is not None:
            v["left_table"] = (RO["left_table"], RO["games"])
    if MV:
        v["youth_share"] = (100.0 * MV["young_min_share"], g); v["rookie_share"] = (100.0 * MV["rookie_min_share"], g)
    if U and U.get("stagger", {}).get("2"):
        v["stagger2"] = (100.0 * U["stagger"]["2"]["apart"], g)
    if M:
        v["to_g"] = (M["to_g"], g); v["to_run"] = (100.0 * M["to_run_share"] if M["to_run_share"] is not None else None, int(round(M["to_g"] * g)))
        v["unused"] = (M["unused_close"], M["close_finishes"])
        v["ato"] = (M["ato_own"], M["ato_own_n"]); v["ato_vs"] = (M["ato_own"] - M["hc_ppp"] if M["ato_own"] is not None and M["hc_ppp"] is not None else None, M["ato_own_n"])
        v["ato_late"] = (M["ato_late"], M["ato_late_n"]); v["ato_d"] = (M["ato_opp"], M["ato_opp_n"])
        v["halftime"] = (M["halftime"] - (lg.get("halftime") or 0.0) if M["halftime"] is not None else None, g)
        # run stopping against the league's matched no-timeout figure
        num = den = 0.0; n = 0
        for size, r in M["runs"].items():
            base = _g(lg, "runs", size)
            if r["to_n"] and r["to_ppp"] is not None and base is not None:
                w = r["to_n"]
                num += w * (r["to_ppp"] - base); den += w; n += r["to_n"]
        v["run_stop"] = (num / den if den else None, n)
        ch = M["challenges"]
        if ch.get("n"):
            v["ch_g"] = (M["ch_g"], g); v["ch_success"] = (100.0 * M["ch_success"] if M["ch_success"] is not None else None, ch["n"]); v["ch_q4"] = (100.0 * ch.get("q4", 0) / ch["n"], ch["n"])
        v["foul_up3"] = (100.0 * M["foul_up3"] if M["foul_up3"] is not None else None, M["foul_up3_n"])
        v["two41"] = (M["two41_g"], g); v["eoq"] = (M["eoq_ppp"], M["eoq_n"]); v["chase"] = (100.0 * M["chase"] if M["chase"] is not None else None, M["chase_n"])
        v["adv_to"] = (M["adv_to"] / g if g else None, g); v["clutch_net"] = (M["clutch_net"], M["clutch_poss"])
    if I:
        v["pace"] = (I["pace"], g); v["sec_poss"] = (I["sec_poss"], g); v["early"] = (100.0 * I["early_share"] if I["early_share"] is not None else None, g)
        v["trans"] = (100.0 * I["trans_share"] if I["trans_share"] is not None else None, g); v["fg3r"] = (100.0 * I["fg3r"] if I["fg3r"] is not None else None, g)
        d = I["diet"]
        v["rim"] = (100.0 * d["ra"][0] if d.get("ra") and d["ra"][0] is not None else None, g); v["mid"] = (100.0 * d["mid"][0] if d.get("mid") and d["mid"][0] is not None else None, g)
        c3, ab3 = (d.get("c3") or [0])[0] or 0, (d.get("ab3") or [0])[0] or 0
        v["c3"] = (100.0 * c3 / (c3 + ab3) if (c3 + ab3) else None, g)
        v["ftr"] = (100.0 * I["ftr"] if I["ftr"] is not None else None, g); v["ast_pct"] = (100.0 * I["ast_pct"] if I["ast_pct"] is not None else None, g)
        v["tov_pct"] = (I["tov_pct"], g); v["orb_pct"] = (100.0 * I["orb_pct"] if I["orb_pct"] is not None else None, g); v["ortg"] = (I["ortg"], g); v["drtg"] = (I["drtg"], g)
        od = I["o_diet"]
        v["o_fg3r"] = (100.0 * I["o_fg3r"] if I["o_fg3r"] is not None else None, g); v["o_rim"] = (100.0 * od["ra"][0] if od.get("ra") and od["ra"][0] is not None else None, g)
        v["o_mid"] = (100.0 * od["mid"][0] if od.get("mid") and od["mid"][0] is not None else None, g); v["o_ftr"] = (100.0 * I["o_ftr"] if I["o_ftr"] is not None else None, g)
        v["o_tov"] = (I["o_tov_pct"], g); v["stl100"] = (I["stl100"], g); v["drb_pct"] = (100.0 * I["drb_pct"] if I["drb_pct"] is not None else None, g)
        v["o_trans"] = (100.0 * I["o_trans_share"] if I["o_trans_share"] is not None else None, g); v["pf100"] = (I["pf100"], g); v["o_efg"] = (100.0 * I["o_efg"] if I["o_efg"] is not None else None, g)
    elif NB and NB.get("stats"):
        s = NB["stats"]
        v["pace"] = (s["pace"], g); v["fg3r"] = (100.0 * s["fg3r"], g); v["ftr"] = (100.0 * s["ftr"] if s["ftr"] is not None else None, g); v["ast_pct"] = (100.0 * s["ast_pct"] if s["ast_pct"] is not None else None, g)
        v["tov_pct"] = (100.0 * s["tov"] if s["tov"] is not None else None, g); v["orb_pct"] = (100.0 * s["orb"] if s["orb"] is not None else None, g); v["ortg"] = (s["ortg"], g); v["drtg"] = (s["drtg"], g)
        v["o_fg3r"] = (100.0 * s["o_fg3r"], g); v["o_ftr"] = (100.0 * s["o_ftr"] if s["o_ftr"] is not None else None, g); v["o_tov"] = (100.0 * s["o_tov"] if s["o_tov"] is not None else None, g)
        v["drb_pct"] = (100.0 * (1 - s["o_orb"]) if s["o_orb"] is not None else None, g); v["o_efg"] = (100.0 * s["o_efg"] if s["o_efg"] is not None else None, g)
        v["pf100"] = (100.0 * s["pf"] / s["poss"] if s.get("pf") and s.get("poss") else None, g)
    if NB:
        t, h = NB.get("tracking") or {}, NB.get("hustle") or {}
        if t:
            v["passes"] = (t["passes100"], g); v["sec_touch"] = (t["sec_per_touch"], g); v["drives"] = (t["drives100"], g); v["pullup"] = (100.0 * t["pullup_share"] if t["pullup_share"] is not None else None, g)
            v["hub"] = (sum(x for x in (t["elbow100"], t["post100"], t["paint100"]) if x is not None) if any(x is not None for x in (t["elbow100"], t["post100"], t["paint100"])) else None, g)
        if h:
            v["screen_ast"] = (h["screen_ast100"], g); v["off_box"] = (h["off_box100"], g); v["defl"] = (h["defl100"], g); v["charges"] = (h["charges100"], g)
        sw = NB.get("switches") or {}
        if sw.get("switch100") is not None:
            v["switch100"] = (sw["switch100"], sw.get("games") or 0)
    D = c.get("development") or {}
    if D.get("aging") is not None:
        v["aging"] = (D["aging"], int(D["aging_w"])); v["aging_young"] = (D["aging_young"], int(D["aging_young_w"] or 0))
    S = c.get("splits") or {}
    net_all = R["net"] if R else None
    def gap(split, bucket, base=None):
        b = (S.get(split) or {}).get(bucket)
        if not b or b.get("net") is None:
            return (None, 0)
        ref = net_all if base is None else ((S.get(split) or {}).get(base) or {}).get("net")
        return ((b["net"] - ref) if ref is not None else None, b["g"])
    v["gap_top10"] = gap("opp_tier", "top10"); v["gap_b2b"] = gap("rest", "b2b"); v["gap_road"] = gap("home", "away", "home"); v["gap_missing"] = gap("missing", "5+", "none")
    tr = (S.get("half") or {}).get("trailing")
    v["gap_trail"] = (c.get("trail_second_half"), tr["g"] if tr else 0)
    tc = S.get("tempo") or {}
    v["tempo_ctl"] = (100.0 * tc["toward_own"] if tc.get("toward_own") is not None else None, tc.get("n") or 0)
    mk = S.get("market") or {}
    v["gap_fav"] = (c.get("fav_vs_dog"), min((mk.get("favoured") or {}).get("g", 0), (mk.get("underdog") or {}).get("g", 0)))
    return {k: (round(a, 4) if isinstance(a, float) else a, b) for k, (a, b) in v.items() if a is not None and not (isinstance(a, float) and math.isnan(a))}


def league_context(all_cts):
    """What the season's coaches did on average, for the stats compared against the league."""
    out = {}
    hs = [c["management"]["halftime"] for c in all_cts if c.get("management") and c["management"]["halftime"] is not None]
    out["halftime"] = sum(hs) / len(hs) if hs else 0.0
    runs = defaultdict(lambda: [0.0, 0])
    for c in all_cts:
        for size, r in (c.get("management") or {}).get("runs", {}).items():
            if r["no_n"] and r["no_ppp"] is not None:
                runs[size][0] += r["no_ppp"] * r["no_n"]; runs[size][1] += r["no_n"]
    out["runs"] = {k: v[0] / v[1] for k, v in runs.items() if v[1]}
    return out


def season_percentiles(cts_values, games):
    """{(team, coach): {key: pct}} among coach-team-seasons with enough games."""
    by_key = defaultdict(list)
    for k, vals in cts_values.items():
        if games.get(k, 0) < CF.MIN_SEASON_GAMES:
            continue
        for key, (val, n) in vals.items():
            s = CF.BY_KEY.get(key)
            if not s or n < s["thr"]:
                continue
            by_key[key].append((k, -val if s["lower"] else val))
    out = defaultdict(dict)
    for key, pairs in by_key.items():
        for k, p in pct_rank(pairs).items():
            out[k][key] = p
    return out


def career(coach_cts, values):
    """Games-weighted career values over a coach's coach-team-seasons: {key: (value, games, seasons)}."""
    acc = defaultdict(lambda: [0.0, 0.0, set()])
    for (season, team, slug), vals in coach_cts:
        g = max(1, values.get((season, team, slug), {}).get("winpct", (None, 0))[1])
        for key, (val, n) in values.get((season, team, slug), {}).items():
            s = CF.BY_KEY.get(key)
            if not s:
                continue
            w = n if key in ("hot_hand", "closes_best", "sit_q1", "ato", "ato_vs", "ato_late", "ato_d", "run_stop", "ch_success", "ch_q4", "foul_up3", "eoq", "chase", "clutch_net", "aging", "aging_young", "to_run", "unused") else g
            if w <= 0:
                continue
            acc[key][0] += val * w; acc[key][1] += w; acc[key][2].add(season)
    return {k: (round(v[0] / v[1], 4), int(v[1]), len(v[2])) for k, v in acc.items() if v[1] > 0}


def career_percentiles(careers, eligible):
    """{slug: {key: pct}} among eligible coaches, per stat, requiring the stat's settle point."""
    by_key = defaultdict(list)
    for slug, cv in careers.items():
        if slug not in eligible:
            continue
        for key, (val, n, ns) in cv.items():
            s = CF.BY_KEY[key]
            if n < s["thr"]:
                continue
            by_key[key].append((slug, -val if s["lower"] else val))
    out = defaultdict(dict)
    pools = {}
    for key, pairs in by_key.items():
        pools[key] = len(pairs)
        for slug, p in pct_rank(pairs).items():
            out[slug][key] = p
    return out, pools


# ---------------------------------------------------------------- fingerprint and comps
def fingerprints(season_pcts, coach_cts, games):
    """Career fingerprint: games-weighted mean of season percentiles on the tendency tracks."""
    fp = {}
    for slug, keys in coach_cts.items():
        acc = defaultdict(lambda: [0.0, 0.0])
        for k in keys:
            g = games.get(k, 0)
            for t in CF.FINGERPRINT:
                p = season_pcts.get(k, {}).get(t)
                if p is not None:
                    acc[t][0] += p * g; acc[t][1] += g
        fp[slug] = {t: round(v[0] / v[1], 1) for t, v in acc.items() if v[1]}
    return fp


def comps(fp, eligible, k=5, min_tracks=10):
    """Nearest coaches on the fingerprint, with 'closer than X% of pairs'."""
    slugs = sorted(s for s in eligible if len(fp.get(s, {})) >= min_tracks)   # sorted: a set's order changes with the hash seed, and the pair key below assumes a < b
    dist = {}
    for i, a in enumerate(slugs):
        for b in slugs[i + 1:]:
            shared = [t for t in CF.FINGERPRINT if t in fp[a] and t in fp[b]]
            if len(shared) < min_tracks:
                continue
            d = math.sqrt(sum((fp[a][t] - fp[b][t]) ** 2 for t in shared) / len(shared))
            dist[(a, b)] = d
    alld = sorted(dist.values())
    import bisect
    def closer(d):
        return round(100.0 * (len(alld) - bisect.bisect_left(alld, d)) / len(alld), 1) if alld else None
    out = {}
    for a in slugs:
        rows = []
        for b in slugs:
            if a == b:
                continue
            d = dist.get((a, b) if a < b else (b, a))
            if d is not None:
                rows.append((d, b))
        rows.sort()
        out[a] = [[b, round(d, 1), closer(d)] for d, b in rows[:k]]
    return out, dist, closer


# ---------------------------------------------------------------- development
def aging_expected(age):
    if not AGING or age is None:
        return None
    lo, hi = AGING["fit"]
    a = min(hi, max(lo, age))
    c = AGING["impact"]["coef"]
    return sum(cc * a ** i for i, cc in enumerate(c))


def development(season, roster_minutes, archive_now, archive_prev):
    """For one coach-team-season: Σ w (Δ impact − expected) / Σ w over players with 500+ minutes both
    seasons, in the aging curve's own currency: the position-adjusted BPM percentile (archive.bpm_pct),
    the number savant_config.AGING was fitted on. roster_minutes: {pid: minutes under this coach}."""
    num = den = 0.0; ny = dy = 0.0; rows = []
    for pid, mins in roster_minutes.items():
        a, b = archive_prev.get(pid), archive_now.get(pid)
        if not a or not b or a.get("bpm_pct") is None or b.get("bpm_pct") is None:
            continue
        if (a.get("min") or 0) < 500 or (b.get("min") or 0) < 500 or mins < 300:
            continue
        if a.get("pos") != b.get("pos"):
            continue                                    # the pool changed under him: the delta is meaningless
        age = b.get("age")
        exp = aging_expected(age)
        if exp is None:
            continue
        d = b["bpm_pct"] - a["bpm_pct"]
        w = min(a["min"], b["min"], mins * 1.0)
        num += w * (d - exp); den += w
        if age is not None and age <= 24.5:
            ny += w * (d - exp); dy += w
        rows.append([pid, round(age, 1) if age else None, round(a["bpm_pct"], 1), round(b["bpm_pct"], 1), round(exp, 2), int(w)])
    rows.sort(key=lambda r: -(r[3] - r[2] - r[4]))
    return dict(aging=round(num / den, 3) if den else None, aging_w=den, aging_young=round(ny / dy, 3) if dy else None, aging_young_w=dy, players=rows[:12] + (rows[-4:] if len(rows) > 16 else []))


# ---------------------------------------------------------------- fair minutes and the projection from parts
def fair_minutes_line(archive_now):
    """MPG by BPM, the league that season: binned means (1 BPM wide) over players with 200+ minutes, monotone-smoothed."""
    bins = defaultdict(list)
    for p in archive_now.values():
        if p.get("bpm") is None or p.get("mpg") is None or (p.get("min") or 0) < 200:
            continue
        bins[int(math.floor(p["bpm"]))].append(p["mpg"])
    xs = sorted(bins)
    if not xs:
        return None
    line = {}
    run = 0.0
    for x in xs:
        m = sum(bins[x]) / len(bins[x])
        run = max(run, m) if len(bins[x]) >= 5 else max(run, m * 0.5 + run * 0.5)
        line[x] = run
    def fair(bpm):
        if bpm is None:
            return None
        b = int(math.floor(bpm))
        if b in line:
            return line[b]
        return line[xs[0]] if b < xs[0] else line[xs[-1]]
    return fair


def overplay(rot_rows, impact, fair):
    """Minutes per game above the fair line, summed over the men above it (rotation.py rows)."""
    if not fair:
        return None
    tot = 0.0
    for r in rot_rows:
        b = impact.get(r["id"])
        f = fair(b)
        if b is None or f is None:
            continue
        tot += max(0.0, r["mpg"] - f) * r["gp"]
    games = max((r["gp"] for r in rot_rows), default=0)
    return round(tot / games, 2) if games else None


def fit_parts(all_units, log=print):
    """Luck-adjusted unit net on Σ BPM, possession-weighted, leave-one-season-out, plus the archetype pairings that replicate.
    all_units: [(season, unit dict with adj, poss, sum_bpm, arch)]"""
    rows = [(s, u) for s, u in all_units if u.get("sum_bpm") is not None and u["poss"] >= 100]
    if len(rows) < 200:
        return None
    seasons = sorted({s for s, _ in rows})
    pair_keys = ["big+big", "big+shooter", "creator+creator", "creator+shooter", "pass+pass", "guard+guard"]

    def pairs_of(arch):
        bigs = sum(1 for a in arch if a in ("Rim-Running Big", "Role Big"))
        shooters = sum(1 for a in arch if a in ("Movement Shooter", "3&D Role Player"))
        creators = sum(1 for a in arch if a == "Jumbo Creator")
        passers = sum(1 for a in arch if a == "Pass-First Guard")
        guards = sum(1 for a in arch if a in ("Combo Guard", "Pass-First Guard"))
        return [1.0 if bigs >= 2 else 0.0, 1.0 if bigs >= 1 and shooters >= 2 else 0.0, 1.0 if creators >= 2 else 0.0,
                1.0 if creators >= 1 and shooters >= 2 else 0.0, 1.0 if passers >= 2 else 0.0, 1.0 if guards >= 3 else 0.0]

    def design(items, with_pairs):
        X = []
        for s, u in items:
            row = [1.0, u["sum_bpm"]]
            if with_pairs:
                row += pairs_of(u.get("arch") or []) if len(u.get("arch") or []) == 5 else [0.0] * len(pair_keys)
            X.append(row)
        return np.array(X)

    def oos(with_pairs):
        res = []
        for s in seasons:
            tr = [r for r in rows if r[0] != s]; te = [r for r in rows if r[0] == s]
            if not te:
                continue
            X, y, w = design(tr, with_pairs), np.array([u["adj"] for _, u in tr]), np.sqrt(np.array([u["poss"] for _, u in tr]))
            beta = np.linalg.lstsq(X * w[:, None], y * w, rcond=None)[0]
            Xt = design(te, with_pairs)
            res += list(zip([u["adj"] for _, u in te], Xt @ beta, [u["poss"] for _, u in te]))
        r = np.array(res)
        wt = r[:, 2]
        mean = np.average(r[:, 0], weights=wt)
        return 1 - np.average((r[:, 0] - r[:, 1]) ** 2, weights=wt) / np.average((r[:, 0] - mean) ** 2, weights=wt)
    r2_base = oos(False)
    X, y, w = design(rows, True), np.array([u["adj"] for _, u in rows]), np.sqrt(np.array([u["poss"] for _, u in rows]))
    beta_full = np.linalg.lstsq(X * w[:, None], y * w, rcond=None)[0]
    r2_pairs = oos(True)
    Xb = design(rows, False)
    beta = np.linalg.lstsq(Xb * w[:, None], y * w, rcond=None)[0]
    # The projection is talent only. The lineup pairings are tested in pairings.py the way the lineup
    # fit study did (team-season fixed effects, clustered errors, discover on even seasons and
    # replicate on odd), and a pairing joins the projection only if it replicates there. The
    # archetype pairings below are kept as a diagnostic (their out-of-sample R² is reported), never used.
    keep_pairs = False
    model = dict(a=round(float(beta_full[0] if keep_pairs else beta[0]), 3), b=round(float(beta_full[1] if keep_pairs else beta[1]), 3),
                 pairs={k: round(float(v), 2) for k, v in zip(pair_keys, beta_full[2:])} if keep_pairs else {},
                 oos_r2_talent=round(float(r2_base), 4), oos_r2_with_pairs=round(float(r2_pairs), 4), n=len(rows), seasons=[seasons[0], seasons[-1]],
                 note="Projection = a + b × Σ BPM. build.py adds the lineup pairings that replicated in pairings.py (team-season fixed effects, clustered errors), if any; see meta.fits.pairings.")
    model["_pairs_of"] = pairs_of
    log(f"fit_parts: {len(rows)} units, OOS R² talent {r2_base:.3f}, with pairs {r2_pairs:.3f} -> {'kept' if keep_pairs else 'dropped'}")
    return model


def project(model, u):
    if not model or u.get("sum_bpm") is None:
        return None
    p = model["a"] + model["b"] * u["sum_bpm"]
    if model["pairs"] and len(u.get("arch") or []) == 5:
        for k, w in zip(model["pairs"].keys(), model["_pairs_of"](u["arch"])):
            p += model["pairs"][k] * w
    return round(p, 1)


# ---------------------------------------------------------------- tree
def suggest_mentors(coaches, tenures, staff):
    """For every coach: the head coaches he served under, by seasons; the suggestion is the most seasons,
    ties broken by the last one before his first head job."""
    head_by_ts = defaultdict(set)
    for t in tenures:
        head_by_ts[(t["season"], t["team"])].add(t["coach"])
    out = {}
    for slug, c in coaches.items():
        first_hc = min((r["season"] for r in c["hc"]), default=None)
        served = defaultdict(lambda: [0, None, set()])
        stints = [(r["season"], r["franchise"], r["role"]) for r in c["ast"] if r.get("franchise")]
        for season, teams_ in staff.items():
            for fr, rows in teams_.items():
                for r in rows:
                    if r.get("id") == slug:
                        stints.append((season, fr, r["role"]))
        for season, fr, role in set(stints):
            for h in head_by_ts.get((season, fr), ()):
                if h == slug:
                    continue
                # before his first head job counts double for the tie-break
                served[h][0] += 1; served[h][2].add(season)
                if first_hc is None or season < first_hc:
                    served[h][1] = max(served[h][1] or "", season)
        if not served:
            out[slug] = dict(mentor=None, also=[], under=[])
            continue
        ranked = sorted(served.items(), key=lambda kv: (-kv[1][0], kv[1][1] or "", kv[0]))
        mentor = ranked[0][0]
        tie = len(ranked) > 1 and ranked[1][1][0] == ranked[0][1][0]
        out[slug] = dict(mentor=mentor, seasons=ranked[0][1][0], tie=tie, also=[[h, v[0]] for h, v in ranked[1:4] if v[0] >= 2],
                         under=[[h, v[0], sorted(v[2])] for h, v in ranked])
    return out


# ---------------------------------------------------------------- scouting report
def scouting(career_vals, career_pct, pools, name):
    lines = []
    for group in CF.GROUPS:
        cands = []
        for s in CF.STATS:
            if s["group"] != group or s["key"] not in career_pct:
                continue
            p = career_pct[s["key"]]
            val, n, ns = career_vals[s["key"]]
            if p >= 85 or p <= 15:
                cands.append((abs(p - 50), s, p, val, n, ns))
        cands.sort(key=lambda x: -x[0])
        for _, s, p, val, n, ns in cands[:2]:
            how = ("among the most" if p >= 85 else "among the least") if s["kind"] == "much" else ("among the best" if p >= 85 else "among the worst")
            lines.append(dict(group=group, key=s["key"], text=f"{s['label']}: {how} in the pool ({p}th percentile of {pools.get(s['key'], 0)} coaches), over {ns} season{'s' if ns != 1 else ''}.", pct=p))
    return lines
