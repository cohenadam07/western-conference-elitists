"""1.1.0: fourth-down and two-point decisions, for the team page and a future College Football Coaching Savant.

    python -m pipeline.cfb.fourth fit                # the average-coach and conversion models (2014-2024)
    python -m pipeline.cfb.fourth score 2014 ... 2026  # work/decisions_<season>.parquet
    python -m pipeline.cfb.fourth check              # against the release file's recommendation (2025)

Every fourth down in regulation (a run or pass, a punt, or a field-goal try; penalties and kneels are left out)
gets:
  xgo         the chance an average FBS coach goes for it in that spot: gradient boosting on the distance, the
              yard line, the score, the clock and win probability, fitted on 2014-2024 (three classes: go,
              punt, kick)
  p_conv      the chance a try converts there (logistic on distance and field, 2014-2024 fourth downs)
  wp_go, wp_punt, wp_fg
              the offence's win probability after each choice, from 1.0.0's expected-points and win-probability
              models:
                go     converts to a first down at the line to gain plus the average extra yards a converted
                       fourth down gains (or a touchdown and the kickoff after it); fails, and the other team
                       takes over at the spot
                punt   the other team's first down where the average net punt from that spot leaves it
                kick   made (3 points and a kickoff) by the frozen kicker model's chance from that distance, or
                       missed, the other team at the spot of the kick or its 20, whichever is better for it
  ep_go, ep_punt, ep_fg
              the same three in expected points
  rec         the recommendation: the choice worth the most expected points, except in the last 15 minutes of a
              game within 16 points, where the highest win probability decides
  go_boost    expected points of going less the best alternative; ep_lost: expected points the choice made gave up
Team stats: go rate over expected (sum of go - xgo per fourth down), the share of fourth downs that follow the
recommendation, and win probability given up on fourth-down choices.

Two-point tries are read from the try rows themselves (plays.PAT_TYPES): attempts and conversions after each
touchdown in regulation.
"""
import re
import sys
import json
import numpy as np
import pandas as pd
import joblib          # only WCE's own models, committed under pipeline/cfb/state/models (as 1.0.0's EP and WP are)
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from .paths import RAW, WORK, OUT
from .state import load_state, model_path
from . import expand as X
from .ep import EP_FEATS, WP_FEATS, CLASSES

FIT = list(range(2014, 2025))
GO_FEATS = ["dist", "ytg", "score_diff", "secs_game", "period", "wp"]
SECS_PER_PLAY = 6.0
LATE_SECS, LATE_MARGIN = 900, 16
DECISIONS = ("go", "punt", "fg")
TWO_PT = {"Two-Point Conversion Good", "Two-Point Conversion Missed", "Two Point Pass", "Two Point Rush", "2pt Conversion",
          "Defensive 2pt Conversion"}
ONE_PT = {"Extra Point Good", "Extra Point Missed", "Blocked PAT"}


def fourths(y):
    g = pd.read_parquet(WORK / "games.parquet")
    gg = g[(g.season == y) & g.fbs_game & g.final]
    d = pd.read_parquet(WORK / f"plays_{y}.parquet")
    e = pd.read_parquet(WORK / f"epa_{y}.parquet")
    for c in ("ep", "epa", "wp", "garbage_cfbd"):
        d[c] = e[c].to_numpy()
    d = d[d.game_id.isin(gg.game_id) & d.off.notna()].copy()
    m = ((d.down == 4) & (d.period <= 4) & d.cat.isin(["rush", "pass", "punt", "fg"]) & ~d.f_kneel & ~d.f_pen_noplay
         & d.ytg.between(1, 99) & (d.dist >= 1) & d.wp.notna())
    f = d[m].copy()
    f["decision"] = np.where(f.cat.isin(["rush", "pass"]), "go", f.cat)
    f["neutral"] = gg.set_index("game_id").neutral_site.reindex(f.game_id).fillna(False).to_numpy()
    f["spread_home"] = gg.set_index("game_id").spread_home.reindex(f.game_id).to_numpy()
    f["conv"] = (f.decision == "go") & ((f.yards >= f.dist) | (f.pts == 7)) & ~f.f_int & ~f.f_fum_lost & ~f.f_sack
    f["season"] = y
    return f, d


def fit():
    parts = [fourths(y)[0] for y in FIT]
    F = pd.concat(parts, ignore_index=True)
    st = X.xstate()
    lab = F.decision.map({"go": 0, "punt": 1, "fg": 2}).to_numpy()
    m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=31, min_samples_leaf=200, random_state=7)
    m.fit(F[GO_FEATS].astype(float), lab)
    joblib.dump(m, X.MODELS / "go_model.joblib")
    gof = F[F.decision == "go"]
    lr = LogisticRegression(C=10.0, max_iter=4000).fit(X.conv_X(gof), gof.conv.astype(int))
    extra = float((gof[gof.conv & (gof.pts != 7)].yards - gof[gof.conv & (gof.pts != 7)].dist).clip(lower=0).mean())
    # average net punt by the yard line it was kicked from (5-yard bands), and how often a punt is touched back
    st["fourth"] = {"go_model": "models/go_model.joblib", "go_feats": GO_FEATS, "classes": list(DECISIONS),
                    "conv": {"intercept": float(lr.intercept_[0]), "coef": [float(v) for v in lr.coef_[0]]},
                    "extra_yards_on_conversion": round(extra, 3), "fourth_downs": int(len(F)),
                    "punt_net": punt_net(), "secs_per_play": SECS_PER_PLAY}
    X.XFILE.write_text(json.dumps(st, indent=1, sort_keys=True))
    X.reset()
    print("fourth-down models:", len(F), "fourth downs; go rate", round(float((F.decision == "go").mean()), 3), "conversion",
          round(float(gof.conv.mean()), 3), "extra yards on a conversion", round(extra, 2))


def punt_net():
    """Where the other team starts after a punt, by the punting spot (yards to the end zone, 5-yard bands), 2014-2024."""
    rows = []
    for y in FIT:
        d = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["game_id", "gpn", "cat", "ytg", "off", "period", "ptype", "f_pen_noplay"])
        d = d.sort_values(["game_id", "gpn"])
        nx = d[d.cat.isin(["rush", "pass", "penalty", "punt", "fg", "other"])].copy()
        nx["n_ytg"] = nx.groupby("game_id").ytg.shift(-1)
        nx["n_off"] = nx.groupby("game_id").off.shift(-1)
        p = nx[(nx.cat == "punt") & (nx.period <= 4) & ~nx.f_pen_noplay & (nx.n_off != nx.off) & nx.n_ytg.notna()
               & ~nx.ptype.str.contains("Touchdown|Safety|Blocked", regex=True)]
        rows.append(p[["ytg", "n_ytg"]])
    p = pd.concat(rows)
    p["band"] = (p.ytg // 5).clip(upper=19).astype(int)
    t = p.groupby("band").n_ytg.mean()
    return {str(int(k)): round(float(v), 2) for k, v in t.items()}


class WP:
    """1.0.0's expected-points and win-probability models, applied to states that did not happen."""

    def __init__(self):
        self.ep = joblib.load(model_path("ep_model.joblib"))
        self.wp = joblib.load(model_path("wp_model.joblib"))["wp"]

    def ep_of(self, s):
        s = s.copy()
        s["dist"] = np.clip(np.minimum(s.dist, s.ytg), 1, 40)
        s["gtg"] = (s.dist >= s.ytg).astype(float)
        s["ytg"] = s.ytg.clip(1, 99)
        return self.ep.predict_proba(s[EP_FEATS]) @ CLASSES

    def __call__(self, s):
        """s: DataFrame with down, dist, ytg, secs_half, secs_game, score_diff, home (1, 0 or 0.5), spread_pos."""
        s = s.copy()
        s["dist"] = np.clip(np.minimum(s.dist, s.ytg), 1, 40)
        s["gtg"] = (s.dist >= s.ytg).astype(float)
        s["ytg"] = s.ytg.clip(1, 99)
        ep = self.ep.predict_proba(s[EP_FEATS]) @ CLASSES
        el = np.clip(1 - s.secs_game.to_numpy() / 3600.0, 0, 1)
        W = s.assign(ep=ep, diff_time=s.score_diff * np.exp(4 * el), spread_time=s.spread_pos * np.exp(-4 * el))
        return self.wp.predict_proba(W[WP_FEATS])[:, 1]


def score(y, wpm=None):
    st = X.xstate()["fourth"]
    f, d = fourths(y)
    out_cols = ["game_id", "play_id", "season", "off", "deff", "period", "secs_half", "secs_game", "ytg", "dist", "score_diff", "decision",
                "conv", "xgo", "p_conv", "wp", "wp_go", "wp_punt", "wp_fg", "ep_go", "ep_punt", "ep_fg", "late", "rec", "go_boost", "ep_lost", "garbage_cfbd"]
    if not len(f):
        pd.DataFrame(columns=out_cols).to_parquet(WORK / f"decisions_{y}.parquet", index=False)
        return
    go = X.joblib_model("go_model.joblib").predict_proba(f[GO_FEATS].astype(float))
    f["xgo"] = go[:, 0]
    f["p_conv"] = X.logit(st["conv"], X.conv_X(f))
    wpm = wpm or WP()
    home = np.where(f.neutral, 0.5, (f.off == f.home).astype(float))
    sp = np.where(f.off == f.home, f.spread_home, -f.spread_home)
    sd = f.score_diff.to_numpy(dtype=float)
    secs_h = np.clip(f.secs_half.to_numpy(dtype=float) - SECS_PER_PLAY, 0, None)
    secs_g = np.clip(f.secs_game.to_numpy(dtype=float) - SECS_PER_PLAY, 0, None)
    ytg, dist = f.ytg.to_numpy(dtype=float), f.dist.to_numpy(dtype=float)

    def state(ytg_, sd_, me):
        """A first-and-10 state; me=True: this offence has the ball, else the other team (its own score and site)."""
        return pd.DataFrame({"down": 1.0, "dist": np.minimum(10.0, ytg_), "ytg": ytg_, "secs_half": secs_h, "secs_game": secs_g,
                             "score_diff": sd_ if me else -sd_, "home": home if me else 1 - home, "spread_pos": sp if me else -sp})

    def theirs(ytg_them, sd_):
        return 1 - wpm(state(ytg_them, sd_, False))

    after_conv = ytg - dist - st["extra_yards_on_conversion"]
    td = after_conv <= 0
    w_succ = np.where(td, theirs(np.full(len(f), 75.0), sd + 7), wpm(state(np.clip(after_conv, 1, 99), sd, True)))
    w_fail = theirs(np.clip(100 - ytg, 1, 99), sd)
    f["wp_go"] = f.p_conv * w_succ + (1 - f.p_conv) * w_fail
    band = np.clip(ytg // 5, 0, 19).astype(int).astype(str)
    net = np.array([st["punt_net"].get(b, np.nan) for b in band], dtype=float)
    f["wp_punt"] = np.where(ytg >= 25, theirs(np.clip(net, 1, 99), sd), np.nan)
    km = load_state()["kick"]
    kd = ytg + 17
    pm = 1 / (1 + np.exp(-(km["intercept"] + km["dist"] * kd + km["dist2"] * kd ** 2)))
    miss_them = np.minimum(100 - (ytg + 7), 80.0)
    f["wp_fg"] = np.where(kd <= 65, pm * theirs(np.full(len(f), 75.0), sd + 3) + (1 - pm) * theirs(np.clip(miss_them, 1, 99), sd), np.nan)
    # the same three choices in expected points (smooth where win probability is flat: early, or in a lopsided game)
    def ep_theirs(ytg_them, sd_):
        return -wpm.ep_of(state(ytg_them, sd_, False))

    e_succ = np.where(td, 7 + ep_theirs(np.full(len(f), 75.0), sd + 7), wpm.ep_of(state(np.clip(after_conv, 1, 99), sd, True)))
    f["ep_go"] = f.p_conv * e_succ + (1 - f.p_conv) * ep_theirs(np.clip(100 - ytg, 1, 99), sd)
    f["ep_punt"] = np.where(ytg >= 25, ep_theirs(np.clip(net, 1, 99), sd), np.nan)
    f["ep_fg"] = np.where(kd <= 65, pm * (3 + ep_theirs(np.full(len(f), 75.0), sd + 3)) + (1 - pm) * ep_theirs(np.clip(miss_them, 1, 99), sd), np.nan)
    # the recommendation: expected points, except in the last 15 minutes of a game within 16 points, where the score and
    # the clock matter more than field position and win probability decides. (Win probability alone agreed with the
    # release file's recommendation on 67% of 2025's fourth downs, the hybrid on 74%: in lopsided games WP barely
    # moves between the choices, under the boosted model's resolution, so its pick was near random there.)
    D = np.array(DECISIONS)
    Wp = f[["wp_go", "wp_punt", "wp_fg"]].to_numpy()
    Ep = f[["ep_go", "ep_punt", "ep_fg"]].to_numpy()
    rec_wp = D[np.nanargmax(np.where(np.isnan(Wp), -99, Wp), axis=1)]
    rec_ep = D[np.nanargmax(np.where(np.isnan(Ep), -99, Ep), axis=1)]
    f["late"] = (f.secs_game <= LATE_SECS) & (f.score_diff.abs() <= LATE_MARGIN)
    f["rec"] = np.where(f.late, rec_wp, rec_ep)
    f["go_boost"] = f.ep_go - np.nanmax(np.where(np.isnan(Ep[:, 1:]), -99, Ep[:, 1:]), axis=1)
    chosen = np.select([f.decision == "go", f.decision == "punt"], [f.ep_go, f.ep_punt], f.ep_fg)
    f["ep_lost"] = np.clip(np.nanmax(np.where(np.isnan(Ep), -99, Ep), axis=1) - np.nan_to_num(chosen, nan=-99), 0, 10)
    f["ep_lost"] = np.where(np.isnan(chosen), np.nan, f.ep_lost)
    f[out_cols].to_parquet(WORK / f"decisions_{y}.parquet", index=False)
    print(y, "fourth downs", len(f), "went", round(float((f.decision == "go").mean()), 3), "recommended go", round(float((f.rec == "go").mean()), 3),
          "followed", round(float((f.rec == f.decision).mean()), 3), flush=True)


RE_TWO = r"two[- ]point|2[- ]?pt\b"
RE_TWO_CH = r"touchdown.*?#\d+ [^#]*?(?:pass|rush|run) attempt (?:failed|successful|good|no good)"
RE_KICK = r"kick\)|kick attempt|\bpat\b|extra point|kick is good|kick failed|kick blocked|kick no good|\bxp\b"


def tries(y):
    """The try after every touchdown in regulation, read from the touchdown's own text (the release files and ESPN
    write it there: "(Two-Point Pass Conversion Failed)", "(J. Smith Kick)", or in the charted format "TOUCHDOWN ...
    #8 C.Boley pass attempt failed"). Credited to the team that scored."""
    d = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["game_id", "play_id", "pts", "period", "off", "deff", "secs_game", "score_diff"])
    x = pd.read_parquet(WORK / f"xtra_{y}.parquet", columns=["play_id", "text"])
    t = d[(d.pts.abs() == 7) & (d.period <= 4) & d.off.notna()].merge(x, on="play_id", how="left")
    low = t.text.fillna("").str.lower()
    two = low.str.contains(RE_TWO, regex=True) | low.str.contains(RE_TWO_CH, regex=True) | low.str.contains(r"\([^()]*intercepted\s*\)", regex=True)
    kick = ~two & low.str.contains(RE_KICK, regex=True)
    good2 = two & ~low.str.contains(r"fail|no good|intercepted|unsuccessful", regex=True)
    t["team"] = np.where(t.pts > 0, t.off, t.deff).astype("int64")
    t["two"], t["kick"], t["two_good"] = two.to_numpy(), kick.to_numpy(), good2.to_numpy()
    t["known"] = t.two | t.kick
    # the scoring team's margin after the touchdown, before the try
    t["margin"] = np.where(t.pts > 0, t.score_diff + 6, -t.score_diff + 6)
    return t[["game_id", "play_id", "team", "secs_game", "margin", "two", "two_good", "kick", "known"]]


ALIAS = {"westrn": "western", "eastrn": "eastern", "southn": "southern", "northn": "northern", "fla ": "florida ", "ul lafayette": "louisiana",
         "texassan": "utsa", "tenn ": "tennessee "}


def _norm(s):
    s = str(s).lower() + " "
    for a, b in ALIAS.items():
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", s.replace("&", "and").replace("state", "st"))


def timeouts(y):
    """Every charged timeout in regulation, credited to the team the text names ("Timeout SOUTHERN MISS, clock 00:02")."""
    d = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["game_id", "play_id", "ptype", "period", "secs_half", "home", "away"])
    t = d[(d.ptype == "Timeout") & (d.period <= 4)].merge(pd.read_parquet(WORK / f"xtra_{y}.parquet", columns=["play_id", "text"]), on="play_id")
    meta = load_state()["team_meta"]
    names = {}
    for tid, m in meta.items():
        names[int(tid)] = {_norm(v) for v in (m.get("name"), m.get("short"), m.get("abbr"), m.get("nick")) if v}
        full = m.get("name") or ""
        nick = m.get("nick") or ""
        if nick and full.endswith(nick):
            names[int(tid)].add(_norm(full[: -len(nick)]))
    g = pd.read_parquet(WORK / "games.parquet", columns=["game_id", "home_team", "away_team"]).set_index("game_id")
    who = []
    for r in t.itertuples():
        m = re.match(r"\s*timeout\s+(.+?)(?:,\s*clock.*)?$", str(r.text), re.I)
        nm = _norm(m.group(1)) if m else ""
        hit = None
        sides = [v for v in (r.home, r.away) if v == v]
        cands = {v: set(names.get(int(v), set())) for v in sides}
        if r.game_id in g.index:
            for v, col in zip((r.home, r.away), ("home_team", "away_team")):
                if v == v:
                    cands[v].add(_norm(g.at[r.game_id, col]))
        if nm:
            exact = [v for v in sides if nm in cands[v]]
            pre = [v for v in sides if any(c.startswith(nm) or nm.startswith(c) for c in cands[v] if len(c) >= 3)]
            hit = exact[0] if len(exact) == 1 else (pre[0] if len(pre) == 1 and not exact else None)
        who.append(np.nan if hit in (None, -1) else hit)
    t["team"] = who
    t["late"] = t.secs_half <= 120
    return t[["game_id", "play_id", "period", "secs_half", "team", "late"]]


def check():
    f = RAW / "espn_cfb_pbp" / "play_by_play_2025.parquet"
    r = pd.read_parquet(f, columns=["id", "fourth_down_recommendation", "go_boost"]).rename(columns={"id": "play_id"})
    r["play_id"] = pd.to_numeric(r.play_id, errors="coerce")
    d = pd.read_parquet(WORK / "decisions_2025.parquet").merge(r.dropna(subset=["play_id"]), on="play_id", how="inner")
    d = d[d.fourth_down_recommendation.notna()]
    rec = d.fourth_down_recommendation.astype(str).str.lower().map(lambda s: "fg" if ("fg" in s or "field" in s) else "punt" if "punt" in s else "go" if s == "go" else s)
    agree = float((rec == d.rec).mean())
    corr = float(np.corrcoef(d.go_boost_x, pd.to_numeric(d.go_boost_y, errors="coerce").fillna(0))[0, 1]) if "go_boost_x" in d.columns else np.nan
    tab = pd.crosstab(d.rec, rec)
    lines = ["# Fourth-down decisions: WCE's recommendation against the release file's (2025)", "",
             f"{len(d):,} fourth downs in both. The two recommendations agree on **{agree:.1%}**; correlation of go boost {corr:.3f}.", "",
             "Rows: WCE. Columns: the release file.", "", "| WCE \\ release | " + " | ".join(map(str, tab.columns)) + " |",
             "|---|" + "---:|" * len(tab.columns)] + [f"| {i} | " + " | ".join(f"{int(v):,}" for v in r) + " |" for i, r in tab.iterrows()] + [""]
    (OUT / "fourth_check.md").write_text("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "fit":
        fit()
    elif a[0] == "score":
        w = WP()
        for y in [int(v) for v in a[1:]]:
            score(y, w)
    elif a[0] == "check":
        check()
    elif a[0] == "tries":
        for y in [int(v) for v in a[1:]]:
            t, o = tries(y), timeouts(y)
            print(y, "touchdowns", len(t), "try read", round(float(t.known.mean()), 4), "two-point tries", int(t.two.sum()),
                  "converted", round(float(t[t.two].two_good.mean()), 3), "| timeouts", len(o), "credited", round(float(o.team.notna().mean()), 4))
