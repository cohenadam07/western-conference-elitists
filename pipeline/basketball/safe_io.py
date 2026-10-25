"""
safe_io.py — resilient writes for this iCloud-synced project dir.

40MB writes here intermittently fail with Errno 60 (Operation timed out) while the macOS
`bird` iCloud daemon is syncing. dump_json / write_text write to a temp file then os.replace
(atomic — never leaves a truncated file), retrying and freeing the daemon between attempts.
"""
import json, os, time, subprocess

def _atomic_write(path, body, retries=6):
    tmp = path + ".tmp"
    for attempt in range(retries):
        try:
            with open(tmp, "w") as fh:
                fh.write(body)
            os.replace(tmp, path)
            return
        except OSError as e:
            print(f"    [safe_io] write {path} failed ({e}); killall bird, retry {attempt+1}/{retries}", flush=True)
            subprocess.run(["killall", "bird"], stderr=subprocess.DEVNULL)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"could not write {path} after {retries} retries")

def dump_json(path, obj):
    _atomic_write(path, json.dumps(obj, separators=(",", ":")))

def write_text(path, text):
    _atomic_write(path, text)
