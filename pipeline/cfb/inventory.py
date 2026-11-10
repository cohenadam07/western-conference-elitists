"""Step 1. Inventory of the sportsdataverse-data release files.

Prints every file family's columns (from one real sample file) and its row
count for each season, and writes research/cfb/out/inventory.md.

    python -m pipeline.cfb.inventory
"""
import re
import pyarrow.parquet as pq
from .paths import RAW, OUT

FAMILIES = [
    "espn_cfb_pbp", "espn_cfb_play_participants", "espn_cfb_player_box", "espn_cfb_team_box",
    "espn_cfb_drives", "espn_cfb_game_rosters", "espn_cfb_betting", "espn_cfb_schedules",
    "espn_cfb_linescores", "espn_cfb_rosters", "espn_cfb_power_index", "espn_cfb_teams",
    "cfb_fpi_weekly", "cfb_team_talent", "cfb_returning_production", "cfb_team_info",
    "cfb_schedules", "cfbfastR_cfb_pbp",
]


def season_of(name):
    m = re.search(r"(19|20)\d\d", name)
    return int(m.group(0)) if m else None


def main():
    lines = ["# Release-file inventory", "",
             "Source: github.com/sportsdataverse/sportsdataverse-data release assets (parquet).", ""]
    summary = []
    for fam in FAMILIES:
        d = RAW / fam
        files = sorted(d.glob("*.parquet"))
        by_season = {}
        sample = None
        for f in files:
            s = season_of(f.name)
            if s is None:
                continue
            try:
                md = pq.ParquetFile(f).metadata
            except Exception as e:  # a corrupt download must be loud
                print(f"!! cannot read {f}: {e}")
                continue
            # some families have >1 file per season (e.g. roster_2026); keep the largest
            if s not in by_season or md.num_rows > by_season[s][0]:
                by_season[s] = (md.num_rows, md.num_columns, f.name)
            sample = f
        if not by_season:
            print(f"!! {fam}: no files"); continue
        seasons = sorted(by_season)
        missing = [y for y in range(seasons[0], seasons[-1] + 1) if y not in by_season]
        schema = pq.ParquetFile(sample).schema_arrow
        cols = [f"{n} ({str(schema.field(n).type).replace('large_', '')})" for n in schema.names]
        print(f"\n=== {fam}: seasons {seasons[0]}-{seasons[-1]}, missing {missing or 'none'}, "
              f"{len(schema.names)} columns (sample {sample.name})")
        print("rows by season: " + ", ".join(f"{y}:{by_season[y][0]:,}" for y in seasons))
        print("columns: " + ", ".join(schema.names))
        lines += [f"## {fam}", "",
                  f"Seasons {seasons[0]}–{seasons[-1]}; missing: {missing or 'none'}; "
                  f"{len(schema.names)} columns (sample file `{sample.name}`).", "",
                  "| season | rows | columns |", "|---|---:|---:|"]
        lines += [f"| {y} | {by_season[y][0]:,} | {by_season[y][1]} |" for y in seasons]
        lines += ["", "<details><summary>Columns</summary>", "", ", ".join(cols), "", "</details>", ""]
        summary.append((fam, seasons[0], seasons[-1], missing, len(schema.names)))
    (OUT / "inventory.md").write_text("\n".join(lines))
    print("\nSUMMARY")
    for fam, a, b, miss, nc in summary:
        print(f"{fam:32s} {a}-{b} cols={nc} missing={miss or 'none'}")


if __name__ == "__main__":
    main()
