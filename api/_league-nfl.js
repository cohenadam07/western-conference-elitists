// api/_league-nfl.js — read an NFL fantasy league from Sleeper, ESPN, MyFantasyLeague or
// Fantrax, and put it into one shape. Used by api/league.js (GET ?sport=nfl), which is the only
// place the site talks to the platforms; the AI connector reads leagues through that endpoint
// and never calls a platform itself.
//
// Everything here is a public, unauthenticated read. Nothing is stored except the platforms'
// own public player lists, compacted and cached for a day. (ESPN private leagues and Yahoo come
// later, each in its own change: claude/wce-league-sync.md.)
//
// THE SHAPE
//   { league: { platform, id, name, season, size, scoring, slots },
//     teams: [{ id, name, owner, players: [player] }] }
//   or { leagues: [{ id, name, season }] }  when a username has several leagues: ask which
//   or { error: <code> }                     see ERRORS in api/_league-pro.js for the words
//
//   player   { pid, name, pos, nfl, slot, injury, gsis }
//            pid     the platform's own id, as a string
//            pos     QB, RB, WR, TE, K, DEF, or IDP (defensive players, kept but not ranked)
//            nfl     NFL team as Football Savant writes it (LA, WAS, JAX...), or null
//            slot    'start', 'bench', 'ir', 'taxi', or null when the platform does not say
//            injury  the platform's injury word (Questionable, Out, IR...) or null
//            gsis    the NFL's own player id when the platform gives it (Sleeper does), else
//                    null; the connector maps the rest with public/football-ids.json
//   scoring  { rec, te_rec_bonus, pass_td, label }  rec is points per reception (1, 0.5, 0);
//            null where the platform's settings could not be read
//   slots    [{ slot, eligible: [...] }]  starting slots only, in the league's order
//
// Base URLs can be pointed elsewhere for tests with LEAGUE_NFL_BASES (a JSON object with any
// of sleeper, espn, mfl, fantrax). Never set in production.

const DICT_TTL = 86400
const mem = new Map()

const BASES = { sleeper: 'https://api.sleeper.app/v1', espn: 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl', mfl: 'https://api.myfantasyleague.com', fantrax: 'https://www.fantrax.com/fxea/general' }
function base(p) {
  try { const o = JSON.parse(process.env.LEAGUE_NFL_BASES || '{}'); if (o[p]) return String(o[p]).replace(/\/$/, '') } catch { /* default */ }
  return BASES[p]
}

async function redis(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(3000) })
    if (!r.ok) return null
    return (await r.json()).result
  } catch { return null }
}

async function cached(key, ttl, build) {
  const hit = mem.get(key)
  if (hit && hit.until > Date.now()) return hit.v
  const stored = await redis(['GET', key])
  if (stored) {
    try { const v = JSON.parse(stored); mem.set(key, { v, until: Date.now() + ttl * 1000 }); return v } catch { /* rebuild */ }
  }
  const v = await build()
  if (v && Object.keys(v).length) {
    mem.set(key, { v, until: Date.now() + ttl * 1000 })
    await redis(['SET', key, JSON.stringify(v), 'EX', ttl])
  }
  return v
}
export function clearLeagueNfl() { mem.clear() }

// A GET that says what happened: { status, body }. body is null when it is not JSON.
async function get(u, headers = {}) {
  const r = await fetch(u, { headers: { accept: 'application/json', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(15000) })
  let body = null
  try { body = JSON.parse(await r.text()) } catch { body = null }
  return { status: r.status, body }
}

// The NFL season a date belongs to: September through February is one season, named for the
// year it starts; March to August looks at the season just played until the next one begins.
export function nflSeason(now = new Date()) {
  const y = now.getUTCFullYear()
  return String(now.getUTCMonth() >= 2 ? (now.getUTCMonth() >= 7 ? y : y - 1) : y - 1)
}

const POS = (p) => {
  const x = String(p || '').toUpperCase()
  if (['QB', 'RB', 'WR', 'TE', 'K'].includes(x)) return x
  if (x === 'PK') return 'K'
  if (['DEF', 'DST', 'D/ST', 'TMDEF'].includes(x) || x === 'DEF') return 'DEF'
  if (['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S', 'IDP'].includes(x)) return 'IDP'
  return x || null
}
// Team codes as Football Savant writes them.
const NFL_CODE = { LVR: 'LV', JAC: 'JAX', LAR: 'LA', WSH: 'WAS', OAK: 'LV', SD: 'LAC', STL: 'LA', GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB' }
const nflTeam = (t) => { const x = String(t || '').toUpperCase().trim(); return !/^[A-Z]{2,3}$/.test(x) || x === 'FA' ? null : (NFL_CODE[x] || x) }

// Starting slots and who may fill them.
const ELIGIBLE = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], RB_WR: ['RB', 'WR'], WR_TE: ['WR', 'TE'],
  IDP: ['IDP'],
  TEAM_K: ['TEAM'], TEAM_QB: ['TEAM'], TEAM_RB: ['TEAM'], TEAM_WR: ['TEAM'], TEAM_TE: ['TEAM'],
}
const slot = (name) => ({ slot: name, eligible: ELIGIBLE[name] || (/IDP|DL|LB|DB/.test(name) ? ['IDP'] : []) })
const scoringLabel = (rec) => (rec == null ? null : rec >= 1 ? 'PPR' : rec >= 0.5 ? 'Half PPR' : rec > 0 ? `${rec} per reception` : 'Standard')

// ---------------------------------------------------------------- Sleeper
const sleeperDict = () => cached('lg:nfl:dict:sleeper', DICT_TTL, async () => {
  const { body } = await get(`${base('sleeper')}/players/nfl`)
  const out = {}
  for (const id in body || {}) {
    const p = body[id]
    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || (p.position === 'DEF' ? `${p.team} defense` : '')
    if (!name) continue
    out[id] = [name, p.position || (p.fantasy_positions || [])[0] || '', p.team || '', p.gsis_id ? String(p.gsis_id).trim() : '', p.injury_status || '']
  }
  return out
})

async function sleeper(code, leagueId, season) {
  const looksLikeLeague = /^\d{10,}$/.test(code)
  let lid = leagueId || (looksLikeLeague ? code : null)
  const yr = season || nflSeason()
  if (!lid) {
    const u = await get(`${base('sleeper')}/user/${encodeURIComponent(code)}`)
    if (!u.body || !u.body.user_id) return { error: 'no-user' }
    const ls = await get(`${base('sleeper')}/user/${u.body.user_id}/leagues/nfl/${yr}`)
    const leagues = (Array.isArray(ls.body) ? ls.body : []).map((l) => ({ id: String(l.league_id), name: String(l.name), season: yr }))
    if (!leagues.length) return { error: 'no-leagues' }
    if (leagues.length > 1) return { leagues }
    lid = leagues[0].id
  }
  const [lg, rosters, users, dict] = await Promise.all([
    get(`${base('sleeper')}/league/${lid}`),
    get(`${base('sleeper')}/league/${lid}/rosters`),
    get(`${base('sleeper')}/league/${lid}/users`),
    sleeperDict(),
  ])
  if (!lg.body || !Array.isArray(rosters.body)) return { error: 'no-league' }
  if (lg.body.sport && lg.body.sport !== 'nfl') return { error: 'not-nfl' }
  const owner = {}
  const teamName = {}
  for (const u of users.body || []) { owner[u.user_id] = u.display_name || u.username || null; if (u.metadata && u.metadata.team_name) teamName[u.user_id] = u.metadata.team_name }
  const teams = rosters.body.map((r) => {
    const starters = new Set((r.starters || []).map(String))
    const ir = new Set((r.reserve || []).map(String))
    const taxi = new Set((r.taxi || []).map(String))
    const players = (r.players || []).map(String).filter((pid) => pid !== '0').map((pid) => {
      const d = dict[pid]
      const isDef = /^[A-Z]{2,3}$/.test(pid)
      const name = d ? d[0] : isDef ? `${pid} defense` : `Sleeper player ${pid}`
      return { pid, name, pos: POS(d ? d[1] : isDef ? 'DEF' : ''), nfl: nflTeam(d ? d[2] : isDef ? pid : ''), slot: starters.has(pid) ? 'start' : ir.has(pid) ? 'ir' : taxi.has(pid) ? 'taxi' : 'bench', injury: (d && d[4]) || null, gsis: (d && d[3]) || null }
    })
    return { id: String(r.roster_id), name: teamName[r.owner_id] || owner[r.owner_id] || `Team ${r.roster_id}`, owner: owner[r.owner_id] || null, players }
  })
  const sc = lg.body.scoring_settings || {}
  const rec = sc.rec ?? null
  return {
    league: {
      platform: 'sleeper', id: String(lid), name: lg.body.name || null, season: String(lg.body.season || yr), size: teams.length,
      scoring: { rec, te_rec_bonus: sc.bonus_rec_te || 0, pass_td: sc.pass_td ?? null, label: scoringLabel(rec) },
      slots: (lg.body.roster_positions || []).filter((x) => !['BN', 'IR', 'TAXI'].includes(x)).map((x) => slot(x === 'IDP_FLEX' || /^(DL|LB|DB)$/.test(x) ? 'IDP' : x)),
    },
    teams,
  }
}

// ---------------------------------------------------------------- ESPN
const ESPN_SLOT = { 0: 'QB', 2: 'RB', 3: 'RB_WR', 4: 'WR', 5: 'WR_TE', 6: 'TE', 7: 'SUPER_FLEX', 8: 'IDP', 9: 'IDP', 10: 'IDP', 11: 'IDP', 12: 'IDP', 13: 'IDP', 14: 'IDP', 15: 'IDP', 16: 'DEF', 17: 'K', 23: 'FLEX' }
const ESPN_POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' }
const ESPN_TEAM = { 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LA', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' }
const ESPN_INJURY = { ACTIVE: null, NORMAL: null, QUESTIONABLE: 'Questionable', DOUBTFUL: 'Doubtful', OUT: 'Out', INJURY_RESERVE: 'IR', SUSPENSION: 'Suspended', DAY_TO_DAY: 'Questionable' }

async function espn(code, season) {
  const yr = season || nflSeason()
  const r = await get(`${base('espn')}/seasons/${yr}/segments/0/leagues/${encodeURIComponent(code)}?view=mRoster&view=mTeam&view=mSettings`)
  if (r.status === 401 || r.status === 403) return { error: 'private' }
  if (!r.body || !Array.isArray(r.body.teams)) return { error: 'no-league' }
  const d = r.body
  const owner = {}
  for (const m of d.members || []) owner[m.id] = m.displayName || [m.firstName, m.lastName].filter(Boolean).join(' ') || null
  const teams = d.teams.map((t) => ({
    id: String(t.id),
    name: t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`,
    owner: owner[t.primaryOwner] || null,
    players: ((t.roster && t.roster.entries) || []).map((e) => {
      const pl = e.playerPoolEntry && e.playerPoolEntry.player
      if (!pl) return null
      const pos = ESPN_POS[pl.defaultPositionId] || (pl.defaultPositionId >= 7 && pl.defaultPositionId <= 15 ? 'IDP' : null)
      return { pid: String(pl.id), name: pl.fullName || (pos === 'DEF' ? `${ESPN_TEAM[pl.proTeamId] || ''} defense`.trim() : `ESPN player ${pl.id}`), pos, nfl: ESPN_TEAM[pl.proTeamId] || null, slot: e.lineupSlotId === 20 ? 'bench' : e.lineupSlotId === 21 ? 'ir' : 'start', injury: pl.injuryStatus in ESPN_INJURY ? ESPN_INJURY[pl.injuryStatus] : (pl.injuryStatus || null), gsis: null }
    }).filter(Boolean),
  }))
  const s = d.settings || {}
  const items = (s.scoringSettings && s.scoringSettings.scoringItems) || []
  const pts = (id) => { const i = items.find((x) => x.statId === id); return i ? i.points : null }
  const recItem = items.find((x) => x.statId === 53)
  const rec = recItem ? recItem.points : 0
  const teRec = recItem && recItem.pointsOverrides && recItem.pointsOverrides['6'] != null ? recItem.pointsOverrides['6'] - rec : 0
  const counts = (s.rosterSettings && s.rosterSettings.lineupSlotCounts) || {}
  const slots = []
  for (const id of [0, 7, 2, 3, 4, 5, 6, 23, 16, 17, 8, 9, 10, 11, 12, 13, 14, 15]) for (let i = 0; i < (counts[id] || 0); i++) slots.push(slot(ESPN_SLOT[id]))
  return {
    league: { platform: 'espn', id: String(d.id), name: s.name || null, season: String(d.seasonId || yr), size: teams.length, scoring: { rec, te_rec_bonus: teRec, pass_td: pts(4), label: scoringLabel(rec) }, slots },
    teams,
  }
}

// ---------------------------------------------------------------- MyFantasyLeague
const mflDict = (yr) => cached(`lg:nfl:dict:mfl:${yr}`, DICT_TTL, async () => {
  const { body } = await get(`${base('mfl')}/${yr}/export?TYPE=players&JSON=1`)
  const out = {}
  const list = body && body.players && body.players.player
  for (const p of Array.isArray(list) ? list : list ? [list] : []) {
    const parts = String(p.name || '').split(',')
    const name = parts.length > 1 ? `${parts[1].trim()} ${parts[0].trim()}` : String(p.name || '').trim()
    out[p.id] = [p.position === 'Def' ? `${name} defense` : name, p.position || '', p.team || '']
  }
  return out
})
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x])
const MFL_SLOT = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', PK: 'K', Def: 'DEF', TMDEF: 'DEF', TMPK: 'TEAM_K', TMQB: 'TEAM_QB', TMRB: 'TEAM_RB', TMWR: 'TEAM_WR', TMTE: 'TEAM_TE', DL: 'IDP', LB: 'IDP', DB: 'IDP', DE: 'IDP', DT: 'IDP', CB: 'IDP', S: 'IDP' }

async function mfl(code, season) {
  const yr = season || nflSeason()
  const L = encodeURIComponent(code)
  const [lg, ro, ru, dict] = await Promise.all([
    get(`${base('mfl')}/${yr}/export?TYPE=league&L=${L}&JSON=1`),
    get(`${base('mfl')}/${yr}/export?TYPE=rosters&L=${L}&JSON=1`),
    get(`${base('mfl')}/${yr}/export?TYPE=rules&L=${L}&JSON=1`),
    mflDict(yr),
  ])
  if (lg.body && lg.body.error) return { error: /private|password|log ?in/i.test(JSON.stringify(lg.body.error)) ? 'private' : 'no-league' }
  if (!lg.body || !lg.body.league || !ro.body || !ro.body.rosters) return { error: 'no-league' }
  const L0 = lg.body.league
  const fr = {}
  for (const f of arr(L0.franchises && L0.franchises.franchise)) fr[f.id] = { name: f.name || `Franchise ${f.id}`, owner: f.owner_name || null }
  const teams = arr(ro.body.rosters.franchise).map((f) => ({
    id: String(f.id), name: (fr[f.id] || {}).name || `Franchise ${f.id}`, owner: (fr[f.id] || {}).owner || null,
    players: arr(f.player).map((p) => {
      const d = dict[p.id]
      const unit = d && /^TM(?!DEF)/.test(d[1]) // a whole team's kickers, receivers...: not one player
      return { pid: String(p.id), name: d ? d[0] : `MFL player ${p.id}`, pos: unit ? 'TEAM' : POS(d ? (MFL_SLOT[d[1]] || d[1]) : ''), nfl: nflTeam(d ? d[2] : ''), slot: p.status === 'INJURED_RESERVE' ? 'ir' : p.status === 'TAXI_SQUAD' ? 'taxi' : null, injury: null, gsis: null }
    }),
  }))
  // Starters: fixed minimums per position, the rest a flex across the positions allowed more.
  const st = L0.starters || {}
  const total = Number(st.count) || 0
  const slots = []
  const flexable = []
  for (const p of arr(st.position)) {
    const [lo, hi] = String(p.limit || '0').split('-').map(Number)
    const name = MFL_SLOT[p.name] || p.name
    for (let i = 0; i < (lo || 0); i++) slots.push(slot(name))
    if (hi > lo) flexable.push(name)
  }
  for (let i = slots.length; i < total; i++) slots.push({ slot: 'FLEX', eligible: flexable.length ? flexable : ['RB', 'WR', 'TE'] })
  // Points per catch: the first rule for the CC event that covers receivers.
  let rec = null
  for (const pr of arr(ru.body && ru.body.rules && ru.body.rules.positionRules)) {
    if (!/WR|RB|TE/.test(String(pr.positions))) continue
    const cc = arr(pr.rule).find((x) => x.event && x.event.$t === 'CC')
    if (cc) { const m = String(cc.points.$t).match(/-?[\d.]+/); rec = m ? Number(m[0]) : null; break }
  }
  if (rec == null && ru.body && ru.body.rules) rec = 0
  return {
    league: { platform: 'mfl', id: String(L0.id || code), name: L0.name || null, season: yr, size: teams.length, scoring: { rec, te_rec_bonus: 0, pass_td: null, label: scoringLabel(rec) }, slots },
    teams,
  }
}

// ---------------------------------------------------------------- Fantrax
// Built from the shape Fantrax's public feed has for NBA (api/league.js), with NFL's own player
// list. Not yet checked against a live NFL league: claude/wce-league-sync.md.
const fantraxDict = () => cached('lg:nfl:dict:fantrax', DICT_TTL, async () => {
  const { body } = await get(`${base('fantrax')}/getPlayerIds?sport=NFL`)
  const out = {}
  for (const id in body || {}) {
    const p = body[id]
    if (!p || !p.name) continue
    const parts = String(p.name).split(',')
    const name = parts.length > 1 ? `${parts[1].trim()} ${parts[0].trim()}` : String(p.name).trim()
    out[id] = [name, String(p.position || '').split(',')[0].trim(), p.team || '']
  }
  return out
})
const FANTRAX_SLOT = { ACTIVE: 'start', RESERVE: 'bench', INJURED_RESERVE: 'ir', IR: 'ir', MINORS: 'taxi' }

async function fantrax(code) {
  const [r, dict] = await Promise.all([get(`${base('fantrax')}/getTeamRosters?leagueId=${encodeURIComponent(code)}`), fantraxDict()])
  if (!r.body || r.body.error) return { error: 'no-league' }
  const src = r.body.rosters || r.body
  const teams = []
  for (const tid in src) {
    const t = src[tid]
    if (!t || typeof t !== 'object' || !Array.isArray(t.rosterItems || t.players)) continue
    const players = (t.rosterItems || t.players).map((it) => {
      const d = dict[it.id]
      return { pid: String(it.id), name: d ? d[0] : (it.name || `Fantrax player ${it.id}`), pos: POS(it.position || (d && d[1])), nfl: nflTeam(d ? d[2] : ''), slot: FANTRAX_SLOT[it.status] || null, injury: null, gsis: null }
    })
    teams.push({ id: String(tid), name: t.teamName || `Team ${tid}`, owner: null, players })
  }
  if (!teams.length) return { error: 'empty' }
  return { league: { platform: 'fantrax', id: String(code), name: null, season: nflSeason(), size: teams.length, scoring: { rec: null, te_rec_bonus: 0, pass_td: null, label: null }, slots: [] }, teams }
}

// ----------------------------------------------------------------
export const PLATFORMS = ['sleeper', 'espn', 'mfl', 'fantrax']

export async function readNflLeague({ platform, code, league, season } = {}) {
  const yr = season && /^\d{4}$/.test(String(season)) ? String(season) : null
  let out
  if (platform === 'sleeper') out = await sleeper(code, league, yr)
  else if (platform === 'espn') out = await espn(code, yr)
  else if (platform === 'mfl') out = await mfl(code, yr)
  else if (platform === 'fantrax') out = await fantrax(code)
  else return { error: 'bad-platform' }
  if (out.teams && !out.teams.some((t) => t.players.length)) return { error: 'empty' }
  return out
}
