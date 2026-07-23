"""Shared helpers: logging, HTML stripping, date + title normalization."""
import hashlib
import logging
import re
import sys
from datetime import datetime, timezone
from html import unescape

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
# Outlet suffixes commonly appended to headlines ("... - ESPN", "| CBS Sports").
_SUFFIX_RE = re.compile(r"\s*[|\-–—:]\s*[^|\-–—:]{2,40}$")
_PUNCT_RE = re.compile(r"[^a-z0-9 ]+")


def get_logger(name="news", logfile=None):
    log = logging.getLogger(name)
    if log.handlers:
        return log
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s  %(levelname)-5s  %(message)s", "%Y-%m-%d %H:%M:%S")
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    log.addHandler(sh)
    if logfile:
        fh = logging.FileHandler(logfile)
        fh.setFormatter(fmt)
        log.addHandler(fh)
    return log


def strip_html(text):
    """Turn an HTML summary fragment into clean plain text."""
    if not text:
        return ""
    return _WS_RE.sub(" ", unescape(_TAG_RE.sub(" ", text))).strip()


def to_iso(struct_time):
    """feedparser struct_time (UTC) -> ISO 8601 date-time string, or None."""
    if not struct_time:
        return None
    try:
        return datetime(*struct_time[:6], tzinfo=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def parse_iso(s):
    """ISO string -> aware datetime (UTC), or None."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def now_utc():
    return datetime.now(timezone.utc)


def stable_id(*parts):
    """Deterministic short hash for an item id."""
    h = hashlib.sha1("\x1f".join(str(p) for p in parts).encode("utf-8"))
    return h.hexdigest()[:16]


def normalize_title(title):
    """Lowercase, drop a trailing outlet suffix, strip punctuation -> tokens key.

    Used for near-duplicate grouping. Returns (clean_string, token_set).
    """
    t = unescape(title or "").lower().strip()
    t = _SUFFIX_RE.sub("", t)
    t = _PUNCT_RE.sub(" ", t)
    tokens = [w for w in _WS_RE.sub(" ", t).split() if len(w) > 2]
    return " ".join(tokens), set(tokens)
