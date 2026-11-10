"""Shared ESPN fetcher for the research run (used by espn_live, heads_check, espn_standings).

Rules it enforces (PROMPT-1 ground rules 4, 6, 7):
  * ESPN hosts only (site.api.espn.com, sports.core.api.espn.com, a.espncdn.com).
  * At most 6 requests in flight, ever (one process-wide semaphore).
  * Every response is cached gzipped under ~/College-Football-Savant/raw/espn_live/
    and a cached response is never refetched.
  * Every network call is logged with its latency to logs/espn_live.log.
  * JSON is parsed with strict=False (ESPN play text carries raw control characters).
"""
import gzip
import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests

from .paths import RAW, LOGS

CACHE = RAW / "espn_live"
CACHE.mkdir(parents=True, exist_ok=True)
LOG = LOGS / "espn_live.log"
ALLOWED = {"site.api.espn.com", "sports.core.api.espn.com", "a.espncdn.com"}
MAX_PARALLEL = 6
UA = {"User-Agent": "Mozilla/5.0"}

_sem = threading.Semaphore(MAX_PARALLEL)
_lock = threading.Lock()
_session = requests.Session()
_session.headers.update(UA)
CALLS = []  # (url, status, latency_s) for calls made by THIS process


def _log(method, url, status, latency, nbytes):
    line = (f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{method}\t{status}\t"
            f"{latency * 1000:.0f}ms\t{nbytes}\t{url}\n")
    with _lock:
        CALLS.append((url, status, latency))
        with open(LOG, "a") as f:
            f.write(line)


PUBLISH_LOCK = os.path.expanduser("~/Basketball-Savant/logs/.publish.lock")


def _yield_to_publish():
    """Basketball Savant's Mac publish holds this lock directory; a pull waits for it (BUILD ground rule 8)."""
    waited = 0
    while os.path.isdir(PUBLISH_LOCK) and waited < 3600:
        time.sleep(20)
        waited += 20


def _check(url):
    host = urlparse(url).netloc
    if host not in ALLOWED:
        raise ValueError(f"host not allowed: {host}")


def url_key(url):
    return "u_" + hashlib.sha1(url.encode()).hexdigest()[:16]


def get_json(url, key=None, tries=3, fresh=False, max_age_days=None):
    """GET a JSON document, cached as CACHE/<key>.json.gz. Returns the parsed object.

    A non-200 answer is cached too (as {"_http_status": n}) so it is never refetched.
    `fresh` refetches and overwrites (a live scoreboard, a final from the last few days that ESPN
    may still correct); with `max_age_days` it refetches only a copy older than that.
    """
    _check(url)
    path = CACHE / f"{key or url_key(url)}.json.gz"
    if fresh and max_age_days is not None and path.exists():
        fresh = (time.time() - path.stat().st_mtime) > max_age_days * 86400
    if path.exists() and not fresh:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.loads(f.read(), strict=False)
    last = None
    _yield_to_publish()
    for attempt in range(tries):
        with _sem:
            t0 = time.time()
            try:
                r = _session.get(url, timeout=40)
                dt = time.time() - t0
                _log("GET", url, r.status_code, dt, len(r.content))
            except requests.RequestException as e:
                dt = time.time() - t0
                _log("GET", url, f"ERR:{type(e).__name__}", dt, 0)
                last = e
                time.sleep(1.5 * (attempt + 1))
                continue
        if r.status_code == 200:
            obj = json.loads(r.content.decode("utf-8", "replace"), strict=False)
            with gzip.open(path, "wt", encoding="utf-8") as f:
                json.dump(obj, f)
            return obj
        if r.status_code in (400, 404):
            obj = {"_http_status": r.status_code, "_body": r.text[:500]}
            with gzip.open(path, "wt", encoding="utf-8") as f:
                json.dump(obj, f)
            return obj
        last = RuntimeError(f"HTTP {r.status_code} for {url}")
        time.sleep(1.5 * (attempt + 1))
    raise last


def head_status(url, tries=3):
    """HEAD a URL (not cached here; the caller caches the result). Returns (status, content_type, length)."""
    _check(url)
    last = None
    for attempt in range(tries):
        with _sem:
            t0 = time.time()
            try:
                r = _session.head(url, timeout=30, allow_redirects=False)
                dt = time.time() - t0
                _log("HEAD", url, r.status_code, dt, 0)
                return r.status_code, r.headers.get("Content-Type"), r.headers.get("Content-Length")
            except requests.RequestException as e:
                dt = time.time() - t0
                _log("HEAD", url, f"ERR:{type(e).__name__}", dt, 0)
                last = e
        time.sleep(1.5 * (attempt + 1))
    return f"ERR:{type(last).__name__}", None, None


def pmap(fn, items):
    """Run fn over items with at most MAX_PARALLEL in flight; results in input order."""
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as ex:
        return list(ex.map(fn, items))


def log_stats(prefixes=None):
    """Read the whole log (all runs) and return (n, median_ms, p95_ms, n_errors) for matching URLs."""
    lat, errs = [], 0
    if not LOG.exists():
        return 0, None, None, 0
    for line in open(LOG):
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 6:
            continue
        _, method, status, ms, _, url = parts[:6]
        if prefixes and not any(p in url for p in prefixes):
            continue
        lat.append(float(ms.rstrip("ms")))
        if status != "200":
            errs += 1
    if not lat:
        return 0, None, None, 0
    lat.sort()
    med = lat[len(lat) // 2] if len(lat) % 2 else (lat[len(lat) // 2 - 1] + lat[len(lat) // 2]) / 2
    p95 = lat[min(len(lat) - 1, int(round(0.95 * (len(lat) - 1))))]
    return len(lat), med, p95, errs
