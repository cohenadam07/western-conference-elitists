"""Near-duplicate grouping and ranking for headline items."""
from .util import normalize_title, parse_iso, now_utc

# Token-overlap threshold for treating two headlines as the same story.
SIM_THRESHOLD = 0.6
# Two short headlines must share at least this many meaningful tokens to merge —
# a single common word (e.g. a team name in two different transactions) is not
# enough. Same-story reports from different outlets share the subject's name plus
# more, so this doesn't block legitimate duplicates.
MIN_SHARED = 2
# Ignore ultra-common basketball words when judging similarity.
_STOP = {"nba", "game", "season", "team", "report", "says", "news", "vs"}


def _meaningful(a, b):
    return (a - _STOP), (b - _STOP)


def _similar(a, b):
    """Overlap ratio = |A∩B| / min(|A|,|B|) on meaningful tokens."""
    a, b = _meaningful(a, b)
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def group_stories(items):
    """Greedily cluster near-duplicate items. Returns list of clusters (lists)."""
    keyed = []
    for it in items:
        clean, tokens = normalize_title(it["title"])
        keyed.append((it, clean, tokens))

    clusters = []          # list of {"members": [...], "tokens": set}
    for it, clean, tokens in keyed:
        placed = False
        for cl in clusters:
            if clean and clean == cl["clean"]:
                cl["members"].append(it)
                placed = True
                break
            a, b = _meaningful(tokens, cl["tokens"])
            if len(a & b) >= MIN_SHARED and _similar(tokens, cl["tokens"]) >= SIM_THRESHOLD:
                cl["members"].append(it)
                cl["tokens"] |= tokens
                placed = True
                break
        if not placed:
            clusters.append({"members": [it], "tokens": set(tokens), "clean": clean})
    return [cl["members"] for cl in clusters]


def _published_key(item):
    dt = parse_iso(item.get("published"))
    return dt or now_utc()


def rank_clusters(clusters, player_hits=None):
    """Collapse each cluster to a canonical item and score it.

    player_hits: optional {item_id: [players]} to boost stories that name a
    player in the Savant index. Ranking key = (#outlets, names_player, recency).
    """
    player_hits = player_hits or {}
    ranked = []
    for members in clusters:
        members_sorted = sorted(members, key=_published_key)  # earliest first
        canonical = members_sorted[0]
        outlets = []
        for m in members_sorted:
            if m["outlet"] not in outlets:
                outlets.append(m["outlet"])
        also = [o for o in outlets if o != canonical["outlet"]]

        # Chips come ONLY from the canonical headline we actually display — never
        # unioned from merged siblings. A wrong player link is worse than a missing
        # one, so if the shown headline doesn't name the player, no chip.
        players = player_hits.get(canonical["id"], [])

        recency = max(_published_key(m) for m in members_sorted)
        score = (len(outlets), 1 if players else 0, recency.timestamp())
        ranked.append({
            "id": canonical["id"],
            "title": canonical["title"],
            "url": canonical["url"],
            "outlet": canonical["outlet"],
            "published": canonical["published"],
            "summary": canonical.get("summary", ""),  # RSS blurb, for the WCE line
            "also_covered_by": also,
            "players": players[:3],
            "_score": score,
            "_n_outlets": len(outlets),
        })
    ranked.sort(key=lambda r: r["_score"], reverse=True)
    return ranked
