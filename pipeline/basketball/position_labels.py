"""
position_labels.py — Guard / Wing / Big from the position estimate.

    python3 position_labels.py archive [--public ../../public] [--report ../../out]
    python3 position_labels.py current [--public ../../public]

The label used to be `savant_config.position_bucket` of PlayerIndex's one career string, which
never looks at what a player does: Adem Bona played 96% of his minutes at center and was a Wing,
because the NBA lists him as a forward. Basketball Reference's play-by-play table already says
how each player's minutes split across the five positions (seed/ext-br/, the card's Position
estimate panel), so the label now comes from that, per season, and the two cannot disagree.

Adam's rule, read straight from the estimate:

    primary PG or SG   Guard
    primary SF         Wing
    primary C          Big
    primary PF         C second at 10% or more: Big. SF + SG second at 10% or more: Wing.
                       Neither reaches 10%: a pure 4, and his role breaks the tie.

Nothing else moves a label, so a label can always be explained in a line, and the card does:
"Plays the 4 first and the 5 second, so he is compared with bigs." (public/savant-pos.js).

A pure 4 (Paolo Banchero's 2025-26 is PF 95, C 5) has an estimate that cannot say what he is, so the
role scale does: 0 plays like the season's average wing, 1 like its average big (SCORE_WEIGHTS), on
rebounds, rim protection, inside finishing and a low three-point rate, and from low usage and low
assists, which are measured against guards rather than wings because wings and bigs barely differ
on them (2025-26: 19.4 and 17.7 usage). So creators and shooters go Wing. A pure 4 at 0.42 or more
is a Big. From 0.38 to 0.45 the answers on the players Adam listed don't change, and 0.42 is the
middle of that. A season without a stat is scored on the ones it has, the averages are that
season's, and a young season pools with prior seasons to 400 minutes, a rookie with his Draft Savant
position for the rest. seed/big_scale.json carries the scale to the nightly refresh, which scores
the season in progress against the last finished season.

position-review.csv lists every pure 4 and how he broke.

A player with no estimate at all (a rookie on a night Basketball Reference has none for him) goes
down a chain: his own estimate from the stints, then his Draft Savant position, then the listed
one. A five has one of each position, so what the four men beside him leave unfilled is what he
plays: stint_estimate() sums that over the units he played in, by seconds, which also credits him
with the spot of whoever he came in for. Tested on an earlier version of the rule, on 1,195 player-seasons (2023-24 to 2025-26, 400+
minutes) by hiding his own estimate, the stints name Basketball Reference's label 81.7% of the time
against 75.1% for the listed position, and they lean toward calling bigs wings. On the 145 rookies
and second-year players: stints 85.5%, Draft Savant 84.8%, listed 75.9%.

A season's own estimate needs 400 minutes. Under that it names the same group as his next full
season about 77% of the time, over it 81-85%; below 400 there is no further decay (73-81% at any
size), so the floor is about the step, not the slope. A young season is pooled, weighted by minutes,
with his prior seasons until it reaches 400. A player with no prior seasons uses what he has: even
a thin estimate agrees with next year far more often than a career string does, and it is what the
panel beside the label shows. Today's label is only for a player with no estimate at all, which
means 1979-80 to 1995-96 (Basketball Reference's table starts in 1996-97) and a few rows since.

The panel shows the same numbers the label was read from: when a label comes from a pool, the row
carries `posx` {pe, mp, from} and the card and connector show that. Rows keep today's label in
`pos0` when the two differ, which also makes the archive pass safe to run twice.
"""
import argparse
import csv
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, "seed", "ext-br")

SLOTS = ["PG", "SG", "SF", "PF", "C"]
SECOND_MIN = 10.0          # a second position counts from here
PURE_4_BIG = 0.42          # a pure 4 this high on the role scale is a Big, see the docstring
SCORE_WEIGHTS = dict(reb75=2.0, blk=1.5, rim=1.0, rimfreq=1.0, ppaint=1.0, dunk75=0.5, tp3r=2.0,
                     usg=1.0, ast75=1.0)
SCORE_EXT = ("rimfreq", "dunk75")   # these live in savant-ext/s, the rest on the card
CREATOR = ("usg", "ast75")          # measured from guards to bigs, the rest from wings to bigs
SCALE = os.path.join(HERE, "seed", "big_scale.json")
MIN_MINUTES = 400          # a season's own estimate stands from here (see the docstring)
STINT_MIN_SECONDS = 1800   # lineup time a stint estimate needs: under this the listed position is as good


def shares(pe):
    """A five-slot estimate and the index of its largest (the lower slot on a tie). The shares are
    read as published: Basketball Reference rounds them, so they can sum to 101, and rescaling that
    would turn a C of 10 into 9.9."""
    q = list(pe)
    return q, max(range(5), key=lambda i: q[i])


def is_pure_4(pe):
    """PF first, with neither C nor SF + SG at 10%."""
    q, first = shares(pe)
    return first == 3 and q[4] < SECOND_MIN and q[1] + q[2] < SECOND_MIN


def classify(pe, today=None, score=None):
    """Guard / Wing / Big. `score` is the role scale, read only for a pure 4; without one he keeps
    today's label if it can be his, and is otherwise a Wing."""
    q, first = shares(pe)
    if first <= 1:
        return "Guard"
    if first == 2:
        return "Wing"
    if first == 4:
        return "Big"
    if not is_pure_4(pe):
        return "Big" if q[4] >= q[1] + q[2] else "Wing"
    if score is None:
        return "Big" if today == "Big" else "Wing"
    return "Big" if score >= PURE_4_BIG else "Wing"


# ------------------------------------------------------------------ the role scale
def _cell(p, key):
    return ((p.get("m", {}).get(key) or {}).get("season") or {}).get("v")


def features(p, ext=None):
    """The stats the scale reads, for one player-season. `ext` is his savant-ext/s row, for a file
    that has been split; the refresh still has those stats on the row."""
    v = {k: _cell(p, k) for k in SCORE_WEIGHTS}
    if ext:
        for k, x in ext.items():
            if v.get(k) is None:
                v[k] = x
    return {k: x for k, x in v.items() if x is not None}


def season_refs(rows):
    """{stat: [the wing end, the big end]} over a season's qualified players, from (pe, features):
    players whose first position is SF and C, and for the creator stats PG or SG and C."""
    wing, big, guard = {}, {}, {}
    for pe, v in rows:
        first = shares(pe)[1]
        side = big if first == 4 else wing if first == 2 else guard if first <= 1 else None
        if side is None:
            continue
        for k, x in v.items():
            side.setdefault(k, []).append(x)
    out = {}
    for k in SCORE_WEIGHTS:
        low = guard if k in CREATOR else wing
        if len(low.get(k, ())) >= 15 and len(big.get(k, ())) >= 15:
            out[k] = [sum(low[k]) / len(low[k]), sum(big[k]) / len(big[k])]
    return out


def raw_score(v, refs):
    """0 plays like the season's average wing, 1 like its average big. None if no stat reaches."""
    total = weight = 0.0
    for k, w in SCORE_WEIGHTS.items():
        if k not in v or k not in refs or refs[k][0] == refs[k][1]:
            continue
        a, b = refs[k]
        total += w * max(-0.5, min(1.5, (v[k] - a) / (b - a)))
        weight += w
    return total / weight if weight else None


def pooled_score(seasons, season, draft_pos=None):
    """`seasons` {season: [score, minutes]} of one player. Pooled like the estimate, to 400 minutes."""
    total = used = 0.0
    for s in sorted((s for s in seasons if s <= season), reverse=True):
        score, minutes = seasons[s]
        if score is None or not minutes:
            continue
        take = min(minutes, MIN_MINUTES - used)
        total += score * take
        used += take
        if used >= MIN_MINUTES:
            break
    if not used:
        return None
    if used < MIN_MINUTES and draft_pos:
        total += (1.0 if draft_pos == "Big" else 0.0) * (MIN_MINUTES - used)
        used = MIN_MINUTES
    return total / used


def draft_pos_of(draft, name, season):
    from namematch import norm
    year, pos = draft.get(norm(name), (0, None))
    return pos if pos and year >= int(season[:4]) - 1 else None


def _row_est(b):
    pe = [float(str(b.get(f"pct_{i}") or 0).replace("%", "") or 0) for i in range(1, 6)]
    mp = float(str(b.get("mp") or "0").replace(",", "") or 0)
    return (pe, mp) if sum(pe) > 0 else None


def history(seed=SEED):
    """{pid: {season: (pe, minutes)}} from the Basketball Reference rows in the seed."""
    out = {}
    for f in sorted(glob.glob(os.path.join(seed, "*.json"))):
        season = os.path.basename(f)[:-5]
        for pid, b in json.load(open(f)).items():
            e = _row_est(b)
            if e:
                out.setdefault(int(pid), {})[season] = e
    return out


def resolve(hist_rows, season, own=None):
    """(pe, minutes, from_season, seasons used) for one player-season, or None without an
    estimate. `own` is this season's (pe, minutes) where it isn't in the history yet."""
    rows = dict(hist_rows or {})
    if own:
        rows[season] = own
    use, mp = [], 0.0
    for s in sorted((s for s in rows if s <= season), reverse=True):
        use.append(s)
        mp += rows[s][1]
        if mp >= MIN_MINUTES:
            break
    if not use:
        return None
    if len(use) == 1:
        return rows[use[0]][0], rows[use[0]][1], use[0], 1
    if mp <= 0:
        pe = rows[use[0]][0]
    else:
        pe = [sum(rows[s][0][i] * rows[s][1] for s in use) / mp for i in range(5)]
    return pe, mp, use[-1], len(use)


def label_row(p, hist_rows, season, own=None, score=None):
    """Set p["pos"] from the estimate and the big score, in place. Returns what happened."""
    today = p.get("pos0") or p.get("pos")
    p.pop("pos0", None)
    p.pop("posx", None)
    r = resolve(hist_rows, season, own)
    if r is None:
        p["pos"] = today
        return dict(today=today, pos=today, src="today", pure4=False, pe=None, mp=0)
    pe, mp, first, n = r
    lab = classify(pe, today, score)
    p["pos"] = lab
    if lab != today:
        p["pos0"] = today
    if n > 1:
        # a pool, so the panel has to show the pool
        p["posx"] = dict(pe=[round(x) for x in pe], mp=round(mp), **{"from": first})
    return dict(today=today, pos=lab, src="pooled" if n > 1 else "season", pure4=is_pure_4(pe), pe=pe, mp=mp)


def stint_estimate(doc, pid, known):
    """His five shares from what the men beside him leave unfilled, or None. `doc` is a With/Without
    team file (units of five with their seconds), `known` {id: five shares} for his teammates. A unit
    with a man we know nothing about tells us nothing and is skipped."""
    ids = [p[0] for p in doc["players"]]
    totals, sec = [0.0] * 5, 0.0
    for unit in doc["units"]:
        five, seconds = [ids[i] for i in unit[0]], unit[1]
        if pid not in five or seconds <= 0:
            continue
        mates = [known.get(x) for x in five if x != pid]
        if any(m is None for m in mates):
            continue
        filled = [sum(100.0 * m[i] / (sum(m) or 1.0) for m in mates) for i in range(5)]
        left = [max(0.0, 100.0 - x) for x in filled]
        t = sum(left)
        if t <= 0:
            continue
        for i in range(5):
            totals[i] += seconds * 100.0 * left[i] / t
        sec += seconds
    if sec < STINT_MIN_SECONDS:
        return None
    return [x / sec for x in totals], sec


def _ww_doc(public, team, season):
    import gzip
    try:
        with gzip.open(os.path.join(public, "bcs", "ww", f"{team}-{season}.json.gz"), "rt") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def draft_positions(public):
    """{normalized name: (draft year, Guard / Wing / Big)} from Draft Savant's prospects."""
    from namematch import norm
    try:
        with open(os.path.join(public, "data.json")) as fh:
            rows = json.load(fh).get("players") or []
    except (OSError, ValueError):
        return {}
    out = {}
    for r in rows:
        if r.get("pos") in ("Guard", "Wing", "Big") and r.get("name"):
            year = int(r.get("draft_year") or 0)
            k = norm(r["name"])
            if year >= out.get(k, (0, None))[0]:
                out[k] = (year, r["pos"])
    return out


def public_dir():
    return os.environ.get("SAVANT_PUBLIC") or os.path.join(HERE, "..", "..", "public")


def apply_fallbacks(season, rows, known, public=None, score_of=None):
    """`rows` have no estimate of any kind. Stints, then Draft Savant, then the listed label."""
    from namematch import norm
    public = public or public_dir()
    score_of = score_of or (lambda p: None)
    draft = draft_positions(public)
    first_year = int(season[:4]) - 1
    docs, tally = {}, dict(stints=0, draft=0, listed=0)
    for p in rows:
        today = p.get("pos0") or p.get("pos")
        team = p.get("team")
        if team not in docs:
            docs[team] = _ww_doc(public, team, season)
        est = stint_estimate(docs[team], p["id"], known) if docs[team] else None
        if est:
            pe, sec = est
            lab = classify(pe, today, score_of(p))
            p["pos"] = lab
            p["posx"] = dict(pe=[round(x) for x in pe], mp=round(sec / 60), **{"from": season}, src="stints")
            src = "stints"
        else:
            year, pos = draft.get(norm(p["name"]), (0, None))
            lab = pos if pos and year >= first_year else today
            p["pos"] = lab
            src = "draft" if pos and year >= first_year else "listed"
            if src == "draft":
                p["pos_src"] = "draft"
        if lab != today:
            p["pos0"] = today
        tally[src] += 1
    return tally


def read_scale():
    try:
        with open(SCALE) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def apply_season(season, players, seed=SEED, hist=None, public=None, ext=None):
    """The season in progress (refresh_current.py). `pe` is what ext_engine.br_pass left on the
    rows, or br_keep.py carried over; a player with no estimate for this season falls back to his
    prior seasons, and one with neither goes down apply_fallbacks(). Scored against the last
    finished season; `ext` {pid: {stat: value}} is for rows whose ext stats are already split off."""
    hist = hist if hist is not None else history(seed)
    public = public or public_dir()
    scale = read_scale()
    refs = scale["refs"][max(scale["refs"])] if scale else None
    draft = draft_positions(public)

    def score_of(p):
        if not refs:
            return None
        mp = (((p.get("m") or {}).get("minshare") or {}).get("season") or {}).get("n")
        seasons = dict(scale["scores"].get(str(p["id"])) or {})
        seasons[season] = [raw_score(features(p, (ext or {}).get(p["id"])), refs), float(mp or 0)]
        return pooled_score(seasons, season, draft_pos_of(draft, p["name"], season))

    changed = 0
    known, none = {}, []
    for p in players:
        pe = p.get("pe")
        mp = (((p.get("m") or {}).get("minshare") or {}).get("season") or {}).get("n")
        own = (pe, float(mp or 0)) if pe and sum(pe) > 0 else None
        res = label_row(p, hist.get(p["id"]), season, own, score_of(p))
        if res["pe"] is None:
            none.append(p)
        else:
            known[p["id"]] = res["pe"]
        if res["pos"] != p.get("pos0", p["pos"]):
            changed += 1
    if none:
        tally = apply_fallbacks(season, none, known, public, score_of)
        print(f"  position labels: {len(none)} with no estimate: {tally}")
    return changed


def relabel_prior(season, universe, seed=SEED):
    """Before the engine runs: labels from prior seasons alone, so what the engine derives from
    position (the Guardometer, defensive role) doesn't start from the career string."""
    hist = history(seed)
    for pid, p in universe.items():
        h = {s: v for s, v in (hist.get(pid) or {}).items() if s < season}
        if h:
            label_row(p, h, season)
    return universe


# ------------------------------------------------------------------ the archive
def _minutes(hist_rows, season):
    e = (hist_rows or {}).get(season)
    return round(e[1]) if e else 0


def _ext_rows(public, season):
    """{pid: {stat: value}} of the score's stats out of a savant-ext/s file."""
    try:
        with open(os.path.join(public, "savant-ext", "s", f"{season}.json")) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return {}
    ix = {k: doc["keys"].index(k) for k in SCORE_EXT if k in doc["keys"]}
    out = {}
    for pid, wins in doc["players"].items():
        row = wins.get("season")
        if row:
            out[int(pid)] = {k: row[i][0] for k, i in ix.items() if row[i]}
    return out


def score_archive(d, hist, public):
    """Every player-season's raw big score and minutes, and each season's averages."""
    refs, scores = {}, {}
    for season, blk in d["data"].items():
        if season < "1996-97":
            continue
        ext = _ext_rows(public, season)
        rows, feats = [], {}
        for p in blk["players"]:
            if not isinstance(p.get("id"), int):
                continue
            v = features(p, ext.get(p["id"]))
            feats[p["id"]] = (p, v)
            r = resolve(hist.get(p["id"]), season)
            if r and p.get("qualified"):
                rows.append((r[0], v))
        refs[season] = season_refs(rows)
        for pid, (p, v) in feats.items():
            mp = (((p.get("m") or {}).get("minshare") or {}).get("season") or {}).get("n") or 0
            s = raw_score(v, refs[season])
            scores.setdefault(str(pid), {})[season] = [None if s is None else round(s, 3), mp]
    return refs, scores


def cmd_archive(public, report):
    path = os.path.join(public, "savant-data.json")
    d = json.load(open(path))
    hist = history()
    refs, scores = score_archive(d, hist, public)
    with open(SCALE, "w") as fh:
        json.dump(dict(weights=SCORE_WEIGHTS, refs={k: {a: [round(x, 3) for x in b] for a, b in v.items()} for k, v in refs.items()},
                       scores=scores), fh, separators=(",", ":"))
    draft = draft_positions(public)
    before, after, q_before, q_after = {}, {}, {}, {}
    changes, pures = [], []
    for season, blk in d["data"].items():
        for p in blk["players"]:
            own = hist.get(p["id"]) if isinstance(p.get("id"), int) else None
            sc = None
            if isinstance(p.get("id"), int) and season >= "1996-97":
                sc = pooled_score(scores.get(str(p["id"])) or {}, season, draft_pos_of(draft, p["name"], season))
            res = label_row(p, own, season, score=sc)
            for tally, q, lab in ((before, q_before, res["today"]), (after, q_after, res["pos"])):
                tally[lab] = tally.get(lab, 0) + 1
                if p.get("qualified"):
                    q[lab] = q.get(lab, 0) + 1
            row = dict(season=season, id=p["id"], name=p["name"], team=p.get("team"),
                       minutes=_minutes(own, season),
                       qualified=bool(p.get("qualified")), today=res["today"], new=res["pos"],
                       source=res["src"], pe=[round(x) for x in res["pe"]] if res["pe"] else None)
            if res["pos"] != res["today"]:
                changes.append(row)
            if res["pure4"]:
                row["score"] = None if sc is None else round(sc, 2)
                pures.append(row)

    with open(path, "w") as fh:
        json.dump(d, fh, separators=(",", ":"))

    os.makedirs(report, exist_ok=True)
    head = ["rank", "season", "player", "id", "team", "minutes", "qualified", "today", "new",
            "source", *SLOTS, "score"]
    for name, rows in (("position-changes.csv", changes), ("position-review.csv", pures)):
        rows.sort(key=lambda r: (-r["minutes"], r["season"], str(r["id"])))
        with open(os.path.join(report, name), "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(head)
            for i, r in enumerate(rows, 1):
                w.writerow([i, r["season"], r["name"], r["id"], r["team"], r["minutes"], r["qualified"],
                            r["today"], r["new"], r["source"], *(r["pe"] or [""] * 5), r.get("score", "")])

    def shares(t):
        n = sum(t.values())
        return {k: round(100 * t.get(k, 0) / n, 1) for k in ("Guard", "Wing", "Big")}
    print(f"changed {len(changes):,}, pure 4s {len(pures):,}")
    print("all seasons     ", shares(before), "->", shares(after))
    print("qualified       ", shares(q_before), "->", shares(q_after))
    return 0


def cmd_current(public):
    """savant-current.json as published, with its panels' estimates. The cloud does this itself
    after every slate; this is for rewriting the file by hand."""
    path = os.path.join(public, "savant-current.json")
    d = json.load(open(path))
    season = d["seasons"][0]
    players = d["data"][season]["players"]
    panels = json.load(open(os.path.join(public, "savant-ext", "panels", f"{season}.json")))["players"]
    for p in players:
        pe = (panels.get(str(p["id"])) or {}).get("pe")
        if pe:
            p["pe"] = pe
    n = apply_season(season, players, public=public, ext=_ext_rows(public, season))
    for p in players:
        p.pop("pe", None)
    with open(path, "w") as fh:
        json.dump(d, fh, separators=(",", ":"))
    print(f"{season}: {n} of {len(players)} labels moved")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["archive", "current"])
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    ap.add_argument("--report", default=os.path.join(HERE, "..", "..", "out"))
    a = ap.parse_args()
    return cmd_archive(a.public, a.report) if a.cmd == "archive" else cmd_current(a.public)


if __name__ == "__main__":
    sys.exit(main())
