"""
position_labels.py — Guard / Wing / Big from the position estimate.

    python3 position_labels.py archive [--public ../../public] [--report ../../out]
    python3 position_labels.py current [--public ../../public]
    python3 position_labels.py matchups     # from ~/Basketball-Savant, after a season ends

The label used to be `savant_config.position_bucket` of PlayerIndex's one career string, which
never looks at what a player does: Adem Bona played 96% of his minutes at center and was a Wing,
because the NBA lists him as a forward. Basketball Reference's play-by-play table already says
how each player's minutes split across the five positions (seed/ext-br/, the card's Position
estimate panel), so the label now comes from that, per season, and the two cannot disagree.

The rule has two signals, where his minutes are and how he plays:

    Guard    PG + SG >= 60
    Big      C >= a third
    Big      PF + C >= 60 and the big score >= 0.43
    Wing     PF + C >= 60 under that score, or SF + PF >= 60
    else     a true combo: he keeps today's label and goes on the review list

Slots alone cannot draw this line. Julius Randle and Paolo Banchero are at PF + C 100, the same as
Giannis Antetokounmpo and Zion Williamson, and the difference is what they do there. A first version
of this rule stopped at the slots (C a third, or PF + C 90, or 80 with C 20) and made bigs of
Banchero, Siakam, Anunoby and Durant.

The big score says how he plays, on a scale where 0 is a season's average wing and 1 its average
big (SCORE_WEIGHTS): rebounds, blocks, rim defense, shots at the rim, points in the paint, dunks, a
low three-point rate, height at a modest weight so that tall shooters don't count, and from 2017-18
the share of his matchups that are on bigs (seed/matchup_bigs.json, `matchups` below). A season
without a stat is scored on the ones it has. The averages are that season's, so a 1999 power forward
is held to 1999.

The score is 80% his career to date and 20% his recent play, because what a player is moves more
slowly than one season's box score, and no later season counts. One season at a time, Adam's labels
can't be met: Randle and Banchero are nearly the same player (9,000 random weightings, 2 separated
them, by 0.002), and what differs is that Randle's career runs through years of playing inside.

Adam set the labels it is tuned on (bigs: Giannis in his Milwaukee seasons at the 4-5, Carlos and
Cameron Boozer, Adem Bona, Moussa Diabate, Zion Williamson, Randle; wings: Durant, Tatum, LeBron
James, Anunoby, Jaylen Brown, DeRozan, Bridges, Banchero). From 2023-24 on 80% has the widest gap
between them, Banchero's 0.40 under Randle's 0.47, and 0.43 sits in it; with the weights shaken by
40% it holds in 290 of 300 draws. Holding each player out and tuning on the rest calls 19 of 24
seasons right, and the five misses are Randle's four and Cameron Boozer's: Randle's label is not one
the others imply. C >= a third stays a rule of its own, so a wing's season really spent at center is
a Big: Durant's 2020-21 (C 45) and LeBron's 2021-22 (C 50).

The recent part of a young season is pooled like his estimate: with his prior seasons, up to 400
minutes, and for a rookie with his Draft Savant position (a big 1, anyone else 0) for the minutes he
doesn't have yet.

The archive pass writes seed/big_scale.json (each season's averages and every player-season's score)
for the nightly refresh, which scores the season in progress against the last finished season.

60 is the example in the brief, and it holds up: 3.9% of player-seasons are left over as combos,
against 1.0 at 50 and 16.5 at 70 on the group shares.

A player with no estimate at all (a rookie on a night Basketball Reference has none for him) goes
down a chain: his own estimate from the stints, then his Draft Savant position, then the listed
one. A five has one of each position, so what the four men beside him leave unfilled is what he
plays: stint_estimate() sums that over the units he played in, by seconds, which also credits him
with the spot of whoever he came in for. Tested on 1,195 player-seasons (2023-24 to 2025-26, 400+
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
GROUP_MIN = 60.0
BIG_MIN_C = 100 / 3
BIG_MIN_45 = 60.0          # PF + C: mostly at the 4-5
BIG_SCORE = 0.43           # tuned on Adam's labels, see the docstring
SCORE_CAREER = 0.8         # the score's share that is his career to date
SCORE_WEIGHTS = dict(reb75=2.0, blk=1.5, rim=1.0, ppaint=1.0, rimfreq=1.0, dunk75=0.5, tp3r=2.0,
                     height=0.5, match=2.0)
SCORE_EXT = ("rimfreq", "dunk75")   # these live in savant-ext/s, the rest on the card
SCALE = os.path.join(HERE, "seed", "big_scale.json")
MATCHUPS = os.path.join(HERE, "seed", "matchup_bigs.json")
MATCHUP_MIN_POSS = 300
WING_SLOTS = (2, 3)        # SF, PF
MIN_MINUTES = 400          # a season's own estimate stands from here (see the docstring)
COMBO_KEEP = 30.0          # a combo keeps today's label only if that group holds this much of him
STINT_MIN_SECONDS = 1800   # lineup time a stint estimate needs: under this the listed position is as good


def groups(pe):
    """The three group shares of a five-slot estimate, as percentages."""
    t = sum(pe) or 1.0
    p = [100.0 * x / t for x in pe]
    return dict(Guard=p[0] + p[1], Wing=sum(p[i] for i in WING_SLOTS), Big=p[3] + p[4], C=p[4])


def classify(pe, today=None, score=None):
    """Guard / Wing / Big, or None for a true combo. `score` is the big score; without one (a season
    no stat reaches) a player at the 4-5 keeps today's label."""
    g = groups(pe)
    if g["Guard"] >= GROUP_MIN:
        return "Guard"
    if g["Big"] >= GROUP_MIN and g["C"] >= BIG_MIN_C:
        return "Big"
    if g["Big"] >= BIG_MIN_45:
        if score is None:
            return "Big" if today == "Big" else "Wing"
        return "Big" if score >= BIG_SCORE else "Wing"
    if g["Wing"] >= GROUP_MIN:
        return "Wing"
    return None


# ------------------------------------------------------------------ the big score
def _cell(p, key):
    return ((p.get("m", {}).get(key) or {}).get("season") or {}).get("v")


def features(p, ext=None, match=None):
    """The stats the score reads, for one player-season. `ext` is his savant-ext/s row, for a file
    that has been split; the refresh still has those stats on the row. `match` is {pid: share}."""
    v = {k: _cell(p, k) for k in SCORE_WEIGHTS if k != "match"}
    if ext:
        for k, x in ext.items():
            if v.get(k) is None:
                v[k] = x
    if match is not None and p.get("id") in match:
        v["match"] = match[p["id"]]
    elif p.get("guard") and p["guard"].get("b") is not None:
        v["match"] = p["guard"]["b"]
    return {k: x for k, x in v.items() if x is not None}


def season_refs(rows):
    """{stat: [average wing, average big]} over a season's qualified players, from (pe, features)."""
    wing, big = {}, {}
    for pe, v in rows:
        g = groups(pe)
        side = big if g["C"] >= BIG_MIN_C and g["Big"] >= GROUP_MIN else \
            wing if g["Wing"] >= GROUP_MIN and g["Big"] < GROUP_MIN and g["Guard"] < GROUP_MIN else None
        if side is None:
            continue
        for k, x in v.items():
            side.setdefault(k, []).append(x)
    return {k: [sum(wing[k]) / len(wing[k]), sum(big[k]) / len(big[k])] for k in SCORE_WEIGHTS
            if len(wing.get(k, ())) >= 15 and len(big.get(k, ())) >= 15}


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


def career_score(seasons, season):
    """His career to date, by minutes. No later season counts."""
    total = used = 0.0
    for s, (score, minutes) in seasons.items():
        if s <= season and score is not None and minutes:
            total += score * minutes
            used += minutes
    return total / used if used else None


def big_score(seasons, season, draft_pos=None):
    """The score the rule reads: his career to date, blended with his recent play."""
    recent = pooled_score(seasons, season, draft_pos)
    career = career_score(seasons, season)
    if recent is None or career is None:
        return recent
    return SCORE_CAREER * career + (1 - SCORE_CAREER) * recent


def draft_pos_of(draft, name, season):
    from namematch import norm
    year, pos = draft.get(norm(name), (0, None))
    return pos if pos and year >= int(season[:4]) - 1 else None


def combo_label(pe, today):
    """A combo keeps today's label unless the estimate rules it out; then his largest group,
    with Big counted on center minutes, since PF minutes are already in Wing."""
    g = groups(pe)
    g["Big"] = g["C"]
    if today in ("Guard", "Wing", "Big") and g[today] >= COMBO_KEEP:
        return today
    return max(("Guard", "Wing", "Big"), key=lambda k: g[k])


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
        return dict(today=today, pos=today, src="today", combo=False, pe=None, mp=0)
    pe, mp, first, n = r
    lab = classify(pe, today, score)
    combo = lab is None
    if combo:
        lab = combo_label(pe, today)
    p["pos"] = lab
    if lab != today:
        p["pos0"] = today
    if n > 1:
        # a pool, so the panel has to show the pool
        p["posx"] = dict(pe=[round(x) for x in pe], mp=round(mp), **{"from": first})
    return dict(today=today, pos=lab, src="pooled" if n > 1 else "season", combo=combo, pe=pe, mp=mp)


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
            lab = classify(pe, today, score_of(p)) or combo_label(pe, today)
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
        return big_score(seasons, season, draft_pos_of(draft, p["name"], season))

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
    try:
        with open(MATCHUPS) as fh:
            matchups = json.load(fh)
    except (OSError, ValueError):
        matchups = {}
    refs, scores = {}, {}
    for season, blk in d["data"].items():
        if season < "1996-97":
            continue
        ext = _ext_rows(public, season)
        match = {int(k): v for k, v in (matchups.get(season) or {}).items()}
        rows, feats = [], {}
        for p in blk["players"]:
            if not isinstance(p.get("id"), int):
                continue
            v = features(p, ext.get(p["id"]), match)
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


def cmd_matchups():
    """seed/matchup_bigs.json: {season: {pid: % of his matchups on bigs}}. On the Mac, from the
    cache (run it from ~/Basketball-Savant), 2017-18 on. A big here is C >= a third on the estimate,
    so that the labels never decide their own input."""
    import savant_config as C
    import savant_engine as E
    hist = history()
    fm = C.FIELD_MAP["matchups"]
    out = {}
    for season in sorted(s for s in C.SEASONS if "2017-18" <= s):
        bigs = {pid for pid, h in hist.items() if season in h and groups(h[season][0])["C"] >= BIG_MIN_C}
        tally = {}
        for r in E.load_matchups(season).to_dict("records"):
            w = float(r.get(fm["partial_poss"], 0) or 0)
            if w <= 0:
                continue
            t = tally.setdefault(int(r[fm["def_id"]]), [0.0, 0.0])
            t[0] += w
            if int(r[fm["off_id"]]) in bigs:
                t[1] += w
        out[season] = {str(k): round(100 * v[1] / v[0], 1) for k, v in tally.items() if v[0] >= MATCHUP_MIN_POSS}
    with open(MATCHUPS, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print({k: len(v) for k, v in out.items()})
    return 0


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
    changes, combos = [], []
    for season, blk in d["data"].items():
        for p in blk["players"]:
            own = hist.get(p["id"]) if isinstance(p.get("id"), int) else None
            sc = None
            if isinstance(p.get("id"), int) and season >= "1996-97":
                sc = big_score(scores.get(str(p["id"])) or {}, season, draft_pos_of(draft, p["name"], season))
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
            if res["combo"]:
                combos.append(row)

    with open(path, "w") as fh:
        json.dump(d, fh, separators=(",", ":"))

    os.makedirs(report, exist_ok=True)
    head = ["rank", "season", "player", "id", "team", "minutes", "qualified", "today", "new",
            "source", *SLOTS]
    for name, rows in (("position-changes.csv", changes), ("position-review.csv", combos)):
        rows.sort(key=lambda r: (-r["minutes"], r["season"], str(r["id"])))
        with open(os.path.join(report, name), "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(head)
            for i, r in enumerate(rows, 1):
                w.writerow([i, r["season"], r["name"], r["id"], r["team"], r["minutes"], r["qualified"],
                            r["today"], r["new"], r["source"], *(r["pe"] or [""] * 5)])

    def shares(t):
        n = sum(t.values())
        return {k: round(100 * t.get(k, 0) / n, 1) for k in ("Guard", "Wing", "Big")}
    print(f"changed {len(changes):,}, combos {len(combos):,}")
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
    ap.add_argument("cmd", choices=["archive", "current", "matchups"])
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    ap.add_argument("--report", default=os.path.join(HERE, "..", "..", "out"))
    a = ap.parse_args()
    if a.cmd == "matchups":
        return cmd_matchups()
    return cmd_archive(a.public, a.report) if a.cmd == "archive" else cmd_current(a.public)


if __name__ == "__main__":
    sys.exit(main())
