"""
position_labels.py — Guard / Wing / Big from the position estimate.

    python3 position_labels.py archive [--public ../../public] [--report ../../out]
    python3 position_labels.py current [--public ../../public]

The label used to be `savant_config.position_bucket` of PlayerIndex's one career string, which
never looks at what a player does: Adem Bona played 96% of his minutes at center and was a Wing,
because the NBA lists him as a forward. Basketball Reference's play-by-play table already says
how each player's minutes split across the five positions (seed/ext-br/, the card's Position
estimate panel), so the label now comes from that, per season, and the two cannot disagree.

The rule, on the shares of his minutes:

    Guard    PG + SG >= 60
    Big      C >= a third, or PF + C >= 90, or PF + C >= 80 with C >= 20
    forward  PF + C >= 60, under both of those: today's label stands if it is Wing or Big, a Guard
             becomes a Wing
    Wing     SF + PF >= 60
    else     a true combo: he keeps today's label and goes on the review list

A player who lives at the 4 and the 5 is a Big. The first version asked for a third of his minutes
at center, which left Giannis Antetokounmpo a Wing (PF 86, C 12) and would have done the same to
every power forward like him. PF + C >= 60 alone goes the other way: it moves 3,342 player-seasons
and takes the labels from 43/33/24 (Guard/Wing/Big) to 37/15/41, with Dillon Brooks a big.

90 is measured. On qualified players since 2009-10 with C under a third, against the same players'
height, rebounds, blocks, three-point rate and rim defense on a scale of 0 for a wing and 1 for a
big, the bands read: 40-80 PF + C about 0.05 to 0.24, 80-95 about 0.25 to 0.35, 95 and up 0.50. So
the line is somewhere from 80 to 90, and DeMar DeRozan's 2021-22 (PF + C 89) puts it at the top of
that: 89 keeps him a Wing, as a wing who spent one year at the 4. Stretch fours who stay there,
like OG Anunoby's 95 and 92, are Bigs by this rule. PF + C alone can't finish the job, because Carlos
Boozer's last season is 86 with C 24 and DeRozan's is 89 with C 8: a big has center minutes and a
wing filling in at the 4 has none. So between 80 and 90 he needs a fifth of his minutes at center,
which is center's share of all minutes by construction.

The forward zone keeps what the estimate cannot settle, so the rule only moves a player when the
estimate rules his label out. Setting BIG_MIN_45 to any number over 100 gives the first version
back; BIG_MIN_C = 0 and WING_SLOTS = (2,) give the obvious one.

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
BIG_MIN_45 = 90.0          # PF + C: measured, see the docstring
BIG_MIN_45_C = (80.0, 20.0)  # or PF + C and C together
WING_SLOTS = (2, 3)        # SF, PF
MIN_MINUTES = 400          # a season's own estimate stands from here (see the docstring)
COMBO_KEEP = 30.0          # a combo keeps today's label only if that group holds this much of him
STINT_MIN_SECONDS = 1800   # lineup time a stint estimate needs: under this the listed position is as good


def groups(pe):
    """The three group shares of a five-slot estimate, as percentages."""
    t = sum(pe) or 1.0
    p = [100.0 * x / t for x in pe]
    return dict(Guard=p[0] + p[1], Wing=sum(p[i] for i in WING_SLOTS), Big=p[3] + p[4], C=p[4])


def classify(pe, today=None):
    """Guard / Wing / Big, or None for a true combo."""
    g = groups(pe)
    if g["Guard"] >= GROUP_MIN:
        return "Guard"
    if g["Big"] >= GROUP_MIN:
        big = (g["C"] >= BIG_MIN_C or g["Big"] >= BIG_MIN_45
               or (g["Big"] >= BIG_MIN_45_C[0] and g["C"] >= BIG_MIN_45_C[1]))
        return "Big" if big or today == "Big" else "Wing"
    if g["Wing"] >= GROUP_MIN:
        return "Wing"
    return None


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


def label_row(p, hist_rows, season, own=None):
    """Set p["pos"] from the estimate, in place. Returns what happened, for the reports."""
    today = p.get("pos0") or p.get("pos")
    p.pop("pos0", None)
    p.pop("posx", None)
    r = resolve(hist_rows, season, own)
    if r is None:
        p["pos"] = today
        return dict(today=today, pos=today, src="today", combo=False, pe=None, mp=0)
    pe, mp, first, n = r
    lab = classify(pe, today)
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


def apply_fallbacks(season, rows, known, public=None):
    """`rows` have no estimate of any kind. Stints, then Draft Savant, then the listed label."""
    from namematch import norm
    public = public or public_dir()
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
            lab = classify(pe, today) or combo_label(pe, today)
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


def apply_season(season, players, seed=SEED, hist=None, public=None):
    """The season in progress (refresh_current.py). `pe` is what ext_engine.br_pass left on the
    rows, or br_keep.py carried over; a player with no estimate for this season falls back to his
    prior seasons, and one with neither goes down apply_fallbacks()."""
    hist = hist if hist is not None else history(seed)
    changed = 0
    known, none = {}, []
    for p in players:
        pe = p.get("pe")
        mp = (((p.get("m") or {}).get("minshare") or {}).get("season") or {}).get("n")
        own = (pe, float(mp or 0)) if pe and sum(pe) > 0 else None
        res = label_row(p, hist.get(p["id"]), season, own)
        if res["pe"] is None:
            none.append(p)
        else:
            known[p["id"]] = res["pe"]
        if res["pos"] != p.get("pos0", p["pos"]):
            changed += 1
    if none:
        tally = apply_fallbacks(season, none, known, public)
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


def cmd_archive(public, report):
    path = os.path.join(public, "savant-data.json")
    d = json.load(open(path))
    hist = history()
    before, after, q_before, q_after = {}, {}, {}, {}
    changes, combos = [], []
    for season, blk in d["data"].items():
        for p in blk["players"]:
            own = hist.get(p["id"]) if isinstance(p.get("id"), int) else None
            res = label_row(p, own, season)
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
    n = apply_season(season, players)
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
