"""
Fixture generator (NO network) — produces out/players.json in the exact shape
savant_engine.build() emits, plus out/metrics_config.json. Use it to develop and
wire up the page before live data exists. Replace with the real engine output later.

  python make_fixture.py
"""
import os, json, random, datetime as dt
import savant_config as C

random.seed(7)
OUT = C.OUT_DIR
WIN = list(C.WINDOWS.keys())

# per-metric synthetic generation: base mean, sd, [lo,hi], positional tilt, per-game sample basis
G = {
 "mpg":     dict(base=24, sd=7,   lo=8,  hi=38,  tilt={},                         pg=None),
 "ts":      dict(base=.560,sd=.040,lo=.46,hi=.68, tilt={},                        pg=13),
 "tp3":     dict(base=35.5,sd=4,  lo=25, hi=45,  tilt={"Guard":1,"Wing":1.5,"Big":-4}, pg=6),
 "tp2":     dict(base=52, sd=5,   lo=42, hi=66,  tilt={"Big":8},                  pg=8),
 "ft":      dict(base=78, sd=7,   lo=55, hi=92,  tilt={"Guard":4,"Big":-8},       pg=4),
 "fta":     dict(base=3.2,sd=2,   lo=.5, hi=9,   tilt={"Guard":1.5,"Big":1},      pg=70),
 "pts":     dict(base=16, sd=6,   lo=5,  hi=34,  tilt={"Guard":4},                pg=70),
 "ast":     dict(base=14, sd=8,   lo=4,  hi=42,  tilt={"Guard":14,"Big":-4},      pg=70),
 "tov":     dict(base=11.5,sd=3,  lo=6,  hi=20,  tilt={"Guard":1.5},              pg=70),
 "grav":    dict(base=1.2,sd=.6,  lo=.2, hi=3.0, tilt={"Guard":.4,"Wing":.3},     pg=220),
 "drv":     dict(base=9,  sd=5,   lo=1,  hi=22,  tilt={"Guard":6,"Big":-4},       pg=10),
 "selfcr":  dict(base=40, sd=18,  lo=8,  hi=85,  tilt={"Guard":20,"Big":-15},     pg=14),
 "syn":     dict(base=55, sd=22,  lo=8,  hi=97,  tilt={},                         pg=70),
 "rim":     dict(base=-2.0,sd=3,  lo=-8, hi=5,   tilt={"Big":-3,"Guard":3},       pg=3),
 "mtch":    dict(base=50, sd=20,  lo=10, hi=95,  tilt={"Wing":10,"Guard":8},      pg=30),
 "oppfg":   dict(base=-1.0,sd=2.5,lo=-6, hi=5,   tilt={},                         pg=5),
 "defl":    dict(base=2.2,sd=1,   lo=.5, hi=5,   tilt={"Guard":.6,"Wing":.5},     pg=70),
 "stl":     dict(base=1.4,sd=.6,  lo=.3, hi=3.2, tilt={"Guard":.5},               pg=70),
 "blk":     dict(base=.9, sd=.9,  lo=.1, hi=4,   tilt={"Big":1.8,"Guard":-.5},    pg=70),
 "dreb":    dict(base=14, sd=6,   lo=5,  hi=32,  tilt={"Big":10,"Guard":-4},      pg=70),
 "length":  dict(base=81, sd=3,   lo=74, hi=92,  tilt={"Big":5,"Guard":-3},       pg=None),
 "height":  dict(base=78, sd=3,   lo=72, hi=87,  tilt={"Big":5,"Guard":-3},       pg=None),
 "strength":dict(base=215,sd=22,  lo=175,hi=285, tilt={"Big":30,"Guard":-20},     pg=None),
 "reach":   dict(base=104,sd=4,   lo=96, hi=116, tilt={"Big":6,"Guard":-4},       pg=None),
 "lateral": dict(base=11.1,sd=.5, lo=10.2,hi=12.4,tilt={"Big":.5,"Guard":-.3},    pg=None),
 "vert":    dict(base=35, sd=4,   lo=26, hi=44,  tilt={"Guard":3,"Big":-3},       pg=None),
}
META = {m["key"]: m for m in C.METRICS}
WINDOWED = {m["key"] for m in C.METRICS if m["windowed"]}
COMBINE = {"length", "reach", "vert", "lateral"}  # ~static, missing for some vets

FIRST = "James Aaron Marcus Cole Darius Tyrese Malik Devin Jaylen Kai Obi Jonas Luka Nikola Bam Trae Cade Paolo Jalen Franz Alperen Desmond Keldon Naz Quentin Brandon Mikal Derrick Walker Isaiah Jamal Aaron Bruce Royce Grayson Dante Cody Gary Larry Pat Josh Max Tre Bones Immanuel Dyson Santi".split()
LAST = "Vance Reyes Osei Whitfield Brooks Holloway Carrington Adebayo Mensah Okafor Dvorak Petrov Larsson Mwangi Castellano Beaumont Ferreira Nakamura Sterling Albright Kowalski Ramos Delgado Underwood Fontaine Quill Hargrove Mladenovic Titus Sorensen Vaughn Ashby Calderon Eze Bauer Novak Pham Riddle Toomey Vasquez Wexler Ybarra Zito Croft Dunn Estrada".split()

def draw(key, pos):
    g = G[key]
    mean = g["base"] + g["tilt"].get(pos, 0)
    v = random.gauss(mean, g["sd"])
    return max(g["lo"], min(g["hi"], v))

def rnd(key, v):
    u = META[key]["unit"]
    if u == "pct3": return round(v, 3)
    if u in ("pct1","num1","sgn","sec","inch"): return round(v, 1)
    if u in ("num0","lb"): return int(round(v))
    if u == "ftin": return round(v)         # inches
    if u == "word": return round(v, 1)
    return round(v, 1)

def gen_player(i, pos):
    name = f"{random.choice(FIRST)} {random.choice(LAST)}"
    gp = random.randint(22, 80)
    base = {k: draw(k, pos) for k in G}
    mpg = base["mpg"]
    qualified = gp >= C.QUALIFY["min_gp"] and mpg >= C.QUALIFY["min_mpg"]
    has_combine = random.random() > 0.25     # ~25% of vets never measured
    m = {}
    for key in G:
        meta = META[key]
        if key in COMBINE and not has_combine:
            m[key] = {w: {"v": None, "n": None} for w in WIN}
            continue
        season_v = base[key]
        m[key] = {}
        for w in WIN:
            if key in WINDOWED and w != "season":
                if meta["unit"] == "sgn":
                    jit = {"l75":1.0,"l25":2.2,"l10":3.4}[w] * random.gauss(0, 0.5)
                    v = season_v + jit
                else:
                    fac = {"l75":.04,"l25":.08,"l10":.13}[w]
                    v = season_v * (1 + random.gauss(0, fac))
            else:
                v = season_v
            # sample size
            if G[key]["pg"] is None:
                n = None
            else:
                games = {"season": gp, "l75": min(75, gp), "l25": min(25, gp), "l10": min(10, gp)}[w]
                n = int(round(G[key]["pg"] * games))
            m[key][w] = {"v": rnd(key, v), "n": n}
    return dict(id=20000 + i, name=name, team=random.choice(["VOY","CON","MON","SEN","HAR","CAS","RID","FON"]),
                pos=pos, age=random.randint(19, 37), qualified=qualified, m=m)

def main():
    os.makedirs(OUT, exist_ok=True)
    roster = (["Guard"] * 62) + (["Wing"] * 56) + (["Big"] * 32)
    random.shuffle(roster)
    players = [gen_player(i, pos) for i, pos in enumerate(roster)]
    payload = dict(season=C.SEASON, generated=dt.datetime.now(dt.timezone.utc).isoformat(),
                   source="fixture", players=players)
    with open(os.path.join(OUT, "players.json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    cfg = dict(season=C.SEASON, windows=WIN, qualify=C.QUALIFY,
               metrics=[{k: mm[k] for k in ("key","label","group","sub","layer","unit","thr","lower")} for mm in C.METRICS])
    with open(os.path.join(OUT, "metrics_config.json"), "w") as f:
        json.dump(cfg, f, indent=2)
    print(f"wrote {OUT}/players.json ({len(players)} players) and {OUT}/metrics_config.json")

if __name__ == "__main__":
    main()
