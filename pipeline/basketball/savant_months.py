"""
savant_months.py — month-by-month splits for the page's rolling stat charts.

The card's per-stat chart defaults to year-over-year (which reads straight out of
players.json). This script supplies the *other* axis: the same stats broken down by
calendar month within each season, so a reader can watch a player's shooting climb
across November, December, January instead of only season to season.

Output mirrors savant_shots.py deliberately — heavy, optional data lives in its own
per-player files and is fetched only when someone actually opens a month chart:

    out/months/index.json     = { "<player_id>": ["2024-25", ...] }   (loaded once)
    out/months/<player_id>.json = { "2024-25": { "2024-11": {gp, min, <metric>: v, ...} } }

so the ~68 MB dataset every visitor already downloads does not grow by a byte.

WHAT IT COVERS
Only the box- and advanced-derived metrics, because those are the ones the NBA will
split by date. They run through savant_engine.derive_box — the SAME function the season
numbers use — so a November TS% and a season TS% are computed identically. Everything
sourced elsewhere (BPM/PER/VORP from Basketball Reference, tracking, hustle, synergy,
gravity, matchups, combine) has no monthly equivalent and is simply absent; the page
only offers the month toggle on stats present here.

COST
One league-wide Base call and one Advanced call per month, not per player: ~22 calls a
season, ~330 for all 15. Every call goes through savant_engine.call(), so it is disk
cached and re-runs are free. Months the league did not play (an October in the COVID
season, say) come back empty and are dropped.

    python savant_months.py            # all configured seasons
    python savant_months.py 2024-25    # just one
"""
import os, sys, json, datetime as dt

import savant_config as C
import savant_engine as E

MONTHS_DIR = os.path.join(C.OUT_DIR, "months")

# Metrics derive_box produces; anything not here has no monthly form.
MONTHLY_KEYS = ["mpg", "ts", "efg", "pps", "tp3", "tp3a", "tp3r", "tp2", "ft", "fta",
                "ftr", "p3pt", "pts", "ast", "ast75", "asttov", "tov", "tov75", "usg",
                "oreb", "dreb", "reb75", "stl", "blk", "stk75", "gmsc"]

MIN_GP = 2          # a month with one game is noise, not a trend point


def month_windows(season):
    """[(key, from, to)] for October of the season's first year through August of its
    second — wide enough to catch a bubble finish or a December start. Empty months are
    dropped later, on the evidence of the response rather than a hardcoded schedule."""
    y0 = int(season[:4])
    out = []
    for k in range(11):
        m = 10 + k
        y, mm = y0 + (m - 1) // 12, (m - 1) % 12 + 1
        first = dt.date(y, mm, 1)
        nxt = dt.date(y + (mm == 12), mm % 12 + 1, 1)
        last = nxt - dt.timedelta(days=1)
        out.append((f"{y}-{mm:02d}", first.strftime("%m/%d/%Y"), last.strftime("%m/%d/%Y")))
    return out


def load_split(season, date_from, date_to, measure):
    from nba_api.stats.endpoints import leaguedashplayerstats as L
    fmap = C.FIELD_MAP["box" if measure == "Base" else "adv"]
    df = E.call(L.LeagueDashPlayerStats, dict(
        season=season, season_type_all_star=C.SEASON_TYPE,
        measure_type_detailed_defense=measure, per_mode_detailed="Totals",
        date_from_nullable=date_from, date_to_nullable=date_to))
    if df is None or not len(df):
        return None
    df = df.set_index(fmap["id"])
    return df.rename(columns={v: k for k, v in fmap.items() if v in df.columns})


def build_season(season, per_player):
    windows = month_windows(season)
    kept = 0
    for key, d0, d1 in windows:
        try:
            box = load_split(season, d0, d1, "Base")
            adv = load_split(season, d0, d1, "Advanced")
        except Exception as e:
            print(f"    {key}: failed ({repr(e)[:60]}) — skipped")
            continue
        if box is None or adv is None or not len(box):
            continue
        played = box[box["gp"].fillna(0) > 0] if "gp" in box else box
        if not len(played):
            continue                                    # league didn't play this month

        derived = E.derive_box(box, adv)                 # same derivation as the season numbers
        month_rows = {}
        for mkey in MONTHLY_KEYS:
            for pid, (v, _n) in derived.get(mkey, {}).items():
                if v is None:
                    continue
                month_rows.setdefault(int(pid), {})[mkey] = v

        n_here = 0
        for pid, row in month_rows.items():
            if pid not in box.index:
                continue
            gp = float(box.loc[pid, "gp"] or 0)
            if gp < MIN_GP:
                continue
            row["gp"] = int(gp)
            row["min"] = round(float(box.loc[pid, "min"] or 0))
            per_player.setdefault(pid, {}).setdefault(season, {})[key] = row
            n_here += 1
        if n_here:
            kept += 1
            print(f"    {key}: {n_here} players")
    return kept


def main():
    seasons = sys.argv[1:] or list(C.SEASONS)
    os.makedirs(MONTHS_DIR, exist_ok=True)
    per_player = {}
    for season in seasons:
        print(f"--- {season} ---")
        kept = build_season(season, per_player)
        print(f"  {kept} months with data")

    # merge with anything already on disk so a single-season run is additive
    index = {}
    for pid, seasons_map in per_player.items():
        path = os.path.join(MONTHS_DIR, f"{pid}.json")
        merged = {}
        if os.path.exists(path):
            try:
                merged = json.load(open(path))
            except Exception:
                merged = {}
        merged.update(seasons_map)
        with open(path, "w") as fh:
            json.dump(merged, fh, separators=(",", ":"))
        index[str(pid)] = sorted(merged.keys())

    idx_path = os.path.join(MONTHS_DIR, "index.json")
    if os.path.exists(idx_path):
        try:
            old = json.load(open(idx_path))
            for k, v in old.items():
                if k not in index:
                    index[k] = v
        except Exception:
            pass
    with open(idx_path, "w") as fh:
        json.dump(index, fh, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(MONTHS_DIR, f))
                for f in os.listdir(MONTHS_DIR) if f.endswith(".json"))
    print(f"\nwrote {len(index)} player month files + index.json to {MONTHS_DIR} "
          f"({total/1e6:.1f} MB total, fetched only when a month chart is opened)")


if __name__ == "__main__":
    main()
