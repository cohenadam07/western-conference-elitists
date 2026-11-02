"""shoot.py — open the page in Chromium at desktop and phone, walk every view, report console errors,
horizontal page scroll and tap-target sizes, save screenshots. Usage: python3 shoot.py [base url]"""
import json, os, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173"
OUT = os.path.expanduser("~/Basketball-Savant/out/cbb/shots")
os.makedirs(OUT, exist_ok=True)
def run(p, name, w, h, mobile):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:200]))
    pg.on("console", lambda m: errs.append("console: " + m.text[:200]) if m.type == "error" and "espncdn" not in m.text and "404" not in m.text else None)
    pg.goto(BASE + "/college-basketball-savant.html", wait_until="networkidle")
    pg.wait_for_selector("h1")
    pid = pg.evaluate("""async()=>{const d=await (await fetch('/cbb/s/'+(await (await fetch('/cbb/index.json')).json()).default_season+'.json')).json();const a=d.players.filter(p=>p[11]);return [a[0][0],a[0][2],a[200][0]];}""")
    views = [("home", "#home"), ("player", f"#player-{pid[0]}"), ("player2", f"#player-{pid[2]}"), ("team", f"#team-{pid[1]}"), ("teams", "#teams"), ("leaders", "#leaders"), ("compare", "#compare")]
    res = {}
    for label, h_ in views:
        pg.evaluate(f"location.hash='{h_}'")
        pg.wait_for_timeout(1400)
        o = pg.evaluate("""()=>({scroll:document.documentElement.scrollWidth-document.documentElement.clientWidth,h1:(document.querySelector('h1')||{}).textContent,sheet:Math.round(document.querySelector('.main').getBoundingClientRect().width),win:window.innerWidth,navpos:getComputedStyle(document.querySelector('.nav')).position,small:[...document.querySelectorAll('button,a,select,input')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<24}).length})""")
        res[label] = o
        if mobile:
            assert o["sheet"] >= o["win"] - 2, f"{label}: the sheet is {o['sheet']} wide on a {o['win']} screen"
            assert o["navpos"] == "fixed", "the phone nav is not the bottom bar"
        pg.screenshot(path=os.path.join(OUT, f"{name}-{label}.png"), full_page=label in ("player", "team"))
    print(name, json.dumps(res)[:900]); print(" errors:", errs[:6])
    b.close()
with sync_playwright() as p:
    run(p, "desk", 1440, 900, False)
    run(p, "phone", 390, 844, True)
