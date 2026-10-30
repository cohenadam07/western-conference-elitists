"""Register the October 2026 "everything" additions (pipeline/basketball/ext_config.py) in the
page's CFG. Idempotent: every ext entry is dropped and re-added from ext_config, after the
existing metrics, so editing ext_config and re-running is how a definition changes.

    python3 tools/savant-explainers/add_ext_stats.py && python3 tools/savant-explainers/explainers.py

The explainers (what / formula / source / sample) come from the same entries: explainers.py
reads ext_config too. The page fetches the values from public/savant-ext/ (ext_files.py)."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "..", "..", "public", "basketball-savant.html")
sys.path.insert(0, os.path.join(HERE, "..", "..", "pipeline", "basketball"))
import ext_config as XC  # noqa: E402
sys.path.insert(0, os.path.join(HERE, "..", "savant-settle"))
import settle_text as ST  # noqa: E402  measured hatching thresholds (tools/savant-settle)

# the order the More sections list them in, column by column
GROUPS = ("ctx", "off", "def", "val")
SUBS = {
    "ctx": ["Role & load", "Consistency"],
    "off": ["Shot profile", "Shot creation", "Ball handling", "Driving", "Passing", "Off-ball & screening",
            "Fouls & free throws", "Ball security", "Transition & sources", "Impact"],
    "def": ["Rebounding", "Shot defense", "Matchups & help", "Hustle", "Activity & outcomes", "Fouls & discipline",
            "Physical ingredients"],
    "val": ["Overall value"],
}
FIELDS = ("key", "label", "group", "sub", "layer", "unit", "thr", "lower", "tier", "since", "first", "win")


def main():
    s = open(PAGE, encoding="utf-8").read()
    i = s.index("const CFG  = ") + len("const CFG  = ")
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                break
    cfg = json.loads(s[i:j + 1])
    core = [m for m in cfg["metrics"] if not m.get("ext")]
    clash = {m["key"] for m in core} & set(XC.KEYS)
    if clash:
        sys.exit(f"ext keys already used by card stats: {sorted(clash)}")
    seq = {k: n for n, k in enumerate(XC.KEYS)}
    ext = sorted(XC.EXT_METRICS, key=lambda m: (GROUPS.index(m["group"]), SUBS[m["group"]].index(m["sub"]), seq[m["key"]]))
    cfg["metrics"] = core + [dict({f: (ST.thr(m["key"]) or m[f]) if f == "thr" else m[f] for f in FIELDS}, ext=True) for m in ext]
    s = s[:i] + json.dumps(cfg, indent=2, ensure_ascii=False) + s[j + 1:]
    open(PAGE, "w", encoding="utf-8").write(s)
    print(f"CFG: {len(core)} card stats + {len(ext)} additions")


if __name__ == "__main__":
    main()
