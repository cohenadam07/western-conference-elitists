"""The frozen state a refresh of the current season needs instead of every season before it.

    python -m pipeline.cfb.state build      # on the Mac, from history; writes pipeline/cfb/state/

The cloud has no history on disk (raw files stay on the Mac). Everything in the current season's
numbers that was LEARNED from finished seasons is therefore fitted once here and committed:

  kick        make probability by distance (logistic, 2014-2024), for field goals over expected
  punt        expected EPA of a punt by yard line (cubic, 2014-2024)
  positions   the edge / interior and corner / safety classifiers for rosters that say only "DL" or
              "DB" (logistic on size and stat profile, fitted on players whose roster names the spot)
  hur_weight  points an offence loses on a hurried throw (2025, the first season the text has it)
  pbu_weight  the same for a pass break-up, for a season too thin to measure it
  rating      the current season's preseason prior, points scale, home edge and spread of results
  tau         how far a week's rating sits from the season-end rating, by games played (simulator)
  teams       FBS membership, conference and division by season; names, colours and logos
  models/     the expected-points and win-probability models (joblib; scikit-learn pinned in
              pipeline/cfb/requirements-cloud.txt)

The Mac's full build reads the same files, so a refresh and a full build cannot differ.
"""
import sys
import json
import shutil
import numpy as np
import pandas as pd
from .paths import RAW, WORK, REPO

DIR = REPO / "pipeline" / "cfb" / "state"
FILE = DIR / "state.json"
_cache = {}


def load_state():
    if "s" not in _cache:
        _cache["s"] = json.loads(FILE.read_text())
    return _cache["s"]


def model_path(name):
    """A model file: the Mac's work copy if it is there, else the committed one."""
    p = WORK / name
    return p if p.exists() else DIR / "models" / name


def build():
    from sklearn.linear_model import LogisticRegression
    from . import numbers, config as C
    from .value import BASE
    DIR.mkdir(parents=True, exist_ok=True)
    (DIR / "models").mkdir(exist_ok=True)
    st = {"built_from": "seasons 2014-2025", "version": C.VERSION}
    # ---- specialists (player_study.tables' fits, frozen)
    kick = pd.read_parquet(WORK / "pg_kick.parquet")
    kick = kick[kick.dist.between(17, 70) & kick.season.between(2014, 2024)]
    lr = LogisticRegression(C=1e6, max_iter=2000).fit(np.column_stack([kick.dist, kick.dist ** 2]), kick.made.astype(int))
    st["kick"] = {"intercept": float(lr.intercept_[0]), "dist": float(lr.coef_[0][0]), "dist2": float(lr.coef_[0][1]), "n": int(len(kick))}
    punt = pd.read_parquet(WORK / "pg_punt.parquet")
    punt = punt[punt.epa.notna() & punt.ytg.between(1, 99) & punt.season.between(2014, 2024)]
    st["punt"] = [float(x) for x in np.polyfit(punt.ytg, punt.epa, 3)]
    # ---- event weights that one season cannot always measure
    st["hur_weight"], st["pbu_weight"] = 0.0, 0.0
    hw, pw = [], []
    for y in range(2014, 2026):
        cols = ["cat", "f_sack", "f_int", "f_pbu", "pbu_by", "pdef1", "f_kneel", "period", "f_pen_noplay", "hurry_txt"]
        d = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=cols)
        e = pd.read_parquet(WORK / f"epa_{y}.parquet", columns=["epa", "garbage_cfbd"])
        d["epa"] = e.epa.to_numpy()
        d = d[d.cat.isin(["rush", "pass"]) & d.epa.notna() & ~d.f_kneel & (d.period <= 4) & ~e.garbage_cfbd.to_numpy() & ~d.f_pen_noplay]
        pbu = (d.cat == "pass") & (d.f_pbu | d.pbu_by.notna() | d.pdef1.notna()) & ~d.f_int
        if pbu.sum() > 200:
            pw.append(float(d[d.cat == "pass"].epa.mean() - d[pbu].epa.mean()))
        if y == 2025:
            h = d[(d.cat == "pass") & ~d.f_sack]
            hw.append(float(h.epa.mean() - h[h.hurry_txt].epa.mean()))
    st["hur_weight"], st["pbu_weight"] = float(np.mean(hw)), float(np.mean(pw))
    # ---- position classifiers, on numbers.py's own features
    st["positions"] = {}
    rows = []
    for y in range(2014, 2026):
        F = numbers.frames(y, "_all", st, regulars=numbers.regular_defenders(y))
        ppl = numbers.people(y)[["pid", "pos", "weight", "height"]].drop_duplicates("pid")
        d = F["dfn"].groupby("pid").agg(dplays=("dplays", "sum"), sack=("e_sack", "sum"), stop=("e_stop", "sum"), pbu=("e_pbu", "sum"),
                                        tkl=("e_tkl", "sum"), **{"int": ("int", "sum")}).reset_index().merge(ppl, on="pid", how="left")
        d["season"] = y
        rows.append(d)
    x = pd.concat(rows, ignore_index=True)
    x["slot"] = x.pos.map(BASE)
    dp = x.dplays.clip(lower=1)
    x["f_sack_share"] = x.sack / (x.sack + x.stop + 0.25 * x.tkl + 1)
    x["f_pd_share"] = (x.pbu + x["int"]) / (x.pbu + x["int"] + x.stop + 0.25 * x.tkl + 1)
    x["f_stop_rate"] = x.stop / dp * 100
    x["f_tk_rate"] = x.tkl / dp * 100
    from sklearn.model_selection import cross_val_score
    for generic, a, b, feats in (("DL?", "EDGE", "IDL", ["weight", "height", "f_sack_share", "f_stop_rate"]),
                                 ("DB?", "CB", "S", ["weight", "height", "f_pd_share", "f_stop_rate", "f_tk_rate"])):
        lab = x[x.slot.isin([a, b]) & (x.dplays >= 200)].copy()
        fill = {"weight": float(lab.weight.median()), "height": float(lab.height.median())}
        for f in ("weight", "height"):
            lab[f] = lab[f].fillna(fill[f])
        mu, sd = lab[feats].mean(), lab[feats].std()
        Z = (lab[feats] - mu) / sd
        yv = (lab.slot == a).astype(int)
        m = LogisticRegression(max_iter=1000)
        acc = float(cross_val_score(m, Z, yv, cv=5).mean())
        m.fit(Z, yv)
        st["positions"][generic] = {"first": a, "second": b, "feats": feats, "mu": [float(v) for v in mu], "sd": [float(v) for v in sd],
                                    "coef": [float(v) for v in m.coef_[0]], "intercept": float(m.intercept_[0]), "fill": fill,
                                    "labelled_player_seasons": int(len(lab)), "cross_validated_accuracy": acc}
    # ---- rating prior and simulator spread
    from .resume import rating_uncertainty
    st["rating"] = json.loads((WORK / "rating_state.json").read_text())
    st["tau"] = {str(k): float(v) for k, v in rating_uncertainty().items()}
    # ---- teams
    fbs = pd.read_parquet(WORK / "fbs_teams.parquet")
    st["teams"] = {}
    for y, g in fbs[fbs.season >= 2014].groupby("season"):
        st["teams"][str(int(y))] = [dict(team_id=int(r.team_id), school=r.school, abbreviation=r.abbreviation, conference=r.conference,
                                         division=None if pd.isna(r.division) else r.division) for r in g.itertuples()]
    import glob
    meta = {}
    for f in sorted(glob.glob(str(RAW / "espn_cfb_teams" / "*.parquet"))):
        t = pd.read_parquet(f)
        for r in t.itertuples():
            meta[str(int(r.team_id))] = dict(name=r.display_name, short=r.short_display_name, nick=r.name, abbr=r.abbreviation,
                                             color=None if pd.isna(r.color) else str(r.color), alt=None if pd.isna(r.alternate_color) else str(r.alternate_color),
                                             logo=None if pd.isna(r.team_logo) else str(r.team_logo))
    st["team_meta"] = meta
    for name in ("ep_model.joblib", "wp_model.joblib"):
        shutil.copyfile(WORK / name, DIR / "models" / name)
    FILE.write_text(json.dumps(st, indent=1, sort_keys=True))
    _cache.pop("s", None)
    print("state written:", FILE, "| kick n", st["kick"]["n"], "| hurry weight", round(st["hur_weight"], 3), "| pbu weight", round(st["pbu_weight"], 3),
          "| classifiers", {k: round(v["cross_validated_accuracy"], 3) for k, v in st["positions"].items()},
          "| teams with colours", len(meta))
    for p in sorted((DIR / "models").glob("*")):
        print("  ", p.name, round(p.stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    {"build": build}[sys.argv[1]]()
