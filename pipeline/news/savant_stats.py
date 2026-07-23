"""Compute league percentiles for matched players from the Savant player universe.

The player JSON stores raw stat values (the Basketball Savant page computes
percentiles client-side). For the WCE-line context we recompute a percentile
for a curated headline set: rank each player's current-season value against
every qualified player that season (n >= the metric's sample threshold),
inverting for lower-is-better metrics. These feed Claude as the ONLY numbers it
may cite — so they are real, defensible percentiles drawn from the same data.
"""
import json

from . import config

# (metric key, display label, lower_is_better, min sample size) — mirrors the
# thresholds in the Savant config so a percentile isn't computed off a tiny n.
CURATED = [
    ("pts", "Points per 75", False, 300),
    ("ts", "True shooting %", False, 200),
    ("usg", "Usage %", False, 300),
    ("ast", "Assist %", False, 300),
    ("reb75", "Rebounds per 75", False, 300),
    ("tp3", "3-point %", False, 100),
    ("stl", "Steals per 75", False, 1000),
    ("blk", "Blocks per 75", False, 1000),
    ("bpm", "Box Plus/Minus", False, 0),
]


def _span_value(metric_entry):
    """Pull (value, sample_n) from a metric's season span, or (None, None)."""
    if not isinstance(metric_entry, dict):
        return None, None
    span = metric_entry.get("season") or {}
    return span.get("v"), span.get("n")


class SavantStats:
    def __init__(self, roster):
        self._by_id = {str(p["id"]): p for p in roster}
        # Precompute the qualified value pool per metric for percentile ranks.
        self._pools = {}
        for key, _label, _lower, thr in CURATED:
            vals = []
            for p in roster:
                v, n = _span_value((p.get("m") or {}).get(key))
                if v is None:
                    continue
                if thr and (n is None or n < thr):
                    continue
                vals.append(v)
            self._pools[key] = sorted(vals)

    @classmethod
    def load(cls, path=None, season=None):
        with open(path or config.SAVANT_PLAYERS_JSON) as fh:
            doc = json.load(fh)
        season = season or doc["seasons"][0]
        return cls(doc["data"][season]["players"])

    def _percentile(self, key, value, lower):
        pool = self._pools.get(key) or []
        if not pool or value is None:
            return None
        # Fraction of the pool at or below this value.
        below = sum(1 for v in pool if v <= value)
        pct = round(100 * below / len(pool))
        if lower:
            pct = 100 - pct
        return max(1, min(99, pct))

    def rows_for_from_url(self, savant_url):
        """Percentile rows for the player encoded in a /basketball-savant.html?p=<id> url."""
        if not savant_url or "p=" not in savant_url:
            return []
        return self.rows_for(savant_url.split("p=", 1)[1])

    def rows_for(self, player_id):
        """Return a list of {label, value, pct} for a matched player, or []."""
        p = self._by_id.get(str(player_id))
        if not p:
            return []
        out = []
        for key, label, lower, thr in CURATED:
            v, n = _span_value((p.get("m") or {}).get(key))
            if v is None or (thr and (n is None or n < thr)):
                continue
            pct = self._percentile(key, v, lower)
            if pct is None:
                continue
            out.append({"label": label, "value": v, "pct": pct})
        return out
