"""Base tables for the College Football Savant research run.

    python -m pipeline.cfb.plays games        # one row per game, 2004-2026
    python -m pipeline.cfb.plays plays        # one slim row per play, per season

Everything downstream (the expected-points model, the stability studies, the
ratings) reads these two tables and never the 507-column release files, so
this is the single place where the release format is interpreted.

What is taken from the release files and what is not
----------------------------------------------------
Taken as DATA: the play's start state (down, distance, yard line, clock,
score, who has the ball), its type and text-derived flags (rush, pass, sack,
interception, completion ...), yards, and the athlete ids ESPN attaches to it.
NOT taken: any model output (EPA, EP, WP, cp, xpass ...). Those columns are
carried only as `rel_*` so ours can be compared with them.

Scoring is read from the play TYPE, not from the running score columns: in the
older seasons ESPN's score often ticks over one or two rows early (a plain
"Rush" row shows +7), which was measured on 2008 before this was written.
"""
import re
import sys
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from .paths import RAW, WORK

SEASONS = list(range(2004, 2027))

# ---- play-type vocabulary (measured on 2008, 2018, 2024) -------------------
PAT_TYPES = {"Extra Point Good", "Extra Point Missed", "Two-Point Conversion Good",
             "Two-Point Conversion Missed", "Two Point Pass", "Two Point Rush",
             "Defensive 2pt Conversion", "Blocked PAT", "2pt Conversion"}
SKIP_TYPES = PAT_TYPES | {"Timeout", "End Period", "End of Half", "End of Game", "Coin Toss",
                          "End of Regulation", "Unknown", "placeholder", "Uncategorized"}
OFF_TD = {"Rushing Touchdown", "Passing Touchdown", "Fumble Recovery (Own) Touchdown",
          "Kickoff Return Touchdown", "Punt Team Fumble Recovery Touchdown"}
DEF_TD = {"Interception Return Touchdown", "Fumble Return Touchdown",
          "Fumble Recovery (Opponent) Touchdown", "Punt Return Touchdown", "Blocked Punt Touchdown",
          "Blocked Field Goal Touchdown", "Missed Field Goal Return Touchdown",
          "Kickoff Team Fumble Recovery Touchdown"}
SAFETY = {"Safety", "Punt (Safety)", "Kickoff (Safety)"}
FG_GOOD = {"Field Goal Good"}
FG_TYPES = {"Field Goal Good", "Field Goal Missed", "Blocked Field Goal", "Blocked Field Goal Touchdown",
            "Missed Field Goal Return", "Missed Field Goal Return Touchdown"}
PUNT_TYPES = {"Punt", "Punt Return", "Blocked Punt", "Punt Return Touchdown", "Blocked Punt Touchdown",
              "Punt Team Fumble Recovery", "Punt Team Fumble Recovery Touchdown", "Punt (Safety)"}
KICK_TYPES = {"Kickoff", "Kickoff Return (Offense)", "Kickoff Return Touchdown", "Kickoff Team Fumble Recovery",
              "Kickoff Team Fumble Recovery Touchdown", "Kickoff (Safety)", "Kickoff Return (Defense)"}

PBP_COLS = {
    "game_id": "game_id", "id": "play_id", "game_play_number": "gpn", "drive.id": "drive_id",
    "seasonType": "season_type", "week": "week", "period": "period", "half": "half",
    "start.TimeSecsRem": "secs_half", "start.adj_TimeSecsRem": "secs_game",
    "start.down": "down", "start.distance": "dist", "start.yardsToEndzone": "ytg",
    "end.yardsToEndzone": "ytg_end",
    "start.pos_team.id": "off", "start.def_pos_team.id": "deff",
    "homeTeamId": "home", "awayTeamId": "away",
    "start.pos_score_diff": "score_diff", "homeScore": "home_score_row", "awayScore": "away_score_row",
    "type.text": "ptype", "text": "text", "statYardage": "yards",
    "rush": "f_rush", "pass": "f_pass", "sack": "f_sack", "int": "f_int", "completion": "f_comp",
    "pass_attempt": "f_att", "target": "f_target", "touchdown": "f_td", "fumble_vec": "f_fum",
    "fumble_lost": "f_fum_lost", "penalty_flag": "f_pen", "penalty_no_play": "f_pen_noplay",
    "kneel_down": "f_kneel", "qb_hurry": "f_hurry", "pass_breakup": "f_pbu", "forced_fumble": "f_ff",
    "yds_rushed": "yds_rushed", "yds_receiving": "yds_receiving", "yds_sacked": "yds_sacked",
    "yds_fg": "yds_fg", "yds_punted": "yds_punted", "yds_punt_return": "yds_punt_ret",
    "yds_kickoff": "yds_kick", "yds_kickoff_return": "yds_kick_ret",
    "penalty_team_id": "pen_team", "penalty_yards_net": "pen_yards", "yds_penalty": "pen_yards_txt",
    "rusher_player_id": "rusher", "passer_player_id": "passer", "receiver_player_id": "receiver",
    "sack_player_id": "sack1", "sack_player_id2": "sack2", "interception_player_id": "int_by",
    "pass_breakup_player_id": "pbu_by", "fumble_forced_player_id": "ff_by",
    "fumble_player_id": "fumbler", "fg_kicker_player_id": "kicker", "punter_player_id": "punter",
    "kickoff_player_id": "ko_kicker", "kickoff_return_player_id": "ko_ret", "punt_return_player_id": "punt_ret",
    # release model outputs: comparison only
    "EPA": "rel_epa", "EP_start": "rel_ep", "wp_before": "rel_wp",
}
PART_COLS = {"tackler_player_ids": "tk", "assisted_by_player_ids": "ast", "pass_defender_player_ids": "pdef",
             "sacked_by_player_ids": "skby", "forced_by_player_ids": "ffby", "recoverer_player_ids": "recby"}
_ID = re.compile(r"\d+")


def fbs_table():
    """season, team_id -> conference, division for every FBS team that season."""
    out = []
    for y in range(2004, 2027):
        t = pd.read_parquet(RAW / "cfb_team_info" / f"cfb_team_info_{y}.parquet",
                            columns=["team_id", "school", "abbreviation", "conference", "division", "classification"])
        t = t[t.classification == "fbs"].copy()
        t["season"] = y
        t["team_id"] = t.team_id.astype("int64")
        out.append(t.drop(columns="classification"))
    return pd.concat(out, ignore_index=True)


def build_games():
    fbs = fbs_table()
    fbs.to_parquet(WORK / "fbs_teams.parquet", index=False)
    out = []
    for y in SEASONS:
        s = pd.read_parquet(RAW / "espn_cfb_schedules" / f"cfb_schedule_{y}.parquet")
        s = s.rename(columns={"home_id": "home", "away_id": "away", "home_score": "home_pts", "away_score": "away_pts"})
        for c in ("home", "away", "game_id"):
            s[c] = s[c].astype("int64")
        s["date"] = pd.to_datetime(s.game_date, utc=True)
        s["final"] = s.status.astype(str).str.upper().str.contains("FINAL")
        keep = ["game_id", "season", "week", "season_type", "date", "neutral_site", "conference_competition",
                "home", "away", "home_team", "away_team", "home_pts", "away_pts", "final"]
        s = s[keep]
        f = fbs[fbs.season == y].set_index("team_id")
        for side in ("home", "away"):
            s[f"{side}_fbs"] = s[side].isin(f.index)
            s[f"{side}_conf"] = s[side].map(f.conference)
            s[f"{side}_div"] = s[side].map(f.division)
        # extras from the CFBD-shaped schedule (same game ids): notes, playoff round
        c = pd.read_parquet(RAW / "cfb_schedules" / f"cfb_schedules_{y}.parquet")
        cc = [x for x in ("game_id", "notes", "playoff_round_name", "conference_game") if x in c.columns]
        c = c[cc].drop_duplicates("game_id")
        c["game_id"] = c.game_id.astype("int64")
        s = s.merge(c, on="game_id", how="left")
        # closing spread, home perspective (negative = home favoured).
        # ESPN's betting table is empty for ~88% of 2014-2022 games (measured), so the
        # classic file's CFBD line is the main source and ESPN's fills what it lacks.
        s["spread_home"] = np.nan
        s["spread_src"] = None
        p = RAW / "cfbfastR_cfb_pbp" / f"play_by_play_{y}.parquet"
        if p.exists():
            k = pd.read_parquet(p, columns=["game_id", "spread"]).dropna().drop_duplicates("game_id")
            m = s.game_id.map(k.set_index("game_id").spread)
            s.loc[m.notna(), "spread_src"] = "classic"
            s["spread_home"] = m
        b = pd.read_parquet(RAW / "espn_cfb_betting" / f"betting_{y}.parquet")
        b = b[b.odds_source.isin(["core_odds_api"]) & b.home_team_spread.notna()].drop_duplicates("game_id")
        e = s.game_id.map(b.set_index("game_id").home_team_spread)
        s["spread_espn"] = e
        fill = s.spread_home.isna() & e.notna()
        s.loc[fill, "spread_home"] = e[fill]
        s.loc[fill, "spread_src"] = "espn"
        # ESPN FPI pre-game numbers (home side)
        if y >= 2005:
            f2 = pd.read_parquet(RAW / "espn_cfb_power_index" / f"power_index_{y}.parquet")
            f2["team_id"] = f2.team_id.astype("int64")
            f2["game_id"] = f2.game_id.astype("int64")
            f2 = f2.drop_duplicates(["game_id", "team_id"]).set_index(["game_id", "team_id"])
            idx = pd.MultiIndex.from_arrays([s.game_id, s.home])
            s["fpi_home_margin"] = f2.teampredptdiff.reindex(idx).to_numpy()
            s["fpi_home_wp"] = f2.gameprojection.reindex(idx).to_numpy()
        out.append(s)
    g = pd.concat(out, ignore_index=True)
    g["fbs_game"] = g.home_fbs & g.away_fbs
    g["home_margin"] = g.home_pts - g.away_pts
    g.to_parquet(WORK / "games.parquet", index=False)
    print(g.groupby("season").agg(games=("game_id", "size"), final=("final", "sum"), fbs_fbs=("fbs_game", "sum"),
                                  spread=("spread_home", "count"), fpi=("fpi_home_margin", "count")).to_string())
    return g


def _ids(series):
    """'["123" "456"]' -> (first, second) as nullable ints."""
    a = np.full(len(series), np.nan)
    b = np.full(len(series), np.nan)
    vals = series.to_numpy(dtype=object)
    for i, v in enumerate(vals):
        if isinstance(v, str) and len(v) > 4:
            m = _ID.findall(v)
            if m:
                a[i] = float(m[0])
                if len(m) > 1:
                    b[i] = float(m[1])
    return a, b


def build_plays(y):
    f = RAW / "espn_cfb_pbp" / f"play_by_play_{y}.parquet"
    have = set(pq.ParquetFile(f).schema_arrow.names)
    cols = [c for c in PBP_COLS if c in have]
    d = pd.read_parquet(f, columns=cols).rename(columns=PBP_COLS)
    for c in PBP_COLS.values():
        if c not in d.columns:
            d[c] = np.nan
    d["season"] = y
    d["play_id"] = pd.to_numeric(d.play_id, errors="coerce")
    d = d[d.game_id.notna() & d.gpn.notna() & d.play_id.notna()].copy()
    d["play_id"] = d.play_id.astype("int64")
    d = d.sort_values(["game_id", "gpn"], kind="stable").reset_index(drop=True)
    for c in [c for c in d.columns if c.startswith("f_")]:
        d[c] = d[c].fillna(False).astype(bool)
    idc = ["rusher", "passer", "receiver", "sack1", "sack2", "int_by", "pbu_by", "ff_by", "fumbler", "kicker",
           "punter", "ko_kicker", "ko_ret", "punt_ret", "off", "deff", "home", "away", "pen_team"]
    for c in idc:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d["ptype"] = d.ptype.astype(str)

    # participants (2014+): tacklers, assists, pass defenders, sackers, forced fumbles
    pf = RAW / "espn_cfb_play_participants" / f"play_participants_{y}.parquet"
    for c in ("tk1", "tk2", "ast1", "ast2", "pdef1", "skby1", "skby2", "ffby1"):
        d[c] = np.nan
    if pf.exists():
        ph = set(pq.ParquetFile(pf).schema_arrow.names)
        pc = [c for c in PART_COLS if c in ph]
        p = pd.read_parquet(pf, columns=["play_id"] + pc)
        p["play_id"] = pd.to_numeric(p.play_id, errors="coerce")
        p = p[p.play_id.notna()].drop_duplicates("play_id")
        p["play_id"] = p.play_id.astype("int64")
        tmp = pd.DataFrame({"play_id": p.play_id.to_numpy()})
        for c in pc:
            a, b = _ids(p[c])
            tmp[PART_COLS[c] + "1"] = a
            tmp[PART_COLS[c] + "2"] = b
        d = d.drop(columns=["tk1", "tk2", "ast1", "ast2", "pdef1", "skby1", "skby2", "ffby1"]).merge(
            tmp, on="play_id", how="left")
        for c in ("tk1", "tk2", "ast1", "ast2", "pdef1", "skby1", "skby2", "ffby1"):
            if c not in d.columns:
                d[c] = np.nan
        d["has_part"] = d.play_id.isin(set(p.play_id))
    else:
        d["has_part"] = False
    d = finish(d)
    d.to_parquet(WORK / f"plays_{y}.parquet", index=False)
    return d


def finish(d):
    """Category, text flags, points and next score. Shared by the release route (build_plays)
    and the ESPN route (espn_feed), so the two cannot drift apart."""
    # ---- play category ------------------------------------------------------
    t = d.ptype
    cat = np.full(len(d), "other", dtype=object)
    cat[t.isin(SKIP_TYPES).to_numpy()] = "skip"
    cat[t.isin(KICK_TYPES).to_numpy()] = "kickoff"
    cat[t.isin(PUNT_TYPES).to_numpy()] = "punt"
    cat[t.isin(FG_TYPES).to_numpy()] = "fg"
    scrim = ~np.isin(cat, ["skip", "kickoff", "punt", "fg"])
    cat[scrim & d.f_rush.to_numpy()] = "rush"
    cat[scrim & d.f_pass.to_numpy()] = "pass"          # dropbacks: attempts + sacks
    cat[(t == "Penalty").to_numpy() & scrim] = "penalty"
    d["cat"] = cat
    txt = d.text.fillna("").str.lower()
    d["f_spike"] = txt.str.contains("spike", regex=False) & (d.cat == "pass")
    d["f_kneel"] = d.f_kneel | (txt.str.contains("kneel", regex=False) & (d.cat == "rush"))
    d["f_scramble"] = txt.str.contains("scrambl", regex=False)
    d["hurry_txt"] = txt.str.contains("hurried by", regex=False) | txt.str.contains("qb hurry", regex=False)
    # pass depth and side as the stat crew wrote them ("pass complete deep left to ..."). The play text
    # carries them from 2025; before that both columns are empty, which is why completion % over
    # expected is "not tracked before 2025".
    dp = txt.str.extract(r"\b(short|deep)\b(?:\s+(left|middle|right))?")
    d["p_deep"] = np.where(d.cat == "pass", dp[0].map({"short": 0.0, "deep": 1.0}), np.nan)
    d["p_side"] = np.where(d.cat == "pass", dp[1].map({"left": 0.0, "middle": 1.0, "right": 2.0}), np.nan)
    d = d.drop(columns=["text"])

    # ---- who scored on the play (from the play type) ------------------------
    pts = np.zeros(len(d))           # points for the team with the ball (+) or against it (-)
    pts[t.isin(OFF_TD).to_numpy()] = 7
    pts[t.isin(DEF_TD).to_numpy()] = -7
    pts[t.isin(FG_GOOD).to_numpy()] = 3
    pts[t.isin(SAFETY).to_numpy()] = -2
    d["pts"] = pts

    # ---- next score in the half, relative to the team with the ball ---------
    # scan each game-half backwards carrying (scoring team, points)
    half = d.half.fillna(0).astype(int).to_numpy()
    half = np.where(d.period.fillna(0).to_numpy() >= 5, 3, half)    # overtime is its own block
    d["halfb"] = half
    gid = d.game_id.to_numpy()
    off = d.off.to_numpy()
    deff = d.deff.to_numpy()
    scorer = np.where(pts > 0, off, np.where(pts < 0, deff, np.nan))
    apts = np.abs(pts)
    nxt_team = np.full(len(d), np.nan)
    nxt_pts = np.zeros(len(d))
    cur_t, cur_p = np.nan, 0.0
    for i in range(len(d) - 1, -1, -1):
        if i == len(d) - 1 or gid[i] != gid[i + 1] or half[i] != half[i + 1]:
            cur_t, cur_p = np.nan, 0.0
        if apts[i] > 0:
            cur_t, cur_p = scorer[i], apts[i]
        nxt_team[i], nxt_pts[i] = cur_t, cur_p
    sign = np.where(np.isnan(nxt_team), 0, np.where(nxt_team == off, 1, -1))
    d["next_score"] = sign * nxt_pts        # one of 7, 3, 2, 0, -2, -3, -7 (+2 = safety for)

    keep_int = ["game_id", "play_id", "season", "week", "season_type", "period", "halfb"]
    for c in keep_int:
        d[c] = pd.to_numeric(d[c], errors="coerce").fillna(-1).astype("int64")
    return d


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("games", "all"):
        build_games()
    if what in ("plays", "all"):
        seasons = [int(a) for a in sys.argv[2:]] or SEASONS
        for y in seasons:
            d = build_plays(y)
            vc = d.cat.value_counts().to_dict()
            print(y, len(d), d.game_id.nunique(), {k: vc.get(k, 0) for k in ("rush", "pass", "punt", "fg", "kickoff", "penalty", "other", "skip")},
                  "next_score", d.next_score.value_counts().round(0).to_dict(), flush=True)


if __name__ == "__main__":
    main()
