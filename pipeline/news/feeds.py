"""RSS/Atom feed pulling and quality filtering."""
import feedparser
import requests

from . import sources
from .util import strip_html, to_iso, stable_id

_HEADERS = {"User-Agent": sources.USER_AGENT}


def _drop_reason(title, summary):
    """Return the DROP_TERM that disqualifies this item, or None to keep."""
    hay = f"{title} {summary}".lower()
    for term in sources.DROP_TERMS:
        if term in hay:
            return term
    return None


def fetch_feed(url, log):
    """Fetch + parse one feed. Returns feedparser dict, or None if dead/invalid."""
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=sources.FEED_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        log.warning("feed DEAD (%s): %s", url, exc)
        return None
    parsed = feedparser.parse(resp.content)
    if parsed.bozo and not parsed.entries:
        log.warning("feed INVALID XML (%s): %s", url, parsed.get("bozo_exception"))
        return None
    return parsed


def parse_entries(parsed, outlet, source_type=None):
    """Normalize feedparser entries into WCE item dicts."""
    items = []
    for e in parsed.entries:
        title = (e.get("title") or "").strip()
        link = (e.get("link") or "").strip()
        if not title or not link:
            continue
        summary = strip_html(e.get("summary") or e.get("description") or "")
        published = to_iso(e.get("published_parsed") or e.get("updated_parsed"))
        authors = [a.get("name") for a in e.get("authors", []) if a.get("name")]
        if not authors and e.get("author"):
            authors = [e["author"]]
        items.append({
            "id": stable_id(outlet, link),
            "title": title,
            "url": link,
            "outlet": outlet,
            "published": published,
            "summary": summary,
            "authors": authors,
            "source_type": source_type,
        })
    return items


def pull_headlines(log):
    """Pull all headline feeds. Returns (items, stats)."""
    items, stats = [], {"feeds_ok": 0, "feeds_dead": 0, "raw": 0, "dropped": 0}
    for outlet, url in sources.HEADLINE_FEEDS:
        parsed = fetch_feed(url, log)
        if parsed is None:
            stats["feeds_dead"] += 1
            continue
        stats["feeds_ok"] += 1
        entries = parse_entries(parsed, outlet)
        stats["raw"] += len(entries)
        for it in entries:
            reason = _drop_reason(it["title"], it["summary"])
            if reason:
                stats["dropped"] += 1
                log.info("  drop [%s] %r (%s)", outlet, it["title"][:70], reason)
                continue
            items.append(it)
        log.info("feed OK  %-26s %3d entries", outlet, len(entries))
    return items, stats
