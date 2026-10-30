"""
draft_data.py — assemble Draft Savant's v1 data files (no network).

Mirrors savant_engine.py's output-contract role, but for a small hardcoded
dataset instead of a live pull. Reads draft_config.py (the single source of
truth) and writes:
  out/draft_players.json        -- the 3 prospects, in {v,n} pairs like the
                                    live engine (n = games played, so the page
                                    can flag small samples the same way).
  out/draft_metrics_config.json -- the metric registry + composite weights,
                                    exported so labels/units/weights stay in
                                    sync with the front-end (same pattern as
                                    savant_engine.write_metrics_config).

Run:
    python draft_data.py
"""
import json, os, datetime as dt
import draft_config as C

OUT_DIR = "out"

BACKFILL = os.path.join(OUT_DIR, "backfill_players.json")


def build_players():
    players = []
    for p in C.PROSPECTS:
        m = {}
        for key, val in p["m"].items():
            if val is None:
                m[key] = {"v": None, "n": None}
            else:
                v, n = val
                m[key] = {"v": v, "n": n}
        # Draft-day age is computed against the player's OWN draft cycle (Feb 1 of the
        # draft year), so a 2021 pick's age reflects his draft, not today.
        dy = p.get("draft_year", 2026)
        bd = p.get("birthdate")
        ref = dt.date(dy, 2, 1)
        m["age"] = {"v": (C.decimal_age(bd, ref) if bd else None), "n": None}
        m["sos"] = {"v": p.get("sos_rank"), "n": None}
        players.append(dict(
            id=p["id"], name=p["name"], college=p["college"], pos=p["pos"],
            conference=p.get("conference"), archetype=p.get("archetype"),
            draft_year=dy,
            draft_pick=p["draft_pick"], draft_team=p["draft_team"],
            birthdate=(bd.isoformat() if bd else None), sos_asof=p.get("sos_asof"),
            gp=p.get("gp"), line=p.get("line") or {}, m=m,
            bpm_torvik=p.get("bpm_torvik"), usg_torvik=p.get("usg_torvik"),
            scouting=p.get("scouting"),
        ))
    # Additive backfill: classes 2010-2020, scraped by draft_backfill.py into the same
    # {v,n} shape. Appended AFTER the hardcoded 2021-2026 set so players[0] stays the 2026
    # No.1 (the page's default landing card) and the existing classes are untouched.
    if os.path.exists(BACKFILL):
        with open(BACKFILL) as fh:
            back = json.load(fh)
        have = {p["id"] for p in players}
        players.extend(p for p in back if p["id"] not in have)
    return players

def write_players():
    os.makedirs(OUT_DIR, exist_ok=True)
    payload = dict(
        source="hardcoded-v1",
        note="2026 top-3 prospects: college production transcribed from DRAFT_SAVANT_RESEARCH.md; "
             "birthdate is public record; KenPom strength-of-schedule rank is a live figure "
             "(see each prospect's sos_asof) and should be re-checked before trusting in a later session. "
             "No live pull yet otherwise.",
        players=build_players(),
    )
    # data.json is the runtime-fetched dataset (the page loads it instead of an inline blob).
    path = os.path.join(OUT_DIR, "data.json")
    with open(path, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    from collections import Counter
    by = dict(sorted(Counter(p["draft_year"] for p in payload["players"]).items()))
    print(f"wrote {path}  ({len(payload['players'])} prospects; by year {by})")

def write_metrics_config():
    os.makedirs(OUT_DIR, exist_ok=True)
    cfg = dict(
        metrics=[{k: m[k] for k in ("key", "label", "group", "sub", "layer", "unit", "lower",
                                     "valid_from", "valid_to")} for m in C.METRICS],
        composite_weights=C.COMPOSITE_WEIGHTS,
    )
    path = os.path.join(OUT_DIR, "draft_metrics_config.json")
    with open(path, "w") as fh:
        json.dump(cfg, fh, indent=2)
    print(f"wrote {path}  ({len(cfg['metrics'])} metrics, {len(cfg['composite_weights'])} composite weights)")

if __name__ == "__main__":
    write_metrics_config()
    write_players()
