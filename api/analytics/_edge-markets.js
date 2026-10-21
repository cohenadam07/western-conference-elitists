// Edge Lab — where the prices and the game facts come from. All free and keyless:
//
//   Kalshi   NBA player props (points, rebounds, assists, threes, PRA): the quotes a paper bet
//            is priced at, the minute-by-minute quotes used for the closing line, and the
//            settled result. api.elections.kalshi.com/trade-api/v2, public market data.
//   ESPN     the night's games with exact tip times, and the injury feed (status plus the
//            news blurb and its date), refreshed through the day.
//   Sleeper  one join: Sleeper lists each player's Kalshi id, and savant-proj.json lists each
//            player's Sleeper id, so a Kalshi market lands on the right WCE projection.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { STATS } from './_edge-model.js'

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2'
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const SLEEPER_PLAYERS = 'https://api.sleeper.app/v1/players/nba'

export const SERIES = { KXNBAPTS: 'pts', KXNBAREB: 'reb', KXNBAAST: 'ast', KXNBA3PT: 'fg3m', KXNBAPRA: 'pra' }
export const SERIES_OF = Object.fromEntries(Object.entries(SERIES).map(([s, stat]) => [stat, s]))
export const STAT_LABEL = { pts: 'points', reb: 'rebounds', ast: 'assists', fg3m: 'threes', pra: 'pts+reb+ast' }
export const STAT_SHORT = { pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', pra: 'PRA' }
if (STATS.some((s) => !SERIES_OF[s])) throw new Error('Edge Lab: a stat has no Kalshi series')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ *
 * Kalshi
 * ------------------------------------------------------------------ */

// Kalshi's public limit is tight and it answers bursts with 429s, so calls are spaced and a
// refusal waits and tries again, but never past the caller's deadline: a job that runs into
// the function's 300 s ceiling is killed before it can write down what happened.
const KALSHI_GAP_MS = 260
let lastKalshi = 0
export class OutOfTime extends Error {}
async function kalshi(path, { tries = 5, deadline = Infinity } = {}) {
  let last = ''
  const left = () => deadline - Date.now()
  const nap = async (ms) => {
    if (left() - ms < 3000) throw new OutOfTime(`out of time waiting on Kalshi (${last})`)
    await sleep(ms)
  }
  for (let i = 0; i < tries; i++) {
    const wait = lastKalshi + KALSHI_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    if (left() < 4000) throw new OutOfTime('out of time before a Kalshi call')
    lastKalshi = Date.now()
    let res
    try {
      res = await fetch(KALSHI + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(Math.min(20000, Math.max(1000, left() - 2000))) })
    } catch (err) {
      last = String(err?.message || err)
      await nap(600 * 2 ** i)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      last = `HTTP ${res.status}`
      const ra = Number(res.headers.get('retry-after'))
      await nap(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 900 * 2 ** i)
      continue
    }
    if (!res.ok) throw new Error(`Kalshi HTTP ${res.status} on ${path.split('?')[0]}`)
    return res.json()
  }
  throw new Error(`Kalshi kept refusing ${path.split('?')[0]} (${last})`)
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

// "26OCT21MINMIA" -> { date: '2026-10-21', away: 'MIN', home: 'MIA' }
export function parseGameKey(key) {
  const m = /^(\d{2})([A-Z]{3})(\d{2})([A-Z]{3})([A-Z]{3})$/.exec(key || '')
  if (!m) return null
  const mon = MONTHS.indexOf(m[2]) + 1
  if (!mon) return null
  return { date: `20${m[1]}-${String(mon).padStart(2, '0')}-${m[3]}`, away: m[4], home: m[5] }
}

export function gameKey(dateET, away, home) {
  const [y, mo, d] = dateET.split('-')
  return `${y.slice(2)}${MONTHS[+mo - 1]}${d}${away}${home}`
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// One Kalshi prop market in the shape the lab uses. Null for anything that is not a plain
// "player reaches N+" contract.
export function parseMarket(raw) {
  const series = String(raw.event_ticker || '').split('-')[0]
  const stat = SERIES[series]
  if (!stat || raw.strike_type !== 'greater' || raw.market_type !== 'binary') return null
  const floor = num(raw.floor_strike)
  if (floor == null) return null
  const game = String(raw.event_ticker).split('-')[1]
  const title = String(raw.title || raw.yes_sub_title || '')
  return {
    ticker: raw.ticker,
    series,
    stat,
    game,
    k: Math.round(floor + 0.5), // "greater than 24.5" is "25+"
    kalshiPlayer: raw.custom_strike?.basketball_player || null,
    name: title.split(':')[0].trim(),
    title,
    bid: num(raw.yes_bid_dollars) ?? 0,
    ask: num(raw.yes_ask_dollars) ?? 1,
    noAsk: num(raw.no_ask_dollars),
    bidSize: num(raw.yes_bid_size_fp) ?? 0,
    askSize: num(raw.yes_ask_size_fp) ?? 0,
    volume: num(raw.volume_fp) ?? 0,
    occurs: raw.occurrence_datetime || null,
    status: raw.status,
    result: raw.result || '',
    value: raw.settlement_value_dollars ?? null,
    actual: num(raw.expiration_value), // the stat line Kalshi settled on, e.g. 27 points
    settled: ['settled', 'finalized', 'determined'].includes(raw.status) || Boolean(raw.result),
  }
}

async function listMarkets(query, opts) {
  const out = []
  let cursor = ''
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ ...query, limit: '1000' })
    if (cursor) q.set('cursor', cursor)
    const body = await kalshi(`/markets?${q}`, opts)
    for (const m of body.markets || []) {
      const p = parseMarket(m)
      if (p) out.push(p)
    }
    cursor = body.cursor || ''
    if (!cursor) break
  }
  return out
}

// Every open prop market in the five series, optionally only for some games.
export async function openMarkets(gameKeys, opts = {}) {
  const want = gameKeys ? new Set(gameKeys) : null
  const all = []
  for (const series of Object.keys(SERIES)) {
    const ms = await listMarkets({ series_ticker: series, status: 'open' }, opts)
    for (const m of ms) if (!want || want.has(m.game)) all.push(m)
  }
  return all
}

// One game's markets in every state, for settlement.
export async function gameMarkets(key, opts = {}) {
  const all = []
  for (const series of Object.keys(SERIES)) all.push(...(await listMarkets({ event_ticker: `${series}-${key}` }, opts)))
  return all
}

// The quote standing at tip-off: the last minute candle that ended at or before the tip.
// Candles only exist for minutes in which something changed, so the window looks back a full
// day; null means the quote never moved in that day (the caller then keeps the quote it bet
// at, which is what was still standing).
export async function quoteAt(series, ticker, atMs, opts = {}) {
  const end = Math.floor(atMs / 1000)
  const start = end - 24 * 3600
  const body = await kalshi(`/series/${series}/markets/${encodeURIComponent(ticker)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=1`, opts)
  const cs = (body.candlesticks || []).filter((c) => c.end_period_ts <= end)
  const c = cs[cs.length - 1]
  if (!c) return null
  const bid = num(c.yes_bid?.close_dollars)
  const ask = num(c.yes_ask?.close_dollars)
  if (bid == null || ask == null) return null
  return { bid, ask, at: new Date(c.end_period_ts * 1000).toISOString() }
}

/* ------------------------------------------------------------------ *
 * ESPN
 * ------------------------------------------------------------------ */

// ESPN's abbreviations where they differ from Kalshi's (which match the site's).
const ESPN_ABBR = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' }
export const fromEspn = (a) => ESPN_ABBR[a] || a

async function espn(path) {
  const res = await fetch(ESPN + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status} on ${path.split('?')[0]}`)
  return res.json()
}

// The ET date of a moment, as YYYY-MM-DD.
export const etDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms))

// One night's games: key (Kalshi's), tip (ms), teams, ESPN state ('pre' | 'in' | 'post').
export async function slate(dateET) {
  const body = await espn(`/scoreboard?dates=${dateET.replaceAll('-', '')}`)
  const games = []
  const teamNames = {}
  for (const e of body.events || []) {
    const c = e.competitions?.[0]
    const away = c?.competitors?.find((x) => x.homeAway === 'away')
    const home = c?.competitors?.find((x) => x.homeAway === 'home')
    if (!away || !home) continue
    const a = fromEspn(away.team.abbreviation), h = fromEspn(home.team.abbreviation)
    teamNames[away.team.displayName] = a
    teamNames[home.team.displayName] = h
    games.push({
      key: gameKey(dateET, a, h),
      date: dateET,
      away: a,
      home: h,
      tip: Date.parse(e.date),
      state: e.status?.type?.state || 'pre',
      name: e.shortName,
    })
  }
  return { games, teamNames }
}

// ESPN's injury feed: team abbreviation -> [{ name, status, date, comment }].
export async function injuries(teamNames) {
  const body = await espn('/injuries')
  const out = {}
  for (const t of body.injuries || []) {
    const abbr = teamNames[t.displayName]
    if (!abbr) continue
    out[abbr] = (t.injuries || []).map((i) => ({
      name: i.athlete?.displayName || '',
      status: i.status || i.type?.description || '',
      date: i.date || null,
      comment: (i.shortComment || '').slice(0, 280),
    }))
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Players
 * ------------------------------------------------------------------ */

// Kalshi player id -> Sleeper player id. Sleeper asks that its full player dump be pulled
// sparingly, so the caller keeps this for a day.
export async function sleeperKalshiMap() {
  const res = await fetch(SLEEPER_PLAYERS, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`Sleeper HTTP ${res.status}`)
  const body = await res.json()
  const map = {}
  for (const p of Object.values(body)) if (p?.kalshi_id && p.player_id) map[p.kalshi_id] = String(p.player_id)
  return map
}

export function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '')
}

// Finds each market's WCE projection row: by Kalshi id through Sleeper, then by name.
export function joinPlayers(markets, proj, kalshiToSleeper) {
  const bySleeper = new Map()
  const byName = new Map()
  for (const [id, p] of Object.entries(proj.players || {})) {
    if (p.slp) bySleeper.set(String(p.slp), id)
    byName.set(normName(p.name), id)
  }
  const unmatched = new Set()
  for (const m of markets) {
    const slp = m.kalshiPlayer && kalshiToSleeper ? kalshiToSleeper[m.kalshiPlayer] : null
    const id = (slp && bySleeper.get(slp)) || byName.get(normName(m.name)) || null
    m.playerId = id
    m.playerKey = `${m.game}|${id || normName(m.name)}`
    if (!id) unmatched.add(m.name)
  }
  return [...unmatched]
}

// "Out" and the like in ESPN's feed: the player will not play, so his markets will void.
export const isOut = (status) => /^(out|suspended|inactive|ir\b|injured reserve)/i.test(String(status || ''))
