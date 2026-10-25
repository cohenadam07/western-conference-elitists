"""Offline-ish check of slate_watch: replays the night of Apr 12, 2026 (real scoreboard, fake clock)."""
import datetime as real_dt, json, os
import slate_watch as W


class FakeDT(real_dt.datetime):
    NOW = real_dt.datetime(2026, 4, 13, 1, 30, tzinfo=W.ET)   # 1:30am ET: also checks Apr 12

    @classmethod
    def now(cls, tz=None):
        return cls.NOW.astimezone(tz) if tz else cls.NOW


class FakeModule:
    datetime = FakeDT
    timedelta = real_dt.timedelta
    timezone = real_dt.timezone
    date = real_dt.date


W.dt = FakeModule
W.STATE = "/tmp/slate-test.json"
GI = os.path.join("out", "games_in.json")
if os.path.exists(W.STATE):
    os.remove(W.STATE)

assert W.check() == 0, "finals just seen are not ready yet"
s = json.load(open(W.STATE))
n = len(s["finals"])
print("finals seen:", n)
FakeDT.NOW = FakeDT.NOW + real_dt.timedelta(minutes=31)
assert W.check() == 10, "31 minutes later a refresh is due"
os.makedirs("out", exist_ok=True)
json.dump(sorted(s["finals"])[:10], open(GI, "w"))      # the dashboards have 10 of them
W.mark()
s = json.load(open(W.STATE))
assert len(s["done"]) == 10 and all(v == 1 for v in s["tries"].values()), s
assert W.check() == 10, "the rest are still pending"
json.dump(sorted(s["finals"]), open(GI, "w"))
W.mark()
assert W.check() == 0, "all published, nothing due"
os.remove(GI)
os.remove(W.STATE)
print("slate_watch: ok")
