// What is true today, for the homepage tiles (src/components/Gateway.jsx).
//
// Each tile used to carry a drawing with made-up bars. Now each one shows a real, current fact
// from the tool it opens: who is on the All-Savant 1st Team so far, the next UFC card, the
// playoff field if the season ended today. The facts are gathered here at build time from the
// same files in public/ that the tools read, so a tile can never say something its tool does not.
// The site rebuilds several times a day (deploy-batch.yml), so the facts keep up on their own.
//
// RULES
//   - Nothing is computed here that a tool does not already compute. NBA values come from
//     buildSavantApi (the page's own model), everything else is read straight from a file.
//   - Every fact says what it is (`label`) and how fresh it is (`through`), the tool's own date.
//   - A fact that cannot be read is left out, with a build warning. The tile then shows its
//     drawing alone. A missing file never breaks the build and never shows a stale guess.
//
// `npm run check:tiles` checks each fact against its source.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { buildSavantApi } from './savant-api.mjs'
import { readAllSavantSlots, readValueModel } from './savant-value.mjs'

const ID = 'virtual:tile-data'
const RESOLVED = '\0' + ID

const read = (root, rel) => {
  const f = path.join(root, 'public', rel)
  if (!fs.existsSync(f)) return null
  const b = fs.readFileSync(f)
  return JSON.parse(rel.endsWith('.gz') ? zlib.gunzipSync(b) : b)
}
const signed1 = (v) => `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(1)}`

// NBA Savant: the All-Savant 1st Team as it stands, with each man's Savant value.
export function nba(root) {
  const cur = read(root, 'savant-current.json')
  const pub = path.join(root, 'public')
  const model = readValueModel(pub)
  if (!cur || !model) return null
  const season = cur.seasons[0]
  const out = buildSavantApi({ data: cur, html: fs.readFileSync(path.join(pub, 'basketball-savant.html'), 'utf8'), valueModel: model, allSavantSlots: readAllSavantSlots(pub) })
  const s = out.seasons[season]
  const by = new Map(s.players.map((p) => [p.id, p]))
  const rows = s.all_savant[0].map((id) => by.get(id)).filter((p) => p && p.sv).map((p) => ({ name: p.name, value: p.sv[0], show: String(p.sv[0]) }))
  if (rows.length !== 5) return null
  rows.sort((a, b) => b.value - a.value)
  return { label: 'All-Savant 1st Team so far', unit: 'Savant value', season, through: cur.through, rows }
}

// NFL Savant: the three highest Savant values among qualified players this season.
export function nfl(root) {
  const d = read(root, 'football-savant-current.json')
  if (!d) return null
  const season = d.seasons[0]
  const q = d.data[season].players.filter((p) => p.qualified && Number.isFinite(p.m?.sav)).sort((a, b) => b.m.sav - a.m.sav).slice(0, 3)
  if (q.length < 3) return null
  return { label: 'Savant value leaders', unit: 'points above replacement', season, through: d.through, rows: q.map((p) => ({ name: p.name, note: p.pos, value: p.m.sav, show: signed1(p.m.sav) })) }
}

// UFC Savant: the next card on the schedule and its main event.
export function ufc(root) {
  const c = read(root, 'ufc-savant-data.json')?.upcoming?.cards?.[0]
  const main = c?.bouts?.[0]?.f
  if (!c || !main || main.length !== 2) return null
  // "Riyadh, Riyadh, Saudi Arabia" reads "Riyadh, Saudi Arabia"
  const where = c.location ? [...new Set(c.location.split(', '))].join(', ') : null
  return { label: 'Next card', date: c.date, text: `${main[0].name} vs. ${main[1].name}`, sub: where }
}

// CBB Savant: the national All-Savant 1st Team as it stands.
export function cbb(root) {
  const season = read(root, 'cbb/index.json.gz')?.default_season
  const a = season && read(root, `cbb/allsavant/${season}.json.gz`)
  const first = a?.national?.['1']
  if (!first?.length) return null
  const rows = [...first].sort((x, y) => y.value - x.value).map((p) => ({ name: p.name, value: p.value, show: String(Math.round(p.value)) }))
  return { label: a.final ? 'All-Savant 1st Team' : 'All-Savant 1st Team so far', unit: 'Savant value', season, through: a.final ? null : a.through, rows }
}

// CFB Savant: the top four seeds of the objective playoff field, as the page states it.
export function cfb(root) {
  const season = read(root, 'cfb/index.json.gz')?.default_season
  const p = season && read(root, `cfb/playoff/${season}.json.gz`)
  const teams = season && read(root, `cfb/teams/${season}.json.gz`)
  if (!p?.field?.length || !teams?.cols || !teams?.teams) return null
  // the team file is rows of plain values, with `cols` naming them
  const iId = teams.cols.indexOf('id')
  const iName = teams.cols.indexOf('school')
  if (iId < 0 || iName < 0) return null
  const nameOf = new Map(teams.teams.map((t) => [String(t[iId]), t[iName]]))
  const rows = p.field.slice(0, 4).map((f) => ({ name: nameOf.get(String(f.team)), note: `${f.w}-${f.l}`, show: `${f.w}-${f.l}` }))
  if (rows.some((r) => !r.name)) return null
  return { label: p.final ? 'The playoff field, top four seeds' : 'Playoff field if the season ended today', season, through: p.through, rows }
}

// The two basketball coaching tools: the top three of one Leaders board, as the page prints it.
function board(index, id, sub) {
  const b = index?.leaders?.find((x) => x.id === id)
  if (!b?.rows?.length) return null
  // `display` is the page's own print of the number; a bracketed aside after it is dropped for room
  return { label: b.title, sub, pool: `${b.note} Among ${b.pool}.`, rows: b.rows.slice(0, 3).map((r) => ({ name: r.name, show: String(r.display).split(' (')[0], value: r.value })) }
}
export const nbac = (root) => board(read(root, 'bcs/index.json'), 'wins_above_market', 'career, since 1996-97')
export const cbbc = (root) => board(read(root, 'cbcs/index.json.gz'), 'w_roster', 'career, per 30 games')

// NFL Coaching Savant: wins above expectation this season, top three.
export function nflc(root) {
  const d = read(root, 'coaching-savant-current.json')
  if (!d) return null
  const rows = Object.values(d.coaches)
    .map((c) => ({ name: c.name, s: c.seasons.find((x) => x.season === d.season) }))
    .filter((c) => c.s && Number.isFinite(c.s.waa))
    .sort((a, b) => b.s.waa - a.s.waa)
    .slice(0, 3)
    .map((c) => ({ name: c.name, note: c.s.team, value: c.s.waa, show: signed1(c.s.waa) }))
  if (rows.length < 3) return null
  return { label: `Wins above expectation, ${d.season}`, sub: `through week ${d.week}`, rows }
}

// NBA Draft Savant: the first three picks of the newest class that has been drafted.
export function draft(root) {
  const players = read(root, 'data.json')?.players || []
  const picked = players.filter((p) => /^\d+$/.test(String(p.draft_pick || '')) && /^\d{4}$/.test(String(p.draft_year || '')))
  if (!picked.length) return null
  const year = Math.max(...picked.map((p) => +p.draft_year))
  const rows = picked.filter((p) => +p.draft_year === year && +p.draft_pick <= 3).sort((a, b) => +a.draft_pick - +b.draft_pick).map((p) => ({ name: p.name, show: p.draft_team }))
  if (rows.length !== 3) return null
  return { label: `${year} draft, the first three picks`, rows }
}

// News: the newest headline in the feed.
export function news(root) {
  const h = read(root, 'news.json')?.headlines?.[0]
  if (!h?.title) return null
  return { label: 'Latest', text: h.title, sub: h.outlet || null, date: h.published || null }
}

const GATHER = { nba, nfl, ufc, cbb, cfb, nbac, cbbc, nflc, draft, news }

export function gather(root, warn = console.warn) {
  const tiles = {}
  for (const [key, fn] of Object.entries(GATHER)) {
    try {
      const fact = fn(root)
      if (fact) tiles[key] = fact
      else warn(`tile-data: no fact for the ${key} tile (its file is missing or changed shape); the tile shows its drawing alone`)
    } catch (err) {
      warn(`tile-data: the ${key} tile's fact could not be read (${err.message}); the tile shows its drawing alone`)
    }
  }
  return tiles
}

export default function tileData() {
  let root = process.cwd()
  return {
    name: 'tile-data',
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      if (id === ID) return RESOLVED
    },
    load(id) {
      if (id !== RESOLVED) return
      return `export default ${JSON.stringify({ generated: new Date().toISOString(), tiles: gather(root, (msg) => this.warn(msg)) })}`
    },
  }
}
