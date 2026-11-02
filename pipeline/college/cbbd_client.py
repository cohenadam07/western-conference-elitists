"""
cbbd_client.py — the one door to CollegeBasketballData, counted.

The free tier is 1,000 calls a month, shared with CollegeFootballData, and the fallback has to
have room left, so every call is written to a ledger before it is made and the client refuses
to go past MONTHLY_CAP (600). The ledger is `<COLLEGE_HOME>/cbbd-ledger.json` on the Mac, and a
copy in the cloud run's cache; `calls_this_month()` reads it, and the heartbeat reports it.

The key comes from CBBD_API_KEY (cloud) or ~/.config/wce/cbbd.key (this Mac). It is never
printed, logged, or placed in a URL; a failure message carries only the path.

CBBD's terms forbid a substitute API or a mirror, so what comes through here is an INPUT. It is
never served raw by the connector or written to a downloadable table.
"""
import datetime as dt
import fcntl
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.collegebasketballdata.com"
MONTHLY_CAP = 600
TIER = 1000             # the free tier, shared with CollegeFootballData
HOME = os.environ.get("COLLEGE_HOME") or os.path.expanduser("~/Basketball-Savant/out/cbb")
LEDGER = os.path.join(HOME, "cbbd-ledger.json")


class BudgetExhausted(RuntimeError):
    pass


def _key():
    k = os.environ.get("CBBD_API_KEY")
    if k:
        return k.strip()
    with open(os.path.expanduser("~/.config/wce/cbbd.key")) as fh:
        return fh.read().strip()


def _month():
    return dt.date.today().strftime("%Y-%m")


def _spend(path):
    """Count one call, or refuse it. A call is counted before it is made: a call that dies on
    the way still used quota, and a miscount must err toward stopping early."""
    os.makedirs(HOME, exist_ok=True)
    with open(LEDGER, "a+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        fh.seek(0)
        raw = fh.read()
        d = json.loads(raw) if raw.strip() else {}
        m = d.setdefault(_month(), {"calls": 0, "seed": 0, "log": []})
        if m["calls"] + m.get("seed", 0) >= MONTHLY_CAP:
            raise BudgetExhausted(f"CBBD budget reached: {m['calls'] + m.get('seed', 0)} of {MONTHLY_CAP} this month")
        if m.get("meter_left") is not None and m["meter_left"] <= TIER - MONTHLY_CAP:
            raise BudgetExhausted(f"CBBD's own meter says {m['meter_left']} left of {TIER}: the cap counts every machine")
        m["calls"] += 1
        m["log"].append([dt.datetime.now().isoformat(timespec="seconds"), path])
        m["log"] = m["log"][-400:]
        fh.seek(0)
        fh.truncate()
        json.dump(d, fh)
    return d[_month()]["calls"] + d[_month()].get("seed", 0)


def _note_meter(left):
    """The Mac and the cloud keep separate ledgers and share one quota; CBBD's meter sees both."""
    if not (left and left.isdigit()):
        return
    with open(LEDGER, "r+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        d = json.load(fh)
        d.setdefault(_month(), {"calls": 0, "seed": 0, "log": []})["meter_left"] = int(left)
        fh.seek(0)
        fh.truncate()
        json.dump(d, fh)


def calls_this_month():
    try:
        m = json.load(open(LEDGER)).get(_month()) or {}
    except (OSError, ValueError):
        return 0
    return m.get("calls", 0) + m.get("seed", 0)


def seed(n):
    """Record calls made before this ledger existed (two in testing on Nov 2, 2026)."""
    os.makedirs(HOME, exist_ok=True)
    d = {}
    if os.path.exists(LEDGER):
        d = json.load(open(LEDGER))
    d.setdefault(_month(), {"calls": 0, "seed": 0, "log": []})["seed"] = n
    json.dump(d, open(LEDGER, "w"))


def get(path, timeout=240, **params):
    """GET one path. Returns (parsed JSON, calls left on CBBD's own meter or None)."""
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url = f"{BASE}{path}" + (f"?{q}" if q else "")
    _spend(path + (f"?{q}" if q else ""))
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {_key()}", "Accept": "application/json",
                                               "User-Agent": "wcehoops.com College Basketball Savant"})
    last = None
    for i in range(2):              # one retry: both are counted only if the first never returned
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                left = r.headers.get("X-CallLimit-Remaining")
                _note_meter(left)
                return json.loads(r.read().decode("utf8", "replace"), strict=False), (int(left) if left and left.isdigit() else None)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"CBBD {path}: HTTP {e.code}") from None
        except OSError as e:
            last = e
            time.sleep(3)
            if i == 0:
                _spend(path + " (retry)")
    raise RuntimeError(f"CBBD {path}: {type(last).__name__}")
