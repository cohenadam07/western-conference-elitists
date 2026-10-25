"""
br_crosswalk.py — identity + team reconciliation for the historical backfill.

Identity: nba_api person-ids are the same ids the live players.json already keys on, so
if every BR player-season is stamped with its canonical NBA person-id, cross-1996 careers
merge in the front-end automatically (PIDX unions seasons by p.id). We resolve BR name ->
NBA person-id against nba_api's *offline* static player list. Unique-name matches (the
overwhelming majority — only ~38 collisions in ~5,000 names) win outright; ambiguous or
unmatched players keep a "br:<id>" canonical id (headshot then falls back to initials).

Teams: a historical abbreviation -> franchise map so relocated/renamed teams read right
(Bullets->Wizards, Sonics, KC Kings->Sacramento, etc.).
"""
import unicodedata

def _norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower())
                   if unicodedata.category(c) != "Mn").strip()

_NAME_TO_ID = None
def _name_index():
    global _NAME_TO_ID
    if _NAME_TO_ID is None:
        from nba_api.stats.static import players as SP
        idx = {}
        for p in SP.get_players():
            idx.setdefault(_norm(p["full_name"]), []).append(p["id"])
        _NAME_TO_ID = idx
    return _NAME_TO_ID

def canonical_id(br_id, name):
    """NBA person-id (int) for a uniquely-named BR player, else 'br:<id>' (str)."""
    ids = _name_index().get(_norm(name), [])
    if len(ids) == 1:
        return ids[0]
    return f"br:{br_id}"

# Historical BR abbreviation -> (display abbr, full franchise name). Only entries that
# differ from the modern abbr or need a name are listed; anything absent passes through.
TEAM_MAP = {
    "WSB": ("WAS", "Washington Bullets"),
    "SDC": ("LAC", "San Diego Clippers"),
    "KCK": ("SAC", "Kansas City Kings"),
    "NJN": ("BKN", "New Jersey Nets"),
    "SEA": ("OKC", "Seattle SuperSonics"),
    "VAN": ("MEM", "Vancouver Grizzlies"),
    "CHH": ("CHA", "Charlotte Hornets"),
    "NOJ": ("UTA", "New Orleans Jazz"),
    "SDR": ("HOU", "San Diego Rockets"),
    "PHO": ("PHX", "Phoenix Suns"),
    "GOS": ("GSW", "Golden State Warriors"),
    "UTH": ("UTA", "Utah Jazz"),
}

def team_display(abbr):
    """Franchise full name for a (possibly historical) abbreviation, for labels/tooltips."""
    return TEAM_MAP.get(abbr, (abbr, abbr))[1]

def apply_crosswalk(entries_by_brid):
    """Rewrite a {br_id: entry} dict so each entry.id is its canonical NBA person-id.
    Returns (list_of_entries, stats). Adds entry['br_id'] (original) + entry['team_name']."""
    out, matched, ambig = [], 0, 0
    for bid, e in entries_by_brid.items():
        cid = canonical_id(bid, e.get("name", ""))
        e["br_id"] = bid
        e["id"] = cid
        e["team_name"] = team_display(e.get("team", ""))
        if isinstance(cid, int):
            matched += 1
        else:
            ambig += 1
        out.append(e)
    return out, dict(matched=matched, ambiguous=ambig, total=len(out))
