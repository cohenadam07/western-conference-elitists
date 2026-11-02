"""deploy_batch.py — puts the data bots' commits on the live site a few times a day
(.github/workflows/deploy-batch.yml).

Vercel skips the bots' commits (scripts/vercel-ignore.sh): each deployment is about 280 MB and
they made about 20 a day, which took Deployment Storage to 22 GB of the Hobby plan's 10 GB.
This job ships what they've committed with one empty "deploy:" commit, which Vercel builds.

It deploys when data is waiting and
  - the live site's last build is at least GAP_H hours old, outside QUIET hours (ET), or
  - an injury update is waiting during an NFL game window (ET), when lineups are set, or
  - someone asked by hand (workflow_dispatch).
Otherwise it waits for a later run. It runs every 30 minutes and right after each data bot
finishes. Replayed over Oct 29 – Nov 2, 2026, this took the site from 18.4 deploys a day to
7.7 (code changes included); data waited about 2 hours on the median, and the night's late
games went out together at 6am.

"Waiting" is read from git alone: walking main back from the tip, the bots' commits are waiting
until the first commit Vercel builds (anyone else's, or a deploy commit). Code changes still
deploy the moment they land, and take every waiting data commit with them.

Writes deploy-batch.txt (the Control Room check-in detail) and sets the step output
deployed=yes|no. DRY_RUN=1 decides and prints without committing.
"""
import datetime as dt
import os
import subprocess
import sys
import time
from collections import Counter
from zoneinfo import ZoneInfo

# Keep in step with BOTS in scripts/vercel-ignore.sh.
BOTS = {"bot@wcehoops.com", "actions@users.noreply.github.com"}
GAP_H = 4
QUIET = (1, 6)   # no batch deploys from 1am to 6am ET: nobody is reading, and the 5:41am rebuild lands just before
ET = ZoneInfo("America/New_York")
INJURY = "Football Savant: injury status"
DEPLOYER = ("wce-deploy-bot", "deploy@wcehoops.com")

# Short names for the summary line, by the start of the bots' commit messages.
KINDS = [
    ("Basketball Savant: refresh", "Basketball Savant"),
    ("Basketball Savant: heartbeat", "Basketball Savant"),
    ("Basketball Savant: history", "Basketball Savant history"),
    ("Basketball Savant: weekly", "weekly snapshot"),
    ("Football Savant: injury", "injuries"),
    ("Football Savant: refresh", "Football Savant"),
    ("Football Savant: full archive", "Football Savant archive"),
    ("UFC Savant", "UFC Savant"),
    ("news:", "news"),
]


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def waiting(ref="origin/main", depth=120):
    """The bots' commits since the last commit Vercel built, newest first, and that commit."""
    out = git("log", "--first-parent", f"-n{depth}", "--format=%H%x1f%ae%x1f%ct%x1f%s%x1e", ref)
    pending = []
    for rec in out.split("\x1e"):
        rec = rec.strip()
        if not rec:
            continue
        sha, email, ct, subject = rec.split("\x1f", 3)
        c = {"sha": sha, "email": email.lower(), "t": int(ct), "subject": subject}
        if c["email"] in BOTS and "[deploy]" not in subject:
            pending.append(c)
        else:
            return pending, c
    return pending, None   # no build in the last `depth` commits: treat it as long ago


def nfl_window(now):
    """Kickoff windows, ET: Sunday 9am–8:30pm, Monday and Thursday 5–8:30pm, and Saturdays
    in December and January (late-season games)."""
    hm = now.hour + now.minute / 60
    wd = now.weekday()   # Monday 0
    if wd == 6:
        return 9 <= hm < 20.5
    if wd in (0, 3):
        return 17 <= hm < 20.5
    if wd == 5 and now.month in (12, 1):
        return 12 <= hm < 20.5
    return False


def kind(subject):
    for prefix, name in KINDS:
        if subject.startswith(prefix):
            return name
    return "data"


def summary(pending):
    n = Counter(kind(c["subject"]) for c in pending)
    parts = [f"{k} ×{v}" if v > 1 else k for k, v in n.most_common()]
    noun = "update" if len(pending) == 1 else "updates"
    return f"{len(pending)} data {noun} ({', '.join(parts)})"


def decide(pending, last, now_ts, force=False):
    """(deploy?, reason)."""
    if not pending:
        return False, "nothing waiting"
    if force:
        return True, "asked by hand"
    since = (now_ts - last["t"]) / 3600 if last else float("inf")
    now = dt.datetime.fromtimestamp(now_ts, ET)
    if any(c["subject"].startswith(INJURY) for c in pending) and nfl_window(now):
        return True, "injury news during an NFL game window"
    if QUIET[0] <= now.hour < QUIET[1]:
        return False, f"holding {len(pending)} through the night (batches resume at {QUIET[1]}am ET)"
    if since >= GAP_H:
        return True, f"last build {since:.1f}h ago" if last else "no recent build found"
    due = dt.datetime.fromtimestamp(last["t"] + GAP_H * 3600, ET)
    return False, f"holding {len(pending)} (last build {since * 60:.0f} min ago; next batch from {due:%-I:%M %p} ET)"


def output(key, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as f:
            f.write(f"{key}={value}\n")


def main():
    dry = os.environ.get("DRY_RUN") == "1"
    force = os.environ.get("FORCE") == "true"
    output("deployed", "no")
    for attempt in range(1, 4):
        if not dry:
            git("fetch", "-q", "--depth=120", "origin", "main")
        pending, last = waiting()
        go, reason = decide(pending, last, time.time(), force)
        print(f"{'deploy' if go else 'wait'}: {reason}")
        for c in pending[:20]:
            print(f"  waiting since {dt.datetime.fromtimestamp(c['t'], ET):%a %-I:%M %p}  {c['subject']}")
        if not go or dry:
            return 0
        line = summary(pending)
        body = "\n".join(f"- {c['subject']}" for c in reversed(pending[:40]))
        if len(pending) > 40:
            body += f"\n- … and {len(pending) - 40} more"
        git("reset", "-q", "--hard", "origin/main")
        git("-c", f"user.name={DEPLOYER[0]}", "-c", f"user.email={DEPLOYER[1]}",
            "commit", "-q", "--allow-empty", "-m", f"deploy: {line}",
            "-m", f"Ships the data waiting since the last build ({reason}).\n\n{body}")
        r = subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], capture_output=True, text=True)
        if r.returncode == 0:
            print(f"pushed: deploy: {line}")
            with open("deploy-batch.txt", "w") as f:
                f.write(f"Deployed {line}; {reason}"[:290])
            output("deployed", "yes")
            return 0
        print(f"push rejected (attempt {attempt}): {r.stderr.strip()[:200]}; looking again")
    print("::error::couldn't push the deploy commit after 3 tries")
    with open("deploy-batch.txt", "w") as f:
        f.write("Couldn't push the deploy commit after 3 tries")
    return 1


if __name__ == "__main__":
    sys.exit(main())
