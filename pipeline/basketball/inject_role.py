"""inject_role.py — attach the Inferred Defensive Role signals to the current season's
players in out/players.json without a full 15-season rebuild. Reuses savant_engine.derive_role
(so nightly `savant_engine.py build` and this one-off produce identical results). Uses cached
LeagueSeasonMatchups + ptdefend LT6 + box; makes one live call (ptdefend Overall)."""
import json
import savant_engine as E
import savant_config as C

season = C.SEASONS[0]
data = json.load(open("out/players.json"))
players = data["data"][season]["players"]
uni = {p["id"]: p for p in players}           # same dict objects as the list
box = E.load_box(None, season)                # cached
E.derive_role(season, uni, box)               # attaches p["role"] to eligible bigs
n = sum(1 for p in players if p.get("role"))
print(f"players with role: {n} / {len(players)}")
json.dump(data, open("out/players.json", "w"), separators=(",", ":"))
print("wrote out/players.json")
