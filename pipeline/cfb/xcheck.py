"""1.1.0 step 3's check: the new play-by-play counts against ESPN's box scores (BUILD-1.1: within 2%).

    python -m pipeline.cfb.xcheck        # research/cfb/out/box_check.md

Compared season by season over FBS-vs-FBS games, garbage time in (the box counts every play), regulation only on
both sides where the play-by-play can tell:
  returns    kick and punt returns and their yards: work/pg_retx_all against the box's kickReturns / puntReturns
  punting    punts: work/pg_pbox_all's play-by-play punts against the box's punts (inside-20 and touchbacks are the
             box's own, so they cannot disagree with it)
  penalties  accepted penalties by team: the play-by-play's penalty rows (declined and offsetting left out) against
             the team box's penalty count; and the share of them ESPN names a penalized player on
"""
import numpy as np
import pandas as pd
from .paths import RAW, WORK, OUT
from . import config as C

TOL = 0.02


def box(y, cat, cols):
    b = pd.read_parquet(RAW / "espn_cfb_player_box" / f"player_box_{y}.parquet")
    b = b[b.category == cat]
    return {c: pd.to_numeric(b[c], errors="coerce") for c in cols}, b


def main():
    g = pd.read_parquet(WORK / "games.parquet")
    rt = pd.read_parquet(WORK / "pg_retx_all.parquet")
    pb = pd.read_parquet(WORK / "pg_pbox_all.parquet")
    tg = pd.read_parquet(WORK / "teamgame.parquet")
    rows = []
    for y in C.SEASONS:
        games = set(rt[rt.season == y].game_id) & set(g[(g.season == y) & g.fbs_game].game_id)
        r = rt[(rt.season == y) & rt.game_id.isin(games)]
        bk, b1 = box(y, "kickReturns", ["kickReturns", "kickReturnYards"])
        bp, b2 = box(y, "puntReturns", ["puntReturns", "puntReturnYards"])
        mk, mp = b1.game_id.isin(games).to_numpy(), b2.game_id.isin(games).to_numpy()
        row = {"season": y, "kick_returns": (r.kret.sum(), bk["kickReturns"][mk].sum()), "kick_return_yds": (r.kret_yds.sum(), bk["kickReturnYards"][mk].sum()),
               "punt_returns": (r.pret.sum(), bp["puntReturns"][mp].sum()), "punt_return_yds": (r.pret_yds.sum(), bp["puntReturnYards"][mp].sum()),
               "pbp_return_coverage": float(r.pbp_returns.sum() / max(1.0, r.kret.sum() + r.pret.sum()))}
        p = pb[(pb.season == y) & pb.game_id.isin(games)]
        row["punts"] = (p.p_n.sum(), p.bp_punts.sum())
        t = tg[(tg.season == y) & (tg.filt == "all") & tg.game_id.isin(games)]
        d = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["game_id", "play_id", "f_pen", "period"])
        x = pd.read_parquet(WORK / f"xtra_{y}.parquet", columns=["play_id", "text", "pen1"])
        d = d[d.game_id.isin(games) & d.f_pen].merge(x, on="play_id", how="left")
        low = d.text.fillna("").str.lower()
        acc = d[~low.str.contains("declined|offsetting|off-setting", regex=True)]
        row["penalties"] = (float(len(acc)), float(t.pen_n.sum()))
        row["penalized_named"] = float(acc.pen1.notna().mean()) if len(acc) else np.nan
        rows.append(row)
    lines = ["# Box-score cross-checks (BUILD-1.1 step 3)", "", f"*`python -m pipeline.cfb.xcheck`. Play-by-play against ESPN's box scores, FBS-vs-FBS games, garbage time in; bar: within {TOL:.0%}.*", ""]
    keys = ["kick_returns", "kick_return_yds", "punt_returns", "punt_return_yds", "punts"]
    lines += ["| season | " + " | ".join(k.replace("_", " ") for k in keys) + " | penalized player named | returns the play text describes |", "|---|" + "---:|" * (len(keys) + 2)]
    worst = {k: 0.0 for k in keys}
    for r in rows:
        cells = []
        for k in keys:
            a, b = r[k]
            gap = (a - b) / b if b else np.nan
            worst[k] = max(worst[k], abs(gap)) if np.isfinite(gap) else worst[k]
            cells.append(f"{gap:+.1%}" + (" !" if np.isfinite(gap) and abs(gap) > TOL else ""))
        lines.append(f"| {r['season']} | " + " | ".join(cells) + f" | {r['penalized_named']:.0%} | {r['pbp_return_coverage']:.0%} |")
    ok = all(v <= TOL for v in worst.values())
    lines += ["", "Gap = the site's number less the box's, as a share of the box. " + ("**Every count is within 2%.**" if ok else "**Not every count is within 2%: see the marked cells.**"), "",
              "Returns: counts, yards and touchdowns are the box score's, because the play text of some seasons stops at \"kickoff for 62 yds\" "
              "(2,725 kickoffs in 2023) and misses returns the box lists. Per-return rates (EPA, 20-yard returns, fair catches, muffs) come from "
              "the returns the play text describes, whose share of the box's is the last column.", "",
              "Penalties: the box score has no per-player penalty line, so a player's penalties cannot be checked against it. The team page's "
              "penalty stats are the team box's (as in 1.0.0). A player's are the accepted penalties ESPN names him on: the penalized-player "
              "column is the share of the play-by-play's accepted penalties that name anyone. Play-by-play penalty rows against the team box:", "",
              "| season | play-by-play accepted penalties vs team box |", "|---|---:|"] + [
              f"| {r['season']} | {(r['penalties'][0] - r['penalties'][1]) / r['penalties'][1]:+.1%} |" for r in rows] + [""]
    (OUT / "box_check.md").write_text("\n".join(lines))
    print("\n".join(lines))
    print({k: round(v, 4) for k, v in worst.items()})
    return ok


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
