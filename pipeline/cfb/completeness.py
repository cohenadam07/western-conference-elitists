"""Step 2. Completeness by season, FBS-vs-FBS games only.

    python -m pipeline.cfb.completeness

Writes research/cfb/out/completeness.csv and .md. Two gates decide what a
season may be used for (PROMPT-1 step 2):
  * play-by-play on >= 97% of FBS-vs-FBS finals, else the season is flagged;
  * a defender id on >= 80% of sacks AND of interceptions, else the season's
    player (defender) stats are unusable for this study.
"""
import numpy as np
import pandas as pd
from .paths import RAW, WORK, OUT

MIN_PLAYS = 80        # a game "has play-by-play" when it has at least this many scrimmage plays
PBP_GATE, DEF_GATE = 0.97, 0.80


def pct(a, b):
    return float(a) / float(b) if b else np.nan


def season_row(y, games):
    g = games[(games.season == y) & games.fbs_game & games.final]
    d = pd.read_parquet(WORK / f"plays_{y}.parquet")
    d = d[d.game_id.isin(g.game_id)]
    scrim = d[d.cat.isin(["rush", "pass"])]
    n_scrim = scrim.groupby("game_id").size()
    has = set(n_scrim[n_scrim >= MIN_PLAYS].index)
    r = {"season": y, "fbs_games": len(g), "pbp_games": len(has), "pbp_share": pct(len(has), len(g)),
         "any_pbp_share": pct(d.game_id.nunique(), len(g))}
    # final score: the last running score in the play-by-play vs the box final
    sc = d.groupby("game_id").agg(h=("home_score_row", "max"), a=("away_score_row", "max"))
    m = g.set_index("game_id").join(sc, how="inner")
    m = m[m.index.isin(has)]
    r["score_match"] = float(((m.h == m.home_pts) & (m.a == m.away_pts)).mean()) if len(m) else np.nan
    d = d[d.game_id.isin(has)]
    p = d[d.cat == "pass"]
    att = p[p.f_att & ~p.f_sack]
    comp = att[att.f_comp]
    inc = att[~att.f_comp & ~att.f_int]
    ru = d[(d.cat == "rush") & ~d.f_kneel]
    sk = p[p.f_sack]
    it = p[p.f_int]
    r["passer_id"] = pct(att.passer.notna().sum(), len(att))
    r["receiver_id_comp"] = pct(comp.receiver.notna().sum(), len(comp))
    r["receiver_id_inc"] = pct(inc.receiver.notna().sum(), len(inc))
    r["rusher_id"] = pct(ru.rusher.notna().sum(), len(ru))
    r["sack_def_id"] = pct((sk.sack1.notna() | sk.skby1.notna()).sum(), len(sk))
    r["int_def_id"] = pct((it.int_by.notna() | it.pdef1.notna()).sum(), len(it))
    pb = d[d.f_pbu | d.pbu_by.notna() | d.pdef1.notna()]
    r["pbu_plays_per_game"] = pct(len(pb), len(has))
    r["pbu_def_id"] = pct((pb.pbu_by.notna() | pb.pdef1.notna()).sum(), len(pb))
    tfl = d[d.cat.isin(["rush", "pass"]) & ~d.f_sack & (d.yards < 0) & ~d.f_kneel & ~(d.f_att & ~d.f_comp)]
    anytk = tfl.tk1.notna() | tfl.ast1.notna()
    r["tfl_tackler_id"] = pct(anytk.sum(), len(tfl))
    ff = d[d.f_ff | d.ff_by.notna() | d.ffby1.notna()]
    r["ff_plays_per_game"] = pct(len(ff), len(has))
    r["ff_def_id"] = pct((ff.ff_by.notna() | ff.ffby1.notna()).sum(), len(ff))
    ordinary = d[((d.cat == "rush") & ~d.f_kneel) | ((d.cat == "pass") & d.f_comp)]
    ordinary = ordinary[ordinary.pts == 0]
    r["tackler_id_ordinary"] = pct((ordinary.tk1.notna() | ordinary.ast1.notna()).sum(), len(ordinary))
    r["hurry_plays_per_game"] = pct(d.hurry_txt.sum() + (d.f_hurry & ~d.hurry_txt).sum(), len(has))
    # the box score: how much defensive credit exists there, and how much of it the plays reproduce
    b = pd.read_parquet(RAW / "espn_cfb_player_box" / f"player_box_{y}.parquet")
    b = b[b.game_id.isin(has)]
    for c in ("totalTackles", "sacks", "tacklesForLoss", "passesDefended", "hurries", "soloTackles"):
        if c not in b.columns:
            b[c] = np.nan
        b[c] = pd.to_numeric(b[c], errors="coerce")
    bg = b.groupby("game_id").agg(tk=("totalTackles", "sum"), sk=("sacks", "sum"), tfl=("tacklesForLoss", "sum"),
                                  pd_=("passesDefended", "sum"), hur=("hurries", "sum"))
    ib = b[b.category == "interceptions"]
    r["int_box_coverage"] = min(1.0, pct(pd.to_numeric(ib.interceptions, errors="coerce").sum(), max(len(it), 1)))
    r["box_def_games"] = pct((bg.tk > 20).sum(), len(has))
    r["box_hurry_games"] = pct((bg.hur > 0).sum(), len(has))
    r["box_hurries_per_game"] = pct(bg.hur.sum(), max((bg.hur > 0).sum(), 1))
    gd = bg[bg.tk > 20].index
    dd = d[d.game_id.isin(gd)]
    r["sacks_pbp_vs_box"] = pct(dd.f_sack.sum(), bg.loc[gd].sk.sum())
    tk_credit = dd.tk1.notna().sum() + dd.tk2.notna().sum() + 0.5 * (dd.ast1.notna().sum() + dd.ast2.notna().sum())
    r["tackles_pbp_vs_box"] = pct(tk_credit, bg.loc[gd].tk.sum())
    pdc = (dd.pbu_by.notna() | dd.pdef1.notna()).sum() + dd.f_int.sum()
    r["pd_pbp_vs_box"] = pct(pdc, bg.loc[gd].pd_.sum() + 0.0)
    return r


def main():
    games = pd.read_parquet(WORK / "games.parquet")
    rows = [season_row(y, games) for y in range(2004, 2027)]
    t = pd.DataFrame(rows)
    t["flag_pbp"] = t.pbp_share < PBP_GATE
    # interceptions: the play text names no interceptor on about half of 2021-2023 interceptions, but the box score's
    # "interceptions" category names every one, in every season, so the gate reads the better of the two sources
    t["int_id_best"] = t[["int_def_id", "int_box_coverage"]].max(axis=1)
    t["flag_defender"] = (t.sack_def_id < DEF_GATE) | (t.int_id_best < DEF_GATE)
    t["verdict"] = np.where(t.flag_pbp, "FLAGGED: play-by-play under 97%",
                            np.where(t.flag_defender, "teams only (defender ids under 80%)", "players and teams"))
    t.to_csv(OUT / "completeness.csv", index=False)
    pd.set_option("display.width", 320, "display.max_columns", 50)
    show = t.copy()
    for c in show.columns:
        if show[c].dtype == float:
            show[c] = show[c].round(3)
    print(show.to_string(index=False))
    cols = ["season", "fbs_games", "pbp_share", "score_match", "passer_id", "receiver_id_comp", "receiver_id_inc",
            "rusher_id", "sack_def_id", "int_def_id", "int_box_coverage", "pbu_plays_per_game", "pbu_def_id", "tfl_tackler_id", "ff_def_id",
            "tackler_id_ordinary", "box_def_games", "box_hurry_games", "sacks_pbp_vs_box", "tackles_pbp_vs_box",
            "pd_pbp_vs_box", "verdict"]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for _, r in t.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if c == "pbu_plays_per_game":
                cells.append(f"{v:.1f}")
                continue
            cells.append(f"{v:.1%}" if isinstance(v, float) and c not in ("season", "fbs_games") else str(v))
        lines.append("| " + " | ".join(cells) + " |")
    (OUT / "completeness.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
