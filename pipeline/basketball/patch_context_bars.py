"""
patch_context_bars.py — compute the team-context Tier-1 bars (minutes share, availability,
STL%, BLK%) for the nba_api seasons (1996-97 → present) so they match the historical (BR)
side, which already carries them from br_normalize.

Uses player TEAM_ID (not abbreviation) to join to team totals, so relocated/renamed teams
in the 1996-2010 window (SEA/VAN/NJN/…) join correctly. Traded players (aggregated to
TEAM_ID 0) are skipped for these four bars — they stay n/a, same as any unresolved join.

Formulas match br_normalize / BR conventions:
  minshare = 100·MP / (Tm_MP/5)          avail = 100·GP / Tm_GP
  STL%     = 100·STL·(Tm_MP/5) / (MP·Opp_Poss)
  BLK%     = 100·BLK·(Tm_MP/5) / (MP·(Opp_FGA − Opp_3PA))

Run AFTER build_gap (writes players.json). Historical (<1996) seasons are skipped.
    python patch_context_bars.py
"""
import json, os
import pandas as pd
import savant_engine as E
import savant_config as C

OUT = os.path.join("out", "players.json")

def _team_base(season):
    from nba_api.stats.endpoints import leaguedashteamstats as T
    df = E.call(T.LeagueDashTeamStats, dict(season=season, season_type_all_star=C.SEASON_TYPE,
               measure_type_detailed_defense="Base", per_mode_detailed="Totals"))
    return df.set_index("TEAM_ID")

def _team_adv(season):
    from nba_api.stats.endpoints import leaguedashteamstats as T
    df = E.call(T.LeagueDashTeamStats, dict(season=season, season_type_all_star=C.SEASON_TYPE,
               measure_type_detailed_defense="Advanced", per_mode_detailed="Totals"))
    return df.set_index("TEAM_ID")

def apply_season(season, players):
    """The four context bars for one nba_api season, onto `players` in place. Returns how
    many players got them. Shared by patch() (full rebuild) and refresh_current.py."""
    try:
        box = E.load_box(None, season)          # player totals (+ TEAM_ID column)
        tb, ta, topp = _team_base(season), _team_adv(season), E.load_team_opponent(season)
    except Exception as e:
        print(f"  {season}: skipped ({repr(e)[:70]})"); return 0
    fo = C.FIELD_MAP["team_opp"]
    entries = {p["id"]: p for p in players}
    n = 0
    for pid, r in box.iterrows():
        p = entries.get(int(pid))
        if p is None or "TEAM_ID" not in box.columns:
            continue
        tid = int(r.get("TEAM_ID") or 0)
        if tid == 0 or tid not in tb.index:
            continue
        mp = float(r.get("min") or 0); gp = float(r.get("gp") or 0)
        stl = float(r.get("stl") or 0); blk = float(r.get("blk") or 0)
        # nba_api team MIN (Totals) is already reported as Tm_MP/5 (~48×GP), the
        # per-player-slot total — so it IS the "Tm_MP/5" term (do NOT divide again).
        # (BR's team MP is the full 5× total, which br_normalize divides by 5.)
        tm_mp5 = float(tb.loc[tid, "MIN"] or 0)
        tm_gp = float(tb.loc[tid, "GP"] or 0)
        opp_poss = float(ta.loc[tid, "POSS"]) if (tid in ta.index and "POSS" in ta.columns) else 0
        opp_fga = float(topp.loc[tid, fo["opp_fga"]]) if tid in topp.index else 0
        opp_3a = float(topp.loc[tid, fo["opp_fg3a"]]) if tid in topp.index else 0
        opp2a = opp_fga - opp_3a
        if mp <= 0 or tm_mp5 <= 0:
            continue
        p["m"].setdefault("minshare", {})["season"] = {"v": round(100 * mp / tm_mp5, 1), "n": round(mp)}
        if tm_gp > 0:
            p["m"].setdefault("avail", {})["season"] = {"v": round(100 * gp / tm_gp, 1), "n": int(gp)}
        if opp_poss > 0:
            p["m"].setdefault("stlpct", {})["season"] = {"v": round(100 * stl * tm_mp5 / (mp * opp_poss), 1), "n": round(mp)}
        if opp2a > 0:
            p["m"].setdefault("blkpct", {})["season"] = {"v": round(100 * blk * tm_mp5 / (mp * opp2a), 1), "n": round(mp)}
        n += 1
    return n

def patch():
    payload = json.load(open(OUT))
    done = 0
    for season in payload["seasons"]:
        if int(season[:4]) < 1996:
            continue  # BR seasons already have these
        sd = payload["data"].get(season)
        if not sd or not sd.get("players"):
            continue
        n = apply_season(season, sd["players"])
        print(f"  {season}: context bars on {n} players")
        done += 1
    import safe_io; safe_io.dump_json(OUT, payload)
    print(f"done — context bars across {done} nba_api seasons")

if __name__ == "__main__":
    patch()
