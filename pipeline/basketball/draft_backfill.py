"""
draft_backfill.py — assemble classes 2010-2020 (first round, picks 1-30) into Draft
Savant's per-player JSON shape and merge them into the fetched dataset.

Pulls exclusively from draft_scrape.py's cached sources (no fabrication). For each pick:
matches the drafted player to his final college season on Barttorvik (by normalized name),
to the NBA combine table, and to a Basketball-Reference birthdate. A stat a source doesn't
carry stays None and is hidden by the page.

Match policy: a first-rounder's last college season is the spring of his draft year, so we
look up Torvik year == draft year, then fall back to draft_year-1 (rare gap-year cases).
Players with no NCAA row (internationals, prep-to-pro) keep null college bars — expected.

Output: out/backfill_players.json  (list of player dicts in the {v,n} shape)

CLI:
  python draft_backfill.py 2010            # one class, prints a coverage report
  python draft_backfill.py 2010 2020       # inclusive range -> writes the merged JSON
"""
import os, sys, json, datetime as dt, difflib
import draft_scrape as S

OUT = os.path.join("out", "backfill_players.json")

# Team abbreviation -> full name, for the pick badge. BR uses era abbreviations
# (NJN, NOH, CHA...) that differ from today's; map every one that appears 2010-2020.
TEAM = {
    "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BRK": "Brooklyn Nets",
    "CHA": "Charlotte Bobcats", "CHO": "Charlotte Hornets", "CHI": "Chicago Bulls",
    "CLE": "Cleveland Cavaliers", "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets",
    "DET": "Detroit Pistons", "GSW": "Golden State Warriors", "HOU": "Houston Rockets",
    "IND": "Indiana Pacers", "LAC": "Los Angeles Clippers", "LAL": "Los Angeles Lakers",
    "MEM": "Memphis Grizzlies", "MIA": "Miami Heat", "MIL": "Milwaukee Bucks",
    "MIN": "Minnesota Timberwolves", "NJN": "New Jersey Nets", "NOH": "New Orleans Hornets",
    "NOP": "New Orleans Pelicans", "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder",
    "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHO": "Phoenix Suns",
    "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs",
    "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
}

# Metric keys that carry a games-played sample size (college rate stats). Combine/derived
# fields (age, sos, measurables) have no per-game n.
STAT_KEYS = ["ts", "efg", "usg", "ortg", "ft", "tp3", "twop", "rimfg", "midfg",
             "ast", "tov", "oreb", "dreb", "stl", "blk", "bpm", "obpm", "dbpm",
             "tp3r", "ftr"]
MEASURE_KEYS = ["wing", "reach", "height", "weight"]      # rendered as bars; vert is header-only


def decimal_age(iso_birth, draft_year):
    """Draft-day age = whole days/365.25 vs Feb 1 of the draft year (matches draft_config)."""
    if not iso_birth:
        return None
    y, m, d = (int(x) for x in iso_birth.split("-"))
    ref = dt.date(draft_year, 2, 1)
    return round((ref - dt.date(y, m, d)).days / 365.25, 2)


def slugify(name):
    return S.norm_name(name).replace(" ", "-")


def _college_head(s):
    """First distinguishing token of a school name (Torvik 'Ohio St.' vs BR 'Ohio State')."""
    return (S.norm_name(s).split() or [""])[0]


def match_torvik(pick, tv):
    """Find a drafted player's Torvik row: exact name, else same-last-name + same-school,
    else a single high-confidence fuzzy name hit. Returns the row or None (no fabrication —
    a miss just means null college bars, expected for internationals/prep picks)."""
    key = S.norm_name(pick["player"])
    if key in tv:
        return tv[key]
    parts = key.split()
    last, head = (parts[-1] if parts else ""), _college_head(pick["college"])
    if last and head:
        hits = [r for nm, r in tv.items()
                if nm.split()[-1:] == [last] and _college_head(r[S.T["team"]]) == head]
        if len(hits) == 1:
            return hits[0]
    close = difflib.get_close_matches(key, list(tv.keys()), n=1, cutoff=0.86)
    if close:
        cand = tv[close[0]]
        # only trust the fuzzy name hit if the school agrees too
        if not pick["college"] or _college_head(cand[S.T["team"]]) == head:
            return cand
    return None


def build_player(pick, year, tv, combine):
    """One drafted pick -> a Draft Savant player dict, or a null-college shell if unmatched."""
    key = S.norm_name(pick["player"])
    row = match_torvik(pick, tv)
    st = S.torvik_stats(row) if row else {}
    cb = combine.get(key, {})
    iso = S.br_birthdate(pick["link"])

    n = st.get("gp")                       # shared sample size for every college rate stat

    def cell(v, has_n=True):
        return {"v": v, "n": (n if (has_n and v is not None) else None)}

    m = {}
    for k in STAT_KEYS:
        m[k] = cell(st.get(k))
    # ator (A/TO ratio) isn't cleanly derivable from Torvik's advanced CSV -> left null (hidden).
    m["ator"] = {"v": None, "n": None}
    # measurables (no games sample)
    m["wing"] = cell(cb.get("wing"), has_n=False)
    m["reach"] = cell(cb.get("reach"), has_n=False)
    # combine height (no-shoes, inches) preferred; Torvik listed height is a coarse fallback.
    m["height"] = cell(cb.get("height"), has_n=False)
    m["weight"] = cell(cb.get("weight"), has_n=False)
    m["vert"] = cell(cb.get("vert"), has_n=False)
    m["age"] = {"v": decimal_age(iso, year), "n": None}
    m["sos"] = {"v": None, "n": None}      # historical KenPom SOS rank not sourced -> hidden

    line = {"ppg": st.get("ppg"), "rpg": st.get("rpg"),
            "apg": st.get("apg"), "tpg": None}
    return dict(
        id=f"{slugify(pick['player'])}-{year}",
        name=pick["player"],
        college=pick["college"] or (row[S.T["team"]] if row else ""),
        pos=S.role_to_pos(st.get("role", "")) if row else "Wing",
        conference=(row[S.T["conf"]] if row else None),
        archetype=(st.get("role") or None) if row else None,
        draft_year=year, draft_pick=pick["pick"],
        draft_team=TEAM.get(pick["team"], pick["team"]),
        birthdate=iso, sos_asof=None,
        gp=st.get("gp"), line=line, m=m,
        bpm_torvik=None, usg_torvik=None, scouting=None,
        _matched=bool(row),
    )


def build_class(year):
    picks = [p for p in S.br_draft(year) if p["pick"] <= 30]
    tv = S.torvik_year(year)
    try:
        combine = S.combine_year(year)
    except Exception:                       # noqa: BLE001
        combine = {}
    # fall back to the prior Torvik season for gap-year players (rare in round 1)
    tv_prev = None
    players = []
    for p in picks:
        tv_use = tv
        if match_torvik(p, tv) is None:
            if tv_prev is None:
                tv_prev = S.torvik_year(year - 1)
            if match_torvik(p, tv_prev) is not None:
                tv_use = tv_prev
        players.append(build_player(p, year, tv_use, combine))
    return players


def report(players, year):
    matched = sum(p["_matched"] for p in players)
    with_combine = sum(p["m"]["height"]["v"] is not None for p in players)
    with_age = sum(p["m"]["age"]["v"] is not None for p in players)
    unmatched = [p["name"] for p in players if not p["_matched"]]
    print(f"[{year}] {len(players)} picks | college {matched} | combine {with_combine} | age {with_age}")
    if unmatched:
        print(f"        no NCAA row (intl/prep, null college bars): {', '.join(unmatched)}")


if __name__ == "__main__":
    lo = int(sys.argv[1])
    hi = int(sys.argv[2]) if len(sys.argv) > 2 else lo
    allp = []
    for y in range(lo, hi + 1):
        cls = build_class(y)
        report(cls, y)
        allp.extend(cls)
    if hi > lo:
        os.makedirs("out", exist_ok=True)
        for p in allp:
            p.pop("_matched", None)
        with open(OUT, "w") as fh:
            json.dump(allp, fh, indent=2)
        print(f"\nwrote {OUT}  ({len(allp)} players, {lo}-{hi})")
