"""allsavant_phone.py — the All-Savant view on phones (Adam, Nov 10 2026), in Chromium:

  at 375 and 390px: no sideways page scroll; the formation is chips, every chip a real button at least 44px tall
  with an aria-label of position, full name, school and value; the OL unit one wider chip; special teams a row of
  chips; tapping a chip opens the bottom sheet with focus inside it; the close button, Escape and the backdrop each
  close it and focus returns to the chip; Field / List toggle, and the choice survives a reload (localStorage);
  at 1440px: the view looks exactly as before (pixel-compared with the published page of the previous commit,
  passed as public/_before.html).

    python3 tools/savant-cfb/serve.py &  python3 tools/savant-cfb/allsavant_phone.py
"""
import os, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8791"
OUT = os.path.expanduser("~/College-Football-Savant/shots")
bad = []


def check(cond, msg):
    if not cond:
        bad.append(msg)


def phone(p, w):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": w, "height": 812}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    for hash_ in ("#all-savant", "#all-savant/2019"):
        pg.goto(BASE + "/college-football-savant.html" + hash_, wait_until="networkidle")
        pg.wait_for_selector(".asf .cp")
        o = pg.evaluate("""()=>{const de=document.documentElement;const cs=[...document.querySelectorAll('.as-ph .cp')];
          return {scroll:de.scrollWidth-de.clientWidth, n:cs.length, minH:Math.min(...cs.map(c=>c.getBoundingClientRect().height)),
          out:cs.filter(c=>{const r=c.getBoundingClientRect();return r.left<0||r.right>innerWidth}).length,
          wide:cs.filter(c=>c.classList.contains('w')).length, st:document.querySelectorAll('.ast-st .cp').length,
          labels:cs.every(c=>/, .+, .+Savant value [+−]?\\d/.test(c.getAttribute('aria-label')||'')||/^Offensive line unit, .+, Savant value/.test(c.getAttribute('aria-label')||'')),
          tags:cs.every(c=>c.tagName==='BUTTON'), field:getComputedStyle(document.querySelector('.fieldbox')).display}}""")
        check(o["scroll"] <= 0, f"{w}px {hash_}: page scrolls sideways by {o['scroll']}px")
        check(o["n"] == 23, f"{w}px {hash_}: {o['n']} chips, expected 23 (20 in formation + 3 special teams)")
        check(o["minH"] >= 44, f"{w}px {hash_}: a chip is {o['minH']:.0f}px tall")
        check(o["out"] == 0, f"{w}px {hash_}: {o['out']} chips off screen")
        check(o["wide"] == 1 and o["st"] == 3, f"{w}px {hash_}: OL chips {o['wide']}, special-teams chips {o['st']}")
        check(o["labels"] and o["tags"], f"{w}px {hash_}: a chip is not a labelled button")
        check(o["field"] == "none", f"{w}px: the desktop field is showing")
    pg.screenshot(path=os.path.join(OUT, f"as-phone-{w}.png"), full_page=True)
    # the sheet: open, then close three ways; focus goes in, then back
    for how in ("button", "escape", "backdrop"):
        chip = pg.locator(".asf .cp").nth(5)
        chip.click()
        pg.wait_for_selector("dialog#assheet[open]")
        f = pg.evaluate("()=>!!document.activeElement.closest('#assheet')")
        check(f, f"{w}px: focus did not move into the sheet")
        t = pg.evaluate("()=>document.querySelector('#assheet').innerText").lower()
        check("savant value" in t and "rank at his position" in t and "open" in t, f"{w}px: the sheet is missing a field: {t[:120]}")
        if how == "button":
            pg.wait_for_timeout(500); pg.screenshot(path=os.path.join(OUT, f"as-sheet-{w}.png"))
            pg.click("[data-sheetclose]")
        elif how == "escape":
            pg.keyboard.press("Escape")
        else:
            pg.mouse.click(w // 2, 30)
        pg.wait_for_timeout(250)
        st = pg.evaluate("()=>({open:!!document.querySelector('dialog#assheet[open]'),back:document.activeElement===document.querySelectorAll('.asf .cp')[5]})")
        check(not st["open"], f"{w}px: {how} did not close the sheet")
        check(st["back"], f"{w}px: focus did not return to the chip after {how}")
    # the OL chip's sheet fills its rank from the team file
    pg.locator(".cp.w").click(); pg.wait_for_timeout(600)
    r = pg.evaluate("()=>document.querySelector('#assheet-rank').textContent")
    check(" of " in r and "offensive lines" in r, f"{w}px: OL rank reads {r!r}"); pg.keyboard.press("Escape")
    # Field / List, remembered
    pg.click("button[data-asv=list]"); pg.wait_for_selector(".asl")
    o = pg.evaluate("()=>({scroll:document.documentElement.scrollWidth-document.documentElement.clientWidth,secs:document.querySelectorAll('.asl h3').length,cards:document.querySelectorAll('.asl .pc').length})")
    check(o["scroll"] <= 0 and o["secs"] >= 8 and o["cards"] == 23, f"{w}px list: {o}")
    pg.screenshot(path=os.path.join(OUT, f"as-list-{w}.png"), full_page=True)
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(800)
    check(pg.evaluate("()=>!!document.querySelector('.asl')"), f"{w}px: List was not remembered after a reload")
    pg.click("button[data-asv=field]"); pg.wait_for_selector(".asf")
    check(not errs, f"{w}px errors: {errs}")
    b.close()


def desktop(p):
    if not os.path.exists(os.path.join(os.path.dirname(__file__), "..", "..", "public", "_before.html")):
        return
    from PIL import Image, ImageChops
    b = p.chromium.launch()
    shots = []
    for page in ("_before.html", "college-football-savant.html"):
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        pg.goto(f"{BASE}/{page}#all-savant/2019", wait_until="networkidle"); pg.wait_for_selector(".turf .fc"); pg.wait_for_timeout(1200)
        f = os.path.join(OUT, f"as-desk-{page.split('.')[0]}.png"); pg.evaluate("()=>{document.querySelector('wce-nav').style.visibility='hidden'}")   # sticky, and it marks the current page
        pg.locator("#view").screenshot(path=f); shots.append(f); pg.close()
    a, c = Image.open(shots[0]).convert("RGB"), Image.open(shots[1]).convert("RGB")
    check(a.size == c.size and ImageChops.difference(a, c).getbbox() is None, f"desktop changed: sizes {a.size} {c.size}, diff box {ImageChops.difference(a, c).getbbox() if a.size == c.size else 'n/a'}")
    b.close()


with sync_playwright() as p:
    for w in (375, 390):
        phone(p, w)
    desktop(p)
print("problems:", bad or "none")
sys.exit(1 if bad else 0)
