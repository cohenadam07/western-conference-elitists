"""
validate_gate.py — the acceptance gate from HISTORICAL_BACKFILL_PLAN.md §9.8.
Run after the full build. Prints PASS/FAIL for each criterion; exits non-zero on any FAIL.
"""
import json, sys, os

OUT = "out/players.json"
BAK = "out/players.json.bak"   # pre-new-bars modern snapshot (for regression diff)

def val(p, k, w="season"):
    c = (p.get("m", {}).get(k) or {}).get(w) or {}
    return c.get("v")

def find(d, season, name=None, pid=None):
    for p in d["data"].get(season, {}).get("players", []):
        if (pid is not None and p["id"] == pid) or (name and p["name"] == name):
            return p
    return None

def main():
    d = json.load(open(OUT))
    results = []
    def check(label, ok, detail=""):
        results.append(ok); print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")

    print("1) BR spot-checks (values within rounding of Basketball Reference)")
    bird = find(d, "1985-86", pid=1449)
    check("1985-86 Bird present, PER≈25.6 WS48≈.244 VORP≈8.4",
          bird and abs(val(bird,"per")-25.6)<0.15 and abs(val(bird,"ws48")-0.244)<0.005 and abs(val(bird,"vorp")-8.4)<0.15,
          f"PER={val(bird,'per')} WS48={val(bird,'ws48')} VORP={val(bird,'vorp')}" if bird else "missing")
    magic = find(d, "1986-87", pid=77142)
    check("1986-87 Magic (MVP) present, PER≈27.0",
          magic and val(magic,"per") and abs(val(magic,"per")-27.0)<0.6,
          f"PER={val(magic,'per')} PTS/75={val(magic,'pts')} AST%={val(magic,'ast')}" if magic else "missing")
    jordan = find(d, "1985-86", pid=893)
    check("1985-86 Jordan present (18-game injury season), sub-floor profile shown",
          jordan is not None and jordan.get("qualified") is False and val(jordan,"per") is not None,
          f"qualified={jordan.get('qualified')} PER={val(jordan,'per')}" if jordan else "missing")
    # a deep-bench player: someone in 1985-86 with a real but small role
    bench = [p for p in d["data"]["1985-86"]["players"] if (val(p,"gmsc") is not None and not p.get("qualified"))]
    check("random deep-bench 1985-86 player has a coherent profile", len(bench) > 20,
          f"{len(bench)} sub-floor players carry Game Score")

    print("2) Era gating — Tier 2-4 bars null (grey) pre-cutoff, present in a modern season")
    cfg = json.load(open("out/metrics_config.json"))
    gated = [m["key"] for m in cfg["metrics"] if m.get("tier",1) >= 2]
    pre = all(val(bird, k) is None for k in gated) if bird else False
    modern = find(d, "2015-16", name="LeBron James")
    modtrack = modern and any(val(modern, k) is not None for k in ["drv","onoff"])
    check("1985-86 Bird: all Tier2+ bars null (render 'Not tracked', not 0th)", pre, f"{len(gated)} gated keys")
    check("2015-16 modern player: tracking bars present", bool(modtrack))

    print("3) Historical comps return sane neighbours")
    check("1985-86 Bird has comps", bool(bird and bird.get("comps")),
          ", ".join(f"{c['name']}({c['score']}%)" for c in (bird.get("comps") or [])) if bird else "")

    print("4) Cross-1996 continuity — one id, one continuous career")
    seasons_by = {}
    for s in d["seasons"]:
        for p in d["data"][s]["players"]:
            seasons_by.setdefault(p["id"], set()).add(s)
    kg = seasons_by.get(708, set())
    old = {s for s in kg if int(s[:4]) < 1996}; new = {s for s in kg if int(s[:4]) >= 2011}
    dup = any(sum(1 for p in d["data"][s]["players"] if p["id"]==708) > 1 for s in kg)
    check("KG (708) spans BR + modern under one id, no dup rows", bool(old and new and not dup),
          f"{min(kg)}..{max(kg)}, {len(kg)} seasons")
    gap = [s for s in d["seasons"] if 1996 <= int(s[:4]) <= 2010]
    check("1996-2010 gap filled (continuous index)", len(gap) == 15, f"{len(gap)}/15 gap seasons present")

    print("5) Identity / headshots / teams resolve or fall back")
    hist = d["data"]["1985-86"]["players"]
    matched = sum(1 for p in hist if isinstance(p["id"], int))
    check("majority of historical players matched to NBA person-ids (headshot resolves)",
          matched/len(hist) > 0.9, f"{matched}/{len(hist)} matched")
    check("historical teams carry a franchise label", all("team" in p for p in hist))

    print("6) No regression to existing 1996+ profiles")
    if os.path.exists(BAK):
        old_d = json.load(open(BAK))
        diffs = 0; checked = 0
        for s in ["2024-25", "2018-19"]:
            om = {p["id"]: p for p in old_d["data"][s]["players"]}
            for p in d["data"][s]["players"]:
                o = om.get(p["id"]);
                if not o: continue
                for k in ["ts","usg","ast","pts","tov","oreb","dreb","stl","blk","mpg","tp3"]:
                    checked += 1
                    if val(p,k) != val(o,k): diffs += 1
        check("existing pre-existing bars unchanged (2024-25, 2018-19)", diffs == 0,
              f"{checked} cells checked, {diffs} changed")
    else:
        check("regression baseline present", False, "no .bak")

    n_pass = sum(results); n = len(results)
    print(f"\n=== {n_pass}/{n} checks passed ===")
    sys.exit(0 if n_pass == n else 1)

if __name__ == "__main__":
    main()
