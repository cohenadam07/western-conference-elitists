"""shoot.py — open College Football Savant in Chromium at desktop and phone width, walk every view, and report
console errors, horizontal page scroll, small tap targets and percentile panels that do not name their pool.
Saves screenshots to ~/College-Football-Savant/shots. Serve public/ first: python3 tools/savant-cfb/serve.py

    python3 tools/savant-cfb/shoot.py [base url]        # default http://127.0.0.1:8791
"""
import json, os, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8791"
OUT = os.path.expanduser("~/College-Football-Savant/shots")
os.makedirs(OUT, exist_ok=True)
PROBE = """()=>{const de=document.documentElement;const small=[...document.querySelectorAll('main button, main select, .tabs a, .srch input, #season')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.height<40)}).length;
const pools=[...document.querySelectorAll('.bar .n')].length, lines=[...document.querySelectorAll('.poolline')].map(e=>e.textContent).join(' ');
return {scroll:de.scrollWidth-de.clientWidth,h:(document.querySelector('main h2')||{}).textContent,small,bars:pools,pool:/vs |Ranked against|Percentiles|Savant value/.test(lines)||pools===0,empty:!!document.querySelector('main .empty'),broken:[...document.images].filter(i=>i.complete&&i.naturalWidth===0&&i.offsetParent).length}}"""
def run(p, name, w, h, mobile, reduced=False):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile, reduced_motion="reduce" if reduced else "no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:300]))
    pg.on("console", lambda m: errs.append("console: " + m.text[:300]) if m.type == "error" and "espncdn" not in m.text and "Failed to load resource" not in m.text else None)
    pg.goto(BASE + "/college-football-savant.html", wait_until="networkidle")
    pg.wait_for_selector("main h2", timeout=20000)
    ids = pg.evaluate("""async()=>{const ix=await (await fetch('/cfb/index.json')).json();const d=await (await fetch('/cfb/s/'+ix.current+'.json')).json();const q=d.players.filter(p=>p[7]);const pick=s=>q.filter(p=>p[3]===s)[3];return {qb:pick('QB')[0],wr:pick('WR')[0],lb:pick('LB')[0],k:pick('K')[0],team:pick('QB')[2]}}""")
    old = pg.evaluate("""async()=>{const d=await (await fetch('/cfb/s/2019.json')).json();const q=d.players.filter(p=>p[7]&&p[3]==='EDGE');return q[5][0]}""")
    early = pg.evaluate("""async()=>{const d=await (await fetch('/cfb/s/2010.json')).json();const q=d.players.filter(p=>p[7]&&p[3]==='LB');return q[2][0]}""")
    views = [("home", "#home"), ("player-qb", f"#player-{ids['qb']}"), ("player-wr", f"#player-{ids['wr']}"), ("player-lb", f"#player-{ids['lb']}"), ("player-k", f"#player-{ids['k']}"),
             ("player-2019-edge", f"#player-{old}/2019"), ("team", f"#team-{ids['team']}"), ("teams", "#teams"), ("playoff", "#playoff"), ("playoff-2019", "#playoff/2019"),
             ("all-savant", "#all-savant"), ("all-savant-2016", "#all-savant/2016"), ("leaders", "#leaders"),
             ("player-2010-lb", f"#player-{early}/2010"), ("playoff-2011", "#playoff/2011"), ("all-savant-2010", "#all-savant/2010")]
    res, bad = {}, []
    for label, h_ in views:
        pg.evaluate(f"location.hash='{h_}'")
        pg.wait_for_timeout(1500)
        o = pg.evaluate(PROBE)
        res[label] = o
        if o["scroll"] > 1: bad.append(f"{label}: page scrolls sideways by {o['scroll']}px")
        if o["empty"]: bad.append(f"{label}: empty view")
        if o["small"]: bad.append(f"{label}: {o['small']} controls under 40px tall")
        if not o["pool"]: bad.append(f"{label}: bars without a pool line")
        if o["broken"]: bad.append(f"{label}: {o['broken']} broken images")
        pg.screenshot(path=os.path.join(OUT, f"{name}-{label}.png"), full_page=True)
    if reduced:
        t = pg.evaluate("()=>[...document.querySelectorAll('[data-tilt],.tl,.tr,.tl2,.tr2')].filter(e=>getComputedStyle(e).transform!=='none').length")
        if t: bad.append(f"reduced motion: {t} elements still rotated")
    print(name, json.dumps({k: [v["h"], v["bars"]] for k, v in res.items()})[:1200]); print("  errors:", errs[:8]); print("  problems:", bad)
    b.close()
    return len(errs) + len(bad)
with sync_playwright() as p:
    n = run(p, "desk", 1440, 900, False) + run(p, "phone", 375, 812, True) + run(p, "phone-reduced", 375, 812, True, True)
sys.exit(1 if n else 0)
