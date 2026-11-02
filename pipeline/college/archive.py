"""
archive.py — rung 0. A month's raw ESPN responses as one bundle, so a cutoff never erases what we
have. `release` uploads it as the GitHub release asset cbb-raw-YYYY-MM (never committed to git).
Only ESPN's responses: CBBD's files are inputs we may not redistribute, so they stay out.

    python3 archive.py pack 2026-11          -> <home>/archive/cbb-raw-2026-11.tar
    python3 archive.py verify 2026-11        every member decompresses and parses; prints the count
    python3 archive.py release 2026-11       gh release create (the monthly workflow runs this)
"""
import gzip, json, os, subprocess, sys, tarfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import espn_cbb as E  # noqa: E402

DIR = os.path.join(CC.HOME, "archive")


def path(month):
    return os.path.join(DIR, f"cbb-raw-{month}.tar")


def season_of(month):
    y, m = int(month[:4]), int(month[5:7])
    return E.season_label(y + (1 if m >= 8 else 0))


def pack(month):
    os.makedirs(DIR, exist_ok=True)
    s = season_of(month)
    seen = json.load(open(os.path.join(E.ROOT, s, "days.json")))
    n = 0
    with tarfile.open(path(month), "w") as t:
        for d, evs in sorted(seen.items()):
            if d.startswith(month):
                for e in evs:
                    p = E.raw_path(s, e["id"])
                    if os.path.exists(p):
                        t.add(p, arcname=f"{s}/{e['id']}.json.gz")
                        n += 1
    print(month, n, "games", os.path.getsize(path(month)) // 1024, "KB")
    return n


def verify(month):
    n = 0
    with tarfile.open(path(month)) as t:
        for m in t.getmembers():
            d = E.loads(gzip.decompress(t.extractfile(m).read()))
            assert "header" in d or "boxscore" in d, m.name
            n += 1
    print("verified", n)
    return n


def release(month):
    tag = f"cbb-raw-{month}"
    r = subprocess.run(["gh", "release", "view", tag], capture_output=True)
    if r.returncode:
        subprocess.run(["gh", "release", "create", tag, "--title", tag, "--notes", "College Basketball Savant: raw ESPN archive, one month."], check=True)
    subprocess.run(["gh", "release", "upload", tag, path(month), "--clobber"], check=True)


if __name__ == "__main__":
    {"pack": pack, "verify": verify, "release": release}[sys.argv[1]](sys.argv[2])
