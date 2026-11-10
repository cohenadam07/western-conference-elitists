"""Major position awards, 2014-2025, from ESPN's awards endpoint (athlete ids included).

    python -m pipeline.cfb.espn_awards        # writes work/awards.parquet

Used only as a sourced sanity check on the All-Savant dry run (step 13). ESPN's
endpoint has no All-America team, so the AP comparison needs its own table.
"""
import re
import pandas as pd
from .paths import WORK
from concurrent.futures import ThreadPoolExecutor
from .espn_http import get_json, MAX_PARALLEL

CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"
AWARDS = {2: "Bednarik (defensive player)", 3: "Davey O'Brien (QB)", 4: "Butkus (LB)", 5: "Doak Walker (RB)",
          6: "Biletnikoff (receiver)", 9: "Heisman", 10: "Thorpe (DB)", 11: "Mackey (TE)", 13: "Groza (K)", 14: "Maxwell",
          15: "Nagurski (defensive player)", 17: "Outland (interior lineman)", 18: "Ray Guy (P)", 19: "Lombardi",
          20: "Walter Camp", 25: "Hendricks (DE)", 26: "Rimington (C)", 30: "Lott", 31: "Hornung (versatile)"}


def main():
    jobs = [(y, a) for y in range(2014, 2026) for a in AWARDS]
    with ThreadPoolExecutor(MAX_PARALLEL) as ex:       # get_json holds the 6-request semaphore itself
        res = list(ex.map(lambda j: get_json(f"{CORE}/seasons/{j[0]}/awards/{j[1]}", key=f"award_{j[0]}_{j[1]}"), jobs))
    rows = []
    for (y, a), d in zip(jobs, res):
        if not isinstance(d, dict) or "winners" not in d:
            continue
        for w in d["winners"]:
            ref = (w.get("athlete") or {}).get("$ref", "")
            tref = (w.get("team") or {}).get("$ref", "")
            m, t = re.search(r"/athletes/(\d+)", ref), re.search(r"/teams/(\d+)", tref)
            if m:
                rows.append(dict(season=y, award_id=a, award=AWARDS[a], pid=int(m.group(1)), team=int(t.group(1)) if t else None))
    t = pd.DataFrame(rows)
    t.to_parquet(WORK / "awards.parquet", index=False)
    print(len(t), "winners;", t.groupby("season").size().to_dict())


if __name__ == "__main__":
    main()
