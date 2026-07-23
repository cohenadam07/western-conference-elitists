"""Analytics-tab sourcing: arXiv API + analytics RSS feeds, 6-month window."""
import re
import feedparser
import requests

from . import sources, config
from .feeds import fetch_feed, parse_entries, _drop_reason
from .util import strip_html, to_iso, parse_iso, now_utc, stable_id

_ARXIV_API = "http://export.arxiv.org/api/query"
_ARXIV_ID = re.compile(r"arxiv\.org/abs/([^v]+)")

# High-precision basketball signal for arXiv: a generic-word list (e.g. "assist",
# "possession") lets in ML papers that merely benchmark on sports data. Require a
# whole-word hit on an unambiguously basketball term in the title or abstract.
_STRONG_ARXIV = re.compile(
    r"\b(basketball|nba|wnba|ncaa|rapm|free[- ]?throw|three[- ]?point|"
    r"shot selection|shot chart|play[- ]?by[- ]?play|box score|"
    r"player tracking|jump shot|field goal)\b",
    re.I,
)


def _is_basketball(text):
    return bool(_STRONG_ARXIV.search(text or ""))


def _within(published_iso, days):
    dt = parse_iso(published_iso)
    if dt is None:
        return False
    return (now_utc() - dt).days <= days


def poll_arxiv(log):
    """Query arXiv for basketball research in the configured categories."""
    cats = " OR ".join(f"cat:{c}" for c in ARXIV_CATS())
    terms = " OR ".join(f'abs:"{t}"' for t in ("basketball", "NBA", "WNBA", "NCAA")) \
        + ' OR ti:"basketball"'
    query = f"({cats}) AND ({terms})"
    params = {
        "search_query": query,
        "start": 0,
        "max_results": 120,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    try:
        resp = requests.get(_ARXIV_API, params=params,
                            headers={"User-Agent": sources.USER_AGENT},
                            timeout=sources.FEED_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        log.warning("arXiv API DEAD: %s", exc)
        return []
    parsed = feedparser.parse(resp.content)

    items, kept, dropped = [], 0, 0
    for e in parsed.entries:
        title = re.sub(r"\s+", " ", (e.get("title") or "")).strip()
        summary = strip_html(e.get("summary"))
        # Relevance on the TITLE only. Many ML/robotics papers merely benchmark
        # on NBA player-tracking data (and "ncAA" amino acids match "ncaa"); a
        # basketball term in the title means the paper is actually about hoops.
        if not _is_basketball(title):
            continue
        published = to_iso(e.get("published_parsed") or e.get("updated_parsed"))
        if not _within(published, config.ANALYTICS_WINDOW_DAYS):
            continue
        if _drop_reason(title, summary):
            dropped += 1
            continue
        m = _ARXIV_ID.search(e.get("id", ""))
        abs_url = e.get("link") or e.get("id")
        authors = [a.get("name") for a in e.get("authors", []) if a.get("name")]
        items.append({
            "id": stable_id("arxiv", m.group(1) if m else abs_url),
            "title": title,
            "url": abs_url,
            "outlet": sources.ARXIV["outlet"],
            "published": published,
            "summary": summary,
            "authors": authors,
            "source_type": "paper",
        })
        kept += 1
    log.info("arXiv: %d basketball papers in window (%d dropped by filter)", kept, dropped)
    return items


def ARXIV_CATS():
    return sources.ARXIV["categories"]


def poll_analytics_feeds(log):
    """Pull the configured analytics RSS/Atom feeds (Substacks, JQAS, blogs)."""
    items = []
    for feed in sources.ANALYTICS_FEEDS:
        parsed = fetch_feed(feed["url"], log)
        if parsed is None:
            continue
        entries = parse_entries(parsed, feed["outlet"], feed.get("source_type"))
        kept = 0
        for it in entries:
            if not _within(it["published"], config.ANALYTICS_WINDOW_DAYS):
                continue
            if _drop_reason(it["title"], it["summary"]):
                continue
            items.append(it)
            kept += 1
        log.info("analytics feed OK  %-42s %2d in window", feed["outlet"], kept)
    return items


def collect_analytics(log):
    """All analytics items, deduped by url, sorted newest-first."""
    items = poll_arxiv(log) + poll_analytics_feeds(log)
    seen, out = set(), []
    for it in sorted(items, key=lambda x: x["published"] or "", reverse=True):
        if it["url"] in seen:
            continue
        seen.add(it["url"])
        out.append(it)
    return out[: config.ANALYTICS_MAX]
