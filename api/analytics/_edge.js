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
// THE JOBS (both run inside api/analytics/snapshot.js, so the lab costs no function slot)
//   picks   hourly-ish, 10am to 10pm ET (Hobby crons are daily, so one entry per hour). Decides
//           every game tipping 20 to 150 minutes out that has not been decided yet. Hobby
//           fires anywhere in the hour; a 130-minute window covers the worst gap between runs.
//   settle  every morning. Results from Kalshi, closing quotes from Kalshi's minute candles
//           at the tip, P&L and CLV per bet, aggregates per game.
//
// STORAGE (Upstash, beside the analytics archive)
//   wce:edge:games         hash  game key -> record (status, tip, per-arm counts and aggregates)
//   wce:edge:fc:<game>     JSON  every quoted market at decision time with each arm's number
//   wce:edge:bets:<game>   JSON  the paper bets, Claude's notes, then the results
//   wce:edge:meta          hash  last run, status, error
//   wce:edge:runs          list  the last 200 runs
//   wce:edge:ids           JSON  Kalshi -> Sleeper player ids, refreshed daily
//   wce:edge:tries         hash  game key -> failed Claude attempts (a game is retried once)
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { parseJSONSafe, redis, redisPipeline, toHash } from './_lib.js'
import { origin } from '../_core.js'
import * as M from './_edge-model.js'
import * as K from './_edge-markets.js'
import { askClaude, buildPrompt, claudeEnabled, claudeModel } from './_edge-claude.js'

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
      'claude', claudeEnabled() ? 'on' : 'off', 'model', claudeModel()],
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
 * Deciding one game
 * ------------------------------------------------------------------ */

async function decideGame(game, all, env) {
  const { proj, ix, injuries, injuriesOk, ctx, deadline } = env
  const out = { key: game.key, notes: [] }

  // Who sits: ESPN's feed when it answered, the projection file's status otherwise.
  const listed = {}
  const outIds = { [game.away]: new Set(), [game.home]: new Set() }
  for (const team of [game.away, game.home]) {
    const list = injuriesOk ? injuries[team] || [] : []
    listed[team] = list.map((i) => `${i.name} (${i.status})`)
    for (const i of list) {
      if (!K.isOut(i.status) && !/doubtful/i.test(i.status)) continue
      const n = K.normName(i.name)
      for (const [id, p] of Object.entries(proj.players)) if (p.team === team && K.normName(p.name) === n) outIds[team].add(id)
    }
    if (!injuriesOk) {
      for (const [id, p] of Object.entries(proj.players)) if (p.team === team && K.isOut(p.status)) { outIds[team].add(id); listed[team].push(`${p.name} (${p.status})`) }
    }
  }
  const injuryOf = (team, name) => (injuriesOk ? (injuries[team] || []).find((i) => K.normName(i.name) === K.normName(name)) : null)

  // The markets worth forecasting: matched to a projection, player not out, quoted tightly.
  const markets = all.filter((m) => m.game === game.key && m.playerId && proj.players[m.playerId])
  const players = new Map()
  for (const m of markets) {
    const p = proj.players[m.playerId]
    if (outIds[p.team]?.has(m.playerId) || K.isOut(injuryOf(p.team, p.name)?.status)) continue
    if (!M.isQuoted(m) || !M.withinSpread(m, QUOTE_MAX_SPREAD)) continue
    if (!players.has(m.playerId)) players.set(m.playerId, { id: m.playerId, p, markets: [] })
    players.get(m.playerId).markets.push(m)
  }
  if (!players.size) return { ...out, empty: true }

  // Stable ids for the prompts: players in team order, stats in a fixed order, then lines.
  const order = [...players.values()].sort((a, b) => (a.p.team === b.p.team ? a.p.name.localeCompare(b.p.name) : a.p.team === game.away ? -1 : 1))
  const quoted = []
  for (const pl of order) {
    pl.markets.sort((a, b) => M.STATS.indexOf(a.stat) - M.STATS.indexOf(b.stat) || a.k - b.k)
    for (const m of pl.markets) { m.id = `m${quoted.length + 1}`; quoted.push(m) }
  }

  // Arm 1: the WCE model.
  const probs = { model: new Map(), claude_wce: new Map(), claude_box: new Map() }
  for (const m of quoted) {
    const p = M.modelProb(proj.players[m.playerId], ix, m.stat, m.k)
    m.pModel = p
    if (p != null) probs.model.set(m.ticker, p)
  }

  // Arms 2 and 3: Claude, if switched on.
  const arms = { model: { fc: probs.model.size } }
  const notes = {}
  if (claudeEnabled()) {
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
        status: inj?.status || null, statusNote: inj?.comment || null,
        proj: pl.p.ros || pl.p.pre, log: pl.p.log || [],
        savant: sv?.facts || null, savantSeason: ctx.savantSeason, peers: sv?.peers,
        beneficiary,
        markets: pl.markets.map((m) => ({ id: m.id, stat: m.stat, k: m.k, pModel: m.pModel })),
      }
    })
    const input = { game, players: cards, ix, teams: [teamLine(ctx, game.away), teamLine(ctx, game.home)], outs: listed }
    const meta = quoted.map((m) => ({ id: m.id, playerKey: m.playerKey, stat: m.stat, k: m.k }))
    const byId = new Map(quoted.map((m) => [m.id, m]))
    await Promise.all(['claude_wce', 'claude_box'].map(async (arm) => {
      const started = Date.now()
      try {
        const ans = await askClaude(buildPrompt(arm, input), meta, { deadline })
        for (const [id, p] of ans.probs) probs[arm].set(byId.get(id).ticker, p)
        notes[arm] = ans.notes
        arms[arm] = { fc: probs[arm].size, missing: ans.missing, ms: ans.ms, inTok: ans.usage?.input_tokens || 0, outTok: ans.usage?.output_tokens || 0, cacheTok: ans.usage?.cache_read_input_tokens || 0 }
      } catch (err) {
        arms[arm] = { fc: 0, error: String(err?.message || err).slice(0, 300), ms: Date.now() - started }
      }
    }))
  }

  // A Claude arm that failed (overload, timeout) would leave this game out of that arm for
  // good, and failures bunch on busy nights, which would skew the comparison. So while there
  // is time before tip, nothing is recorded and the next run tries the whole game again.
  const failed = ['claude_wce', 'claude_box'].filter((a) => arms[a]?.error)
  if (failed.length && game.tip - Date.now() > RETRY_LEAD && (env.tries[game.key] || 0) + 1 < MAX_TRIES) {
    await redis(['HINCRBY', KEY.tries, game.key, '1']).catch(() => {})
    return { ...out, retry: failed.map((a) => `${a}: ${arms[a].error}`).join('; ') }
  }

  // The bets.
  const rules = { ...M.BET_RULES, minEdge: EDGE_MIN() }
  const at = new Date().toISOString()
  const bets = []
  for (const arm of M.ARMS) {
    const picked = probs[arm].size ? M.pickBets(quoted, probs[arm], rules) : []
    if (arms[arm]) arms[arm].bets = picked.length
    for (const b of picked) {
      const m = b.market
      bets.push({ arm, ticker: m.ticker, series: m.series, stat: m.stat, k: m.k, player: proj.players[m.playerId].name, team: proj.players[m.playerId].team,
        side: b.side, price: b.price, fee: b.fee, p: b.p, edge: b.edge, bid: m.bid, ask: m.ask, at })
    }
  }

  const rows = quoted.map((m) => [m.ticker, proj.players[m.playerId].name, proj.players[m.playerId].team, m.stat, m.k, m.bid, m.ask,
    probs.model.get(m.ticker) ?? null, probs.claude_wce.get(m.ticker) ?? null, probs.claude_box.get(m.ticker) ?? null])
  const record = {
    key: game.key, date: game.date, away: game.away, home: game.home, tip: new Date(game.tip).toISOString(),
    status: 'decided', decidedAt: at, leadMin: Math.round((game.tip - Date.now()) / MIN),
    markets: quoted.length, players: order.length, arms, claude: claudeEnabled() ? claudeModel() : null, minEdge: rules.minEdge,
  }
  await redisPipeline([
    ['SET', KEY.fc(game.key), JSON.stringify({ at, cols: ['ticker', 'player', 'team', 'stat', 'k', 'bid', 'ask', ...M.ARMS], rows })],
    ['SET', KEY.bets(game.key), JSON.stringify({ at, bets, notes })],
    ['HSET', KEY.games, game.key, JSON.stringify(record)],
  ])
  return { ...out, record, bets: bets.length }
}

/* ------------------------------------------------------------------ *
 * The picks job
 * ------------------------------------------------------------------ */

// opts.lead (minutes) widens the window for a manual run; opts.keys decides those games now.
export async function runPicks(opts = {}) {
  const started = Date.now()
  const result = { ok: true, job: 'edge-picks', decided: [], skipped: [], warnings: [] }
  let token = null
  try {
    token = await takeLock(295e3)
    if (!token) return { ...result, skipped: ['another Edge Lab run is in progress'] }
    const now = Date.now()
    const asked = (opts.keys || []).map((k) => K.parseGameKey(k)?.date).filter(Boolean)
    const dates = [...new Set([K.etDate(now), K.etDate(now + 4 * 60 * MIN), ...asked])]
    const slates = await Promise.all(dates.map((d) => K.slate(d)))
    const games = slates.flatMap((s) => s.games)
    const teamNames = Object.assign({}, ...slates.map((s) => s.teamNames))
    const [knownRaw, triesRaw] = await redisPipeline([['HGETALL', KEY.games], ['HGETALL', KEY.tries]])
    const known = toHash(knownRaw.result)
    const tries = Object.fromEntries(Object.entries(toHash(triesRaw.result)).map(([k, v]) => [k, Number(v) || 0]))
    const maxLead = opts.lead ? opts.lead * MIN : LEAD_MAX
    const want = opts.keys ? new Set(opts.keys) : null
    if (want) {
      // Say why a game asked for by hand was not decided.
      for (const k of want) {
        const g = games.find((x) => x.key === k)
        if (!g) result.skipped.push(`${k} (not on ESPN's schedule for that date)`)
        else if (known[k]) result.skipped.push(`${k} (already decided)`)
        else if (g.state !== 'pre') result.skipped.push(`${k} (already started)`)
      }
    }
    const due = games
      .filter((g) => !known[g.key] && g.state === 'pre')
      .filter((g) => (want ? want.has(g.key) : g.tip - now > LEAD_MIN && g.tip - now <= maxLead))
      .sort((a, b) => a.tip - b.tip)
    result.slate = games.length
    if (!due.length) {
      result.note = 'no games due'
      // Quiet runs settle anything that finished earlier (matinees, last night's stragglers).
      const s = await settleGames({ budget: 100e3, started })
      result.settled = s.settled
      if (s.warnings.length) result.warnings.push(...s.warnings)
      await logRun({ job: 'edge-picks', status: 'ok', ms: Date.now() - started, note: result.note, settled: s.settled })
      return result
    }

    const [markets, proj, ids, inj, ctx] = await Promise.all([
      K.openMarkets(due.map((g) => g.key), { deadline: started + 120e3 }),
      siteJson('savant-proj.json'),
      // Without Sleeper the join falls back to names, which matches nearly everyone.
      kalshiIds(K.etDate(now)).catch((err) => { result.warnings.push(`Sleeper ids unavailable (${err?.message || err}); matched players by name`); return {} }),
      K.injuries(teamNames).then((v) => ({ ok: true, v })).catch((err) => ({ ok: false, err })),
      claudeEnabled() ? wceContext() : Promise.resolve({}),
    ])
    if (!inj.ok) result.warnings.push(`ESPN injuries unavailable (${inj.err?.message || inj.err}); used the projection file's statuses`)
    const unmatched = K.joinPlayers(markets, proj, ids)
    if (unmatched.length) result.warnings.push(`no WCE projection for: ${unmatched.slice(0, 12).join(', ')}${unmatched.length > 12 ? '…' : ''}`)
    const ix = {}
    ;(proj.log_cols || []).forEach((c, i) => { ix[c] = i })

    const env = { proj, ix, injuries: inj.ok ? inj.v : {}, injuriesOk: inj.ok, ctx, tries, deadline: started + 270e3 }
    // Two games at a time: four Claude calls in flight at most.
    const queue = [...due]
    const worker = async () => {
      while (queue.length) {
        if (Date.now() - started > DECIDE_BUDGET) { result.skipped.push(...queue.splice(0).map((g) => `${g.key} (out of time; next run)`)); return }
        const g = queue.shift()
        try {
          const r = await decideGame(g, markets, env)
          if (r.empty) result.skipped.push(`${g.key} (no quoted markets yet)`)
          else if (r.retry) result.skipped.push(`${g.key} (Claude failed, retrying next run: ${r.retry.slice(0, 200)})`)
          else result.decided.push({ key: g.key, markets: r.record.markets, bets: r.bets, arms: r.record.arms })
        } catch (err) {
          result.skipped.push(`${g.key} (${String(err?.message || err).slice(0, 160)})`)
        }
      }
    }
    await Promise.all([worker(), worker()])
    const armErrors = result.decided.flatMap((d) => Object.entries(d.arms).filter(([, a]) => a.error).map(([arm, a]) => `${d.key} ${arm}: ${a.error}`))
    const status = armErrors.length || result.skipped.some((s) => !/no quoted markets|out of time|already decided|already started/.test(s)) ? 'partial' : 'ok'
    result.status = status
    await logRun({ job: 'edge-picks', status, ms: Date.now() - started, decided: result.decided.map((d) => d.key), skipped: result.skipped,
      bets: result.decided.reduce((a, d) => a + d.bets, 0), error: armErrors.concat(result.warnings).join(' | ').slice(0, 600) })
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
    const s = await settleGames({ budget: SETTLE_BUDGET, started, keys: opts.keys })
    const status = s.warnings.length ? 'partial' : 'ok'
    await logRun({ job: 'edge-settle', status, ms: Date.now() - started, settled: s.settled, waiting: s.waiting, error: s.warnings.join(' | ').slice(0, 600) })
    return { ok: true, job: 'edge-settle', status, ...s }
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
  const games = Object.values(toHash(gamesRaw.result)).map((v) => parseJSONSafe(v, null)).filter(Boolean)
    .sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip))
  const meta = toHash(metaRaw.result)
  const runs = (runsRaw.result || []).map((r) => parseJSONSafe(r, null)).filter(Boolean)

  const inRange = (g) => !from || g.date >= from
  // Head to head: only games every arm priced, so no arm is scored on an easier set of nights
  // (the Claude arms miss games while ANTHROPIC_API_KEY is unset, or when a call fails twice).
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
      runs: Number(meta.runs) || 0, claude: claudeEnabled(), model: claudeModel(), minEdge: EDGE_MIN(), rules: M.BET_RULES,
      gamesDecided: games.length, gamesSettled: games.filter((g) => g.status === 'settled').length, commonGames,
    },
    arms,
    armsCommon,
    daily,
    recent,
    runs,
  }
}
