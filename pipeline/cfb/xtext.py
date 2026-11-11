"""1.1.0: the play side table, work/xtra_<season>.parquet.

    python -m pipeline.cfb.xtext 2014 2015 ...      # rebuild those seasons' side tables
    python -m pipeline.cfb.xtext check              # coverage of every season's side table

The slim play table (plays.py) drops the stat crew's text once its flags are read, and never had the
"penalized" or "returner" roles. 1.1.0 needs all three: the charted layer reads the text (charting.py),
and penalties, returns, fair catches, muffs and touchbacks are per player. So every play gets one row
here, keyed by (game_id, play_id):

    text        the play text as ESPN wrote it
    pen1, pen2  athlete ids ESPN attaches as "penalized"
    ret1        the athlete id attached as "returner"

Sources, the same two routes the play table has:
  * release seasons (2014-2025): the release play-by-play file for the text and the play-participants
    file for the ids. The release play-by-play file is downloaded only if it is not on disk, and
    deleted again once its side table is written and checked (ground rule 2).
  * ESPN seasons (2026) and the 2021-2022 backfilled games: ESPN's own responses, through
    espn_feed.base_rows, so the cloud refresh writes the same table the Mac does.

Before 2014 there are no participant files: those seasons get the text only (from the release file).
"""
import os
import re
import sys
import shutil
import subprocess
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from .paths import RAW, WORK

FREE_FLOOR_GB = 8.0
_ID = re.compile(r"\d+")


def free_gb():
    return shutil.disk_usage("/").free / 1e9


def write_xtra(season, x):
    x = x.copy()
    for c in ("game_id", "play_id"):
        x[c] = pd.to_numeric(x[c], errors="coerce").astype("int64")
    for c in ("pen1", "pen2", "ret1"):
        x[c] = pd.to_numeric(x[c], errors="coerce").astype(float)
    x["text"] = x.text.fillna("").astype(str)
    f = WORK / f"xtra_{season}.parquet"
    if f.exists():
        old = pd.read_parquet(f)
        x = pd.concat([old[~old.game_id.isin(set(x.game_id))], x], ignore_index=True)
    x = x.drop_duplicates(["game_id", "play_id"], keep="last").sort_values(["game_id", "play_id"], kind="stable").reset_index(drop=True)
    x[["game_id", "play_id", "text", "pen1", "pen2", "ret1"]].to_parquet(f, index=False)
    return x


def _two(series):
    a = np.full(len(series), np.nan)
    b = np.full(len(series), np.nan)
    for i, v in enumerate(series.to_numpy(dtype=object)):
        if isinstance(v, str) and len(v) > 4:
            m = _ID.findall(v)
            if m:
                a[i] = float(m[0])
                if len(m) > 1:
                    b[i] = float(m[1])
    return a, b


def release(y):
    f = RAW / "espn_cfb_pbp" / f"play_by_play_{y}.parquet"
    fetched = False
    if not f.exists():
        if free_gb() < FREE_FLOOR_GB + 0.5:
            raise SystemExit(f"stop: {free_gb():.1f} GB free, the floor is {FREE_FLOOR_GB} GB")
        f.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["gh", "release", "download", "espn_cfb_pbp", "-R", "sportsdataverse/sportsdataverse-data",
                        "-p", f"play_by_play_{y}.parquet", "-D", str(f.parent), "--skip-existing"], check=True)
        fetched = True
    t = pd.read_parquet(f, columns=["game_id", "id", "text"]).rename(columns={"id": "play_id"})
    t["play_id"] = pd.to_numeric(t.play_id, errors="coerce")
    t["game_id"] = pd.to_numeric(t.game_id, errors="coerce")
    t = t.dropna(subset=["play_id", "game_id"]).drop_duplicates("play_id")
    pf = RAW / "espn_cfb_play_participants" / f"play_participants_{y}.parquet"
    t["pen1"], t["pen2"], t["ret1"] = np.nan, np.nan, np.nan
    if pf.exists():
        have = set(pq.ParquetFile(pf).schema_arrow.names)
        cols = [c for c in ("penalized_player_ids", "returner_player_ids") if c in have]
        p = pd.read_parquet(pf, columns=["play_id"] + cols)
        p["play_id"] = pd.to_numeric(p.play_id, errors="coerce")
        p = p.dropna(subset=["play_id"]).drop_duplicates("play_id").set_index("play_id")
        if "penalized_player_ids" in cols:
            a, b = _two(p.penalized_player_ids)
            t["pen1"] = t.play_id.map(pd.Series(a, index=p.index))
            t["pen2"] = t.play_id.map(pd.Series(b, index=p.index))
        if "returner_player_ids" in cols:
            a, _ = _two(p.returner_player_ids)
            t["ret1"] = t.play_id.map(pd.Series(a, index=p.index))
    plays = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["game_id", "play_id"])
    t = t[t.play_id.isin(set(plays.play_id))]
    x = write_xtra(y, t)
    cov = plays.play_id.isin(set(x.play_id)).mean()
    # the release file must cover every play the slim table took from it (the backfilled games come from ESPN, below)
    bf = WORK / f"backfill_{y}.csv"
    espn_games = set(pd.read_csv(bf).query("used").game_id) if bf.exists() else set()
    rel = plays[~plays.game_id.isin(espn_games)]
    rcov = rel.play_id.isin(set(x.play_id)).mean()
    print(f"{y}: side table {len(x)} rows; covers {cov:.4f} of plays, {rcov:.4f} of release plays; "
          f"penalized named on {x.pen1.notna().sum()} plays, returner on {x.ret1.notna().sum()}", flush=True)
    if rcov < 0.995:
        raise SystemExit(f"{y}: the side table covers only {rcov:.4f} of the release plays")
    if espn_games:
        espn(y, sorted(espn_games))
    if fetched and y < 2025:          # 2025 and 2026 were on disk before this ran: left as they were
        f.unlink()
        print(f"  deleted {f.name}; {free_gb():.1f} GB free", flush=True)


def espn(y, eids):
    """Side-table rows for games built from ESPN's own responses (read from the cache)."""
    from . import espn_feed as E
    g = pd.read_parquet(WORK / "games.parquet")
    g = g[g.season == y].set_index("game_id")
    parts = []
    for eid in eids:
        r = g.loc[eid]
        s, items = E.fetch_summary(eid), E.fetch_plays(eid)
        d = E.base_rows(eid, items, int(r.home), int(r.away), y, int(r.week), int(r.season_type), s,
                        final=(float(r.home_pts), float(r.away_pts)))
        if len(d):
            parts.append(d[list(E.XTRA_COLS)])
    if parts:
        x = write_xtra(y, pd.concat(parts, ignore_index=True))
        print(f"  {y}: {len(eids)} ESPN-built games added from the cache; side table now {len(x)} rows", flush=True)


def check():
    rows = []
    for f in sorted(WORK.glob("xtra_*.parquet")):
        y = int(f.stem.split("_")[1])
        x = pd.read_parquet(f)
        p = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["play_id", "cat"])
        sc = p[p.cat.isin(["rush", "pass"])]
        rows.append(dict(season=y, rows=len(x), plays_cov=round(float(p.play_id.isin(set(x.play_id)).mean()), 4),
                         scrimmage_cov=round(float(sc.play_id.isin(set(x.play_id)).mean()), 4),
                         text=round(float((x.text.str.len() > 0).mean()), 4), pen=int(x.pen1.notna().sum()), ret=int(x.ret1.notna().sum())))
    print(pd.DataFrame(rows).to_string(index=False))
    return rows


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "check":
        check()
    elif a and a[0] == "espn":
        y = int(a[1])
        g = pd.read_parquet(WORK / "games.parquet")
        p = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["game_id"])
        espn(y, sorted(set(p.game_id)))
    else:
        for y in [int(v) for v in a]:
            release(y)
