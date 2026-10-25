"""
gen_historical_comps.py — attach statistical comps to pre-1996 player-seasons, per season,
against that season's own qualified pool (era-relative, matching the locked decision).

Same 9-dim vector and same distance/match%-calibration as the live current-season comps
(reuses savant_engine.COMP_DIMS / comp_dist / _pct_rank and the calibration anchors), so a
1986 Bird's neighbours are computed the exact way a 2026 player's are — just within 1986.

    python gen_historical_comps.py     # rewrites comps onto pre-1996 seasons in out/players.json
"""
import json, os, math
import br_fetch as BR
import br_normalize as N
import br_crosswalk as X
import savant_engine as E

OUT = os.path.join("out", "players.json")

def _raw_vec(r, env):
    """The 9 raw comp dims for one BR player row (same definitions as comp_vectors)."""
    fga = r.get("fga") or 0; fg3a = r.get("fg3a") or 0; fg3m = r.get("fg3m") or 0
    fta = r.get("fta") or 0; pts = r.get("pts") or 0; tov = r.get("tov") or 0
    blk = r.get("blk") or 0; mp = r.get("min") or 0
    tsa = fga + 0.44 * fta
    tenv = env.get(r.get("team"), {}) or {}
    tm_mp5 = (tenv.get("tm_mp") or 0) / 5.0
    opp2a = (tenv.get("opp_fga") or 0) - (tenv.get("opp_fg3a") or 0)
    return {
        "usg":   r.get("br_usg"),
        "ts":    (pts / (2 * tsa)) if tsa > 0 else None,
        "tp3":   (100 * fg3m / fg3a) if fg3a >= E.COMP_TP3_MIN_ATT else None,
        "3par":  (100 * fg3a / fga) if fga > 0 else None,
        "ftr":   (100 * fta / fga) if fga > 0 else None,
        "ast":   r.get("br_ast"),
        "tov":   (100 * tov / (fga + 0.44 * fta + tov)) if (fga + 0.44 * fta + tov) > 0 else None,
        "oreb":  r.get("br_orb"),
        "dreb":  r.get("br_drb"),
        "blkpct": (100 * blk * tm_mp5 / (mp * opp2a)) if (mp > 0 and opp2a > 0) else None,
    }

def _season_comps(end_year, id_of, name_of, team_of):
    """{canonical_id: comps-list} for one BR season, or {} if the pool is too small."""
    players = BR.load_season(end_year)
    env = BR.load_team_env(end_year)
    raw = {}
    for bid, r in players.items():
        if (r.get("min") or 0) < E.COMP_MIN_MINUTES:
            continue
        cid = id_of(bid, r.get("name", ""))
        raw[cid] = _raw_vec(r, env)
    if len(raw) < 4:
        return {}
    pct = {dim: E._pct_rank([(cid, raw[cid][dim]) for cid in raw]) for dim in E.COMP_DIMS}
    vec = {cid: {dim: pct[dim].get(cid) for dim in E.COMP_DIMS} for cid in raw}
    pids = list(vec.keys())

    nearest = {}
    for a in pids:
        ds = [(dd, b) for b in pids if b != a for dd in (E.comp_dist(vec, a, b),) if dd is not None]
        ds.sort(key=lambda x: x[0])
        nearest[a] = ds[:3]

    best = sorted(ds[0][0] for ds in nearest.values() if ds)
    if not best:
        return {}
    q = lambda f: best[min(len(best) - 1, max(0, int(f * len(best))))]
    d95, d_mid = q(E.COMP_RARE_FRAC), q(0.50)
    if d_mid <= d95: d_mid = d95 + 1.0
    slope = (95.0 - 80.0) / (d_mid - d95)
    score = lambda dd: max(1, min(99, round(95.0 - (dd - d95) * slope)))

    out = {}
    for a in pids:
        out[a] = [{"id": b, "name": name_of(b), "team": team_of(b), "score": score(dd)}
                  for dd, b in nearest[a]]
    return out

def build():
    payload = json.load(open(OUT))
    # canonical id + identity lookups consistent with the merge
    idcache = {}
    def id_of(bid, name):
        if bid not in idcache:
            idcache[bid] = X.canonical_id(bid, name)
        return idcache[bid]

    attached = 0
    for ey in BR.BR_END_YEARS:
        season = BR.season_label(ey)
        entries = {p["id"]: p for p in payload["data"].get(season, {}).get("players", [])}
        name_of = lambda cid: (entries.get(cid, {}) or {}).get("name", "")
        team_of = lambda cid: (entries.get(cid, {}) or {}).get("team", "")
        comps = _season_comps(ey, id_of, name_of, team_of)
        for cid, cl in comps.items():
            if cid in entries:
                entries[cid]["comps"] = cl
                attached += 1
    import safe_io; safe_io.dump_json(OUT, payload)
    print(f"attached comps to {attached} pre-1996 player-seasons")

if __name__ == "__main__":
    build()
