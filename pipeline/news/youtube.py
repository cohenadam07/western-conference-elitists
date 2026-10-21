"""The WCE channel's latest uploads, for the homepage banner.

YouTube's public channel feed is read here, on the Mac's home connection, three times a day with
the news run, and written to public/youtube-feed.json. The site build reads that file
(scripts/lib/whats-new.mjs). The build also tries the feed itself, but YouTube does not reliably
answer the build servers, so this file is what keeps new videos on the banner.

The file holds only the uploads (no timestamp of its own), so it changes, and gets committed, only
when there is a new upload or a title changes.
"""
import json
import os
import re
import tempfile

from . import config
from .feeds import fetch_feed
from .util import to_iso

CHANNEL = "UCFhQ4Kx16jPaychtaykpk0A"  # youtube.com/@WesternConferenceElitists
FEED_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL}"
OUTPUT = os.path.join(config.PUBLIC_DIR, "youtube-feed.json")


def build(log):
    """Write public/youtube-feed.json. On any failure, leave the last good file in place."""
    parsed = fetch_feed(FEED_URL, log)
    if not parsed:
        log.warning("youtube feed unavailable; keeping %s as it is", OUTPUT)
        return
    items = []
    for e in parsed.entries:
        title = re.sub(r"\s*#shorts?\b", "", (e.get("title") or ""), flags=re.I).strip()
        link = (e.get("link") or "").strip()
        published = to_iso(e.get("published_parsed"))
        if title and link and published:
            items.append({"title": title, "url": link, "published": published})
    if not items:
        log.warning("youtube feed had no entries; keeping %s as it is", OUTPUT)
        return
    os.makedirs(config.PUBLIC_DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=config.PUBLIC_DIR, suffix=".tmp")
    with os.fdopen(fd, "w") as fh:
        json.dump({"channel": CHANNEL, "items": items}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp, OUTPUT)
    log.info("wrote %s (%d uploads)", OUTPUT, len(items))
