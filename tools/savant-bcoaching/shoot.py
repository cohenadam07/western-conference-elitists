"""The visual pass for Basketball Coaching Savant: screenshot every section of the page at desktop and
phone width, record console errors and horizontal overflow, and exercise the hovers, the picker and
the tree. Needs the page served locally (node tools/serve-vercel.mjs 4174 public) and Playwright's
Python package with Chromium.

    python3 tools/savant-bcoaching/shoot.py <out_dir> [coach slug] [season] [base url]
"""
import sys, os, json
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
COACH = sys.argv[2] if len(sys.argv) > 2 else 'spoeler99c'
SEASON = sys.argv[3] if len(sys.argv) > 3 else '2024-25'
BASE = sys.argv[4] if len(sys.argv) > 4 else 'http://localhost:4174/basketball-coaching-savant.html'
os.makedirs(OUT, exist_ok=True)


def run(pw, width, tag):
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': width, 'height': 900}, device_scale_factor=1)
    p = ctx.new_page()
    errs = []
    p.on('pageerror', lambda e: errs.append('pageerror ' + str(e)))
    p.on('console', lambda m: errs.append('console ' + m.text) if m.type == 'error' else None)
    report = {'tag': tag, 'width': width}

    def overflow():
        return p.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')

    def shoot_sections(prefix):
        names = []
        for i, pl in enumerate(p.query_selector_all('.plate, .treestage')):
            if not pl.is_visible():
                continue
            h = pl.query_selector('h2.sec')
            name = (h.inner_text() if h else f'plate{i}').strip().lower()
            name = ''.join(c if c.isalnum() else '-' for c in name)[:40].strip('-') or f'plate{i}'
            pl.scroll_into_view_if_needed(); p.wait_for_timeout(200)
            box = pl.bounding_box()
            if not box or box['height'] < 10:
                continue
            try:
                pl.screenshot(path=f'{OUT}/{prefix}-{i:02d}-{name}.png')
                names.append((name, round(box['height'])))
            except Exception as e:
                names.append((name, 'FAILED ' + str(e)[:60]))
        return names

    hov = {}

    def hover_check(sel, label, pos=None):
        el = p.query_selector(sel)
        if not el:
            hov[label] = 'no element'; return
        el.evaluate('e => e.scrollIntoView({block: "center"})'); p.wait_for_timeout(250)
        bb = el.bounding_box()
        if not bb:
            hov[label] = 'no box'; return
        x = bb['x'] + (pos['x'] if pos else bb['width'] / 2); y = bb['y'] + (pos['y'] if pos else bb['height'] / 2)
        p.mouse.move(x, y); p.wait_for_timeout(120); p.mouse.move(x + 1, y); p.wait_for_timeout(300)
        tip = p.query_selector('#tip')
        vis = tip.is_visible() if tip else False
        txt = (tip.inner_text() if vis else '')[:140].replace('\n', ' | ')
        hov[label] = txt if vis else 'NO TOOLTIP'
        if vis:
            tb = tip.bounding_box(); eb = el.bounding_box()
            hov[label + '_box'] = {'tip': {k: round(v) for k, v in tb.items()}, 'el': {k: round(v) for k, v in eb.items()}}
            y0 = max(0, min(tb['y'], eb['y']) - 20); x0 = max(0, min(tb['x'], eb['x']) - 20)
            p.screenshot(path=f'{OUT}/{tag}-hover-{label}.png', clip={'x': x0, 'y': y0, 'width': max(50, min(width - x0, 900)), 'height': max(50, min(900 - y0, 360))})
        p.mouse.move(2, 2); p.wait_for_timeout(300)

    # home
    p.goto(BASE, wait_until='networkidle'); p.wait_for_selector('#leaders .lrow', timeout=20000); p.wait_for_timeout(600)
    report['home_overflow'] = overflow()
    p.screenshot(path=f'{OUT}/{tag}-home.png', full_page=True)
    report['home_sections'] = shoot_sections(f'{tag}-home')

    # coach, career view
    p.goto(f'{BASE}#c={COACH}', wait_until='networkidle'); p.wait_for_selector('#card .row', timeout=20000); p.wait_for_selector('#rotmap', timeout=20000); p.wait_for_timeout(1200)
    report['coach_overflow'] = overflow()
    report['coach_height'] = p.evaluate('document.body.scrollHeight')
    p.screenshot(path=f'{OUT}/{tag}-coach-full.png', full_page=True)
    report['coach_sections'] = shoot_sections(f'{tag}-coach')
    hover_check('#card .row', 'card-row')
    hover_check('#coach svg g.hit[data-pick]', 'career-column')
    hover_check('#rotmap', 'rotation-cell', {'x': 60, 'y': 30})
    hover_check('#gchart g.hit', 'offscript-game')
    hover_check('#quadbody circle.hit', 'unit-dot')
    hover_check('.tile', 'tile')
    hover_check('#coach .srl', 'split-bar')
    report['hovers'] = hov
    p.click('#card .row'); p.wait_for_timeout(200)
    report['explainer_pinned'] = bool(p.query_selector('#card .expl'))
    report['player_links'] = len(p.query_selector_all('a.pl')); report['coach_links'] = len(p.query_selector_all('a.cl'))

    # season view
    p.goto(f'{BASE}#c={COACH}&season={SEASON}', wait_until='networkidle'); p.wait_for_timeout(1500)
    report['season_overflow'] = overflow()
    report['season_card_rows'] = len(p.query_selector_all('#card .row'))
    report['season_title'] = (p.query_selector('#card h2.sec').inner_text() if p.query_selector('#card h2.sec') else '')
    p.screenshot(path=f'{OUT}/{tag}-season-full.png', full_page=True)
    report['season_sections'] = shoot_sections(f'{tag}-season')
    p.click('#picker .pk[data-pick="career"]'); p.wait_for_timeout(800)
    report['back_to_career'] = (p.query_selector('#card h2.sec').inner_text() if p.query_selector('#card h2.sec') else '')

    # tree
    p.goto(f'{BASE}#tree', wait_until='networkidle'); p.wait_for_timeout(2500)
    report['tree_overflow'] = overflow()
    report['tree_nodes'] = len(p.query_selector_all('#treesvg .leaf'))
    p.screenshot(path=f'{OUT}/{tag}-tree.png')
    p.fill('#tfind', 'popovich'); p.wait_for_timeout(600)
    p.screenshot(path=f'{OUT}/{tag}-tree-popovich.png')
    hover_check('#treesvg .leaf', 'tree-node')
    p.click('#zast'); p.wait_for_timeout(2500)
    report['tree_nodes_with_assistants'] = len(p.query_selector_all('#treesvg .leaf'))
    report['errors'] = errs[:20]
    b.close()
    return report


with sync_playwright() as pw:
    reps = [run(pw, 1280, 'desk'), run(pw, 390, 'phone')]
json.dump(reps, open(f'{OUT}/report.json', 'w'), indent=1)
for r in reps:
    print('====', r['tag'], 'overflow home/coach/season/tree:', r['home_overflow'], r['coach_overflow'], r['season_overflow'], r['tree_overflow'], '| coach height', r['coach_height'])
    print('  errors:', r['errors'] or 'none')
    print('  hovers:', {k: v for k, v in r['hovers'].items() if not k.endswith('_box')})
    print('  explainer pinned:', r['explainer_pinned'], '| links player/coach:', r['player_links'], r['coach_links'], '| season rows:', r['season_card_rows'], r['season_title'], '| back:', r['back_to_career'])
    print('  tree nodes:', r['tree_nodes'], '-> with assistants', r['tree_nodes_with_assistants'])
    print('  sections:', r['coach_sections'])
