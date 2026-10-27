"""
mirror.py — the public mirror of NBA tracking data, as a fallback for the cloud refresh.

stats.nba.com refuses cloud servers, so the NBA-only tables reach the cloud from Adam's Mac
when it is awake (export_tracking.py -> the tracking-data branch). When the Mac is off, this
fills what it can from github.com/gabriel1200/site_Data, a public repository that republishes
NBA.com's tracking pages daily (Adam's call, Oct 26 2026: Mac first, the mirror as fallback).
It is one person's unofficial scrape with no licence, so it is only ever a fallback: if it
stops or changes shape, these tables simply wait for the Mac again.

What it covers (season totals for the season in progress only; no last-N-games windows):
    LeagueDashPtStats       Possessions, CatchShoot, PullUpShot, Drives, Passing, ElbowTouch,
                            PostTouch, PaintTouch, SpeedDistance (from its hustle file)
    LeagueDashPlayerPtShot  the four closest-defender bands
    LeagueHustleStatsPlayer
    SynergyPlayTypes        offense
The mirror's files carry NBA.com's display headers and percents as 0-100; `answer` renames
them to the API's columns and units, so the engine can't tell the difference.
"""
import io
import json
import os
import urllib.request

import pandas as pd

RAW = "https://raw.githubusercontent.com/gabriel1200/site_Data/master/"
API = "https://api.github.com/repos/gabriel1200/site_Data/commits?per_page=1"
UA = {"User-Agent": "wcehoops-basketball-savant"}

TRACK = {"CatchShoot": "cs", "PullUpShot": "pullup", "Possessions": "touches", "Drives": "drives",
         "Passing": "passing", "ElbowTouch": "elbow", "PostTouch": "post_up", "PaintTouch": "paint"}
BANDS = {"0-2 Feet - Very Tight": "very_tight", "2-4 Feet - Tight": "tight", "4-6 Feet - Open": "open",
         "6+ Feet - Wide Open": "wide_open"}

COMMON = {"PLAYER": "PLAYER_NAME", "Player": "PLAYER_NAME", "TEAM": "TEAM_ABBREVIATION", "Team": "TEAM_ABBREVIATION"}
SHOT = lambda pre: {"FGM": pre + "_FGM", "FGA": pre + "_FGA", "FG%": (pre + "_FG_PCT", 100), "PTS": pre + "_PTS",  # noqa: E731
                    "3PM": pre + "_FG3M", "3PA": pre + "_FG3A", "3P%": (pre + "_FG3_PCT", 100), "eFG%": (pre + "_EFG_PCT", 100)}
TOUCH = lambda pre, count: {"Touches": "TOUCHES", count: pre + "ES", "FGM": pre + "_FGM", "FGA": pre + "_FGA",  # noqa: E731
                            "FG%": (pre + "_FG_PCT", 100), "FTM": pre + "_FTM", "FTA": pre + "_FTA",
                            "FT%": (pre + "_FT_PCT", 100), "PTS": pre + "_PTS", "PTS%": (pre + "_PTS_PCT", 100),
                            "PASS": pre + "_PASSES", "PASS%": (pre + "_PASSES_PCT", 100), "AST": pre + "_AST",
                            "AST%": (pre + "_AST_PCT", 100), "TO": pre + "_TOV", "TOV%": (pre + "_TOV_PCT", 100),
                            "PF": pre + "_FOULS", "PF%": (pre + "_FOULS_PCT", 100)}
MAPS = {
    "cs": SHOT("CATCH_SHOOT"),
    "pullup": SHOT("PULL_UP"),
    "touches": {"PTS": "POINTS", "TOUCHES": "TOUCHES", "Front CTTouches": "FRONT_CT_TOUCHES",
                "Time OfPoss": "TIME_OF_POSS", "Avg Sec PerTouch": "AVG_SEC_PER_TOUCH",
                "Avg Drib PerTouch": "AVG_DRIB_PER_TOUCH", "PTS PerTouch": "PTS_PER_TOUCH",
                "ElbowTouches": "ELBOW_TOUCHES", "PostUps": "POST_TOUCHES", "PaintTouches": "PAINT_TOUCHES",
                "PTS PerElbow Touch": "PTS_PER_ELBOW_TOUCH", "PTS PerPost Touch": "PTS_PER_POST_TOUCH",
                "PTS PerPaint Touch": "PTS_PER_PAINT_TOUCH"},
    "drives": {"DRIVES": "DRIVES", "FGM": "DRIVE_FGM", "FGA": "DRIVE_FGA", "FG%": ("DRIVE_FG_PCT", 100),
               "FTM": "DRIVE_FTM", "FTA": "DRIVE_FTA", "FT%": ("DRIVE_FT_PCT", 100), "PTS": "DRIVE_PTS",
               "PTS%": ("DRIVE_PTS_PCT", 100), "PASS": "DRIVE_PASSES", "PASS%": ("DRIVE_PASSES_PCT", 100),
               "AST": "DRIVE_AST", "AST%": ("DRIVE_AST_PCT", 100), "TO": "DRIVE_TOV", "TOV%": ("DRIVE_TOV_PCT", 100),
               "PF": "DRIVE_PF", "PF%": ("DRIVE_PF_PCT", 100)},
    "passing": {"PassesMade": "PASSES_MADE", "PassesReceived": "PASSES_RECEIVED", "AST": "AST",
                "SecondaryAST": "SECONDARY_AST", "PotentialAST": "POTENTIAL_AST", "AST PTSCreated": "AST_PTS_CREATED",
                "ASTAdj": "AST_ADJ", "AST ToPass%": "AST_TO_PASS_PCT", "AST ToPass% Adj": "AST_TO_PASS_PCT_ADJ",
                "FT_AST": "FT_AST"},
    "elbow": TOUCH("ELBOW_TOUCH", "ElbowTouches"),
    "post_up": TOUCH("POST_TOUCH", "PostUps"),
    "paint": TOUCH("PAINT_TOUCH", "PostUps"),       # the mirror's paint file labels its count "PostUps"
    "band": {"FREQ%": ("FGA_FREQUENCY", 100), "EFG%": ("EFG_PCT", 100), "FG%": ("FG_PCT", 100),
             "2FG FREQ%": ("FG2A_FREQUENCY", 100), "2FGM": "FG2M", "2FGA": "FG2A", "2FG%": ("FG2_PCT", 100),
             "3FG FREQ%": ("FG3A_FREQUENCY", 100), "3PM": "FG3M", "3PA": "FG3A", "3P%": ("FG3_PCT", 100)},
}


def _year(season):
    return str(int(season[:4]) + 1)        # the mirror labels 2026-27 as 2027


def _get(path):
    req = urllib.request.Request(RAW + path, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "ignore")


def _rename(df, mp):
    out = pd.DataFrame(index=df.index)
    for c in df.columns:
        if c in COMMON:
            out[COMMON[c]] = df[c]
    for src, dst in mp.items():
        if src not in df.columns:
            continue
        if isinstance(dst, tuple):
            out[dst[0]] = pd.to_numeric(df[src], errors="coerce") / dst[1]
        else:
            out[dst] = pd.to_numeric(df[src], errors="coerce")
    for c in ("PLAYER_ID", "TEAM_ID", "GP", "G", "W", "L", "MIN", "AGE"):
        if c in df.columns and c not in out.columns:
            out[c] = pd.to_numeric(df[c], errors="coerce")
    if "PLAYER_ID" in out.columns:
        out = out[out["PLAYER_ID"].notna()].copy()
        out["PLAYER_ID"] = out["PLAYER_ID"].astype(int)
    return out


class Mirror:
    def __init__(self, season, cache_dir=None, log=print):
        self.season, self.year = season, _year(season)
        self.cache_dir = cache_dir
        self.log = log
        self.files = {}
        self.updated = None
        try:
            req = urllib.request.Request(API, headers=dict(UA, **({"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"}
                                                                    if os.environ.get("GITHUB_TOKEN") else {})))
            with urllib.request.urlopen(req, timeout=20) as r:
                self.updated = json.load(r)[0]["commit"]["committer"]["date"][:10]
        except Exception as e:  # noqa
            log(f"  mirror: couldn't read its last update ({repr(e)[:60]})")

    def _file(self, path):
        if path not in self.files:
            try:
                self.files[path] = pd.read_csv(io.StringIO(_get(path)), low_memory=False)
            except Exception as e:  # noqa
                self.log(f"  mirror: {path} unavailable ({repr(e)[:60]})")
                self.files[path] = None
        return self.files[path]

    def _season_rows(self, path):
        df = self._file(path)
        if df is None:
            return None
        if "year" in df.columns:
            df = df[df["year"].astype(str) == self.year]
        return df if len(df) else None

    def answer(self, name, params):
        """An NBA-shaped DataFrame for this request, or None if the mirror can't answer it."""
        ln = params.get("last_n_games") or params.get("last_n_games_nullable")
        if ln not in (None, "", 0, "0"):
            return None                       # season totals only
        extra = {k: v for k, v in params.items() if k.endswith("_nullable") and v not in (None, "")}
        if name == "LeagueDashPtStats" and params.get("player_or_team", "Player") == "Player":
            m = params.get("pt_measure_type")
            if m == "SpeedDistance":
                df = self._season_rows("hustle.csv")
                if df is None:
                    return None
                out = _rename(df, {k: k for k in ("DIST_FEET", "DIST_MILES", "DIST_MILES_OFF", "DIST_MILES_DEF",
                                                  "AVG_SPEED", "AVG_SPEED_OFF", "AVG_SPEED_DEF")})
                out["PLAYER_NAME"] = df.get("PLAYER_NAME")
                return out
            f = TRACK.get(m)
            if not f:
                return None
            df = self._file(f"{self.year}/player_tracking/{f}.csv")
            return None if df is None else _rename(df, MAPS[f])
        if name == "LeagueDashPlayerPtShot":
            band = params.get("close_def_dist_range_nullable")
            if band not in BANDS or set(extra) - {"close_def_dist_range_nullable"}:
                return None
            df = self._file(f"{self.year}/player_shooting/{BANDS[band]}.csv")
            return None if df is None else _rename(df, MAPS["band"])
        if name == "LeagueHustleStatsPlayer":
            if set(extra):
                return None
            df = self._season_rows("hustle.csv")
            return None if df is None else df.drop(columns=["year"], errors="ignore")
        if name == "SynergyPlayTypes":
            if (params.get("type_grouping_nullable") or "").lower() != "offensive" or \
                    params.get("player_or_team_abbreviation") != "P":
                return None
            df = self._season_rows("playtype.csv")
            if df is None:
                return None
            pt = (params.get("play_type_nullable") or "").lower()
            df = df[df["PLAY_TYPE"].astype(str).str.lower() == pt]
            if not len(df):
                return pd.DataFrame(columns=["PLAYER_ID", "POSS", "PPP", "POSS_PCT", "PERCENTILE"])
            and1 = next((c for c in ("AND ONEFREQ%", "And One Freq%", "And OneFreq%") if c in df.columns), None)
            out = pd.DataFrame({
                "PLAYER_ID": pd.to_numeric(df["PLAYER_ID"], errors="coerce"),
                "TEAM_ID": pd.to_numeric(df.get("team_id", df.get("TEAM_ID")), errors="coerce"),
                "TEAM_ABBREVIATION": df.get("TEAM_ABBREVIATION"), "PLAY_TYPE": df["PLAY_TYPE"],
                "TYPE_GROUPING": "Offensive", "GP": pd.to_numeric(df.get("GP"), errors="coerce"),
                "POSS": pd.to_numeric(df.get("Poss"), errors="coerce"),
                "PPP": pd.to_numeric(df.get("PPP"), errors="coerce"),
                "POSS_PCT": pd.to_numeric(df.get("% Time"), errors="coerce") / 100,
                "PERCENTILE": pd.to_numeric(df.get("Percentile"), errors="coerce") / 100,
                "FG_PCT": pd.to_numeric(df.get("FG%"), errors="coerce") / 100,
                "EFG_PCT": pd.to_numeric(df.get("aFG%"), errors="coerce") / 100,
                "TOV_POSS_PCT": pd.to_numeric(df.get("%TO"), errors="coerce") / 100,
                "FT_POSS_PCT": pd.to_numeric(df.get("%FT"), errors="coerce") / 100,
                "SF_POSS_PCT": pd.to_numeric(df.get("%SF"), errors="coerce") / 100,
                "SCORE_POSS_PCT": pd.to_numeric(df.get("%Score"), errors="coerce") / 100,
                "PLUSONE_POSS_PCT": (pd.to_numeric(df[and1], errors="coerce") / 100) if and1 else 0.0,
                "PTS": pd.to_numeric(df.get("Points"), errors="coerce"),
                "FGM": pd.to_numeric(df.get("FGM"), errors="coerce"), "FGA": pd.to_numeric(df.get("FGA"), errors="coerce"),
                "FGMX": pd.to_numeric(df.get("FGMX"), errors="coerce"),
            })
            out = out[out["PLAYER_ID"].notna()].copy()
            out["PLAYER_ID"] = out["PLAYER_ID"].astype(int)
            return out.reset_index(drop=True)
        return None
