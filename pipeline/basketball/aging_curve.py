"""
aging_curve.py — empirical NBA aging curves from the existing player-season data.

DIAGNOSTIC ONLY. This script reads out/players.json and writes two artifacts:

    aging_curve_report.txt   plain-text tables (raw + smoothed, per age)
    aging_curve.png          two panels (impact, minutes)

It never writes into the site, out/players.json, or any page HTML, and it never
imports build_page. savant_engine / savant_config are imported read-only so the
percentile and age conventions match the rest of the pipeline exactly.

    python aging_curve.py                # 15 configured seasons (savant_config.SEASONS)
    python aging_curve.py --all          # every season present in out/players.json
    python aging_curve.py --offline      # never touch the network for birthdates

METHOD (delta / paired-season)
  For every player and every pair of consecutive seasons he appears in BOTH,
  record age, delta_impact, delta_mpg and a weight:

    impact  = position-adjusted BPM percentile (savant_engine._pct_rank over the
              same qualified same-position pool the page's poolVals() builds)
    role    = minutes per game
    weight  = min(total_minutes_yr1, total_minutes_yr2)
    age     = the player's age in the LATER season of the pair, as of Feb 1 of
              that season's ending calendar year (savant_engine._season_ref_date)

  Inclusion rules — these are the survivorship-bias controls:
    * player must appear in both seasons (no implicit zeros for the vanished),
    * >= MIN_MINUTES total minutes in EACH season,
    * pairs where the position designation changed are DROPPED (the percentile
      pool changes underneath the player, so the impact delta is meaningless),
    * minutes weighting stops a 600-minute cameo from anchoring an age.
"""
import os, sys, json, math, argparse, datetime as dt

import numpy as np

import savant_config as C
from savant_engine import _pct_rank, _season_ref_date, _age_from_birthdate, load_player_info

# --------------------------------------------------------------------------
# knobs
# --------------------------------------------------------------------------
PLAYERS_JSON = os.path.join(C.OUT_DIR, "players.json")
BIRTH_CACHE  = "aging_birthdates.json"      # pid -> "YYYY-MM-DD", so CommonPlayerInfo
REPORT_PATH  = "aging_curve_report.txt"     # is never re-requested on a later run
PNG_PATH     = "aging_curve.png"

MIN_MINUTES  = 500   # per season, both seasons of the pair
MIN_PAIRS    = 25    # age buckets thinner than this are reported "insufficient", not as a number
TAIL_LO      = 19    # ages <= this collapse into one bucket
TAIL_HI      = 38    # ages >= this collapse into one bucket
FIT_LO, FIT_HI = 20, 37   # the smoother only sees single ages in this closed range
POLY_DEG     = 3     # low-order: cubic in age

IMPACT_KEY   = "bpm"

# --------------------------------------------------------------------------
# players.json accessors
# --------------------------------------------------------------------------
def _cell(p, key, win="season"):
    return (p.get("m", {}).get(key, {}) or {}).get(win) or {}

def metric_v(p, key):
    return _cell(p, key).get("v")

def total_minutes(p):
    """Total minutes played in the season. minshare carries round(MP) as its sample
    size (see br_normalize / patch_context_bars); fall back to mpg x gp when absent."""
    n = _cell(p, "minshare").get("n")
    if n is not None:
        return float(n)
    mpg, gp = metric_v(p, "mpg"), _cell(p, "avail").get("n")
    if mpg is not None and gp:
        return float(mpg) * float(gp)
    return None

def season_index(payload, season):
    """{pid: player_row} for one season, newest row wins on the (unexpected) duplicate.
    Ids are kept as STRINGS: nba_api rows carry ints, but the pre-1996 backfill carries
    Basketball-Reference slugs ("br:ewingpa01"), and both must key the same dict."""
    return {str(p["id"]): p for p in payload["data"].get(season, {}).get("players", [])}

# --------------------------------------------------------------------------
# impact currency — position-adjusted BPM percentile
# --------------------------------------------------------------------------
def impact_percentiles(players):
    """{pid: BPM percentile within his own position pool} for one season.

    The pool is exactly what the page's poolVals(pop='position') builds: the
    QUALIFIED players sharing that player's position bucket (p['pos'], written by
    savant_config.position_bucket) who have a BPM that season. Ranking is
    savant_engine._pct_rank — the engine's midrank percentile, the same function
    behind the comp vectors and the page's pctOf.

    A player over the minutes floor but under the qualifier (>=20 GP, >=15 MPG) is
    still scored, by ranking him against that pool with himself appended — so every
    player is self-included in his own denominator, exactly as a qualified player is.
    """
    by_pos = {}
    for p in players:
        v = metric_v(p, IMPACT_KEY)
        if v is None:
            continue
        by_pos.setdefault(p.get("pos"), []).append((str(p["id"]), float(v), bool(p.get("qualified"))))

    out = {}
    for pos, rows in by_pos.items():
        pool = [(pid, v) for pid, v, q in rows if q]
        if len(pool) < 2:
            continue
        out.update(_pct_rank(pool))                     # every qualified player at once
        in_pool = {pid for pid, _ in pool}
        for pid, v, _q in rows:
            if pid not in in_pool:                      # unqualified: rank vs pool + himself
                out[pid] = _pct_rank(pool + [(pid, v)])[pid]
    return out

# --------------------------------------------------------------------------
# birthdates — seeded from players.json, topped up from CommonPlayerInfo, cached
# --------------------------------------------------------------------------
def load_birthdates(payload, seasons, offline=False):
    cache = {}
    if os.path.exists(BIRTH_CACHE):
        try:
            cache = json.load(open(BIRTH_CACHE))
        except Exception:
            cache = {}
    before = len(cache)

    needed = set()
    for season in seasons:
        for p in payload["data"].get(season, {}).get("players", []):
            pid = str(p["id"])
            needed.add(pid)
            bd = p.get("birthdate")                      # already carried by the build
            if bd and pid not in cache:
                cache[pid] = str(bd).split("T")[0]

    # Basketball-Reference-backfilled rows ("br:ewingpa01") have no CommonPlayerInfo record;
    # they resolve from the embedded birthdate or not at all.
    missing = sorted(pid for pid in needed - set(cache) if pid.isdigit())
    unfetchable = len(needed - set(cache)) - len(missing)
    fetched = failed = 0
    if missing and not offline:
        fkey = C.FIELD_MAP["player_info"]["birthdate"]
        print(f"  birthdates: {len(missing)} not cached — fetching CommonPlayerInfo...")
        for pid in missing:
            try:
                raw = load_player_info(int(pid)).iloc[0].get(fkey)
                if not raw:
                    failed += 1
                    continue
                cache[pid] = str(raw).split("T")[0]
                fetched += 1
            except Exception:
                failed += 1
    elif missing:
        failed = len(missing)
    failed += unfetchable

    if len(cache) != before:
        with open(BIRTH_CACHE, "w") as fh:
            json.dump(cache, fh, indent=0, sort_keys=True)
    print(f"  birthdates: {len(cache)} cached ({fetched} newly fetched, {failed} unresolved) "
          f"-> {BIRTH_CACHE}")
    return cache

def age_in_season(birthdate, season):
    """Integer age as of Feb 1 of the season's ending calendar year (BBRef convention).
    Both halves reuse the engine's own age helpers so this matches the site's ages."""
    return int(math.floor(_age_from_birthdate(birthdate, _season_ref_date(season))))

# --------------------------------------------------------------------------
# pair extraction
# --------------------------------------------------------------------------
class Counts:
    def __init__(self):
        self.seen = self.no_impact = self.no_minutes = self.min_excl = 0
        self.pos_excl = self.no_age = self.used = 0

def build_pairs(payload, seasons, births, min_minutes=MIN_MINUTES):
    """[(age, d_impact, d_mpg, weight, pid, season_pair)] over consecutive-season pairs.

    Exclusions are applied in this order, and counted separately:
      missing data -> minutes threshold -> position reclassification -> missing birthdate.
    """
    chrono = sorted(seasons, key=lambda s: int(s[:4]))
    pairs, counts = [], Counts()

    prev_season = chrono[0]
    idx_prev = season_index(payload, prev_season)
    pct_prev = impact_percentiles(list(idx_prev.values()))
    for season in chrono[1:]:
        idx_cur = season_index(payload, season)
        pct_cur = impact_percentiles(list(idx_cur.values()))
        for pid in set(idx_prev) & set(idx_cur):
            counts.seen += 1
            p1, p2 = idx_prev[pid], idx_cur[pid]
            i1, i2 = pct_prev.get(pid), pct_cur.get(pid)
            m1, m2 = metric_v(p1, "mpg"), metric_v(p2, "mpg")
            t1, t2 = total_minutes(p1), total_minutes(p2)
            if i1 is None or i2 is None:
                counts.no_impact += 1
                continue
            if m1 is None or m2 is None or t1 is None or t2 is None:
                counts.no_minutes += 1
                continue
            if t1 < min_minutes or t2 < min_minutes:
                counts.min_excl += 1
                continue
            if p1.get("pos") != p2.get("pos"):
                counts.pos_excl += 1
                continue
            bd = births.get(pid)
            if not bd:
                counts.no_age += 1
                continue
            counts.used += 1
            pairs.append(dict(
                pid=pid, name=p2.get("name", ""), age=age_in_season(bd, season),
                d_impact=i2 - i1, d_mpg=float(m2) - float(m1),
                weight=min(t1, t2), pos=p2.get("pos"), pair=f"{prev_season}->{season}",
            ))
        prev_season, idx_prev, pct_prev = season, idx_cur, pct_cur
    return pairs, counts

# --------------------------------------------------------------------------
# curves
# --------------------------------------------------------------------------
def bucket_label(age):
    if age <= TAIL_LO:
        return f"<={TAIL_LO}"
    if age >= TAIL_HI:
        return f"{TAIL_HI}+"
    return str(age)

def bucket_order(labels):
    def k(lbl):
        if lbl.startswith("<="):
            return TAIL_LO - 1
        if lbl.endswith("+"):
            return TAIL_HI + 1
        return int(lbl)
    return sorted(labels, key=k)

def raw_curve(pairs, field):
    """{bucket_label: dict(n, weight, mean, suppressed)} — minutes-weighted mean delta.
    Every bucket from the low tail to the high tail is emitted, so an age with no pairs
    at all shows up as 'insufficient' rather than silently vanishing from the table."""
    agg = {bucket_label(a): dict(n=0, w=0.0, wd=0.0) for a in range(TAIL_LO, TAIL_HI + 1)}
    for r in pairs:
        b = agg.setdefault(bucket_label(r["age"]), dict(n=0, w=0.0, wd=0.0))
        b["n"] += 1
        b["w"] += r["weight"]
        b["wd"] += r["weight"] * r[field]
    out = {}
    for lbl, b in agg.items():
        ok = b["n"] >= MIN_PAIRS and b["w"] > 0
        out[lbl] = dict(n=b["n"], weight=b["w"],
                        mean=(b["wd"] / b["w"]) if ok else None,
                        suppressed=not ok)
    return out

def smooth(curve):
    """Weighted low-order polynomial over the single ages FIT_LO..FIT_HI that survived
    suppression. Fit weights are sqrt(pair count), so thin ages pull the curve less.
    Returns (poly, {age: smoothed_value}) or (None, {})."""
    xs, ys, ws = [], [], []
    for age in range(FIT_LO, FIT_HI + 1):
        c = curve.get(str(age))
        if c and not c["suppressed"]:
            xs.append(age); ys.append(c["mean"]); ws.append(math.sqrt(c["n"]))
    if len(xs) <= POLY_DEG + 1:
        return None, {}
    poly = np.polynomial.Polynomial.fit(np.array(xs, float), np.array(ys, float),
                                        POLY_DEG, w=np.array(ws, float)).convert()
    return poly, {age: float(poly(age)) for age in range(FIT_LO, FIT_HI + 1)}

def zero_crossing(poly):
    """The age in [FIT_LO, FIT_HI] where the smoothed curve last crosses from
    positive to negative — the implied peak. None if it never does."""
    if poly is None:
        return None
    grid = np.linspace(FIT_LO, FIT_HI, 3401)
    vals = poly(grid)
    hits = [
        grid[i] + (grid[i + 1] - grid[i]) * (vals[i] / (vals[i] - vals[i + 1]))
        for i in range(len(grid) - 1)
        if vals[i] > 0 >= vals[i + 1]
    ]
    return float(hits[-1]) if hits else None

# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------
def render_table(title, unit, curve, sm):
    w = []
    w.append(title)
    w.append("-" * len(title))
    w.append(f"{'age':>6}  {'pairs':>7}  {'weight (min)':>13}  {'raw ' + unit:>16}  {'smoothed':>10}")
    for lbl in bucket_order(curve):
        c = curve[lbl]
        raw = "insufficient" if c["suppressed"] else f"{c['mean']:+.2f}"
        s = sm.get(int(lbl)) if lbl.isdigit() else None
        w.append(f"{lbl:>6}  {c['n']:>7}  {c['weight']:>13,.0f}  {raw:>16}  "
                 f"{(f'{s:+.2f}' if s is not None else '—'):>10}")
    return "\n".join(w)

def write_report(path, seasons, counts, curves, smooths, crossings, args):
    chrono = sorted(seasons, key=lambda s: int(s[:4]))
    L = []
    L.append("BASKETBALL SAVANT — EMPIRICAL AGING CURVES")
    L.append("diagnostic output only; nothing here is written back into the site or the JSON")
    L.append(f"generated: {dt.datetime.now().astimezone().isoformat(timespec='seconds')}")
    L.append(f"source:    {PLAYERS_JSON}")
    L.append("")
    L.append(f"seasons:   {chrono[0]} .. {chrono[-1]}  ({len(chrono)} seasons, "
             f"{len(chrono) - 1} consecutive-season transitions)")
    L.append(f"impact:    position-adjusted {IMPACT_KEY.upper()} percentile "
             "(qualified same-position pool, engine midrank percentile)")
    L.append("role:      minutes per game")
    L.append(f"weight:    min(total minutes yr1, total minutes yr2); floor "
             f"{args.min_minutes} min in EACH season")
    L.append(f"age:       age in the LATER season, as of Feb 1 of that season's ending year")
    L.append(f"smoothing: degree-{POLY_DEG} polynomial over single ages {FIT_LO}-{FIT_HI}, "
             "weighted by sqrt(pair count)")
    L.append(f"suppression: age buckets with < {MIN_PAIRS} player-pairs report "
             "'insufficient' rather than a number")
    L.append("")
    L.append("SAMPLE")
    L.append("------")
    L.append(f"  consecutive-season appearances examined       {counts.seen:>8,}")
    L.append(f"  dropped, no BPM percentile in one season      {counts.no_impact:>8,}")
    L.append(f"  dropped, no minutes/MPG in one season         {counts.no_minutes:>8,}")
    L.append(f"  dropped, under {args.min_minutes} min in one season        {counts.min_excl:>8,}")
    L.append(f"  dropped, position reclassified between years  {counts.pos_excl:>8,}"
             + ("   <- see note" if counts.pos_excl == 0 else ""))
    L.append(f"  dropped, no birthdate                         {counts.no_age:>8,}")
    L.append(f"  PLAYER-PAIRS USED                             {counts.used:>8,}")
    L.append("")
    L.append(render_table("PANEL 1 — IMPACT  (delta in percentile points, + = improved)",
                          "d_impact", curves["impact"], smooths["impact"]))
    L.append("")
    L.append(render_table("PANEL 2 — ROLE  (delta in minutes per game, + = more minutes)",
                          "d_mpg", curves["minutes"], smooths["minutes"]))
    L.append("")
    L.append("IMPLIED PEAK (smoothed curve's downward zero crossing)")
    L.append("-----------------------------------------------------")
    for name, label in (("impact", "impact (BPM percentile)"), ("minutes", "role (MPG)")):
        x = crossings[name]
        L.append(f"  {label:<26} {f'{x:.2f} years old' if x is not None else 'no crossing in range'}")
    L.append("")
    L.append("CAVEATS")
    L.append("-------")
    if counts.pos_excl == 0:
        L.append("  * NOTE — the position-reclassification filter is implemented but never fires")
        L.append("    on this data. p['pos'] comes from PlayerIndex POSITION, and PlayerIndex")
        L.append("    returns ONE career position per player: the raw POSITION string is byte-")
        L.append("    identical across every season a player appears in, so the Guard/Wing/Big")
        L.append("    bucket cannot change between two seasons. The percentile pool therefore")
        L.append("    never shifts underneath a player here — but it also means a genuine")
        L.append("    positional move (a wing who becomes a small-ball five) is invisible to")
        L.append("    the engine, and those pairs are silently kept. A per-season position")
        L.append("    source would be needed to make this control real.")
    L.append("  * Deltas are within-pool percentile moves, so they are zero-sum across the")
    L.append("    league by construction; the curve is 'relative to peers', not absolute.")
    L.append("  * Both-seasons survivorship still applies at the far tails: a 38-year-old")
    L.append("    who was going to fall off often retires instead of posting a second season,")
    L.append("    which flatters the oldest buckets. The minutes floor cuts the same way.")
    L.append("  * Shortened seasons (2011-12 lockout, 2019-20 / 2020-21 COVID) push more")
    L.append(f"    players under the {args.min_minutes}-minute floor than a full 82 would.")
    L.append("")
    with open(path, "w") as fh:
        fh.write("\n".join(L) + "\n")

# --------------------------------------------------------------------------
# plot
# --------------------------------------------------------------------------
def write_png(path, curves, smooths, crossings):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:
        print(f"  plot: skipped (matplotlib unavailable: {e})")
        return False

    fig, axes = plt.subplots(2, 1, figsize=(10, 9), sharex=True)
    panels = [
        ("impact", axes[0], "Impact — position-adjusted BPM percentile",
         "Δ percentile points / yr", "#1c4e86"),
        ("minutes", axes[1], "Role — minutes per game", "Δ MPG / yr", "#bc3a2c"),
    ]
    for name, ax, title, ylab, color in panels:
        curve, sm = curves[name], smooths[name]
        pts = [(lbl, c) for lbl, c in curve.items() if not c["suppressed"]]
        xs = [TAIL_LO if l.startswith("<=") else TAIL_HI if l.endswith("+") else int(l)
              for l, _ in pts]
        ys = [c["mean"] for _, c in pts]
        ns = [c["n"] for _, c in pts]
        tail = [l.startswith("<=") or l.endswith("+") for l, _ in pts]
        size = lambda n: 18 + 340 * (n / max(ns))
        ax.scatter([x for x, t in zip(xs, tail) if not t],
                   [y for y, t in zip(ys, tail) if not t],
                   s=[size(n) for n, t in zip(ns, tail) if not t],
                   color=color, alpha=.45, edgecolor=color, linewidth=.8,
                   zorder=3, label="raw weighted mean (area ∝ pairs)")
        if any(tail):
            ax.scatter([x for x, t in zip(xs, tail) if t],
                       [y for y, t in zip(ys, tail) if t],
                       s=[size(n) for n, t in zip(ns, tail) if t],
                       facecolor="none", edgecolor=color, linewidth=1.4, linestyle="--",
                       zorder=3, label=f"tail buckets (≤{TAIL_LO}, {TAIL_HI}+)")
        if sm:
            g = np.linspace(FIT_LO, FIT_HI, 400)
            poly = smooths[name + "_poly"]
            ax.plot(g, poly(g), color=color, linewidth=2.2, zorder=4,
                    label=f"smoothed (deg-{POLY_DEG}, ages {FIT_LO}–{FIT_HI})")
        ax.axhline(0, color="#666", linewidth=.9, zorder=1)
        x0 = crossings[name]
        if x0 is not None:
            ax.axvline(x0, color="#444", linestyle=":", linewidth=1.4, zorder=2)
            ax.annotate(f"crosses 0 at {x0:.1f}", xy=(x0, 0),
                        xytext=(6, 10), textcoords="offset points",
                        fontsize=9, color="#333")
        ax.set_title(title, fontsize=12, loc="left")
        ax.set_ylabel(ylab, fontsize=10)
        ax.grid(alpha=.18, linewidth=.7)
        ax.legend(fontsize=8, frameon=False, loc="lower left")
    axes[1].set_xlabel("age in the later season of the pair", fontsize=10)
    axes[1].set_xticks(range(TAIL_LO, TAIL_HI + 1))
    axes[1].set_xlim(TAIL_LO - 0.8, TAIL_HI + 0.8)   # keep the 38+ marker off the frame edge
    fig.suptitle("NBA year-over-year change by age — minutes-weighted, paired seasons",
                 fontsize=13, y=.98)
    fig.tight_layout(rect=(0, 0, 1, .96))
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return True

# --------------------------------------------------------------------------
# frozen-constant emitter — the bridge from this diagnostic to the live page
# --------------------------------------------------------------------------
def emit_constants(seasons, counts, curves, smooths, crossings, args):
    """Print the AGING block for savant_config.py. The page's age module runs off a
    FROZEN copy of this fit, so the baseline only moves when someone deliberately
    regenerates it — paste the output over AGING in savant_config.py."""
    chrono = sorted(seasons, key=lambda s: int(s[:4]))
    n_by_age = {int(l): c["n"] for l, c in curves["impact"].items()
                if l.isdigit() and not c["suppressed"]}
    L = []
    L.append("AGING = {")
    L.append(f'  "generated": "{dt.date.today().isoformat()}",   # python aging_curve.py --emit-constants')
    L.append(f'  "seasons": ["{chrono[0]}", "{chrono[-1]}"], "pairs": {counts.used},')
    L.append(f'  "min_minutes": {args.min_minutes}, "min_pairs": {MIN_PAIRS},')
    L.append(f'  "fit": [{FIT_LO}, {FIT_HI}], "degree": {POLY_DEG},')
    L.append('  # polynomial coefficients, ascending powers of age; value = expected delta at that age')
    for name in ("impact", "minutes"):
        coef = ", ".join(repr(float(c)) for c in smooths[name + "_poly"].coef)
        L.append(f'  "{name}": {{"coef": [{coef}],')
        L.append(f'              "cross": {round(crossings[name], 3)}}},')
    L.append(f'  "n_by_age": {{' + ", ".join(f"{a}: {n}" for a, n in sorted(n_by_age.items())) + "},")
    L.append("}")
    print("\n".join(L))

def main():
    ap = argparse.ArgumentParser(description="Empirical NBA aging curves (diagnostic only).")
    ap.add_argument("--emit-constants", action="store_true",
                    help="print the frozen AGING block for savant_config.py and exit")
    ap.add_argument("--all", action="store_true",
                    help="use every season in players.json instead of savant_config.SEASONS")
    ap.add_argument("--min-minutes", type=int, default=MIN_MINUTES,
                    help=f"per-season total-minute floor for both halves of a pair (default {MIN_MINUTES})")
    ap.add_argument("--offline", action="store_true",
                    help="never call CommonPlayerInfo; use only cached/embedded birthdates")
    args = ap.parse_args()

    if not os.path.exists(PLAYERS_JSON):
        sys.exit(f"missing {PLAYERS_JSON} — run `python savant_engine.py build` first")
    print(f"reading {PLAYERS_JSON} ...")
    payload = json.load(open(PLAYERS_JSON))
    available = list(payload.get("data", {}).keys())
    seasons = [s for s in (available if args.all else C.SEASONS) if s in payload["data"]]
    if len(seasons) < 2:
        sys.exit("need at least two seasons of data")

    births = load_birthdates(payload, seasons, offline=args.offline)
    pairs, counts = build_pairs(payload, seasons, births, min_minutes=args.min_minutes)
    if not pairs:
        sys.exit("no usable player-pairs")

    curves, smooths, crossings = {}, {}, {}
    for name, field in (("impact", "d_impact"), ("minutes", "d_mpg")):
        curves[name] = raw_curve(pairs, field)
        poly, sm = smooth(curves[name])
        smooths[name], smooths[name + "_poly"] = sm, poly
        crossings[name] = zero_crossing(poly)

    if args.emit_constants:
        emit_constants(seasons, counts, curves, smooths, crossings, args)
        return

    write_report(REPORT_PATH, seasons, counts, curves, smooths, crossings, args)
    wrote_png = write_png(PNG_PATH, curves, smooths, crossings)

    peak = crossings["impact"]
    print()
    print("=" * 62)
    print(f"  total player-pairs used                      {counts.used:>8,}")
    print(f"  excluded — position reclassification         {counts.pos_excl:>8,}")
    print(f"  excluded — {args.min_minutes}-minute threshold             {counts.min_excl:>8,}")
    print(f"  smoothed impact curve crosses zero at        "
          f"{f'{peak:>8.2f}' if peak is not None else '     n/a'}"
          f"{'  (implied peak age)' if peak is not None else ''}")
    print("=" * 62)
    print(f"wrote {REPORT_PATH}" + (f" and {PNG_PATH}" if wrote_png else ""))
    print("diagnostic only — nothing was written to the site, players.json, or any page.")

if __name__ == "__main__":
    main()
