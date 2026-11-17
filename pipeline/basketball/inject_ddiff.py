"""inject_ddiff.py — compute the offensive "Defender difficulty" metric and
merge it into out/players.json.

Defender difficulty = the PARTIAL_POSS-weighted average season DBPM of the
defenders who guarded a player (the offensive mirror of `mtch`, which averages
the PPG of players a defender guarded). Uses the same cached LeagueSeasonMatchups
table + the DBPM already merged into players.json, so no engine rerun is needed.
Matchup tracking starts in 2017-18 (the NBA's 2016-17 table is a stub: savant_config
since); earlier seasons are skipped.

    python3 inject_ddiff.py
"""
import json
import os

import savant_engine as E
import savant_config as C

OUT = os.path.join("out", "players.json")
FM = C.FIELD_MAP["matchups"]


def season_dbpm(players):
    m = {}
    for p in players:
        c = (p.get("m", {}).get("dbpm") or {}).get("season") or {}
        v = c.get("v")
        if v is not None:
            m[int(p["id"])] = float(v)
    return m


def apply_season(season, players):
    """Defender difficulty for one tier-4 season, onto `players` in place (needs dbpm
    already on them). Shared by main() (full rebuild) and refresh_current.py."""
    if season < C.since_of(next(m for m in C.METRICS if m["key"] == "ddiff")):
        return 0
    dbpm = season_dbpm(players)
    if not dbpm:
        return 0
    try:
        mdf = E.load_matchups(season)             # cached
    except Exception as exc:
        print(f"  {season}: matchups unavailable ({exc}) — skipped")
        return 0
    m = mdf[[FM["off_id"], FM["def_id"], FM["partial_poss"]]].copy()
    m["db"] = m[FM["def_id"]].astype(int).map(dbpm)
    m["w"] = m[FM["partial_poss"]].astype(float)
    m = m[(m["w"] > 0) & m["db"].notna()]
    m["wd"] = m["w"] * m["db"]
    g = m.groupby(m[FM["off_id"]].astype(int)).agg(wd=("wd", "sum"), w=("w", "sum"))
    by_id = {int(p["id"]): p for p in players}
    n = 0
    for off_pid, row in g.iterrows():
        p = by_id.get(int(off_pid))
        if p is None or row["w"] <= 0:
            continue
        v, samp = round(row["wd"] / row["w"], 1), round(row["w"])
        p.setdefault("m", {})["ddiff"] = {w: {"v": v, "n": samp} for w in C.WINDOWS}
        n += 1
    return n


def main():
    d = json.load(open(OUT))
    total = 0
    for season in d["seasons"]:
        players = d["data"][season]["players"]
        n = apply_season(season, players)
        total += n
        print(f"  {season}: ddiff set for {n} players")
    E_safe_write(d)
    print(f"done — ddiff on {total} player-seasons across tier-4 seasons")


def E_safe_write(d):
    import safe_io
    safe_io.write_text(OUT, json.dumps(d, separators=(",", ":")))  # compact, matches the engine


if __name__ == "__main__":
    main()
