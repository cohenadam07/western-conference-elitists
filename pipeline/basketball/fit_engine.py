"""
fit_engine.py — derive the lineup FIT matrix from team outcomes.

The premise of §3.2 is that certain archetype combinations work and others collide.
Asserting which ones is easy and worthless. This module measures it:

    fit = the part of a team's net rating that the sum of its players' individual
          impact does NOT explain.

Build a baseline that predicts team net rating from minutes-weighted individual impact
alone, then ask whether composition features (spacing, rim protection, on-ball usage
collision, positional size) add anything on top. Whatever survives out-of-sample is the
fit matrix. Whatever doesn't gets thrown away rather than shipped as flavour.

Usage:
  python fit_engine.py teams     # fetch/cache BR season pages -> out/team_seasons.json
  python fit_engine.py build     # composition features -> out/team_features.json
  python fit_engine.py model     # baseline vs +composition, report what survives
"""
import re, os, sys, json, time, urllib.request, collections

OUT, BR_CACHE = "out", "cache_br"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
DELAY = 3.5                      # BR rate-limits hard; same politeness as br_fetch.py
MODERN_FROM = 2014               # archetypes are in-sample from 2013-14 on
TEAMS_PATH = f"{OUT}/team_seasons.json"

def season_label(y): return f"{y-1}-{str(y)[2:]}"

def _strip(x): return re.sub(r"<[^>]+>", "", x).strip()

def fetch_season(end_year):
    dst = f"{BR_CACHE}/NBA_{end_year}_season.html"
    if os.path.exists(dst):
        return open(dst, encoding="utf-8", errors="replace").read(), False
    url = f"https://www.basketball-reference.com/leagues/NBA_{end_year}.html"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    html = urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "replace")
    open(dst, "w").write(html)
    return html, True

FIELDS = ["wins", "losses", "off_rtg", "def_rtg", "net_rtg", "srs", "pace",
          "efg_pct", "tov_pct", "orb_pct", "ft_rate", "opp_efg_pct", "opp_tov_pct",
          "drb_pct", "opp_ft_rate", "mov", "sos"]

def parse_teams(html, season):
    m = re.search(r'<table[^>]*id="advanced-team".*?</table>', html, re.S)
    if not m:
        return []
    rows = []
    for tr in re.findall(r"<tr[^>]*>.*?</tr>", m.group(0), re.S):
        t = re.search(r'data-stat="team"[^>]*>(.*?)</t[dh]>', tr, re.S)
        if not t:
            continue
        name = _strip(t.group(1))
        if not name or name.startswith("League"):
            continue
        rec = {"season": season, "team_name": name.replace("*", "")}
        ok = False
        for f in FIELDS:
            c = re.search(r'data-stat="%s"[^>]*>(.*?)</t[dh]>' % f, tr, re.S)
            v = _strip(c.group(1)).replace(",", "") if c else ""
            try:
                rec[f] = float(v); ok = True
            except ValueError:
                rec[f] = None
        if ok:
            rows.append(rec)
    return rows

def cmd_teams():
    end = 2026
    out, fetched = [], 0
    for y in range(MODERN_FROM, end + 1):
        html, live = fetch_season(y)
        if live:
            fetched += 1
            time.sleep(DELAY)
        rows = parse_teams(html, season_label(y))
        out.extend(rows)
        print(f"  {season_label(y)}  {len(rows):2d} teams{'  (fetched)' if live else '  (cached)'}")
    json.dump(out, open(TEAMS_PATH, "w"))
    print(f"\n{len(out)} team-seasons -> {TEAMS_PATH}   ({fetched} live fetches)")


# ---------------------------------------------------------------- composition

ABBR = {
 "Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BKN","Charlotte Hornets":"CHA",
 "Charlotte Bobcats":"CHA","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL",
 "Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU",
 "Indiana Pacers":"IND","Los Angeles Clippers":"LAC","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM",
 "Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP",
 "New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI",
 "Phoenix Suns":"PHX","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS",
 "Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS",
}

def mval(p, k):
    v = ((p.get("m", {}).get(k) or {}).get("season") or {}).get("v")
    return None if v is None else float(v)

def cmd_build():
    import math
    players = json.load(open(f"{OUT}/players.json"))["data"]
    skills  = json.load(open(f"{OUT}/skills.json"))["data"]
    arch    = json.load(open(f"{OUT}/archetypes.json"))
    pos     = json.load(open(f"{OUT}/positions.json"))["data"]
    ANAMES  = list(arch["names"].values()) if isinstance(arch["names"], dict) else arch["names"]
    teams   = json.load(open(TEAMS_PATH))

    rows = []
    for t in teams:
        season, ab = t["season"], ABBR.get(t["team_name"])
        if not ab or season not in players or t.get("net_rtg") is None:
            continue
        roster = [p for p in players[season]["players"] if p.get("team") == ab]
        S, A, P = skills.get(season, {}), arch["data"].get(season, {}), pos.get(season, {})
        ws, tot = [], 0.0
        for p in roster:
            w = mval(p, "minshare") or 0.0
            if w <= 0:
                continue
            ws.append((p, w)); tot += w
        if tot <= 0 or len(ws) < 8:
            continue

        def mw(fn):
            n = d = 0.0
            for p, w in ws:
                v = fn(p)
                if v is not None:
                    n += w * v; d += w
            return n / d if d else None

        def sk(p, k):
            v = S.get(str(p["id"]), {}).get("s", {}).get(k)
            return None if not v else v.get("vs", v["v"])

        top = sorted(ws, key=lambda t: -t[1])[:5]
        r = {"season": season, "team": ab, "net_rtg": t["net_rtg"], "srs": t["srs"],
             "off_rtg": t["off_rtg"], "def_rtg": t["def_rtg"], "wins": t["wins"],
             # baseline: minutes-weighted individual impact
             "mw_bpm":   mw(lambda p: mval(p, "bpm")),
             "mw_obpm":  mw(lambda p: mval(p, "obpm")),
             "mw_dbpm":  mw(lambda p: mval(p, "dbpm")),
             # composition
             "spacing":     mw(lambda p: sk(p, "shooting_3")),
             "gravity":     mw(lambda p: sk(p, "gravity")),
             "rimprot":     mw(lambda p: sk(p, "rim_protection")),
             "poa":         mw(lambda p: sk(p, "perimeter_def")),
             "playmaking":  mw(lambda p: sk(p, "playmaking")),
             "size":        mw(lambda p: sk(p, "size")),
             "rimpress":    mw(lambda p: sk(p, "rim_pressure")),
             "ballsec":     mw(lambda p: sk(p, "ball_security")),
             # structural
             "spacing_floor": min([sk(p, "shooting_3") or 50 for p, _ in top]),
             "onball_load":   sum(w for p, w in ws if (sk(p, "self_creation") or 0) > 75) / tot,
             "slot_spread":   None,
             "arch_entropy":  None,
             }
        slots = [P.get(str(p["id"]), {}).get("slot") for p, _ in top]
        slots = [x for x in slots if x is not None]
        if len(slots) >= 4:
            m = sum(slots) / len(slots)
            r["slot_spread"] = (sum((x - m) ** 2 for x in slots) / len(slots)) ** 0.5
        share = collections.Counter()
        for p, w in ws:
            a = A.get(str(p["id"]), {}).get("a")
            if a:
                share[a] += w / tot
        for a in ANAMES:
            r["a_" + a.replace(" ", "_").replace("&", "")] = round(share.get(a, 0.0), 4)
        if share:
            r["arch_entropy"] = -sum(v * math.log(v) for v in share.values() if v > 0)
        rows.append(r)

    json.dump(rows, open(f"{OUT}/team_features.json", "w"))
    print(f"{len(rows)} team-seasons with composition features -> {OUT}/team_features.json")
    ok = [r for r in rows if r["mw_bpm"] is not None]
    print(f"  usable for modelling: {len(ok)}")
    print("  feature list:", [k for k in rows[0] if k not in
          ("season","team","net_rtg","srs","off_rtg","def_rtg","wins")])



# ---------------------------------------------------------------- model

BASE_CIRC = ["mw_bpm", "mw_obpm", "mw_dbpm"]
SKILLS_IND = ["spacing", "gravity", "rimprot", "poa", "playmaking", "size",
              "rimpress", "ballsec"]
COMPOSITION = ["spacing_floor", "onball_load", "slot_spread", "arch_entropy",
               "a_Combo_Guard", "a_Rim-Running_Big", "a_3D_Role_Player",
               "a_Jumbo_Creator", "a_Movement_Shooter", "a_Role_Big",
               "a_Pass-First_Guard"]


def _xy(rows, feats, target="net_rtg"):
    import numpy as np
    X = np.array([[r.get(f) if r.get(f) is not None else np.nan for f in feats] for r in rows], float)
    col = np.nanmean(X, axis=0)
    idx = np.where(np.isnan(X))
    X[idx] = np.take(col, idx[1])
    y = np.array([r[target] for r in rows], float)
    g = np.array([r["season"] for r in rows])
    return X, y, g


def _loso_r2(rows, feats, target="net_rtg", alpha=10.0):
    """Leave-one-SEASON-out R². Season folds, because team-seasons inside a year share
    a league environment and random splitting would leak it."""
    import numpy as np
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    X, y, g = _xy(rows, feats, target)
    pred = np.zeros_like(y)
    for s in np.unique(g):
        te = g == s
        m = make_pipeline(StandardScaler(), Ridge(alpha=alpha)).fit(X[~te], y[~te])
        pred[te] = m.predict(X[te])
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return 1 - ss_res / ss_tot, pred, y


def cmd_model():
    import numpy as np
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    rows = json.load(open(f"{OUT}/team_features.json"))
    print(f"n = {len(rows)} team-seasons, target = net rating, "
          f"leave-one-season-out (13 folds)\n")

    combos = [
        ("A  circular baseline (minutes-weighted BPM)", BASE_CIRC),
        ("B  honest baseline (individual skills only)", SKILLS_IND),
        ("C  B + composition / archetype mix",          SKILLS_IND + COMPOSITION),
        ("D  composition only",                          COMPOSITION),
    ]
    res = {}
    for name, feats in combos:
        r2, _, _ = _loso_r2(rows, feats)
        res[name[0]] = r2
        print(f"  {name:46} OOS R² {r2:6.3f}")
    print(f"\n  incremental from composition (C - B): {res['C'] - res['B']:+.3f}")

    # which composition features carry it — permutation importance on OOS error
    X, y, g = _xy(rows, SKILLS_IND + COMPOSITION)
    feats = SKILLS_IND + COMPOSITION
    base, _, _ = _loso_r2(rows, feats)
    rng = np.random.default_rng(7)
    print("\n  permutation importance (drop in OOS R² when the feature is shuffled):")
    imp = []
    for j, f in enumerate(feats):
        drops = []
        for _ in range(5):
            rows2 = [dict(r) for r in rows]
            vals = [r.get(f) for r in rows2]
            rng.shuffle(vals)
            for r, v in zip(rows2, vals):
                r[f] = v
            r2, _, _ = _loso_r2(rows2, feats)
            drops.append(base - r2)
        imp.append((float(np.mean(drops)), f))
    for d, f in sorted(imp, reverse=True):
        flag = "  <-- real" if d > 0.004 else ""
        print(f"      {f:22} {d:+.4f}{flag}")



def cmd_matrix():
    """Freeze the surviving fit terms as the coefficients the sim will actually use."""
    import numpy as np
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    rows = json.load(open(f"{OUT}/team_features.json"))
    for r in rows:
        r["x_collide"] = (r.get("onball_load") or 0) ** 2
    feats = SKILLS_IND + ["onball_load", "x_collide"] + \
            [c for c in COMPOSITION if c.startswith("a_")]
    X, y, _ = _xy(rows, feats)
    sc = StandardScaler().fit(X)
    m = make_pipeline(sc, Ridge(alpha=10.0)).fit(X, y)
    r2, _, _ = _loso_r2(rows, feats)
    out = {
        "target": "team net rating",
        "n_team_seasons": len(rows),
        "oos_r2": round(r2, 3),
        "baseline_individual_only_r2": round(_loso_r2(rows, SKILLS_IND)[0], 3),
        "note": "Standardised ridge coefficients. Terms tested and DROPPED for no "
                "out-of-sample support: slasher x spacing, rim-protection x POA defence, "
                "size x spacing, positional spread, archetype diversity, worst-starter "
                "spacing. Team-season aggregates cannot see lineup-level effects; this is "
                "what is detectable at team level, not proof the rest do not exist.",
        "mean": {f: float(v) for f, v in zip(feats, sc.mean_)},
        "scale": {f: float(v) for f, v in zip(feats, sc.scale_)},
        "coef": {f: round(float(c), 4) for f, c in zip(feats, m[-1].coef_)},
        "intercept": float(m[-1].intercept_),
    }
    json.dump(out, open(f"{OUT}/fit_matrix.json", "w"), indent=1)
    print(f"OOS R2 {r2:.3f} (individual-only baseline {out['baseline_individual_only_r2']:.3f})")
    print(f"wrote {OUT}/fit_matrix.json")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "teams"
    {"teams": cmd_teams, "build": cmd_build, "model": cmd_model, "matrix": cmd_matrix}[cmd]()
