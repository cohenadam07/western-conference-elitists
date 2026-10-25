"""
br_normalize.py — turn cached Basketball Reference seasons (1979-80 → 1995-96) into
player-season entries in the *exact* site schema, computed through the site's OWN engine.

Parity by construction: BR totals are loaded into DataFrames whose columns are the
engine's logical box/adv names, then run through `savant_engine.derive_box` — the same
function the 1996+ nba_api pipeline uses. So a 1985 TS%/PTS-75/Game-Score and a 2025 one
come out of identical code. The only era-specific input is POSS, estimated pre-1996 as
`Pace × MP / 48` (BR has no tracked possessions).

BR's precomputed advanced columns are used two ways, both non-authoritative for the box
bars: (1) the model-estimate value bars (PER/WS-48/BPM/VORP) are taken from BR directly —
nba_api has no equivalent and they're BR's signature metric; (2) the recomputed rate bars
(TS%, eFG%, 3PAr, FTr, TOV%) are cross-checked against BR's columns and any diff beyond a
rounding tolerance is logged.

The %-family denominators-requiring bars (AST%/USG%/ORB%/DRB%) are taken from BR's
precomputed columns — the pre-1996 analogue of the nba_api server values the live site
uses for 1996+ (per the locked "formula pre-1996 / server 1996+" decision).

Entries here are keyed by BR player id; br_crosswalk.py remaps them to canonical NBA
person-ids and merges cross-1996 careers.
"""
import sys
import pandas as pd
import br_fetch as BR
import savant_config as C
import savant_engine as E

# BR value bars taken directly (model estimates — labelled as such in the UI).
BR_VALUE = {"per": "per", "ws48": "ws48", "bpm": "bpm", "obpm": "obpm", "dbpm": "dbpm", "vorp": "vorp"}

# recomputed-vs-BR cross-check: our metric key -> (BR column, BR is fraction?, our scale)
XCHECK = {
    "ts":   ("br_ts",   True,  1.0),    # both fractions
    "efg":  ("br_efg_pct", True, 1.0),
    "tp3r": ("br_3par", True,  0.01),   # our tp3r is % (47.6) -> *0.01 to compare to BR fraction
    "ftr":  ("br_ftr",  True,  0.01),
    "tov":  ("br_tov",  False, 1.0),    # both percentages
}

def _pos_bucket(brpos):
    """BR position (PG/SG/SF/PF/C, incl combos) -> site Guard/Wing/Big via the site's own
    bucketer, by first reducing to a G/F/C letter it understands."""
    p = (brpos or "").upper().split("-")[0]
    letter = {"PG": "G", "SG": "G", "SF": "F", "PF": "F", "C": "C", "G": "G", "F": "F"}.get(p, "F")
    return C.position_bucket(letter)

def _frames(players, env):
    """Build engine-shaped box+adv DataFrames (indexed by BR id) from a season's BR players.
    POSS = team Pace × player MP / 48 (traded players use their max-MP team's pace)."""
    box_rows, adv_rows = {}, {}
    for bid, r in players.items():
        mp = r.get("min") or 0
        if not r.get("gp"):
            continue
        team = r.get("team")
        pace = (env.get(team, {}) or {}).get("pace")
        poss = (pace * mp / 48.0) if (pace and mp) else 0.0
        box_rows[bid] = {
            "gp": r.get("gp"), "min": mp,
            "fgm": r.get("fgm"), "fga": r.get("fga"), "fg3m": r.get("fg3m"), "fg3a": r.get("fg3a"),
            "ftm": r.get("ftm"), "fta": r.get("fta"), "pts": r.get("pts"), "tov": r.get("tov"),
            "stl": r.get("stl"), "blk": r.get("blk"), "ast": r.get("ast"), "reb": r.get("trb"),
            "oreb": r.get("orb"), "dreb": r.get("drb"), "pf": r.get("pf"),
        }
        adv_rows[bid] = {
            "poss": poss,
            # BR percentages (25.3) -> nba_api's 0-1 convention that derive_box expects
            "ast_pct":  (r["br_ast"] / 100.0) if r.get("br_ast") is not None else None,
            "usg_pct":  (r["br_usg"] / 100.0) if r.get("br_usg") is not None else None,
            "oreb_pct": (r["br_orb"] / 100.0) if r.get("br_orb") is not None else None,
            "dreb_pct": (r["br_drb"] / 100.0) if r.get("br_drb") is not None else None,
        }
    box = pd.DataFrame.from_dict(box_rows, orient="index")
    adv = pd.DataFrame.from_dict(adv_rows, orient="index")
    return box, adv

def normalize_season(end_year, xcheck_log=None):
    """{br_id: site-schema player entry} for one pre-1996 season."""
    season = BR.season_label(end_year)
    players = BR.load_season(end_year)
    env = BR.load_team_env(end_year)
    box, adv = _frames(players, env)
    derived = E.derive_box(box, adv)   # <-- identical engine path as 1996+

    out = {}
    for bid, r in players.items():
        if bid not in box.index:
            continue
        gp = r.get("gp") or 0
        mp = r.get("min") or 0
        team = r.get("team")
        tenv = env.get(team, {}) or {}
        tm_mp5 = (tenv.get("tm_mp") or 0) / 5.0
        tm_g = tenv.get("tm_g") or 0
        pace = tenv.get("pace")

        m = {}
        for key, mp_map in derived.items():
            if bid in mp_map:
                v, n = mp_map[bid]
                m[key] = {"season": {"v": v, "n": n}}
        # value bars straight from BR
        for our, brk in BR_VALUE.items():
            if r.get(brk) is not None:
                m[our] = {"season": {"v": r[brk], "n": round(mp)}}
        # role / durability (team-context)
        if tm_mp5 > 0:
            m["minshare"] = {"season": {"v": round(100 * mp / tm_mp5, 1), "n": round(mp)}}
        if tm_g > 0:
            m["avail"] = {"season": {"v": round(100 * gp / tm_g, 1), "n": int(gp)}}
        # STL% / BLK% (need opponent context) — cross-checked against BR below
        opp2a = (tenv.get("opp_fga") or 0) - (tenv.get("opp_fg3a") or 0)
        opp_poss = (pace * tm_g) if (pace and tm_g) else 0
        stl, blk = r.get("stl") or 0, r.get("blk") or 0
        if opp_poss > 0 and mp > 0:
            m["stlpct"] = {"season": {"v": round(100 * stl * tm_mp5 / (mp * opp_poss), 1), "n": round(mp)}}
        if opp2a > 0 and mp > 0:
            m["blkpct"] = {"season": {"v": round(100 * blk * tm_mp5 / (mp * opp2a), 1), "n": round(mp)}}

        entry = dict(
            id=bid, name=r.get("name", ""), team=team, pos=_pos_bucket(r.get("pos")),
            age=int(r["age"]) if r.get("age") is not None else 0,
            college=None, exp=None, birthdate=None,
            m=m,
            qualified=(gp >= C.QUALIFY["min_gp"] and (mp / gp if gp else 0) >= C.QUALIFY["min_mpg"]),
            line=(dict(ppg=round((r.get("pts") or 0) / gp, 1), apg=round((r.get("ast") or 0) / gp, 1),
                       rpg=round((r.get("trb") or 0) / gp, 1), tpg=round((r.get("tov") or 0) / gp, 1),
                       mpg=round(mp / gp, 1)) if gp else None),
            src="br",
        )
        out[bid] = entry

        # ---- cross-check recomputed rates vs BR precomputed ----
        if xcheck_log is not None:
            for key, (brcol, _frac, scale) in XCHECK.items():
                ours = m.get(key, {}).get("season", {}).get("v")
                brv = r.get(brcol)
                if ours is None or brv is None:
                    continue
                diff = abs(ours * scale - brv)
                tol = 0.006 if key in ("ts", "efg") else 0.6  # fractions vs percentage-point scale
                if diff > tol:
                    xcheck_log.append((season, bid, key, round(ours * scale, 3), round(brv, 3), round(diff, 3)))
    return out

def main():
    log = []
    total = 0
    for ey in BR.BR_END_YEARS:
        entries = normalize_season(ey, xcheck_log=log)
        total += len(entries)
        b = entries.get("birdla01") or entries.get("jordami01") or {}
    print(f"normalized {total} player-seasons across {len(BR.BR_END_YEARS)} seasons")
    print(f"cross-check diffs beyond tolerance: {len(log)}")
    for row in log[:25]:
        print("  DIFF", row)

if __name__ == "__main__":
    main()
