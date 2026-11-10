"""Step 4. CollegeFootballData (CFBD) client for the research run: counted, capped, cached.

    python -m pipeline.cfb.cfbd check          # ONE call; prints the calls left this month
    python -m pipeline.cfb.cfbd pull           # the research pulls (see PLAN)
    python -m pipeline.cfb.cfbd ledger         # what this run has spent

Rules (PROMPT-1 ground rule 5):
  * the key is College Basketball Savant's (same account, same 1,000-call month);
    it is read from CFBD_API_KEY or ~/.config/wce/cbbd.key and is never printed,
    logged or written anywhere;
  * this run may make at most RUN_CAP = 60 calls, every one is written to the
    ledger BEFORE it is made, and the run stops if CFBD's own meter
    (X-CallLimit-Remaining) drops below FLOOR = 300;
  * every response is cached, so a rerun costs nothing;
  * CFBD rows are inputs only. They live outside the repo and are never served.
"""
import os
import ssl
import sys
import json
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from .paths import RAW, HOME

BASE = "https://api.collegefootballdata.com"
RUN_CAP = 60
FLOOR = 300
LEDGER = HOME / "cfbd-ledger.json"
CACHE = RAW / "cfbd"
CACHE.mkdir(parents=True, exist_ok=True)


try:                                   # python.org builds on the Mac ship without a CA bundle
    import certifi
    _CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:                    # the cloud runner has system certificates
    _CTX = ssl.create_default_context()


class BudgetExhausted(RuntimeError):
    pass


def _key():
    k = os.environ.get("CFBD_API_KEY")
    if not k:
        p = os.path.expanduser("~/.config/wce/cbbd.key")
        with open(p) as f:
            k = f.read().strip()
    return k


def _ledger():
    if LEDGER.exists():
        return json.loads(LEDGER.read_text())
    return {"calls": 0, "log": [], "meter_left": None}


def _save(led):
    tmp = LEDGER.with_suffix(".tmp")
    tmp.write_text(json.dumps(led, indent=1))
    os.replace(tmp, LEDGER)


def _cache_path(path, params):
    q = "_".join(f"{k}-{v}" for k, v in sorted(params.items()))
    return CACHE / (path.strip("/").replace("/", "_") + ("__" + q if q else "") + ".json")


def get(path, **params):
    """GET one CFBD path. Cached responses cost nothing. Returns parsed JSON."""
    params = {k: v for k, v in params.items() if v is not None}
    cp = _cache_path(path, params)
    if cp.exists():
        return json.loads(cp.read_text())
    led = _ledger()
    if led["calls"] >= RUN_CAP:
        raise BudgetExhausted(f"run cap of {RUN_CAP} CFBD calls reached")
    if led.get("meter_left") is not None and led["meter_left"] < FLOOR:
        raise BudgetExhausted(f"CFBD meter at {led['meter_left']}, below the floor of {FLOOR}")
    q = urllib.parse.urlencode(params)
    url = f"{BASE}{path}" + (f"?{q}" if q else "")
    led["calls"] += 1
    led["log"].append([datetime.now(timezone.utc).isoformat(timespec="seconds"), path + (f"?{q}" if q else "")])
    _save(led)                                   # counted before it is made
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {_key()}", "Accept": "application/json",
                                               "User-Agent": "wcehoops.com College Football Savant research"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120, context=_CTX) as r:
            left = r.headers.get("X-CallLimit-Remaining")
            body = r.read().decode("utf8", "replace")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"CFBD {path}: HTTP {e.code}") from None      # never echo the request (it holds the key)
    except OSError as e:                     # TLS or network: the call is still counted, to stay on the safe side
        raise RuntimeError(f"CFBD {path}: {type(e).__name__}") from None
    led = _ledger()
    if left and left.isdigit():
        led["meter_left"] = int(left)
    led["log"][-1] += [round(time.time() - t0, 2), led.get("meter_left")]
    _save(led)
    data = json.loads(body, strict=False)
    cp.write_text(json.dumps(data))
    return data


def check():
    d = get("/teams/fbs", year=2024)
    led = _ledger()
    print("key works; teams returned:", len(d), "| calls left on CFBD's meter:", led["meter_left"],
          "| this run has used", led["calls"], "of", RUN_CAP)
    print("fields:", sorted(d[0].keys()))


def pull():
    """Only what the backtest needs and the release files do not already hold.

    Measured on the first run (Nov 10 2026): the shared meter stood at 462, and College
    Basketball Savant's own guard refuses once it reads 400 or less. Every call made here
    comes straight out of the live basketball product's headroom for the month, so the
    ~51 calls the prompt allowed for were cut to the two that could not be avoided:
      * /teams/fbs 2024    - the key check; also verifies the release files' conference table
      * /talent 2024       - verifies what the release file `cfb_team_talent` actually holds
    Everything else the prompt listed is already in the keyless release files: conferences
    by season (cfb_team_info), team talent (cfb_team_talent), returning production
    (cfb_returning_production, plus our own from rosters) and the weekly CFP committee
    rankings (cfb_poll_analytics). See cfbd_verify.py for the comparisons.
    """
    plan = [("/talent", dict(year=2024))]
    for path, params in plan:
        d = get(path, **params)
        led = _ledger()
        print(path, params, "rows", len(d), "| meter", led["meter_left"], "| run calls", led["calls"], flush=True)
        if led["meter_left"] is not None and led["meter_left"] < FLOOR:
            print("STOP: meter below floor")
            break


def ledger():
    led = _ledger()
    print("calls this run:", led["calls"], "| CFBD meter left:", led["meter_left"])
    for row in led["log"]:
        print(" ", row)


if __name__ == "__main__":
    {"check": check, "pull": pull, "ledger": ledger}[sys.argv[1]]()
