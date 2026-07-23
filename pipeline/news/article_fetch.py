"""Fetch and extract the main body text of an article, to ground the WCE line.

The extracted text is used ONLY as context for the model — it is never written
to news.json or shown on the page (the page carries the sourced headline and
our own note, per the sourcing rules). Extraction failures (paywalls, JS-only
pages, blocks) fall back to the RSS blurb, so a fetch never breaks the run.
"""
import concurrent.futures as cf

import requests
import trafilatura

from . import config, sources

_HEADERS = {"User-Agent": sources.USER_AGENT}


def fetch_text(url):
    """Return cleaned main-content text (capped), or None if too little/failed."""
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=config.ARTICLE_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException:
        return None
    text = trafilatura.extract(
        resp.text, include_comments=False, include_tables=False, favor_precision=True
    )
    if not text:
        return None
    text = " ".join(text.split())
    if len(text.split()) < config.ARTICLE_MIN_WORDS:
        return None
    return text[: config.ARTICLE_MAX_CHARS]


def attach_text(items, log):
    """Fetch article bodies for `items` in parallel, setting item['article_text']."""
    for it in items:
        it.setdefault("article_text", None)
    if not config.FETCH_ARTICLES:
        return
    todo = [it for it in items if it.get("url")]
    ok = 0
    with cf.ThreadPoolExecutor(max_workers=config.FETCH_WORKERS) as ex:
        futures = {ex.submit(fetch_text, it["url"]): it for it in todo}
        for fut in cf.as_completed(futures):
            it = futures[fut]
            try:
                text = fut.result()
            except Exception:  # never let one bad fetch break the run
                text = None
            it["article_text"] = text
            ok += text is not None
    log.info("article fetch: %d/%d extracted (rest fall back to RSS blurb)", ok, len(todo))
