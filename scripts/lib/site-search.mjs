// One search box for the whole site (the ribbon, public/wce-nav.js).
//
// Every tool has its own search, and each one only knows its own people. This writes two small
// lists at build time so the ribbon can find anyone from any page and open the right card:
//
//   dist/search/core.json     NBA and NFL players, UFC fighters, the coaches of all three
//                             coaching tools, NBA and NFL teams
//   dist/search/college.json  CBB and CFB teams, and their players of the last four seasons
//                             (fetched second). Sixty-odd thousand college players back to
//                             2013 would be a megabyte on a phone for names few people type;
//                             each college tool's own search still has every one of them.
//
// Nothing here is new data. Each row is read from a list a tool already publishes: the
// /savant-api player lists the build has just written, the coaching tools' indexes, and the
// college tools' own search files. So a name the ribbon finds is a name its tool has a card for.
//
// A row is [name, kind, sub, href, year]:
//   kind  which tool it opens (KINDS below; the ribbon prints the label)
//   sub   one short line to tell two people with the same name apart (position, team, years)
//   href  the card's own address, exactly as the tool's connector prints it
//   year  his most recent season, so the current player comes before the old one
//
// A source that is missing or has changed shape is skipped with a build warning; the others
// are still written. `npm run check:search` checks the rows and the addresses.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export const KINDS = {
  nba: 'NBA Savant', nfl: 'NFL Savant', ufc: 'UFC Savant', cbb: 'CBB Savant', cfb: 'CFB Savant',
  nbac: 'NBA Coaching', nflc: 'NFL Coaching', cbbc: 'CBB Coaching',
  nbat: 'NBA team', nflt: 'NFL team', cbbt: 'CBB team', cfbt: 'CFB team',
}

// how many seasons of college players the ribbon knows (the ribbon's hint says the same number)
export const COLLEGE_SEASONS = 4

const readJson = (file) => {
  if (!fs.existsSync(file)) return null
  const b = fs.readFileSync(file)
  return JSON.parse(file.endsWith('.gz') ? zlib.gunzipSync(b) : b)
}
const yr = (s) => Number(String(s ?? '').slice(0, 4)) || 0
const span = (a, b) => (a && b && String(a) !== String(b) ? `${a} to ${b}` : String(b || a || ''))
const join = (...bits) => bits.filter(Boolean).join(' · ')
const e = encodeURIComponent

// ---- one function per source: parsed JSON in, rows out --------------------------------------

export const nbaPlayers = (d) => d.players.map((p) => [p.name, 'nba', join(p.pos, p.team, span(p.from, p.to)), `/nba-savant?p=${e(p.id)}`, yr(p.to)])

export function nflPlayers(d) {
  const c = Object.fromEntries(d.cols.map((k, i) => [k, i]))
  for (const k of ['id', 'name', 'pos', 'team', 'from', 'to']) if (!(k in c)) throw new Error(`the NFL player list has no "${k}" column`)
  return d.players.map((p) => [p[c.name], 'nfl', join(p[c.pos], p[c.team], span(p[c.from], p[c.to])), `/nfl-savant#p=${e(p[c.id])}&s=${p[c.to]}`, yr(p[c.to])])
}

export const ufcFighters = (d) => d.fighters.map((f) => [f.name, 'ufc', join(f.div, f.rec ? `${f.rec[0]}-${f.rec[1]}-${f.rec[2]}` : null, f.active ? 'active' : null), `/ufc-savant#f=${e(f.id)}`, yr(f.last)])

export const nflCoaches = (d) => d.people.map((p) => [p.name, 'nflc', join(p.hc ? 'Head coach' : 'Play-caller', (p.teams || []).slice(-2).join(', '), span(p.first, p.last)), `/nfl-coaching-savant#c=${e(p.name)}`, yr(p.last)])

const hoopsCoaches = (kind, page) => (d) => d.coaches.map((c) => [c.name, kind, join(`${c.all_w ?? c.w}-${c.all_l ?? c.l}`, span(c.first, c.last)), `${page}#c=${e(c.id)}`, yr(c.last)])
export const nbaCoaches = hoopsCoaches('nbac', '/nba-coaching-savant')
export const cbbCoaches = hoopsCoaches('cbbc', '/cbb-coaching-savant')

export const nbaTeams = (d) => Object.entries(d.teams).map(([, t]) => [t.name, 'nbat', 'Team ratings and lineups', '/nba-savant#teams', 9999])
export const nflTeams = (d) => Object.entries(d.cfg.teams).map(([code, t]) => [t[0], 'nflt', join(code, String(d.seasons[0])), `/nfl-savant#t=${e(code)}&s=${d.seasons[0]}`, 9999])

// The college tools' own search files: players as [id, name, team, last season, position, ...].
export function cbb(d) {
  const team = new Map(d.teams.map((t) => [String(t[0]), t[1]]))
  return [
    ...d.teams.map((t) => [t[1], 'cbbt', join(t[2], t[4]), `/cbb-savant#team-${e(t[0])}`, 9999]),
    ...d.players.map((p) => [p[1], 'cbb', join(p[4], team.get(String(p[2])), p[3]), `/cbb-savant#player-${e(p[0])}/${p[3]}`, yr(p[3])]),
  ]
}
export function cfb(d, current) {
  const c = Object.fromEntries(d.cols.map((k, i) => [k, i]))
  const tc = Object.fromEntries(d.team_cols.map((k, i) => [k, i]))
  const team = new Map(d.teams.map((t) => [String(t[tc.id]), t[tc.school]]))
  // the tool's own rule: the season is left off the address when it is the current one
  const at = (s) => (s && String(s) !== String(current) ? `/${s}` : '')
  return [
    ...d.teams.map((t) => [t[tc.school], 'cfbt', join(t[tc.nick], t[tc.conf]), `/cfb-savant#team-${e(t[tc.id])}`, 9999]),
    ...d.players.map((p) => [p[c.name], 'cfb', join(p[c.slot], team.get(String(p[c.team])), span(p[c.first], p[c.last])), `/cfb-savant#player-${e(p[c.id])}${at(p[c.last])}`, yr(p[c.last])]),
  ]
}

// ---- gathering and writing ------------------------------------------------------------------

export function buildSearch({ publicDir, dist, warn = console.warn }) {
  const pub = (rel) => readJson(path.join(publicDir, rel))
  const built = (rel) => readJson(path.join(dist, rel))
  const take = (what, load, rows) => {
    try {
      const d = load()
      if (!d) { warn(`  search: ${what} skipped, its list is not there`); return [] }
      const out = rows(d).filter((r) => r[0] && r[3])
      if (!out.length) warn(`  search: ${what} gave no rows`)
      return out
    } catch (err) {
      warn(`  search: ${what} skipped (${err.message})`)
      return []
    }
  }
  const core = [
    ...take('NBA players', () => built('savant-api/basketball/v1/players.json'), nbaPlayers),
    ...take('NFL players', () => built('savant-api/football/v1/players.json'), nflPlayers),
    ...take('UFC fighters', () => built('savant-api/ufc/v1/fighters.json'), ufcFighters),
    ...take('NFL coaches', () => built('savant-api/coaching/v1/coaches.json'), nflCoaches),
    ...take('NBA coaches', () => pub('bcs/index.json'), nbaCoaches),
    ...take('CBB coaches', () => pub('cbcs/index.json.gz'), cbbCoaches),
    ...take('NBA teams', () => pub('bcs/index.json'), nbaTeams),
    ...take('NFL teams', () => pub('football-savant-current.json'), nflTeams),
  ]
  const cfbCurrent = pub('cfb/index.json.gz')?.current
  // teams always (year 9999); players only of the last COLLEGE_SEASONS seasons of their sport
  const recent = (rows) => {
    const newest = Math.max(0, ...rows.filter((r) => r[4] !== 9999).map((r) => r[4]))
    return rows.filter((r) => r[4] === 9999 || r[4] > newest - COLLEGE_SEASONS)
  }
  const college = [
    ...recent(take('CBB players and teams', () => pub('cbb/search.json.gz'), cbb)),
    ...recent(take('CFB players and teams', () => pub('cfb/search.json.gz'), (d) => cfb(d, cfbCurrent))),
  ]
  return { core, college }
}

export function writeSearch({ publicDir, dist, log = console.log, warn = console.warn }) {
  const { core, college } = buildSearch({ publicDir, dist, warn })
  const dir = path.join(dist, 'search')
  fs.mkdirSync(dir, { recursive: true })
  const meta = { generated: new Date().toISOString(), kinds: KINDS }
  let bytes = 0
  for (const [name, rows] of [['core', core], ['college', college]]) {
    const body = Buffer.from(JSON.stringify({ ...meta, rows }))
    fs.writeFileSync(path.join(dir, `${name}.json`), body)
    bytes += body.length
  }
  log(`  search: ${core.length} names in core, ${college.length} in college, ${(bytes / 1e6).toFixed(1)} MB before the server compresses them`)
  return { core: core.length, college: college.length, bytes }
}

// Vite plugin. It reads lists the savant-api plugin writes, so it must come after it in
// vite.config.js (plugins' closeBundle hooks run in order).
export default function siteSearch() {
  let dist
  let publicDir
  return {
    name: 'wce-site-search',
    apply: 'build',
    configResolved(c) {
      dist = path.resolve(c.root, c.build.outDir)
      publicDir = c.publicDir
    },
    closeBundle() {
      try {
        writeSearch({ publicDir, dist })
      } catch (err) {
        console.warn(`  search: not written (${err.message}); the ribbon's search will say it is unavailable`)
      }
    },
  }
}
