"""heads.py — which ESPN college headshots exist. Each URL is asked once (HEAD), the answer kept in
<home>/heads.json. A missing photo shows the initials badge in team colors, never a broken image.

    python3 heads.py 2022-23 2023-24 ...
"""
import concurrent.futures as cf, json, os, sys, urllib.error, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cbbd_client as CC  # noqa: E402
import espn_cbb as E  # noqa: E402

URL = "https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/{}.png"
PATH = os.path.join(CC.HOME, "heads.json")


def ask(e):
    try:
        req = urllib.request.Request(URL.format(e), method="HEAD", headers=E.UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            return e, int(r.status == 200)
    except urllib.error.HTTPError as x:
        return e, 0 if x.code in (403, 404) else None
    except Exception:  # noqa
        return e, None


def main(seasons):
    have = json.load(open(PATH)) if os.path.exists(PATH) else {}
    want = set()
    for s in seasons:
        p = os.path.join(CC.HOME, "identity", f"{s}.json")
        if os.path.exists(p):
            want |= set(json.load(open(p)))
    todo = sorted(want - set(have))
    with cf.ThreadPoolExecutor(E.WORKERS) as ex:
        for e, v in ex.map(ask, todo):
            if v is not None:
                have[e] = v
    json.dump(have, open(PATH, "w"), separators=(",", ":"))
    print(len(todo), "asked;", sum(have.values()), "of", len(have), "have a photo")


if __name__ == "__main__":
    main(sys.argv[1:])
