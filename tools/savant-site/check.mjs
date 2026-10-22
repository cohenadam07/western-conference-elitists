// Check for the site-content section of the AI connector: the slicer
// (scripts/lib/savant-api-site.mjs) and its tools (api/_site.js).
//
//   node --test tools/savant-site/check.mjs
//
// The Savant checks ask "is this the number on the card". This one asks "is this what the
// page says", for the News wire, WCE's articles, the Big Board and the Dynasty Exchange:
//
//   1. Does every item a tool returns match the source the page renders from, field for
//      field, with the cuts the page makes (three chips, four authors, a dash for a missing
//      measurement) and nothing else changed? What is held back on purpose (the "WCE" note
//      under a News item, pending an editorial decision) must be absent everywhere and
//      recorded in meta.json. The expectations here are written from the
//      pages' JSX, and content.js is loaded a second way (as the real module, by Node) so the
//      slicer is not being compared with itself.
//   2. Does template copy stay out? content.js still carries wire items, podcast episodes
//      and "#" links that no page shows, and an article with no body would render stock
//      paragraphs. None of it may reach a file or an answer.
//   3. Does the Dynasty tool price the board the way the page does, and does it only ever
//      read? The board is served here by the site's real api/dynasty.js over a stand-in for
//      its Redis store, so the shape is the real one, and every command that reaches the
//      store is recorded: a vote would show up there.
//   4. When something cannot be answered (store down, slow, an unknown slug, a name two
//      prospects share), does the answer say what to do next and leak nothing?
//
// Rules that live inline in a page are pinned by their text. If one of those assertions
// fails, the page changed: re-read it and bring the slicer or the tools along, do not relax
// the check. No network, no keys, no new dependencies. Takes a few seconds.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import vm from 'node:vm'
import { BASE, SITE, SLUG, buildSiteApi, htmlToText, readContent, writeSiteApi } from '../../scripts/lib/savant-api-site.mjs'
import { buildDraftApi } from '../../scripts/lib/savant-api-draft.mjs'
// The homepage banner's own gatherers and its own picking rules, run as they are.
import { KEEP_DAYS, articles as bannerArticles, nextCard as bannerCard, updates as bannerUpdates } from '../../scripts/lib/whats-new.mjs'
import { label as bannerLabel, pickRecent, stamp as bannerStamp } from '../../src/lib/whatsNew.js'
// The Dynasty page's own value curve. Plain JavaScript, so it loads as it is.
import { VALUE_LAMBDA, VALUE_TOP, buildScale, displayValue } from '../../src/lib/dynastyValue.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BUDGET = 1048576 // 1 MB on disk for the whole section
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8')
const json = (file) => JSON.parse(read(file))

const articlesDir = path.join(ROOT, 'src/data/articles')
const sources = {
  news: json('public/news.json'),
  articles: readdirSync(articlesDir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(path.join(articlesDir, f), 'utf8'))),
  contentJs: read('src/data/content.js'),
  dynastyPlayers: json('public/dynasty/players.json'),
  dynastyValueJs: read('src/lib/dynastyValue.js'),
  dynastyApiJs: read('api/dynasty.js'),
  // What the banner's build step gathers, uploads aside (scripts/lib/whats-new.mjs).
  whatsNewItems: [...bannerArticles(ROOT), ...bannerUpdates(ROOT), ...bannerCard(ROOT)],
  whatsNewJs: read('src/lib/whatsNew.js'),
  keepDays: KEEP_DAYS,
  now: Date.now(),
}
// Through JSON once, because that is what gets published.
const publish = (out) => JSON.parse(JSON.stringify(out))
const built = publish(buildSiteApi(sources))
// Draft Savant's files, for the names of trending prospects. Basketball Savant's index is
// built from a 70 MB file this check does not load; its stand-in is made from the Dynasty
// list, whose players carry their NBA ids, in the same shape.
const draftBuilt = publish(buildDraftApi({ data: json('public/data.json'), html: read('public/draft-savant.html') }))
const bsIndex = {
  schema: 1,
  count: 0,
  players: json('public/dynasty/players.json').players.map((p) => ({ id: p.id, name: p.name, pos: p.pos, team: p.team, from: '2025-26', to: '2025-26', seasons: 1 })),
}

const pages = {
  app: read('src/App.jsx'),
  news: read('src/pages/News.jsx'),
  rankings: read('src/pages/Rankings.jsx'),
  articleDetail: read('src/pages/ArticleDetail.jsx'),
  articleCard: read('src/components/ArticleCard.jsx'),
  published: read('src/data/publishedArticles.js'),
  dynasty: read('src/pages/Dynasty.jsx'),
  siteJs: read('api/_site.js'),
  home: read('src/pages/Home.jsx'),
  basketball: read('public/basketball-savant.html'),
  draft: read('public/draft-savant.html'),
}

let compared = 0
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); compared++ }
const tally = (label, since) => console.log(`      ${label}: ${(compared - since).toLocaleString('en-US')} values compared`)

// ---- content.js, the way the site itself loads it ------------------------------------

// The real src/data/content.js, byte for byte, imported by Node as the ES module it is. The
// one thing Node cannot do is import.meta.glob, so the real publishedArticles.js runs beside
// it with that single call replaced by the same files read from disk. Its sort is the page's.
const sandbox = mkdtempSync(path.join(os.tmpdir(), 'savant-site-'))
async function loadRealContent() {
  writeFileSync(path.join(sandbox, 'package.json'), '{"type":"module"}')
  copyFileSync(path.join(ROOT, 'src/data/content.js'), path.join(sandbox, 'content.js'))
  const glob = "import.meta.glob('./articles/*.json', { eager: true })"
  assert.ok(pages.published.includes(glob), 'publishedArticles.js no longer loads ./articles/*.json through import.meta.glob')
  const modules = Object.fromEntries(sources.articles.map((a, i) => [`./articles/${i}.json`, { default: a }]))
  writeFileSync(path.join(sandbox, 'publishedArticles.js'), pages.published.replace(glob, JSON.stringify(modules)))
  return import(pathToFileURL(path.join(sandbox, 'content.js')).href)
}

// ---- a stand-in for the site ---------------------------------------------------------

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Upstash Redis over REST, as far as api/dynasty.js uses it to answer action=board. Every
// command is recorded, so a write that is not the handler's own seeding would be seen.
const store = { down: false, commands: [], rating: new Map(), prev: new Map(), seen: new Map(), streak: new Map(), n: 0, z: new Map() }
const flat = (map) => [...map.entries()].flatMap(([k, v]) => [k, String(v)])
// Highest score first; equal scores in reverse order of member, as ZREVRANGE gives them.
const byScore = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
const boardOrder = () => byScore(store.rating)
// The search counter's sorted sets (api/trending.js): one per namespace per day, and the
// scratch unions its read builds.
function trendRedis(op, key, args) {
  if (op === 'ZUNIONSTORE') {
    const n = Number(args[0])
    const keys = args.slice(1, 1 + n)
    const w = args[1 + n] === 'WEIGHTS' ? args.slice(2 + n, 2 + 2 * n).map(Number) : keys.map(() => 1)
    const out = new Map()
    keys.forEach((k, i) => { for (const [m, s] of store.z.get(k) || []) out.set(m, (out.get(m) || 0) + s * w[i]) })
    store.z.set(key, out)
    return out.size
  }
  if (op === 'EXPIRE') return 1
  if (op === 'ZREVRANGE') return byScore(store.z.get(key) || new Map()).slice(args[0], args[1] + 1).flatMap(([m, s]) => [m, String(s)])
  if (op === 'ZMSCORE') return args.map((m) => { const s = (store.z.get(key) || new Map()).get(m); return s == null ? null : String(s) })
  throw new Error(`the stand-in store has no ${op} for the search counter`)
}
function redis(cmd) {
  store.commands.push(cmd[0])
  const [op, key, ...args] = cmd
  if (/^(bs|dr):trend:/.test(String(key))) return trendRedis(op, key, args)
  if (op === 'ZCARD') return store.rating.size
  if (op === 'HGETALL') return flat({ 'dyn:prev': store.prev, 'dyn:seen': store.seen, 'dyn:streak': store.streak }[key] || new Map())
  if (op === 'GET') return key === 'dyn:n' ? String(store.n) : null
  if (op === 'LRANGE') return []
  if (op === 'ZREVRANGE') return boardOrder().slice(args[0], args[1] + 1).flatMap(([id, score]) => [id, String(score)])
  if (op === 'ZADD') { // ZADD key NX score member ...: only members that are absent
    for (let i = 1; i + 1 < args.length; i += 2) if (!store.rating.has(args[i + 1])) store.rating.set(args[i + 1], Number(args[i]))
    return 0
  }
  if (op === 'HSET') { for (let i = 0; i + 1 < args.length; i += 2) store.prev.set(args[i], args[i + 1]); return 0 }
  throw new Error(`the stand-in store has no ${op}`)
}
const upstash = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (store.down || req.headers.authorization !== 'Bearer check-token') { res.writeHead(500); return res.end('down') }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(req.url === '/pipeline' ? body.map((cmd) => ({ result: redis(cmd) })) : { result: redis(body) }))
})

// The site: the built files, the homepage for anything else (what the live catch-all does,
// with a 200), the seed list api/dynasty.js fetches, and /api/dynasty itself.
const site = { files: built, hits: 0, api: [], feed: 'live', seedList: true, delay: 0, canned: null, trend: 'live', league: 'live' }
let handlers = null // api/dynasty.js three times: with a store, with one it has never seeded, and with none
let trending = null // api/trending.js with the stand-in store, and with none
let league = null   // api/league.js, which reaches the platforms through the stand-ins below
// A function as Vercel calls it.
function vercel(req, res, url) {
  req.query = Object.fromEntries(url.searchParams)
  req.headers['x-forwarded-proto'] = 'http'
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
}
const www = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://site')
  if (url.pathname === '/api/trending' || url.pathname === '/api/league') {
    let bytes = 0
    for await (const c of req) bytes += c.length
    site.api.push({ method: req.method, path: url.pathname, query: url.search, bytes })
    const mode = url.pathname === '/api/trending' ? site.trend : site.league
    if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Sign in</title>') }
    if (mode === 'http500') { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('FUNCTION_INVOCATION_FAILED') }
    vercel(req, res, url)
    return url.pathname === '/api/trending' ? trending[mode](req, res) : league(req, res)
  }
  if (url.pathname.startsWith('/api/')) {
    let bytes = 0
    for await (const c of req) bytes += c.length
    site.api.push({ method: req.method, path: url.pathname, query: url.search, bytes })
    if (site.delay) await sleep(site.delay)
    if (site.feed === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Sign in</title>') }
    if (site.feed === 'http500') { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('FUNCTION_INVOCATION_FAILED') }
    if (site.feed === 'canned') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(site.canned)) }
    // The function as Vercel calls it.
    req.query = Object.fromEntries(url.searchParams)
    req.headers['x-forwarded-proto'] = 'http'
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
    return handlers[{ unconfigured: 'off', fresh: 'fresh' }[site.feed] || 'on'](req, res)
  }
  if (url.pathname === '/dynasty/players.json') {
    if (!site.seedList) { res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(sources.dynastyPlayers))
  }
  // The two Savant sections' files the trending list puts names to.
  const other = { '/savant-api/basketball/v1/players.json': bsIndex, '/savant-api/draft/v1/meta.json': draftBuilt.meta, '/savant-api/draft/v1/prospects.json': draftBuilt.prospects }[url.pathname]
  if (other) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(other)) }
  site.hits++
  const p = decodeURIComponent(url.pathname).replace(`/${BASE}/`, '')
  const article = p.match(/^articles\/(.+)\.json$/)
  const f = site.files
  const body = { 'meta.json': f.meta, 'news.json': f.news, 'articles.json': f.articles, 'big-board.json': f.bigBoard, 'dynasty.json': f.dynasty, 'whats-new.json': f.whatsNew }[p] || (article && f.texts[article[1]])
  if (!body) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>WCE</title>') }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
})

// ---- the fantasy platforms, stood in for ---------------------------------------------

// api/league.js reaches Sleeper, ESPN and Fantrax itself. In this check those three hosts
// answer from here, with leagues made of the Dynasty list's own players spelled the way a
// platform might spell them. The connector never reaches them (pinned below): it asks the
// site's /api/league, which is the real handler.
const PLATFORM_HOSTS = new Set(['api.sleeper.app', 'lm-api-reads.fantasy.espn.com', 'www.fantrax.com'])
const platformCalls = []

// A name as a platform might write it: with accents, with a Jr. added or dropped, in
// capitals, as the surname alone, or as it is.
function respell(name, k) {
  switch (k % 9) {
    case 1: return name.replace(/e/, 'é').replace(/c(?=[^c]*$)/, 'ć')
    case 2: return / (Jr\.|Sr\.|II|III|IV)$/.test(name) ? name.replace(/ (Jr\.|Sr\.|II|III|IV)$/, '') : `${name} Jr.`
    case 3: return name.toUpperCase()
    case 4: return name.split(' ').slice(-1)[0]
    case 5: return name.replace(/\./g, '')
    default: return name
  }
}
const SLEEPER_POS = (pos, k) => (k % 5 === 0 ? [] : k % 5 === 1 && pos === 'PG' ? ['PG', 'SG'] : k % 5 === 2 && pos === 'SF' ? ['SF', 'PF'] : [pos])
function makeLeagues() {
  const rnd = mulberry(4242)
  const dyn = json('public/dynasty/players.json').players
  const shuffled = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
  // Sleeper's player list: every Dynasty player under a Sleeper id, some respelled, and ten
  // players the Dynasty list does not have.
  const dict = {}
  dyn.forEach((p, k) => { dict[`S${p.id}`] = { full_name: respell(p.name, k), fantasy_positions: SLEEPER_POS(p.pos, k) } })
  for (let k = 0; k < 10; k++) dict[`X${k}`] = { full_name: `Unlisted Player ${k}`, fantasy_positions: ['C'] }
  const sleeperLeague = (teams, perTeam, positions) => {
    const pool = shuffled(dyn.map((p) => `S${p.id}`))
    const rosters = Array.from({ length: teams }, (_, t) => ({
      roster_id: t + 1,
      owner_id: `owner${t + 1}`,
      players: [...pool.slice(t * perTeam, (t + 1) * perTeam), ...(t % 3 === 0 ? [`X${t % 10}`] : []), ...(t === 1 ? [pool[t * perTeam]] : [])],
    }))
    return { rosters, users: rosters.map((r, t) => ({ user_id: r.owner_id, display_name: `Team ${String.fromCharCode(65 + t)}` })), league: { name: `WCE Check League ${teams}`, roster_positions: positions } }
  }
  const leagues = {
    '1111111111111': sleeperLeague(12, 14, ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL', 'UTIL', 'BN', 'BN', 'BN', 'IR']),
    '2222222222222': sleeperLeague(10, 16, ['PG', 'SG', 'SF', 'PF', 'C', 'SUPER_FLEX', 'UTIL', 'BN', 'BN', 'TAXI']),
    '3333333333333': sleeperLeague(8, 30, ['C', 'C', 'G', 'F', 'UTIL', 'BN']),
    '4444444444444': { rosters: [], users: [], league: { name: 'No rosters yet' } },
  }
  const users = { wcefan: { user_id: 'fan1' }, twoleagues: { user_id: 'fan2' }, lonely: { user_id: 'fan3' } }
  const userLeagues = { fan1: [{ league_id: '1111111111111', name: 'WCE Check League 12' }], fan2: [{ league_id: '1111111111111', name: 'WCE Check League 12' }, { league_id: '2222222222222', name: 'WCE Check League 10' }], fan3: [] }
  // ESPN: positions by lineup-slot number, as league.js reads them.
  const ESPN = { PG: [0, 5], SG: [1, 5], SF: [2, 6], PF: [3, 6], C: [4] }
  const pool = shuffled(dyn)
  const espn = {
    teams: Array.from({ length: 10 }, (_, t) => ({
      id: t + 1,
      location: `City ${t + 1}`,
      nickname: 'Fives',
      roster: { entries: pool.slice(t * 13, (t + 1) * 13).map((p, k) => ({ playerPoolEntry: { player: { fullName: respell(p.name, k + t), eligibleSlots: [...(ESPN[p.pos] || []), 11, 12] } } })) },
    })),
  }
  // Fantrax: "Last, First" names and comma-separated positions.
  const fantraxIds = {}
  dyn.forEach((p, k) => { const parts = p.name.split(' '); fantraxIds[`F${p.id}`] = { name: parts.length > 1 ? `${parts.slice(1).join(' ')}, ${parts[0]}` : p.name, position: k % 4 === 0 ? `${p.pos},UT` : p.pos } })
  const fpool = shuffled(dyn)
  const fantrax = { rosters: Object.fromEntries(Array.from({ length: 8 }, (_, t) => [`t${t}`, { teamName: `Fantrax Team ${t + 1}`, rosterItems: fpool.slice(t * 12, (t + 1) * 12).map((p) => ({ id: `F${p.id}` })) }])) }
  return { dict, leagues, users, userLeagues, espn, fantraxIds, fantrax }
}
const fx = makeLeagues()

function platformAnswer(url) {
  platformCalls.push(url.host)
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const p = url.pathname
  let m
  if (url.host === 'api.sleeper.app') {
    if (p === '/v1/players/nba') return reply(fx.dict)
    if ((m = p.match(/^\/v1\/user\/([^/]+)$/))) return reply(fx.users[m[1]] || null)
    if ((m = p.match(/^\/v1\/user\/([^/]+)\/leagues\/nba\/\d{4}$/))) return reply(fx.userLeagues[m[1]] || [])
    if ((m = p.match(/^\/v1\/league\/(\d+)(\/rosters|\/users)?$/))) {
      const lg = fx.leagues[m[1]]
      if (!lg) return reply(null, 404)
      return reply(m[2] === '/rosters' ? lg.rosters : m[2] === '/users' ? lg.users : lg.league)
    }
  }
  if (url.host === 'lm-api-reads.fantasy.espn.com') {
    // League 777 is a private one: ESPN answers outsiders with a 401.
    if (p.endsWith('/leagues/777')) return reply({ messages: ['Not authorized'] }, 401)
    if (p.endsWith('/leagues/4040')) return reply(fx.espn)
  }
  if (url.host === 'www.fantrax.com') {
    if (p === '/fxea/general/getPlayerIds') return reply(fx.fantraxIds)
    if (p === '/fxea/general/getTeamRosters' && url.searchParams.get('leagueId') === 'fxleague1') return reply(fx.fantrax)
    if (p === '/fxea/general/getTeamRosters') return reply({ error: 'no such league' })
  }
  return reply(null, 404)
}
const realFetch = globalThis.fetch

let core
let section
let content
let tool
const savedFeed = {}

before(async () => {
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    return PLATFORM_HOSTS.has(url.host) ? Promise.resolve(platformAnswer(url)) : realFetch(input, init)
  }
  process.env.KV_REST_API_URL = `http://127.0.0.1:${await listen(upstash)}`
  process.env.KV_REST_API_TOKEN = 'check-token'
  const on = (await import('../../api/dynasty.js?store=on')).default
  const fresh = (await import('../../api/dynasty.js?store=fresh')).default // has never seeded a board
  const trendOn = (await import('../../api/trending.js?store=on')).default
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]
  const off = (await import('../../api/dynasty.js?store=off')).default
  handlers = { on, off, fresh }
  trending = { live: trendOn, off: (await import('../../api/trending.js?store=off')).default }
  league = (await import('../../api/league.js')).default

  process.env.SAVANT_API_ORIGIN = `http://127.0.0.1:${await listen(www)}`
  core = await import('../../api/_core.js')
  section = await import('../../api/_site.js')
  content = await loadRealContent()
  tool = Object.fromEntries(section.tools.map((t) => [t.name, t]))
  Object.assign(savedFeed, { ttlMs: section.dynastyFeed.ttlMs, staleMs: section.dynastyFeed.staleMs, retryMs: section.dynastyFeed.retryMs, timeoutMs: section.dynastyFeed.timeoutMs })
})

after(() => {
  globalThis.fetch = realFetch
  for (const server of [www, upstash]) { server.close(); server.closeAllConnections() }
  rmSync(sandbox, { recursive: true, force: true })
})

// Forget everything held in memory and put the site back to normal.
function reset({ files = built } = {}) {
  Object.assign(site, { files, feed: 'live', seedList: true, delay: 0, canned: null, trend: 'live', league: 'live' })
  Object.assign(section.dynastyFeed, savedFeed)
  store.down = false
  core.clearCache()
  section.dynastyFeed.clear()
  section.trendingFeed.clear()
}

// A tool's run(), with the answer checked against the tool's own declared shape.
async function run(name, args = {}) {
  const t = tool[name]
  const input = z.object(t.config.inputSchema).strict().parse(args)
  const out = await t.run(input)
  assert.equal(typeof out.text, 'string')
  z.object(t.config.outputSchema).strict().parse(out.structured)
  assert.ok(out.text.length < 12500, `${name} ${JSON.stringify(args)}: ${out.text.length} characters is too long an answer`)
  assert.ok(Array.isArray(out.structured.notes) && out.structured.notes.length, `${name}: notes`)
  return out
}

// A refusal: a SavantError that says something useful and gives nothing internal away.
async function refuses(promise, pattern, label) {
  let err = null
  try { await promise } catch (e) { err = e }
  assert.ok(err, `${label}: expected a refusal`)
  assert.ok(err instanceof core.SavantError, `${label}: expected a SavantError, got ${err && err.stack}`)
  assert.match(err.message, pattern, label)
  assert.doesNotMatch(err.message, /ECONNREFUSED|127\.0\.0\.1|localhost|ETIMEDOUT|AbortError|node:|\.js:\d|redis|upstash|\bat [\w.]+ \(/i, `${label}: leaks internals`)
  return err.message
}

// ---- 0. the pages still work the way this section assumes ----------------------------

test('the rules that live inline in the pages are still there', () => {
  const pin = (source, text, what) => assert.ok(source.includes(text), `${what} changed: expected to find ${JSON.stringify(text)}`)

  // News.jsx: where it reads, the tab link, the two cuts, and each field it renders.
  pin(pages.news, "fetch('/news.json'", 'where the News page reads its items')
  pin(pages.news, "searchParams.get('tab') === 'analytics' ? 'analytics' : 'headlines'", 'the News tab link')
  pin(pages.news, "tab === 'analytics' ? data.analytics || [] : data.headlines || []", 'the two News lists')
  pin(pages.news, 'players.slice(0, 3).map', 'the three-chip cut')
  pin(pages.news, "{item.authors.slice(0, 4).join(', ')}", 'the four-author cut')
  pin(pages.news, "{item.authors.length > 4 ? ' et al.' : ''}", 'the "et al." rule')
  pin(pages.news, "const isPaper = item.source_type === 'paper'", 'the Paper / Article rule')
  pin(pages.news, "{isPaper ? 'Paper' : 'Article'}", 'the Paper / Article labels')
  pin(pages.news, '<Eyebrow outlet={item.outlet} published={item.published}', 'the outlet and date line')
  pin(pages.news, 'href={item.url}', 'the headline link')
  pin(pages.news, '<WceSummary line={item.wce_line} players={item.players} />', 'the player chips, and the WCE note the tools leave out')
  pin(pages.news, '<AlsoCovered outlets={item.also_covered_by} />', 'the "Also covered by" line')
  pin(pages.news, 'href={p.savant_url}', 'the chip link')
  pin(pages.news, 'Headlines and abstracts belong to their original outlets and link back to the source.', 'the News attribution footer')

  // Rankings.jsx: which board it opens on, the order, the framing, and each field.
  pin(pages.rankings, 'useState(DRAFT_YEARS[0].year)', 'the board the page opens on')
  pin(pages.rankings, 'const { prospects, tiers } = DRAFT_CLASSES[year]', 'where the Big Board reads')
  pin(pages.rankings, 'prospects.filter((p) => p.tier === t.tier).map', 'the Big Board order')
  pin(pages.rankings, 'eyebrow="Personal Big Board · Not a Consensus Mock"', 'the Big Board eyebrow')
  pin(pages.rankings, 'Rankings are evaluation-based, not predictions of draft slot.', 'the Big Board footnote')
  for (const field of ['{p.name}', '{p.school} · {p.position}', '{p.height} / {p.wingspan}', '{p.grade}', '▲ {p.tag}', '{p.summary}', 'p.strengths.map', 'p.weaknesses.map', '{p.weight}', 'Age {p.age}', '{p.archetype}', '{p.projection}', '{p.take}']) {
    pin(pages.rankings, field, `the Big Board row (${field})`)
  }
  // No link opens a year or a prospect: the year is component state.
  assert.doesNotMatch(pages.rankings, /useSearchParams|useParams|location\.hash/, 'the Big Board gained a deep link: the tool could use it')

  // Articles: what counts as published, the byline, the link.
  pin(read('src/data/content.js'), 'export const ARTICLES = PUBLISHED_ARTICLES', 'where ARTICLES comes from')
  pin(pages.articleDetail, 'const hasBody = Boolean(article.html)', 'the rule that tells a published article from a demo one')
  pin(pages.articleDetail, 'const authorName = article.author || FOUNDER.name', 'the byline rule')
  pin(pages.articleDetail, '<ArticleBody html={article.html} />', 'the article body')
  pin(pages.articleCard, 'to={`/articles/${article.slug}`}', 'the article link')
  for (const field of ['{article.category}', '{article.title}', '{article.excerpt}', '{article.date}', '{article.readTime}']) pin(pages.articleCard, field, `the article card (${field})`)
  pin(read('scripts/lib/seo-build.mjs'), "const dir = path.join(root, 'src', 'data', 'articles')", 'where the build finds articles')

  // The routes every link points at.
  for (const route of ['path="/news"', 'path="/rankings"', 'path="/articles"', 'path="/articles/:slug"', 'path="/dynasty"']) pin(pages.app, `<Route ${route}`, `the route ${route}`)

  // Dynasty.jsx: what it asks for, what it lists, how it prices and labels a row.
  pin(pages.dynasty, 'fetch(`${API}?action=board&limit=600`)', 'the board the Dynasty page asks for')
  pin(pages.dynasty, "const API = '/api/dynasty'", 'the Dynasty endpoint')
  pin(pages.dynasty, 'const scale = useMemo(() => buildScale(rows.map((r) => r.rating)), [rows])', 'the value scale')
  pin(pages.dynasty, 'const val = useCallback((rating) => displayValue(scale, rating), [scale])', 'the value of a rating')
  pin(pages.dynasty, 'rows.slice(0, 120).map((r) => {', 'how many rows the board lists')
  pin(pages.dynasty, '<span className="dyn-mono text-[11px] text-[var(--dyn-faint)]">{r.rank}</span>', 'the rank column')
  pin(pages.dynasty, '{p.name || `#${r.id}`}', 'the name column')
  pin(pages.dynasty, '{val(r.rating).toLocaleString()}', 'the value column')
  pin(pages.dynasty, '{r.seen || 0}', 'the volume column')
  pin(pages.dynasty, '{Math.abs(r.streak) >= 2 && (', 'the run badge')
  pin(pages.dynasty, '? `First in ${r.streak} straight books', 'what a run means')
  pin(pages.dynasty, 'Opening prices come from Hashtag Basketball’s points-league dynasty ranking.', 'the credit for the opening prices')
  pin(pages.dynasty, 'Vol is how many books an asset has appeared in', 'what Vol means')
  pin(pages.dynasty, 'every number here is what the crowd’s picks imply.', 'what a value is')

  // api/dynasty.js: the board's shape, its two "not available" answers, and the ceiling.
  pin(sources.dynastyApiJs, 'const BOARD_MAX = 600', 'the board ceiling')
  pin(sources.dynastyApiJs, 'if (!URL || !TOKEN) { res.status(200).json({ configured: false }); return }', 'the answer with no store')
  pin(sources.dynastyApiJs, 'res.status(200).json({ configured: false, error: String(e && e.message || e) })', 'the answer when the store fails')
  pin(sources.dynastyApiJs, 'configured: true, seeded: rows.length > 0, total, board: rows,', 'the board answer')
  pin(sources.dynastyApiJs, "['HINCRBY', 'dyn:seen', id, 1]", 'what "seen" counts')

  // Why the tool leaves out the page's "24h" change: the snapshot it is measured against is
  // written in one place only, when a player is first listed, and never rolled. If this
  // fails, someone added the daily roll, and the change can be reported after all.
  assert.equal(sources.dynastyApiJs.split("'dyn:prev'").length - 1, 3, "api/dynasty.js touches 'dyn:prev' somewhere new")
  assert.equal((sources.dynastyApiJs.match(/\['HSET', 'dyn:prev'\]/g) || []).length, 1, 'dyn:prev is now written in more than one place')

  // What the banner shows, and how it is gathered: the tool's list is this one minus uploads.
  pin(pages.home, 'const recent = pickRecent(WHATS_NEW.items).map((it) => ({ text: label(it), tag: stamp(it), fresh: it.fresh, to: it.to, href: it.href }))', 'how the banner picks its lines')
  pin(read('scripts/lib/whats-new.mjs'), 'const all = [...articles(root), ...updates(root), ...nextCard(root), ...(await videos(root, warn, status))]', 'what the banner gathers')
  pin(read('scripts/lib/whats-new.mjs'), 'return all.filter((it) => Date.parse(it.date) >= cutoff).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))', 'the banner\'s 45-day cut and order')

  // The trending chips: what each page asks for, which ids it keeps, and how many it draws.
  pin(pages.basketball, "fetch(TREND_API,{cache:'no-store'})", 'what Basketball Savant asks /api/trending for')
  pin(pages.basketball, "items=j.top.map(function(t){var e=PIDX[asId(t.id)];return e?{p:e.ref,trend:t.trend||'flat'}:null;}).filter(Boolean);", 'the ids Basketball Savant keeps')
  pin(pages.draft, "fetch(TREND_API+'?ns=dr',{cache:'no-store'})", 'what Draft Savant asks /api/trending for')
  pin(pages.draft, "items=j.top.map(function(t){var p=byId(t.id);return p?{p:p,trend:t.trend||'flat'}:null;}).filter(Boolean); }", 'the ids Draft Savant keeps')
  for (const page of [pages.basketball, pages.draft]) pin(page, 'items.slice(0,6).forEach(function(it,i){', 'how many chips a page draws')
  const trendJs = read('api/trending.js')
  pin(trendJs, 'const DAYS = 7', 'the trending window')
  pin(trendJs, 'const weights = keys.map((_, i) => DAYS - i)            // today heaviest -> ranking', 'the trending weights')
  pin(trendJs, "const rKeys = keys.slice(0, 3), pKeys = keys.slice(3, 7)", 'the trend windows')
  pin(trendJs, 'if (rawR + rawP >= 2) {', 'the fewest picks that can make a trend')
  pin(trendJs, "trend = ratio >= 1.3 ? 'up' : ratio <= 0.7 ? 'down' : 'flat'", 'what rising and cooling off mean')

  // A connected league: how the Dynasty page asks for one, what it says when it cannot, and
  // what its two orders mean.
  pin(pages.dynasty, "const qs = new URLSearchParams({ platform, code: code.trim() })", 'what the Dynasty page asks /api/league for')
  pin(pages.dynasty, "if (leagueId) qs.set('league', leagueId)", 'how the Dynasty page picks a league')
  pin(pages.dynasty, 'fetch(`/api/league?${qs}`)', 'the league reader')
  for (const said of ["'no-user': 'No Sleeper user with that username.'", "'no-leagues': 'That account has no NBA leagues we can see.'", "'no-league': 'Could not read that league. If it is private, paste your roster instead.'", "'empty': 'That league came back with no rosters yet.'", "'bad-code': 'That does not look like a valid code.'", "}[j.error] || 'Could not reach that league. Paste your roster instead.')"]) pin(pages.dynasty, said, 'what the Dynasty page says when a league cannot be read')
  pin(pages.dynasty, '? `Best possible lineup for each team at ${leagueRanks.slots.join(\' / \')} — every roster is optimised, not taken as currently set, so this compares ceilings rather than who remembered to set their lineup.`', 'what the lineup order means')
  pin(pages.dynasty, ": 'Every rostered player, summed. Measures accumulated equity, which rewards depth a starting lineup never plays.'}", 'what the roster order means')
  pin(pages.dynasty, '{[...leagueRanks.teams].sort((a, b) => b[rankMode] - a[rankMode]).map((t, i, arr) => {', 'the two orders')
  assert.doesNotMatch(pages.siteJs, /sleeper\.app|fantasy\.espn|fantrax\.com/, 'api/_site.js names a fantasy platform: it should only ever ask /api/league')

  // The tool's own promises, in its source: one fetch, a GET, and only ever action=board.
  assert.equal((pages.siteJs.match(/\bfetch\(/g) || []).length, 1, 'api/_site.js should make exactly one kind of request itself')
  pin(pages.siteJs, "method: 'GET'", 'the Dynasty request method')
  assert.deepEqual([...new Set(pages.siteJs.match(/action=\w+/g))], ['action=board'], 'api/_site.js names an action other than board')
  assert.doesNotMatch(pages.siteJs, /POST|lobby|nonce/, 'api/_site.js mentions something only a vote or a room needs')
  // The two numbers the slicer reads out of source text are the numbers the code really uses,
  // and the description's "10,000" is the curve's real top.
  same(built.dynasty.value, { top: VALUE_TOP, lambda: VALUE_LAMBDA }, 'the value curve constants')
  pin(sources.dynastyApiJs, '// picks after which a player is considered settled', 'what PROVISIONAL_N means')
  same(built.dynasty.provisional_below, Number(sources.dynastyApiJs.match(/^const PROVISIONAL_N = (\d+)/m)[1]), 'the settled count')
  assert.match(tool.wce_get_dynasty_rankings.config.description, new RegExp(`top of the board is ${VALUE_TOP.toLocaleString('en-US')}\\)`))
})

// ---- 1. news -------------------------------------------------------------------------

// What News.jsx puts on screen for one item, written from its JSX rather than from the slicer.
// All of it but the "WCE" note, which is held back (see the test below).
function newsAsRendered(item, tab) {
  const shown = { title: item.title, url: item.url, outlet: item.outlet, published: item.published }
  if (tab === 'headlines') {
    shown.chips = (item.players || []).slice(0, 3).map((p) => ({ name: p.name, url: SITE + p.savant_url }))
    shown.also = item.also_covered_by || []
  } else {
    shown.label = item.source_type === 'paper' ? 'Paper' : 'Article'
    shown.authors = (item.authors || []).slice(0, 4)
    shown.etAl = (item.authors || []).length > 4
  }
  return shown
}

const madeAt = new Date(sources.news.generated_at)
const madeStamp = `${madeAt.toISOString().slice(0, 10)} ${madeAt.toISOString().slice(11, 16)} UTC`

// Every item the tool returns for a news file, against what the page would render from it.
async function newsMatchesThePage(news) {
  for (const tab of ['headlines', 'analytics']) {
    const raw = news[tab]
    assert.ok(raw.length > 0, `news.json has no ${tab}`)
    const got = []
    for (let start = 1; start <= raw.length; start += 25) {
      const { structured: s, text } = await run('wce_get_news', { section: tab, start, limit: 25 })
      assert.equal(s.section, tab)
      assert.equal(s.total, raw.length)
      same(s.generated_at, news.generated_at, `${tab}: generated_at`)
      assert.equal(s.url, tab === 'analytics' ? `${SITE}/news?tab=analytics` : `${SITE}/news`)
      // The date the list was made is in the first line, whichever page of it this is.
      assert.ok(text.split('\n')[0].includes(`generated ${madeStamp}`), `${tab}: the first line states when the list was generated`)
      for (const it of s.items) assert.ok(text.includes(it.title) && text.includes(it.url), `${tab} #${it.position}: title and link are in the text`)
      assert.ok(text.includes('Each item belongs to the outlet named and links to that outlet\'s story.') && s.notes.length === 2, `${tab}: says whose stories these are`)
      got.push(...s.items)
    }
    assert.equal(got.length, raw.length, `${tab}: every item is reachable`)
    got.forEach((it, i) => {
      const page = newsAsRendered(raw[i], tab)
      const where = `${tab} #${i + 1} (${raw[i].id})`
      assert.equal(it.position, i + 1, `${where}: the page's order`)
      same(it.title, page.title, `${where}: title`)
      same(it.url, page.url, `${where}: link`)
      same(it.outlet, page.outlet, `${where}: outlet`)
      same(it.published, page.published, `${where}: date`)
      if (tab === 'headlines') {
        same(it.players, page.chips, `${where}: player chips`)
        same(it.also_covered_by, page.also, `${where}: also covered by`)
        assert.equal(it.type, undefined)
      } else {
        same(it.type, page.label, `${where}: Paper / Article`)
        same(it.authors, page.authors, `${where}: authors`)
        same(it.et_al, page.etAl, `${where}: et al.`)
        assert.equal(it.players, undefined)
      }
      // Nothing beyond what the page shows: no abstract, no story text, no extra field.
      assert.deepEqual(Object.keys(it).sort(), (tab === 'headlines'
        ? ['also_covered_by', 'outlet', 'players', 'position', 'published', 'title', 'url']
        : ['authors', 'et_al', 'outlet', 'position', 'published', 'title', 'type', 'url']), `${where}: fields`)
    })
  }
}

test('every News item is the item the page renders, field for field', async () => {
  reset()
  const since = compared
  await newsMatchesThePage(sources.news)
  assert.equal(built.news.dropped, 0, 'a News item was dropped for having no title or link')

  // The pipeline never writes more than three players or, so far, more than four authors, so
  // the page's two cuts are held to a copy of the file that goes past both.
  const more = structuredClone(sources.news)
  more.headlines[0].players = [1, 2, 3, 4, 5].map((i) => ({ name: `Player ${i}`, savant_url: `/basketball-savant.html?p=${i}` }))
  more.headlines[1].players = []
  more.headlines[1].also_covered_by = []
  more.analytics[0].authors = ['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six']
  more.analytics[1].authors = ['A One', 'B Two', 'C Three', 'D Four']
  more.analytics[2].authors = []
  more.analytics[2].source_type = 'paper'
  more.analytics[3].source_type = 'something new'
  reset({ files: { ...built, news: publish(buildSiteApi({ ...sources, news: more })).news } })
  await newsMatchesThePage(more)
  const cut = await run('wce_get_news', { section: 'analytics', limit: 4 })
  assert.deepEqual(cut.structured.items.map((it) => [it.authors.length, it.et_al, it.type]), [[4, true, more.analytics[0].source_type === 'paper' ? 'Paper' : 'Article'], [4, false, more.analytics[1].source_type === 'paper' ? 'Paper' : 'Article'], [0, false, 'Paper'], [more.analytics[3].authors.length, false, 'Article']])
  assert.match(cut.text, /By A One, B Two, C Three, D Four et al\.\n/)
  assert.match(cut.text, /By A One, B Two, C Three, D Four\.\n/)
  const chips = await run('wce_get_news', { limit: 2 })
  assert.deepEqual(chips.structured.items[0].players.map((p) => p.name), ['Player 1', 'Player 2', 'Player 3'])
  assert.doesNotMatch(chips.text.split('\n2. ')[1].split('\n\n')[0], /Players named|Also covered/, 'an item with no chips or other outlets shows none')
  reset()
  tally('news', since)
})

test('the "WCE" note under a News item is held back: in no file, in no answer, and recorded without comment', async () => {
  reset()
  // The page shows it and the pipeline still writes it. Whether the connector carries it is
  // an editorial decision that has not been made, so until it is, it goes nowhere.
  const lines = [...sources.news.headlines, ...sources.news.analytics].map((it) => it.wce_line).filter(Boolean)
  assert.ok(lines.length > 0, 'news.json no longer carries wce_line: this test and the meta.json entry can go')

  const files = JSON.stringify(built)
  assert.doesNotMatch(files, /"wce_(?:line|note)":/, 'a built file has the field')
  for (const line of lines) assert.ok(!files.includes(line), `a built file carries a WCE note: "${line.slice(0, 50)}"`)

  for (const tab of ['headlines', 'analytics']) {
    for (let start = 1; start <= sources.news[tab].length; start += 25) {
      const { structured: s, text } = await run('wce_get_news', { section: tab, start, limit: 25 })
      const answer = text + JSON.stringify(s)
      for (const line of lines) assert.ok(!answer.includes(line), `${tab}: an answer carries a WCE note: "${line.slice(0, 50)}"`)
      assert.doesNotMatch(answer, /WCE:|wce_note|wce_line/, `${tab}: an answer has the field`)
    }
  }
  const news = tool.wce_get_news.config
  assert.deepEqual(Object.keys(news.outputSchema.items.element.shape).filter((k) => /wce|note/.test(k)), [], 'the output schema declares it')
  assert.doesNotMatch(news.description, /note|WCE.s (?:own|one)|read under/i, 'the description mentions it')
  assert.doesNotMatch(pages.siteJs, /wce_note|wce_line/, 'api/_site.js reads the field')

  // meta.json says it is left out and why, and says nothing else about it.
  const entry = built.meta.not_published.find((n) => n.what.includes('wce_line'))
  assert.ok(entry, 'meta.json does not record that the note is left out')
  assert.equal(entry.why, 'left out pending an editorial decision on whether the connector carries it')
  // The same goes for wherever the two source files mention it.
  const mentions = [pages.siteJs, read('scripts/lib/savant-api-site.mjs')].flatMap((src) => {
    const all = src.split('\n')
    return all.flatMap((line, i) => (/"WCE" note|wce_line/.test(line) ? [all.slice(i, i + 3).join(' ')] : []))
  })
  assert.ok(mentions.length >= 3, 'the two source files no longer say the note is left out')
  for (const said of [JSON.stringify(entry), ...mentions]) {
    assert.doesNotMatch(said, /machine|automat|generated|language model|\bLLM\b|ollama|editor\b|wrong|unchecked|nobody checked/i, 'the reason is stated neutrally')
  }
})

test('a News answer says how old the list is, and says so first', async () => {
  reset()
  const made = madeAt.getTime()
  const day = 86400000
  const cases = [
    [made + 3600 * 1000, 0, false, /less than a day ago\.$/],
    [made + 1.5 * day, 1, false, /1 day ago\.$/],
    [made + 2.9 * day, 2, false, /2 days ago\.$/],
    [made + 3 * day, 3, true, /3 days ago\. It has not been refreshed since, so it is a snapshot from that date and not current news\.$/],
    [made + 62.9 * day, 62, true, /62 days ago\. It has not been refreshed since/],
  ]
  for (const [now, days, stale, line] of cases) {
    const { structured: s, text } = await section.getNews({ section: 'headlines', limit: 1 }, now)
    assert.equal(s.age_days, days)
    assert.equal(s.stale, stale, `${days} days old`)
    assert.match(text.split('\n')[0], line)
    assert.ok(text.startsWith(`WCE News, Headlines. This list was generated ${madeStamp}, `))
    assert.equal(s.notes[0], text.split('\n')[0].replace('WCE News, Headlines. ', ''), 'the same sentence is the first note')
  }
  // By the real clock, whatever it says.
  const today = await run('wce_get_news', {})
  assert.equal(today.structured.stale, Date.now() - made >= 3 * day)
  console.log(`      news.json was generated ${madeStamp}: ${today.structured.age_days} days old today, ${today.structured.stale ? 'reported as stale' : 'reported as fresh'}`)

  const n = sources.news.headlines.length
  await refuses(run('wce_get_news', { start: n + 1 }), new RegExp(`The Headlines list has ${n} items\\. Ask for a start of ${n} or lower\\.`), 'start past the end')
  // An empty list is what the page calls it, not an error.
  reset({ files: { ...built, news: { ...built.news, analytics: [] } } })
  const empty = await run('wce_get_news', { section: 'analytics' })
  assert.equal(empty.structured.count, 0)
  assert.match(empty.text, /The list is empty/)
  assert.ok(empty.text.split('\n')[0].includes(`generated ${madeStamp}`))
})

test('the slicer refuses a news file it cannot date, and drops an item it could not link', () => {
  const news = structuredClone(sources.news)
  delete news.generated_at
  assert.throws(() => buildSiteApi({ ...sources, news }), /generated_at is missing/)
  assert.throws(() => buildSiteApi({ ...sources, news: { generated_at: sources.news.generated_at, headlines: [] } }), /expected \{ generated_at, headlines, analytics \}/)

  const odd = structuredClone(sources.news)
  odd.headlines[0].url = 'javascript:alert(1)'
  odd.headlines[1].title = '   '
  odd.headlines[2].players = [{ name: 'A', savant_url: 'https://elsewhere.example/x' }, { name: 'B', savant_url: '//evil.example' }, { name: 'C', savant_url: '/basketball-savant.html?p=1' }, { name: 'D', savant_url: '/basketball-savant.html?p=2' }]
  const out = buildSiteApi({ ...sources, news: odd })
  assert.equal(out.news.dropped, 2)
  assert.equal(out.news.headlines.length, sources.news.headlines.length - 2)
  assert.deepEqual(out.news.headlines[0].players, [{ name: 'C', url: `${SITE}/basketball-savant.html?p=1` }], 'only links to the site itself become chips, from the first three')
})

// ---- 2. articles ---------------------------------------------------------------------

// An article's words, read out of its HTML a second way: tags away, entities back.
const INLINE = /<\/?(?:strong|em|b|i|u|a|span|sup|sub|code)\b[^>]*>/gi
function wordsOfHtml(html) {
  return html.replace(/<img\b[^>]*>/gi, ' ').replace(INLINE, '').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split(/\s+/).filter(Boolean)
}
const wordsOfText = (text) => text.replace(/\[image\]/g, ' ').split(/\s+/).filter(Boolean)

test('every published article is the article the site shows: card, byline and every word', async () => {
  reset()
  const since = compared
  // The site's own list, in the site's own order (content.js, loaded by Node).
  const live = content.ARTICLES
  assert.ok(live.length >= 1, 'the site has no published articles')
  assert.deepEqual(built.articles.articles.map((a) => a.slug), live.map((a) => a.slug), 'the same articles, newest first')
  same(built.articles.categories, content.CATEGORIES, 'categories')

  const listed = await run('wce_search_articles', { limit: 25 })
  assert.equal(listed.structured.total, live.length)
  assert.equal(listed.structured.published, live.length)

  for (const [i, a] of live.entries()) {
    assert.ok(a.html, `${a.slug}: a published article has a body`)
    assert.match(a.slug, SLUG)
    const c = listed.structured.articles[i]
    // The card (ArticleCard.jsx) and the byline (ArticleDetail.jsx).
    same(c.slug, a.slug, `${a.slug}: slug`)
    same(c.title, a.title, `${a.slug}: title`)
    same(c.category, a.category, `${a.slug}: category`)
    same(c.summary, a.excerpt, `${a.slug}: excerpt`)
    same(c.date, a.date, `${a.slug}: date`)
    same(c.read_time, a.readTime, `${a.slug}: read time`)
    same(c.author, a.author || content.FOUNDER.name, `${a.slug}: byline`)
    same(c.url, `${SITE}/articles/${a.slug}`, `${a.slug}: link`)
    assert.deepEqual(Object.keys(c).sort(), ['author', 'category', 'date', 'read_time', 'slug', 'summary', 'title', 'url'])

    // The article itself, by slug, by link and by title.
    for (const ask of [a.slug, `${SITE}/articles/${a.slug}`, a.title]) {
      const { structured: s, text } = await run('wce_get_article', { article: ask })
      same(s.slug, a.slug, `${ask}: resolves`)
      same(s.title, a.title, `${a.slug}: title`)
      same(s.author, a.author || content.FOUNDER.name, `${a.slug}: byline`)
      same(s.published_at, a.publishedAt, `${a.slug}: published`)
      const whole = built.texts[a.slug].text
      // Every word of the body, in order, and no other word.
      same(wordsOfText(whole), wordsOfHtml(a.html), `${a.slug}: the words`)
      same(s.images, (a.html.match(/<img\b/gi) || []).length, `${a.slug}: pictures`)
      same((whole.match(/\[image\]/g) || []).length, s.images, `${a.slug}: one marker per picture`)
      same(s.words, wordsOfHtml(a.html).length, `${a.slug}: word count`)
      assert.doesNotMatch(whole, /<[a-z/!]|&(?:amp|nbsp|lt|gt|quot|#\d+);/i, `${a.slug}: no markup left in the text`)
      if (whole.length <= section.ARTICLE_CAP) {
        assert.equal(s.truncated, false)
        same(s.text, whole, `${a.slug}: the whole text is returned`)
        same(s.words_returned, s.words, `${a.slug}: words returned`)
      } else {
        assert.equal(s.truncated, true)
        assert.ok(whole.startsWith(s.text) && s.text.length <= section.ARTICLE_CAP)
      }
      assert.ok(text.includes(s.text) && text.includes(s.url) && text.includes(`By ${s.author}`))
    }
  }
  tally('articles', since)
})

test('article bodies become text without losing or inventing a word', () => {
  const { text, images } = htmlToText([
    '<h2>Heading &amp; more</h2>',
    '<p>One <strong>bold</strong>word, a <a href="https://example.com/x">link</a>, a bare <a href="https://example.com/y">https://example.com/y</a> and 5 &lt; 6&nbsp;&gt;&#8201;4.<br/>Next line<img src="/a.png" alt="A chart" /></p>',
    '<ul><li>first</li><li>second <em>item</em></li></ul>',
    '<table><tr><th>Player</th><th>PPG</th></tr><tr><td>A</td><td>20.1</td></tr></table>',
    '<!-- note --><script>alert(1)</script><p>Tail&hellip; &#x41;&unknown;</p>',
  ].join('\n'))
  assert.equal(images, 1)
  assert.equal(text, [
    'Heading & more',
    'One boldword, a link (https://example.com/x), a bare https://example.com/y and 5 < 6 > 4.\nNext line [image: A chart]',
    '- first\n- second item',
    'Player | PPG\nA | 20.1',
    'Tail… A&unknown;',
  ].join('\n\n'))
  assert.deepEqual(htmlToText(''), { text: '', images: 0 })
  assert.deepEqual(htmlToText(null), { text: '', images: 0 })
})

// A made-up shelf: the real article beside ones that must and must not be published.
const LONG = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1}. ${'This sentence pads the paragraph out to a believable length. '.repeat(5).trim()}</p>`).join('\n')
const shelf = [
  ...sources.articles,
  { slug: 'the-long-read', title: 'The Long Read on Rim Protection', category: 'Scouting', excerpt: 'A long one.', author: null, date: 'Sep 1, 2026', publishedAt: '2026-09-01T12:00:00.000Z', readTime: '12 min read', html: LONG },
  { slug: 'rim-protection-part-two', title: 'Rim Protection, Part Two', category: 'Scouting', excerpt: 'More of it.', author: 'Jane Doe', date: 'Sep 8, 2026', publishedAt: '2026-09-08T12:00:00.000Z', readTime: '2 min read', html: '<p>Short and real.</p>' },
  // What the site's template shipped with: a card and no body.
  { slug: 'demo-article', title: 'Why The Draft Is Broken', category: 'Draft', excerpt: 'Demo copy.', date: 'Jun 1, 2026', readTime: '6 min read' },
  { slug: 'Bad Slug!', title: 'Bad slug', excerpt: 'x', html: '<p>Body.</p>' },
  { slug: 'no-title', excerpt: 'x', html: '<p>Body.</p>' },
  { slug: 'only-pictures', title: 'Only pictures', html: '<p><img src="/x.png" alt="" /></p>' },
  { slug: 'rim-protection-part-two', title: 'An older article with the same slug', date: 'Jan 1, 2026', publishedAt: '2026-01-01T00:00:00.000Z', html: '<p>Older.</p>' },
  // The site opens the newest article with a slug. Here that one has no body, so the older one
  // behind it can never be reached on the site, and must not be reachable here.
  { slug: 'shadowed', title: 'Newer, and no body', date: 'Sep 20, 2026', publishedAt: '2026-09-20T00:00:00.000Z' },
  { slug: 'shadowed', title: 'Older, with a body', date: 'Mar 1, 2026', publishedAt: '2026-03-01T00:00:00.000Z', html: '<p>Hidden behind the newer one.</p>' },
]

test('an article with no body, a bad slug or a reused slug is not published; a long one is cut and says so', async () => {
  const made = publish(buildSiteApi({ ...sources, articles: shelf }))
  // The two published fixtures interleave with the real articles by date, newest first.
  const fixtures = [{ slug: 'rim-protection-part-two', publishedAt: '2026-09-08T12:00:00.000Z' }, { slug: 'the-long-read', publishedAt: '2026-09-01T12:00:00.000Z' }]
  const order = [...fixtures, ...sources.articles].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).map((a) => a.slug)
  assert.deepEqual(made.articles.articles.map((a) => a.slug), order, 'newest first, and only the real ones')
  assert.deepEqual(Object.keys(made.texts).sort(), [...order].sort())
  const why = Object.fromEntries(made.meta.not_published.map((n) => [n.what, n.why]))
  assert.match(why['article "demo-article"'], /no body/)
  assert.match(why['article "Bad Slug!"'], /slug/)
  assert.match(why['article "no-title"'], /no title/)
  assert.match(why['article "only-pictures"'], /no words/)
  assert.match(why['article "rim-protection-part-two"'], /already uses this slug/)
  assert.deepEqual(made.meta.not_published.filter((n) => n.what === 'article "shadowed"').map((n) => n.why.slice(0, 14)), ['it has no body', 'a newer articl'])
  assert.doesNotMatch(JSON.stringify(made.articles) + JSON.stringify(made.texts), /shadowed|Hidden behind/)
  assert.equal(made.texts['rim-protection-part-two'].text, 'Short and real.', 'the newer of two with one slug is the one the site routes to')
  // With no author the page prints the founder's name, read from content.js.
  assert.equal(made.texts['the-long-read'].author, content.FOUNDER.name)

  reset({ files: made })
  const long = await run('wce_get_article', { article: 'the-long-read' })
  assert.equal(long.structured.truncated, true)
  assert.ok(long.structured.text.length <= section.ARTICLE_CAP)
  assert.ok(made.texts['the-long-read'].text.startsWith(`${long.structured.text}\n\nParagraph`), 'cut on a paragraph break, nothing reworded')
  assert.ok(long.structured.words_returned < long.structured.words)
  assert.match(long.text, new RegExp(`Only the first ${long.structured.words_returned.toLocaleString('en-US')} of its ${long.structured.words.toLocaleString('en-US')} words are returned\\. The rest is at ${SITE}/articles/the-long-read\\.`))
  assert.ok(long.structured.notes.some((n) => n.startsWith('Only the first')), 'the same caveat travels in the notes')

  // Search: every word must be found; categories are the site's; newest first with no query.
  const all = await run('wce_search_articles', {})
  assert.deepEqual(all.structured.articles.map((a) => a.slug), order)
  const rim = await run('wce_search_articles', { query: 'rim protecton' }) // typo
  assert.deepEqual(rim.structured.articles.map((a) => a.slug), ['rim-protection-part-two', 'the-long-read'])
  assert.equal((await run('wce_search_articles', { query: 'Jane Doe' })).structured.articles[0].slug, 'rim-protection-part-two')
  assert.deepEqual((await run('wce_search_articles', { category: 'scouting', limit: 1 })).structured, { ...(await run('wce_search_articles', { category: 'Scouting', limit: 1 })).structured })
  assert.equal((await run('wce_search_articles', { category: 'Scouting' })).structured.total, 2)
  const none = await run('wce_search_articles', { query: 'zzzz qqqq' })
  assert.equal(none.structured.total, 0)
  assert.match(none.text, /No WCE article matching "zzzz qqqq"\. WCE has \d+ published articles; search with no query to list them\./)
  assert.equal((await run('wce_search_articles', { query: 'demo copy' })).structured.total, 0, 'the demo card is not searchable')

  await refuses(run('wce_search_articles', { category: 'Gossip' }), /"Gossip" is not one of the site's article categories\. They are: Draft, NBA, /, 'unknown category')
  // A title two articles share words with lists both, by slug.
  const two = await refuses(run('wce_get_article', { article: 'rim protection' }), /2 articles could be "rim protection"\. Call again with one of these slugs:/, 'ambiguous title')
  assert.match(two, /- rim-protection-part-two: Rim Protection, Part Two \(Sep 8, 2026\)\n- the-long-read: The Long Read on Rim Protection \(Sep 1, 2026\)/)
  // A near spelling of one title is offered back, never opened, even though nothing else is close.
  const near = await refuses(run('wce_get_article', { article: 'Rim Protecton, Part Two' }), /^"Rim Protecton, Part Two" is not an exact title\. Call again with one of these slugs:\n- rim-protection-part-two: Rim Protection, Part Two \(Sep 8, 2026\)$/, 'a near spelling of a title')
  assert.doesNotMatch(near, /the-long-read/)
  assert.equal((await run('wce_get_article', { article: 'Rim Protection, Part Two' })).structured.slug, 'rim-protection-part-two')
  await refuses(run('wce_get_article', { article: 'demo-article' }), /No WCE article matches "demo-article"/, 'the demo article')
  await refuses(run('wce_get_article', { article: 'why the draft is broken' }), /No WCE article matches/, 'the demo article by title')
  await refuses(run('wce_get_article', { article: `${SITE}/articles/nope` }), /No WCE article matches/, 'an unknown link')
  reset()
})

// ---- 3. the Big Board ----------------------------------------------------------------

const DASH = '—'
// What the page prints for a measurement, with its dash read as "not listed".
const printed = (v) => (v === DASH || v == null ? null : String(v))

test('every prospect on every board is the row the page renders, in the page\'s order', async () => {
  reset()
  const since = compared
  assert.equal(built.bigBoard.default_year, content.DRAFT_YEARS[0].year)
  assert.deepEqual(built.bigBoard.years.map((y) => y.year), content.DRAFT_YEARS.map((y) => y.year))
  let profiles = 0

  for (const y of content.DRAFT_YEARS) {
    const { prospects, tiers } = content.DRAFT_CLASSES[y.year]
    // Rankings.jsx: tiers.map(t => prospects.filter(p => p.tier === t.tier))
    const order = tiers.flatMap((t) => prospects.filter((p) => p.tier === t.tier))
    assert.equal(order.length, prospects.length, `${y.year}: a prospect sits in a tier the page does not list`)

    const { structured: s, text } = await run('wce_get_big_board', { year: y.year })
    same([s.year, s.label, s.sublabel, s.status], [y.year, y.label, y.sublabel, y.status], `${y.year}: the year menu's labels`)
    same(s.prospect_count, prospects.length, `${y.year}: prospects`)
    same(s.tiers, tiers.map((t) => ({ tier: t.tier, name: t.name, range: t.range, blurb: t.blurb })), `${y.year}: tiers`)
    assert.equal(s.view, 'board')
    assert.equal(s.url, `${SITE}/rankings`)
    assert.deepEqual(s.other_years.map((o) => o.year), content.DRAFT_YEARS.filter((o) => o.year !== y.year).map((o) => o.year))
    assert.match(text, /personal big board, not a consensus mock/)
    assert.equal(s.prospects.length, order.length)

    for (const [i, p] of order.entries()) {
      const row = s.prospects[i]
      const where = `${y.year} #${p.rank} ${p.name}`
      // The collapsed row.
      same(row.rank, p.rank, `${where}: rank`)
      same(row.tier, p.tier, `${where}: tier`)
      same(row.name, p.name, `${where}: name`)
      same(row.school, printed(p.school), `${where}: school`)
      same(row.position, printed(p.position), `${where}: position`)
      same(row.height, printed(p.height), `${where}: height`)
      same(row.wingspan, printed(p.wingspan), `${where}: wingspan`)
      same(row.grade, printed(p.grade), `${where}: grade`)
      assert.deepEqual(Object.keys(row).sort(), ['grade', 'height', 'name', 'position', 'rank', 'school', 'tier', 'wingspan'], `${where}: the board view carries the row only`)

      // The opened row, asked for by name and by rank.
      for (const ask of [p.name, String(p.rank)]) {
        const one = await run('wce_get_big_board', { year: y.year, prospect: ask })
        profiles++
        const w = one.structured.prospects[0]
        assert.equal(one.structured.prospects.length, 1)
        assert.equal(one.structured.view, 'prospect')
        same(w.name, p.name, `${where} (asked "${ask}"): resolves`)
        same([w.rank, w.tier, w.school, w.position, w.height, w.wingspan, w.grade], [p.rank, p.tier, printed(p.school), printed(p.position), printed(p.height), printed(p.wingspan), printed(p.grade)], `${where}: row`)
        same(w.weight, printed(p.weight), `${where}: weight`)
        same(w.age, printed(p.age), `${where}: age`)
        same(w.archetype, printed(p.archetype), `${where}: archetype`)
        same(w.tag, p.tag ?? null, `${where}: tag`)
        same(w.summary, p.summary, `${where}: summary`)
        same(w.strengths, p.strengths, `${where}: strengths`)
        same(w.weaknesses, p.weaknesses, `${where}: weaknesses`)
        same(w.projection, p.projection, `${where}: projection`)
        same(w.take, p.take, `${where}: take`)
        same(one.structured.tiers, [tiers.find((t) => t.tier === p.tier)].map((t) => ({ tier: t.tier, name: t.name, range: t.range, blurb: t.blurb })), `${where}: his tier`)
        // The words are in the text as written.
        for (const line of [p.summary, p.projection, p.take, ...p.strengths, ...p.weaknesses]) assert.ok(one.text.includes(line), `${where}: "${line.slice(0, 40)}..." is in the text`)
        for (const m of ['height', 'wingspan', 'weight', 'age']) {
          if (printed(p[m]) == null) assert.match(one.text, new RegExp(`${m} not listed`, 'i'), `${where}: a dash is "not listed", never a number`)
        }
      }
    }
  }
  // With no year the page's opening board comes back.
  const opened = await run('wce_get_big_board', {})
  assert.equal(opened.structured.year, content.DRAFT_YEARS[0].year)
  console.log(`      ${profiles} write-ups read`)
  tally('big board', since)
  assert.ok(compared - since > 2000)
})

test('the Big Board says what it is, and when its draft has come and gone', async () => {
  reset()
  const cls = built.bigBoard.years.find((y) => y.draft_date)
  assert.ok(cls, 'no board carries a draft date in its label')
  assert.equal(cls.draft_date, '2026-06-23')
  const before = await section.getBigBoard({ year: cls.year }, Date.UTC(2026, 5, 23, 18))
  assert.equal(before.structured.notes.length, 1)
  assert.doesNotMatch(before.text, /has passed/)
  const later = await section.getBigBoard({ year: cls.year }, Date.UTC(2026, 9, 2))
  assert.match(later.text, /The site lists this draft for 2026-06-23, which has passed\. The board ranks prospects by evaluation and does not say where anyone was picked\./)
  assert.equal(later.structured.notes.length, 2)
  assert.equal(later.structured.draft_date, '2026-06-23')
  // No pick, team or draft slot anywhere in the data: the note is true.
  for (const y of content.DRAFT_YEARS) for (const p of content.DRAFT_CLASSES[y.year].prospects) assert.deepEqual(Object.keys(p).filter((k) => /pick|slot|team|drafted/i.test(k)), [])
})

test('prospects are found the way people type them, and a shared name is never guessed', async () => {
  reset()
  const first = async (prospect, year) => (await run('wce_get_big_board', { prospect, ...(year ? { year } : {}) })).structured
  assert.equal((await first('wagler')).prospects[0].name, 'Keaton Wagler')
  assert.equal((await first('mikel brown')).prospects[0].name, 'Mikel Brown Jr.')         // no "Jr."
  assert.equal((await first('MOREZ JOHNSON JR')).prospects[0].name, 'Morez Johnson Jr.')   // case, no full stop
  assert.equal((await first('st johns', 2026).catch(() => null)), null)                    // a school is not a name
  assert.equal((await first('#5')).prospects[0].name, 'Keaton Wagler')
  // Not on the opening board, so the other boards are searched, and the answer names the year.
  const flagg = await first('Cooper Flagg')
  assert.equal(flagg.year, 2025)
  assert.equal(flagg.prospects[0].rank, 1)
  const accented = content.DRAFT_YEARS.flatMap((y) => content.DRAFT_CLASSES[y.year].prospects.map((p) => [y.year, p.name])).filter(([, n]) => /[^\u0020-\u007e]/.test(n))
  for (const [year, name] of accented) {
    const plain = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    assert.equal((await first(plain, year)).prospects[0].name, name, `${name} without its accents`)
  }

  // A near spelling is offered back, never opened: not when it is the only candidate, not
  // with two letters swapped, not on a board found by searching past the opening one.
  for (const [typed, year, list] of [
    ['Dybansta', undefined, /^"Dybansta" is not an exact match on the 2026 NBA Draft board\. Call again with one of these names:\n- AJ Dybantsa \(No\. 1, BYU\)$/],
    ['Keaton Walger', 2026, /^"Keaton Walger" is not an exact match on the 2026 NBA Draft board\. Call again with one of these names:\n- Keaton Wagler \(No\. 5, Illinois\)$/],
    ['Coper Flagg', undefined, /^"Coper Flagg" is not an exact match on the 2025 NBA Draft board\. Call again with one of these names:\n- Cooper Flagg \(No\. 1, Duke\)$/],
  ]) {
    await refuses(run('wce_get_big_board', { prospect: typed, ...(year ? { year } : {}) }), list, `near spelling "${typed}"`)
  }
  // But a near spelling on the opening board does not stand in the way of the exact name on
  // another. (A made-up 2025 prospect one letter from a 2026 one.)
  const twin = structuredClone(built)
  twin.bigBoard.years[1].prospects[3].name = 'Keaton Wagner'
  reset({ files: twin })
  const wagner = await first('Keaton Wagner')
  assert.deepEqual([wagner.year, wagner.prospects[0].name], [2025, 'Keaton Wagner'])
  assert.deepEqual([(await first('Keaton Wagler')).year, (await first('wagler')).prospects[0].name], [2026, 'Keaton Wagler'])
  // The start of a name is a sure match, as it is everywhere on the connector.
  assert.equal((await first('Cooper Flag')).prospects[0].name, 'Cooper Flagg')
  await refuses(run('wce_get_big_board', { prospect: 'Keaton Wagher' }), /^"Keaton Wagher" is not an exact match on the 2026 NBA Draft board\. Call again with one of these names:\n- Keaton Wagler \(No\. 5, Illinois\)$/, 'near on both boards: the opening board\'s candidates are offered')
  reset()

  const shared = await refuses(run('wce_get_big_board', { prospect: 'Cameron' }), /2 prospects on the 2026 NBA Draft board could be "Cameron"\. Call again with one of these names:/, 'a shared first name')
  assert.match(shared, /- Cameron Boozer \(No\. 2, Duke\)\n- Cameron Carr \(No\. 18, Baylor\)/)
  await refuses(run('wce_get_big_board', { prospect: 'jr' }), /prospects on the 2026 NBA Draft board could be "jr"/, 'a suffix alone')
  await refuses(run('wce_get_big_board', { prospect: 'Zzyzx Qwerty' }), /No prospect on the Big Board matches "Zzyzx Qwerty"\. It has: 2026 NBA Draft \(Barclays Center · Jun 23, 2026\), 2025 NBA Draft \(Preview Archive\)\./, 'unknown prospect')
  await refuses(run('wce_get_big_board', { prospect: '99', year: 2026 }), /No prospect on the 2026 NBA Draft board matches "99"\. That board has 36 prospects\./, 'a rank past the end')
  await refuses(run('wce_get_big_board', { prospect: 'Cooper Flagg', year: 2026 }), /No prospect on the 2026 NBA Draft board matches "Cooper Flagg"/, 'right name, wrong year')
  await refuses(run('wce_get_big_board', { year: 2019 }), /The Big Board has no 2019 class\. It has: 2026 NBA Draft/, 'a year with no board')
})

test('content.js is read whole, and a change the slicer cannot follow is an error', () => {
  // The slicer's reading of content.js and Node's agree on everything it uses.
  const mine = readContent(sources.contentJs)
  for (const name of ['CATEGORIES', 'DRAFT_YEARS', 'DRAFT_CLASSES', 'FOUNDER', 'TIERS_2026', 'PROSPECTS_2025']) {
    assert.deepEqual(mine[name], JSON.parse(JSON.stringify(content[name])), name)
  }
  assert.throws(() => readContent(`import x from './other.js'\n${sources.contentJs}`), /an import this script cannot follow: import x from '\.\/other\.js'/)
  assert.throws(() => readContent(`${sources.contentJs}\nexport default {}\n`), /exports something other than "export const"/)
  assert.throws(() => readContent(sources.contentJs.replace('export const DRAFT_YEARS', 'export const DRAFT_SEASONS')), /could not be evaluated|no longer exports DRAFT_YEARS/)
  assert.throws(() => readContent(''), /content\.js is empty/)
  assert.throws(() => buildSiteApi({ ...sources, contentJs: sources.contentJs.replace(/rank: 1, tier: 1, name: 'AJ Dybantsa'/, "rank: 1, tier: 1, name: ''") }), /a 2026 prospect has no rank or name/)
})

// ---- 4. template copy stays out ------------------------------------------------------

test('no template copy reaches a file or an answer', async () => {
  reset()
  // Everything in content.js that no live page shows, and ArticleDetail.jsx's stock article.
  const template = [
    ...content.NEWS_ITEMS.flatMap((n) => [n.headline, n.blurb, n.id]),
    ...content.PODCASTS.flatMap((p) => [p.title, p.description, p.slug]),
    content.PODCAST_SHOW.name, content.PODCAST_SHOW.tagline,
    content.NEWSLETTER_COPY.heading, content.NEWSLETTER_COPY.body, content.FOUNDER.bio,
    ...[...pages.articleDetail.matchAll(/^\s+"((?:[^"\\]|\\.){60,})",?$/gm)].map((m) => JSON.parse(`"${m[1]}"`)),
    ...[...pages.articleDetail.matchAll(/^\s+'((?:[^'\\]|\\.){60,})'$/gm)].map((m) => m[1]),
  ]
  assert.ok(template.length > 50, 'the template copy could not be collected')
  assert.ok(template.some((s) => s.startsWith('Strip the noise away')) && template.some((s) => s.startsWith('Bet on translatable skills')), 'ArticleDetail.jsx\'s stock paragraphs were not found')
  // Every social link is real since Oct 21, 2026 (the footer and Contact page show them). No tool returns
  // any of them. A link added or removed fails here so the question is asked again.
  assert.deepEqual(content.SOCIALS.filter((s) => s.href !== '#').map((s) => s.label), ['YouTube', 'Instagram', 'TikTok', 'X / Twitter', 'Threads', 'Bluesky'], 'SOCIALS changed: decide whether it belongs in an answer')

  const haystacks = [['the built files', JSON.stringify(built)]]
  // Every page of both News lists (a second page only when the list runs past 25).
  const newsPages = ['headlines', 'analytics'].flatMap((section) => Array.from({ length: Math.ceil(sources.news[section].length / 25) }, (_, i) => ['wce_get_news', { section, start: 1 + 25 * i, limit: 25 }]))
  const answers = [
    ...newsPages,
    ['wce_search_articles', {}], ['wce_get_big_board', {}], ['wce_get_big_board', { year: 2025 }], ['wce_whats_new', {}],
    ...built.articles.articles.map((a) => ['wce_get_article', { article: a.slug }]),
  ]
  for (const [name, args] of answers) {
    const out = await run(name, args)
    haystacks.push([`${name} ${JSON.stringify(args)}`, out.text + JSON.stringify(out.structured)])
  }
  for (const [where, hay] of haystacks) {
    for (const s of template) assert.ok(!hay.includes(s), `${where} contains template copy: "${s.slice(0, 60)}"`)
    assert.doesNotMatch(hay, /"(?:href|url)":"#"/, `${where} carries a "#" link`)
  }
  // The audit trail is in meta.json.
  const left = built.meta.not_published.map((n) => n.what)
  for (const name of ['NEWS_ITEMS', 'PODCASTS', 'PODCAST_SHOW', 'SOCIALS']) assert.ok(left.includes(`${name} in src/data/content.js`), `${name} is recorded as left out`)
})

// ---- 5. the Dynasty Exchange ---------------------------------------------------------

// A tiny deterministic generator, so a failing board can be reproduced.
function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const seedPlayers = sources.dynastyPlayers.players
const seedName = Object.fromEntries(seedPlayers.map((p) => [String(p.id), p.name]))

// Put a board in the store: every listed player, plus any extras, each with a rating.
function stock(ratings, { seen = () => 0, streak = () => 0, total = 0 } = {}) {
  store.rating = new Map(ratings)
  store.prev = new Map(ratings.map(([id]) => [id, '1500']))
  store.seen = new Map(ratings.map(([id], i) => [id, seen(i)]).filter(([, n]) => n))
  store.streak = new Map(ratings.map(([id], i) => [id, streak(i)]).filter(([, n]) => n))
  store.n = total
}

// The board as Dynasty.jsx shows it, worked out from the store with the page's own module.
function boardAsRendered() {
  const rows = boardOrder().slice(0, 600).map(([id, score], i) => ({ id, rating: Math.round(score), rank: i + 1, seen: store.seen.get(id) || 0, streak: store.streak.get(id) || 0 }))
  const scale = buildScale(rows.map((r) => r.rating))
  return rows.map((r) => ({
    rank: r.rank,
    id: r.id,
    name: seedName[r.id] || `#${r.id}`,
    value: displayValue(scale, r.rating),
    vol: r.seen,
    run: Math.abs(r.streak) >= 2 ? r.streak : null,
    // Not shown; counted below, to be sure the boards really contain level ratings.
    level: rows.some((o) => o !== r && o.rating === r.rating),
  }))
}

test('the Dynasty board is the page\'s board: same order, names, values and volumes, for every player', async () => {
  const since = compared
  const boards = []
  // The opening board: nothing in the store, so api/dynasty.js seeds it from players.json.
  boards.push(['opening', () => stock([])])
  for (let b = 0; b < 24; b++) {
    boards.push([`moved ${b}`, () => {
      const rnd = mulberry(1000 + b)
      const spread = [1, 8, 40, 150, 400][b % 5]
      // Whole numbers on some boards, so that ties are common; extra unlisted ids on others,
      // some of them past the 600 the page asks for.
      const extras = b % 4 === 3 ? Array.from({ length: [30, 220][(b >> 2) % 2] }, (_, i) => [String(99000000 + i), 0]) : []
      const ratings = [...seedPlayers.map((p) => [String(p.id), p.rating]), ...extras].map(([id, base]) => {
        const r = (base || 1150) + (rnd() - 0.5) * 2 * spread
        return [id, b % 2 ? Math.round(r / 5) * 5 : r]
      })
      stock(ratings, { seen: () => Math.floor(rnd() * 90), streak: () => Math.round((rnd() - 0.5) * 12), total: Math.floor(rnd() * 50000) })
    }])
  }

  let players = 0
  let tied = 0
  for (const [label, fill] of boards) {
    reset()
    fill()
    const { structured: s } = await section.getDynastyRankings({ limit: 600 })
    z.object(tool.wce_get_dynasty_rankings.config.outputSchema).strict().parse(s)
    const page = boardAsRendered()
    assert.equal(s.players.length, page.length, `${label}: every row`)
    same(s.listed, page.length, `${label}: listed`)
    same(s.total_rankings, store.n, `${label}: all-time volume`)
    assert.equal(s.stale, false)
    tied += page.filter((r) => r.level && r.value > 1).length
    for (const [i, r] of page.entries()) {
      const got = s.players[i]
      const where = `${label} #${r.rank} ${r.name}`
      same(got.rank, r.rank, `${where}: rank`)
      same(got.id, r.id, `${where}: id`)
      same(got.name, r.name, `${where}: name`)
      same(got.value, r.value, `${where}: value`)
      same(got.rankings, r.vol, `${where}: volume`)
      same(got.run, r.run, `${where}: run`)
      same(got.provisional, r.vol < built.dynasty.provisional_below, `${where}: provisional`)
      players++
    }
    if (label === 'opening') {
      // What the page would show a first visitor: the seed order, top price 10,000.
      assert.deepEqual(s.players.slice(0, 3).map((p) => [p.name, p.value]), [['Victor Wembanyama', 10000], ['Shai Gilgeous-Alexander', 9753], ['Luka Doncic', 9512]])
      assert.equal(s.players.length, seedPlayers.length)
    }
  }
  console.log(`      ${boards.length} boards, ${players.toLocaleString('en-US')} player rows, ${tied.toLocaleString('en-US')} of them level on rating with another player and priced above the floor`)
  tally('dynasty', since)
  assert.ok(tied > 500, 'the boards had too few level ratings to test the rule that tied players share a value')
})

test('the Dynasty answer reads like the page: top of the board by default, 120 at most, names filtered on request', async () => {
  reset()
  stock(seedPlayers.map((p) => [String(p.id), p.rating]), { seen: (i) => (i < 3 ? 45 : i % 30), streak: (i) => [0, 8, -1, 4, -3][i % 5], total: 2009 })
  const page = boardAsRendered()

  const top = await run('wce_get_dynasty_rankings', {})
  assert.equal(top.structured.count, 25)
  assert.deepEqual(top.structured.players.map((p) => [p.rank, p.name, p.value, p.rankings]), page.slice(0, 25).map((r) => [r.rank, r.name, r.value, r.vol]))
  assert.match(top.text.split('\n')[0], /^Dynasty Exchange, the crowd-priced NBA dynasty board on wcehoops\.com: top 25 of 407 listed\. 2,009 rankings submitted in all\.$/)
  assert.match(top.text, /Read from the live board at \d{4}-\d\d-\d\d \d\d:\d\d UTC\./)
  assert.match(top.text, /A value is a crowd price, not a WCE projection and not advice\./)
  assert.match(top.text, /Opening prices came from Hashtag Basketball's points-league dynasty ranking\./)
  // Three of the 25 are settled, so the other 22 are marked one by one.
  assert.ok(top.text.includes(`provisional until that reaches ${built.dynasty.provisional_below}: 22 of the 25 shown still are, marked "provisional".`))
  assert.match(top.text, /\n {2}1\. Victor Wembanyama: value 10,000, in 45 rankings\n {2}2\. Shai Gilgeous-Alexander: value 9,753, in 45 rankings, ranked first in each of his last 8\n/)
  assert.match(top.text, / {2}5\. .*, ranked last in each of his last 3 \[provisional\]\n/)
  assert.doesNotMatch(top.text, /24h|▲|▼|rating/i, 'the page\'s "24h" change and the raw rating are not reported')
  for (const p of top.structured.players) assert.deepEqual(Object.keys(p).sort(), ['id', 'name', 'provisional', 'rankings', 'rank', 'run', 'value'].sort())
  assert.equal(top.structured.url, `${SITE}/dynasty`)

  const all = await run('wce_get_dynasty_rankings', { limit: 120 })
  assert.equal(all.structured.count, 120)
  assert.deepEqual(all.structured.players.map((p) => p.value), page.slice(0, 120).map((r) => r.value))
  assert.throws(() => z.object(tool.wce_get_dynasty_rankings.config.inputSchema).parse({ limit: 121 }), 'the page lists 120; the tool offers no more')

  // Names: accents, punctuation, suffixes, typos, and a surname four players share.
  const named = async (player) => (await run('wce_get_dynasty_rankings', { player })).structured
  assert.deepEqual((await named('sengun')).players.map((p) => p.name), ['Alperen Sengün'])
  assert.deepEqual((await named('Nikola Jokić')).players.map((p) => p.name), ['Nikola Jokic'])
  assert.deepEqual((await named('pj washington')).players.map((p) => p.name), ['P.J. Washington'])
  assert.deepEqual((await named('dayron sharpe')).players.map((p) => p.name), ["Day'Ron Sharpe"])
  assert.deepEqual((await named('karl anthony towns')).players.map((p) => p.name), ['Karl-Anthony Towns'])
  assert.deepEqual((await named('Jaren Jackson')).players.map((p) => p.name), ['Jaren Jackson Jr.'])
  assert.deepEqual((await named('gilgeous')).players.map((p) => p.name), ['Shai Gilgeous-Alexander'])
  const browns = await named('Brown')
  assert.equal(browns.matched, 4)
  assert.deepEqual(browns.players.map((p) => p.name).sort(), ['Bruce Brown', 'Jaylen Brown', 'Maliq Brown', 'Mikel Brown Jr.'])
  assert.deepEqual(browns.players.map((p) => p.rank), [...browns.players.map((p) => p.rank)].sort((a, b) => a - b), 'in board order')
  for (const p of browns.players) assert.deepEqual([p.value, p.rankings], [page[p.rank - 1].value, page[p.rank - 1].vol], `${p.name}: the same row as on the full board`)
  const byId = await named('1641705')
  assert.deepEqual(byId.players.map((p) => p.name), ['Victor Wembanyama'])
  const some = await run('wce_get_dynasty_rankings', { player: 'williams', limit: 3 })
  assert.equal(some.structured.count, 3)
  assert.ok(some.structured.matched > 3)
  assert.match(some.text, /players matching "williams", showing the first 3 of 407 listed/)
  // A near spelling, or a fragment from the middle of a name, is not priced as if it were
  // the name asked for. The closest names come back instead, in board order.
  await refuses(run('wce_get_dynasty_rankings', { player: 'Wembenyama' }), /^"Wembenyama" is not an exact match for anyone on the Dynasty Exchange\. Call again with one of these names:\n- Victor Wembanyama \(No\. 1\)$/, 'a near spelling')
  await refuses(run('wce_get_dynasty_rankings', { player: 'Naz Ried' }), /^"Naz Ried" is not an exact match for anyone on the Dynasty Exchange\. Call again with one of these names:\n- Naz Reid \(No\. \d+\)$/, 'two letters swapped')
  const jaylen = await refuses(run('wce_get_dynasty_rankings', { player: 'Jaylen Williams' }), /^"Jaylen Williams" is not an exact match for anyone on the Dynasty Exchange\. Call again with one of these names:/, 'a spelling between two players')
  assert.deepEqual(jaylen.split('\n').slice(1).map((l) => l.replace(/^- | \(No\. \d+\)$/g, '')).sort(), ['Jalen Williams', 'Jaylin Williams'])
  await refuses(run('wce_get_dynasty_rankings', { player: 'kounmpo' }), /^"kounmpo" is not an exact match for anyone on the Dynasty Exchange\. Call again with one of these names:\n- Giannis Antetokounmpo \(No\. \d+\)$/, 'a fragment from the middle of a name')
  assert.deepEqual((await named('antetok')).players.map((p) => p.name), ['Giannis Antetokounmpo'], 'the start of a name is a sure match')
  await refuses(run('wce_get_dynasty_rankings', { player: 'Zzyzx Qwerty' }), /No player on the Dynasty Exchange matches "Zzyzx Qwerty"\. It lists 407 NBA players; check the spelling, or try the last name alone\./, 'unknown player')
})

test('the Dynasty tool only reads: one GET with action=board, kept for a minute and a half', async () => {
  reset()
  stock(seedPlayers.map((p) => [String(p.id), p.rating]), { total: 77 })
  const before = site.api.length
  await run('wce_get_dynasty_rankings', {})
  await run('wce_get_dynasty_rankings', { limit: 5 })
  await run('wce_get_dynasty_rankings', { player: 'Cooper Flagg' })
  await Promise.all([run('wce_get_dynasty_rankings', { limit: 9 }), run('wce_get_dynasty_rankings', { player: 'Brown' })])
  assert.equal(site.api.length - before, 1, 'five answers, one read of the board')

  // Two callers at the same moment share one read, too.
  section.dynastyFeed.clear()
  await Promise.all([run('wce_get_dynasty_rankings', {}), run('wce_get_dynasty_rankings', { limit: 3 })])
  assert.equal(site.api.length - before, 2)

  // Once the minute and a half is up the board is read again, and a new price shows.
  section.dynastyFeed.ttlMs = 0
  store.rating.set('1630162', 5000) // Anthony Edwards, to the top
  store.n = 78
  const fresh = await run('wce_get_dynasty_rankings', { limit: 1 })
  assert.deepEqual([fresh.structured.players[0].name, fresh.structured.total_rankings], ['Anthony Edwards', 78])
  assert.equal(site.api.length - before, 3)
})

test('when the board cannot be read the answer says so, and never falls back to something else', async () => {
  const board = () => run('wce_get_dynasty_rankings', {})
  const page = /The board is at https:\/\/wcehoops\.com\/dynasty\./

  // No store configured: api/dynasty.js answers { configured: false }.
  reset(); stock([])
  site.feed = 'unconfigured'
  const off = await refuses(board(), /The Dynasty Exchange's live prices cannot be read right now: the site's pricing feed is offline\. Try again in a few minutes\./, 'store not configured')
  assert.match(off, page)

  // The store is configured but failing: the handler reports its own error the same way.
  reset(); stock([])
  store.down = true
  await refuses(board(), /pricing feed is offline/, 'store failing')

  // The store answers but holds no players, and the seed list cannot be fetched.
  reset(); stock([])
  site.feed = 'fresh'
  site.seedList = false
  const empty = await refuses(board(), /The Dynasty Exchange board has no players on it right now, so there is nothing to rank\./, 'empty board')
  assert.match(empty, page)

  // Slow: given up on, not waited for.
  reset(); stock([])
  section.dynastyFeed.timeoutMs = 150
  site.delay = 900
  const started = Date.now()
  await refuses(board(), /The Dynasty Exchange board could not be read right now\. Try again in a minute\./, 'slow')
  assert.ok(Date.now() - started < 800, 'the tool waited for a slow board')
  await sleep(900) // let the abandoned request finish before the next case

  // Not JSON (a sign-in page with a 200), a failed function, and JSON of the wrong shape.
  for (const [feed, canned, label] of [
    ['html', null, 'an HTML page'],
    ['http500', null, 'a 500'],
    ['canned', 'null', 'null'],
    ['canned', { configured: true, seeded: true, total: 5 }, 'no board'],
    ['canned', { configured: true, seeded: true, total: 5, board: 'soon' }, 'board is not a list'],
    ['canned', { configured: true, seeded: true, total: 5, board: [{ id: '1', rank: 1 }] }, 'a row with no rating'],
    ['canned', { configured: true, seeded: true, total: 5, board: [{ rating: 1500, rank: 1 }] }, 'a row with no id'],
    ['canned', { configured: true, seeded: true, total: 5, board: [{ id: '1', rating: 1500, rank: 0 }] }, 'a row with no rank'],
    ['canned', { error: 'method' }, 'the handler\'s 405 body'],
  ]) {
    reset(); stock([])
    site.feed = feed
    site.canned = canned === 'null' ? null : canned
    await refuses(board(), /The Dynasty Exchange board could not be read right now\. Try again in a minute\./, label)
  }

  // The origin is not there at all.
  reset()
  const origin = process.env.SAVANT_API_ORIGIN
  try {
    await section.getDynastyRankings({}) // dynasty.json is now in memory: only the live read can fail
    process.env.SAVANT_API_ORIGIN = 'http://127.0.0.1:9'
    section.dynastyFeed.clear()
    await refuses(board(), /could not be read right now/, 'origin down')
  } finally {
    process.env.SAVANT_API_ORIGIN = origin
  }

  // A small board is still a board: one player, and two who are level.
  reset()
  site.feed = 'canned'
  site.canned = { configured: true, seeded: true, total: 1, board: [{ id: '203999', rating: 1500, rank: 1, delta: 0, streak: 0, seen: 1, rankDelta: 0 }], recent: [] }
  const solo = await board()
  assert.deepEqual(solo.structured.players, [{ rank: 1, id: '203999', name: 'Nikola Jokic', value: 10000, rankings: 1, provisional: true, run: null }])
  assert.match(solo.text, /top 1 of 1 listed\. 1 ranking submitted in all\./)
  assert.match(solo.text, /provisional until that reaches 40: this one still is\./)
  reset()
  site.feed = 'canned'
  site.canned = { configured: true, seeded: true, total: 9, board: [{ id: '203999', rating: 1500, rank: 1, seen: 50 }, { id: '77', rating: 1500, rank: 2, seen: 60 }], recent: [] }
  const level = await board()
  const both = displayValue(buildScale([1500, 1500]), 1500)
  assert.deepEqual(level.structured.players.map((p) => [p.name, p.value, p.provisional]), [['Nikola Jokic', both, false], ['#77', both, false]])
  assert.match(level.text, /none of those shown is\./)
})

test('a board read a moment ago stands in when a re-read fails, says so, and does not outstay its welcome', async () => {
  reset()
  stock(seedPlayers.map((p) => [String(p.id), p.rating]), { total: 300 })
  const good = await run('wce_get_dynasty_rankings', { limit: 3 })
  assert.equal(good.structured.stale, false)

  section.dynastyFeed.ttlMs = 0 // every call re-reads
  site.feed = 'unconfigured'
  const calls = site.api.length
  const held = await run('wce_get_dynasty_rankings', { limit: 3 })
  assert.equal(held.structured.stale, true)
  assert.deepEqual(held.structured.players, good.structured.players)
  assert.equal(held.structured.as_of, good.structured.as_of, 'the time given is when the board was really read')
  assert.match(held.text, /The board could not be re-read just now, so this is the copy from about 1 minute ago\./)
  assert.equal(site.api.length - calls, 1)
  // A failure is remembered for a few seconds, so a broken store is not hammered either.
  await run('wce_get_dynasty_rankings', { limit: 3 })
  await run('wce_get_dynasty_rankings', { player: 'Brown' })
  assert.equal(site.api.length - calls, 1, 'no second attempt inside the retry window')

  // Past its limit the copy is not used: the answer is the refusal.
  section.dynastyFeed.staleMs = 0
  await refuses(run('wce_get_dynasty_rankings', {}), /pricing feed is offline/, 'a copy too old to stand in')
  section.dynastyFeed.retryMs = 0
  await refuses(run('wce_get_dynasty_rankings', {}), /pricing feed is offline/, 'and again once the retry window is over')
  assert.equal(site.api.length - calls, 2)

  // And when the store comes back, so does the board.
  site.feed = 'live'
  const back = await run('wce_get_dynasty_rankings', { limit: 3 })
  assert.equal(back.structured.stale, false)
  reset()
})

// ---- 5b. trending ------------------------------------------------------------------------

// The search counter's days, as api/trending.js names them, newest first.
function trendDays(ns) {
  const now = Date.now()
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - i * 86400000)
    return `${ns}:trend:${d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()}`
  })
}
// Fill a week of searches: picks[day][id] = count.
function searches(ns, picks) {
  for (const k of [...store.z.keys()]) if (k.startsWith(`${ns}:`)) store.z.delete(k)
  trendDays(ns).forEach((key, day) => store.z.set(key, new Map(Object.entries(picks[day] || {}))))
}

test('the trending lists are the chips each page draws, with the page\'s names, in the counter\'s order', async () => {
  reset()
  const rnd = mulberry(99)
  const bsIds = bsIndex.players.map((p) => String(p.id))
  const draftPlayers = json('public/data.json').players
  const drIds = draftPlayers.map((p) => p.id)
  let lists = 0
  for (let round = 0; round < 12; round++) {
    // A week of picks with some ids the pages cannot name, ties, and every kind of trend.
    const week = (ids) => Array.from({ length: 7 }, (_, day) => Object.fromEntries(Array.from({ length: 6 + Math.floor(rnd() * 10) }, () => [
      rnd() < 0.08 ? `ghost-${Math.floor(rnd() * 5)}` : ids[Math.floor(rnd() * Math.min(ids.length, 30))],
      1 + Math.floor(rnd() * (day < 3 ? 6 : 3)),
    ])))
    searches('bs', week(bsIds))
    searches('dr', week(drIds))
    section.trendingFeed.clear()
    const { structured: s, text } = await run('wce_get_trending', {})
    // What /api/trending answers, from the real handler, read the way the pages read it.
    for (const [list, ns, nameOf] of [[s.lists[0], 'bs', (id) => bsIndex.players.find((p) => String(p.id) === id)], [s.lists[1], 'dr', (id) => draftPlayers.find((p) => p.id === id)]]) {
      const res = await realFetch(`${process.env.SAVANT_API_ORIGIN}/api/trending${ns === 'dr' ? '?ns=dr' : ''}`)
      const j = await res.json()
      const kept = j.top.map((t) => { const p = nameOf(t.id); return p ? { p, trend: t.trend || 'flat', score: t.score, id: t.id } : null }).filter(Boolean)
      same(list.items.map((x) => [x.id, x.name, x.trend, x.weighted_searches]), kept.map((k) => [String(k.id), k.p.name, k.trend, k.score]), `round ${round} ${ns}: the counter's order, as the page keeps it`)
      same(list.items.filter((x) => x.on_home_screen).map((x) => x.id), kept.slice(0, 6).map((k) => String(k.id)), `round ${round} ${ns}: the chips the page draws`)
      same(list.unknown_ids, j.top.length - kept.length, `round ${round} ${ns}: ids the page cannot name`)
      for (const x of list.items) {
        assert.equal(x.url, ns === 'bs' ? `${SITE}/basketball-savant.html?p=${x.id}` : `${SITE}/draft-savant.html`)
        assert.ok(text.includes(`${x.rank}. ${x.name}`), `${x.name} is in the text`)
      }
      lists++
    }
  }
  // The card link is the Basketball Savant section's own.
  const bs = await import('../../api/_basketball.js')
  assert.equal((await run('wce_get_trending', { section: 'players' })).structured.lists[0].items[0].url, bs.cardUrl((await run('wce_get_trending', { section: 'players' })).structured.lists[0].items[0].id))
  // Trends, worked through: up, down, flat, and too few picks to call.
  searches('bs', { 0: { 1641705: 5 }, 1: { 1641705: 5, 1628983: 1 }, 4: { 1628983: 4, 1629029: 1 }, 5: { 1628983: 4 }, 6: { 1630162: 1 } })
  section.trendingFeed.clear()
  const t = (await run('wce_get_trending', { section: 'players' })).structured.lists[0].items
  assert.deepEqual(t.map((x) => [x.name, x.trend]), [['Victor Wembanyama', 'up'], ['Shai Gilgeous-Alexander', 'down'], ['Luka Doncic', 'flat'], ['Anthony Edwards', 'flat']])
  assert.deepEqual(t.map((x) => x.weighted_searches), [5 * 7 + 5 * 6, 6 + 4 * 3 + 4 * 2, 3, 1])
  // An empty week, and the counter off: said, and nothing put in its place.
  searches('dr', {})
  section.trendingFeed.clear()
  const quiet = await run('wce_get_trending', { section: 'prospects' })
  assert.equal(quiet.structured.lists[0].items.length, 0)
  assert.match(quiet.text, /Nobody has been searched for there in the last 7 days\./)
  for (const [mode, re] of [['off', /search counter is offline\. The pages show their own picks meanwhile, which are not search counts\./], ['html', /could not be read right now/], ['http500', /could not be read right now/]]) {
    reset()
    site.trend = mode
    await refuses(run('wce_get_trending', {}), re, `trending ${mode}`)
  }
  // Read once a minute, not once a question.
  reset()
  const before = site.api.length
  await run('wce_get_trending', {})
  await run('wce_get_trending', { section: 'players' })
  await run('wce_get_trending', { section: 'prospects' })
  assert.equal(site.api.length - before, 2, 'one read per list')
  console.log(`      ${lists} trending lists compared with the counter as the pages read it`)
})

// ---- 5c. what's new ----------------------------------------------------------------------

test('what\'s new is the banner\'s list, uploads aside, picked by the banner\'s own rules at every moment', async () => {
  reset()
  // The file holds what the banner's build step gathers, with its cut, in its order.
  const now = sources.now
  const gathered = sources.whatsNewItems.filter((it) => Date.parse(it.date) >= now - KEEP_DAYS * 864e5).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  assert.deepEqual(built.whatsNew.items.map((it) => [it.kind, it.date, it.text]), gathered.map((it) => [it.kind, it.date, it.text]))
  assert.ok(built.whatsNew.items.every((it) => it.kind !== 'video' && it.kind !== 'short'), 'no uploads')
  for (const it of built.whatsNew.items) {
    const src = gathered.find((g) => g.text === it.text && g.date === it.date)
    assert.equal(it.url, SITE + (src.to || src.href), `${it.text}: the banner's link, made absolute`)
  }
  // The real pickRecent, label and stamp, against the tool, every 5 hours over 60 days.
  let moments = 0
  let lines = 0
  const check = async (items) => {
    for (let t = now - 50 * 864e5; t <= now + 10 * 864e5; t += 5 * 3600e3) {
      const { structured: s } = await section.getWhatsNew({}, t)
      const page = pickRecent(items, t)
      same(s.items.map((x) => [x.line, x.tag, x.new, x.date]), page.map((it) => [bannerLabel(it), bannerStamp(it), it.fresh, it.date]), `at ${new Date(t).toISOString()}`)
      moments++
      lines += page.length
    }
  }
  await check(gathered)
  // And over a made-up list where every rule fires: each kind's age and cap, a card's lead
  // and tail, an article dated ahead, ties on a date, the banner's eight lines.
  const day = (d, h = 0) => new Date(now + d * 864e5 + h * 3600e3).toISOString()
  const fake = [
    ...Array.from({ length: 7 }, (_, i) => ({ kind: 'update', date: day(-i * 4).slice(0, 10), product: `Product ${i}`, version: i % 2 ? `1.${i}.0` : undefined, text: `update ${i}`, to: '/hoops' })),
    ...Array.from({ length: 5 }, (_, i) => ({ kind: 'article', date: day(-i * 9, 3), text: `article ${i}`, to: `/articles/a-${i}` })),
    { kind: 'article', date: day(2), text: 'dated ahead', to: '/articles/later' },
    { kind: 'article', date: day(-4).slice(0, 10), text: 'tied with an update', to: '/articles/tie' },
    { kind: 'event', date: day(3).slice(0, 10), text: 'UFC Savant: every fighter on the next card', href: '/ufc-savant.html' },
    { kind: 'event', date: day(20).slice(0, 10), text: 'a card too far off', href: '/ufc-savant.html' },
  ]
  reset({ files: { ...built, whatsNew: publish(buildSiteApi({ ...sources, whatsNewItems: fake })).whatsNew } })
  await check(fake.filter((it) => Date.parse(it.date) >= now - KEEP_DAYS * 864e5).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)))
  reset()
  // The answer as a fan reads it.
  const r = await run('wce_whats_new', {})
  assert.match(r.text, /^What's new on wcehoops\.com, as the homepage banner shows it:/)
  for (const x of r.structured.items) assert.ok(r.text.includes(`- ${x.tag} · ${x.line}`))
  assert.ok(r.structured.notes.some((n) => n.includes('YouTube uploads')), 'says the uploads are left out')
  assert.match(r.text, /product updates 21 days, .*"New" for the first 3 days, at most 8 lines\./)
  // Rules the slicer cannot read stop it.
  assert.throws(() => buildSiteApi({ ...sources, whatsNewJs: sources.whatsNewJs.replace('const FRESH = 3 * DAY', 'const FRESH = THREE_DAYS') }), /FRESH not found/)
  assert.throws(() => buildSiteApi({ ...sources, whatsNewJs: sources.whatsNewJs.replace('update: { days: 21, max: 4 }', 'update: { max: 4 }') }), /the rule for "update" not found/)
  console.log(`      ${moments} moments, ${lines} banner lines compared with the banner's own pickRecent, label and stamp`)
})

// ---- 5d. a fan's fantasy league ----------------------------------------------------------

// Dynasty.jsx's own code for a connected league, lifted out of the page and run as it is:
// SLOT_OK, DEFAULT_SLOTS, bestLineup(), the priceList() closure and the leagueRanks memo.
function closingBrace(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') { for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++ }
    else if (ch === '/' && src[i + 1] === '/') i = src.indexOf('\n', i)
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}
function pageLeague(lg, rows) {
  const src = pages.dynasty
  const from = (start) => { const at = src.indexOf(start); assert.ok(at >= 0, `Dynasty.jsx no longer has ${start}`); return src.slice(at, closingBrace(src, src.indexOf('{', at)) + 1) }
  const memo = from('const leagueRanks = useMemo(() => {')
  const body = memo.slice(memo.indexOf('{') + 1, memo.lastIndexOf('}'))
  const code = [
    from('const SLOT_OK = {'),
    src.slice(src.indexOf('const DEFAULT_SLOTS = ['), src.indexOf('\n', src.indexOf('const DEFAULT_SLOTS = ['))),
    from('function bestLineup(players, slots) {'),
    from('const priceList = (entries) => {'),
    `(function () {${body}})()`,
  ].join('\n')
  const scale = buildScale(rows.map((r) => r.rating))
  const out = vm.runInNewContext(code, { lg, rows, seed: json('public/dynasty/players.json'), val: (rating) => displayValue(scale, rating), String, Math, Set, Array, Object })
  return JSON.parse(JSON.stringify(out))
}

test('a connected league is valued the way the Dynasty page values it, every team and every player', async () => {
  reset()
  stock(seedPlayers.map((p, i) => [String(p.id), p.rating + ((i * 37) % 23) - 11]), { total: 500 })
  const boardRes = await realFetch(`${process.env.SAVANT_API_ORIGIN}/api/dynasty?action=board&limit=600`)
  const board = (await boardRes.json()).board
  const cases = [
    { platform: 'sleeper', code: '1111111111111' },
    { platform: 'sleeper', code: 'wcefan' },
    { platform: 'sleeper', code: 'twoleagues', league: '2222222222222' },
    { platform: 'sleeper', code: '3333333333333' },
    { platform: 'espn', code: '4040', season: 2027 },
    { platform: 'fantrax', code: 'fxleague1' },
  ]
  let teams = 0
  let players = 0
  for (const args of cases) {
    const lg = await (await realFetch(`${process.env.SAVANT_API_ORIGIN}/api/league?${new URLSearchParams(Object.entries(args).map(([k, v]) => [k, String(v)]))}`)).json()
    assert.ok(lg.ok && lg.teams, `${args.code}: the stand-in league reads`)
    const page = pageLeague(lg, board)
    const where = `${args.platform} ${args.code}`
    const all = await run('nba_fantasy_league', args)
    const s = all.structured
    same(s.league.slots, page.slots, `${where}: the slots`)
    same(s.league.slots_from_league, Array.isArray(lg.slots) && lg.slots.length > 0)
    for (const mode of ['start', 'full']) {
      const order = [...page.teams].sort((a, b) => b[mode] - a[mode]).map((t) => t.id)
      same([...s.teams].sort((a, b) => (mode === 'start' ? a.rank_by_lineup - b.rank_by_lineup : a.rank_by_roster - b.rank_by_roster)).map((t) => t.id), order, `${where}: the ${mode === 'start' ? 'lineup' : 'roster'} order`)
    }
    for (const t of page.teams) {
      const mine = s.teams.find((x) => x.id === t.id)
      same([mine.name, mine.lineup_value, mine.roster_value, mine.players_priced, mine.unmatched], [t.name, t.start, t.full, t.count, t.misses], `${where} ${t.name}: the page's figures`)
      assert.ok(all.text.includes(`${t.name}: ${t.start.toLocaleString('en-US')}`), `${where} ${t.name}: in the text`)
      // Player by player and the lineup, for every team.
      const one = (await run('nba_fantasy_league', { ...args, team: t.id })).structured.team
      same(one.players.map((p) => [p.name, p.value, p.positions]), t.hits.map((h) => [h.name, h.value, h.pos]), `${where} ${t.name}: the roster priced`)
      same(one.lineup.map((l) => [l.slot, l.player, l.value]), t.lineup.map((l) => [l.slot, l.player ? l.player.name : null, l.player ? l.player.value : 0]), `${where} ${t.name}: the best lineup`)
      teams++
      players += t.hits.length
    }
    for (const n of s.notes) assert.ok(all.text.includes(n))
  }
  // The leagues the stand-ins hold exercise what they were made to: names respelled and still
  // found, names not on the list reported, a duplicate counted once, odd slots read as UTIL.
  const sleeper = pageLeague(await (await realFetch(`${process.env.SAVANT_API_ORIGIN}/api/league?platform=sleeper&code=1111111111111`)).json(), board)
  assert.ok(sleeper.teams.some((t) => t.misses.some((m) => /^Unlisted Player/.test(m))), 'a name not on the list')
  assert.ok(sleeper.teams.some((t) => t.misses.some((m) => !/^Unlisted Player/.test(m))), 'a respelling the page cannot place')
  const second = (await run('nba_fantasy_league', { platform: 'sleeper', code: '2222222222222' })).structured
  assert.ok(second.league.slots.filter((x) => x === 'UTIL').length === 2, 'SUPER_FLEX is read as UTIL, as on the page')
  // By name, and a name that is not there.
  const byName = await run('nba_fantasy_league', { platform: 'sleeper', code: 'wcefan', team: 'team c' })
  assert.equal(byName.structured.team.name, 'Team C')
  await refuses(run('nba_fantasy_league', { platform: 'sleeper', code: 'wcefan', team: 'Team Zed' }), /No team in this league is called "Team Zed"\. Its teams: Team A \(id 1\), /, 'an unknown team')
  // A username with two leagues: the choice, not a guess.
  const pick = await run('nba_fantasy_league', { platform: 'sleeper', code: 'twoleagues' })
  assert.deepEqual(pick.structured.leagues.map((l) => l.id), ['1111111111111', '2222222222222'])
  assert.equal(pick.structured.teams.length, 0)
  assert.match(pick.text, /Call again with one of these league ids as "league"\./)
  // The page's own words when a league cannot be read.
  for (const [args, said] of [
    [{ platform: 'sleeper', code: 'nobody' }, 'No Sleeper user with that username.'],
    [{ platform: 'sleeper', code: 'lonely' }, 'That account has no NBA leagues we can see.'],
    [{ platform: 'sleeper', code: '4444444444444' }, 'Could not read that league. If it is private, paste your roster instead.'],
    [{ platform: 'espn', code: '777' }, 'Could not read that league. If it is private, paste your roster instead.'],
    [{ platform: 'fantrax', code: 'nosuchleague' }, 'Could not read that league. If it is private, paste your roster instead.'],
  ]) {
    await refuses(run('nba_fantasy_league', args), new RegExp(`^${said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(.*\\) The Dynasty page also values a roster typed or pasted in: https://wcehoops\\.com/dynasty$`), `${args.code}: ${said}`)
  }
  // The reader down, or answering nonsense; and the board down, which values nothing.
  for (const mode of ['html', 'http500']) {
    reset(); stock(seedPlayers.map((p) => [String(p.id), p.rating]))
    site.league = mode
    await refuses(run('nba_fantasy_league', { platform: 'sleeper', code: 'wcefan' }), /league reader could not be reached right now/, `league reader ${mode}`)
  }
  reset(); stock([])
  site.feed = 'unconfigured'
  await refuses(run('nba_fantasy_league', { platform: 'sleeper', code: 'wcefan' }), /pricing feed is offline/, 'the board offline')
  // Codes the site's reader would refuse are refused by the shape first.
  const input = z.object(tool.nba_fantasy_league.config.inputSchema)
  for (const bad of [{ platform: 'yahoo', code: 'x' }, { platform: 'sleeper', code: 'a b' }, { platform: 'sleeper', code: 'x'.repeat(65) }, { platform: 'sleeper' }, { platform: 'espn', code: '1', season: 99 }, { platform: 'sleeper', code: 'wcefan', league: 'a/b' }]) {
    assert.equal(input.safeParse(bad).success, false, JSON.stringify(bad))
  }
  // The platforms were reached by api/league.js, through the site; never by the tool.
  assert.ok(platformCalls.length > 0)
  reset()
  console.log(`      ${cases.length} leagues, ${teams} teams and ${players.toLocaleString('en-US')} players valued the same way as the page's own code`)
})

// ---- 6. the files, the protocol, and the origin being down ---------------------------

test('files are fetched once and reused; when the site is down every tool says so plainly', async () => {
  reset()
  stock(seedPlayers.map((p) => [String(p.id), p.rating]))
  const slug = built.articles.articles[0].slug
  const before = site.hits
  await run('wce_get_news', {})
  await run('wce_get_news', { section: 'analytics' })
  await run('wce_search_articles', {})
  await run('wce_get_article', { article: slug })
  await run('wce_get_article', { article: slug })
  await run('wce_get_big_board', {})
  await run('wce_get_big_board', { prospect: 'wagler' })
  await run('wce_get_dynasty_rankings', {})
  assert.equal(site.hits - before, 5, 'news, the article index, one article, the board and the dynasty names: five files')

  const origin = process.env.SAVANT_API_ORIGIN
  try {
    // An article file that is not there comes back as the homepage, with a 200.
    reset({ files: { ...built, texts: {} } })
    await refuses(run('wce_get_article', { article: slug }), /WCE site data could not be loaded right now\. Try again in a minute\./, 'a missing article file')

    reset()
    process.env.SAVANT_API_ORIGIN = 'http://127.0.0.1:9'
    for (const [name, args] of [['wce_get_news', {}], ['wce_search_articles', {}], ['wce_get_article', { article: slug }], ['wce_get_big_board', {}], ['wce_get_dynasty_rankings', {}], ['wce_get_trending', {}], ['wce_whats_new', {}]]) {
      await refuses(run(name, args), /could not be (loaded|read) right now/, `${name} with the site down`)
    }
    await refuses(run('nba_fantasy_league', { platform: 'sleeper', code: 'wcefan' }), /league reader could not be reached right now/, 'nba_fantasy_league with the site down')
  } finally {
    process.env.SAVANT_API_ORIGIN = origin
    reset()
  }
  assert.ok((await run('wce_get_news', {})).structured.count > 0, 'and it recovers')
})

test('the tools are well-formed, and a real MCP client gets on with them', async () => {
  reset()
  stock(seedPlayers.map((p) => [String(p.id), p.rating]), { total: 12 })
  assert.deepEqual(section.tools.map((t) => t.name), ['wce_get_news', 'wce_search_articles', 'wce_get_article', 'wce_get_big_board', 'wce_get_dynasty_rankings', 'wce_get_trending', 'wce_whats_new', 'nba_fantasy_league'])

  // Registered the way api/mcp.js registers a section.
  const server = new McpServer({ name: 'check', version: '0' })
  for (const t of section.tools) {
    server.registerTool(t.name, t.config, async (args) => {
      try {
        const { text, structured } = await t.run(args)
        return { content: [{ type: 'text', text }], structuredContent: structured }
      } catch (err) {
        if (err instanceof core.SavantError) return { isError: true, content: [{ type: 'text', text: err.message }] }
        throw err
      }
    })
  }
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'check', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  try {
    const { tools } = await client.listTools()
    assert.equal(tools.length, 8)
    const NEW = ['wce_get_trending', 'wce_whats_new', 'nba_fantasy_league']
    for (const t of tools) {
      assert.match(t.name, t.name === 'nba_fantasy_league' ? /^nba_fantasy_[a-z_]+$/ : /^wce_[a-z_]+$/)
      assert.ok(t.name.length <= 64)
      assert.ok(t.title && t.annotations.title, `${t.name}: title`)
      assert.equal(t.annotations.readOnlyHint, true, `${t.name}: read-only`)
      assert.equal(t.annotations.destructiveHint, false)
      // Only the league reader reaches past the site (to Sleeper, ESPN or Fantrax, by way of
      // the site's own reader), and it says so.
      assert.equal(t.annotations.openWorldHint, t.name === 'nba_fantasy_league', `${t.name}: openWorldHint`)
      assert.ok(t.description.length > 80, `${t.name}: description`)
      if (NEW.includes(t.name)) assert.ok(t.description.length <= 700, `${t.name}: a new tool's description is at most 700 characters (${t.description.length})`)
      assert.doesNotMatch(t.description, /\b(you should|always use|must call|prefer this|best|please)\b/i, `${t.name}: a description describes`)
      assert.equal(t.inputSchema.type, 'object')
      assert.ok(t.outputSchema, `${t.name}: output schema`)
      for (const [k, prop] of Object.entries(t.inputSchema.properties || {})) assert.ok(prop.description, `${t.name}.${k}: described`)
    }
    // callTool checks structuredContent against the declared output schema and throws if not.
    const slug = built.articles.articles[0].slug
    for (const [name, args] of [
      ['wce_get_news', {}], ['wce_get_news', { section: 'analytics', start: 3, limit: 2 }],
      ['wce_search_articles', {}], ['wce_search_articles', { query: 'jaylen brown', category: 'Analytics' }],
      ['wce_get_article', { article: slug }],
      ['wce_get_big_board', {}], ['wce_get_big_board', { year: 2025 }], ['wce_get_big_board', { prospect: 'Keaton Wagler' }],
      ['wce_get_dynasty_rankings', {}], ['wce_get_dynasty_rankings', { player: 'Flagg', limit: 5 }],
      ['wce_get_trending', {}], ['wce_whats_new', {}],
      ['nba_fantasy_league', { platform: 'sleeper', code: 'wcefan', team: 'Team A' }], ['nba_fantasy_league', { platform: 'sleeper', code: 'twoleagues' }],
    ]) {
      const r = await client.callTool({ name, arguments: args })
      assert.ok(!r.isError, `${name} ${JSON.stringify(args)}: ${r.content[0].text}`)
      assert.ok(r.structuredContent.notes.length && r.content[0].text.length > 40)
    }
    // Bad arguments are refused by the schema before anything is looked up.
    for (const [name, args] of [
      ['wce_get_news', { section: 'rumors' }], ['wce_get_news', { limit: 26 }], ['wce_get_news', { start: 0 }],
      ['wce_search_articles', { query: 'x' }], ['wce_search_articles', { query: 'y'.repeat(81) }],
      ['wce_get_article', {}], ['wce_get_article', { article: 'z'.repeat(201) }],
      ['wce_get_big_board', { year: '2026' }], ['wce_get_big_board', { prospect: '' }],
      ['wce_get_dynasty_rankings', { limit: 0 }], ['wce_get_dynasty_rankings', { limit: 121 }], ['wce_get_dynasty_rankings', { player: 'q' }],
      ['wce_get_trending', { section: 'teams' }], ['nba_fantasy_league', { platform: 'yahoo', code: 'abc' }], ['nba_fantasy_league', { code: 'abc' }],
    ]) {
      const r = await client.callTool({ name, arguments: args })
      assert.ok(r.isError, `${name} ${JSON.stringify(args)} should be refused`)
    }
    const refusal = await client.callTool({ name: 'wce_get_article', arguments: { article: 'no-such-article' } })
    assert.ok(refusal.isError)
    assert.match(refusal.content[0].text, /No WCE article matches "no-such-article"/)
    assert.equal(refusal.structuredContent, undefined)
  } finally {
    await client.close()
    await server.close()
  }
})

test('through everything above, the store saw reads and its own seeding, and the site saw GETs and nothing else', () => {
  const dynasty = site.api.filter((r) => r.path === '/api/dynasty')
  assert.ok(dynasty.length >= 40, 'the Dynasty endpoint was barely exercised')
  for (const r of dynasty) {
    assert.deepEqual([r.method, r.path, r.query, r.bytes], ['GET', '/api/dynasty', '?action=board&limit=600', 0], 'the tool sent something other than its one read of the board')
  }
  // The check's own reads of the endpoints, to have the page's view of them, are made with
  // realFetch and never with a body; every request the tools made is a bare GET too.
  for (const r of site.api.filter((x) => x.path !== '/api/dynasty')) {
    assert.ok(['/api/trending', '/api/league'].includes(r.path), `a request to ${r.path}`)
    assert.deepEqual([r.method, r.bytes], ['GET', 0], `${r.path}: a GET with no body`)
    if (r.path === '/api/trending') assert.match(r.query, /^(\?ns=(bs|dr))?$/)
    else assert.match(r.query, /^\?platform=(sleeper|espn|fantrax)&code=[A-Za-z0-9_.-]+(&league=\d+)?(&season=\d{4})?$/)
  }
  // api/dynasty.js itself seeds an empty board on a read (ZADD NX, and the first snapshot);
  // api/trending.js builds its unions in scratch keys that expire. Nothing else may ever be
  // written: no vote (ZINCRBY, HINCRBY, INCR, LPUSH), no room, no search recorded.
  const seen = new Set(store.commands)
  assert.deepEqual([...seen].sort(), ['EXPIRE', 'GET', 'HGETALL', 'HSET', 'LRANGE', 'ZADD', 'ZCARD', 'ZMSCORE', 'ZREVRANGE', 'ZUNIONSTORE'])
  console.log(`      ${site.api.length} requests to the site's endpoints, ${store.commands.length.toLocaleString('en-US')} store commands, all reads or seeding`)
  console.log(`      ${compared.toLocaleString('en-US')} values compared in all`)
})

// ---- 7. what is written to disk ------------------------------------------------------

test('what is written to disk is what was built, every file carries the schema, and it stays small', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'savant-site-dist-'))
  try {
    const r = writeSiteApi({ publicDir: path.join(ROOT, 'public'), dist })
    const root = path.join(dist, BASE)
    const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.relative(root, path.join(dir, f))]))
    const onDisk = walk(root).sort()
    assert.deepEqual(onDisk, [...Object.keys(built.texts).map((s) => `articles/${s}.json.gz`), 'articles.json', 'big-board.json', 'dynasty.json', 'meta.json', 'news.json', 'whats-new.json'].sort())
    assert.equal(r.files, onDisk.length)
    assert.equal(r.bytes, onDisk.reduce((n, f) => n + statSync(path.join(root, f)).size, 0))
    assert.ok(r.raw >= r.bytes)
    const c = built.meta.counts
    assert.deepEqual(r.summary.match(/\d[\d,]*/g).map((n) => +n.replace(/,/g, '')), [c.headlines, c.analytics, c.articles, c.boards, c.prospects, c.dynasty_names])
    assert.match(r.summary, /^[\d,]+ headlines?, [\d,]+ analytics items?, [\d,]+ articles?, [\d,]+ draft boards? \([\d,]+ prospects?\), [\d,]+ dynasty names?$/)

    const plain = { 'meta.json': built.meta, 'news.json': built.news, 'articles.json': built.articles, 'big-board.json': built.bigBoard, 'dynasty.json': built.dynasty, 'whats-new.json': built.whatsNew }
    for (const [name, body] of Object.entries(plain)) {
      const back = JSON.parse(readFileSync(path.join(root, name), 'utf8'))
      // The banner's list is gathered against the clock, so its build time is its own.
      if (name === 'whats-new.json') { assert.deepEqual(back.items, body.items, name); assert.deepEqual(back.rules, body.rules, name); assert.equal(back.schema, 1); continue }
      assert.deepEqual(back, body, name)
      assert.equal(back.schema, 1, `${name}: schema`)
    }
    for (const [slug, body] of Object.entries(built.texts)) {
      assert.match(slug, /^[a-z0-9-]+$/, 'the pattern the rewrite matches')
      const back = JSON.parse(gunzipSync(readFileSync(path.join(root, 'articles', `${slug}.json.gz`))).toString('utf8'))
      assert.deepEqual(back, body, slug)
      assert.equal(back.schema, 1)
    }
    // A second write replaces the first rather than adding to it.
    assert.equal(writeSiteApi({ publicDir: path.join(ROOT, 'public'), dist }).bytes, r.bytes)
    // Deployment Storage: Vercel keeps ~40 deployments, so every MB here costs 40.
    assert.ok(r.bytes < BUDGET, `the site files grew to ${(r.bytes / 1024).toFixed(0)} KB`)
    console.log(`      ${r.files} files, ${(r.raw / 1024).toFixed(1)} KB of JSON, ${(r.bytes / 1024).toFixed(1)} KB on disk (budget ${BUDGET / 1024} KB)`)
    assert.throws(() => writeSiteApi({ publicDir: path.join(dist, 'nowhere'), dist }), /is missing/)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})
