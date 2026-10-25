"""Decode the new league-relative vol grid for a few archetypes and report where each
player runs 'hot' — perimeter (>=23ft) vs paint (<=8ft). If the fix works, a shooter's
perimeter mean should dominate and a rim-runner's paint mean should dominate."""
import json, base64, numpy as np
from savant_shots import NX, NY, _CX, _CY, STEP

dist = np.sqrt(_CX**2 + _CY**2)          # 0.1-ft units from basket
PERIM = dist >= 230                      # ~23 ft +  (three-point range)
PAINT = dist <= 85                       # ~8.5 ft   (rim / paint)

ARCH = {
    "201939": "Curry (elite 3P)",
    "203497": "Gobert (rim runner)",
    "201942": "DeRozan (midrange)",
    "1629029": "Doncic (high volume all3)",
}
SEASON = "2025-26"

for pid, label in ARCH.items():
    try:
        d = json.load(open(f"out/shots/{pid}.json")).get(SEASON)
    except FileNotFoundError:
        print(f"{label:28s}: no file"); continue
    if not d:
        print(f"{label:28s}: not in {SEASON}"); continue
    vol = np.frombuffer(base64.b64decode(d["vol"]), np.uint8).astype(float)
    live = vol > 0
    pm = vol[PERIM & live].mean() if (PERIM & live).any() else 0
    pt = vol[PAINT & live].mean() if (PAINT & live).any() else 0
    hot = vol[live]
    print(f"{label:28s}: n={d['n']:4d}  perimeter_mean={pm:5.1f}  paint_mean={pt:5.1f}  "
          f"live_cells={int(live.sum()):4d}  max={int(vol.max())}")
