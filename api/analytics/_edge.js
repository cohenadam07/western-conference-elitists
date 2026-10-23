// Edge Lab — a private, forward-only test of whether WCE's analytics, read by Claude, beat the
// prices on NBA player props. Paper bets only: nothing here can place an order anywhere.
//
// THE TEST
//   Three forecasters ("arms") price the same Kalshi prop markets, blind to the prices:
//     model       the WCE projection turned into a probability (no Claude)
//     claude_wce  Claude given WCE's analytics
//     claude_box  Claude given box scores only
//   Each arm takes at most one paper bet per player per game, when its edge over the ask
//   clears 3 points after Kalshi's fee. The verdict is closing line value: did the price move
//   toward us by tip-off? Hit rate and P&L ride along but need far more bets to mean anything.
//   Every forecast (bet or not) is also scored against the market's own mid, so calibration
//   and Brier skill show up long before the bets can say anything.
//
// THE JOBS (all run inside api/analytics/snapshot.js, so the lab costs no function slot)
//   picks   hourly-ish, 10am to 10pm ET (Hobby crons are daily, so one entry per hour).
//           Prepares every game tipping 20 to 150 minutes out: the markets, the WCE model's
//           numbers and both Claude prompts. Hobby fires anywhere in the hour; a 130-minute
//           window covers the worst gap between runs. Then, by the Claude mode
//           (_edge-claude.js):
//             task  the game waits as "pending" for the scheduled task on Adam's Claude account
//             api   both Claude arms are asked right here, and the game is decided
//           It also closes any pending game within 15 minutes of tip with what it has.
//   queue   called by the scheduled task. Prepares games tipping 15 minutes to 3 h 45 min out
//           and hands back every pending prompt as a self-contained text.
//   answer  called by the scheduled task, once per game and arm. When both arms are in, the
//           game is decided at Kalshi's quotes of that moment, for all three arms at once.
//   settle  every morning. Results from Kalshi, closing quotes from Kalshi's minute candles
//           at the tip, P&L and CLV per bet, aggregates per game.
//
// STORAGE (Upstash, beside the analytics archive)
//   wce:edge:games         hash  game key -> record (preparing / pending / decided / settled)
//   wce:edge:pending:<g>   hash  packet (markets, model numbers, prompts) + each Claude answer
//   wce:edge:fc:<game>     JSON  every quoted market at decision time with each arm's number
//   wce:edge:bets:<game>   JSON  the paper bets, Claude's notes, then the results
//   wce:edge:meta          hash  last run, status, error
//   wce:edge:runs          list  the last 200 runs
//   wce:edge:ids           JSON  Kalshi -> Sleeper player ids, refreshed daily
//   wce:edge:tries         hash  game key -> failed Claude attempts (a game is retried once)
//   wce:edge:ledger        hash  game key -> each bet in one short row, for the portfolios
//   wce:edge:marks         JSON  Kalshi's live values for open bets, kept 20 seconds
//   wce:edge:ticks:<date>  list  the portfolios' value through a night, about once a minute
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { createHash } from 'node:crypto'
import { parseJSONSafe, redis, redisPipeline, timingSafeEqual, toHash } from './_lib.js'
import { origin } from '../_core.js'
import * as M from './_edge-model.js'
import * as K from './_edge-markets.js'
import { askClaude, buildPrompt, claudeMode, claudeModel, dataText, parseForecasts, taskText } from './_edge-claude.js'

export const NS = 'wce:edge'
const KEY = {
  games: `${NS}:games`,
  meta: `${NS}:meta`,
  runs: `${NS}:runs`,
  lock: `${NS}:lock`,
  ids: `${NS}:ids`,
  tries: `${NS}:tries`,
  bets: (g) => `${NS}:bets:${g}`,
  fc: (g) => `${NS}:fc:${g}`,
  pending: (g) => `${NS}:pending:${g}`,
  fin: (g) => `${NS}:fin:${g}`,
  ledger: `${NS}:ledger`,
  marks: `${NS}:marks`,
  tickGate: `${NS}:tickgate`,
  ticks: (d) => `${NS}:ticks:${d}`,
  arms: `${NS}:arms`,
}
// The Claude arms a game is prepared for. The report-card arm can be switched off with
// EDGE_RC=off without touching the others. A game is waiting on exactly the arms its packet
// has a prompt for, so games prepared before an arm existed are never stuck waiting on it.
const claudeArms = () => M.CLAUDE_FORECASTERS.filter((a) => a !== 'claude_rc' || String(process.env.EDGE_RC || '').toLowerCase() !== 'off')
const packetArms = (packet) => Object.keys(packet?.prompts || {}).filter((a) => M.CLAUDE_FORECASTERS.includes(a))

// The scheduled task proves itself with a token (header x-edge-token) that can only queue and
// answer. Only its SHA-256 lives here: the token itself is in the task's instructions on Adam's
// account. EDGE_TASK_TOKEN_SHA256 replaces it without a code change.
const TASK_TOKEN_SHA256 = '5075c6fc3da1fe42c2f7a5de244f1ec5419ad064e540aceebadf466da28cf9d0'
export function taskTokenOk(presented) {
  if (!presented) return false
  const want = (process.env.EDGE_TASK_TOKEN_SHA256 || TASK_TOKEN_SHA256).toLowerCase()
  return timingSafeEqual(createHash('sha256').update(String(presented)).digest('hex'), want)
}

// The weekly researcher (a second scheduled task) has its own token, header x-edge-research,
// which can only read the review and add or retire rule arms: paper betting rules over
// forecasts the lab already makes. It can't fetch prompts, post forecasts or read the page.
// The morning email (a third scheduled task) can only read the review: header x-edge-digest.
// Only its SHA-256 lives here; EDGE_DIGEST_TOKEN_SHA256 replaces it without a code change.
const DIGEST_TOKEN_SHA256 = 'bc3d385cf5a89a1f1785c00ba6466b902c4f5093ee548b9c7ed2de0a98a4c7cf'
export function digestTokenOk(presented) {
  const want = String(process.env.EDGE_DIGEST_TOKEN_SHA256 || DIGEST_TOKEN_SHA256).toLowerCase()
  if (!presented || !/^[0-9a-f]{64}$/.test(want)) return false
  return timingSafeEqual(createHash('sha256').update(String(presented)).digest('hex'), want)
}

// Only its SHA-256 lives here; EDGE_RESEARCH_TOKEN_SHA256 replaces it without a code change.
const RESEARCH_TOKEN_SHA256 = '632f6c1121e09430c4428e1239b61643e680b58403ae194493d6e952ccdaabd4'
export function researchTokenOk(presented) {
  const want = String(process.env.EDGE_RESEARCH_TOKEN_SHA256 || RESEARCH_TOKEN_SHA256).toLowerCase()
  if (!presented || !/^[0-9a-f]{64}$/.test(want)) return false
  return timingSafeEqual(createHash('sha256').update(String(presented)).digest('hex'), want)
}

// UTC. 14:00 to 02:00 is 10am to 10pm EDT (9am to 9pm EST); each fires somewhere in its hour.
export const PICK_SCHEDULES = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2].map((h) => `0 ${h} * * *`)
export const SETTLE_SCHEDULE = '0 11 * * *' // 7am EDT / 6am EST, after every game is final
// 11pm to 1am EDT (10pm to midnight EST): a point on the portfolios' line while late games
// play, for nights nobody has the page open. The page adds a point a minute while it is open.
export const TICK_SCHEDULES = [3, 4, 5].map((h) => `0 ${h} * * *`)
export const jobForSchedule = (s) => (s === SETTLE_SCHEDULE ? 'edge-settle' : PICK_SCHEDULES.includes(s) ? 'edge-picks' : TICK_SCHEDULES.includes(s) ? 'edge-tick' : null)

const MIN = 60e3
const LEAD_MIN = 20 * MIN
const LEAD_MAX = 150 * MIN
const DECIDE_BUDGET = 190e3 // stop starting games after this; the next run picks up the rest
const SETTLE_BUDGET = 230e3
const SETTLE_AFTER = 3.5 * 60 * MIN // a game this long past its tip is over
const SETTLE_GIVE_UP = 48 * 60 * MIN // markets still open this long after the tip are voided
const QUOTE_MAX_SPREAD = 0.15 // markets quoted tighter than this are forecast and scored
const RETRY_LEAD = 40 * MIN // a game whose Claude call failed is retried if it tips later than this
const MAX_TRIES = 2
const CLOSE_LEAD = 15 * MIN // a pending game this close to tip is decided with what it has
const QUEUE_LEAD_MIN = 15 * MIN // the scheduled task prepares games tipping between these
const QUEUE_LEAD_MAX = 225 * MIN
const STALE_CLAIM = 4 * MIN // a "preparing" claim older than this was abandoned
const MIN_PRICED = 0.8 // an answer must price this share of the markets to count
const EDGE_MIN = () => { const v = Number(process.env.EDGE_MIN_EDGE); return Number.isFinite(v) && v > 0 ? v : M.BET_RULES.minEdge }

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

async function siteJson(path) {
  const res = await fetch(`${origin()}/${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return JSON.parse(await res.text())
}

async function takeLock(ms) {
  const token = Math.random().toString(36).slice(2)
  const ok = await redis(['SET', KEY.lock, token, 'NX', 'PX', String(ms)])
  return ok ? token : null
}
async function dropLock(token) {
  const cur = await redis(['GET', KEY.lock]).catch(() => null)
  if (cur === token) await redis(['DEL', KEY.lock]).catch(() => {})
}

async function logRun(entry) {
  const at = new Date().toISOString()
  const rec = JSON.stringify({ at, ...entry })
  await redisPipeline([
    ['LPUSH', KEY.runs, rec],
    ['LTRIM', KEY.runs, '0', '199'],
    ['HSET', KEY.meta, 'lastRun', at, 'lastJob', entry.job, 'lastStatus', entry.status, 'lastError', entry.error || '',
      'claude', claudeMode(), 'model', claudeModel()],
    ['HINCRBY', KEY.meta, 'runs', '1'],
  ])
}

// Kalshi -> Sleeper ids, pulled at most once a day (Sleeper's ask) and kept in the store.
async function kalshiIds(today) {
  const cached = parseJSONSafe(await redis(['GET', KEY.ids]).catch(() => null), null)
  if (cached && cached.day === today && cached.map) return cached.map
  try {
    const map = await K.sleeperKalshiMap()
    await redis(['SET', KEY.ids, JSON.stringify({ day: today, map }), 'EX', String(3 * 86400)])
    return map
  } catch (err) {
    if (cached?.map) return cached.map
    throw err
  }
}

const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1)
const signed = (x) => `${x >= 0 ? '+' : '−'}${r1(Math.abs(x))}`

/* ------------------------------------------------------------------ *
 * Context for the Claude + WCE arm
 * ------------------------------------------------------------------ */

const SAVANT_STATS = [
  ['usg', 'usage %'], ['ts', 'TS%'], ['tp3a', '3PA/g'], ['tp3', '3P%'], ['fta', 'FTA/g'], ['ast', 'AST%'],
  ['potast', 'potential ast/75'], ['reb75', 'reb/75'], ['oreb', 'OREB%'], ['dreb', 'DREB%'], ['minshare', 'minutes share'], ['avail', 'availability'],
]
const PEERS = { Guard: 'guards', Wing: 'wings', Big: 'bigs' }

async function wceContext() {
  const [meta, teamsAll, teamsNow] = await Promise.all([
    siteJson('savant-api/basketball/v1/meta.json').catch(() => null),
    siteJson('savant-teams.json').catch(() => null),
    siteJson('savant-teams-current.json').catch(() => null),
  ])
  let savant = null, savantSeason = null
  if (meta?.seasons?.length) {
    const latest = meta.seasons[0]
    savantSeason = (meta.qualified?.[latest]?.league || 0) >= 150 ? latest : meta.seasons[1]
    const file = await siteJson(`savant-api/basketball/v1/seasons/${savantSeason}.json`).catch(() => null)
    if (file?.players) savant = new Map(file.players.map((p) => [String(p.id), p]))
  }
  // Team ratings: this season once teams have 10 games, last season before that.
  let teamSeason = null, teams = null, record = {}
  const now = teamsNow?.seasons?.[0] && teamsNow.data[teamsNow.seasons[0]]
  for (const t of now?.teams || []) record[t.abbr] = `${t.w}-${t.l}`
  if (now?.teams?.length && now.teams.every((t) => t.gp >= 10)) { teamSeason = teamsNow.seasons[0]; teams = now.teams }
  else if (teamsAll?.seasons?.length) { teamSeason = teamsAll.seasons[0]; teams = teamsAll.data[teamSeason]?.teams || null }
  return { savant, savantSeason, teams, teamSeason, record }
}

function teamLine(ctx, abbr) {
  const ts = ctx.teams
  const t = ts?.find((x) => x.abbr === abbr)
  if (!t) return `${abbr}: no team ratings available.`
  const rk = (f, low) => { const vals = ts.map(f).filter((v) => v != null).sort((a, b) => (low ? a - b : b - a)); return ordinal(vals.indexOf(f(t)) + 1) }
  const ff = t.ff || {}
  // Ranks are out of 30 with 1st the fastest for pace and the best for everything else.
  const bits = [
    `pace ${r1(t.pace)} (${rk((x) => x.pace)})`,
    `ORtg ${r1(t.ortg)} (${rk((x) => x.ortg)})`,
    `DRtg ${r1(t.drtg)} (${rk((x) => x.drtg, true)})`,
  ]
  if (ff.oefg != null) bits.push(`opp eFG ${(ff.oefg * 100).toFixed(1)}% (${rk((x) => x.ff?.oefg, true)})`)
  if (ff.oorb != null) bits.push(`def reb ${((1 - ff.oorb) * 100).toFixed(1)}% (${rk((x) => (x.ff ? 1 - x.ff.oorb : null))})`)
  if (ff.oftr != null) bits.push(`opp FT rate ${ff.oftr.toFixed(3)} (${rk((x) => x.ff?.oftr, true)})`)
  if (t.ofg3 != null) bits.push(`opp 3P% ${(t.ofg3 * 100).toFixed(1)} (${rk((x) => x.ofg3, true)})`)
  const rec = ctx.record[abbr] ? ` This season so far: ${ctx.record[abbr]}.` : ''
  return `${abbr} (${ctx.teamSeason}): ${bits.join(', ')}.${rec}`
}

function savantFacts(ctx, id) {
  const row = ctx.savant?.get(String(id))
  if (!row?.m) return null
  const out = []
  for (const [key, label] of SAVANT_STATS) {
    const v = row.m[key]
    if (!Array.isArray(v) || v[0] == null || v[2] == null) continue
    const value = key === 'ts' ? v[0].toFixed(3).replace(/^0/, '') : String(v[0])
    out.push({ label, value, pct: v[2] })
  }
  return { facts: out, peers: PEERS[row.pos] || 'his position' }
}

/* ------------------------------------------------------------------ *
 * Preparing games
 * ------------------------------------------------------------------ */

// The slate around now (plus any dates asked for), from ESPN.
async function loadSlate(now, extraDates = []) {
  const dates = [...new Set([K.etDate(now), K.etDate(now + 4 * 60 * MIN), ...extraDates])]
  const slates = await Promise.all(dates.map((d) => K.slate(d)))
  return { games: slates.flatMap((s) => s.games), teamNames: Object.assign({}, ...slates.map((s) => s.teamNames)) }
}

// Everything preparing a batch of games needs, fetched once.
async function loadInputs(games, teamNames, { deadline, warnings }) {
  const [markets, proj, ids, inj, ctx] = await Promise.all([
    K.openMarkets(games.map((g) => g.key), { deadline }),
    siteJson('savant-proj.json'),
    // Without Sleeper the join falls back to names, which matches nearly everyone.
    kalshiIds(K.etDate(Date.now())).catch((err) => { warnings.push(`Sleeper ids unavailable (${err?.message || err}); matched players by name`); return {} }),
    K.injuries(teamNames).then((v) => ({ ok: true, v })).catch((err) => ({ ok: false, err })),
    claudeMode() !== 'off' ? wceContext() : Promise.resolve({}),
  ])
  const reportCard = claudeArms().includes('claude_rc') ? await buildReportCard().catch(() => null) : null
  if (!inj.ok) warnings.push(`ESPN injuries unavailable (${inj.err?.message || inj.err}); used the projection file's statuses`)
  const unmatched = K.joinPlayers(markets, proj, ids)
  if (unmatched.length) warnings.push(`no WCE projection for: ${unmatched.slice(0, 12).join(', ')}${unmatched.length > 12 ? '…' : ''}`)
  const ix = {}
  ;(proj.log_cols || []).forEach((c, i) => { ix[c] = i })

  // Who played the night before each game, for back-to-backs.
  const prev = [...new Set(games.map((g) => dayBefore(g.date)))]
  const playedOn = new Set()
  await Promise.all(prev.map(async (d) => {
    try {
      for (const g of (await K.slate(d)).games) { playedOn.add(`${g.away}|${d}`); playedOn.add(`${g.home}|${d}`) }
    } catch (err) {
      warnings.push(`couldn't read ${d}'s games for back-to-backs (${err?.message || err})`)
    }
  }))
  return { markets, proj, ix, injuries: inj.ok ? inj.v : {}, injuriesOk: inj.ok, ctx, playedOn, prevKnown: new Set(prev), reportCard }
}

// The report card for the claude_rc arm, from settled games: its own record once it has 1,000
// scored forecasts, before that the record of Claude + WCE (the same information, without a
// card). Facts about past forecasts against results only.
const RC_OWN_AFTER = 1000
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
async function buildReportCard() {
  const games = Object.values(toHash(await redis(['HGETALL', KEY.games]))).map((v) => parseJSONSafe(v, null)).filter((g) => g?.status === 'settled')
  if (!games.length) return null
  await refreshAggregates(games).catch(() => 0) // older games gain the per-stat sums the card reads
  const sum = (arm) => {
    const fc = M.emptyFcAgg(), stats = {}
    for (const g of games) {
      M.mergeFcAgg(fc, g.agg?.[arm]?.fc)
      for (const [st, a] of Object.entries(g.agg?.[arm]?.fcStat || {})) {
        stats[st] = stats[st] || M.emptyStatAgg()
        for (const k of Object.keys(stats[st])) stats[st][k] += a[k] || 0
      }
    }
    return { fc, stats }
  }
  let own = true, s = sum('claude_rc')
  if (s.fc.n < RC_OWN_AFTER) { own = false; s = sum('claude_wce') }
  if (s.fc.n < 200) return null
  const d = M.describeForecasts(s.fc)
  return {
    own, n: s.fc.n, through: shortDay(games.map((g) => g.date).sort().at(-1)),
    skill: d.skill, lean: s.fc.dsum / s.fc.n,
    calibration: d.calibration.filter((b) => b.n).map((b) => ({ n: b.n, predicted: b.predicted, actual: b.actual })),
    stats: Object.fromEntries(Object.entries(s.stats).map(([k, a]) => [k, { n: a.n, skill: a.brierMkt > 0 ? 1 - a.brier / a.brierMkt : 0, lean: a.n ? a.dsum / a.n : 0 }])),
  }
}

// How many games each date has on ESPN's schedule, for the portfolios' per-game cap.
const slateSizes = (games) => games.reduce((m, g) => { m[g.date] = (m[g.date] || 0) + 1; return m }, {})

const dayBefore = (date) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }

// Claims a game so two runs (a cron and the scheduled task, say) never prepare it twice.
async function claim(key) {
  const rec = JSON.stringify({ key, status: 'preparing', at: new Date().toISOString() })
  if (await redis(['HSETNX', KEY.games, key, rec])) return true
  const cur = parseJSONSafe(await redis(['HGET', KEY.games, key]), null)
  if (cur?.status === 'preparing' && Date.now() - Date.parse(cur.at) > STALE_CLAIM) {
    await redis(['HSET', KEY.games, key, rec])
    return true
  }
  return false
}
const release = (key) => redis(['HDEL', KEY.games, key]).catch(() => {})

// One game's packet: the markets worth forecasting, the WCE model's number for each, and both
// Claude prompts. Nothing is priced yet.
function prepareGame(game, inp) {
  const { proj, ix, injuries, injuriesOk, ctx } = inp

  // Who sits: ESPN's feed when it answered, the projection file's status otherwise.
  const outIds = { [game.away]: new Set(), [game.home]: new Set() }
  for (const team of [game.away, game.home]) {
    const list = injuriesOk ? injuries[team] || [] : []
    for (const i of list) {
      if (!K.isOut(i.status) && !/doubtful/i.test(i.status)) continue
      const n = K.normName(i.name)
      for (const [id, p] of Object.entries(proj.players)) if (p.team === team && K.normName(p.name) === n) outIds[team].add(id)
    }
    if (!injuriesOk) {
      for (const [id, p] of Object.entries(proj.players)) if (p.team === team && K.isOut(p.status)) outIds[team].add(id)
    }
  }
  const injuryOf = (team, name) => (injuriesOk ? (injuries[team] || []).find((i) => K.normName(i.name) === K.normName(name)) : null)

  // The markets worth forecasting: matched to a projection, player not out, quoted tightly.
  const players = new Map()
  for (const m of inp.markets) {
    if (m.game !== game.key || !m.playerId || !proj.players[m.playerId]) continue
    const p = proj.players[m.playerId]
    if (outIds[p.team]?.has(m.playerId) || K.isOut(injuryOf(p.team, p.name)?.status)) continue
    if (!M.isQuoted(m) || !M.withinSpread(m, QUOTE_MAX_SPREAD)) continue
    if (!players.has(m.playerId)) players.set(m.playerId, { id: m.playerId, p, markets: [] })
    players.get(m.playerId).markets.push(m)
  }
  if (!players.size) return { empty: true }

  // Stable ids for the prompts: players in team order, stats in a fixed order, then lines.
  const order = [...players.values()].sort((a, b) => (a.p.team === b.p.team ? a.p.name.localeCompare(b.p.name) : a.p.team === game.away ? -1 : 1))
  const quoted = []
  for (const pl of order) {
    pl.markets.sort((a, b) => M.STATS.indexOf(a.stat) - M.STATS.indexOf(b.stat) || a.k - b.k)
    for (const m of pl.markets) quoted.push({ ...m, id: `m${quoted.length + 1}`, pModel: M.modelProb(pl.p, ix, m.stat, m.k) })
  }
  const byTicker = new Map(quoted.map((m) => [m.ticker, m]))
  for (const pl of order) pl.markets = pl.markets.map((m) => byTicker.get(m.ticker))

  const packet = {
    key: game.key,
    game: { key: game.key, date: game.date, away: game.away, home: game.home, tip: game.tip },
    preparedAt: new Date().toISOString(),
    players: order.length,
    markets: quoted.map((m) => ({ id: m.id, ticker: m.ticker, series: m.series, stat: m.stat, k: m.k, playerKey: m.playerKey, playerId: m.playerId,
      player: proj.players[m.playerId].name, team: proj.players[m.playerId].team, bid: m.bid, ask: m.ask, noAsk: m.noAsk })),
    model: Object.fromEntries(quoted.filter((m) => m.pModel != null).map((m) => [m.ticker, m.pModel])),
    prompts: null,
  }

  if (claudeMode() !== 'off') {
    // The game facts both arms share: the injury report, every rotation player, the schedule.
    const health = {}
    for (const team of [game.away, game.home]) {
      health[team] = injuriesOk
        ? (injuries[team] || []).map((i) => ({ name: i.name, status: i.status, date: i.date, comment: i.comment }))
        : Object.values(proj.players).filter((p) => p.team === team && p.status && p.status !== 'None').map((p) => ({ name: p.name, status: p.status }))
    }
    const rosters = {}
    for (const team of [game.away, game.home]) {
      const rows = []
      for (const [id, p] of Object.entries(proj.players)) {
        if (p.team !== team) continue
        // Ordered by minutes over his whole recent sample (up to 60 games): early in the season
        // a last-10 average is mostly last April, when tanking teams played their benches.
        const log = (p.log || []).filter((r) => (r[ix.min] || 0) > 0)
        const avgMin = log.length ? log.reduce((a, r) => a + r[ix.min], 0) / log.length : 0
        const line = p.ros || p.pre
        const inj = injuryOf(team, p.name)
        const status = inj?.status || (!injuriesOk && p.status && p.status !== 'None' ? p.status : null)
        if (!(avgMin >= 10 || (line?.min || 0) >= 12 || status || players.has(id))) continue
        rows.push({ name: p.name, pos: p.pos, status, hasMarket: players.has(id), gp: Number(p.gp) || 0, rookie: p.rookie === true || p.rookie === 'True',
          proj: line, usg: ctx.savant?.get(String(id))?.m?.usg?.[0] ?? null, log: p.log || [], avgMin })
      }
      rows.sort((a, b) => b.avgMin - a.avgMin || (b.proj?.min || 0) - (a.proj?.min || 0))
      rosters[team] = rows.slice(0, 16)
    }
    const prevDay = dayBefore(game.date)
    const schedule = []
    for (const team of [game.away, game.home]) {
      if (!inp.prevKnown?.has(prevDay)) continue
      schedule.push(inp.playedOn.has(`${team}|${prevDay}`)
        ? `${team} played last night, so tonight is the second night of a back-to-back.`
        : `${team} did not play last night.`)
    }
    if (ctx.record?.[game.away] && ctx.record?.[game.home]) schedule.push(`Records this season: ${game.away} ${ctx.record[game.away]}, ${game.home} ${ctx.record[game.home]}.`)

    const injuredOut = [...outIds[game.away], ...outIds[game.home]]
    const inv = proj.ww_inv?.by || {}
    const cards = order.map((pl) => {
      const inj = injuryOf(pl.p.team, pl.p.name)
      const sv = savantFacts(ctx, pl.id)
      const beneficiary = []
      for (const outId of injuredOut) {
        if (proj.players[outId]?.team !== pl.p.team) continue
        const hit = (inv[outId] || []).find((b) => String(b.id) === String(pl.id))
        if (hit) beneficiary.push(`With ${proj.players[outId].name} listed out or doubtful tonight — in the ${hit.gwo} games he missed in ${proj.ww_inv.season}, this player went ${signed(hit.d.min)} min, ${signed(hit.d.pts)} pts/36, ${signed(hit.d.reb)} reb/36, ${signed(hit.d.ast)} ast/36, usage ${signed(hit.d.usg)}.`)
      }
      return {
        name: pl.p.name, team: pl.p.team, pos: pl.p.pos, age: Number(pl.p.age) || null, rookie: pl.p.rookie === true || pl.p.rookie === 'True',
        status: inj?.status || null,
        proj: pl.p.ros || pl.p.pre, log: pl.p.log || [],
        savant: sv?.facts || null, savantSeason: ctx.savantSeason, peers: sv?.peers,
        beneficiary,
        markets: pl.markets.map((m) => ({ id: m.id, stat: m.stat, k: m.k, pModel: m.pModel })),
      }
    })
    const input = { game, players: cards, ix, teams: [teamLine(ctx, game.away), teamLine(ctx, game.home)], health, rosters, schedule, reportCard: inp.reportCard }
    packet.prompts = Object.fromEntries(claudeArms().map((a) => [a, buildPrompt(a, input)]))
  }
  return packet
}

/* ------------------------------------------------------------------ *
 * Deciding a game
 * ------------------------------------------------------------------ */

// Prices every arm's bets at one set of quotes and writes the game down as decided.
//   answers  { claude_wce: { probs: { id: p }, notes, ... } | { error }, claude_box: ... }
//   quotes   Map(ticker -> market) of Kalshi's quotes now, or null for the packet's own
async function finalizeGame(packet, answers, quotes) {
  const mode = claudeMode()
  const at = new Date().toISOString()
  const live = []
  for (const m of packet.markets) {
    let q = m
    if (quotes) {
      const f = quotes.get(m.ticker)
      if (!f) continue
      q = { ...m, bid: f.bid, ask: f.ask, noAsk: f.noAsk }
    }
    if (M.isQuoted(q) && M.withinSpread(q, QUOTE_MAX_SPREAD)) live.push(q)
  }

  const probs = Object.fromEntries(M.FORECASTERS.map((a) => [a, new Map()]))
  for (const m of live) if (packet.model[m.ticker] != null) probs.model.set(m.ticker, packet.model[m.ticker])
  const arms = { model: { fc: probs.model.size } }
  const notes = {}
  // The Claude arms this game was prepared for (older packets have two, newer ones three).
  const expected = packetArms(packet).length ? packetArms(packet) : M.ARMS.filter((a) => a !== 'model')
  for (const arm of expected) {
    const a = answers?.[arm]
    if (!a) {
      if (mode !== 'off') arms[arm] = { fc: 0, error: mode === 'task' ? 'no answer from the scheduled task before tip' : 'not asked' }
      continue
    }
    if (a.error) { arms[arm] = { fc: 0, error: a.error, ms: a.ms }; continue }
    for (const m of live) { const p = a.probs?.[m.id]; if (p != null) probs[arm].set(m.ticker, p) }
    notes[arm] = a.notes || ''
    arms[arm] = { fc: probs[arm].size, missing: a.missing || 0, ms: a.ms, inTok: a.inTok, outTok: a.outTok, cacheTok: a.cacheTok, at: a.at }
  }

  const rules = { ...M.BET_RULES, minEdge: EDGE_MIN() }
  const bets = []
  const pushBets = (arm, picked) => {
    for (const b of picked) {
      const m = b.market
      bets.push({ arm, ticker: m.ticker, series: m.series, stat: m.stat, k: m.k, player: m.player, team: m.team,
        side: b.side, price: b.price, fee: b.fee, p: b.p, edge: b.edge, bid: m.bid, ask: m.ask, at })
    }
  }
  for (const arm of M.FORECASTERS) {
    const picked = probs[arm].size ? M.pickBets(live, probs[arm], rules) : []
    if (arms[arm]) arms[arm].bets = picked.length
    pushBets(arm, picked)
  }
  // The rule arms live at this moment, each betting on the forecasts above at the same quotes.
  const ruleArms = await liveRules(packet.game.date).catch(() => [])
  for (const r of ruleArms) {
    const picked = M.pickRuleBets(r, live, probs, r.weight, rules)
    arms[r.id] = { rule: true, bets: picked.length, ...(r.blend === 'fit' ? { weight: r.weight } : {}) }
    pushBets(r.id, picked)
  }

  const rows = live.map((m) => [m.ticker, m.player, m.team, m.stat, m.k, m.bid, m.ask, ...M.FORECASTERS.map((a) => probs[a].get(m.ticker) ?? null)])
  const g = packet.game
  const record = {
    key: g.key, date: g.date, away: g.away, home: g.home, tip: new Date(g.tip).toISOString(),
    status: 'decided', preparedAt: packet.preparedAt, decidedAt: at, leadMin: Math.round((g.tip - Date.now()) / MIN),
    quotes: quotes ? 'live' : 'prepared', markets: live.length, players: packet.players, arms,
    claude: mode === 'api' ? claudeModel() : mode === 'task' ? 'scheduled task' : null, minEdge: rules.minEdge,
    slate: packet.slate || null,
  }
  await redisPipeline([
    ['SET', KEY.fc(g.key), JSON.stringify({ at, cols: ['ticker', 'player', 'team', 'stat', 'k', 'bid', 'ask', ...M.FORECASTERS], rows })],
    ['SET', KEY.bets(g.key), JSON.stringify({ at, bets, notes })],
    ['HSET', KEY.ledger, g.key, JSON.stringify(bets.map(M.ledgerRow))],
    ['HSET', KEY.games, g.key, JSON.stringify(record)],
    ['DEL', KEY.pending(g.key)],
  ])
  return { record, bets: bets.length }
}

// API mode: both Claude arms asked here, then decided at the quotes just read.
async function decideWithApi(packet, deadline, tries) {
  const answers = {}
  const meta = packet.markets.map((m) => ({ id: m.id, playerKey: m.playerKey, stat: m.stat, k: m.k }))
  await Promise.all(packetArms(packet).map(async (arm) => {
    const started = Date.now()
    try {
      const ans = await askClaude(packet.prompts[arm], meta, { deadline })
      answers[arm] = { probs: Object.fromEntries(ans.probs), notes: ans.notes, missing: ans.missing, ms: ans.ms, at: new Date().toISOString(),
        inTok: ans.usage?.input_tokens || 0, outTok: ans.usage?.output_tokens || 0, cacheTok: ans.usage?.cache_read_input_tokens || 0 }
    } catch (err) {
      answers[arm] = { error: String(err?.message || err).slice(0, 300), ms: Date.now() - started }
    }
  }))
  // A Claude arm that failed (overload, timeout) would leave this game out of that arm for
  // good, and failures bunch on busy nights, which would skew the comparison. So while there
  // is time before tip, nothing is recorded and the next run tries the whole game again.
  const failed = packetArms(packet).filter((a) => answers[a]?.error)
  if (failed.length && packet.game.tip - Date.now() > RETRY_LEAD && (tries[packet.key] || 0) + 1 < MAX_TRIES) {
    await redis(['HINCRBY', KEY.tries, packet.key, '1']).catch(() => {})
    return { retry: failed.map((a) => `${a}: ${answers[a].error}`).join('; ') }
  }
  return finalizeGame(packet, answers, null)
}

// Task mode: the packet waits for the scheduled task's answers.
async function storePending(packet) {
  const g = packet.game
  const rec = { key: g.key, date: g.date, away: g.away, home: g.home, tip: new Date(g.tip).toISOString(), status: 'pending',
    preparedAt: packet.preparedAt, markets: packet.markets.length, players: packet.players, claude: 'scheduled task', slate: packet.slate || null }
  await redisPipeline([
    ['DEL', KEY.pending(g.key)],
    ['HSET', KEY.pending(g.key), 'packet', JSON.stringify(packet)],
    ['EXPIRE', KEY.pending(g.key), String(3 * 86400)],
    ['HSET', KEY.games, g.key, JSON.stringify(rec)],
  ])
  return rec
}

// Prepares a batch of games and, by mode, decides them or leaves them pending. Reports into
// `result` (decided, queued, skipped).
async function prepareBatch(due, teamNames, { started, tries, result, slate = {} }) {
  const inp = await loadInputs(due, teamNames, { deadline: started + 120e3, warnings: result.warnings })
  const mode = claudeMode()
  const queue = [...due]
  const worker = async () => {
    while (queue.length) {
      if (Date.now() - started > DECIDE_BUDGET) { result.skipped.push(...queue.splice(0).map((g) => `${g.key} (out of time; next run)`)); return }
      const g = queue.shift()
      if (!(await claim(g.key))) { result.skipped.push(`${g.key} (already being prepared)`); continue }
      try {
        const packet = prepareGame(g, inp)
        if (packet.empty) { await release(g.key); result.skipped.push(`${g.key} (no quoted markets yet)`); continue }
        if (slate[g.date]) packet.slate = slate[g.date]
        if (mode === 'task') {
          await storePending(packet)
          result.queued.push(g.key)
          continue
        }
        const r = mode === 'api' ? await decideWithApi(packet, started + 270e3, tries) : await finalizeGame(packet, {}, null)
        if (r.retry) { await release(g.key); result.skipped.push(`${g.key} (Claude failed, retrying next run: ${r.retry.slice(0, 200)})`); continue }
        result.decided.push({ key: g.key, markets: r.record.markets, bets: r.bets, arms: r.record.arms })
      } catch (err) {
        await release(g.key)
        result.skipped.push(`${g.key} (${String(err?.message || err).slice(0, 160)})`)
      }
    }
  }
  // Two games at a time: four Claude calls in flight at most in API mode.
  await Promise.all([worker(), worker()])
}

/* ------------------------------------------------------------------ *
 * Closing pending games
 * ------------------------------------------------------------------ */

// Decides one pending game with whatever answers it has: at Kalshi's quotes of this moment
// if the game hasn't tipped, at the prepared quotes if it has. Null if it isn't pending (or
// another run is deciding it right now).
async function closeOne(key, deadline) {
  const lock = await redis(['SET', KEY.fin(key), '1', 'NX', 'PX', '120000'])
  if (!lock) return null
  try {
    const [hRaw, recRaw] = await redisPipeline([['HGETALL', KEY.pending(key)], ['HGET', KEY.games, key]])
    const h = toHash(hRaw.result)
    const packet = parseJSONSafe(h.packet, null)
    const rec = parseJSONSafe(recRaw.result, null)
    if (!packet || rec?.status !== 'pending') return null
    const answers = {}
    for (const arm of packetArms(packet)) if (h[arm]) answers[arm] = parseJSONSafe(h[arm], null)
    let quotes = null
    if (packet.game.tip - Date.now() > 60e3) {
      const live = await K.gameMarkets(key, { deadline })
      quotes = new Map(live.filter((m) => m.status === 'active').map((m) => [m.ticker, m]))
    }
    return await finalizeGame(packet, answers, quotes)
  } finally {
    await redis(['DEL', KEY.fin(key)]).catch(() => {})
  }
}

// Pending games within 15 minutes of tip (or past it) are decided with what they have.
async function closeDue({ deadline }) {
  const now = Date.now()
  const known = toHash(await redis(['HGETALL', KEY.games]))
  const due = Object.values(known).map((v) => parseJSONSafe(v, null))
    .filter((r) => r?.status === 'pending' && Date.parse(r.tip) - now <= CLOSE_LEAD)
    .sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip))
  const out = { closed: [], warnings: [] }
  for (const rec of due) {
    if (Date.now() > deadline - 15e3) { out.warnings.push('out of time closing pending games; next run'); break }
    try {
      const r = await closeOne(rec.key, deadline)
      if (r?.record) out.closed.push(rec.key)
    } catch (err) {
      out.warnings.push(`${rec.key}: ${String(err?.message || err).slice(0, 160)}`)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * The picks job (Vercel cron)
 * ------------------------------------------------------------------ */

const STATUS_WORD = { preparing: 'being prepared', pending: 'waiting for the scheduled task', decided: 'already decided', settled: 'already settled' }

// opts.lead (minutes) widens the window for a manual run; opts.keys prepares those games now.
export async function runPicks(opts = {}) {
  const started = Date.now()
  const result = { ok: true, job: 'edge-picks', mode: claudeMode(), decided: [], queued: [], closed: [], skipped: [], warnings: [] }
  let token = null
  try {
    token = await takeLock(295e3)
    if (!token) return { ...result, skipped: ['another Edge Lab run is in progress'] }
    const now = Date.now()
    const asked = (opts.keys || []).map((k) => K.parseGameKey(k)?.date).filter(Boolean)
    const { games, teamNames } = await loadSlate(now, asked)
    const [knownRaw, triesRaw] = await redisPipeline([['HGETALL', KEY.games], ['HGETALL', KEY.tries]])
    const known = toHash(knownRaw.result)
    const tries = Object.fromEntries(Object.entries(toHash(triesRaw.result)).map(([k, v]) => [k, Number(v) || 0]))
    const maxLead = opts.lead ? opts.lead * MIN : LEAD_MAX
    const want = opts.keys ? new Set(opts.keys) : null
    if (want) {
      // Say why a game asked for by hand was not prepared.
      for (const k of want) {
        const g = games.find((x) => x.key === k)
        if (!g) result.skipped.push(`${k} (not on ESPN's schedule for that date)`)
        else if (known[k]) result.skipped.push(`${k} (${STATUS_WORD[parseJSONSafe(known[k], {}).status] || 'already known'})`)
        else if (g.state !== 'pre') result.skipped.push(`${k} (already started)`)
      }
    }
    const due = games
      .filter((g) => !known[g.key] && g.state === 'pre')
      .filter((g) => (want ? want.has(g.key) : g.tip - now > LEAD_MIN && g.tip - now <= maxLead))
      .sort((a, b) => a.tip - b.tip)
    result.slate = games.length

    // Pending games about to tip go first: they can't wait for the next run.
    const c = await closeDue({ deadline: started + 100e3 })
    result.closed = c.closed
    result.warnings.push(...c.warnings)

    if (!due.length) {
      result.note = 'no games due'
      // Quiet runs settle anything that finished earlier (matinees, last night's stragglers).
      const s = await settleGames({ budget: 100e3, started })
      result.settled = s.settled
      result.warnings.push(...s.warnings)
      await logRun({ job: 'edge-picks', status: 'ok', ms: Date.now() - started, note: result.note, closed: result.closed, settled: s.settled,
        error: result.warnings.join(' | ').slice(0, 600) })
      await tickIfTime(started)
      return result
    }

    await prepareBatch(due, teamNames, { started, tries, result, slate: slateSizes(games) })
    const armErrors = result.decided.flatMap((d) => Object.entries(d.arms).filter(([, a]) => a.error).map(([arm, a]) => `${d.key} ${arm}: ${a.error}`))
    const status = armErrors.length || result.skipped.some((s) => !/no quoted markets|out of time|already|being prepared|waiting for|not on ESPN/.test(s)) ? 'partial' : 'ok'
    result.status = status
    await logRun({ job: 'edge-picks', status, ms: Date.now() - started, decided: result.decided.map((d) => d.key), queued: result.queued, closed: result.closed,
      skipped: result.skipped, bets: result.decided.reduce((a, d) => a + d.bets, 0), error: armErrors.concat(result.warnings).join(' | ').slice(0, 600) })
    await tickIfTime(started)
    return result
  } catch (err) {
    const msg = String(err?.message || err)
    await logRun({ job: 'edge-picks', status: 'error', ms: Date.now() - started, error: msg.slice(0, 600) }).catch(() => {})
    return { ...result, ok: false, error: msg }
  } finally {
    if (token) await dropLock(token)
  }
}

/* ------------------------------------------------------------------ *
 * The scheduled task's two calls
 * ------------------------------------------------------------------ */

const tipText = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET'
const TASK_DIR = '/tmp/edge'

// Prepares games tipping 15 minutes to 3 h 45 min out, then hands back every prompt still
// unanswered for a game that hasn't tipped, each as a self-contained text with the file to
// save it to and the file its answer goes in.
export async function runQueue(opts = {}) {
  const started = Date.now()
  const out = { ok: true, job: 'edge-queue', mode: claudeMode(), queued: [], decided: [], skipped: [], warnings: [], tasks: [] }
  try {
    if (out.mode !== 'task') {
      out.note = out.mode === 'api' ? 'The Claude arms run through the API on this site, so there is nothing for the task to do.' : 'The Claude arms are switched off (EDGE_CLAUDE=off).'
      return out
    }
    const now = Date.now()
    const ahead = Math.min(Math.max(Number(opts.ahead) || QUEUE_LEAD_MAX / MIN, 30), 12 * 60) * MIN
    const { games, teamNames } = await loadSlate(now)
    const known = toHash(await redis(['HGETALL', KEY.games]))
    const due = games
      .filter((g) => !known[g.key] && g.state === 'pre' && g.tip - now > QUEUE_LEAD_MIN && g.tip - now <= ahead)
      .sort((a, b) => a.tip - b.tip)
    if (due.length) await prepareBatch(due, teamNames, { started, tries: {}, result: out, slate: slateSizes(games) })

    const after = toHash(await redis(['HGETALL', KEY.games]))
    const pend = Object.values(after).map((v) => parseJSONSafe(v, null))
      .filter((r) => r?.status === 'pending' && Date.parse(r.tip) - Date.now() > 5 * MIN)
      .sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip))
    const blobs = pend.length ? await redisPipeline(pend.map((r) => ['HGETALL', KEY.pending(r.key)])) : []
    pend.forEach((r, i) => {
      const h = toHash(blobs[i]?.result)
      const packet = parseJSONSafe(h.packet, null)
      if (!packet?.prompts) return
      for (const arm of packetArms(packet)) {
        if (h[arm]) continue
        const id = `${r.key}.${arm}`
        const answer = `${TASK_DIR}/${id}.json`
        // format=data: the game alone, for a task whose own instructions carry the job.
        const text = opts.format === 'data' ? dataText(packet.prompts[arm]) : taskText(packet.prompts[arm], answer)
        out.tasks.push({ id, key: r.key, arm, game: `${r.away} at ${r.home}, ${tipText(Date.parse(r.tip))}`, markets: packet.markets.length,
          file: `${TASK_DIR}/${id}.txt`, answer, text })
      }
    })
    out.note = `${out.tasks.length} prompt${out.tasks.length === 1 ? '' : 's'} to answer`
    await logRun({ job: 'edge-queue', status: out.warnings.length ? 'partial' : 'ok', ms: Date.now() - started, note: out.note, queued: out.queued,
      skipped: out.skipped, error: out.warnings.join(' | ').slice(0, 600) })
    return out
  } catch (err) {
    const msg = String(err?.message || err)
    await logRun({ job: 'edge-queue', status: 'error', ms: Date.now() - started, error: msg.slice(0, 600) }).catch(() => {})
    return { ...out, ok: false, error: msg }
  }
}

// One arm's answer for one game, posted by the scheduled task. When every arm the game was
// prepared for is in, the game is decided straight away at Kalshi's quotes of this moment.
export async function runAnswer({ task, body }) {
  const m = /^(\d{2}[A-Z]{3}\d{2}[A-Z]{6})\.(claude_[a-z]+)$/.exec(String(task || ''))
  if (!m || !M.CLAUDE_FORECASTERS.includes(m[2])) return { ok: false, status: 400, error: 'task must look like 26OCT21MINMIA.claude_wce' }
  const [, key, arm] = m
  let input = body
  if (typeof input === 'string') {
    try { input = JSON.parse(input) } catch { return { ok: false, status: 400, error: 'the answer is not valid JSON' } }
  }
  if (!input || !Array.isArray(input.forecasts)) return { ok: false, status: 400, error: 'the answer needs a "forecasts" list' }

  const [hRaw, recRaw] = await redisPipeline([['HGETALL', KEY.pending(key)], ['HGET', KEY.games, key]])
  const packet = parseJSONSafe(toHash(hRaw.result).packet, null)
  const rec = parseJSONSafe(recRaw.result, null)
  if (!packet || rec?.status !== 'pending') return { ok: false, status: 409, error: `${key} is not waiting for answers (${STATUS_WORD[rec?.status] || 'unknown game'})` }
  if (packet.game.tip <= Date.now()) return { ok: false, status: 409, error: `${key} has already tipped off` }
  if (!packetArms(packet).includes(arm)) return { ok: false, status: 409, error: `${key} was not prepared for ${arm}` }

  const ans = parseForecasts(input, packet.markets)
  const n = packet.markets.length
  const priced = n - ans.missing
  if (priced < Math.ceil(n * MIN_PRICED)) {
    return { ok: false, status: 422, error: `priced ${priced} of ${n} markets; an answer needs at least ${Math.ceil(n * MIN_PRICED)}`, priced, of: n }
  }
  const at = new Date().toISOString()
  await redisPipeline([
    ['HSET', KEY.pending(key), arm, JSON.stringify({ probs: Object.fromEntries(ans.probs), notes: ans.notes, missing: ans.missing, at })],
    ['HSET', KEY.meta, 'lastAnswer', at],
  ])
  const h = toHash(await redis(['HGETALL', KEY.pending(key)]))
  const waitingFor = packetArms(packet).filter((a) => !h[a])
  const out = { ok: true, key, arm, priced, of: n, decided: false, waitingFor }
  if (waitingFor.length) return out
  try {
    const r = await closeOne(key, Date.now() + 200e3)
    if (r?.record) {
      out.decided = true
      out.bets = r.bets
      await logRun({ job: 'edge-answer', status: 'ok', decided: [key], bets: r.bets, note: `decided ${key} at the quotes of the moment` }).catch(() => {})
    }
  } catch (err) {
    out.note = `answer saved; deciding the game failed (${String(err?.message || err).slice(0, 160)}), and the next picks run will retry`
  }
  return out
}

/* ------------------------------------------------------------------ *
 * The settle job
 * ------------------------------------------------------------------ */

async function settleOne(rec, now, deadline) {
  const tip = Date.parse(rec.tip)
  const [fcRaw, betsRaw] = await redisPipeline([['GET', KEY.fc(rec.key)], ['GET', KEY.bets(rec.key)]])
  const fc = parseJSONSafe(fcRaw.result, { rows: [] })
  const bb = parseJSONSafe(betsRaw.result, { bets: [], notes: {} })
  const live = await K.gameMarkets(rec.key, { deadline })
  const byTicker = new Map(live.map((m) => [m.ticker, m]))
  const value = (t) => M.settledValue(byTicker.get(t))
  const unresolved = fc.rows.filter((r) => value(r[0]) == null).length + bb.bets.filter((b) => value(b.ticker) == null).length
  if (unresolved && now - tip < SETTLE_GIVE_UP) return { waiting: unresolved }

  // Closing quotes for the markets that carry a bet. No candle in the day before tip means the
  // quote never moved, so the one bet at was still standing. Running out of time abandons the
  // game whole (OutOfTime propagates); the next run settles it.
  const closes = new Map()
  for (const t of [...new Set(bb.bets.map((b) => b.ticker))]) {
    const b = bb.bets.find((x) => x.ticker === t)
    let q = null
    try {
      q = await K.quoteAt(b.series, t, tip, { deadline })
    } catch (err) {
      if (err instanceof K.OutOfTime) throw err
    }
    closes.set(t, q || (Date.parse(b.at) > tip - 24 * 60 * MIN ? { bid: b.bid, ask: b.ask, at: b.at, from: 'decision' } : null))
  }

  for (const b of bb.bets) {
    const s = M.settleBet(b, value(b.ticker), closes.get(b.ticker))
    b.result = s ? { ...s, actual: byTicker.get(b.ticker)?.actual ?? null } : { outcome: 'void', pnl: 0, note: 'never settled' }
  }
  fc.results = Object.fromEntries(fc.rows.map((r) => [r[0], value(r[0])]))
  const agg = aggregate(fc, bb)

  const next = { ...rec, status: 'settled', settledAt: new Date().toISOString(), agg, aggV: M.AGG_VERSION, unresolved }
  await redisPipeline([
    ['SET', KEY.bets(rec.key), JSON.stringify(bb)],
    ['SET', KEY.fc(rec.key), JSON.stringify(fc)],
    ['HSET', KEY.ledger, rec.key, JSON.stringify(bb.bets.map(M.ledgerRow))],
    ['HSET', KEY.games, rec.key, JSON.stringify(next)],
  ])
  return { settled: true }
}

// A settled game's per-arm aggregates, from its stored forecasts (with results) and its bets
// (with results). Recomputing a bet re-runs settleBet on the value and close it was settled on,
// so a game settled before a field existed gains it without asking Kalshi again.
function aggregate(fc, bb) {
  const agg = Object.fromEntries(M.FORECASTERS.map((a) => [a, { bets: M.emptyBetAgg(), fc: M.emptyFcAgg(), fcStat: {} }]))
  for (const b of bb.bets || []) {
    const r = b.result
    if (!r || r.value == null) continue // never settled: a void that counts for nothing
    const s = M.settleBet(b, r.value, r.close)
    if (!s) continue
    b.result = { ...r, ...s }
    if (!agg[b.arm]) agg[b.arm] = { bets: M.emptyBetAgg() } // a rule arm: bets only
    M.addBet(agg[b.arm].bets, s)
  }
  const armCol = Object.fromEntries(M.FORECASTERS.map((a) => [a, (fc.cols || []).indexOf(a)]))
  const market = M.emptyMktAgg()
  for (const r of fc.rows || []) {
    const y = fc.results?.[r[0]]
    if (y !== 0 && y !== 1) continue
    const mkt = (r[5] + r[6]) / 2
    M.addMarket(market, mkt, y)
    for (const a of M.FORECASTERS) {
      const p = armCol[a] >= 0 ? r[armCol[a]] : null
      M.addForecast(agg[a].fc, p, mkt, y)
      if (p != null) M.addStatForecast((agg[a].fcStat[r[3]] = agg[a].fcStat[r[3]] || M.emptyStatAgg()), p, mkt, y)
    }
  }
  agg._market = market
  return agg
}

// Settled games whose aggregates predate a new field, recomputed from what is stored and
// written back. A few dozen at a time, so a page read never waits long.
async function refreshAggregates(games, limit = 40) {
  const old = games.filter((g) => g.status === 'settled' && g.aggV !== M.AGG_VERSION).slice(0, limit)
  if (!old.length) return 0
  const blobs = await redisPipeline(old.flatMap((g) => [['GET', KEY.fc(g.key)], ['GET', KEY.bets(g.key)]]))
  const writes = []
  old.forEach((g, i) => {
    const fc = parseJSONSafe(blobs[2 * i]?.result, null)
    const bb = parseJSONSafe(blobs[2 * i + 1]?.result, null)
    if (!fc || !bb) return
    g.agg = aggregate(fc, bb)
    g.aggV = M.AGG_VERSION
    writes.push(['SET', KEY.bets(g.key), JSON.stringify(bb)], ['HSET', KEY.games, g.key, JSON.stringify(g)])
  })
  if (writes.length) await redisPipeline(writes).catch(() => {})
  return writes.length / 2
}

async function settleGames({ budget, started = Date.now(), keys } = {}) {
  const now = Date.now()
  const known = toHash(await redis(['HGETALL', KEY.games]))
  const want = keys ? new Set(keys) : null
  const due = Object.values(known)
    .map((v) => parseJSONSafe(v, null))
    .filter((r) => r && r.status === 'decided' && (want ? want.has(r.key) : now - Date.parse(r.tip) > SETTLE_AFTER))
    .sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip))
  const out = { settled: [], waiting: [], warnings: [] }
  const deadline = started + budget
  for (const rec of due) {
    if (Date.now() > deadline - 10e3) { out.warnings.push('out of time; the rest settle next run'); break }
    try {
      const r = await settleOne(rec, now, deadline)
      if (r.settled) out.settled.push(rec.key)
      else out.waiting.push(`${rec.key} (${r.waiting} markets not settled yet)`)
    } catch (err) {
      out.warnings.push(`${rec.key}: ${String(err?.message || err).slice(0, 160)}`)
    }
  }
  return out
}

export async function runSettle(opts = {}) {
  const started = Date.now()
  let token = null
  try {
    token = await takeLock(295e3)
    if (!token) return { ok: true, job: 'edge-settle', skipped: 'another Edge Lab run is in progress' }
    // A game still pending after tip (the task never answered) is decided first, so it settles.
    const c = await closeDue({ deadline: started + 60e3 })
    const s = await settleGames({ budget: SETTLE_BUDGET, started, keys: opts.keys })
    s.warnings.unshift(...c.warnings)
    const status = s.warnings.length ? 'partial' : 'ok'
    await logRun({ job: 'edge-settle', status, ms: Date.now() - started, closed: c.closed, settled: s.settled, waiting: s.waiting, error: s.warnings.join(' | ').slice(0, 600) })
    // The night's last point: everything it bet, now settled.
    if (s.settled.length) await tickIfTime(started, { force: true })
    return { ok: true, job: 'edge-settle', status, closed: c.closed, ...s }
  } catch (err) {
    const msg = String(err?.message || err)
    await logRun({ job: 'edge-settle', status: 'error', ms: Date.now() - started, error: msg.slice(0, 600) }).catch(() => {})
    return { ok: false, job: 'edge-settle', error: msg }
  } finally {
    if (token) await dropLock(token)
  }
}

/* ------------------------------------------------------------------ *
 * Portfolios (each arm's bets in dollars, live during games)
 * ------------------------------------------------------------------ */

const MARKS_FRESH = 20e3 // Kalshi's values are reused this long, however many pages are open
const TICK_EVERY = 55 // seconds between points on a night's line
const STAKE_DAYS = 10 // dollar stakes are sent for this many recent nights (the game cards)

// Every decided or settled game's bets as ledger rows. Games decided before the ledger existed
// are filled in from their bets the first time they are read.
async function loadLedger(games) {
  const h = toHash(await redis(['HGETALL', KEY.ledger]))
  const missing = games.filter((g) => !h[g.key])
  if (missing.length) {
    const blobs = await redisPipeline(missing.map((g) => ['GET', KEY.bets(g.key)]))
    const writes = []
    missing.forEach((g, i) => {
      const bb = parseJSONSafe(blobs[i]?.result, null)
      if (!bb) return
      h[g.key] = JSON.stringify((bb.bets || []).map(M.ledgerRow))
      writes.push(['HSET', KEY.ledger, g.key, h[g.key]])
    })
    if (writes.length) await redisPipeline(writes).catch(() => {})
  }
  return games.map((g) => ({ key: g.key, date: g.date, tip: g.tip, slate: g.slate || null, bets: parseJSONSafe(h[g.key], []) }))
}

// What each open bet's contract is worth right now, from Kalshi, shared for MARKS_FRESH.
async function liveMarks(tickers, deadline) {
  const cached = parseJSONSafe(await redis(['GET', KEY.marks]).catch(() => null), null)
  const covers = cached?.v && tickers.every((t) => t in cached.v)
  if (covers && Date.now() - Date.parse(cached.at) < MARKS_FRESH) return { marks: new Map(Object.entries(cached.v)), at: cached.at }
  try {
    const ms = await K.marketsByTicker(tickers, { deadline })
    const v = Object.fromEntries(tickers.map((t) => [t, M.markValue(ms.get(t))]))
    const at = new Date().toISOString()
    await redis(['SET', KEY.marks, JSON.stringify({ at, v }), 'EX', '600']).catch(() => {})
    return { marks: new Map(Object.entries(v)), at }
  } catch (err) {
    const error = String(err?.message || err).slice(0, 200)
    // Older values beat none: the line holds still instead of dropping open bets to cost.
    if (cached?.v) return { marks: new Map(Object.entries(cached.v)), at: cached.at, error }
    return { marks: new Map(), at: null, error }
  }
}

// Where the three portfolios stand now. With `record`, also adds a point to the night's line
// (at most one every TICK_EVERY seconds, unless `force`).
export async function readPortfolios({ record = false, force = false, deadline = Date.now() + 20e3 } = {}) {
  const games = Object.values(toHash(await redis(['HGETALL', KEY.games]))).map((v) => parseJSONSafe(v, null))
    .filter((g) => g && (g.status === 'decided' || g.status === 'settled'))
  const ledger = await loadLedger(games)
  const openTickers = [...new Set(ledger.flatMap((g) => g.bets.filter((r) => r[5] == null).map((r) => r[1])))]
  const live = openTickers.length ? await liveMarks(openTickers, deadline) : { marks: new Map(), at: null }
  const reg = await loadRegistry().catch(() => [])
  const armIds = [...M.ARMS, ...Object.keys(M.FORECASTER_EXPERIMENTS), ...reg.map((r) => r.id)]
  const pf = M.buildPortfolios(ledger, live.marks, M.PORTFOLIO, armIds)

  // The night on show: the latest one with bets still open, else the latest one with bets.
  const withBets = ledger.filter((g) => g.bets.length)
  const openDates = withBets.filter((g) => g.bets.some((r) => r[5] == null)).map((g) => g.date).sort()
  const night = openDates.at(-1) || withBets.map((g) => g.date).sort().at(-1) || null
  const equity = Object.fromEntries(armIds.map((a) => [a, pf.arms[a].equity]))
  let ticks = []
  if (night) {
    if (record && (openDates.length || force)) {
      const go = force || (await redis(['SET', KEY.tickGate, '1', 'NX', 'EX', String(TICK_EVERY)]).catch(() => null))
      if (go) {
        await redisPipeline([
          ['RPUSH', KEY.ticks(night), JSON.stringify({ t: new Date().toISOString(), e: equity, v: M.PORTFOLIO.version })],
          ['LTRIM', KEY.ticks(night), '-1500', '-1'],
          ['EXPIRE', KEY.ticks(night), String(60 * 86400)],
        ]).catch(() => {})
      }
    }
    // Points recorded under another sizing would jump to different numbers, so they are left out.
    ticks = ((await redis(['LRANGE', KEY.ticks(night), '0', '-1']).catch(() => null)) || []).map((r) => parseJSONSafe(r, null))
      .filter((t) => t && (t.v || 1) === M.PORTFOLIO.version)
  }

  // Dollar stakes for the game cards of the last few nights.
  const recentDates = new Set([...new Set(ledger.map((g) => g.date))].sort().slice(-STAKE_DAYS))
  const keep = new Set(ledger.filter((g) => recentDates.has(g.date)).map((g) => g.key))
  const stakes = Object.fromEntries(Object.entries(pf.stakes).filter(([id]) => keep.has(id.split('|')[0])))
  const nightGames = games.filter((g) => g.date === night)

  return {
    at: new Date().toISOString(),
    config: pf.config,
    arms: pf.arms,
    closes: pf.closes,
    night,
    nightOpen: night ? pf.opens[night] : null,
    nightStart: nightGames.map((g) => g.decidedAt).filter(Boolean).sort()[0] || null,
    nightEnd: nightGames.every((g) => g.status === 'settled') ? nightGames.map((g) => g.settledAt).filter(Boolean).sort().at(-1) || null : null,
    live: openTickers.length > 0,
    openBets: openTickers.length,
    marksAt: live.at,
    marksError: live.error || null,
    ticks,
    stakes,
  }
}

// A point on the night's line from a cron run, if the run has time to spare.
async function tickIfTime(started, { force = false } = {}) {
  const left = started + 280e3 - Date.now()
  if (left < 30e3) return
  await readPortfolios({ record: true, force, deadline: Date.now() + Math.min(25e3, left - 5e3) }).catch(() => {})
}

/* ------------------------------------------------------------------ *
 * Experiments: the report-card Claude arm and the rule arms
 * ------------------------------------------------------------------ */

// The rule arms registered when experiments began (Oct 23, 2026), each with its reason and what
// would count as success, written down before any of them bet. They are added once; after that
// the registry only changes through the researcher's calls (or by hand).
const SEED_RULES = [
  { id: 'r1', name: 'Blend: Claude + WCE with the market', source: 'claude_wce', blend: 'fit',
    hypothesis: 'Claude + WCE scores worse than Kalshi on its own but may still know things the price does not. Betting market + w x (Claude + WCE - market), with w its information weight fitted only on earlier nights, keeps that knowledge and drops the overconfidence.',
    success: 'CLV t past the bar over 300+ bets.' },
  { id: 'r2', name: 'Blend: Claude box-only with the market', source: 'claude_box', blend: 'fit',
    hypothesis: 'The same blend for Claude with box scores only, the arm closest to the market on night one. If this blend wins and r1 does not, the edge is Claude reading games, not the WCE analytics.',
    success: 'CLV t past the bar over 300+ bets.' },
  { id: 'r3', name: 'Two Claudes averaged', source: 'claude_avg',
    hypothesis: 'Claude + WCE and Claude box-only make partly independent mistakes. Their average should be better calibrated than either one, and bets on it should beat the close more often.',
    success: 'CLV t past the bar over 300+ bets.' },
  { id: 'r4', name: 'Big disagreements only (Claude + WCE, 8c+)', source: 'claude_wce', minEdge: 0.08,
    hypothesis: 'If Claude + WCE has real information, its biggest disagreements with the price carry most of it. If it does not, its biggest disagreements are mostly its own errors, and this arm loses fastest. Either answer is useful.',
    success: 'Market move t above +2 and CLV t past the bar over 300+ bets; a clearly negative move says the big edges are errors.' },
  { id: 'r5', name: 'NO side only (Claude box-only)', source: 'claude_box', side: 'no',
    hypothesis: 'On night one nearly every arm bet NO, which points to Kalshi pricing the YES side of "N+" props rich (a retail lean toward overs). Taking only the NO side of Claude box-only\'s edges isolates that.',
    success: 'CLV t past the bar over 300+ bets. The page\'s market-lean line tests the same idea without any forecaster.' },
]
const RULE_FIELDS = ['source', 'blend', 'side', 'stats', 'minEdge', 'maxEdge', 'minPrice', 'maxPrice']
const MAX_LIVE_RULES = 12
const MAX_ADDS_PER_WEEK = 2
const RETIRE_MIN_DAYS = 21
const RETIRE_MIN_BETS = 200

const specOf = (r) => JSON.stringify(Object.fromEntries(RULE_FIELDS.map((k) => [k, r[k] ?? null])))

async function loadRegistry() {
  const h = toHash(await redis(['HGETALL', KEY.arms]))
  const missing = SEED_RULES.filter((r) => !h[r.id])
  if (missing.length) {
    const at = new Date().toISOString()
    await redisPipeline(missing.map((r) => ['HSETNX', KEY.arms, r.id, JSON.stringify({ ...r, kind: 'rule', status: 'live', createdAt: at, createdBy: 'claude (seed)' })])).catch(() => {})
    Object.assign(h, toHash(await redis(['HGETALL', KEY.arms])))
  }
  return Object.values(h).map((v) => parseJSONSafe(v, null)).filter(Boolean).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
}

// Live rule arms for a game on `date`, each blend arm with its weight from games settled before
// that date (forward only: a night never fits its own weight).
async function liveRules(date) {
  const reg = (await loadRegistry()).filter((r) => r.status === 'live')
  if (!reg.length) return []
  const sources = [...new Set(reg.filter((r) => r.blend === 'fit').map((r) => r.source))]
  const weights = {}
  if (sources.length) {
    const games = Object.values(toHash(await redis(['HGETALL', KEY.games]))).map((v) => parseJSONSafe(v, null))
      .filter((g) => g?.status === 'settled' && g.date < date)
    for (const src of sources) {
      const fc = M.emptyFcAgg()
      for (const g of games) M.mergeFcAgg(fc, g.agg?.[src]?.fc)
      weights[src] = M.blendWeight(fc)
    }
  }
  return reg.map((r) => ({ ...r, weight: r.blend === 'fit' ? weights[r.source] ?? null : null }))
}

// Every experiment with its record from the day it started, the market's own lean, and the bar.
async function readExperiments(games) {
  const reg = await loadRegistry()
  const settled = games.filter((g) => g.status === 'settled')
  const rcStarted = games.filter((g) => (g.arms?.claude_rc?.fc || 0) > 0).map((g) => g.date).sort()[0] || null
  const armsTried = M.ARMS.length + Object.keys(M.FORECASTER_EXPERIMENTS).length + reg.length
  const bar = M.graduationBar(armsTried)

  const market = M.emptyMktAgg()
  for (const g of settled) for (const k of Object.keys(market)) market[k] += g.agg?._market?.[k] || 0

  const list = []
  // The report-card arm, against its control (Claude + WCE) on the same games.
  for (const [id, meta] of Object.entries(M.FORECASTER_EXPERIMENTS)) {
    const bets = M.emptyBetAgg(), fc = M.emptyFcAgg(), ctl = M.emptyFcAgg(), ctlBets = M.emptyBetAgg()
    for (const g of settled) {
      if (!((g.arms?.[id]?.fc || 0) > 0)) continue
      M.mergeBetAgg(bets, g.agg?.[id]?.bets); M.mergeFcAgg(fc, g.agg?.[id]?.fc)
      M.mergeFcAgg(ctl, g.agg?.claude_wce?.fc); M.mergeBetAgg(ctlBets, g.agg?.claude_wce?.bets)
    }
    const d = M.describeBets(bets)
    list.push({ id, kind: 'forecaster', ...meta, status: claudeArms().includes(id) ? 'live' : 'off', createdAt: rcStarted, ...d, ...M.describeForecasts(fc),
      control: { arm: 'claude_wce', ...M.describeBets(ctlBets), ...M.describeForecasts(ctl) }, standing: rcStarted ? M.armStanding(d, bar) : 'not started' })
  }
  for (const r of reg) {
    const bets = M.emptyBetAgg()
    for (const g of settled) M.mergeBetAgg(bets, g.agg?.[r.id]?.bets)
    const d = M.describeBets(bets)
    const lastWeight = games.filter((g) => g.arms?.[r.id]?.weight != null).sort((a, b) => Date.parse(b.tip) - Date.parse(a.tip))[0]?.arms?.[r.id]?.weight ?? null
    list.push({ ...r, kind: 'rule', ...d, weight: lastWeight, standing: M.armStanding(d, bar, r.status === 'retired') })
  }
  return { armsTried, bar, minBets: M.GRADUATE_MIN_BETS, market: M.describeMarket(market), list }
}

/* ------------------------------------------------------------------ *
 * The researcher's two calls (a weekly scheduled task)
 * ------------------------------------------------------------------ */

const daysSince = (iso) => (Date.now() - Date.parse(iso)) / 86400e3

// Everything the researcher reads: the scoreboard, the experiments, the market's lean, and the
// last four weeks of bets broken down by arm, side, stat, price and how early they were made.
// The last `nights` slates in full, for the morning email: each game with every arm's result
// (units and dollars), Claude's notes, misses, and each base arm's best and worst bets.
async function readNights(games, nights, stakes) {
  const dates = [...new Set(games.filter((g) => g.status === 'decided' || g.status === 'settled').map((g) => g.date))].sort().slice(-nights)
  const night = games.filter((g) => dates.includes(g.date)).sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip))
  const blobs = night.length ? await redisPipeline(night.map((g) => ['GET', KEY.bets(g.key)])) : []
  const r2 = (x) => Math.round(x * 100) / 100
  return dates.map((date) => ({
    date,
    games: night.map((g, i) => ({ g, bb: parseJSONSafe(blobs[i]?.result, { bets: [], notes: {} }) })).filter(({ g }) => g.date === date).map(({ g, bb }) => {
      const byArm = {}
      for (const b of bb.bets || []) {
        const a = (byArm[b.arm] = byArm[b.arm] || { bets: 0, wins: 0, losses: 0, voids: 0, units: 0, dollars: 0, staked: 0, clv: [], move: [] })
        const st = stakes[`${g.key}|${b.arm}|${b.ticker}`]
        a.bets += 1
        if (st) { a.dollars += st.pnl; a.staked += st.stake }
        const r = b.result
        if (!r) continue
        if (r.outcome === 'win') a.wins += 1; else if (r.outcome === 'loss') a.losses += 1; else a.voids += 1
        if (r.outcome !== 'void') a.units += r.pnl || 0
        if (r.clv != null) a.clv.push(r.clv)
        if (r.move != null) a.move.push(r.move)
      }
      const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null)
      const arms = Object.fromEntries(Object.entries(byArm).map(([k, a]) => [k, { bets: a.bets, wins: a.wins, losses: a.losses, voids: a.voids, units: r2(a.units),
        dollars: r2(a.dollars), staked: r2(a.staked), avgClv: mean(a.clv), avgMove: mean(a.move) }]))
      const line = (b) => {
        const st = stakes[`${g.key}|${b.arm}|${b.ticker}`]
        return { player: b.player, bet: `${b.side === 'no' ? 'NO ' : ''}${b.stat} ${b.k}+`, price: b.price, thought: b.side === 'yes' ? b.p : 1 - b.p,
          actual: b.result?.actual ?? null, outcome: b.result?.outcome || 'open', dollars: st ? r2(st.pnl) : null, clv: b.result?.clv ?? null }
      }
      const extremes = {}
      for (const arm of M.ARMS) {
        const xs = (bb.bets || []).filter((b) => b.arm === arm && stakes[`${g.key}|${arm}|${b.ticker}`])
          .sort((x, y) => stakes[`${g.key}|${arm}|${y.ticker}`].pnl - stakes[`${g.key}|${arm}|${x.ticker}`].pnl)
        if (xs.length) extremes[arm] = { best: xs.slice(0, 2).map(line), worst: xs.slice(-2).reverse().map(line) }
      }
      return {
        key: g.key, matchup: `${g.away} at ${g.home}`, tip: g.tip, status: g.status, leadMin: g.leadMin ?? null, markets: g.markets ?? null,
        missing: Object.entries(g.arms || {}).filter(([, a]) => a?.error).map(([arm, a]) => `${arm}: ${a.error}`),
        arms, extremes,
        notes: Object.fromEntries(Object.entries(bb.notes || {}).filter(([, v]) => v).map(([k, v]) => [k, String(v).slice(0, 700)])),
      }
    }),
  }))
}

export async function runReview({ nights = 0 } = {}) {
  const games = Object.values(toHash(await redis(['HGETALL', KEY.games]))).map((v) => parseJSONSafe(v, null))
    .filter((g) => g && g.tip && g.status !== 'preparing')
  await refreshAggregates(games).catch(() => 0)
  const edge = await readEdge({ recentDays: 0 })
  const exp = await readExperiments(games)

  const since = new Date(Date.now() - 28 * 86400e3).toISOString().slice(0, 10)
  const recent = games.filter((g) => g.status === 'settled' && g.date >= since)
  const blobs = recent.length ? await redisPipeline(recent.map((g) => ['GET', KEY.bets(g.key)])) : []
  const cut = {}
  const add = (arm, dim, key, s) => {
    cut[arm] = cut[arm] || {}
    cut[arm][dim] = cut[arm][dim] || {}
    M.addBet((cut[arm][dim][key] = cut[arm][dim][key] || M.emptyBetAgg()), s)
  }
  recent.forEach((g, i) => {
    const bb = parseJSONSafe(blobs[i]?.result, { bets: [] })
    for (const b of bb.bets || []) {
      const s = b.result
      if (!s || s.outcome == null || s.value == null) continue
      const band = b.price < 0.3 ? 'under 30c' : b.price < 0.5 ? '30-50c' : b.price < 0.7 ? '50-70c' : '70c+'
      const lead = g.leadMin == null ? 'unknown' : g.leadMin < 45 ? 'under 45 min' : g.leadMin < 120 ? '45-120 min' : '2 h+'
      add(b.arm, 'side', b.side, s); add(b.arm, 'stat', b.stat, s); add(b.arm, 'price', band, s); add(b.arm, 'lead', lead, s)
    }
  })
  const breakdown = Object.fromEntries(Object.entries(cut).map(([arm, dims]) => [arm, Object.fromEntries(Object.entries(dims).map(([dim, ks]) =>
    [dim, Object.fromEntries(Object.entries(ks).map(([k, a]) => [k, M.describeBets(a)]))]))]))

  // For the morning email: the last nights in full, the portfolios, and the run log.
  let extra = {}
  if (nights > 0) {
    const pf = await readPortfolios({}).catch(() => null)
    const runs = ((await redis(['LRANGE', KEY.runs, '0', '39']).catch(() => null)) || []).map((r) => parseJSONSafe(r, null)).filter(Boolean)
    extra = {
      nights: await readNights(games, Math.min(nights, 7), pf?.stakes || {}),
      portfolios: pf ? { config: pf.config, arms: pf.arms, closes: pf.closes.slice(-14), night: pf.night, nightOpen: pf.nightOpen, live: pf.live } : null,
      runs: runs.map((r) => ({ at: r.at, job: r.job, status: r.status, note: r.note || null, error: r.error || null, decided: r.decided, closed: r.closed, settled: r.settled, waiting: r.waiting })),
    }
  }

  return {
    ok: true, job: 'edge-review', asOf: new Date().toISOString(),
    ...extra,
    base: { arms: edge.arms, headToHead: edge.armsCommon, status: edge.status, daily: edge.daily },
    experiments: exp,
    breakdownSince: since, breakdown,
    rules: {
      fields: { source: M.RULE_SOURCES, blend: [null, 'fit'], side: [null, 'yes', 'no'], stats: [null, ...M.STATS], minEdge: '0.01-0.5 (default 0.03)', maxEdge: 'optional', minPrice: '0.02-0.98 (default 0.05)', maxPrice: '0.02-0.98 (default 0.95)' },
      limits: { maxLive: MAX_LIVE_RULES, maxAddsPerWeek: MAX_ADDS_PER_WEEK, retireAfterDays: RETIRE_MIN_DAYS, retireAfterBets: RETIRE_MIN_BETS },
    },
  }
}

// Adds or retires a rule arm. Body: { action: 'add', arm: { name, hypothesis, success, source, ... } }
// or { action: 'retire', id, reason }. Rule arms only: a new Claude arm costs plan usage and
// is Adam's call.
export async function runArm({ body }) {
  let input = body
  if (typeof input === 'string') { try { input = JSON.parse(input) } catch { return { ok: false, status: 400, error: 'the body is not valid JSON' } } }
  const reg = await loadRegistry()
  const now = new Date().toISOString()
  if (input?.action === 'add') {
    const a = input.arm || {}
    const errs = M.validateRule(a)
    if (errs.length) return { ok: false, status: 422, error: errs.join('; ') }
    if (reg.filter((r) => r.status === 'live').length >= MAX_LIVE_RULES) return { ok: false, status: 409, error: `already ${MAX_LIVE_RULES} live rule arms; retire one first` }
    const recentAdds = reg.filter((r) => r.createdBy === 'researcher' && daysSince(r.createdAt) < 6).length
    if (recentAdds >= MAX_ADDS_PER_WEEK) return { ok: false, status: 429, error: `already ${MAX_ADDS_PER_WEEK} arms added this week` }
    const dupe = reg.find((r) => specOf(r) === specOf(a))
    if (dupe) return { ok: false, status: 409, error: `the same rule already exists as ${dupe.id} (${dupe.status})` }
    const id = `r${1 + Math.max(0, ...reg.map((r) => Number(r.id.slice(1)) || 0))}`
    const rec = { id, kind: 'rule', name: a.name.trim().slice(0, 80), hypothesis: a.hypothesis.trim().slice(0, 600), success: a.success.trim().slice(0, 300),
      ...Object.fromEntries(RULE_FIELDS.filter((k) => a[k] != null).map((k) => [k, a[k]])), status: 'live', createdAt: now, createdBy: 'researcher' }
    if (!(await redis(['HSETNX', KEY.arms, id, JSON.stringify(rec)]))) return { ok: false, status: 409, error: 'try again' }
    await logRun({ job: 'edge-arm', status: 'ok', note: `added ${id}: ${rec.name}` }).catch(() => {})
    return { ok: true, added: rec }
  }
  if (input?.action === 'retire') {
    const r = reg.find((x) => x.id === input.id)
    if (!r) return { ok: false, status: 404, error: `no arm ${input.id}` }
    if (r.status !== 'live') return { ok: false, status: 409, error: `${r.id} is already ${r.status}` }
    if (typeof input.reason !== 'string' || input.reason.trim().length < 20) return { ok: false, status: 422, error: 'say why, in a sentence' }
    const games = Object.values(toHash(await redis(['HGETALL', KEY.games]))).map((v) => parseJSONSafe(v, null)).filter((g) => g?.status === 'settled')
    const bets = M.emptyBetAgg()
    for (const g of games) M.mergeBetAgg(bets, g.agg?.[r.id]?.bets)
    if (daysSince(r.createdAt) < RETIRE_MIN_DAYS || bets.clvN < RETIRE_MIN_BETS) {
      return { ok: false, status: 409, error: `${r.id} needs ${RETIRE_MIN_DAYS} days and ${RETIRE_MIN_BETS} bets with a close before it can be retired (it has ${Math.floor(daysSince(r.createdAt))} days, ${bets.clvN} bets)` }
    }
    const next = { ...r, status: 'retired', retiredAt: now, reason: input.reason.trim().slice(0, 400) }
    await redis(['HSET', KEY.arms, r.id, JSON.stringify(next)])
    await logRun({ job: 'edge-arm', status: 'ok', note: `retired ${r.id}: ${next.reason.slice(0, 120)}` }).catch(() => {})
    return { ok: true, retired: next }
  }
  return { ok: false, status: 400, error: 'action must be "add" or "retire"' }
}

/* ------------------------------------------------------------------ *
 * The page's read
 * ------------------------------------------------------------------ */

export async function readEdge({ from = null, recentDays = 10 } = {}) {
  const [gamesRaw, metaRaw, runsRaw] = await redisPipeline([['HGETALL', KEY.games], ['HGETALL', KEY.meta], ['LRANGE', KEY.runs, '0', '29']])
  const games = Object.values(toHash(gamesRaw.result)).map((v) => parseJSONSafe(v, null)).filter((g) => g && g.tip && g.status !== 'preparing')
    .sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip))
  const meta = toHash(metaRaw.result)
  const runs = (runsRaw.result || []).map((r) => parseJSONSafe(r, null)).filter(Boolean)
  await refreshAggregates(games).catch(() => 0)

  const inRange = (g) => !from || g.date >= from
  // Head to head: only games every arm priced, so no arm is scored on an easier set of nights
  // (the Claude arms miss a game when the scheduled task didn't answer it before tip).
  const allPriced = (g) => M.ARMS.every((a) => (g.arms?.[a]?.fc || 0) > 0)
  const empty = () => Object.fromEntries(M.ARMS.map((a) => [a, { bets: M.emptyBetAgg(), fc: M.emptyFcAgg() }]))
  const totals = empty(), common = empty()
  let commonGames = 0
  const byDate = new Map()
  for (const g of games) {
    if (g.status !== 'settled' || !inRange(g)) continue
    const both = allPriced(g)
    if (both) commonGames += 1
    for (const a of M.ARMS) {
      M.mergeBetAgg(totals[a].bets, g.agg?.[a]?.bets)
      M.mergeFcAgg(totals[a].fc, g.agg?.[a]?.fc)
      if (both) { M.mergeBetAgg(common[a].bets, g.agg?.[a]?.bets); M.mergeFcAgg(common[a].fc, g.agg?.[a]?.fc) }
      if (!byDate.has(g.date)) byDate.set(g.date, Object.fromEntries(M.ARMS.map((x) => [x, M.emptyBetAgg()])))
      M.mergeBetAgg(byDate.get(g.date)[a], g.agg?.[a]?.bets)
    }
  }
  const describe = (t) => M.ARMS.map((a) => ({ arm: a, label: M.ARM_LABEL[a], ...M.describeBets(t[a].bets), ...M.describeForecasts(t[a].fc) }))
  const arms = describe(totals)
  const armsCommon = describe(common)

  // Running totals by night, for the chart.
  const run = Object.fromEntries(M.ARMS.map((a) => [a, { pnl: 0, clv: 0, n: 0 }]))
  const daily = [...byDate.keys()].sort().map((date) => {
    const row = { date }
    for (const a of M.ARMS) {
      const d = byDate.get(date)[a]
      run[a].pnl += d.pnl; run[a].clv += d.clvSum; run[a].n += d.n
      row[a] = { bets: d.n, pnl: d.pnl, cumPnl: run[a].pnl, cumClv: run[a].clv, cumBets: run[a].n }
    }
    return row
  })

  // The last few nights in full: bets, results, Claude's notes.
  const dates = recentDays > 0 ? [...new Set(games.map((g) => g.date))].sort().slice(-recentDays) : []
  const recentGames = games.filter((g) => dates.includes(g.date))
  const blobs = recentGames.length ? await redisPipeline(recentGames.map((g) => ['GET', KEY.bets(g.key)])) : []
  const recent = recentGames.map((g, i) => {
    const b = parseJSONSafe(blobs[i]?.result, { bets: [], notes: {} })
    return { ...g, agg: undefined, bets: b.bets || [], notes: b.notes || {} }
  }).reverse()

  const experiments = await readExperiments(games).catch((err) => ({ error: String(err?.message || err) }))

  return {
    experiments,
    status: {
      lastRun: meta.lastRun || null, lastJob: meta.lastJob || null, lastStatus: meta.lastStatus || null, lastError: meta.lastError || '',
      runs: Number(meta.runs) || 0, mode: claudeMode(), model: claudeMode() === 'api' ? claudeModel() : null, lastAnswer: meta.lastAnswer || null,
      minEdge: EDGE_MIN(), rules: M.BET_RULES,
      gamesDecided: games.filter((g) => g.status === 'decided' || g.status === 'settled').length,
      gamesPending: games.filter((g) => g.status === 'pending').length,
      gamesSettled: games.filter((g) => g.status === 'settled').length, commonGames,
    },
    arms,
    armsCommon,
    daily,
    recent,
    runs,
  }
}
