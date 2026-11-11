"""1.1.0 step 5: stability for every new stat (BUILD-1.1 section 3), the same gate as 1.0.0.

    python -m pipeline.cfb.xstudy        # research/cfb/out/expansion_stability.{md,csv}; pipeline/cfb/state/verdicts_x.json

Tier A: 1.0.0's method (player_study.py) on 2014-2025: split-half reliability over 200 random splits of each
player-season's games, stepped up to a full season (Spearman-Brown); the settle point by the grid search that best
predicts the rest of a season from its last third; year-to-year for players who stayed and who transferred.

Tier B: split-half within 2025 weeks 9-16 and within 2026, charted games only, pooled; the settle point from that pool.
A half-season's split-half is stepped up to a typical starter's FULL season (his position's median charted sample per
game x 12 games), because that is the sample a card shows. Year-to-year is not measurable yet: one charted season and
a half. A Tier B stat under 0.5 at a typical starter's sample is CONTEXT, not a bar.

Verdicts, as 1.0.0: full bar 0.5+, hatched 0.3-0.5, CONTEXT 0.15-0.3, dropped under 0.15 (shown as CONTEXT, labelled
"mostly noise"). Stats that describe how a player plays rather than how well (direction mix, shotgun rate, depth of
target, shares of his team's work) are CONTEXT whatever their reliability: "how, not how good".
Totals (season EPA, WPA, touchdowns over expected) are measured per game.

Team stats: the same split-half on team-games, 2014-2025 (Tier B: 2025 week 9 on and 2026).
"""
import json
import numpy as np
import pandas as pd
from .paths import OUT, WORK
from . import config as C
from . import config_x as CX
from . import numbers as N
from .state import load_state
from .player_study import split_half, settle_grid, season_rates, yoy

TIER_A = list(range(2014, 2026))
TIER_B = [2025, 2026]
BASE_Q = {"QB": ("tot_plays", 150), "RB": ("rush", 80), "WR": ("tgt_eff", 30), "TE": ("tgt_eff", 15), "EDGE": ("dplays", 350),
          "IDL": ("dplays", 350), "LB": ("dplays", 350), "CB": ("dplays", 350), "S": ("dplays", 350), "K": ("fga", 10), "P": ("punts", 25),
          "RET": ("returns", 12)}
STYLE = ("_dir_", "shotgun", "nohuddle", "_adot", "deep_rate", "behind", "deep_share", "_share", "air_share", "wopr", "tgt_g", "proe",
         "_asst", "_solo", "hur_g", "press_g", "cov_air", "tk_depth", "ret_fc")
STYLE_OK = ("press_share", "tk_depth")          # shares that grade a defender's own work, not his usage


def is_style(k):
    if any(s in k for s in STYLE_OK):
        return False
    return any(s in k for s in STYLE)


def collect(seasons, charted_only):
    """Per season: the garbage-out frames, every player's slot, and charted-game flags."""
    state = load_state()
    out = {}
    for y in seasons:
        reg = N.regular_defenders(y)
        Fa = N.frames(y, "_all", state, regulars=reg)
        F = N.frames(y, "", state, regulars=reg)
        pos = N.positions(y, Fa, N.people(y), state)
        slot = dict(zip(pos.pid, pos.slot))
        for t in F.values():
            if "season" not in t.columns and len(t):
                t["season"] = y
        out[y] = (F, slot)
        print("frames", y, flush=True)
    return out


def rows_for(st, data, seasons, charted_only):
    parts = []
    for y in seasons:
        if y < st.start or y in st.off or y not in data:
            continue
        F, slot = data[y]
        d = F[st.table]
        if not len(d) or st.num not in d.columns or st.den not in d.columns:
            continue
        if "RET" not in st.pos:
            d = d[d.pid.map(slot).isin(st.pos)]
        cols = ["season", "pid", "team", "opp", "date", "game_id", st.num, st.den]
        base = BASE_Q.get(st.pos[0])
        x = d[[c for c in cols if c in d.columns]].copy()
        if base and base[0] in d.columns:
            x["_base"] = d[base[0]].to_numpy()
        else:
            x["_base"] = 0.0
        if charted_only and "dplays_c" in d.columns:
            x = x[d.dplays_c.to_numpy() > 0]
        x["season"] = y
        parts.append(x)
    if not parts:
        return None
    x = pd.concat(parts, ignore_index=True)
    if st.den == "one":                                   # a season total: measured per game
        x["_den"] = 1.0
    else:
        x["_den"] = x[st.den].astype(float)
    x["_num"] = x[st.num].astype(float)
    return x


def measure(st, data, tier):
    seasons = TIER_A if tier != "B" else TIER_B
    x = rows_for(st, data, seasons, tier == "B")
    if x is None or not len(x):
        return None
    base = BASE_Q.get(st.pos[0], (None, 0))[1]
    if tier == "B":
        # qualified on his charted sample: counting his whole season let in backups with a handful of charted plays,
        # whose tiny halves pulled the split-half below zero (2025 shotgun EPA: -0.25 that way, +0.15 this way)
        base = base * 0.4                                 # half a season charted at most
        x = x[x._den > 0]
    bt = x.groupby(["season", "pid"])._base.transform("sum")
    q = x[(bt >= base) & (x._den > 0)].copy()
    tot = q.groupby(["season", "pid"])._den.transform("sum")
    q = q[tot >= 1]
    q["ps"] = q.season.astype(str) + "_" + q.pid.astype(str)
    nps = q.ps.nunique()
    if nps < 40:
        return dict(players=nps, r=np.nan, full=np.nan, k=np.nan, typical=np.nan)
    per = q.groupby("ps")._den.sum()
    typical = float(per.median())
    r, sd, nbar = split_half(q, "_num", "_den")
    if tier == "B":
        games = q.groupby("ps").game_id.nunique().median()
        typ_full = typical / max(games, 1) * C.GAMES_FULL
        m = typ_full / max(nbar, 1e-9)
        full = (m * r) / (1 + (m - 1) * r) if np.isfinite(r) else np.nan
        typical = typ_full
    else:
        full = 2 * r / (1 + r) if np.isfinite(r) else np.nan
    k, pairs, _, _ = settle_grid(q, "_num", "_den")
    out = dict(players=nps, r=r, full=full, k=k, typical=typical)
    if tier != "B":
        a = season_rates(x[x._den > 0].assign(_n=x._num), "_n", "_den", 1)
        a = a[a.pid.isin(set(q.pid))]
        yy = yoy(a)
        out.update(yoy_stay=yy["stay"][0], n_stay=yy["stay"][1], yoy_move=yy["move"][0], n_move=yy["move"][1])
    return out


def verdict(full, style, tier):
    if not np.isfinite(full):
        return "dropped (too few players)", "context"
    if style:
        return "CONTEXT (style)", "context"
    if tier == "B" and full < 0.5:
        return ("CONTEXT" if full >= 0.15 else "dropped"), "context"
    if full >= 0.5:
        return "full bar", "full"
    if full >= 0.3:
        return "hatched", "hatched"
    if full >= 0.15:
        return "CONTEXT", "context"
    return "dropped", "context"


def team_measure(key, num, den, side, tier):
    from . import teamgame
    seasons = TIER_A if tier != "B" else TIER_B
    t = teamgame.load("cfbd", seasons)
    pre = "" if side == "o" else "d_"
    t["g"], t["d_g"] = 1.0, 1.0
    for p in ("", "d_"):
        if p + "fd4_go" in t.columns:
            t[p + "fd4_goe_n"] = t[p + "fd4_go"] - t[p + "fd4_xgo"]
    if pre + num not in t.columns or pre + den not in t.columns:
        return None
    if tier == "B":
        t = t[t[pre + "c_ok"] > 0] if pre + "c_ok" in t.columns else t.iloc[:0]
    q = pd.DataFrame({"season": t.season, "pid": t.team, "date": t.date, "team": t.team, "opp": t.opp, "game_id": t.game_id,
                      "_num": t[pre + num].astype(float), "_den": t[pre + den].astype(float)})
    q = q[q._den > 0]
    q["ps"] = q.season.astype(str) + "_" + q.pid.astype(str)
    if q.ps.nunique() < 40:
        return None
    r, sd, nbar = split_half(q, "_num", "_den")
    if tier == "B":
        g = q.groupby("ps").game_id.nunique().median()
        m = C.GAMES_FULL / max(g / 2, 1)
        full = (m * r) / (1 + (m - 1) * r)
    else:
        full = 2 * r / (1 + r)
    return dict(players=q.ps.nunique(), r=r, full=full, typical=float(q.groupby("ps")._den.sum().median()))


def main(only=None):
    new = {k for k, *_ in CX.NEW} | {"qb_cpoe"}
    stats = [s for s in C.STATS if s.key in new and (only is None or s.tier == only)]
    data = collect(sorted(set(TIER_A) | set(TIER_B)) if only != "B" else TIER_B, False)
    rows, verdicts = [], {}
    if only:                                              # re-measure one tier; keep the other's rows
        old = pd.read_csv(OUT / "expansion_stability.csv")
        keep = old[old.tier != only]
        rows = keep.to_dict("records")
        verdicts = {k: v for k, v in json.loads(CX.VFILE.read_text()).items() if k.startswith("team:") or k in set(keep.stat)}
    for st in stats:
        tier = st.tier
        m = measure(st, data, tier)
        if m is None:
            print("no data", st.key)
            continue
        style = is_style(st.key)
        v, show = verdict(m["full"], style, tier)
        k = m["k"] if np.isfinite(m.get("k", np.nan)) else None
        rows.append(dict(stat=st.key, label=st.label, slots="/".join(st.pos), tier=tier, group=st.cgroup, players=m["players"],
                         typical=m["typical"], unit=st.unit_n, split_half=m["r"], reliability=m["full"], settle=k,
                         yoy_stay=m.get("yoy_stay"), yoy_move=m.get("yoy_move"), verdict=v))
        verdicts[st.key] = {"verdict": show, "k": round(float(k), 1) if k else 1000.0, "reliability": None if not np.isfinite(m["full"]) else round(float(m["full"]), 3),
                            "label": v}
        print(f"{st.key:20s} {tier} n={m['players']:5d} typ={m['typical']:8.1f} rel={m['full']:.3f} k={k} -> {v}", flush=True)
    trows = []
    if only:
        pd.DataFrame(rows).to_csv(OUT / "expansion_stability.csv", index=False)
        CX.VFILE.write_text(json.dumps(verdicts, indent=1, sort_keys=True))
        write_md(pd.DataFrame(rows), pd.read_csv(OUT / "expansion_stability_teams.csv"))
        return
    for (key, lab, grp, tier, unit, lo, what, num, den, side) in CX.TEAM_X:
        m = team_measure(key, num, den, side, tier)
        if m is None:
            continue
        style = key in ("sec_play", "proe", "early_pass", "shotgun", "nohuddle", "off_adot", "def_adot", "two_rate", "to_g", "to_late", "fd4_goe")
        v, show = verdict(m["full"], style, tier)
        trows.append(dict(stat=key, label=lab, tier=tier, team_seasons=m["players"], reliability=m["full"], verdict=v))
        verdicts["team:" + key] = {"verdict": show, "reliability": round(float(m["full"]), 3), "label": v}
    for key, *_ in CX.TEAM_POS:
        verdicts["team:" + key] = {"verdict": "hatched", "reliability": None, "label": "hatched (as 1.0.0's adjusted defence rates)"}
    pd.DataFrame(rows).to_csv(OUT / "expansion_stability.csv", index=False)
    pd.DataFrame(trows).to_csv(OUT / "expansion_stability_teams.csv", index=False)
    CX.VFILE.write_text(json.dumps(verdicts, indent=1, sort_keys=True))
    write_md(pd.DataFrame(rows), pd.DataFrame(trows))


def write_md(r, t):
    f = lambda v, n=2: "" if v is None or (isinstance(v, float) and not np.isfinite(v)) else f"{v:.{n}f}"
    cnt = r.verdict.str.replace(r" \(.*\)", "", regex=True).value_counts().to_dict()
    lines = ["# College Football Savant 1.1.0: stability of every new stat", "",
             "*`python -m pipeline.cfb.xstudy`, BUILD-1.1 section 3. Tier A: 1.0.0's method on 2014-2025. Tier B: split-half within 2025 "
             "week 9 on and 2026, stepped up to a typical starter's full season; year-to-year not measurable yet, and settle points will "
             "firm up as seasons accumulate.*", "",
             "Verdicts: " + ", ".join(f"{k} {v}" for k, v in sorted(cnt.items())) + f" (of {len(r)} player stats).", "",
             "Reliability is the split-half correlation stepped up to a full season (Tier B: to a typical starter's full season). "
             "Settle point: the sample at which his own number and the position average carry equal weight.", ""]
    for tier, title in (("A", "Tier A: every season the data has"), ("B", "Tier B: the charted layer, 2025 week 9 on")):
        x = r[r.tier == tier]
        lines += [f"## {title}", "", "| stat | slots | group | player-seasons | typical sample | reliability | settle point | year-to-year: stayed | transferred | verdict |",
                  "|---|---|---|---:|---:|---:|---:|---:|---:|---|"]
        for _, s in x.iterrows():
            lines.append(f"| {s.label} (`{s.stat}`) | {s.slots} | {s.group} | {s.players} | {f(s.typical, 0)} {s.unit} | {f(s.reliability)} | "
                         f"{'' if s.settle is None or not np.isfinite(s.settle) else f'{s.settle:.0f}'} | "
                         f"{f(s.yoy_stay) if tier == 'A' else 'not yet'} | {f(s.yoy_move) if tier == 'A' else 'not yet'} | {s.verdict} |")
        lines.append("")
    lines += ["## Team stats", "", "| stat | tier | team-seasons | reliability | verdict |", "|---|---|---:|---:|---|"]
    for _, s in t.iterrows():
        lines.append(f"| {s.label} (`{s.stat}`) | {s.tier} | {s.team_seasons} | {f(s.reliability)} | {s.verdict} |")
    (OUT / "expansion_stability.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else None)
