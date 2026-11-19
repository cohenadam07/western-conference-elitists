"""
accents.py — one rule for every Savant's refresh: a name that equals a known spelling of the same
player with the accents stripped is the same name, and the accented spelling wins. A name with
different letters is a real change and goes through. (Adam, Nov 19 2026.)

Why: the in-season sources (nflverse rosters for Football Savant, ESPN for the others) often drop
diacritics that the archive's sources keep, so a refresh would quietly turn "Audric Estimé" into
"Audric Estime" on the card, in search and in the connector.

    from accents import keep_accents, canonical, strip
    name = keep_accents(new_name, known_names)      # one player
    fixed = canonical(all_spellings_of_one_player)  # {spelling: spelling to show}
"""
import unicodedata


def strip(name):
    """The name with every combining mark removed (é -> e, ć -> c), nothing else changed."""
    s = unicodedata.normalize("NFKD", str(name))
    s = "".join(c for c in s if not unicodedata.combining(c))
    # letters with no decomposition (ł, ø, đ, ß…) map to their usual plain letter
    return unicodedata.normalize("NFC", s.translate(_PLAIN))


_PLAIN = str.maketrans({"ł": "l", "Ł": "L", "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ß": "ss", "æ": "ae", "Æ": "AE",
                        "œ": "oe", "Œ": "OE", "ı": "i"})


def accented(name):
    return strip(name) != unicodedata.normalize("NFC", str(name))


def keep_accents(new, known):
    """The spelling to keep for a player whose source now says `new`, given the spellings already
    published for him (`known`). If `new` has no accents and an accented known spelling strips to
    exactly `new`, the accented one stays; otherwise `new` stands (a real change, or new accents)."""
    if new is None or accented(new):
        return new
    for k in known or ():
        if k and k != new and accented(k) and strip(k) == new:
            return k
    return new


def canonical(spellings):
    """{spelling: what to show} over all spellings of one player: every de-accented spelling maps to
    its accented twin (the most accented one if several), every other spelling to itself."""
    sp = [s for s in set(spellings) if s]
    out = {s: s for s in sp}
    for s in sp:
        twins = [k for k in sp if k != s and accented(k) and strip(k) == s and not accented(s)]
        if twins:
            out[s] = max(twins, key=lambda k: (sum(1 for a, b in zip(k, strip(k)) if a != b), k))
    return out


def known_by_id(pairs):
    """{id (as str): {spellings}} from (id, name) pairs."""
    out = {}
    for i, n in pairs:
        if n:
            out.setdefault(str(i), set()).add(n)
    return out


def fix_players(players, known, id_key="id", name_key="name"):
    """Apply keep_accents to a list of player dicts in place, against `known` ({id: {spellings}})
    and the other spellings in `players` itself. Returns how many names were kept accented."""
    own = known_by_id((p.get(id_key), p.get(name_key)) for p in players)
    n = 0
    for p in players:
        i, name = str(p.get(id_key)), p.get(name_key)
        keep = keep_accents(name, (known.get(i) or set()) | (own.get(i) or set()))
        if keep != name:
            p[name_key] = keep
            n += 1
    return n


def college_known(public_dir, sport, skip_season=None):
    """{id: {spellings}} from a college Savant's published season files (public/<sport>/s/*.json.gz)."""
    import glob, gzip, json, os
    out = {}
    for f in glob.glob(os.path.join(public_dir, sport, "s", "*.json*")):
        try:
            d = json.load(gzip.open(f)) if f.endswith(".gz") else json.load(open(f, encoding="utf-8"))
        except Exception:  # noqa: a file being written; the rule just has less to go on
            continue
        if skip_season is not None and str(d.get("season")) == str(skip_season):
            continue
        i, n = d["cols"].index("id"), d["cols"].index("name")
        for r in d["players"]:
            if r[n]:
                out.setdefault(str(r[i]), set()).add(r[n])
    return out
