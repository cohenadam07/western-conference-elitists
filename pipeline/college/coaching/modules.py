"""
modules.py — careers and pools, percentiles, fingerprints and comps, mentor suggestions, scouting lines.

Basketball Coaching Savant's modules.py, function for function where the logic is the same (pct_rank,
season and career percentiles, fingerprints, comps, the scouting report), copied rather than imported
because both import a module called `config`. What differs for college is said where it differs.
"""
import bisect
import math
from collections import defaultdict

import config as CF

# stats whose career value is weighted by their own sample, not by games
SAMPLE_WEIGHTED = {"close_pct", "closes_best", "closes_near", "sit_h1", "to_media", "to_run", "unused", "run_stop", "ato", "ato_vs", "ato_late",
                   "ato_d", "ch_success", "foul_up3", "eoh", "chase", "clutch_net", "dev", "dev_young", "dev_hs", "dev_tr", "ppp_stl", "ppp_dreb",
                   "ppp_made", "portal_hit", "recruit_hit", "t_seed", "t_prob", "gap_q1", "gap_road", "gap_conf", "gap_missing", "gap_trail", "gap_fav", "gap_march"}
SUMMED = {"w_roster", "w_spread", "w_resources"}      # career: per 30 games, and the raw sum beside it


def pct_rank(pairs):
    """{id: midrank percentile 1..99} for [(id, value)]."""
    vals = sorted(v for _, v in pairs)
    n = len(vals)
    out = {}
    if n < 2:
        return out
    for i, v in pairs:
        lo = bisect.bisect_left(vals, v)
        hi = bisect.bisect_right(vals, v)
        out[i] = int(min(99, max(1, round(100.0 * (lo + 0.5 * (hi - lo)) / n))))
    return out


def season_percentiles(values, games, live=False, pools=None, need=None):
    """{key: pct} per coach-team-season among those with enough games; live: the season in progress,
    ranked provisionally with a quarter of each settle point."""
    by_key = defaultdict(list)
    need = (CF.MIN_LIVE_GAMES if live else CF.MIN_SEASON_GAMES) if need is None else need
    for k, vals in values.items():
        if games.get(k, 0) < need:
            continue
        for key, (val, n) in vals.items():
            s = CF.BY_KEY.get(key)
            if not s or val is None or n < (max(1, s["thr"] // 4) if live else s["thr"]):
                continue
            by_key[key].append((k, -val if s["lower"] else val))
    out = defaultdict(dict)
    for key, pairs in by_key.items():
        if pools is not None:
            pools[key] = len(pairs)
        for k, p in pct_rank(pairs).items():
            out[k][key] = p
    return out


def career(rows):
    """rows: [(values, games)] of one coach's coach-team-seasons -> {key: (value, n, seasons)}."""
    acc = defaultdict(lambda: [0.0, 0.0, 0, 0.0])
    for vals, g in rows:
        for key, (val, n) in vals.items():
            if key not in CF.BY_KEY or val is None:
                continue
            a = acc[key]
            if key in SUMMED:
                a[0] += val; a[1] += n; a[2] += 1; a[3] += val
                continue
            w = n if key in SAMPLE_WEIGHTED else max(1, g)
            if CF.BY_KEY[key]["thr"] == 1:          # one per season (roster building, resources)
                w = 1
            a[0] += val * w; a[1] += w; a[2] += 1
            a[3] += n if CF.BY_KEY[key]["thr"] != 1 else 1
    out = {}
    for k, (s, w, ns, n) in acc.items():
        if not w:
            continue
        if k in SUMMED:
            out[k] = (round(30.0 * s / w, 4), int(w), ns, round(s, 2))     # per 30 games, games, seasons, raw sum
        else:
            out[k] = (round(s / w, 4), int(round(n)), ns)
    return out


def career_percentiles(careers, eligible):
    by_key = defaultdict(list)
    for cid, cv in careers.items():
        if cid not in eligible:
            continue
        for key, x in cv.items():
            s = CF.BY_KEY[key]
            thr = s["thr"] if s["thr"] > 1 else 3          # one-per-season stats need three seasons in a career
            n = x[2] if s["thr"] == 1 else x[1]
            if n < thr or (key in SUMMED and x[2] < 3):     # a summed expectation needs three seasons of its own
                continue
            by_key[key].append((cid, -x[0] if s["lower"] else x[0]))
    out, pools = defaultdict(dict), {}
    for key, pairs in by_key.items():
        pools[key] = len(pairs)
        for cid, p in pct_rank(pairs).items():
            out[cid][key] = p
    return out, pools


def fingerprints(season_pcts, coach_keys, games):
    fp = {}
    for cid, keys in coach_keys.items():
        acc = defaultdict(lambda: [0.0, 0.0])
        for k in keys:
            g = games.get(k, 0)
            for t in CF.FINGERPRINT:
                p = season_pcts.get(k, {}).get(t)
                if p is not None:
                    acc[t][0] += p * g; acc[t][1] += g
        fp[cid] = {t: round(v[0] / v[1], 1) for t, v in acc.items() if v[1]}
    return fp


def comps(fp, eligible, k=5, min_tracks=CF.MIN_TRACKS):
    ids = sorted(s for s in eligible if len(fp.get(s, {})) >= min_tracks)
    dist = {}
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            shared = [t for t in CF.FINGERPRINT if t in fp[a] and t in fp[b]]
            if len(shared) < min_tracks:
                continue
            dist[(a, b)] = math.sqrt(sum((fp[a][t] - fp[b][t]) ** 2 for t in shared) / len(shared))
    alld = sorted(dist.values())

    def closer(d):
        return round(100.0 * (len(alld) - bisect.bisect_left(alld, d)) / len(alld), 1) if alld else None
    out = {}
    for a in ids:
        rows = sorted((d, b) for (x, y), d in dist.items() for b in ((y,) if x == a else (x,) if y == a else ()))
        out[a] = [[b, round(d, 1), closer(d)] for d, b in rows[:k]]
    return out, dist, closer


def suggest_mentors(stints_by_coach, head_of, first_hc):
    """stints_by_coach: {coach id: [(season, team, role, source)]} assistant stints; head_of(season, team)
    -> [coach ids]; first_hc: {coach id: first D1 head season}. The mentor is the D1 head coach he served
    under most seasons before his first head job, ties broken by the later stint and flagged."""
    out = {}
    for cid, stints in stints_by_coach.items():
        fh = first_hc.get(cid)
        served = defaultdict(lambda: [0, "", set(), set()])
        later = defaultdict(lambda: [0, set()])
        for season, team, role, src in set(stints):
            for h in head_of(season, team):
                if h == cid:
                    continue
                if fh is not None and season >= fh:
                    later[h][0] += 1; later[h][1].add(season)
                    continue
                x = served[h]
                x[0] += 1; x[1] = max(x[1], season); x[2].add(season); x[3].add(src)
        later_rows = [[h, v[0], sorted(v[1])] for h, v in sorted(later.items(), key=lambda kv: (-kv[1][0], kv[0]))]
        if not served:
            out[cid] = dict(mentor=None, also=[], under=[], later=later_rows)
            continue
        # most seasons first; a tie goes to the later stint, then the id
        ranked = sorted(served.items(), key=lambda kv: (-kv[1][0], [-ord(c) for c in kv[1][1]], kv[0]))
        top = ranked[0]
        tie = len(ranked) > 1 and ranked[1][1][0] == top[1][0]
        out[cid] = dict(mentor=top[0], seasons=top[1][0], tie=tie, sources=sorted(top[1][3]),
                        also=[[h, v[0]] for h, v in ranked[1:4] if v[0] >= 1],
                        under=[[h, v[0], sorted(v[2])] for h, v in ranked], later=later_rows)
    return out


def ordinal(n):
    n = int(n)
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def _line(s, p, how_word, tail):
    how = ("among the most" if p >= 85 else "among the least") if s["kind"] == "much" else ("among the best" if p >= 85 else "among the worst")
    return f"{s['label']}: {how} {how_word} ({ordinal(p)} percentile{tail})"


def scouting(career_vals, career_pct, pools):
    lines = []
    for group in CF.GROUPS:
        cands = []
        for s in CF.STATS:
            if s["group"] != group or s["key"] not in career_pct:
                continue
            p = career_pct[s["key"]]
            if p >= 85 or p <= 15:
                cands.append((abs(p - 50), s, p, career_vals[s["key"]]))
        cands.sort(key=lambda x: -x[0])
        for _, s, p, x in cands[:2]:
            ns = x[2]
            lines.append(dict(group=group, key=s["key"], pct=p, value=x[0], n=x[1],
                              text=_line(s, p, "in the pool", f" of {pools.get(s['key'], 0)} coaches") + f", over {ns} season{'s' if ns != 1 else ''}."))
    return lines


def scouting_season(values, pct, pools, season):
    """The season, written by rule: in each group the two rows furthest from the middle (85th and up,
    15th and down), each with its value, its pool and its sample, and a warning under the settle point."""
    lines = []
    for group in CF.GROUPS:
        cands = []
        for s in CF.STATS:
            k = s["key"]
            if s["group"] != group or k not in pct or k not in values:
                continue
            val, n = values[k]
            p = pct[k]
            if val is None or n < max(1, s["thr"] // 4):
                continue
            if p >= 85 or p <= 15:
                cands.append((abs(p - 50), s, p, val, n))
        cands.sort(key=lambda x: -x[0])
        for _, s, p, val, n in cands[:2]:
            how = ("among the most" if p >= 85 else "among the least") if s["kind"] == "much" else ("among the best" if p >= 85 else "among the worst")
            shown = (f"{val:+.1f}" if s["unit"].startswith("sgn") else f"{val:.1f}{'%' if s['unit'] == 'pct1' else ''}")
            settled = n >= s["thr"]
            unit = "games" if s["thr"] in (CF.G, CF.S) else "in the sample"
            lines.append(dict(group=group, key=k, pct=p, value=val, n=n, settled=settled,
                              text=f"{s['label']}: {shown}, {how} of {pools.get(k, 0)} coaches in {season} ({ordinal(p)} percentile), over {n:,} {unit}"
                                   + ("." if settled else f"; it settles at {s['thr']:,}, so this can still move.")))
    return lines
