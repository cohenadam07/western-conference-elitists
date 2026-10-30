"""
build_dynasty_seed.py — the starting pool for the crowd-sourced dynasty ranker.

Takes the Hashtag Basketball dynasty rankings (POINTS-league filter, scraped once into
htb_points.json) and joins them to our own player data so each card in the picker can show
a headshot, this season's line, and an age — then writes the seed the site ships:

    out/dynasty/players.json

The Hashtag rank is ONLY a seed. Every player's live value is decided by the crowd from
the first pick onward; this file exists so the board isn't empty on day one and so the
ranker starts from something defensible instead of alphabetical order.

    python build_dynasty_seed.py path/to/htb_points.json
"""
import os, sys, json, math, unicodedata, datetime as dt

import savant_config as C
import savant_engine as E

OUT_DIR = os.path.join(C.OUT_DIR, "dynasty")
OUT = os.path.join(OUT_DIR, "players.json")

# Seed rating. Rank 1 starts at TOP and the curve decays so the gap between #1 and #10 is
# far larger than between #200 and #210 — dynasty value is steeply top-heavy, and starting
# everyone evenly spaced would make the early crowd votes fight the seed instead of refine it.
TOP, FLOOR, DECAY = 1850.0, 1150.0, 55.0


# Hashtag uses full/legal first names where the NBA feed uses the common one. Only
# genuine identity mismatches belong here — not spelling variants, which norm() handles.
ALIASES = {
    "alexandre sarr": "alex sarr",
    "nicolas claxton": "nic claxton",
    "carlton carrington": "bub carrington",
    "ron holland": "ronald holland",
}


def norm(s):
    """Lowercase, strip diacritics and punctuation — 'Nikola Jokić' == 'Nikola Jokic',
    'Jimmy Butler III' == 'Jimmy Butler'."""
    s = "".join(c for c in unicodedata.normalize("NFD", (s or "").lower())
                if unicodedata.category(c) != "Mn")
    for junk in (" jr.", " jr", " sr.", " sr", " iii", " ii", " iv"):
        if s.endswith(junk):
            s = s[: -len(junk)]
    return "".join(ch for ch in s if ch.isalnum() or ch == " ").strip()


def seed_rating(rank):
    import math
    return round(FLOOR + (TOP - FLOOR) * math.exp(-(rank - 1) / DECAY), 1)


def load_savant():
    """{normalized name: (id, row)} for the newest season a player appears in."""
    path = os.path.join(C.OUT_DIR, "players.json")
    if not os.path.exists(path):
        sys.exit(f"missing {path} — run the engine first")
    payload = json.load(open(path))
    seasons = [s for s in payload["seasons"] if s in payload["data"]]
    seasons.sort(key=lambda s: int(s[:4]), reverse=True)     # newest first
    by_name, newest = {}, {}
    for season in seasons:
        for p in payload["data"][season]["players"]:
            key = norm(p.get("name"))
            if key and key not in by_name:
                by_name[key] = (p, season)
    return by_name, seasons[0]


def line_of(p):
    ln = p.get("line") or {}
    def g(k):
        v = ln.get(k)
        return None if v is None else round(float(v), 1)
    return dict(ppg=g("ppg"), rpg=g("rpg"), apg=g("apg"), mpg=g("mpg"))


# ----------------------------------------------------------------------------
# This year's draft class
# ----------------------------------------------------------------------------
# Hashtag has no 2026 rookies at all — not in the points list, not at 649 players deep, and
# their rookie filter returns nothing — because the class was drafted weeks ago and has never
# played. So they get placed here instead, from the actual draft order.
#
# Where does a pick belong on a dynasty board? Rather than guess, fit it: take LAST year's
# class, look up where each of them actually sits in the dynasty pool now, and regress
# dynasty rank on draft pick. That gives rank ~ 16.1 * pick^0.84 — a #1 pick is roughly a
# top-20 dynasty asset, a late first is around #200.
#
# Two honest caveats. The scatter is wide (2025's pick 3 sits at #46, pick 4 at #33), so this
# is a plausible starting line and nothing more. And it is fitted on players who have since
# been exposed to NBA minutes, which makes it conservative for a class whose option value is
# still intact. Both are fine: the crowd reprices from the first pick, and starting a rookie
# too low costs less than starting him too high.
DRAFT_FIT_A, DRAFT_FIT_B = 16.1, 0.84
ROOKIE_SEASON = "2026"

POS_MAP = {"Guard": "PG", "Forward": "SF", "Center": "C",
           "Guard-Forward": "SG", "Forward-Guard": "SF",
           "Forward-Center": "PF", "Center-Forward": "C"}


def draft_class(season=ROOKIE_SEASON):
    """[(pick, name, nba_id)] for a draft, straight from the league's own history."""
    from nba_api.stats.endpoints import drafthistory
    df = E.call(drafthistory.DraftHistory, dict(league_id="00", season_year_nullable=season))
    out = []
    for _, r in df.iterrows():
        try:
            out.append((int(r["OVERALL_PICK"]), str(r["PLAYER_NAME"]).strip(),
                        int(r["PERSON_ID"]), str(r.get("TEAM_ABBREVIATION") or "").strip()))
        except Exception:
            continue
    return sorted(out)


def rookie_rows(season=ROOKIE_SEASON):
    """Seed entries for a draft class, positioned by the fitted pick -> dynasty-rank curve."""
    rows = []
    ref = dt.date(int(season) + 1, 2, 1)      # age as of the coming Feb 1, as elsewhere
    for pick, name, pid, team in draft_class(season):
        pos, age = None, None
        try:
            info = E.load_player_info(pid).iloc[0]
            raw = info.get("POSITION")
            pos = POS_MAP.get(str(raw).strip(), "SF") if raw else None
            bd = info.get("BIRTHDATE")
            if bd:
                y, m, d = (int(x) for x in str(bd).split("T")[0].split("-"))
                age = round((ref - dt.date(y, m, d)).days / 365.25, 1)
        except Exception:
            pass
        rows.append(dict(
            id=pid, name=name, pos=pos or "SF", team=team or None, age=age,
            proj_rank=DRAFT_FIT_A * (pick ** DRAFT_FIT_B),
            pick=pick, rookie=True,
            ppg=None, rpg=None, apg=None, mpg=None, season=None,
        ))
    return rows


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "htb_points.json"
    if not os.path.exists(src):
        sys.exit(f"missing {src} — the Hashtag Basketball points-league pull")
    htb = json.load(open(src))
    savant, current_season = load_savant()

    out, matched, unmatched = [], 0, []
    for row in sorted(htb, key=lambda r: r["rank"]):
        key = norm(row["name"])
        hit = savant.get(key) or savant.get(ALIASES.get(key, ""))
        rec = dict(
            id=None, name=row["name"], pos=row.get("pos"), team=row.get("team"),
            age=row.get("age"), seed=row["rank"], rating=seed_rating(row["rank"]),
            ppg=None, rpg=None, apg=None, mpg=None, season=None,
        )
        if hit:
            p, season = hit
            rec["id"] = p["id"]
            rec["season"] = season
            rec.update(line_of(p))
            # our own age is exact (birthdate-derived); prefer it when we have it
            if isinstance(p.get("age"), (int, float)) and p["age"]:
                rec["age"] = round(float(p["age"]), 1)
            if p.get("team"):
                rec["team"] = p["team"]
            matched += 1
        else:
            unmatched.append(row["name"])
        # A player with no NBA id can't be priced (the market keys on numeric ids) and has no
        # headshot or stat line, so he'd be an unpickable card. Keep the pool honest instead.
        if rec["id"] is None:
            continue
        out.append(rec)

    # merge in this year's class, interleaved at their projected ranks
    try:
        rookies = rookie_rows()
    except Exception as e:
        print(f"  rookies: skipped ({repr(e)[:70]})")
        rookies = []
    if rookies:
        have = {r["name"] for r in out}
        rookies = [r for r in rookies if r["name"] not in have]
        merged = [dict(r, _key=float(r["seed"])) for r in out] + \
                 [dict(r, _key=r["proj_rank"]) for r in rookies]
        merged.sort(key=lambda r: r["_key"])
        out = []
        for i, r in enumerate(merged, 1):
            r.pop("_key", None); r.pop("proj_rank", None)
            r["seed"] = i
            r["rating"] = seed_rating(i)
            out.append(r)
        print(f"  rookies: added {len(rookies)} from the {ROOKIE_SEASON} class "
              f"(top: {rookies[0]['name']} -> #{out[[o['name'] for o in out].index(rookies[0]['name'])]['seed'] if rookies else '?'})")

    os.makedirs(OUT_DIR, exist_ok=True)
    payload = dict(
        source="hashtagbasketball dynasty rankings — Points Leagues filter",
        note="Seed only. Live values come from crowd picks; this is the day-one baseline.",
        current_season=current_season, count=len(out), players=out,
    )
    with open(OUT, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))

    print(f"wrote {OUT} — {len(out)} priceable players "
          f"(dropped {len(unmatched)} with no NBA id)")
    if unmatched:
        print(f"  dropped, no NBA id to price them by: {unmatched[:12]}"
              + (" ..." if len(unmatched) > 12 else ""))
    print(f"  seed ratings: #1 {out[0]['name']} {out[0]['rating']} … "
          f"#{out[-1]['seed']} {out[-1]['name']} {out[-1]['rating']}")


if __name__ == "__main__":
    main()
