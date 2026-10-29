"""apply.py: put the measured settle points on the page. Run after measure.py:

    python3 tools/savant-settle/apply.py

1. Each card stat's hatching threshold (CFG thr) becomes its measured k_mean.
2. SETTLE_K (the page's likely-to-settle estimates, mirrored by the connector) carries every
   stat measured within seasons.
3. Re-runs add_ext_stats.py (the October 2026 additions take their thresholds from settle.json),
   gives every measured stat a CFG `settle` field ({last, mean, unit, how}: what the connector
   reports), and re-runs explainers.py (every measured stat's "sample" sentence comes from
   settle_text.py).
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
PAGE = os.path.join(ROOT, "public", "basketball-savant.html")
sys.path.insert(0, HERE)
import settle_text as ST  # noqa: E402


def cfg_span(s):
    i = s.index("const CFG  = ") + len("const CFG  = ")
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return i, j + 1
    raise SystemExit("CFG not closed")


def main():
    s = open(PAGE, encoding="utf-8").read()
    i, j = cfg_span(s)
    cfg = json.loads(s[i:j])
    changed = 0
    for m in cfg["metrics"]:
        t = ST.thr(m["key"])
        if t and not m.get("ext") and m.get("thr") != t:
            m["thr"] = t
            changed += 1
    s = s[:i] + json.dumps(cfg, indent=2, ensure_ascii=False) + s[j:]
    K = ST.settle_k()
    line = "const SETTLE_K={" + ",".join(f"{k}:[{a},{b}]" for k, (a, b) in K.items()) + "};"
    s, n = re.subn(r"const SETTLE_K=\{[^;]*\};", line, s)
    if n != 1:
        raise SystemExit("SETTLE_K not found")
    open(PAGE, "w", encoding="utf-8").write(s)
    print(f"card stats: {changed} thresholds changed; SETTLE_K: {len(K)} stats")
    run = lambda script: subprocess.run([sys.executable, os.path.join(ROOT, "tools", "savant-explainers", script)], check=True)
    run("add_ext_stats.py")
    # every measured stat carries its settle point in CFG too, for the connector (metrics[].settle)
    s = open(PAGE, encoding="utf-8").read()
    i, j = cfg_span(s)
    cfg = json.loads(s[i:j])
    for m in cfg["metrics"]:
        st = ST.STATS.get(m["key"])
        m.pop("settle", None)
        if st:
            m["settle"] = {"last": st["show_last"], "mean": st["show_mean"], "unit": ST.UNITS[m["key"]],
                           "how": "within seasons" if st["method"] == "split" else "season to season"}
    s = s[:i] + json.dumps(cfg, indent=2, ensure_ascii=False) + s[j:]
    open(PAGE, "w", encoding="utf-8").write(s)
    run("explainers.py")


if __name__ == "__main__":
    main()
