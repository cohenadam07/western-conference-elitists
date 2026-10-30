"""
archetype_engine.py — skill vectors -> interpretable player archetypes.

Archetypes exist so the fit logic has something to reason about: two Primary Initiators
collide, a Drop Big behind two poor point-of-attack defenders is a specific weakness,
a Slasher with no Stationary Spacers around him loses his rim numbers. None of that is
expressible in "87 overall".

They are DERIVED, never hand-assigned. k-means over the shrunk skill vectors, fitted on
the modern era where coverage is good, then applied to all 47 seasons. Assignment is
soft — a membership vector, not a label — because most players are genuinely between two
types and forcing a hard label throws that away.

Usage:
  python archetype_engine.py sweep     # pick k honestly
  python archetype_engine.py fit       # fit + name + write out/archetypes.json
  python archetype_engine.py check     # eyeball known players
"""
import json, sys, math, collections

OUT = "out"
PATH = f"{OUT}/archetypes.json"
MODEL = f"{OUT}/archetype_model.joblib"
MODERN_FROM = 2013

# Stylistic skills only. `availability` is health, `def_impact` is an outcome not a
# style, `athleticism` is only ~50% covered — none of them describe HOW a player plays.
FEATS = [
    "shooting_3", "shooting_mid_in", "shot_making", "self_creation", "rim_pressure",
    "playmaking", "ball_security", "off_rebounding", "gravity", "contested_diet",
    "rim_protection", "perimeter_def", "def_rebounding", "event_creation", "size",
]


def load():
    sk = json.load(open(f"{OUT}/skills.json"))
    return sk["data"]


def matrix(rows):
    import numpy as np
    X = np.full((len(rows), len(FEATS)), 50.0)
    for i, r in enumerate(rows):
        for j, f in enumerate(FEATS):
            v = r["s"].get(f)
            if v:
                X[i, j] = v.get("vs", v["v"])
    return X


def modern_rows(data):
    rows, keys = [], []
    for season, blk in data.items():
        if int(season[:4]) < MODERN_FROM:
            continue
        for pid, r in blk.items():
            rows.append(r); keys.append((season, pid))
    return rows, keys


# Named from the fitted components' own skill profiles and their exemplar players —
# not chosen up front and fitted to. See DESIGN notes in the project doc.
NAMES = {
    # Names describe STYLE, not position and not quality. "3&D Role Player" rather than
    # "3&D Wing" because Kyle Lowry lands there and he is a point guard — the component is
    # low-usage spacing plus perimeter defence at any size. "Combo Guard" rather than
    # "Scoring Guard" because Tre Jones sits next to Curry in it: same on-ball shooting
    # guard shape, wildly different quality. Quality lives in `impact`, never in the name.
    0: "Combo Guard",         # on-ball, self-creating, shoots; small
    1: "Rim-Running Big",     # o-reb, contested diet, size; no three, no passing
    2: "3&D Role Player",     # spacing + perimeter defence + low usage, any position
    3: "Jumbo Creator",       # size AND creation AND playmaking — the engines
    4: "Movement Shooter",    # gravity + three; low contested diet, low playmaking
    5: "Role Big",            # size + rebounding + rim protection, low usage
    6: "Pass-First Guard",    # playmaking + event creation, smallest, low shot-making
}
K = 7
N_PC = 5


def cmd_sweep():
    import numpy as np
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score
    rows, _ = modern_rows(load())
    X = matrix(rows)
    print(f"n = {len(X):,} modern player-seasons, {len(FEATS)} stylistic skills\n")
    print(f"{'k':>3}  {'inertia':>12}  {'silhouette':>11}")
    sub = np.random.default_rng(7).choice(len(X), size=min(4000, len(X)), replace=False)
    for k in range(6, 19, 2):
        km = KMeans(n_clusters=k, n_init=10, random_state=7).fit(X)
        sil = silhouette_score(X[sub], km.labels_[sub])
        print(f"{k:3d}  {km.inertia_:12,.0f}  {sil:11.3f}")


def cmd_fit():
    """Fit on the modern era, apply to all 47 seasons, write soft memberships."""
    import numpy as np, joblib
    from sklearn.decomposition import PCA
    from sklearn.mixture import GaussianMixture

    data = load()
    rows, keys = modern_rows(data)
    X = matrix(rows)
    mu = X.mean(0)
    pca = PCA(n_components=N_PC, random_state=7).fit(X - mu)
    gmm = GaussianMixture(n_components=K, covariance_type="full", random_state=7,
                          n_init=5, reg_covar=1e-3).fit(pca.transform(X - mu))

    out = {}
    for season, blk in data.items():
        pids = list(blk.keys())
        if not pids:
            continue
        Xs = matrix([blk[p] for p in pids])
        R = gmm.predict_proba(pca.transform(Xs - mu))
        modern = int(season[:4]) >= MODERN_FROM
        blk_out = {}
        for pid, r in zip(pids, R):
            j = int(np.argmax(r))
            blk_out[pid] = {
                "a":    NAMES[j],
                "mix":  {NAMES[i]: round(float(v), 3) for i, v in enumerate(r) if v >= 0.05},
                "pure": round(float(r[j]), 3),      # 1.0 = textbook, low = tweener
                "insample": modern,
            }
        out[season] = blk_out

    joblib.dump({"pca": pca, "gmm": gmm, "mu": mu, "feats": FEATS, "names": NAMES}, MODEL)
    json.dump({"generated_by": "archetype_engine.fit", "k": K, "names": NAMES,
               "modern_from": MODERN_FROM,
               "note": "Soft membership. `pure` is the top component's probability — low "
                       "means a genuine tweener, which is information, not error. Seasons "
                       "before modern_from are scored out of sample with tracking skills "
                       "defaulted, so treat their archetypes as indicative only.",
               "data": out}, open(PATH, "w"))
    n = sum(len(v) for v in out.values())
    cur = max(out)
    print(f"scored {n:,} player-seasons -> {PATH}")
    dist = collections.Counter(r["a"] for r in out[cur].values())
    print(f"\n{cur} archetype distribution:")
    for a, c in dist.most_common():
        print(f"    {a:20} {c:4d}")
    pures = [r["pure"] for r in out[cur].values()]
    print(f"\nmean purity {sum(pures)/len(pures):.2f} — "
          f"{sum(1 for p in pures if p < 0.6)} of {len(pures)} players are genuine tweeners (<0.60)")


def cmd_check():
    arch = json.load(open(PATH))
    players = json.load(open(f"{OUT}/players.json"))["data"]
    season = max(arch["data"])
    nm = {str(p["id"]): p["name"] for p in players[season]["players"]}
    A = arch["data"][season]
    want = ["Stephen Curry", "Nikola Jokic", "Rudy Gobert", "Victor Wembanyama",
            "Shai Gilgeous-Alexander", "Draymond Green", "Giannis Antetokounmpo",
            "Luka Doncic", "Alperen Sengun", "Amen Thompson", "Duncan Robinson",
            "Luguentz Dort", "Kevin Durant", "Chet Holmgren"]
    print(f"{season}\n")
    for w in want:
        pid = next((i for i, n in nm.items() if n == w), None)
        if not pid or pid not in A:
            print(f"  {w:26} —"); continue
        r = A[pid]
        mix = ", ".join(f"{k} {v:.2f}" for k, v in
                        sorted(r["mix"].items(), key=lambda t: -t[1])[:3])
        print(f"  {w:26} {r['a']:20} {mix}")
    print("\npurest examples of each archetype this season:")
    for a in NAMES.values():
        best = sorted(((r["pure"], nm.get(i, "?")) for i, r in A.items()
                       if r["a"] == a and i in nm), reverse=True)[:3]
        print(f"    {a:20} " + ", ".join(f"{n} ({p:.2f})" for p, n in best))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fit"
    {"sweep": cmd_sweep, "fit": cmd_fit, "check": cmd_check}[cmd]()
