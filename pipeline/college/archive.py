"""
archive.py — rung 0. A month's raw ESPN responses as one bundle, so a cutoff never erases what we
have. Private, by Adam's decision of Nov 2, 2026: bundles stay on this Mac under ~/Basketball-Savant
and are never uploaded. The repo is public, so a release asset would be a public copy of ESPN's raw
JSON. mac_pull.sh keeps the raw files current and packs the month on the 1st.

    python3 archive.py pack 2026-11          -> <home>/archive/cbb-raw-2026-11.tar
    python3 archive.py verify 2026-11        every member decompresses and parses; prints the count
"""
import gzip, json, os, sys, tarfile
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


if __name__ == "__main__":
    {"pack": pack, "verify": verify}[sys.argv[1]](sys.argv[2])
