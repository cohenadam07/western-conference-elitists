"""netrank.py — the NCAA's NET, for Quad splits and a reference column. Through ncaa-api, one call.
NET only exists as the current table: from early December of a season it is captured each night
into ref/net-<season>.json; seasons before this build have only their final table where one could
still be read, and the rest say "not tracked". Written {ESPN team id: rank}, by school name."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "basketball"))
import cbbd_client as CC  # noqa: E402
import fallback as F  # noqa: E402
import season as SZ  # noqa: E402
from namematch import words  # noqa: E402


def key(s):
    return "".join(words(s.replace("St.", "State").replace("(", " ").replace(")", " ")))


def fetch(season):
    d = F.nget("/rankings/basketball-men/d1/ncaa-mens-basketball-net-rankings")
    ids = json.load(open(os.path.join(SZ.OUT, season, "ids.json")))["teams"]
    by = {}
    for t, v in ids.items():
        if v.get("conf"):
            by[key(v.get("loc") or "")] = t
    import pandas as pd
    from identity import jaro_winkler
    T = pd.read_pickle(os.path.join(SZ.OUT, season, "tg.pkl"))
    rec = {t: f"{int((g.pts > g.opp_pts).sum())}-{int((g.pts < g.opp_pts).sum())}" for t, g in T.groupby("team")}
    out, miss, later = {}, [], []
    for r in d.get("data", []):
        t = by.get(key(r["School"]))
        if t:
            out[t] = int(r["Rank"])
        else:
            later.append(r)
    # NCAA's short names ("ETSU", "Col. of Charleston"): same record, closest name, and unique
    left = {t: key(ids[t].get("loc") or "") for t in by.values() if t not in out}
    for r in later:
        c = [(jaro_winkler(key(r["School"]), n), t) for t, n in left.items() if rec.get(t) == r["Record"]]
        c.sort(reverse=True)
        if c and (c[0][0] >= 0.6 or len(c) == 1):
            out[c[0][1]] = int(r["Rank"])
            left.pop(c[0][1])
        else:
            miss.append(r)
    # what's left has no record match: expand the NCAA's abbreviations and take the closest name
    ABB = {"Fla.": "Florida", "Ky.": "Kentucky", "Tenn.": "Tennessee", "Colo.": "Colorado", "Ill.": "Illinois", "Ark.": "Arkansas", "Ga.": "Georgia", "Ala.": "Alabama", "Mich.": "Michigan", "Ind.": "Indiana", "Caro.": "Carolina", "Conn.": "Connecticut", "Okla.": "Oklahoma", "Col. of": "College of", "Pa.": "Pennsylvania", "Wash.": "Washington", "Ariz.": "Arizona", "Miss.": "Mississippi"}
    ALIAS = {"UNI": "Northern Iowa", "SFA": "Stephen F. Austin", "UNCW": "UNC Wilmington", "UTRGV": "UT Rio Grande Valley", "Penn": "Pennsylvania", "CSUN": "Cal State Northridge", "Southern California": "USC", "LMU (CA)": "Loyola Marymount", "Saint Mary's (CA)": "Saint Mary's", "St. Thomas (MN)": "St. Thomas-Minnesota", "Col. of Charleston": "Charleston", "A&M-Corpus Christi": "Texas A&M-Corpus Christi", "FIU": "Florida International", "SIUE": "SIU Edwardsville", "N.C. A&T": "North Carolina A&T", "UIW": "Incarnate Word", "Southeastern La.": "SE Louisiana", "USC Upstate": "South Carolina Upstate", "IU Indy": "IU Indianapolis", "CSU Bakersfield": "Cal State Bakersfield", "FDU": "Fairleigh Dickinson", "NIU": "Northern Illinois", "N.C. Central": "North Carolina Central", "UMES": "Maryland Eastern Shore"}
    still = []
    for r in miss:
        nm = ALIAS.get(r["School"], r["School"])
        for a, b in ABB.items():
            nm = nm.replace(a, b)
        c = sorted(((jaro_winkler(key(nm), n), t) for t, n in left.items()), reverse=True)
        if c and c[0][0] >= 0.86:
            out[c[0][1]] = int(r["Rank"])
            left.pop(c[0][1])
        else:
            still.append(r["School"])
    miss = still
    json.dump(out, open(os.path.join(CC.HOME, "ref", f"net-{season}.json"), "w"))
    print(season, d.get("updated"), len(out), "matched; unmatched:", miss[:20])


if __name__ == "__main__":
    fetch(sys.argv[1])
