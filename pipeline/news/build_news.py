"""Orchestrator: pull -> dedupe -> match -> rank -> analytics -> WCE line -> news.json."""
import json
import os
import tempfile

from . import config, wce_line, article_fetch
from .feeds import pull_headlines
from .dedupe import group_stories, rank_clusters
from .analytics import collect_analytics
from .players import PlayerIndex
from .savant_stats import SavantStats
from .util import get_logger, parse_iso, now_utc


def _within_days(published_iso, days):
    dt = parse_iso(published_iso)
    if dt is None:
        return True  # keep undated items rather than silently dropping them
    return (now_utc() - dt).days <= days


def build_headlines(log, index):
    items, stats = pull_headlines(log)
    items = [it for it in items if _within_days(it["published"], config.HEADLINES_WINDOW_DAYS)]
    log.info("headlines within %dd window: %d", config.HEADLINES_WINDOW_DAYS, len(items))

    # Player matches per item (drives ranking + chips).
    player_hits = {}
    for it in items:
        hits = index.match(it["title"])
        if hits:
            player_hits[it["id"]] = hits

    clusters = group_stories(items)
    ranked = rank_clusters(clusters, player_hits)
    top = ranked[: config.HEADLINES_MAX]
    log.info("headline stories: %d grouped, keeping top %d (>=%d target)",
             len(clusters), len(top), config.HEADLINES_MIN)
    return top


def to_headline_json(r):
    return {
        "id": r["id"],
        "title": r["title"],
        "url": r["url"],
        "outlet": r["outlet"],
        "published": r["published"],
        "also_covered_by": r["also_covered_by"],
        "wce_line": r.get("wce_line"),
        "players": r["players"],
    }


def to_analytics_json(it):
    return {
        "id": it["id"],
        "title": it["title"],
        "url": it["url"],
        "outlet": it["outlet"],
        "published": it["published"],
        "authors": it.get("authors", []),
        "wce_line": it.get("wce_line"),
        "source_type": it.get("source_type") or "article",
    }


def write_json(payload):
    os.makedirs(config.PUBLIC_DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=config.PUBLIC_DIR, suffix=".tmp")
    with os.fdopen(fd, "w") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, config.OUTPUT_JSON)


def main():
    os.makedirs(config.LOG_DIR, exist_ok=True)
    log = get_logger(logfile=config.LOG_FILE)
    log.info("=== news pipeline run ===")

    index = PlayerIndex.load(log=log)
    try:
        stats = SavantStats.load()
    except (OSError, KeyError) as exc:
        log.warning("Savant stats unavailable (%s) — no percentile context", exc)
        stats = None

    headlines = build_headlines(log, index)
    analytics = collect_analytics(log)

    # Read the actual articles so the model summarizes from content, not just
    # the headline. Papers already ship a rich abstract, so skip fetching those.
    article_fetch.attach_text(
        headlines + [a for a in analytics if a.get("source_type") != "paper"], log
    )

    # WCE lines (fills wce_line in place; nulls everything if the LLM is down).
    wce_line.annotate(headlines, analytics, stats, log)

    payload = {
        "generated_at": now_utc().isoformat(),
        "headlines": [to_headline_json(r) for r in headlines],
        "analytics": [to_analytics_json(it) for it in analytics],
    }
    write_json(payload)
    log.info("wrote %s (%d headlines, %d analytics)",
             config.OUTPUT_JSON, len(payload["headlines"]), len(payload["analytics"]))


if __name__ == "__main__":
    main()
