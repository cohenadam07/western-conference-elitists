"""The settle-point numbers and sentences, from settle.json (measure.py) and units.json (each
stat's sample unit, in the words its explainer uses). Read by tools/savant-explainers/ and
apply.py, so the page, its explainers and the connector carry the same numbers."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
_S = json.load(open(os.path.join(HERE, "settle.json"), encoding="utf-8"))
STATS = _S["stats"]
UNITS = json.load(open(os.path.join(HERE, "units.json"), encoding="utf-8"))


def thr(key):
    """The hatching threshold: k with his position's average as the prior (half of what the bar shows is him)."""
    s = STATS.get(key)
    return s["show_mean"] if s else None


def settle_k():
    """The page's SETTLE_K: {key: [k_mean, k_last]} for the stats measured in-season."""
    return {k: [round(s["k_mean"]), round(s["k_last"])] for k, s in STATS.items() if s["method"] == "split"}


def sentence(key):
    s = STATS.get(key)
    if not s:
        return None
    unit = UNITS[key]
    head = f"Settles around {s['show_last']:,} {unit}: at that point his own record and the prior count equally"
    if s["method"] == "split":
        how = f" (measured within seasons, on {s['seasons']} seasons of our data)."
    else:
        how = (f" (measured season to season on {s['seasons']} seasons of our data, calibrated against "
               f"the within-season method).")
    hatch = f" Hatched under {s['show_mean']:,} {unit}, where more of the number is noise than him."
    tail = ""
    if s["method"] == "season" and s.get("median_n") and s["k_last"] > s["median_n"]:
        tail = " That is more than a typical player's full season: treat a single season of it as a lean, not a fact."
    live = " While a season is live, a ◆ on the bar shows where it is likely to land." if s["method"] == "split" else ""
    return head + how + hatch + tail + live
