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
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { createHash } from 'node:crypto'
import { parseJSONSafe, redis, redisPipeline, timingSafeEqual, toHash } from './_lib.js'
import { origin } from '../_core.js'
import * as M from './_edge-model.js'
import * as K from './_edge-markets.js'
import { askClaude, buildPrompt, claudeMode, claudeModel, parseForecasts, taskText } from './_edge-claude.js'

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
}
const CLAUDE_ARMS = ['claude_wce', 'claude_box']

// The scheduled task proves itself with a token (header x-edge-token) that can only queue and
// answer. Only its SHA-256 lives here: the token itself is in the task's instructions on Adam's
// account. EDGE_TASK_TOKEN_SHA256 replaces it without a code change.
const TASK_TOKEN_SHA256 = '5075c6fc3da1fe42c2f7a5de244f1ec5419ad064e540aceebadf466da28cf9d0'
export function taskTokenOk(presented) {
  if (!presented) return false
  const want = (process.env.EDGE_TASK_TOKEN_SHA256 || TASK_TOKEN_SHA256).toLowerCase()
  return timingSafeEqual(createHash('sha256').update(String(presented)).digest('hex'), want)
}

// UTC. 14:00 to 02:00 is 10am to 10pm EDT (9am to 9pm EST); each fires somewhere in its hour.
export const PICK_SCHEDULES = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2].map((h) => `0 ${h} * * *`)
export const SETTLE_SCHEDULE = '0 11 * * *' // 7am EDT / 6am EST, after every game is final
export const jobForSchedule = (s) => (s === SETTLE_SCHEDULE ? 'edge-settle' : PICK_SCHEDULES.includes(s) ? 'edge-picks' : null)

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
  return { markets, proj, ix, injuries: inj.ok ? inj.v : {}, injuriesOk: inj.ok, ctx, playedOn, prevKnown: new Set(prev) }
}

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
    const input = { game, players: cards, ix, teams: [teamLine(ctx, game.away), teamLine(ctx, game.home)], health, rosters, schedule }
    packet.prompts = { claude_wce: buildPrompt('claude_wce', input), claude_box: buildPrompt('claude_box', input) }
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

  const probs = { model: new Map(), claude_wce: new Map(), claude_box: new Map() }
  for (const m of live) if (packet.model[m.ticker] != null) probs.model.set(m.ticker, packet.model[m.ticker])
  const arms = { model: { fc: probs.model.size } }
  const notes = {}
  for (const arm of CLAUDE_ARMS) {
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
  for (const arm of M.ARMS) {
    const picked = probs[arm].size ? M.pickBets(live, probs[arm], rules) : []
    if (arms[arm]) arms[arm].bets = picked.length
    for (const b of picked) {
      const m = b.market
      bets.push({ arm, ticker: m.ticker, series: m.series, stat: m.stat, k: m.k, player: m.player, team: m.team,
        side: b.side, price: b.price, fee: b.fee, p: b.p, edge: b.edge, bid: m.bid, ask: m.ask, at })
    }
  }

  const rows = live.map((m) => [m.ticker, m.player, m.team, m.stat, m.k, m.bid, m.ask,
    probs.model.get(m.ticker) ?? null, probs.claude_wce.get(m.ticker) ?? null, probs.claude_box.get(m.ticker) ?? null])
  const g = packet.game
  const record = {
    key: g.key, date: g.date, away: g.away, home: g.home, tip: new Date(g.tip).toISOString(),
    status: 'decided', preparedAt: packet.preparedAt, decidedAt: at, leadMin: Math.round((g.tip - Date.now()) / MIN),
    quotes: quotes ? 'live' : 'prepared', markets: live.length, players: packet.players, arms,
    claude: mode === 'api' ? claudeModel() : mode === 'task' ? 'scheduled task' : null, minEdge: rules.minEdge,
  }
  await redisPipeline([
    ['SET', KEY.fc(g.key), JSON.stringify({ at, cols: ['ticker', 'player', 'team', 'stat', 'k', 'bid', 'ask', ...M.ARMS], rows })],
    ['SET', KEY.bets(g.key), JSON.stringify({ at, bets, notes })],
    ['HSET', KEY.games, g.key, JSON.stringify(record)],
    ['DEL', KEY.pending(g.key)],
  ])
  return { record, bets: bets.length }
}

// API mode: both Claude arms asked here, then decided at the quotes just read.
async function decideWithApi(packet, deadline, tries) {
  const answers = {}
  const meta = packet.markets.map((m) => ({ id: m.id, playerKey: m.playerKey, stat: m.stat, k: m.k }))
  await Promise.all(CLAUDE_ARMS.map(async (arm) => {
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
  const failed = CLAUDE_ARMS.filter((a) => answers[a]?.error)
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
    preparedAt: packet.preparedAt, markets: packet.markets.length, players: packet.players, claude: 'scheduled task' }
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
async function prepareBatch(due, teamNames, { started, tries, result }) {
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
    for (const arm of CLAUDE_ARMS) if (h[arm]) answers[arm] = parseJSONSafe(h[arm], null)
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
      return result
    }

    await prepareBatch(due, teamNames, { started, tries, result })
    const armErrors = result.decided.flatMap((d) => Object.entries(d.arms).filter(([, a]) => a.error).map(([arm, a]) => `${d.key} ${arm}: ${a.error}`))
    const status = armErrors.length || result.skipped.some((s) => !/no quoted markets|out of time|already|being prepared|waiting for|not on ESPN/.test(s)) ? 'partial' : 'ok'
    result.status = status
    await logRun({ job: 'edge-picks', status, ms: Date.now() - started, decided: result.decided.map((d) => d.key), queued: result.queued, closed: result.closed,
      skipped: result.skipped, bets: result.decided.reduce((a, d) => a + d.bets, 0), error: armErrors.concat(result.warnings).join(' | ').slice(0, 600) })
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
    if (due.length) await prepareBatch(due, teamNames, { started, tries: {}, result: out })

    const after = toHash(await redis(['HGETALL', KEY.games]))
    const pend = Object.values(after).map((v) => parseJSONSafe(v, null))
      .filter((r) => r?.status === 'pending' && Date.parse(r.tip) - Date.now() > 5 * MIN)
      .sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip))
    const blobs = pend.length ? await redisPipeline(pend.map((r) => ['HGETALL', KEY.pending(r.key)])) : []
    pend.forEach((r, i) => {
      const h = toHash(blobs[i]?.result)
      const packet = parseJSONSafe(h.packet, null)
      if (!packet?.prompts) return
      for (const arm of CLAUDE_ARMS) {
        if (h[arm]) continue
        const id = `${r.key}.${arm}`
        const answer = `${TASK_DIR}/${id}.json`
        out.tasks.push({ id, key: r.key, arm, game: `${r.away} at ${r.home}, ${tipText(Date.parse(r.tip))}`, markets: packet.markets.length,
          file: `${TASK_DIR}/${id}.txt`, answer, text: taskText(packet.prompts[arm], answer) })
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

// One arm's answer for one game, posted by the scheduled task. When both arms are in, the
// game is decided straight away at Kalshi's quotes of this moment.
export async function runAnswer({ task, body }) {
  const m = /^(\d{2}[A-Z]{3}\d{2}[A-Z]{6})\.(claude_wce|claude_box)$/.exec(String(task || ''))
  if (!m) return { ok: false, status: 400, error: 'task must look like 26OCT21MINMIA.claude_wce' }
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
  const waitingFor = CLAUDE_ARMS.filter((a) => !h[a])
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

  const agg = Object.fromEntries(M.ARMS.map((a) => [a, { bets: M.emptyBetAgg(), fc: M.emptyFcAgg() }]))
  for (const b of bb.bets) {
    const s = M.settleBet(b, value(b.ticker), closes.get(b.ticker))
    if (!s) { b.result = { outcome: 'void', pnl: 0, note: 'never settled' }; continue }
    b.result = { ...s, actual: byTicker.get(b.ticker)?.actual ?? null }
    M.addBet(agg[b.arm].bets, s)
  }
  const armCol = Object.fromEntries(M.ARMS.map((a) => [a, (fc.cols || []).indexOf(a)]))
  for (const r of fc.rows) {
    const y = value(r[0])
    if (y !== 0 && y !== 1) continue
    const mkt = (r[5] + r[6]) / 2
    for (const a of M.ARMS) M.addForecast(agg[a].fc, r[armCol[a]], mkt, y)
  }
  fc.results = Object.fromEntries(fc.rows.map((r) => [r[0], value(r[0])]))

  const next = { ...rec, status: 'settled', settledAt: new Date().toISOString(), agg, unresolved }
  await redisPipeline([
    ['SET', KEY.bets(rec.key), JSON.stringify(bb)],
    ['SET', KEY.fc(rec.key), JSON.stringify(fc)],
    ['HSET', KEY.games, rec.key, JSON.stringify(next)],
  ])
  return { settled: true }
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
 * The page's read
 * ------------------------------------------------------------------ */

export async function readEdge({ from = null, recentDays = 10 } = {}) {
  const [gamesRaw, metaRaw, runsRaw] = await redisPipeline([['HGETALL', KEY.games], ['HGETALL', KEY.meta], ['LRANGE', KEY.runs, '0', '29']])
  const games = Object.values(toHash(gamesRaw.result)).map((v) => parseJSONSafe(v, null)).filter((g) => g && g.tip && g.status !== 'preparing')
    .sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip))
  const meta = toHash(metaRaw.result)
  const runs = (runsRaw.result || []).map((r) => parseJSONSafe(r, null)).filter(Boolean)

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
  const dates = [...new Set(games.map((g) => g.date))].sort().slice(-recentDays)
  const recentGames = games.filter((g) => dates.includes(g.date))
  const blobs = recentGames.length ? await redisPipeline(recentGames.map((g) => ['GET', KEY.bets(g.key)])) : []
  const recent = recentGames.map((g, i) => {
    const b = parseJSONSafe(blobs[i]?.result, { bets: [], notes: {} })
    return { ...g, agg: undefined, bets: b.bets || [], notes: b.notes || {} }
  }).reverse()

  return {
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
