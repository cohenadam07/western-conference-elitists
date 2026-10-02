// Regression check for the player pages, the link-preview image and the weekly movers.
//
//   npm run check:players        (node --test tools/players/check.mjs)
//
// The important test is the first one: it lifts the percentile code straight out of
// public/basketball-savant.html, runs it, and compares it with scripts/lib/savant-core.mjs on
// real data. If someone changes how the tool ranks players, this fails until the player pages
// rank them the same way. No network, no keys; it reads public/savant-data.json.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { assignSlugs, createEngine, loadPageConfig, slugify } from '../../scripts/lib/savant-core.mjs'
import { CARD_STATS, MIN_POOL, buildPlayerPages, findSplits, makeContext, renderDirectory, renderPlayer, toolScript } from '../../scripts/lib/player-pages.mjs'
import { computeMovers, moversDraft, takeSnapshot } from '../../scripts/lib/movers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SITE = 'https://wcehoops.com'
const PAGE = path.join(ROOT, 'public', 'basketball-savant.html')
const html = readFileSync(PAGE, 'utf8')
const raw = readFileSync(path.join(ROOT, 'public', 'savant-data.json'), 'utf8')

const cfg = loadPageConfig(PAGE)
const eng = createEngine(JSON.parse(raw), cfg)
const slugs = assignSlugs(eng)
const ctx = makeContext({ eng, slugs, site: SITE })

// Average page size the build is allowed. ~3,800 pages ride along in every deployment Vercel
// keeps, so this is a storage budget, not a style rule. Raise it only on purpose.
const AVG_PAGE_BUDGET = 9500

// Deterministic sample, so a failure reproduces.
function sample(list, n, seed = 20261002) {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const out = []
  for (let i = 0; i < n; i++) out.push(list[Math.floor(rnd() * list.length)])
  return out
}

test('percentiles match the tool’s own code', () => {
  // The tool's helpers, from `const val=` to just before the stat explanations.
  const a = html.indexOf('const val=(p,k,w)=>')
  const b = html.indexOf('const EXPL=')
  const tier = html.match(/function seasonTier\(s\)\{[^\n]*\}/)
  assert.ok(a > 0 && b > a && tier, 'the percentile code in basketball-savant.html has moved: update this test and savant-core.mjs together')
  const sandbox = { out: null }
  vm.createContext(sandbox)
  vm.runInContext(
    `let DATA=null, curSeason=null, cur=null, pop='league', mpgOn=false, band={min:20,max:40};\n` +
      html.slice(a, b) + '\n' + tier[0] + '\n' +
      `function __run(data, metrics, picks){ DATA=data; const res=[];
         for(const [s,i] of picks){ const p=DATA.data[s].players[i]; const row={};
           for(const basis of ['league','position']){ pop=basis; for(const m of metrics){ const v=val(p,m.key,'season');
             if((m.tier&&seasonTier(s)<m.tier)||miss(v)) continue; const pct=pctOf(v,poolVals(m.key,'season',p,s),m.lower);
             (row[m.key]=row[m.key]||{})[basis]=pct; if(basis==='league') row[m.key].text=fmt(m.unit,v,pct); } }
           res.push(row); } return res; }`,
    sandbox
  )
  const all = []
  for (const s of eng.seasons) eng.playersOf(s).forEach((_, i) => all.push([s, i]))
  const picks = sample(all, 600)
  // eng.DATA already carries the position overrides, as the tool's data does after prepData().
  const theirs = vm.runInContext('__run', sandbox)(eng.DATA, eng.metrics, picks)
  let compared = 0
  picks.forEach(([s, i], n) => {
    const p = eng.playersOf(s)[i]
    const mine = eng.profile(p, s)
    assert.deepEqual(mine.map((r) => r.key).sort(), Object.keys(theirs[n]).sort(), `${p.name} ${s}: different stats shown`)
    for (const r of mine) {
      const t = theirs[n][r.key]
      assert.equal(r.league, t.league, `${p.name} ${s} ${r.key}: league percentile`)
      assert.equal(r.position, t.position, `${p.name} ${s} ${r.key}: position percentile`)
      assert.equal(r.text, t.text, `${p.name} ${s} ${r.key}: value text`)
      compared += 2
    }
  })
  assert.ok(compared > 20000, `only ${compared} percentiles compared`)
})

test('every player gets one unique, URL-safe address; namesakes are told apart by debut year', () => {
  const seen = new Set()
  const OG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/ // the pattern api/og.js accepts
  for (const [id, s] of slugs) {
    assert.match(s, OG_SLUG, `slug for ${id}`)
    assert.ok(s.length <= 80, `slug too long: ${s}`)
    assert.ok(!seen.has(s), `duplicate slug ${s}`)
    seen.add(s)
  }
  assert.equal(slugs.size, eng.index.size)
  assert.equal(slugify('Shai Gilgeous-Alexander'), 'shai-gilgeous-alexander')
  assert.equal(slugify("D'Angelo Russell"), 'dangelo-russell')
  assert.equal(slugify('P.J. Tucker'), 'pj-tucker')
  assert.equal(slugify('Nikola Jokić'), 'nikola-jokic')
  assert.equal(slugify('Pétur Guðmundsson'), 'petur-gudmundsson')
  // Namesakes: the earlier debut keeps the plain slug, later ones carry their debut year.
  const byName = new Map()
  for (const e of eng.index.values()) { if (!byName.has(e.name)) byName.set(e.name, []); byName.get(e.name).push(e) }
  for (const [name, list] of byName) {
    if (list.length < 2) continue
    const plain = list.filter((e) => slugs.get(e.id) === slugify(name))
    assert.equal(plain.length, 1, `${name}: exactly one profile keeps the plain slug`)
    const earliest = Math.min(...list.map((e) => +e.oldest.slice(0, 4)))
    assert.equal(+plain[0].oldest.slice(0, 4), earliest, `${name}: the plain slug belongs to the earliest debut`)
  }
})

test('every page renders, stays inside its size budget, and carries what the preview image needs', () => {
  const CARD = /<script type=application\/json id=card>([\s\S]*?)<\/script>/ // same pattern as api/og.js
  let bytes = 0
  for (const e of eng.index.values()) {
    const page = renderPlayer(ctx, e)
    bytes += Buffer.byteLength(page)
    const slug = slugs.get(e.id)
    assert.ok(page.includes(`<link rel="canonical" href="${SITE}/player/${slug}">`), `${slug}: canonical`)
    assert.ok(page.includes(`content="${SITE}/api/og?p=${slug}&amp;v=`), `${slug}: preview image`)
    assert.ok(page.includes(`<h1>${e.name.replace(/&/g, '&amp;')}</h1>`), `${slug}: the heading is the name and nothing else`)
    assert.ok(!/undefined|NaN|\[object /.test(page.replace(/<script[\s\S]*?<\/script>/g, '')), `${slug}: stray undefined/NaN in the page`)
    const m = page.match(CARD)
    assert.ok(m, `${slug}: card data`)
    const card = JSON.parse(m[1])
    assert.equal(card.n, e.name)
    assert.ok(Array.isArray(card.b) && card.b.length <= CARD_STATS.length)
    for (const [label, pct] of card.b) assert.ok(typeof label === 'string' && (pct === null || (pct >= 1 && pct <= 99)), `${slug}: card bar`)
  }
  const avg = bytes / eng.index.size
  assert.ok(avg <= AVG_PAGE_BUDGET, `average page is ${Math.round(avg)} bytes, over the ${AVG_PAGE_BUDGET}-byte budget (see the note on size in player-pages.mjs)`)
  const dir = renderDirectory(ctx)
  for (const s of sample([...slugs.values()], 200)) assert.ok(dir.includes(`href=/player/${s}>`), `directory is missing ${s}`)
})

test('a page’s numbers are the tool’s numbers (spot check through the rendered HTML)', () => {
  const cur = eng.seasons[0]
  const e = [...eng.index.values()].find((x) => x.newest === cur && x.rows[cur].qualified && x.rows[cur].line)
  const page = renderPlayer(ctx, e)
  const row = e.rows[cur]
  for (const r of eng.profile(row, cur)) {
    if (r.league == null) continue
    assert.ok(page.includes(`<th>${r.label.replace(/&/g, '&amp;')}<td>${r.league}<td>${r.position == null ? '·' : r.position}<td>`), `${e.name}: ${r.label} row`)
  }
  assert.ok(page.includes(`${(+row.line.ppg).toFixed(1)} points`), 'stat line in the summary')
})

test('retired players open on their best season; split careers point at each other', () => {
  const recent = new Set(eng.seasons.slice(0, 2))
  const retired = [...eng.index.values()].find((e) => !recent.has(e.newest) && eng.peakSeason(e.id) && eng.peakSeason(e.id) !== e.newest)
  const page = renderPlayer(ctx, retired)
  assert.ok(page.includes(` · ${eng.peakSeason(retired.id)}`), `${retired.name}: leads with his peak season`)
  assert.ok(page.includes('CAREER BEST'))
  const split = findSplits(eng)
  for (const [a, b] of split) {
    assert.equal(split.get(b), a, 'split links go both ways')
    assert.ok(renderPlayer(ctx, eng.index.get(a)).includes(`href=/player/${slugs.get(b)}>`), `${slugs.get(a)} links to ${slugs.get(b)}`)
  }
})

test('a new season with no comparison pool yet: pages hold on last season and say why', () => {
  // Opening week: a new season exists, nobody has reached the games floor.
  const data = JSON.parse(raw)
  const last = data.seasons[0]
  const next = `${+last.slice(0, 4) + 1}-${String((+last.slice(0, 4) + 2) % 100).padStart(2, '0')}`
  const veteran = data.data[last].players.find((p) => p.qualified && p.line)
  const early = (p, id, name) => ({ ...p, id, name, qualified: false, comps: undefined, wflaws: undefined, wcomps: undefined, line: { ppg: 11.1, rpg: 2.2, apg: 3.3, tpg: 1, mpg: 20 } })
  data.seasons.unshift(next)
  data.data[next] = { players: [early(veteran, veteran.id, veteran.name), early(veteran, 99999999, 'Test Rookie')] }
  const e2 = createEngine(data, loadPageConfig(PAGE))
  const c2 = makeContext({ eng: e2, slugs: assignSlugs(e2), site: SITE })
  assert.ok(!c2.usable.has(next) && c2.usable.has(last))
  assert.ok(e2.qualifiedCount(next) < MIN_POOL)

  const vet = renderPlayer(c2, e2.index.get(veteran.id))
  assert.ok(vet.includes(`<b>${next}</b> so far: 11.1 PPG`), 'veteran: note about the new season')
  assert.ok(vet.includes(`until then this page shows ${last}`), 'veteran: says which season is shown')
  assert.ok(vet.includes('style=--v:'), 'veteran: still has percentile bars (from last season)')

  const rookie = renderPlayer(c2, e2.index.get(99999999))
  assert.ok(rookie.includes(`Percentiles for ${next} appear once`), 'rookie: explains the missing percentiles')
  assert.ok(!rookie.includes('style=--v:'), 'rookie: no percentile bars without a pool')
  const card = JSON.parse(rookie.match(/id=card>([\s\S]*?)<\/script>/)[1])
  assert.ok(card.b.every((b) => b[1] === null), 'rookie: preview card carries no percentiles')
})

test('the build writes all of the pages or none of them; one bad row costs one page', () => {
  // A small copy of the site: the real tool page, two seasons of the real data.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wce-players-'))
  const write = (data) => {
    mkdirSync(path.join(tmp, 'public'), { recursive: true })
    copyFileSync(PAGE, path.join(tmp, 'public', 'basketball-savant.html'))
    writeFileSync(path.join(tmp, 'public', 'savant-data.json'), JSON.stringify(data))
  }
  const small = () => {
    const d = JSON.parse(raw)
    d.seasons = d.seasons.slice(0, 2)
    d.data = Object.fromEntries(d.seasons.map((s) => [s, d.data[s]]))
    return d
  }
  try {
    // one malformed row: a string where a number belongs
    const one = small()
    const victim = one.data[one.seasons[0]].players.find((p) => p.m.vert && p.m.vert.season && p.comps)
    victim.m.vert.season.v = 'n/a'
    write(one)
    const dist1 = path.join(tmp, 'dist1')
    const r = buildPlayerPages({ root: tmp, dist: dist1, site: SITE })
    assert.equal(r.skipped.length, 1, 'one player skipped')
    assert.ok(r.skipped[0].startsWith(victim.name), r.skipped[0])
    assert.ok(r.count > 500, `${r.count} pages still built`)
    assert.ok(existsSync(path.join(dist1, 'player', 'p.css')) && existsSync(path.join(dist1, 'player', 'p.js')) && existsSync(path.join(dist1, 'player', 'index.html')))
    assert.equal(readdirSync(path.join(dist1, 'player')).filter((f) => !f.includes('.')).length, r.count, 'a folder per built page')
    assert.equal(r.urls.length, r.count + 1, 'sitemap lists exactly the pages that exist (plus the directory)')
    assert.ok(!r.urls.some((u) => u.loc.endsWith('/' + slugify(victim.name))), 'the skipped player is not in the sitemap')
    assert.ok(!readFileSync(path.join(dist1, 'player', 'index.html'), 'utf8').includes(`href=/player/${slugify(victim.name)}>`), 'nor in the directory')

    // something systemic: every row broken -> throws, and nothing at all is written
    const all = small()
    for (const s of all.seasons) for (const p of all.data[s].players) p.m.vert = { season: { v: 'n/a', n: null } }
    write(all)
    const dist2 = path.join(tmp, 'dist2')
    assert.throws(() => buildPlayerPages({ root: tmp, dist: dist2, site: SITE }), /players failed to render/)
    assert.ok(!existsSync(path.join(dist2, 'player')), 'no half-written folder')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('the script added to the tool is complete and parses', () => {
  const js = toolScript(ctx)
  assert.ok(!js.includes('/*__'), 'placeholders filled')
  assert.doesNotThrow(() => new vm.Script(js), 'valid JavaScript')
  // The hooks it relies on are still top-level functions/variables in the page.
  for (const name of ['selectPlayer', 'render', 'showHome', 'showLB', 'stopPlay', 'setSeason', 'asId', 'inSpan']) {
    assert.match(html, new RegExp(`^(async )?function ${name}\\(`, 'm'), `basketball-savant.html no longer has a top-level ${name}(): update player-links.client.js`)
  }
  assert.match(html, /^let curSeason = null;/m)
  assert.match(html, /^let cur=null, curId=null,/m)
  assert.match(html, /id="exportbtn"/)
  assert.match(html, /<div class="idbtns">/)
  // Its slug rule is this file's slug rule: run it and compare on every player.
  const sandbox = {}
  const start = js.indexOf('var FOLD=')
  const end = js.indexOf('var ODD = ')
  vm.runInNewContext(js.slice(start, end) + '\n' + js.slice(end, js.indexOf(';', js.indexOf('}', end)) + 1) + '\nthis.slugOf=function(id,name){return ODD[String(id)]||slugify(name)}', sandbox)
  for (const e of eng.index.values()) assert.equal(sandbox.slugOf(e.id, e.name), slugs.get(e.id), `tool and build disagree on ${e.name}`)
})

test('preview image: a PNG for a real player, the generic card for anything else', async () => {
  const realFetch = globalThis.fetch
  const jokicLike = [...eng.index.values()].find((e) => e.newest === eng.seasons[0] && e.rows[eng.seasons[0]].qualified)
  const slug = slugs.get(jokicLike.id)
  const page = renderPlayer(ctx, jokicLike)
  const asked = []
  globalThis.fetch = async (url, init) => {
    if (!/^https?:/.test(String(url))) return realFetch(url, init) // the image library loads its own wasm through fetch
    asked.push(String(url))
    if (String(url).endsWith(`/player/${slug}`)) return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } })
    return new Response('<!doctype html><div id=root></div>', { status: 200 }) // the app shell: no card
  }
  try {
    const handler = (await import('../../api/og.js')).default
    const call = (query, host = 'wcehoops.com', method = 'GET') =>
      new Promise((resolve, reject) => {
        const out = { status: 200, headers: {} }
        const res = {
          setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; return res },
          status: (c) => { out.status = c; return res },
          send: (b) => { out.body = b; resolve(out) },
          json: (j) => { out.json = j; resolve(out) },
          redirect: (c, u) => { out.status = c; out.location = u; resolve(out) },
        }
        Promise.resolve(handler({ method, query, headers: typeof host === 'string' ? { host } : host }, res)).catch(reject)
      })
    const ok = await call({ p: slug, v: '1' })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers['content-type'], 'image/png')
    assert.equal(ok.body.subarray(1, 4).toString(), 'PNG')
    assert.ok(ok.body.length > 10000, 'image has content')
    assert.match(ok.headers['cache-control'], /s-maxage=\d{6,}/)

    for (const bad of ['no-such-player', '../../etc/passwd', '', 'UPPER', 'a'.repeat(120)]) {
      const r = await call({ p: bad })
      assert.equal(r.status, 302, `${JSON.stringify(bad)} -> redirect`)
      assert.equal(r.location, '/og-card.png')
    }
    // It only ever reads from our own hosts, whatever headers arrive: the image is cached for
    // a month, so a card built from someone else's page would stick.
    const wasVercel = process.env.VERCEL
    process.env.VERCEL = '1' // as deployed: localhost is not one of ours either
    try {
      for (const headers of [
        { host: 'evil.example.com' },
        { host: 'evil-project.vercel.app' },
        { host: 'wcehoops.com.evil.example.com' },
        { host: 'localhost:3000' },
        { host: 'wcehoops.com', 'x-forwarded-host': 'evil-project.vercel.app' },
      ]) {
        asked.length = 0
        await call({ p: slug }, headers)
        assert.ok(asked.length > 0 && asked.every((u) => u.startsWith('https://wcehoops.com/player/')), `${JSON.stringify(headers)} fetched: ${asked.join(', ')}`)
      }
    } finally {
      if (wasVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = wasVercel
    }
    assert.equal((await call({ p: slug }, 'wcehoops.com', 'POST')).status, 405)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('movers: finds who moved, once each, and ignores noise', () => {
  const cur = eng.seasons[0]
  const before = takeSnapshot(eng, slugs)
  assert.ok(Object.keys(before.players).length === eng.qualifiedCount(cur), 'snapshot holds the qualified players')

  // A week later: one player shoots much better, one much worse; everyone else unchanged.
  const data = JSON.parse(raw)
  const qual = data.data[cur].players.filter((p) => p.qualified && p.m.ts && p.m.ts.season && p.m.ts.season.n >= 400)
  const byTs = [...qual].sort((a, b) => a.m.ts.season.v - b.m.ts.season.v)
  const riser = byTs[Math.floor(byTs.length * 0.3)], faller = byTs[Math.floor(byTs.length * 0.7)]
  riser.m.ts.season.v += 0.06
  faller.m.ts.season.v -= 0.06
  data.generated = new Date(Date.parse(data.generated) + 7 * 86400000).toISOString()
  const e2 = createEngine(data, loadPageConfig(PAGE))
  const after = takeSnapshot(e2, assignSlugs(e2))

  const r = computeMovers(before, after)
  assert.ok(r.ok, r.reason)
  assert.equal(r.days, 7)
  assert.equal(r.risers[0].name, riser.name)
  assert.equal(r.risers[0].key, 'ts')
  assert.ok(r.risers[0].delta >= 20, `riser moved ${r.risers[0].delta}`)
  assert.equal(r.fallers[0].name, faller.name)
  assert.ok(r.fallers[0].delta <= -20)
  const names = [...r.risers, ...r.fallers].map((m) => m.name)
  assert.equal(new Set(names).size, names.length, 'each player listed once')
  // The numbers in the email are the page's numbers.
  assert.equal(r.risers[0].to, e2.pct(riser, cur, 'ts'))
  assert.equal(r.risers[0].from, eng.pct(eng.index.get(riser.id).rows[cur], cur, 'ts'))

  const draft = moversDraft(r, { site: SITE })
  assert.ok(draft.subject.includes(riser.name))
  assert.ok(draft.body.includes(`${SITE}/player/${slugs.get(riser.id)}?utm_source=newsletter`))
  assert.ok(draft.body.includes('[Your intro'), 'leaves the intro for a person to write')

  // Same data twice: nothing to say, and it says so instead of inventing movers.
  const none = computeMovers(before, before)
  assert.equal(none.ok, false)
  assert.match(none.reason, /nobody moved/)
})
