"""
position_engine.py — per-season position + role for Basketball Savant.

Why this exists
---------------
`savant_engine` takes `pos` from nba_api's PlayerIndex, which returns ONE career
position per player: the raw POSITION string is byte-identical across every season a
player appears in. The aging-curve report flags this directly — a genuine positional
move (a wing who becomes a small-ball five) is invisible to the engine. A three-bucket
career-static label is also far too coarse to build a five-man lineup matchup profile on.

This module fixes both, using data already on disk:

  labels   parse per-season LISTED positions out of the cached Basketball-Reference
           advanced tables (cache_br/NBA_*_advanced.html — `pos` is already in there).
  train    fit a model mapping Savant's 53 metrics + measurables -> a 5-slot position
           distribution (PG/SG/SF/PF/C), using the BR labels as ground truth.
  build    score every player-season in out/players.json and emit out/positions.json.

The output is deliberately a DISTRIBUTION, not a label. A player is 0.6 PF / 0.4 C,
which is what a lineup engine actually needs — and the entropy of that distribution is
a free positional-versatility signal.

Stdlib + sklearn only. No network: every input is already cached locally.

Usage:
  python position_engine.py labels
  python position_engine.py train
  python position_engine.py build
"""
import re, glob, json, os, sys, collections

OUT = "out"
BR_CACHE = "cache_br"
LABELS_PATH = f"{OUT}/br_positions.json"
MODEL_PATH  = f"{OUT}/position_model.json"
BUILD_PATH  = f"{OUT}/positions.json"

SLOTS = ["PG", "SG", "SF", "PF", "C"]

def season_label(end_year):
    return f"{end_year-1}-{str(end_year)[2:]}"

def _strip(s):
    return re.sub(r"<[^>]+>", "", s).strip()


# ---------------------------------------------------------------- features

import unicodedata

_SUFFIX = re.compile(r"\s+(jr|sr|ii|iii|iv|v)\.?$", re.I)

def norm_name(s):
    s = "".join(c for c in unicodedata.normalize("NFD", (s or "").lower())
                if unicodedata.category(c) != "Mn")
    s = s.replace(".", "").replace("'", "").replace("-", " ")
    s = _SUFFIX.sub("", s)
    return " ".join(s.split())

# Features chosen for POSITIONAL signal, grouped by the era they exist in.
# `avail` everywhere is deliberately excluded — it says nothing about position.
F_CORE = [  # present in all 47 seasons
    "reb75", "oreb", "dreb", "blkpct", "blk", "stlpct", "stl", "stk75",
    "ast", "ast75", "asttov", "tov", "tov75",
    "tp3r", "tp3a", "tp3", "p3pt", "tp2", "ftr", "ts", "efg", "pps",
    "usg", "pts", "mpg",
]
F_BIO    = ["height", "strength"]          # 2000-01 onward
F_TRACK  = ["drv", "potast", "selfcr", "rim", "mtch", "oppfg", "defl", "ddiff"]

FEATS_CORE   = F_CORE
FEATS_MODERN = F_CORE + F_BIO + F_TRACK

def season_start(s):
    return int(s[:4])

def metric(p, k):
    m = (p.get("m") or {}).get(k)
    if not m:
        return float("nan")
    v = (m.get("season") or {}).get("v")
    return float("nan") if v is None else float(v)

def build_matrix(players, feats):
    import numpy as np
    return np.array([[metric(p, k) for k in feats] for p in players], dtype="float64")

def load_joined(min_mp=250):
    """Join Savant player-seasons to BR listed positions on (normalized name, season)."""
    labels = json.load(open(LABELS_PATH))
    lab = {}
    for r in labels:
        if r["pos"] not in SLOTS:
            continue
        key = (norm_name(r["name"]), r["season"])
        # a traded player appears once per team plus a TOT row; keep the highest-MP row
        if key not in lab or r["mp"] > lab[key]["mp"]:
            lab[key] = r
    data = json.load(open(f"{OUT}/players.json"))["data"]
    joined = []
    for season, blk in data.items():
        for p in blk["players"]:
            r = lab.get((norm_name(p["name"]), season))
            if not r or r["mp"] < min_mp:
                continue
            joined.append((p, season, r["pos"], r["mp"], r["br_id"]))
    return data, joined

# ---------------------------------------------------------------- labels

def parse_labels():
    """BR advanced tables -> [{br_id, name, season, pos, tm, mp}]."""
    rows = []
    for f in sorted(glob.glob(f"{BR_CACHE}/NBA_*_advanced.html")):
        y = int(re.search(r"NBA_(\d+)_", f).group(1))
        season = season_label(y)
        html = open(f, encoding="utf-8", errors="replace").read()
        m = re.search(r'<table[^>]*id="advanced".*?</table>', html, re.S)
        if not m:
            m = re.search(r"<table.*?</table>", html, re.S)
        if not m:
            continue
        for tr in re.findall(r"<tr[^>]*>.*?</tr>", m.group(0), re.S):
            if "data-append-csv" not in tr:
                continue
            def g(stat):
                c = re.search(r'data-stat="%s"[^>]*>(.*?)</t[dh]>' % stat, tr, re.S)
                return _strip(c.group(1)) if c else ""
            pos = g("pos")
            if not pos:
                continue
            mp = g("mp").replace(",", "")
            rows.append({
                "br_id":  re.search(r'data-append-csv="([^"]+)"', tr).group(1),
                "name":   g("name_display"),
                "season": season,
                "pos":    pos,
                "tm":     g("team_name_abbr"),
                "mp":     int(mp) if mp.isdigit() else 0,
            })
    return rows

def cmd_labels():
    rows = parse_labels()
    os.makedirs(OUT, exist_ok=True)
    json.dump(rows, open(LABELS_PATH, "w"))
    seasons = {r["season"] for r in rows}
    print(f"player-season rows : {len(rows):,}")
    print(f"seasons            : {len(seasons)}  {min(seasons)} -> {max(seasons)}")
    print(f"rows with >=500 MP : {sum(1 for r in rows if r['mp'] >= 500):,}")
    print("label distribution :")
    for lab, n in collections.Counter(r["pos"] for r in rows).most_common(15):
        print(f"    {lab:10} {n:6,}")
    print(f"wrote {LABELS_PATH}")


# ---------------------------------------------------------------- train

def _ece(P, y, slots, bins=10):
    """Expected calibration error on the top-1 prediction."""
    import numpy as np
    conf = P.max(axis=1)
    pred = np.array([slots[i] for i in P.argmax(axis=1)])
    correct = (pred == y).astype(float)
    e, n = 0.0, len(y)
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        m = (conf > lo) & (conf <= hi)
        if m.sum():
            e += m.sum() / n * abs(correct[m].mean() - conf[m].mean())
    return float(e)


def _temperature(P, y, slots):
    """One-parameter temperature scaling fitted on OUT-OF-FOLD probabilities.

    HistGradientBoosting saturates: it returns 0.99 on players the label set says it
    gets wrong 28% of the time. Left uncorrected the 'distribution' is a one-hot label
    with extra steps and the versatility signal is dead. T > 1 softens it.
    """
    import numpy as np
    from scipy.optimize import minimize_scalar
    ix = {s: i for i, s in enumerate(slots)}
    yi = np.array([ix[v] for v in y])
    L = np.log(np.clip(P, 1e-12, 1))

    def nll(T):
        Z = L / T
        Z = Z - Z.max(axis=1, keepdims=True)
        E = np.exp(Z)
        p = E / E.sum(axis=1, keepdims=True)
        return -np.mean(np.log(np.clip(p[np.arange(len(yi)), yi], 1e-12, 1)))

    r = minimize_scalar(nll, bounds=(0.5, 8.0), method="bounded")
    return float(r.x)


def _apply_T(P, T):
    import numpy as np
    Z = np.log(np.clip(P, 1e-12, 1)) / T
    Z = Z - Z.max(axis=1, keepdims=True)
    E = np.exp(Z)
    return E / E.sum(axis=1, keepdims=True)


def _new_clf():
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(
        max_iter=250, learning_rate=0.06, max_depth=5, min_samples_leaf=40,
        l2_regularization=2.0, random_state=17)


def _fit_and_report(X, y, groups, feats, tag):
    import numpy as np
    from sklearn.model_selection import GroupKFold
    from sklearn.metrics import confusion_matrix

    # Out-of-fold probabilities, split by PLAYER so no player appears in both sides.
    gkf = GroupKFold(n_splits=5)
    oof = np.zeros((len(y), len(SLOTS)))
    for tr, te in gkf.split(X, y, groups):
        c = _new_clf().fit(X[tr], y[tr])
        order = list(c.classes_)
        oof[te] = c.predict_proba(X[te])[:, [order.index(s) for s in SLOTS]]

    pred = np.array([SLOTS[i] for i in oof.argmax(axis=1)])
    ix = {s: i for i, s in enumerate(SLOTS)}
    exact = float((pred == y).mean())
    adj = float(np.mean([abs(ix[a] - ix[b]) <= 1 for a, b in zip(pred, y)]))

    T = _temperature(oof, y, SLOTS)
    cal = _apply_T(oof, T)

    print(f"\n[{tag}]  n={len(y):,}  features={len(feats)}  (5-fold, split by player)")
    print(f"    exact position accuracy   : {exact:6.1%}")
    print(f"    within one slot           : {adj:6.1%}")
    print(f"    temperature               : {T:6.2f}")
    print(f"    mean top-1 confidence     : {oof.max(axis=1).mean():6.1%} raw"
          f"  ->{cal.max(axis=1).mean():6.1%} calibrated   (accuracy {exact:.1%})")
    print(f"    calibration error (ECE)   : {_ece(oof, y, SLOTS):6.1%} raw"
          f"  ->{_ece(cal, y, SLOTS):6.1%} calibrated")
    cm = confusion_matrix(y, pred, labels=SLOTS)
    print("    confusion (rows = BR listed, cols = predicted)")
    print("              " + "".join(f"{c:>7}" for c in SLOTS))
    for i, r in enumerate(SLOTS):
        print(f"      {r:>7}   " + "".join(f"{v:7d}" for v in cm[i]))

    # Deliberately NO refit on all data. A model refit on everything returns 0.99 on
    # players it memorised, and a temperature fitted out-of-fold cannot undo that. Instead
    # we ship the fold ensemble (for unseen players) AND the out-of-fold probabilities
    # (for players that were in training) — so every number the game reads is honest.
    folds = []
    for tr, te in gkf.split(X, y, groups):
        folds.append(_new_clf().fit(X[tr], y[tr]))
    return folds, T, cal, exact, adj


def cmd_train():
    import numpy as np, joblib
    data, joined = load_joined(min_mp=250)
    print(f"joined player-seasons (>=250 MP): {len(joined):,}")

    ys = np.array([j[2] for j in joined])
    gs = np.array([j[4] for j in joined])
    starts = np.array([season_start(j[1]) for j in joined])

    # historical / all-era model: box + advanced only
    Xc = build_matrix([j[0] for j in joined], FEATS_CORE)
    core, Tc, oof_c, ce, ca = _fit_and_report(Xc, ys, gs, FEATS_CORE, "core — all 47 seasons, box+advanced only")

    # modern model: adds measurables and tracking. 2013-14 on.
    mod = starts >= 2013
    Xm = build_matrix([j[0] for j, m in zip(joined, mod) if m], FEATS_MODERN)
    modern, Tm, oof_m, me, ma = _fit_and_report(Xm, ys[mod], gs[mod], FEATS_MODERN,
                                                "modern — 2013-14 on, +measurables +tracking")

    # out-of-fold probabilities, keyed so build() can prefer them over the ensemble
    oof = {}
    for (p, season, _, _, _), row in zip(joined, oof_c):
        oof[f"{p['id']}|{season}"] = [round(float(v), 4) for v in row]
    mj = [j for j, m in zip(joined, mod) if m]
    for (p, season, _, _, _), row in zip(mj, oof_m):
        oof[f"{p['id']}|{season}"] = [round(float(v), 4) for v in row]
    json.dump(oof, open(f"{OUT}/position_oof.json", "w"))
    print(f"wrote {OUT}/position_oof.json  ({len(oof):,} out-of-fold rows)")

    joblib.dump({"core": core, "modern": modern, "T_core": Tc, "T_modern": Tm,
                 "feats_core": FEATS_CORE, "feats_modern": FEATS_MODERN,
                 "slots": SLOTS, "modern_from": 2013, "n_folds": 5},
                f"{OUT}/position_model.joblib")
    print(f"\nwrote {OUT}/position_model.joblib")
    print(f"summary: core {ce:.1%}/{ca:.1%}   modern {me:.1%}/{ma:.1%}  (exact / within-one)")


# ---------------------------------------------------------------- build

def cmd_build():
    """Score every player-season -> out/positions.json.

    Emits a DISTRIBUTION per player-season, not a label:
      p5      [PG, SG, SF, PF, C] probabilities, rounded to 3dp
      pos     argmax slot
      slot    expected position on a 1(PG)..5(C) axis — a continuous 'positional
              size' scalar, which is what a lineup engine actually wants
      vers    normalized entropy of p5 in [0,1]; high = genuinely positionless
    """
    import numpy as np, joblib, math
    M = joblib.load(f"{OUT}/position_model.joblib")
    OOF = json.load(open(f"{OUT}/position_oof.json")) if os.path.exists(f"{OUT}/position_oof.json") else {}
    data = json.load(open(f"{OUT}/players.json"))["data"]
    out, counts = {}, collections.Counter()
    lnK = math.log(len(SLOTS))
    for season, blk in data.items():
        ps = blk["players"]
        modern = season_start(season) >= M["modern_from"]
        clfs  = M["modern"] if modern else M["core"]
        feats = M["feats_modern"] if modern else M["feats_core"]
        T     = M["T_modern"] if modern else M["T_core"]
        X = build_matrix(ps, feats)
        acc = None
        for c in clfs:
            order = list(c.classes_)
            Q = c.predict_proba(X)[:, [order.index(s) for s in SLOTS]]
            acc = Q if acc is None else acc + Q
        P = _apply_T(acc / len(clfs), T)
        for i, p in enumerate(ps):                     # honest values win
            o = OOF.get(f"{p['id']}|{season}")
            if o:
                P[i] = o
        blk_out = {}
        for p, row in zip(ps, P):
            row = np.clip(row, 1e-9, 1.0); row = row / row.sum()
            slot = float(sum((i + 1) * v for i, v in enumerate(row)))
            ent  = float(-sum(v * math.log(v) for v in row) / lnK)
            pos  = SLOTS[int(np.argmax(row))]
            blk_out[str(p["id"])] = {
                "p5":   [round(float(v), 3) for v in row],
                "pos":  pos,
                "slot": round(slot, 2),
                "vers": round(ent, 3),
                "src":  "modern" if modern else "core",
            }
            counts[pos] += 1
        out[season] = blk_out
    n_oof = sum(1 for season, blk in out.items() for pid in blk if f"{pid}|{season}" in OOF)
    print(f"  of which out-of-fold (player was in training): {n_oof:,}")
    payload = {"slots": SLOTS, "generated_by": "position_engine.build",
               "modern_from": M["modern_from"], "data": out}
    json.dump(payload, open(BUILD_PATH, "w"))
    n = sum(len(v) for v in out.values())
    print(f"scored {n:,} player-seasons across {len(out)} seasons")
    print("primary-position distribution:", dict(counts))
    print(f"wrote {BUILD_PATH}")


def cmd_check():
    """Eyeball the current season against players everyone knows."""
    pos = json.load(open(BUILD_PATH))
    data = json.load(open(f"{OUT}/players.json"))["data"]
    season = max(data.keys())
    blk = {str(p["id"]): p for p in data[season]["players"]}
    pb = pos["data"][season]
    names = ["Nikola Jokic", "Victor Wembanyama", "Shai Gilgeous-Alexander",
             "Draymond Green", "Giannis Antetokounmpo", "Chet Holmgren",
             "Luka Doncic", "Stephen Curry", "Jalen Williams", "Rudy Gobert",
             "Josh Hart", "Alperen Sengun", "Amen Thompson", "Kevin Durant"]
    want = {norm_name(n) for n in names}
    print(f"{season}   " + "".join(f"{s:>7}" for s in SLOTS) + "   slot  vers  listed")
    rows = [(p, pb[i]) for i, p in blk.items() if norm_name(p["name"]) in want and i in pb]
    for p, q in sorted(rows, key=lambda r: r[1]["slot"]):
        bars = "".join(f"{v:7.2f}" for v in q["p5"])
        print(f"  {p['name'][:26]:26}{bars}  {q['slot']:5.2f} {q['vers']:5.2f}   {p['pos']}")
    # how much movement does the model find that the static label cannot?
    moves = 0; tot = 0
    for i, q in pb.items():
        prev = pos["data"].get("2023-24", {}).get(i)
        if prev:
            tot += 1
            if abs(q["slot"] - prev["slot"]) >= 0.5: moves += 1
    if tot:
        print(f"\nplayers whose slot moved >=0.5 between 2023-24 and {season}: "
              f"{moves}/{tot} ({moves/tot:.0%}) — invisible to the career-static label")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "labels"
    {"labels": cmd_labels, "train": cmd_train, "build": cmd_build, "check": cmd_check}[cmd]()
