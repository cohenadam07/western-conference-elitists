// api/league.js — read a fantasy roster out of a league so people don't have to retype it.
//
// Normalises three platforms into one shape. Everything here is a public, unauthenticated
// read; nothing is stored and no credentials are ever asked for, which is also why Yahoo is
// absent — its API is OAuth-only, so there is no code a reader could paste that would work.
//
//   GET ?platform=sleeper&code=<username|leagueId>[&league=<id>]
//   GET ?platform=fantrax&code=<leagueId>
//   GET ?platform=espn&code=<leagueId>[&season=YYYY]
//
// Replies with either a league picker or the teams themselves:
//   { ok, platform, leagues: [{ id, name }] }                  -> ask which league
//   { ok, platform, teams:   [{ id, name, players: [...] }] }  -> ask which team
//
// Player-id dictionaries (Sleeper ~2.4 MB, Fantrax ~280 KB) are fetched once and cached in
// the same Upstash Redis the rest of the site uses, compacted to id -> name first. Without
// Redis it still works, just refetching on a cold lambda.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

const DICT_TTL = 86400
const CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/
const mem = new Map()                       // survives warm invocations

async function redis(cmd) {
  if (!URL_ || !TOKEN) return null
  try {
    const r = await fetch(URL_, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    })
    if (!r.ok) return null
    return (await r.json()).result
  } catch { return null }
}

async function cached(key, ttl, build) {
  if (mem.has(key)) return mem.get(key)
  const hit = await redis(['GET', key])
  if (hit) {
    try { const v = JSON.parse(hit); mem.set(key, v); return v } catch { /* rebuild */ }
  }
  const v = await build()
  mem.set(key, v)
  await redis(['SET', key, JSON.stringify(v), 'EX', ttl])
  return v
}

const jget = async (u) => {
  const r = await fetch(u, { headers: { accept: 'application/json' } })
  if (!r.ok) return null
  return r.json()
}

// ---------------------------------------------------------------- sleeper
const sleeperDict = () => cached('lg:dict:sleeper', DICT_TTL, async () => {
  const all = await jget('https://api.sleeper.app/v1/players/nba')
  const out = {}
  for (const id in all || {}) {
    const p = all[id]
    const nm = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ')
    if (nm) out[id] = nm
  }
  return out
})

async function sleeper(code, leagueId) {
  // a Sleeper league id is a long numeric string; anything else is a username
  const looksLikeLeague = /^\d{10,}$/.test(code)
  let lid = leagueId || (looksLikeLeague ? code : null)

  if (!lid) {
    const user = await jget(`https://api.sleeper.app/v1/user/${encodeURIComponent(code)}`)
    if (!user || !user.user_id) return { error: 'no-user' }
    // NBA seasons are keyed by their opening year; check this one and last so the tool keeps
    // working through the offseason, when "this season" has no leagues yet.
    const now = new Date()
    const yr = now.getUTCFullYear()
    const years = [String(now.getUTCMonth() >= 8 ? yr : yr - 1), String(yr)]
    const seen = new Set(), leagues = []
    for (const y of years) {
      const ls = await jget(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nba/${y}`)
      for (const l of ls || []) {
        if (seen.has(l.league_id)) continue
        seen.add(l.league_id)
        leagues.push({ id: l.league_id, name: `${l.name} · ${y}` })
      }
    }
    if (!leagues.length) return { error: 'no-leagues' }
    if (leagues.length > 1) return { leagues }
    lid = leagues[0].id
  }

  const [rosters, users, dict] = await Promise.all([
    jget(`https://api.sleeper.app/v1/league/${lid}/rosters`),
    jget(`https://api.sleeper.app/v1/league/${lid}/users`),
    sleeperDict(),
  ])
  if (!rosters || !rosters.length) return { error: 'no-league' }
  const owner = {}
  for (const u of users || []) owner[u.user_id] = u.display_name || u.username
  const teams = rosters.map((r) => ({
    id: String(r.roster_id),
    name: owner[r.owner_id] || `Team ${r.roster_id}`,
    players: (r.players || []).map((pid) => dict[pid]).filter(Boolean),
  })).filter((t) => t.players.length)
  return teams.length ? { teams } : { error: 'empty' }
}

// ---------------------------------------------------------------- fantrax
const fantraxDict = () => cached('lg:dict:fantrax', DICT_TTL, async () => {
  const all = await jget('https://www.fantrax.com/fxea/general/getPlayerIds?sport=NBA')
  const out = {}
  for (const id in all || {}) {
    const raw = all[id] && all[id].name
    if (!raw) continue
    // Fantrax spells names "Last, First" — flip so they match everything else
    const m = String(raw).split(',')
    out[id] = m.length > 1 ? `${m[1].trim()} ${m[0].trim()}` : String(raw).trim()
  }
  return out
})

async function fantrax(code) {
  const [res, dict] = await Promise.all([
    jget(`https://www.fantrax.com/fxea/general/getTeamRosters?leagueId=${encodeURIComponent(code)}`),
    fantraxDict(),
  ])
  if (!res || res.error) return { error: 'no-league' }
  const src = res.rosters || res
  const teams = []
  for (const tid in src) {
    const t = src[tid]
    if (!t || typeof t !== 'object') continue
    const items = t.rosterItems || t.players || []
    const players = items.map((it) => dict[it.id] || it.name).filter(Boolean)
    if (players.length) teams.push({ id: String(tid), name: t.teamName || `Team ${tid}`, players })
  }
  return teams.length ? { teams } : { error: 'empty' }
}

// ---------------------------------------------------------------- espn
async function espn(code, season) {
  const now = new Date()
  const yr = season || String(now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear())
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${yr}` +
              `/segments/0/leagues/${encodeURIComponent(code)}?view=mRoster&view=mTeam`
  const res = await jget(url)
  if (!res || !res.teams) return { error: 'no-league' }
  const teams = res.teams.map((t) => ({
    id: String(t.id),
    name: t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`,
    players: ((t.roster && t.roster.entries) || [])
      .map((e) => e.playerPoolEntry && e.playerPoolEntry.player && e.playerPoolEntry.player.fullName)
      .filter(Boolean),
  })).filter((t) => t.players.length)
  return teams.length ? { teams } : { error: 'empty' }
}

// ----------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const q = req.query || {}
    const platform = String(q.platform || '').toLowerCase()
    const code = String(q.code || '').trim()
    const league = String(q.league || '').trim()

    if (!CODE_RE.test(code)) { res.status(400).json({ ok: false, error: 'bad-code' }); return }
    if (league && !CODE_RE.test(league)) { res.status(400).json({ ok: false, error: 'bad-code' }); return }

    let out
    if (platform === 'sleeper') out = await sleeper(code, league)
    else if (platform === 'fantrax') out = await fantrax(code)
    else if (platform === 'espn') out = await espn(code, q.season && String(q.season).slice(0, 4))
    else { res.status(400).json({ ok: false, error: 'bad-platform' }); return }

    if (out.error) { res.status(200).json({ ok: false, error: out.error, platform }); return }
    res.status(200).json({ ok: true, platform, ...out })
  } catch (e) {
    res.status(200).json({ ok: false, error: 'failed', detail: String((e && e.message) || e) })
  }
}
