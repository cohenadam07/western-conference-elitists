"""Steps 6 (the choice), 7 and 8. Garbage-time filter, team stat stability, opponent adjustment.

    python -m pipeline.cfb.team_study garbage     # which garbage-time filter makes team stats better
    python -m pipeline.cfb.team_study stability   # split-half, games needed, year to year, predictive value
    python -m pipeline.cfb.team_study adjust      # ridge opponent adjustment vs raw, by week

The four tests for every stat (RESEARCH section 4):
  1. split-half reliability: each team-season's games are dealt at random into
     two halves 200 times; the halves are correlated across team-seasons (each
     season centred on its own mean, so an era shift cannot pose as skill) and
     stepped up to a full season with Spearman-Brown, r_full = 2r / (1 + r);
  2. games needed for reliability 0.5 and 0.7, from the one-game reliability
     the split implies;
  3. year-to-year correlation, same team, consecutive seasons;
  4. predictive value: the stat through week N against the team's average
     scoring margin in every later game, beside the same number for raw scoring
     margin through week N.
"""
import sys
import json
import numpy as np
import pandas as pd
from .paths import WORK, OUT, CHARTS
from . import teamgame

STUDY = list(range(2014, 2026))
N_SPLITS = 200
RNG = np.random.default_rng(20261110)

# name: (family, numerator, denominator, higher_is_better, label)
# a leading "d_" reads the opponent's row = what this team's defence allowed
STATS = {
    "off_epa":        ("Efficiency",   "epa", "epa_n", True,  "Offence EPA per play"),
    "def_epa":        ("Efficiency",   "d_epa", "d_epa_n", False, "Defence EPA per play allowed"),
    "off_epa_pass":   ("Efficiency",   "epa_pass", "db", True, "Offence EPA per dropback"),
    "def_epa_pass":   ("Efficiency",   "d_epa_pass", "d_db", False, "Defence EPA per dropback allowed"),
    "off_epa_rush":   ("Efficiency",   "epa_rush", "rush", True, "Offence EPA per rush"),
    "def_epa_rush":   ("Efficiency",   "d_epa_rush", "d_rush", False, "Defence EPA per rush allowed"),
    "off_success":    ("Efficiency",   "succ", "plays", True, "Offence success rate"),
    "def_success":    ("Efficiency",   "d_succ", "d_plays", False, "Defence success rate allowed"),
    "off_succ_pass":  ("Efficiency",   "succ_pass", "db", True, "Offence passing success rate"),
    "def_succ_pass":  ("Efficiency",   "d_succ_pass", "d_db", False, "Defence passing success rate allowed"),
    "off_succ_rush":  ("Efficiency",   "succ_rush", "rush", True, "Offence rushing success rate"),
    "def_succ_rush":  ("Efficiency",   "d_succ_rush", "d_rush", False, "Defence rushing success rate allowed"),
    "off_explosiveness": ("Explosiveness", "epa_succ", "succ", True, "Offence explosiveness (EPA per successful play)"),
    "def_explosiveness": ("Explosiveness", "d_epa_succ", "d_succ", False, "Defence explosiveness allowed"),
    "off_expl_rate":  ("Explosiveness", "expl", "plays", True, "Offence explosive play rate"),
    "def_expl_rate":  ("Explosiveness", "d_expl", "d_plays", False, "Defence explosive play rate allowed"),
    "def_havoc":      ("Line and havoc", "d_havoc", "d_plays", True, "Defence havoc rate"),
    "off_havoc":      ("Line and havoc", "havoc", "plays", False, "Offence havoc rate allowed"),
    "off_stuff":      ("Line and havoc", "stuff", "rush", False, "Offence stuff rate (runs for no gain or a loss)"),
    "def_stuff":      ("Line and havoc", "d_stuff", "d_rush", True, "Defence stuff rate"),
    "off_line_yards": ("Line and havoc", "ly", "rush", True, "Offence line yards per rush"),
    "def_line_yards": ("Line and havoc", "d_ly", "d_rush", False, "Defence line yards per rush allowed"),
    "off_sack_rate":  ("Line and havoc", "sacks", "db", False, "Offence sack rate allowed"),
    "def_sack_rate":  ("Line and havoc", "d_sacks", "d_db", True, "Defence sack rate"),
    "off_pts_per_opp": ("Finishing drives", "opp_pts", "opps", True, "Offence points per trip inside the 40"),
    "def_pts_per_opp": ("Finishing drives", "d_opp_pts", "d_opps", False, "Defence points per trip inside the 40 allowed"),
    "off_rz_td":      ("Finishing drives", "rz_td", "rz", True, "Offence red-zone touchdown rate"),
    "def_rz_td":      ("Finishing drives", "d_rz_td", "d_rz", False, "Defence red-zone touchdown rate allowed"),
    "off_third":      ("Finishing drives", "third_conv", "third", True, "Offence third-down conversion rate"),
    "def_third":      ("Finishing drives", "d_third_conv", "d_third", False, "Defence third-down conversion rate allowed"),
    "off_start_fp":   ("Field position", "start", "drives", False, "Offence average starting field position (yards to go)"),
    "def_start_fp":   ("Field position", "d_start", "d_drives", True, "Defence average starting field position faced"),
    "st_epa":         ("Field position", "st_epa", "one", True, "Net special-teams EPA per game"),
    "off_turnovers":  ("Turnovers", "to_box", "plays", False, "Giveaways per play"),
    "def_turnovers":  ("Turnovers", "d_to_box", "d_plays", True, "Takeaways per play"),
    "to_margin":      ("Turnovers", "to_margin", "one", True, "Turnover margin per game"),
    "off_int_rate":   ("Turnovers", "int_box", "db", False, "Interceptions thrown per dropback"),
    "def_int_rate":   ("Turnovers", "d_int_box", "d_db", True, "Interceptions made per opponent dropback"),
    "off_fum_lost":   ("Turnovers", "fl_box", "plays", False, "Fumbles lost per play"),
    "fum_recovery":   ("Turnovers", "fum_got", "fum_tot", True, "Fumble recovery rate (all fumbles in the game)"),
    "def_int_per_pd": ("Turnovers", "d_ints", "d_pdef", True, "Interceptions per pass defensed (defence)"),
    "penalties":      ("Discipline and pace", "pen_n", "plays", False, "Penalties per offensive play"),
    "penalty_yards":  ("Discipline and pace", "pen_yds", "one", False, "Penalty yards per game"),
    "pace":           ("Discipline and pace", "plays", "one", True, "Offensive plays per game"),
    "net_epa":        ("Net", "net_epa_num", "one", True, "Net EPA per play (offence minus defence)"),
    "net_success":    ("Net", "net_succ_num", "one", True, "Net success rate (offence minus defence)"),
    "margin":         ("Net", "margin", "one", True, "Raw scoring margin per game"),
}
# pass break-ups are only identifiable in the play text in these seasons (completeness.py)
PBU_SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2025]
SEASON_LIMIT = {"def_havoc": PBU_SEASONS, "off_havoc": PBU_SEASONS, "def_int_per_pd": PBU_SEASONS}


def frame(filt, seasons=STUDY):
    t = teamgame.load(filt, seasons)
    t["one"] = 1.0
    t["margin"] = t.pf - t.pa
    t["to_margin"] = t.d_to_box - t.to_box
    t["fum_got"] = (t.fum_all - t.fl_box) + t.d_fl_box
    t["fum_tot"] = t.fum_all + t.d_fum_all
    t["d_pdef"] = t.d_ints + t.d_pbu
    t["net_epa_num"] = t.epa / t.epa_n.clip(lower=1) - t.d_epa / t.d_epa_n.clip(lower=1)
    t["net_succ_num"] = t.succ / t.plays.clip(lower=1) - t.d_succ / t.d_plays.clip(lower=1)
    t["ts"] = t.season.astype(str) + "_" + t.team.astype(str)
    return t


def split_half(t, num, den, n_splits=N_SPLITS, min_games=8):
    """Mean and sd of the half-vs-half correlation over random splits; mean games per team-season."""
    cnt = t.groupby("ts").size()
    t = t[t.ts.isin(cnt[cnt >= min_games].index)]
    codes, uniq = pd.factorize(t.ts)
    G = len(uniq)
    season = t.groupby(codes).season.first().to_numpy()
    nv, dv = t[num].to_numpy(dtype=float), t[den].to_numpy(dtype=float)
    ok = ~(np.isnan(nv) | np.isnan(dv))
    nv, dv = np.where(ok, nv, 0), np.where(ok, dv, 0)
    rs = []
    for _ in range(n_splits):
        u = RNG.random(len(t))
        order = np.lexsort((u, codes))
        rank = np.empty(len(t), dtype=int)
        rank[order] = np.arange(len(t))
        first = np.full(G, len(t))
        np.minimum.at(first, codes, rank)
        half = (rank - first[codes]) % 2
        vals = []
        for h in (0, 1):
            m = half == h
            a = np.bincount(codes[m], weights=nv[m], minlength=G)
            b = np.bincount(codes[m], weights=dv[m], minlength=G)
            vals.append(np.where(b > 0, a / np.where(b > 0, b, 1), np.nan))
        x = pd.DataFrame({"a": vals[0], "b": vals[1], "s": season}).dropna()
        x["a"] -= x.groupby("s").a.transform("mean")
        x["b"] -= x.groupby("s").b.transform("mean")
        rs.append(np.corrcoef(x.a, x.b)[0, 1])
    rs = np.array(rs)
    return float(np.nanmean(rs)), float(np.nanstd(rs)), float(cnt[cnt >= min_games].mean()), int(G)


def sb(r, k=2.0):
    return k * r / (1 + (k - 1) * r)


def games_needed(r_half, games_per_season, target):
    m = games_per_season / 2.0
    if not np.isfinite(r_half) or r_half <= 0.005:
        return np.inf
    r1 = r_half / (m - (m - 1) * r_half)
    return target * (1 - r1) / (r1 * (1 - target))


def season_values(t, num, den, mask=None):
    k = t if mask is None else t[mask]
    a = k.groupby(["season", "team"])[[num, den]].sum()
    v = (a[num] / a[den].where(a[den] > 0)).rename("v").reset_index()
    return v


def year_to_year(t, num, den):
    v = season_values(t, num, den)
    n = t.groupby(["season", "team"]).size().rename("g").reset_index()
    v = v.merge(n, on=["season", "team"])
    v = v[v.g >= 8]
    v["v"] -= v.groupby("season").v.transform("mean")
    nx = v.assign(season=v.season - 1)[["season", "team", "v"]].rename(columns={"v": "nxt"})
    m = v.merge(nx, on=["season", "team"]).dropna()
    return (float(np.corrcoef(m.v, m.nxt)[0, 1]) if len(m) > 30 else np.nan), len(m)


def predictive(t, num, den, weeks=range(3, 11)):
    """corr(stat through week N, mean margin in later games), per N, across team-seasons."""
    reg = t.season_type == 2
    out = {}
    for N in weeks:
        early = reg & (t.week <= N)
        v = season_values(t, num, den, early)
        ge = t[early].groupby(["season", "team"]).size().rename("n_early").reset_index()
        later = t[~early].groupby(["season", "team"]).agg(rest=("margin", "mean"), n_late=("margin", "size")).reset_index()
        m = v.merge(ge, on=["season", "team"]).merge(later, on=["season", "team"]).dropna()
        m = m[(m.n_early >= max(2, N - 2)) & (m.n_late >= 3)]
        m["v"] -= m.groupby("season").v.transform("mean")
        m["rest"] -= m.groupby("season").rest.transform("mean")
        out[N] = float(np.corrcoef(m.v, m.rest)[0, 1]) if len(m) > 50 else np.nan
    return out


def verdict(name, fam, r_full, g50, yoy):
    if name in ("margin", "net_epa", "net_success", "pace"):
        return "CONTEXT" if name == "pace" else "rating input"
    if fam == "Turnovers" and (r_full < 0.25):
        return "luck"
    if g50 <= 6:
        return "full bar"
    if g50 <= 12:
        return "hatched"
    return "luck" if fam == "Turnovers" else "CONTEXT"


def garbage():
    rows = []
    for filt in ("all", "cfbd", "wp"):
        t = frame(filt)
        for name in ("off_epa", "def_epa", "off_success", "def_success", "net_epa", "net_success"):
            fam, num, den, hib, label = STATS[name]
            r, sd, gps, G = split_half(t, num, den, 100)
            pv = predictive(t, num, den)
            yy, _ = year_to_year(t, num, den)
            rows.append(dict(filter=filt, stat=name, split_half=r, full_season=sb(r), yoy=yy,
                             **{f"pred_w{k}": abs(v) for k, v in pv.items()}))
        print(filt, "done", flush=True)
    r = pd.DataFrame(rows)
    r["pred_mean"] = r[[c for c in r.columns if c.startswith("pred_w")]].mean(axis=1)
    r.to_csv(OUT / "garbage_time_test.csv", index=False)
    pd.set_option("display.width", 250, "display.max_columns", 30)
    print(r.round(3).to_string(index=False))
    print(r.groupby("filter")[["full_season", "yoy", "pred_mean"]].mean().round(4))


def stability():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    filt = json.loads((OUT / "garbage_choice.json").read_text())["filter"]
    t_all = frame(filt)
    rows = []
    for name, (fam, num, den, hib, label) in STATS.items():
        t = t_all[t_all.season.isin(SEASON_LIMIT[name])] if name in SEASON_LIMIT else t_all
        r, sd, gps, G = split_half(t, num, den)
        yy, npairs = year_to_year(t, num, den)
        pv = predictive(t, num, den)
        g50, g70 = games_needed(r, gps, 0.5), games_needed(r, gps, 0.7)
        row = dict(stat=name, label=label, family=fam, team_seasons=G, split_half=r, split_sd=sd, full_season=sb(r),
                   games_50=g50, games_70=g70, yoy=yy, yoy_pairs=npairs, higher_is_better=hib,
                   seasons="2014-2020, 2025" if name in SEASON_LIMIT else "2014-2025")
        for k, v in pv.items():
            row[f"pred_w{k}"] = v
        row["verdict"] = verdict(name, fam, sb(r), g50, yy)
        rows.append(row)
        print(f"{name:20s} r_half {r:.3f} (sd {sd:.3f}) full {sb(r):.3f} g50 {g50:5.1f} g70 {g70:5.1f} yoy {yy:.3f} "
              f"pred w3 {pv[3]:+.2f} w6 {pv[6]:+.2f} w10 {pv[10]:+.2f}  -> {row['verdict']}", flush=True)
    r = pd.DataFrame(rows)
    r.to_csv(OUT / "team_stability.csv", index=False)
    # one chart per family: predictive value by week, with raw margin as the reference line
    weeks = list(range(3, 11))
    ref = r[r.stat == "margin"].iloc[0]
    for fam, grp in r[r.family != "Net"].groupby("family"):
        fig, ax = plt.subplots(1, 2, figsize=(14, 5))
        for _, x in grp.iterrows():
            ax[0].plot(weeks, [abs(x[f"pred_w{w}"]) for w in weeks], marker="o", label=x.stat)
        ax[0].plot(weeks, [abs(ref[f"pred_w{w}"]) for w in weeks], "k--", lw=2, label="raw scoring margin")
        ax[0].set(title=f"{fam}: stat through week N vs margin in later games", xlabel="week N", ylabel="|correlation|")
        ax[0].legend(fontsize=7)
        g = grp.sort_values("full_season")
        ax[1].barh(g.stat, g.full_season, color="#1f4e9c")
        ax[1].barh(g.stat, g.yoy, color="#e0a100", height=0.35)
        ax[1].axvline(0.5, color="#999", ls=":")
        ax[1].set(title="Full-season reliability (blue) and year-to-year r (gold)", xlim=(-0.1, 1))
        fig.tight_layout()
        fig.savefig(CHARTS / f"team_{fam.lower().replace(' ', '_')}.png", dpi=100)
        plt.close(fig)
    cols = ["label", "seasons", "full_season", "games_50", "games_70", "yoy", "pred_w3", "pred_w6", "pred_w10", "verdict"]
    lines = ["| stat | seasons | full-season reliability | games to 0.5 | games to 0.7 | year-to-year r | predicts later margin: wk 3 | wk 6 | wk 10 | verdict |",
             "|---|---|---:|---:|---:|---:|---:|---:|---:|---|"]
    for fam in ["Efficiency", "Explosiveness", "Line and havoc", "Finishing drives", "Field position", "Turnovers",
                "Discipline and pace", "Net"]:
        lines.append(f"| **{fam}** | | | | | | | | | |")
        for _, x in r[r.family == fam].iterrows():
            f = lambda v: "50+" if not np.isfinite(v) or v > 50 else f"{v:.1f}"
            lines.append(f"| {x.label} | {x.seasons} | {x.full_season:.2f} | {f(x.games_50)} | {f(x.games_70)} | {x.yoy:.2f} | "
                         f"{x.pred_w3:+.2f} | {x.pred_w6:+.2f} | {x.pred_w10:+.2f} | {x.verdict} |")
    (OUT / "team_stability.md").write_text("\n".join(lines) + "\n")


# ---- opponent adjustment ---------------------------------------------------------
def ridge_adjust(g, ycol, wcol, lam):
    """y_ij = mu + off_i + def_j + h * site; weighted ridge on the team effects. Returns (off, def, h, mu)."""
    teams = np.unique(np.concatenate([g.team.to_numpy(), g.opp.to_numpy()]))
    ix = {t: i for i, t in enumerate(teams)}
    T = len(teams)
    n = len(g)
    X = np.zeros((n, 2 * T + 1))
    X[np.arange(n), [ix[t] for t in g.team]] = 1
    X[np.arange(n), [T + ix[t] for t in g.opp]] = 1
    X[:, 2 * T] = g.site.to_numpy()
    w = g[wcol].to_numpy(dtype=float)
    y = g[ycol].to_numpy(dtype=float)
    mu = np.average(y, weights=w)
    sw = np.sqrt(w)
    A = X * sw[:, None]
    P = np.eye(2 * T + 1) * lam
    P[2 * T, 2 * T] = 1e-6
    beta = np.linalg.solve(A.T @ A + P, A.T @ ((y - mu) * sw))
    return dict(zip(teams, beta[:T])), dict(zip(teams, beta[T:2 * T])), beta[2 * T], mu


def adjust():
    filt = json.loads((OUT / "garbage_choice.json").read_text())["filter"]
    t = frame(filt)
    t["y_epa"] = t.epa / t.epa_n.clip(lower=1)
    t["y_succ"] = t.succ / t.plays.clip(lower=1)
    rows = []
    for ycol, wcol, label in (("y_epa", "epa_n", "EPA per play"), ("y_succ", "plays", "Success rate")):
        for lam_mult in (0.5, 1, 2, 4):
            for N in range(3, 11):
                preds = []
                for y in STUDY:
                    s = t[t.season == y]
                    tr = s[(s.season_type == 2) & (s.week <= N)]
                    te = s[~((s.season_type == 2) & (s.week <= N))]
                    te = te[te.team < te.opp]          # one row per game
                    lam = lam_mult * tr[wcol].mean()   # "lam_mult games' worth" of shrinkage
                    o, dfn, h, mu = ridge_adjust(tr, ycol, wcol, lam)
                    a = tr.groupby("team").apply(lambda x: np.average(x[ycol], weights=x[wcol]), include_groups=False)
                    da = tr.groupby("opp").apply(lambda x: np.average(x[ycol], weights=x[wcol]), include_groups=False)
                    for _, gme in te.iterrows():
                        i, j = gme.team, gme.opp
                        if i not in o or j not in o or i not in a.index or j not in a.index or j not in da.index or i not in da.index:
                            continue
                        adj = (o[i] + dfn[j]) - (o[j] + dfn[i])
                        raw = (a[i] + da[j]) - (a[j] + da[i])
                        preds.append((y, adj, raw, gme.margin, gme.site))
                p = pd.DataFrame(preds, columns=["season", "adj", "raw", "margin", "site"])
                rows.append(dict(stat=label, lam_mult=lam_mult, week=N, games=len(p), r_adjusted=float(p.adj.corr(p.margin)),
                                 r_raw=float(p.raw.corr(p.margin))))
            print(label, lam_mult, "done", flush=True)
    r = pd.DataFrame(rows)
    r["gain"] = r.r_adjusted - r.r_raw
    r.to_csv(OUT / "opponent_adjustment.csv", index=False)
    best = r.groupby(["stat", "lam_mult"]).r_adjusted.mean().reset_index().sort_values("r_adjusted").groupby("stat").tail(1)
    print(best)
    lines = []
    for _, b in best.iterrows():
        x = r[(r.stat == b.stat) & (r.lam_mult == b.lam_mult)]
        lines += [f"**{b.stat}** (ridge penalty = {b.lam_mult:g} games' worth of plays; best of 0.5 / 1 / 2 / 4)", "",
                  "| through week | later games | r, raw | r, opponent-adjusted | gain |", "|---|---:|---:|---:|---:|"]
        lines += [f"| {int(w.week)} | {int(w.games):,} | {w.r_raw:.3f} | {w.r_adjusted:.3f} | {w.gain:+.3f} |" for _, w in x.iterrows()]
        lines.append("")
    (OUT / "opponent_adjustment.md").write_text("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    {"garbage": garbage, "stability": stability, "adjust": adjust}[sys.argv[1]]()
