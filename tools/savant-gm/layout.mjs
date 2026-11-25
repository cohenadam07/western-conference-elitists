// NBA GM Savant's wide tables in a real browser (Chrome through Playwright), at 375px, 768px and 1280px: every table
// scrolls inside its own panel, its last column can be scrolled into view, the first column stays pinned while the
// rest scrolls, and the page itself never scrolls sideways. jsdom (tap.mjs) has no layout, so this is the one check
// that sees what a reader sees. On the boards, the first two number columns must be in view before any scrolling
// (Nov 25, 2026: a one-line Team column second from the left pushed every number off a 1280px board). Data is served from public/ on disk; nothing is fetched.
//
//   GM_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tools/savant-gm/layout.mjs [public] [shots-dir]
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const PUB = path.resolve(process.argv[2] || 'public')
const SHOTS = process.argv[3] || null
let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('ok', msg) } else { fail++; console.log('not ok', msg) } }

const serve = async (route) => {
  const u = new URL(route.request().url())
  if (u.hostname !== 'gm.test') return route.abort()
  const rel = decodeURIComponent(u.pathname) === '/' ? '/gm-savant.html' : decodeURIComponent(u.pathname)
  let f = path.join(PUB, rel)
  if (!fs.existsSync(f) && fs.existsSync(f + '.gz')) f += '.gz'
  if (!f.startsWith(PUB) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' })
  let body = fs.readFileSync(f)
  if (f.endsWith('.gz')) body = zlib.gunzipSync(body)
  const type = rel.endsWith('.json') ? 'application/json' : rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : 'application/octet-stream'
  return route.fulfill({ status: 200, body, headers: { 'content-type': type } })
}

const browser = await chromium.launch({ executablePath: process.env.GM_CHROME || undefined })
const errors = []
for (const width of [375, 768, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 812 : 900 } })
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`))
  await page.route('**/*', serve)
  for (const [where, hash, sel] of [['home', '', '#homeBoard table.t'], ['leaders', '#leaders', '#lb'], ['a GM card (Jerry Krause)', '#g=krausje99x', '#log']]) {
    await page.goto('http://gm.test/gm-savant.html' + hash)
    await page.waitForSelector(`${sel} tr td`, { timeout: 15000 }).catch(() => null)
    await page.waitForTimeout(400)
    const r = await page.evaluate((sel) => {
      const doc = document.scrollingElement
      const out = { pageScroll: doc.scrollWidth - window.innerWidth, tables: [] }
      for (const t of document.querySelectorAll(sel)) {
        const box = t.closest('.scroll'), card = t.closest('.col')
        if (!box || !t.offsetParent) continue
        const rows = t.querySelectorAll('tr')
        const firstCell = rows[1] && rows[1].children[0]
        const nums = [...rows[0].children].filter((th) => !/^(GM|Team|Years)\b/.test(th.textContent.trim())).slice(0, 2)
        const box0 = box.getBoundingClientRect()
        const numsShown = nums.map((th) => ({ name: th.textContent.trim().replace(/\s+i$/, ''), right: Math.round(th.getBoundingClientRect().right - box0.right) }))
        const before = firstCell.getBoundingClientRect().left
        box.scrollLeft = box.scrollWidth
        const after = firstCell.getBoundingClientRect().left
        const lastTh = rows[0].lastElementChild.getBoundingClientRect(), b = box.getBoundingClientRect(), c = card.getBoundingClientRect()
        // measured at scrollLeft 0, before the scroll below: the number columns are every column but the GM, his teams and years
        out.tables.push({
          wide: t.scrollWidth > box.clientWidth + 1,
          scrolls: box.scrollWidth > box.clientWidth + 1 ? box.scrollLeft > 0 : true,
          lastVisible: lastTh.right <= b.right + 1.5 && lastTh.left >= b.left - 1,
          insideCard: b.right <= c.right + 1 && b.left >= c.left - 1,
          pinned: Math.abs(after - before) < 1.5,
          pinnedLabel: firstCell.textContent.trim().slice(0, 30),
          numsShown,
        })
        box.scrollLeft = 0
      }
      return out
    }, sel)
    ok(r.pageScroll <= 0, `${width}px, ${where}: the page never scrolls sideways (${r.pageScroll}px)`)
    ok(r.tables.length > 0, `${width}px, ${where}: ${r.tables.length} table(s) found`)
    const board = where !== 'a GM card (Jerry Krause)'
    for (const [i, t] of r.tables.entries()) {
      const tag = `${width}px, ${where}, table ${i + 1}${t.wide ? ' (wider than its panel)' : ''}`
      ok(t.insideCard, `${tag}: its scroll panel stays inside the card`)
      ok(t.scrolls, `${tag}: scrolls sideways`)
      ok(t.lastVisible, `${tag}: the last column scrolls fully into view`)
      if (board) ok(t.numsShown.length === 2 && t.numsShown.every((x) => x.right <= 1), `${tag}: the first two number columns are in view before scrolling (${t.numsShown.map((x) => `${x.name} ${x.right <= 1 ? 'in view' : `${x.right}px past the edge`}`).join(', ')})`)
      if (t.wide) ok(t.pinned, `${tag}: the first column stays pinned while scrolling ("${t.pinnedLabel}")`)
    }
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: path.join(SHOTS, `gm-${where.split(' ')[0]}-${width}.png`), fullPage: false })
      // and one with the table's own card at the top of the screen, where a phone reader meets it
      await page.evaluate((sel) => { const t = document.querySelector(sel); const c = t && (t.closest('.col') || t); if (c) window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 8) }, sel)
      await page.waitForTimeout(150)
      await page.screenshot({ path: path.join(SHOTS, `gm-${where.split(' ')[0]}-${width}-table.png`), fullPage: false })
    }
  }
  await page.close()
}
await browser.close()
ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
