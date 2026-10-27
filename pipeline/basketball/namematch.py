"""
namematch.py — map another source's player names onto that season's NBA ids.

    m = Matcher(players)          # the season's archive players: [{"id", "name", "team"}]
    m.find("Clar. Weatherspoon", "GSW") -> 221

Tried in order, keeping the first unique answer: exact name + team, exact name, the same words in
another order ("Ha Seung-Jin"), surname + team, and surname with one first name a prefix of the
other ("Steve"/"Steven", "Rich"/"Richard"), and last the season's only player with that surname and
the same initial ("Isaac"/"Ike Austin"). Basketball
Reference, ESPN and the NBA spell a few hundred names differently across 30 seasons; these rules
match all but a handful, and a name that stays ambiguous is left out rather than guessed.
"""
import html
import re
import unicodedata
from collections import defaultdict

_EXTRA = str.maketrans({"ı": "i", "đ": "d", "Đ": "D", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "ß": "ss", "æ": "ae"})
_SUFFIX = re.compile(r"[ ,]+(jr|sr|ii|iii|iv|v)\.?$")


def words(name):
    s = html.unescape(name or "").replace("&apos;", "'").replace("apos;", "'")   # ESPN's older names: "N&apos;Dong"
    s = unicodedata.normalize("NFKD", s.translate(_EXTRA))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower().strip()
    s = _SUFFIX.sub("", s)                         # suffixes only at the end ("J.R. Smith" stays)
    return [w for w in (re.sub(r"[^a-z]", "", t) for t in re.split(r"[\s\-]+", s)) if w]


def norm(name):
    return "".join(words(name))


class Matcher:
    def __init__(self, players):
        self.nt, self.n, self.sorted, self.lt, self.last = (defaultdict(set) for _ in range(5))
        self.first = {}
        for p in players:
            w = words(p.get("name"))
            if not w:
                continue
            pid, team = p["id"], p.get("team") or ""
            self.nt[("".join(w), team)].add(pid)
            self.n["".join(w)].add(pid)
            self.sorted["".join(sorted(w))].add(pid)
            self.lt[(w[-1], team)].add(pid)
            self.last[w[-1]].add(pid)
            self.first[pid] = w[0]

    def find(self, name, team=""):
        w = words(name)
        if not w:
            return None
        nm = "".join(w)
        for cand in (self.nt.get((nm, team)), self.n.get(nm), self.sorted.get("".join(sorted(w))),
                     self.lt.get((w[-1], team))):
            if cand and len(cand) == 1:
                return next(iter(cand))
        pre = {pid for pid in self.last.get(w[-1], ())
               if self.first[pid].startswith(w[0]) or w[0].startswith(self.first[pid])}
        if len(w) > 1 and len(pre) == 1:
            return next(iter(pre))
        initial = {pid for pid in self.last.get(w[-1], ()) if self.first[pid][:1] == w[0][:1]}
        if len(w) > 1 and len(initial) == 1 and len(self.last.get(w[-1], ())) == 1:
            return next(iter(initial))             # the only player with that surname, same initial
        return None
