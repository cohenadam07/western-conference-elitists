"""
awards_fetch.py — season honours per player-season, from the NBA's own awards endpoint.

Reads:  out/players.json   (for the player id universe)
Writes: out/awards.json    {pid: {season: [code, ...]}} plus a code->label dictionary

    python awards_fetch.py              # every player in out/players.json
    python awards_fetch.py 201939 2544  # just these ids (for spot checks)

One HTTP call per player, through savant_engine.call, so the shared cache/retry/politeness
applies and a re-run is free. Like `build`, this must run from a home connection —
stats.nba.com blocks most datacenter IPs.

WHAT IS KEPT. PlayerAwards returns weekly and monthly trinkets alongside the season
honours, and they swamp everything else: across five all-time players, Player of the Week
and Player of the Month alone were 215 of 505 rows. A player card is a season object, so
this keeps season-level honours only. Also dropped:
  * "Sporting News" MVP / ROY — a second press award that duplicates the league's own,
    so keeping both would double-count the same achievement on the same season.
  * Olympic medals and Hall of Fame induction — real, but not properties of an NBA season,
    and HOF has no meaningful SEASON to hang on.
"""
import json, os, re, sys, time
import savant_engine as E
from nba_api.stats.endpoints import playerawards

SEASON_RE = re.compile(r"^\d{4}-\d{2}$")

OUT = os.path.join("out", "awards.json")
SRC = os.path.join("out", "players.json")

# description -> (code, label). Order here is the order they render on the card.
KEEP = {
    "NBA Champion":                              ("chip",  "NBA Champion"),
    "NBA Finals Most Valuable Player":           ("fmvp",  "Finals MVP"),
    "NBA Most Valuable Player":                  ("mvp",   "Most Valuable Player"),
    "NBA Defensive Player of the Year":          ("dpoy",  "Defensive Player of the Year"),
    "NBA Rookie of the Year":                    ("roy",   "Rookie of the Year"),
    "NBA Sixth Man of the Year":                 ("smoy",  "Sixth Man of the Year"),
    "NBA Most Improved Player":                  ("mip",   "Most Improved Player"),
    "NBA Clutch Player of the Year":             ("cpoy",  "Clutch Player of the Year"),
    "NBA All-Star Most Valuable Player":         ("asmvp", "All-Star MVP"),
    "NBA All-Star":                              ("as",    "All-Star"),
    "NBA Sportsmanship":                         ("sport", "Sportsmanship Award"),
}
# these carry a team number (1st/2nd/3rd) in ALL_NBA_TEAM_NUMBER
TEAMED = {
    "All-NBA":          ("allnba",  "All-NBA"),
    "All-Defensive Team": ("alldef", "All-Defensive"),
    "All-Rookie Team":  ("allrook", "All-Rookie"),
}
ORD = {"1": "1st Team", "2": "2nd Team", "3": "3rd Team"}

# rendered dictionary the page reads, so labels live in one place
def code_labels():
    out = {c: l for c, l in KEEP.values()}
    for c, l in TEAMED.values():
        for n, word in ORD.items():
            out[f"{c}{n}"] = f"{l} {word}"
    return out


def rows_for(pid):
    """[(season, code)] of season honours for one player. Never raises — a player with no
    awards and a player whose request failed both mean 'nothing to add', and one bad id
    must not abort a 3,800-call run."""
    try:
        df = E.call(playerawards.PlayerAwards, dict(player_id=int(pid)))
    except Exception as e:
        print(f"  ! {pid}: {repr(e)[:80]}")
        return None
    if df is None or not len(df):
        return []
    out = []
    for _, r in df.iterrows():
        # str() rather than a bare strip: the cache round-trips through pd.read_json, which
        # re-infers dtypes, so a SEASON that arrived as "1992" comes back as int 1992.
        desc = str(r.get("DESCRIPTION") or "").strip()
        season = str(r.get("SEASON") or "").strip()
        # Only real NBA season keys ("1987-88") are usable — the page looks awards up by that
        # exact string. Bare years belong to the non-season awards (Olympics, HOF induction)
        # this script drops anyway; writing them would just create keys nothing ever matches.
        if not SEASON_RE.match(season):
            continue
        if desc in KEEP:
            out.append((season, KEEP[desc][0]))
        elif desc in TEAMED:
            n = str(r.get("ALL_NBA_TEAM_NUMBER") or "").strip()
            n = n.split(".")[0]                      # "1.0" -> "1"
            code = TEAMED[desc][0] + (n if n in ORD else "1")
            out.append((season, code))
    return out


def resolve_br(br_ids, names, spans, taken=frozenset()):
    """Map Basketball-Reference-only ids ("br:jonesbo01") onto real NBA person ids.

    These rows exist because the build could not match the player to an NBA id — almost
    always a DUPLICATE NAME, not a missing player. The NBA does have ids for them, and
    skipping them silently loses real honours: br:jonesbo01 is the 1982-83 Sixth Man
    (the numeric 200784 "Bobby Jones" is a different, later player), and br:johnsed02 is
    the 1988-89 Sixth Man. So resolve by name, then disambiguate the duplicates by career
    span — the candidate whose FROM_YEAR..TO_YEAR actually covers the seasons this player
    appears in. A candidate that cannot be separated that way is left unresolved rather
    than guessed at, because attaching one man's MVP to another is far worse than a blank.
    """
    from nba_api.stats.static import players as SP
    by_name, by_last = {}, {}
    for p in SP.get_players():
        by_name.setdefault(p["full_name"].lower(), []).append(p["id"])
        by_last.setdefault(p["last_name"].lower(), []).append(p["id"])

    def span_filter(cands, want):
        """Keep only candidates whose NBA career actually covers the seasons this player
        appears in. One CommonPlayerInfo call each, disk-cached like everything else."""
        lo, hi = min(int(s[:4]) for s in want), max(int(s[:4]) for s in want)
        keep = []
        for c in cands:
            try:
                info = E.load_player_info(c)
                f, t = int(info["FROM_YEAR"][0]), int(info["TO_YEAR"][0])
            except Exception:
                continue
            if f <= lo and hi <= t:
                keep.append(c)
        return keep

    out, unresolved = {}, []
    for br in br_ids:
        want = spans.get(br) or set()
        cands = list(by_name.get((names.get(br) or "").lower(), []))
        if len(cands) > 1 and want:
            cands = span_filter(cands, want)
        # Fall back to the SURNAME when the full name misses, because the usual cause is a
        # nickname the NBA does not use: Tiny Archibald is "Nate" on nba.com, Fat Lever is
        # "Lafayette", Pearl Washington is "Dwayne". These are real All-Stars, so dropping
        # them would put visible holes in the honour rolls. Guards, in order: never reuse an
        # id the dataset already has under its own numeric row (that would copy one man's
        # honours onto another), require a RARE surname, and require the career span to
        # leave exactly one survivor.
        #
        # RARE means a pool of 4, and the number is measured rather than guessed. Every
        # nickname case that actually carries honours has a pool of 1 (Archibald, Lever,
        # Free, Richardson, Greenwood; Jo Jo White is the outlier at 4). Above that the
        # match stops being trustworthy: "Steve Smith" has a pool of 15 and — with the real
        # Steve Smith's id already taken — a span match happily returned a different Smith
        # entirely. Cutting here drops that whole tail and costs no honours at all, because
        # not one player in it has any.
        if not cands and want:
            pool = [c for c in by_last.get(_surname(names.get(br) or ""), []) if c not in taken]
            if 0 < len(pool) <= 4:
                cands = span_filter(pool, want)
        if len(cands) == 1:
            out[br] = cands[0]
        else:
            unresolved.append(br)
    print(f"  br ids: {len(out)} resolved to NBA ids, {len(unresolved)} unresolved")
    return out, unresolved


def _surname(full):
    return full.strip().lower().split()[-1] if full and full.strip() else ""


def main():
    ids = sys.argv[1:]
    aliases, unresolved = {}, []
    if not ids:
        d = json.load(open(SRC))
        seen, names, spans, br = {}, {}, {}, set()
        for s in d["seasons"]:
            for p in d["data"][s]["players"]:
                i = p.get("id")
                if i is None:
                    continue
                if not str(i).isdigit():
                    br.add(str(i))
                    names[str(i)] = p.get("name")
                    spans.setdefault(str(i), set()).add(s)
                    continue
                seen[int(i)] = 1
        aliases, unresolved = resolve_br(sorted(br), names, spans, taken=set(seen))
        ids = sorted(seen)
    print(f"awards: {len(ids)} players + {len(aliases)} recovered by alias")

    # (key the page looks awards up by, id to actually query). For aliased players those
    # differ: the page knows them as "br:jonesbo01", the NBA as 77193.
    todo = [(str(p), p) for p in ids] + [(k, v) for k, v in sorted(aliases.items())]

    players, failed, t0 = {}, [], time.time()
    for i, (key, pid) in enumerate(todo, 1):
        got = rows_for(pid)
        if got is None:
            failed.append(pid)
        elif got:
            by = {}
            for season, code in got:
                by.setdefault(season, [])
                if code not in by[season]:
                    by[season].append(code)
            players[key] = by
        if i % 100 == 0 or i == len(todo):
            rate = i / max(1e-9, time.time() - t0)
            left = (len(todo) - i) / max(1e-9, rate)
            print(f"  {i}/{len(todo)}  with awards: {len(players)}  failed: {len(failed)}"
                  f"  eta {left/60:.0f}m", flush=True)
            _write(players, failed, len(todo), unresolved)  # partial write: a crash loses nothing
    _write(players, failed, len(todo), unresolved)
    print(f"wrote {OUT} — {len(players)} players carry at least one season honour"
          + (f"; {len(failed)} failed" if failed else ""))


def _write(players, failed, n, unresolved=()):
    os.makedirs("out", exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
                   "queried": n, "failed": failed, "unresolved": list(unresolved),
                   "labels": code_labels(), "players": players}, f, separators=(",", ":"))
    os.replace(tmp, OUT)


if __name__ == "__main__":
    main()
