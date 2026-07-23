"""Exact full-name matching of headline text against the Savant player index.

Design rule from the spec: a wrong player link is worse than a missing one.
So: exact full-name matches only (after light unicode/punct normalization),
never fuzzy; any full name that collides across two different players is
treated as ambiguous and never matched.
"""
import json
import re
import unicodedata

from . import config

_WORD = re.compile(r"[a-z0-9]+")


def _norm(text):
    """Lowercase, strip accents, collapse to single-spaced alnum tokens."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(_WORD.findall(text.lower()))


class PlayerIndex:
    def __init__(self, by_norm, players_by_id, ambiguous):
        self.by_norm = by_norm            # normalized full name -> player id
        self.players_by_id = players_by_id
        self.ambiguous = ambiguous        # set of normalized names skipped
        # Longest names first so "Jaylen Brown" matches before "Jaylen".
        self._names = sorted(by_norm, key=lambda n: -len(n))

    @classmethod
    def load(cls, path=None, season=None, log=None):
        path = path or config.SAVANT_PLAYERS_JSON
        with open(path) as fh:
            doc = json.load(fh)
        # Current season = first in the seasons list (newest).
        season = season or doc["seasons"][0]
        roster = doc["data"][season]["players"]

        by_norm, players_by_id, name_counts = {}, {}, {}
        for p in roster:
            full = (p.get("name") or "").strip()
            if " " not in full:            # need a real full name
                continue
            norm = _norm(full)
            if not norm:
                continue
            players_by_id[str(p["id"])] = {"id": str(p["id"]), "name": full}
            name_counts[norm] = name_counts.get(norm, 0) + 1
            by_norm.setdefault(norm, str(p["id"]))

        ambiguous = {n for n, c in name_counts.items() if c > 1}
        for n in ambiguous:
            by_norm.pop(n, None)
        if log:
            log.info("player index: %d names (%d ambiguous skipped) from %s",
                     len(by_norm), len(ambiguous), season)
        return cls(by_norm, players_by_id, ambiguous)

    def match(self, *texts, cap=config.MAX_CHIPS):
        """Return up to `cap` player chips whose full name appears in the text.

        Match is on whole-token boundaries within the normalized text, first
        appearance wins, de-duplicated by player id.
        """
        hay = " " + _norm(" ".join(t for t in texts if t)) + " "
        found, seen = [], set()
        for name in self._names:
            pid = self.by_norm[name]
            if pid in seen:
                continue
            if f" {name} " in hay:
                player = self.players_by_id[pid]
                found.append({
                    "name": player["name"],
                    "savant_url": config.savant_url(pid),
                    "_pos": hay.find(f" {name} "),
                })
                seen.add(pid)
        found.sort(key=lambda c: c["_pos"])
        for c in found:
            c.pop("_pos", None)
        return found[:cap]
