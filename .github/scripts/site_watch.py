"""site_watch.py — the Control Room's eyes on the live site (.github/workflows/site-watch.yml).

Loads the homepage and a Savant page, asks the AI connector for its tool list, and reads the
latest production deploy from the Control Room's feed. Writes one line saying what it found to
site-watch.txt (the check-in's detail) and exits 1 if anything is wrong, so the check-in reports
a failure and the feed pushes it to Adam's phone (once per streak).

Standard library only. Reads the deploys with GitHub's signed identity token (or WCE_STATUS_KEY).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

SITE = "https://wcehoops.com"
UA = "WCE-site-watch/1.0 (+https://wcehoops.com)"


def fetch(url, data=None, headers=None, timeout=20):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(400_000), round((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, b"", round((time.time() - t0) * 1000)
    except Exception as e:  # timeout, DNS, TLS
        return None, str(e).encode()[:200], round((time.time() - t0) * 1000)


problems, notes = [], []

code, body, ms = fetch(SITE + "/")
if code != 200 or b"<html" not in body.lower():
    problems.append(f"homepage answered {code}")
else:
    notes.append(f"home {ms}ms")

code, body, ms = fetch(SITE + "/basketball-savant.html")
if code != 200:
    problems.append(f"Basketball Savant page answered {code}")
else:
    notes.append(f"savant {ms}ms")

rpc = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode()
code, body, ms = fetch(SITE + "/api/mcp", data=rpc, headers={
    "Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
try:
    tools = len(json.loads(body)["result"]["tools"]) if code == 200 else 0
except Exception:
    tools = 0
if not tools:
    problems.append(f"AI connector answered {code} with no tools")
else:
    notes.append(f"connector {tools} tools {ms}ms")

def identity():
    """The feed's key, or GitHub's signed token for this run (needs `id-token: write`)."""
    if os.environ.get("WCE_STATUS_KEY"):
        return os.environ["WCE_STATUS_KEY"]
    url, tok = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not (url and tok):
        return None
    code, body, _ = fetch(url + "&audience=wcehoops-status", headers={"Authorization": f"bearer {tok}"})
    try:
        return json.loads(body)["value"] if code == 200 else None
    except Exception:
        return None


auth = identity()
if auth:
    # No `key` in the address: an uncached read, so the deploy state is the current one.
    code, body, ms = fetch(f"{SITE}/api/status?part=jobs&fresh=1", headers={"Authorization": f"Bearer {auth}"})
    if code != 200:
        problems.append(f"status feed answered {code}")
    else:
        try:
            deploys = (json.loads(body).get("deploys") or {}).get("list") or []
            prod = [d for d in deploys if d.get("target") == "production"]
            if prod and prod[0].get("state") == "ERROR":
                msg = prod[0].get("message") or prod[0].get("sha") or ""
                problems.append(f"latest deploy failed ({msg[:80]})")
            elif prod:
                notes.append(f"deploy {prod[0].get('state', '?').lower()}")
        except Exception as e:
            problems.append(f"status feed unreadable: {e}")

line = ("Trouble: " + "; ".join(problems)) if problems else ("All good: " + ", ".join(notes))
print(line)
with open("site-watch.txt", "w") as f:
    f.write(line[:290])
sys.exit(1 if problems else 0)
