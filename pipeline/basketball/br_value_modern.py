"""
br_value_modern.py — backfill the value bars (PER/WS48/BPM/OBPM/DBPM/VORP) onto the
1996-97 → present seasons by joining Basketball Reference's Advanced table to the nba_api
players on normalized name within each season. nba_api carries none of these, so this is
purely additive; every era then shows the same BR-sourced value bars.

Matching is per-season and unique-both-sides, in two passes (attach() below, shared with
refresh_current.py's live season):
  1. exact: a BR name that normalizes (br_crosswalk._norm) to exactly one nba_api player that
     season, and vice-versa. This was the only pass until Nov 2026.
  2. the leftovers on both sides through namematch.Matcher, the matcher the other BR tables use:
     suffixes ("Jimmy Butler III" / "Jimmy Butler"), punctuation ("A.J. Green" / "AJ Green"),
     word order, and a first name that is a prefix of the other. Its looser last rules (surname
     plus initial) are not used here: an answer must still be unique both ways, and the
     Matcher only sees players pass 1 left unmatched, so nothing pass 1 attached can move.
Ambiguous or unmatched names are left null (those bars just render n/a). Run AFTER build_gap
so all 1996+ seasons exist in players.json.

    python br_value_modern.py
"""
import json, os
import br_fetch as BR
import br_crosswalk as X   # reuse the same name normalizer

OUT = os.path.join("out", "players.json")
VALUE_KEYS = ["per", "ws48", "bpm", "obpm", "dbpm", "vorp"]

def _strict(matcher, name):
    """namematch.Matcher.find without its surname-and-initial fallbacks."""
    from namematch import words
    w = words(name)
    if not w:
        return None
    nm = "".join(w)
    for cand in (matcher.n.get(nm), matcher.sorted.get("".join(sorted(w)))):
        if cand and len(cand) == 1:
            return next(iter(cand))
    pre = {pid for pid in matcher.last.get(w[-1], ())
           if matcher.first[pid].startswith(w[0]) or w[0].startswith(matcher.first[pid])}
    if len(w) > 1 and len(pre) == 1:
        return next(iter(pre))
    return None


def attach(players, badv, log=None):
    """Put BR's value bars on a season's players (see the module note). Returns how many."""
    from namematch import Matcher
    br_by_name = {}
    for r in badv.values():
        br_by_name.setdefault(X._norm(r["name"]), []).append(r)
    nb_by_name = {}
    for p in players:
        nb_by_name.setdefault(X._norm(p["name"]), []).append(p)

    pairs, used_br, used_nb = [], set(), set()
    for name, brs in br_by_name.items():                      # 1. exact
        nbs = nb_by_name.get(name)
        if not nbs or len(brs) != 1 or len(nbs) != 1:
            continue
        pairs.append((brs[0], nbs[0]))
        used_br.add(id(brs[0])); used_nb.add(nbs[0]["id"])

    left_nb = [p for p in players if p["id"] not in used_nb]   # 2. the leftovers, strictly
    by_id = {p["id"]: p for p in left_nb}
    m = Matcher(left_nb)
    hits = {}
    for r in badv.values():
        if id(r) in used_br:
            continue
        pid = _strict(m, r["name"])
        if pid is not None:
            hits.setdefault(pid, []).append(r)
    for pid, rs in hits.items():
        if len(rs) == 1:
            pairs.append((rs[0], by_id[pid]))
            if log:
                log(rs[0]["name"], by_id[pid]["name"])

    for r, p in pairs:
        for k in VALUE_KEYS:
            if r.get(k) is not None:
                p["m"].setdefault(k, {})["season"] = {"v": r[k], "n": None}
    return len(pairs)


def build():
    payload = json.load(open(OUT))
    attached = seasons_done = 0
    for ey in BR.MODERN_END_YEARS:
        season = BR.season_label(ey)
        sd = payload["data"].get(season)
        if not sd or not sd.get("players"):
            continue
        try:
            badv = BR.load_advanced(ey)   # {br_id: {name, per, ...}}
        except Exception as e:
            print(f"  {season}: BR advanced unavailable ({repr(e)[:70]})"); continue

        n = attach(sd["players"], badv)
        attached += n; seasons_done += 1
        print(f"  {season}: attached value bars to {n}/{len(sd['players'])} players")

    import safe_io; safe_io.dump_json(OUT, payload)
    print(f"done — value bars on {attached} player-seasons across {seasons_done} modern seasons")

if __name__ == "__main__":
    build()
