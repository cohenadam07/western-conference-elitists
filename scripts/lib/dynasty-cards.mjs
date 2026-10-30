// Dynasty Exchange swipe cards, built from Basketball Savant and Draft Savant. Runs at the end
// of the Savant API step (savant-api.mjs writeAll), because it reads the files that step just
// wrote rather than ranking anyone itself.
//
//   dist/dynasty/cards.json        every player on the Dynasty board, as the swipe card draws him
//   dist/dynasty/swipe-pool.json   id -> [Guard|Wing|Big, rookie, age], for api/dynasty.js to deal
//                                  by position without loading the cards
//
// WHY READ THE API FILES AND NOT THE RAW DATA
// The card's bottom half is a Savant summary: percentiles against the league and against his
// position. Those numbers already exist, checked against the page itself, in
// savant-api/basketball/v1/seasons/<season>.json.gz (tools/savant-api/check.mjs proves they
// match). Ranking players a second time here would be a second copy of the rules that could
// drift. Reading the slicer's output means a card can never disagree with the Savant page.
// Rookies who have not played enough get the same treatment from Draft Savant's class file.
//
// WHAT A CARD HOLDS
//   s   the per-game line for his three most recent seasons, newest first:
//       [season, gp, mpg, ppg, rpg, apg, tpg, stk75, usg, ts]
//       Stocks are per 75 possessions because that is the only way Savant keeps steals and
//       blocks. The card labels the column STK/75 rather than pretend it is per game.
//   q   season -> { gp, low, m: { key: [value, league pct, position pct] } } for the current
//       season and the last full one, so the card can switch between them with no fetch
//   d   rookies with a Draft Savant profile: { line, m: { key: [value, class pct, class
//       position pct] } }
//
// Nothing here is committed: it is rebuilt every deploy, so the nightly data push refreshes it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

export const CARDS_SCHEMA = 1

// A season in progress is the card's default summary once he has this many games in it.
// Before that, a percentile is mostly noise (one cold night puts an MVP in the 12th
// percentile for true shooting), so the card opens on the last full season and says so.
export const CURRENT_MIN_GP = 10

// The bottom half of an NBA card: the Savant page's own stats, three groups of four.
export const NBA_SUMMARY = [
  ['off', 'pts', 'Points / 75'],
  ['off', 'ts', 'True shooting'],
  ['off', 'usg', 'Usage'],
  ['off', 'ast', 'Assist %'],
  ['off', 'tp3', '3-point %'],
  ['off', 'tov', 'Turnover %'],
  ['def', 'reb75', 'Rebounds / 75'],
  ['def', 'stk75', 'Stocks / 75'],
  ['def', 'dbpm', 'Defensive BPM'],
  ['def', 'defl', 'Deflections / 75'],
  ['val', 'bpm', 'Box Plus/Minus'],
  ['val', 'onoffadj', 'On/Off (luck-adj.)'],
]

// The bottom half of a rookie card with no real NBA sample: his college season, ranked
// against his own draft class.
export const DRAFT_SUMMARY = [
  ['off', 'usg', 'Usage'],
  ['off', 'ts', 'True shooting'],
  ['off', 'tp3', '3-point %'],
  ['off', 'ast', 'Assist %'],
  ['off', 'tov', 'Turnover %'],
  ['off', 'obpm', 'Offensive BPM'],
  ['def', 'dreb', 'Def. rebound %'],
  ['def', 'stl', 'Steal %'],
  ['def', 'blk', 'Block %'],
  ['def', 'dbpm', 'Defensive BPM'],
  ['val', 'bpm', 'BPM'],
  ['val', 'wing', 'Wingspan'],
]

// Draft Savant packs each stat as [value, then six percentiles, then six pool sizes]. The six
// pools run class-all, class-position, class-age, past-all, past-position, past-age
// (savant-api-draft.mjs POOLS). The card uses the first two.
const DRAFT_CLASS_ALL = 1
const DRAFT_CLASS_POS = 2

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '')
const r1 = (v) => (v == null || !Number.isFinite(+v) ? null : Math.round(+v * 10) / 10)
const r3 = (v) => (v == null || !Number.isFinite(+v) ? null : Math.round(+v * 1000) / 1000)
const short = (season) => String(season).slice(2, 4) + '-' + String(season).slice(5, 7)

/**
 * Pure: everything in, the two documents out. Tested by tools/dynasty-swipe/check.mjs.
 *   pool      public/dynasty/players.json .players
 *   meta      savant-api/basketball/v1/meta.json
 *   seasons   season -> that season's slicer file (only the ones the card needs)
 *   draft     the draft class file for the newest rookies, or null
 */
export function buildDynastyCards({ pool, meta, seasons, draft = null, generated = null }) {
  const latest = meta.latestSeason
  const order = (meta.seasons || []).filter((s) => seasons[s])              // newest first
  const inProgress = !!(seasons[latest] && seasons[latest].in_progress)
  const prevFull = order.find((s) => s !== latest || !inProgress) || latest
  const summarySeasons = [...new Set([latest, prevFull])]

  const unitOf = Object.fromEntries((meta.metrics || []).map((m) => [m.key, m]))
  const byId = {}
  for (const s of order) {
    for (const row of seasons[s].players || []) {
      ;(byId[row.id] = byId[row.id] || {})[s] = row
    }
  }

  const draftRows = draft ? draft.players || [] : []
  const draftByName = new Map(draftRows.map((p) => [norm(p.name), p]))
  const draftByPick = new Map(draftRows.filter((p) => p.pick).map((p) => [p.pick, p]))

  const players = {}
  const swipe = {}
  let withSavant = 0, withDraft = 0, bare = 0

  for (const p of pool) {
    const id = Number(p.id)
    const rows = byId[id] || {}
    const mine = order.filter((s) => rows[s])
    const newest = mine.length ? rows[mine[0]] : null

    const card = {
      n: p.name,
      t: (newest && newest.team) || p.team || null,
      p: (newest && newest.pos) || null,                  // Guard | Wing | Big, Savant's call
      a: newest && newest.age != null ? r1(newest.age) : (p.age ?? null),
      dp: p.pos || null,                                  // the board's own PG..C
    }
    if (p.rookie) { card.r = 1; if (p.pick) card.pk = p.pick }

    // ---- top row: three seasons of the per-game line
    const s = mine.slice(0, 3).map((season) => {
      const row = rows[season], m = row.m || {}, L = row.line || {}
      const v = (k) => (m[k] ? m[k][0] : null)
      return [season, row.gp ?? null, r1(L.mpg), r1(L.ppg), r1(L.rpg), r1(L.apg), r1(L.tpg),
        r1(v('stk75')), r1(v('usg')), r3(v('ts'))]
    })
    if (s.length) card.s = s

    // ---- bottom half: the Savant summary, both seasons it can open on
    const q = {}
    for (const season of summarySeasons) {
      const row = rows[season]
      if (!row) continue
      const m = {}
      for (const [, key] of NBA_SUMMARY) if (row.m && row.m[key]) m[key] = row.m[key]
      if (!Object.keys(m).length) continue
      const low = (row.low || []).filter((k) => m[k])
      q[season] = { gp: row.gp ?? null, ...(row.qualified === false ? { uq: 1 } : {}), ...(low.length ? { low } : {}), m }
    }
    if (Object.keys(q).length) card.q = q

    // ---- rookies: Draft Savant, matched by name and then by pick (the names drift:
    // "Jr.", accents, a nickname), so a rookie with no NBA minutes still has a real card
    if (p.rookie && draftRows.length) {
      const dr = draftByName.get(norm(p.name)) || (p.pick ? draftByPick.get(p.pick) : null)
      if (dr) {
        const m = {}
        for (const [, key] of DRAFT_SUMMARY) {
          const a = dr.m && dr.m[key]
          if (a && a[0] != null) m[key] = [a[0], a[DRAFT_CLASS_ALL] ?? null, a[DRAFT_CLASS_POS] ?? null]
        }
        const L = dr.line || {}
        card.d = {
          c: dr.college || null,
          p: dr.pos || null,
          gp: dr.gp ?? null,
          line: [r1(L.ppg), r1(L.rpg), r1(L.apg), r1(L.tpg),
            dr.m && dr.m.usg ? r1(dr.m.usg[0]) : null, dr.m && dr.m.ts ? r3(dr.m.ts[0]) : null],
          m,
        }
        if (!card.p) card.p = dr.pos || null
        withDraft++
      }
    }

    if (card.s || card.q) withSavant++
    else if (!card.d) bare++

    players[id] = card
    swipe[id] = [card.p || null, p.rookie ? 1 : 0, card.a ?? null]
  }

  const label = (list, src) => list.map(([g, k, l]) => {
    const u = src[k] || {}
    return [k, l, g, u.unit || null, u.lowerIsBetter ? 1 : 0]
  })
  const draftUnits = Object.fromEntries(((draft && draft.metrics) || []).map((m) => [m.key, m]))

  const cards = {
    schema: CARDS_SCHEMA,
    generated,
    latest,
    prevFull,
    inProgress,
    currentMinGp: CURRENT_MIN_GP,
    seasonsShort: Object.fromEntries(order.map((s) => [s, short(s)])),
    nba: label(NBA_SUMMARY, unitOf),
    draft: draft ? { year: draft.year, metrics: label(DRAFT_SUMMARY, draftUnits) } : null,
    players,
  }
  return {
    cards,
    pool: { schema: CARDS_SCHEMA, generated, players: swipe },
    counts: { players: pool.length, withSavant, withDraft, bare },
  }
}

// Reads what the Savant API step just wrote into dist/ and writes the two files.
export function writeDynastyCards({ publicDir, dist }) {
  const poolFile = path.join(publicDir, 'dynasty', 'players.json')
  const bball = path.join(dist, 'savant-api', 'basketball', 'v1')
  if (!existsSync(poolFile)) throw new Error('public/dynasty/players.json is missing')
  if (!existsSync(path.join(bball, 'meta.json'))) throw new Error('Basketball Savant API files were not written')

  const pool = JSON.parse(readFileSync(poolFile, 'utf8')).players.filter((p) => p.id != null)
  const meta = JSON.parse(readFileSync(path.join(bball, 'meta.json'), 'utf8'))
  const readGz = (f) => JSON.parse(gunzipSync(readFileSync(f)).toString('utf8'))

  // The three newest seasons are all the card's top row ever shows.
  const seasons = {}
  for (const s of (meta.seasons || []).slice(0, 3)) {
    const f = path.join(bball, 'seasons', `${s}.json.gz`)
    if (existsSync(f)) seasons[s] = readGz(f)
  }

  // The draft class the board's rookies came from. Not simply the newest: Draft Savant may
  // already hold next year's projected class, so take whichever of the two newest shares the
  // most names with the board's rookies.
  let draft = null
  const draftDir = path.join(dist, 'savant-api', 'draft', 'v1')
  const rookies = new Set(pool.filter((p) => p.rookie).map((p) => norm(p.name)))
  if (rookies.size && existsSync(path.join(draftDir, 'meta.json'))) {
    const dmeta = JSON.parse(readFileSync(path.join(draftDir, 'meta.json'), 'utf8'))
    const years = (dmeta.classes || []).map((c) => String(c.year)).sort().slice(-2)
    let best = 0
    for (const year of years) {
      const f = path.join(draftDir, 'classes', `${year}.json.gz`)
      if (!existsSync(f)) continue
      const body = readGz(f)
      const hits = (body.players || []).filter((p) => rookies.has(norm(p.name))).length
      if (hits > best) { best = hits; draft = { ...body, metrics: dmeta.metrics || [] } }
    }
  }

  const out = buildDynastyCards({ pool, meta, seasons, draft, generated: meta.generated || null })
  const dir = path.join(dist, 'dynasty')
  mkdirSync(dir, { recursive: true })
  const a = Buffer.from(JSON.stringify(out.cards))
  const b = Buffer.from(JSON.stringify(out.pool))
  writeFileSync(path.join(dir, 'cards.json'), a)
  writeFileSync(path.join(dir, 'swipe-pool.json'), b)
  const c = out.counts
  return {
    bytes: a.length + b.length,
    summary: `${c.players} cards (${c.withSavant} with Savant, ${c.withDraft} with Draft Savant, ${c.bare} name only)`,
  }
}
