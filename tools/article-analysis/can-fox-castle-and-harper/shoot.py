import asyncio, sys
from playwright.async_api import async_playwright
URL = 'http://localhost:4173/articles/can-fox-castle-and-harper-actually-start-together'
width = int(sys.argv[1]) if len(sys.argv) > 1 else 1280
tag = sys.argv[2] if len(sys.argv) > 2 else 'desk'
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        p = await b.new_page(viewport={'width': width, 'height': 900})
        errs = []
        p.on('pageerror', lambda e: errs.append('pageerror ' + str(e)))
        p.on('console', lambda m: errs.append('console ' + m.text) if m.type == 'error' else None)
        await p.goto(URL, wait_until='networkidle')
        await p.wait_for_selector('.rich-body', timeout=15000)
        await p.wait_for_timeout(1500)
        for btn in await p.query_selector_all('.rich-math-toggle'):
            await btn.click()
        await p.wait_for_timeout(800)
        print('height', await p.evaluate('document.body.scrollHeight'), 'errors', len(errs))
        for e in errs[:10]: print(e)
        figs = await p.query_selector_all('.rich-figure, .rich-math, .rich-stats, .rich-argue, .rich-clip, .rich-check')
        print('blocks', len(figs))
        i = 0
        for f in await p.query_selector_all('.rich-figure'):
            await f.scroll_into_view_if_needed(); await p.wait_for_timeout(250)
            await f.screenshot(path=f'/home/claude/spurs-article/shots/{tag}-fig{i:02d}.png'); i += 1
        print('overflow', await p.evaluate('document.documentElement.scrollWidth - window.innerWidth'))
        await p.screenshot(path=f'/home/claude/spurs-article/shots/{tag}-top.png', clip={'x':0,'y':0,'width':width,'height':2400})
        await b.close()
asyncio.run(main())
