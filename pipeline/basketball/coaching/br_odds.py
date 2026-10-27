"""
br_odds.py — preseason win totals, the market's expectation of each team, from Basketball-
Reference's preseason odds pages (one page a season: title odds, the over/under on wins and
how it came out), which cite the sportsbooks they were taken from.

    python3 br_odds.py            # fetch 1996-97 on (cached), parse -> out/bcs/preseason_odds.json

Every row keeps its source page, so a figure on the site can be traced to the page it came
from. Seasons without a win total on the page are reported, not guessed.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import br_coaches as B  # noqa: E402
import teams as TM  # noqa: E402

OUT = B.OUT


def parse(html, year):
    rows = []
    for r in B.table(html, "NBA_preseason_odds"):
        team = r.get("team")
        if not team or team == "Team" or "thead" in r["_class"]:
            continue
        ou = r.get("wins_ou")
        try:
            ou = float(ou)
        except (TypeError, ValueError):
            ou = None
        key = None
        for k, nm in TM.NAMES.items():
            if nm.lower() == team.lower():
                key = k
        if key is None:
            low = team.lower()
            for old, nm in TM.OLD_NAMES.items():
                if nm.lower() == low:
                    key = TM.franchise(old)
            if "bobcats" in low or ("charlotte" in low and year >= 2005):
                key = "CHA"
            if "bullets" in low:
                key = "WAS"
            if "charlotte hornets" in low and year <= 2002:
                key = "NOP"
            if "sonics" in low:
                key = "OKC"
            if "vancouver" in low:
                key = "MEM"
            if "new jersey" in low:
                key = "BKN"
            if "new orleans" in low:
                key = "NOP"
            if "clippers" in low:
                key = "LAC"
            if "seattle" in low:
                key = "OKC"
            if "washington" in low:
                key = "WAS"
        rows.append(dict(team=key, name=team, title_odds=r.get("odds_fmt") or None, win_total=ou, result=re.sub(r"\s+", " ", r.get("result") or "").strip() or None))
    return rows


def main(first=1997, last=None, log=print):
    import datetime as dt
    t = dt.date.today()
    last = last or (t.year + 1 if t.month >= 10 else t.year)
    out = {}
    for y in range(first, last + 1):
        html = B.page(f"/leagues/NBA_{y}_preseason_odds.html", f"preseason_odds_{y}.html", max_age_days=30 if y >= last else None)
        if not html:
            out[B.season_of(f"{y-1}-{str(y)[2:]}")] = dict(rows=[], source=None, note="no page")
            continue
        rows = parse(html, y - 1)
        season = f"{y - 1}-{str(y)[2:]}"
        out[season] = dict(rows=rows, source=f"https://www.basketball-reference.com/leagues/NBA_{y}_preseason_odds.html",
                           with_total=sum(1 for r in rows if r["win_total"] is not None), unmatched=[r["name"] for r in rows if not r["team"]])
        log(f"{season}: {len(rows)} teams, {out[season]['with_total']} with a win total" + (f", unmatched {out[season]['unmatched']}" if out[season]["unmatched"] else ""))
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "preseason_odds.json"), "w"), indent=0)
    return out


if __name__ == "__main__":
    main()
