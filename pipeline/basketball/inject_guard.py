"""inject_guard.py — attach the Guardometer matchup distribution to the current season's
players in out/players.json without a full rebuild. Reuses savant_engine.derive_guard, the
cached LeagueSeasonMatchups fetch, and the same site position source. No new nba_api calls."""
import json
import savant_engine as E
import savant_config as C

season = C.SEASONS[0]
data = json.load(open("out/players.json"))
players = data["data"][season]["players"]
uni = {p["id"]: p for p in players}
box = E.load_box(None, season)                # cached
E.derive_guard(season, uni, box)              # attaches p["guard"]
n = sum(1 for p in players if p.get("guard"))
print(f"players with guard: {n} / {len(players)}")
json.dump(data, open("out/players.json", "w"), separators=(",", ":"))
print("wrote out/players.json")
