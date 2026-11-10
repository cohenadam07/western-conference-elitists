"""Shared paths for the College Football Savant research run.

Raw downloads, caches and intermediate tables live OUTSIDE the repo
(~/College-Football-Savant). Only code, small result tables and charts
are written under research/cfb/ in the repo.
"""
import os
from pathlib import Path

HOME = Path(os.environ.get("CFB_HOME", Path.home() / "College-Football-Savant"))
RAW = HOME / "raw"          # release files, ESPN and CFBD caches (never in git)
WORK = HOME / "work"        # intermediate parquet tables (never in git)
LOGS = HOME / "logs"
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "research" / "cfb" / "out"      # small result tables (csv/json/md), committed
CHARTS = REPO / "research" / "cfb" / "charts"  # png charts, committed

for p in (RAW, WORK, LOGS, OUT, CHARTS):
    p.mkdir(parents=True, exist_ok=True)

SEASONS_ALL = list(range(2004, 2026))      # release history used by the backtest
SEASONS_STUDY = list(range(2014, 2026))    # stability study seasons


def rel(tag: str, name: str) -> Path:
    return RAW / tag / name
