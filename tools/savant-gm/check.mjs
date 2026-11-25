// Check for GM Savant: the files pipeline/basketball/gm/build_page.py writes under public/gms/, the page that draws
// them (public/gm-savant.html), and the connector section (api/_gm.js) that quotes them.
//
//   node --test tools/savant-gm/check.mjs        (npm run check:savant-gm)
//
// What it holds:
//   1. the files are whole: the index lists every GM once and each has a file; every file is valid JSON (no NaN);
//      every decision has an id, a date, a grade version and grades that are numbers or null; ids are unique
//   2. the numbers add up: each spell's GM Value Added is production (from luck-adjusted margin) plus what he left
//      minus what he inherited, at every discount rate, and the player-value line the same with production from
//      player value; the boards are in order and point at real spells; a photo always has its credit line
//   3. the page: its script parses, every explainer key it opens exists, every explainer has its four parts
//   4. the connector answers all five tools through a real MCP client, against these very files, and every number
//      it quotes is read back from the files
// The pipeline's own invariants (ledger balance, conservation, frozen grades, credit sums, sources) are
// pipeline/basketball/gm/test_gm.py: they read the pipeline's working files, which a fresh checkout does not have.
//
// No network, no keys. Takes a few seconds.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const GMS = path.join(ROOT, 'public', 'gms')
const raw = (p) => (p.endsWith('.gz') ? gunzipSync(readFileSync(p)).toString('utf8') : readFileSync(p, 'utf8'))
const readJson = (p) => JSON.parse(raw(p))
const gz = (p) => (existsSync(p) ? p : existsSync(p + '.gz') ? p + '.gz' : null)
const RATES = ['0.0', '0.05', '0.1', '0.2']

const index = readJson(path.join(GMS, 'index.json.gz'))
const files = Object.fromEntries(index.people.map((p) => [p.file, path.join(GMS, 'g', `${p.file}.json.gz`)]))
const pages = Object.fromEntries(Object.entries(files).filter(([, f]) => existsSync(f)).map(([k, f]) => [k, readJson(f)]))

// ---- 1. the files ---------------------------------------------------------------------------
test('the index lists every GM once and every GM has a file', () => {
  const ids = index.people.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length, 'a GM is listed twice')
  for (const p of index.people) assert.ok(pages[p.file], `no file for ${p.name}`)
  assert.ok(index.people.length > 200, 'the index should hold every front-office head since 1979-80 (211 in November 2026)')
  assert.equal(index.meta.version, '1.0.1')
  assert.ok(index.meta.games_through && index.meta.through, 'the index says how current it is')
})

test('every file is valid JSON with no NaN, and every decision is whole', () => {
  for (const [file, f] of Object.entries(files)) {
    const text = raw(f)
    assert.ok(!/\bNaN\b/.test(text), `${file}: NaN (not JSON; a browser could not open it)`)
    const g = pages[file]
    const ids = g.decisions.map((d) => d.id)
    assert.equal(new Set(ids).size, ids.length, `${file}: a decision is listed twice`)
    for (const d of g.decisions) {
      assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/, `${file}: decision without a date`)
      assert.ok(d.grade_version, `${file} ${d.id}: no grade version`)
      for (const k of ['at_time', 'turned_out']) assert.ok(d[k] === null || Number.isFinite(d[k]), `${file} ${d.id}: ${k} is ${d[k]}`)
      assert.ok(d.source_text || d.label, `${file} ${d.id}: no source text or label`)
    }
  }
})

// ---- 2. the numbers -------------------------------------------------------------------------
test('GM Value Added is production plus what he left minus what he inherited, at every rate', () => {
  let n = 0
  for (const g of Object.values(pages)) {
    for (const s of g.spells) {
      if (!s.gm_value_added) continue
      for (const k of RATES) {
        const left = s.left[k], inh = s.inherited[k]
        // production is undiscounted within the spell (what the team did then); the edges are discounted
        assert.ok(Math.abs(s.gm_value_added[k] - (s.produced_margin_adj + left - inh)) < 0.6, `${g.name} ${s.team}: headline at ${k}`)
        assert.ok(Math.abs(s.gm_value_added_player[k] - (s.produced_above_average + left - inh)) < 0.6, `${g.name} ${s.team}: player line at ${k}`)
        assert.ok(Math.abs(s.gm_value_added_at_time[k] - (s.produced_margin_adj + s.left_at_time[k] - s.inherited_at_time[k])) < 0.6, `${g.name} ${s.team}: at the time at ${k}`)
        if (s.end == null) {
          assert.equal(s.gm_value_added_turned_out ?? null, null, `${g.name}: an active tenure has no as-it-turned-out number`)
          assert.equal(s.gm_value_added[k], s.gm_value_added_at_time[k], `${g.name}: an active GM's headline is his projection`)
        } else {
          assert.ok(Math.abs(s.gm_value_added_turned_out[k] - (s.produced_margin_adj + s.left_turned_out[k] - s.inherited_turned_out[k])) < 0.6, `${g.name} ${s.team}: as it turned out at ${k}`)
          assert.equal(s.gm_value_added[k], s.gm_value_added_turned_out[k], `${g.name} ${s.team}: a finished tenure's headline is as it turned out`)
        }
      }
      n++
    }
  }
  assert.ok(n > 250, `only ${n} spells carry a headline`)
})

test('the boards are in order and point at real spells', () => {
  for (const [board, rows] of Object.entries(index.boards)) {
    assert.ok(rows.length > 5, `${board} board is short`)
    // ranked by the blend at the default (points + lambda x expected titles added), which must be just that
    const lam = index.meta.titles.lambda
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].blended >= rows[i].blended, `${board} board out of order at ${i}`)
    for (const r of rows) assert.ok(Math.abs(r.blended - (r.gva + lam * r.titles_added)) < 0.6, `${board}: ${r.name}'s blend is not points + lambda x titles`)
    for (const r of rows) {
      const g = pages[r.file]
      assert.ok(g, `${board}: ${r.name} has no file`)
      const s = g.spells.find((x) => x.team === r.team && x.start === r.start)
      assert.ok(s, `${board}: ${r.name} ${r.team} ${r.start} is not one of his spells`)
      const card = board === 'at_time' ? s.gm_value_added_at_time : s.gm_value_added
      assert.ok(card && Math.abs(card['0.05'] - r.gva) < 0.6, `${board}: ${r.name}'s board number is not his card's`)
    }
    if (board === 'active') assert.ok(rows.every((r) => r.end == null), 'the active board lists a GM no longer in office')
  }
})

test('a photo always carries its credit line', () => {
  for (const p of index.people) if (p.photo) assert.ok(p.photo.src && p.photo.credit, `${p.name}: a photo without a credit line`)
})

// ---- 3. the page ----------------------------------------------------------------------------
test('the page script parses, and every explainer it opens exists and is whole', () => {
  const html = readFileSync(path.join(ROOT, 'public', 'gm-savant.html'), 'utf8')
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  assert.ok(scripts.length, 'no inline script')
  for (const src of scripts) assert.doesNotThrow(() => new Function(src))
  const m = html.match(/const EXPL = (\{[\s\S]*?\n ?\});\n/)
  assert.ok(m, 'the explainers are not inlined')
  const EXPL = JSON.parse(m[1])
  const used = new Set([...html.matchAll(/info\('([a-z0-9_]+)'/g)].map((x) => x[1]))
  for (const k of used) assert.ok(EXPL[k], `the page opens explainer ${k}, which does not exist`)
  // the rest reach info() through pbar/vbar's key and the skill picker's table: each must be wired somewhere
  const code = scripts.join('\n').replace(/const EXPL = \{[\s\S]*?\n ?\};/, '')
  for (const k of Object.keys(EXPL)) assert.ok(code.includes(`'${k}'`) || html.includes(`data-x="${k}"`), `explainer ${k} is never opened from the page`)
  for (const m of html.matchAll(/data-x="([a-z0-9_]+)"/g)) assert.ok(EXPL[m[1]], `a button opens explainer ${m[1]}, which does not exist`)
  assert.ok(!/\{\{[a-z_]+\}\}/.test(html), 'a number placeholder was left unfilled')
  // details open on a tap (phones have no hover): no title= tooltips in the script's markup, and the tap targets exist
  assert.ok(!/title="\$\{/.test(code), 'a detail is still a hover-only title attribute')
  for (const f of ['openTip', 'openExpl']) assert.ok(code.includes(`function ${f}(`), f)
  assert.ok(/addEventListener\('click'[\s\S]{0,400}\.tipb/.test(code), 'no tap handler for the detail buttons')
  for (const [k, e] of Object.entries(EXPL)) for (const part of ['what', 'how', 'data', 'limits']) assert.ok(e[part] && e[part].trim().length >= 5, `explainer ${k} lacks "${part}"`)
})

// ---- 4. the connector -----------------------------------------------------------------------
let server, client
before(async () => {
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    const f = gz(path.join(ROOT, 'public', url))
    if (!f) { res.statusCode = 404; return res.end('not found') }
    res.setHeader('content-type', 'application/json'); res.end(f.endsWith('.gz') ? gunzipSync(readFileSync(f)) : readFileSync(f))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${server.address().port}`
  const mod = await import('../../api/_gm.js')
  const srv = new McpServer({ name: 't', version: '0' })
  for (const t of mod.tools) srv.registerTool(t.name, t.config, async (a) => { try { const { text, structured } = await t.run(a); return { content: [{ type: 'text', text }], structuredContent: structured } } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] } } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await srv.connect(a)
  client = new Client({ name: 'check', version: '0' })
  await client.connect(b)
})
after(async () => { await client?.close(); server?.close() })
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`); return { ...r, text: r.content.map((c) => c.text).join('\n') } }

test('the five tools are listed', async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['nba_get_gm_profile', 'nba_gm_asset_tree', 'nba_gm_decisions', 'nba_gm_leaders', 'nba_search_gms'])
})

test('a profile quotes the card: headline, rank pool and the page', async () => {
  const presti = index.people.find((p) => p.name === 'Sam Presti')
  const r = await call('nba_get_gm_profile', { gm: 'Sam Presti' })
  const card = pages[presti.file].spells.find((s) => s.team === 'OKC')
  const gva = Math.round(card.gm_value_added['0.05']).toLocaleString('en-US')
  assert.ok(r.text.includes(gva), `the profile does not quote his headline ${gva}`)
  assert.ok(/nba-gm-savant#g=/.test(r.text), 'no link to the page')
})

test('the leaders board is the index board, in order', async () => {
  const r = await call('nba_gm_leaders', { board: 'all', limit: 5 })
  const rows = r.structuredContent?.rows || r.structuredContent?.leaders || []
  const top = index.boards.all.slice(0, 5).map((x) => x.name)
  if (rows.length) assert.deepEqual(rows.map((x) => x.name), top)
  else for (const n of top) assert.ok(r.text.includes(n), `${n} missing from the leaders answer`)
})

test('decisions are read back from the file, both grades', async () => {
  const presti = index.people.find((p) => p.name === 'Sam Presti')
  const r = await call('nba_gm_decisions', { gm: 'Sam Presti', type: 'trade', limit: 5 })
  const rows = r.structuredContent?.decisions || r.structuredContent?.rows || []
  assert.ok(rows.length, 'no decisions came back')
  const byId = Object.fromEntries(pages[presti.file].decisions.map((d) => [d.id, d]))
  for (const d of rows) {
    const f = byId[d.decision_id]
    assert.ok(f, `decision ${d.decision_id} is not in his file`)
    assert.equal(d.at_time ?? null, f.at_time ?? null, `${d.decision_id}: at the time`)
    assert.equal(d.turned_out ?? null, f.turned_out ?? null, `${d.decision_id}: as it turned out`)
  }
})

test('search finds a GM by part of his name, and the asset tree answers', async () => {
  const s = await call('nba_search_gms', { query: 'presti' })
  assert.ok(s.text.includes('Sam Presti'))
  const t = await call('nba_gm_asset_tree', { gm: 'Sam Presti' })
  assert.ok(t.text.length > 200, 'the asset tree is empty')
})
