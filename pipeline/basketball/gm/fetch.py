"""
fetch.py — GM Savant's one door to the outside: polite, cached, never retried around a block.

Every response is kept under ~/Basketball-Savant/cache_gm/ as <sha1 of the URL> plus a .url
file naming it, so a rebuild reads the cache and asks nothing. Requests to one host are spaced
(4 s by default, Basketball-Reference asks for under 20 a minute). A 403 or 429 is returned,
not retried: a site that refuses us is a site we stop asking (the ground rules).

    from fetch import get
    code, body = get(url)              # body is bytes; code -1 means a network error
"""
import hashlib
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

import certifi

CACHE = os.environ.get('GM_CACHE') or os.path.expanduser('~/Basketball-Savant/cache_gm')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
_CTX = ssl.create_default_context(cafile=certifi.where())
_last = {}
# The Basketball-Reference hold (Adam, Nov 23 2026: no BR fetches while the Contract tab's pull runs). While this file
# exists, every Basketball-Reference request is answered from the cache only, at any age; nothing goes to BR. The Mac
# lane keeps running on its cached pages and NBA.com. Delete the file to lift the hold.
BR_HOLD = os.environ.get('GM_BR_HOLD') or os.path.expanduser('~/.config/wce/gm-br-hold')


def br_held(url):
    return 'basketball-reference.com' in url and os.path.exists(BR_HOLD)


def path_of(url):
    return os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())


def cached(url):
    return os.path.exists(path_of(url))


def get(url, delay=4.0, headers=None, offline=False, max_age_h=None):
    """max_age_h: refetch a cached page older than this (the daily refresh reads the season in progress this way); on a
    failed refetch the cached copy is kept and returned."""
    offline = offline or br_held(url)
    p = path_of(url)
    if os.path.exists(p) and (max_age_h is None or time.time() - os.path.getmtime(p) < max_age_h * 3600 or offline):
        return 200, open(p, 'rb').read()
    stale = open(p, 'rb').read() if os.path.exists(p) else None
    if offline:
        return -2, b''
    os.makedirs(CACHE, exist_ok=True)
    host = url.split('/')[2]
    wait = delay - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.time()
    h = {'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'}
    h.update(headers or {})
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30, context=_CTX)
        body, code = r.read(), r.status
    except urllib.error.HTTPError as e:
        return (200, stale) if stale is not None else (e.code, e.read())
    except Exception as e:  # noqa: BLE001 - a network error is a result, not a crash
        return (200, stale) if stale is not None else (-1, str(e).encode())
    if code != 200 and stale is not None:
        return 200, stale
    if code == 200:                       # a 202 placeholder or a redirect page is not the page
        open(p + '.tmp', 'wb').write(body)
        os.replace(p + '.tmp', p)
        open(p + '.url', 'w').write(url)
    return code, body


if __name__ == '__main__':
    c, b = get(sys.argv[1])
    print(c, len(b))
