"""BUILD step 14's check: a refresh of the season being played is byte-identical to the full build.

    python -m pipeline.cfb.refresh_check

1. The full build's current season, as the Mac makes it: `build refresh` against ~/College-Football-Savant
   (every past season's tables on disk), into public/cfb.
2. A clean room, as the cloud has it: a new CFB_HOME holding only the ESPN response cache (nothing from
   history), the committed state in pipeline/cfb/state, and a copy of public/cfb's index. CFB_OFFLINE=1
   makes it read exactly the responses step 1 saw. Output goes to a temp folder (CFB_PUB).
3. Every current-season file and index.json is compared byte for byte.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from .paths import HOME, REPO
from . import config as C


def files(root):
    y = str(C.CURRENT)
    out = {"index.json.gz"}
    for sub in ("s", "teams", "allsavant", "playoff", "games"):
        out.add(f"{sub}/{y}.json.gz")
    out |= {f"t/{y}/{p.name}" for p in (root / "t" / y).glob("*.json.gz")}
    return out


def main():
    py = sys.executable
    env = dict(os.environ)
    r = subprocess.run([py, "-m", "pipeline.cfb.build", "refresh"], cwd=REPO, env=env)
    if r.returncode:
        raise SystemExit("the full build's refresh failed")
    pub = REPO / "public" / "cfb"
    with tempfile.TemporaryDirectory(dir=HOME) as tmp:
        tmp = Path(tmp)
        home, out = tmp / "home", tmp / "pub"
        (home / "raw").mkdir(parents=True)
        shutil.copytree(HOME / "raw" / "espn_live", home / "raw" / "espn_live")
        out.mkdir()
        shutil.copy(pub / "index.json.gz", out / "index.json.gz")
        env2 = dict(env, CFB_HOME=str(home), CFB_PUB=str(out), CFB_OFFLINE="1")
        r = subprocess.run([py, "-m", "pipeline.cfb.build", "refresh"], cwd=REPO, env=env2)
        if r.returncode:
            raise SystemExit("the clean-room refresh failed")
        a, b = files(pub), files(out)
        same = sorted(f for f in a & b if (pub / f).read_bytes() == (out / f).read_bytes())
        diff = sorted(f for f in a & b if f not in same)
        print(f"files compared: {len(a & b)}; byte-identical: {len(same)}; different: {len(diff)}; "
              f"only in the full build: {len(a - b)}; only in the clean room: {len(b - a)}")
        for f in (diff + sorted(a ^ b))[:10]:
            print("  !!", f)
        if diff or a ^ b:
            raise SystemExit(1)
        print("a refresh of", C.CURRENT, "is byte-identical to the full build")


if __name__ == "__main__":
    main()
