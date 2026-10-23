// tools/edge/check.mjs — the Edge Lab's arithmetic, checked without the network.
//   npm run check:edge

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../../api/analytics/_edge-model.js'
import { gameKey, parseGameKey, parseMarket, normName, joinPlayers } from '../../api/analytics/_edge-markets.js'
import { buildPrompt, claudeMode, dataText, parseAnswer, parseForecasts, taskText, TASK_JOB } from '../../api/analytics/_edge-claude.js'
import { readFileSync } from 'node:fs'
import { taskTokenOk } from '../../api/analytics/_edge.js'
import { createHash } from 'node:crypto'

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`)

test('the tail probability matches a direct sum (Poisson and negative binomial)', () => {
  // Poisson(3): P(X >= 2) = 1 - e^-3 (1 + 3)
  close(M.tailProb(3, 1, 2), 1 - Math.exp(-3) * 4, 1e-12)
  // NB with mean 10, variance 25: r = 10/1.5, p = 0.4. Sum the pmf directly.
  const mu = 10, phi = 2.5, r = mu / (phi - 1), p = 1 / phi
  const lgamma = (z) => { // Lanczos
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z)
    z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
    const t = z + g + 0.5
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
  }
  let cdf = 0
  for (let x = 0; x < 15; x++) cdf += Math.exp(lgamma(x + r) - lgamma(r) - lgamma(x + 1) + r * Math.log(p) + x * Math.log(1 - p))
  close(M.tailProb(mu, phi, 15), 1 - cdf, 1e-9)
  // Edges: k <= 0 is certain; a higher line is never likelier.
  assert.equal(M.tailProb(5, 2, 0), 1)
  for (let k = 1; k < 40; k++) assert.ok(M.tailProb(20, 2.4, k + 1) <= M.tailProb(20, 2.4, k))
})

test('dispersion leans on the prior for thin logs and on the log for long ones', () => {
  const ix = { min: 0, pts: 1, reb: 2, ast: 3, fg3m: 4 }
  assert.equal(M.dispersion([], ix, 'pts'), M.PHI_PRIOR.pts)
  // 60 games alternating 10 and 30 points: mean 20, variance ~101.7, ratio ~5.08
  const log = Array.from({ length: 60 }, (_, i) => [30, i % 2 ? 30 : 10, 5, 5, 2])
  const phi = M.dispersion(log, ix, 'pts')
  const obs = (60 * 100 / 59) / 20
  close(phi, (60 * obs + 20 * M.PHI_PRIOR.pts) / 80, 1e-9)
  // DNPs (0 minutes) are not games
  assert.equal(M.dispersion(log.map((r) => [0, ...r.slice(1)]), ix, 'pts'), M.PHI_PRIOR.pts)
  // PRA adds the three
  assert.equal(M.logValue([30, 20, 5, 7, 2], ix, 'pra'), 32)
})

test('the fee is Kalshi\'s quadratic taker fee', () => {
  close(M.takerFee(0.5), 0.0175)
  close(M.takerFee(0.2), 0.07 * 0.2 * 0.8)
})

test('the bet rule takes the better side at the ask, after the fee, one per player', () => {
  const mk = (ticker, playerKey, bid, ask) => ({ ticker, playerKey, bid, ask, noAsk: 1 - bid })
  const ms = [mk('a20', 'g|1', 0.60, 0.62), mk('a25', 'g|1', 0.30, 0.33), mk('b10', 'g|2', 0.48, 0.50)]
  const probs = new Map([['a20', 0.70], ['a25', 0.42], ['b10', 0.40]])
  const bets = M.pickBets(ms, probs, M.BET_RULES)
  // Player 1: a20 yes edge 0.70-0.62-0.0165 = 0.0635; a25 yes 0.42-0.33-0.0155 = 0.0745 -> a25.
  const p1 = bets.find((b) => b.market.playerKey === 'g|1')
  assert.equal(p1.market.ticker, 'a25'); assert.equal(p1.side, 'yes')
  close(p1.edge, 0.42 - 0.33 - M.takerFee(0.33))
  // Player 2: NO at 0.52 with p(no) 0.60: edge 0.60-0.52-0.0175 = 0.0625
  const p2 = bets.find((b) => b.market.playerKey === 'g|2')
  assert.equal(p2.side, 'no'); close(p2.price, 0.52); close(p2.edge, 0.60 - 0.52 - M.takerFee(0.52))
  // Nothing clears a big threshold; wide or one-sided quotes never bet.
  assert.equal(M.pickBets(ms, probs, { ...M.BET_RULES, minEdge: 0.2 }).length, 0)
  assert.equal(M.bestSide({ bid: 0.3, ask: 0.45, noAsk: 0.7 }, 0.9), null)
  assert.equal(M.bestSide({ bid: 0, ask: 0.05, noAsk: 1 }, 0.5), null)
  // Spreads compare in cents: 0.40 - 0.30 is not quite 0.10 in floating point.
  assert.ok(M.withinSpread({ bid: 0.30, ask: 0.40 }, 0.10))
  assert.ok(!M.withinSpread({ bid: 0.29, ask: 0.40 }, 0.10))
  assert.notEqual(M.bestSide({ bid: 0.30, ask: 0.40, noAsk: 0.70 }, 0.6), null)
})

test('settlement: P&L per unit staked, voids, closing line value', () => {
  const bet = { side: 'yes', price: 0.40, fee: M.takerFee(0.40) }
  const cost = 0.40 + M.takerFee(0.40)
  const win = M.settleBet(bet, 1, { bid: 0.45, ask: 0.47 })
  close(win.pnl, 1 / cost - 1); assert.equal(win.outcome, 'win'); close(win.clv, 0.46 - 0.40)
  const loss = M.settleBet(bet, 0, null)
  close(loss.pnl, -1); assert.equal(loss.clv, null)
  const v = M.settleBet(bet, 0.37, { bid: 0.3, ask: 0.32 })
  assert.equal(v.outcome, 'void'); assert.equal(v.pnl, 0)
  const no = M.settleBet({ side: 'no', price: 0.55, fee: M.takerFee(0.55) }, 0, { bid: 0.40, ask: 0.42 })
  assert.equal(no.outcome, 'win'); close(no.clv, (1 - 0.41) - 0.55)
  assert.equal(M.settleBet(bet, null, null), null)
  // The aggregate leaves voids out of P&L and CLV.
  const a = M.emptyBetAgg(); [win, loss, v, no].forEach((s) => M.addBet(a, s))
  assert.deepEqual([a.n, a.w, a.l, a.v, a.staked, a.clvN], [4, 2, 1, 1, 3, 2])
  const d = M.describeBets(a)
  close(d.roi, a.pnl / 3); close(d.clvMean, ((0.46 - 0.40) + (0.59 - 0.55)) / 2)
})

test('forecast scoring: Brier against the market and calibration bins', () => {
  const a = M.emptyFcAgg()
  M.addForecast(a, 0.8, 0.6, 1)
  M.addForecast(a, 0.3, 0.5, 0)
  M.addForecast(a, 0.3, 0.5, 0.4) // a void never scores
  const d = M.describeForecasts(a)
  assert.equal(d.forecasts, 2)
  close(d.brier, (0.04 + 0.09) / 2); close(d.brierMarket, (0.16 + 0.25) / 2)
  assert.ok(d.skill > 0)
  assert.equal(d.calibration[8].n, 1); assert.equal(d.calibration[3].n, 1)
})

test('monotone makes one player\'s lines coherent', () => {
  const out = M.monotone([{ k: 20, p: 0.5 }, { k: 25, p: 0.6 }, { k: 30, p: 0.1 }])
  close(out[0].p, 0.55); close(out[1].p, 0.55); close(out[2].p, 0.1)
  const keep = M.monotone([{ k: 25, p: 0.3 }, { k: 20, p: 0.6 }])
  close(keep[0].p, 0.3); close(keep[1].p, 0.6)
})

test('Kalshi markets and game keys parse', () => {
  assert.deepEqual(parseGameKey('26OCT21MINMIA'), { date: '2026-10-21', away: 'MIN', home: 'MIA' })
  assert.equal(gameKey('2026-10-21', 'MIN', 'MIA'), '26OCT21MINMIA')
  const m = parseMarket({
    ticker: 'KXNBAPTS-26OCT21MINMIA-MINAEDWARDS5-30', event_ticker: 'KXNBAPTS-26OCT21MINMIA', market_type: 'binary', strike_type: 'greater',
    floor_strike: 29.5, title: 'Anthony Edwards: 30+ points', custom_strike: { basketball_player: 'uuid-1' },
    yes_bid_dollars: '0.4100', yes_ask_dollars: '0.4400', no_ask_dollars: '0.5900', volume_fp: '638.05', status: 'active', result: '',
  })
  assert.equal(m.k, 30); assert.equal(m.stat, 'pts'); assert.equal(m.game, '26OCT21MINMIA'); assert.equal(m.name, 'Anthony Edwards')
  assert.equal(m.settled, false)
  assert.equal(parseMarket({ ...m, event_ticker: 'KXNBAGAME-26OCT21MINMIA' }), null)
  assert.equal(M.settledValue({ result: 'yes' }), 1)
  assert.equal(M.settledValue({ settled: true, result: '', value: '0.3700' }), 0.37)
  assert.equal(M.settledValue({ settled: false, result: '' }), null)
})

test('players join through Sleeper, then by name', () => {
  assert.equal(normName('Nikola Jokić'), normName('nikola jokic'))
  assert.equal(normName('Jaren Jackson Jr.'), normName('Jaren Jackson'))
  const proj = { players: { 10: { name: 'Anthony Edwards', slp: '777', team: 'MIN' }, 11: { name: 'Bam Adebayo', slp: '888', team: 'MIA' } } }
  const ms = [{ game: 'G', name: 'A. Edwards', kalshiPlayer: 'k1' }, { game: 'G', name: 'Bam Adebayo', kalshiPlayer: 'zzz' }, { game: 'G', name: 'Nobody', kalshiPlayer: null }]
  const missing = joinPlayers(ms, proj, { k1: '777' })
  assert.equal(ms[0].playerId, '10'); assert.equal(ms[1].playerId, '11'); assert.equal(ms[2].playerId, null)
  assert.deepEqual(missing, ['Nobody'])
})

test('Claude\'s answer is read by id, clamped and made coherent', () => {
  const markets = [
    { id: 'm1', playerKey: 'g|1', stat: 'pts', k: 20 },
    { id: 'm2', playerKey: 'g|1', stat: 'pts', k: 25 },
    { id: 'm3', playerKey: 'g|1', stat: 'reb', k: 5 },
  ]
  const json = { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_forecasts', input: { notes: 'n', forecasts: [{ id: 'm1', p: 0.4 }, { id: 'm2', p: 0.5 }, { id: 'm3', p: 1 }, { id: 'zz', p: 0.5 }] } }] }
  const ans = parseAnswer(json, markets)
  close(ans.probs.get('m1'), 0.45); close(ans.probs.get('m2'), 0.45); close(ans.probs.get('m3'), 0.99)
  assert.equal(ans.missing, 0)
  assert.throws(() => parseAnswer({ content: [{ type: 'text', text: 'hi' }] }, markets))
  // A truncated answer is an error, and a percent is not a probability.
  assert.throws(() => parseAnswer({ ...json, stop_reason: 'max_tokens' }, markets), /max_tokens/)
  const pctAns = parseAnswer({ content: [{ type: 'tool_use', name: 'record_forecasts', input: { notes: '', forecasts: [{ id: 'm1', p: 62 }, { id: 'm3', p: 0.3 }] } }] }, markets)
  assert.equal(pctAns.probs.has('m1'), false); assert.equal(pctAns.missing, 2)
})

test('the prompts: the box-score arm never sees WCE numbers', () => {
  const ix = { min: 0, pts: 1, reb: 2, ast: 3, fg3m: 4 }
  const players = [{
    name: 'Anthony Edwards', team: 'MIN', pos: 'Guard', age: 25.2, status: 'Questionable',
    proj: { min: 36, pts: 27.1, reb: 5.4, ast: 4.6, fg3m: 3.4, fga: 21, fta: 7 }, log: [[36, 30, 5, 4, 4], [35, 22, 6, 5, 2]],
    savant: [{ label: 'usage %', value: '31.2', pct: 95 }], savantSeason: '2025-26', peers: 'guards',
    beneficiary: ['With X out tonight — ...'],
    markets: [{ id: 'm1', stat: 'pts', k: 25, pModel: 0.58 }],
  }]
  const health = { MIN: [{ name: 'Anthony Edwards', status: 'Questionable', date: '2026-10-21T15:00Z', comment: 'Edwards (ankle) is a game-time call.' }], MIA: [{ name: 'Someone', status: 'Out', date: null, comment: '' }] }
  const rosters = {
    MIN: [{ name: 'Anthony Edwards', pos: 'Guard', status: 'Questionable', hasMarket: true, gp: 1, proj: { min: 36, pts: 27.1, reb: 5.4, ast: 4.6 }, usg: 31.2, log: [[36, 30, 5, 4, 4], [35, 22, 6, 5, 2]] },
      { name: 'Bench Guy', pos: 'Wing', status: null, hasMarket: false, gp: 0, rookie: true, proj: { min: 14, pts: 5, reb: 2, ast: 1 }, usg: null, log: [] }],
    MIA: [{ name: 'Someone', pos: 'Big', status: 'Out', hasMarket: false, gp: 0, proj: { min: 30, pts: 18, reb: 9, ast: 2 }, usg: 22.0, log: [[30, 18, 9, 2, 0]] }],
  }
  const schedule = ['MIN played last night, so tonight is the second night of a back-to-back.', 'MIA did not play last night.']
  const input = { game: { away: 'MIN', home: 'MIA', tip: Date.parse('2026-10-21T23:30:00Z') }, players, ix, teams: ['MIN (2025-26): pace 99.0'], health, rosters, schedule }
  const wce = buildPrompt('claude_wce', input)
  const box = buildPrompt('claude_box', input)
  assert.match(wce, /WCE 58%/); assert.match(wce, /usage % 31\.2 \(95th\)/); assert.match(wce, /7:30 PM ET/)
  assert.match(wce, /Someone \(B\), OUT · WCE projection 30\.0 min/)
  // Both arms get the same game facts: schedule, injury notes, the whole rotation.
  for (const t of [wce, box]) {
    assert.match(t, /second night of a back-to-back/)
    assert.match(t, /Edwards \(ankle\) is a game-time call/)
    assert.match(t, /Bench Guy/); assert.match(t, /Someone/)
  }
  assert.match(box, /Someone \(B\), OUT · last 1 games: 30\.0 min, 18\.0 pts/)
  assert.match(box, /Bench Guy \(W\) · rookie, no NBA games yet/)
  // And only the WCE arm gets WCE's analytics.
  assert.doesNotMatch(box, /WCE|projection|Savant|usage|pace|With X out/)
  assert.match(box, /m1 PTS 25\+/)
})

test('the scheduled task: self-contained texts, JSON answers, its own token', () => {
  const ix = { min: 0, pts: 1, reb: 2, ast: 3, fg3m: 4 }
  const players = [{ name: 'Bam Adebayo', team: 'MIA', pos: 'Big', proj: { min: 33, pts: 19, reb: 9.8, ast: 3.6, fg3m: 0.9, fga: 15, fta: 5 }, log: [[34, 20, 10, 4, 1]],
    savant: [{ label: 'usage %', value: '24.0', pct: 70 }], savantSeason: '2025-26', peers: 'bigs', beneficiary: [], markets: [{ id: 'm1', stat: 'reb', k: 10, pModel: 0.47 }] }]
  const input = { game: { away: 'MIN', home: 'MIA', tip: Date.parse('2026-10-21T23:30:00Z') }, players, ix, teams: ['MIA (2025-26): pace 98'], health: { MIN: [], MIA: [] }, rosters: {} }
  const box = taskText(buildPrompt('claude_box', input), '/tmp/edge/26OCT21MINMIA.claude_box.json')
  const wce = taskText(buildPrompt('claude_wce', input), '/tmp/edge/26OCT21MINMIA.claude_wce.json')
  assert.match(box, /Write tool to \/tmp\/edge\/26OCT21MINMIA\.claude_box\.json/)
  assert.match(box, /Do not search the web/)
  assert.doesNotMatch(box, /WCE \d|projection|Savant|usage|pace/)
  assert.match(wce, /\[WCE 47%\]/)
  // The answer file's JSON reads the same way as the API's tool call.
  const markets = [{ id: 'm1', playerKey: 'g|1', stat: 'reb', k: 10 }, { id: 'm2', playerKey: 'g|1', stat: 'reb', k: 12 }]
  const ans = parseForecasts({ notes: 'x', forecasts: [{ id: 'm1', p: 0.4 }, { id: 'm2', p: 0.45 }] }, markets)
  close(ans.probs.get('m1'), 0.425); close(ans.probs.get('m2'), 0.425); assert.equal(ans.missing, 0)
  assert.equal(parseForecasts({ forecasts: 'nope' }, markets).missing, 2)
  // Only the token whose hash is configured gets in.
  const tok = 'a-test-token'
  process.env.EDGE_TASK_TOKEN_SHA256 = createHash('sha256').update(tok).digest('hex')
  assert.equal(taskTokenOk(tok), true)
  assert.equal(taskTokenOk('wrong'), false)
  assert.equal(taskTokenOk(''), false)
  delete process.env.EDGE_TASK_TOKEN_SHA256
  assert.equal(taskTokenOk(tok), false)
})

test('the Claude mode: the scheduled task unless an API key is set', () => {
  const keep = { k: process.env.ANTHROPIC_API_KEY, m: process.env.EDGE_CLAUDE }
  delete process.env.ANTHROPIC_API_KEY; delete process.env.EDGE_CLAUDE
  assert.equal(claudeMode(), 'task')
  process.env.ANTHROPIC_API_KEY = 'k'; assert.equal(claudeMode(), 'api')
  process.env.EDGE_CLAUDE = 'task'; assert.equal(claudeMode(), 'task')
  process.env.EDGE_CLAUDE = 'off'; assert.equal(claudeMode(), 'off')
  delete process.env.ANTHROPIC_API_KEY; process.env.EDGE_CLAUDE = 'api'; assert.equal(claudeMode(), 'off')
  if (keep.k == null) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = keep.k
  if (keep.m == null) delete process.env.EDGE_CLAUDE; else process.env.EDGE_CLAUDE = keep.m
})

test('portfolios: quarter Kelly with caps, sized from the night\'s opening bankroll', () => {
  // Kelly for a binary bought at cost c with win probability q: (q - c) / (1 - c).
  close(M.kellyShare(0.10, 0.50), 0.2)
  close(M.kellyShare(0.05, 0.75), 0.2)
  assert.equal(M.kellyShare(-0.01, 0.5), 0)
  assert.equal(M.kellyShare(0.05, 1), 0)

  const cfg = { start: 1000, kellyFraction: 0.25, maxBet: 0.015, maxGame: 0.05 }
  // Night 1, one game. claude_wce: edge 0.04 at cost 0.5 -> quarter Kelly 2% -> capped at 1.5% = $15;
  // edge 0.02 at cost 0.5 -> 1% = $10. Total $25, under the $50 game cap. It wins the first
  // (u = +1: bought at 50c, paid $1) and loses the second.
  const night1 = { key: 'G1', date: '2026-10-21', tip: '2026-10-21T23:00:00Z', bets: [
    ['claude_wce', 'T1', 'yes', 0.04, 0.5, 1],
    ['claude_wce', 'T2', 'no', 0.02, 0.5, -1],
    ['model', 'T3', 'yes', 0.03, 0.4, 'v'],
  ] }
  let pf = M.buildPortfolios([night1], null, cfg)
  close(pf.stakes['G1|claude_wce|T1'].stake, 15)
  close(pf.stakes['G1|claude_wce|T2'].stake, 10)
  close(pf.arms.claude_wce.realized, 1000 + 15 - 10)
  close(pf.arms.model.realized, 1000) // a void returns the stake
  assert.equal(pf.arms.claude_box.equity, 1000)
  assert.deepEqual(pf.closes.map((c) => c.date), ['2026-10-21'])

  // Night 2 sizes from $1,005. Eight bets that each want the 1.5% cap ($15.075) add up to
  // $120.60, past the 5% game cap ($50.25), so all eight shrink by the same factor to ~$6.28.
  const night2 = { key: 'G2', date: '2026-10-22', tip: '2026-10-22T23:00:00Z',
    bets: Array.from({ length: 8 }, (_, i) => ['claude_wce', `U${i}`, 'yes', 0.2, 0.5, null]) }
  pf = M.buildPortfolios([night1, night2], null, cfg)
  close(pf.opens['2026-10-22'].claude_wce, 1005)
  const each = pf.stakes['G2|claude_wce|U0'].stake
  close(each, Math.round(1005 * 0.05 / 8 * 100) / 100)
  // Open and unmarked: held at cost, so equity is the realized balance.
  close(pf.arms.claude_wce.equity, 1005)
  assert.equal(pf.arms.claude_wce.open, 8)
  assert.deepEqual(pf.closes.map((c) => c.date), ['2026-10-21']) // night 2 isn't over

  // Marked live: U0 bought YES at 50c now trades at 80c -> worth 1.6x the stake.
  pf = M.buildPortfolios([night1, night2], new Map([['U0', 0.8]]), cfg)
  close(pf.stakes['G2|claude_wce|U0'].value, Math.round(each / 0.5 * 0.8 * 100) / 100)
  close(pf.arms.claude_wce.unrealized, Math.round((each / 0.5 * 0.8 - each) * 100) / 100, 0.011)
  // A NO bet marks at one minus the YES value.
  const night3 = { key: 'G3', date: '2026-10-22', tip: '2026-10-23T01:00:00Z', bets: [['claude_box', 'W1', 'no', 0.04, 0.6, null]] }
  pf = M.buildPortfolios([night1, night2, night3], new Map([['W1', 0.1]]), cfg)
  close(pf.stakes['G3|claude_box|W1'].mark, 0.9)

  // In a game past its cap, a bigger edge still gets a bigger stake.
  const night4 = { key: 'G4', date: '2026-10-23', tip: '2026-10-23T23:00:00Z', bets: [
    ...Array.from({ length: 10 }, (_, i) => ['model', `S${i}`, 'no', 0.03, 0.5, null]),
    ['model', 'BIG', 'no', 0.09, 0.5, null],
  ] }
  const pf4 = M.buildPortfolios([night4], null, cfg)
  close(pf4.stakes['G4|model|BIG'].stake / pf4.stakes['G4|model|S0'].stake, 3, 0.01)
  assert.ok(Object.values(pf4.stakes).reduce((t, x) => t + x.stake, 0) <= 50.1) // to the cent per bet

  // A stake never moves once bet: replaying with later nights added changes nothing before.
  const again = M.buildPortfolios([night1], null, cfg)
  close(again.stakes['G1|claude_wce|T1'].stake, pf.stakes['G1|claude_wce|T1'].stake)
})

test('portfolios: marks and ledger rows', () => {
  assert.equal(M.markValue({ result: 'yes' }), 1)
  assert.equal(M.markValue({ result: 'no' }), 0)
  close(M.markValue({ bid: 0.4, ask: 0.5 }), 0.45)
  close(M.markValue({ bid: 0, ask: 1, last: 0.3 }), 0.3)
  assert.equal(M.markValue({ bid: 0, ask: 1 }), null)
  assert.deepEqual(M.ledgerRow({ arm: 'model', ticker: 'X', side: 'no', edge: 0.051234, price: 0.4, fee: 0.0168 }), ['model', 'X', 'no', 0.05123, 0.4168, null])
  assert.equal(M.ledgerRow({ arm: 'model', ticker: 'X', side: 'no', edge: 0.05, price: 0.4, fee: 0.0168, result: { outcome: 'void', pnl: 0 } })[5], 'v')
  close(M.ledgerRow({ arm: 'model', ticker: 'X', side: 'no', edge: 0.05, price: 0.4, fee: 0.0168, result: { outcome: 'loss', pnl: -1 } })[5], -1)
})

test('the scheduled task: game files are data only, and the job lives in the task', () => {
  const ix = { min: 0, pts: 1, reb: 2, ast: 3, fg3m: 4 }
  const players = [{ name: 'Bam Adebayo', team: 'MIA', pos: 'Big', log: [[34, 20, 10, 4, 1]], markets: [{ id: 'm1', stat: 'reb', k: 10, pModel: 0.47 }] }]
  const input = { game: { away: 'MIN', home: 'MIA', tip: Date.parse('2026-10-21T23:30:00Z') }, players, ix, teams: [], health: { MIN: [], MIA: [] }, rosters: {} }
  const data = dataText(buildPrompt('claude_box', input))
  assert.match(data, /^GAME DATA/)
  assert.match(data, /m1 REB 10\+/)
  // No job in the file: no rules, no answer path, no tool to use.
  assert.doesNotMatch(data, /You forecast|Write tool|\/tmp\/edge|forecasts"/)
  // The task's own instructions carry the job, the same answer format, and the data format.
  const task = readFileSync(new URL('./task-prompt.md', import.meta.url), 'utf8')
  assert.ok(task.includes(TASK_JOB))
  assert.match(task, /job=edge-queue&format=data/)
  assert.match(task, /never places a bet or an order/)
  assert.match(task, /\{"notes": .*"forecasts": \[\{"id": "m1", "p": 0\.62\}/)
  // The template never holds the real passcode.
  assert.match(task, /\{\{TOKEN\}\}/)
  assert.doesNotMatch(task, /[0-9a-f]{40,}/)
})

test('CLV splits into the market move and the spread paid', () => {
  // YES bought at the 52c ask, quoted 48/52 (mid 50); the close is 58/60 (mid 59).
  const yes = { side: 'yes', price: 0.52, fee: M.takerFee(0.52), bid: 0.48, ask: 0.52 }
  const s = M.settleBet(yes, 1, { bid: 0.58, ask: 0.60 })
  close(s.cost, 0.02); close(s.move, 0.09); close(s.clv, 0.07); close(s.clv, s.move - s.cost)
  // NO bought at 1 - bid = 52c on the same quote; the close moving up is against it.
  const no = { side: 'no', price: 0.52, fee: M.takerFee(0.52), bid: 0.48, ask: 0.52 }
  const n = M.settleBet(no, 1, { bid: 0.58, ask: 0.60 })
  close(n.cost, 0.02); close(n.move, -0.09); close(n.clv, -0.11)
  // No close: CLV and move unknown, the spread paid still known.
  const o = M.settleBet(yes, 0, null)
  assert.equal(o.move, null); close(o.cost, 0.02)
  const agg = M.addBet(M.addBet(M.emptyBetAgg(), s), n)
  const d = M.describeBets(agg)
  close(d.moveMean, 0); close(d.spreadPaid, 0.02); assert.equal(d.moveBets, 2); close(d.moveUpRate, 0.5)
})

test('the information test: how much the arm knows that the market does not', () => {
  // An arm that is the market plus real signal: the result leans toward it, so its weight is positive.
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const sharp = M.emptyFcAgg(), noise = M.emptyFcAgg()
  for (let i = 0; i < 4000; i++) {
    const mkt = 0.2 + 0.6 * rnd()
    const truth = Math.min(0.97, Math.max(0.03, mkt + (rnd() - 0.5) * 0.3))
    const y = rnd() < truth ? 1 : 0
    M.addForecast(sharp, Math.min(0.99, Math.max(0.01, mkt + 0.8 * (truth - mkt))), mkt, y)
    M.addForecast(noise, Math.min(0.99, Math.max(0.01, mkt + (rnd() - 0.5) * 0.3)), mkt, y)
  }
  const a = M.describeForecasts(sharp).info, b = M.describeForecasts(noise).info
  assert.ok(a.weight > 0.7 && a.weight < 1.6 && a.t > 4, JSON.stringify(a))
  assert.ok(Math.abs(b.t) < 3, JSON.stringify(b))
  assert.ok(a.blendSkill > b.blendSkill)
  // The sums add across games like every other field.
  const half = M.emptyFcAgg(); M.mergeFcAgg(half, sharp); M.mergeFcAgg(half, noise)
  close(half.dd, sharp.dd + noise.dd, 1e-9)
})

test('portfolios: a big slate gives each game a smaller share of the night', () => {
  const cfg = { start: 1000, kellyFraction: 0.25, maxBet: 0.015, maxGame: 0.05, maxNight: 0.25 }
  // 10 games, each with ten bets that want the 1.5% cap: 5% per game would put 50% out.
  const games = Array.from({ length: 10 }, (_, g) => ({ key: `G${g}`, date: '2026-10-21', tip: `2026-10-21T2${g % 4}:00:00Z`,
    bets: Array.from({ length: 10 }, (_, i) => ['model', `T${g}-${i}`, 'no', 0.2, 0.5, null]) }))
  let pf = M.buildPortfolios(games, null, cfg)
  close(pf.arms.model.openStake, 250, 0.2) // 25% of $1,000
  // The slate's size, when stored, decides the share: 2 games decided so far of a 10-game slate.
  pf = M.buildPortfolios(games.slice(0, 2).map((g) => ({ ...g, slate: 10 })), null, cfg)
  close(pf.arms.model.openStake, 50, 0.2) // 2.5% each, the same as once all ten are in
  // A small slate keeps the 5% game cap.
  pf = M.buildPortfolios(games.slice(0, 3), null, cfg)
  close(pf.arms.model.openStake, 150, 0.2)
})

test('experiments: the bar rises with every arm tried', () => {
  close(M.graduationBar(1), 1.6449, 1e-3)
  close(M.graduationBar(9), 2.539, 2e-3)
  close(M.graduationBar(20), 2.807, 2e-3)
  assert.ok(M.graduationBar(50) > M.graduationBar(20))
  assert.equal(M.armStanding({ clvBets: 120, clvT: 4 }, 2.5), 'collecting')
  assert.equal(M.armStanding({ clvBets: 320, clvT: 2.6 }, 2.5), 'graduated')
  assert.equal(M.armStanding({ clvBets: 320, clvT: 2.4 }, 2.5), 'no edge yet')
  assert.equal(M.armStanding({ clvBets: 999, clvT: 9 }, 2.5, true), 'retired')
})

test('experiments: rule arms are checked before they are added', () => {
  const ok = { name: 'NO only', hypothesis: 'Kalshi prices the YES side rich, so NO bets beat the close.', success: 'CLV t past the bar over 300 bets.', source: 'claude_box', side: 'no' }
  assert.deepEqual(M.validateRule(ok), [])
  assert.ok(M.validateRule({ ...ok, source: 'gpt' }).length)
  assert.ok(M.validateRule({ ...ok, side: 'over' }).length)
  assert.ok(M.validateRule({ ...ok, stats: ['blk'] }).length)
  assert.ok(M.validateRule({ ...ok, minEdge: 0.08, maxEdge: 0.05 }).length)
  assert.ok(M.validateRule({ ...ok, blend: 'fit', source: 'claude_avg' }).length)
  assert.ok(M.validateRule({ ...ok, hypothesis: 'why not' }).length)
})

test('experiments: rule arms bet on the forecasts already made', () => {
  const mk = (ticker, playerKey, stat, bid, ask) => ({ ticker, playerKey, stat, bid, ask, noAsk: 1 - bid })
  const markets = [mk('A20', 'p1', 'pts', 0.48, 0.52), mk('A25', 'p1', 'pts', 0.28, 0.31), mk('B8', 'p2', 'reb', 0.58, 0.61)]
  const probs = { claude_wce: new Map([['A20', 0.62], ['A25', 0.2], ['B8', 0.45]]), claude_box: new Map([['A20', 0.40], ['A25', 0.22], ['B8', 0.47]]) }
  // Plain source: the best side per player, as for every arm.
  const plain = M.pickRuleBets({ source: 'claude_wce' }, markets, probs)
  assert.equal(plain.length, 2)
  // NO only: never a YES bet.
  assert.ok(M.pickRuleBets({ source: 'claude_wce', side: 'no' }, markets, probs).every((b) => b.side === 'no'))
  // A ceiling on the edge drops the biggest disagreements.
  const capped = M.pickRuleBets({ source: 'claude_wce', maxEdge: 0.06 }, markets, probs)
  assert.ok(capped.every((b) => b.edge <= 0.06))
  // Averaged Claudes: A20 averages to 0.51, no edge at a 52c ask.
  assert.ok(!M.pickRuleBets({ source: 'claude_avg', stats: ['pts'] }, markets, probs).some((b) => b.market.ticker === 'A20' && b.side === 'yes'))
  // A blend with no weight yet takes no bets; with a weight it shrinks toward the market.
  assert.equal(M.pickRuleBets({ source: 'claude_wce', blend: 'fit' }, markets, probs, null).length, 0)
  const half = M.pickRuleBets({ source: 'claude_wce', blend: 'fit' }, markets, probs, 0.5)
  const full = M.pickRuleBets({ source: 'claude_wce' }, markets, probs)
  const e = (xs, t) => xs.find((b) => b.market.ticker === t)?.edge ?? 0
  assert.ok(e(half, 'A20') < e(full, 'A20'))
  // The blend weight: none before 1,000 forecasts, then clamped to 0..1.
  const agg = M.emptyFcAgg()
  for (let i = 0; i < 999; i++) M.addForecast(agg, 0.6, 0.5, i % 3 ? 1 : 0)
  assert.equal(M.blendWeight(agg), null)
  M.addForecast(agg, 0.6, 0.5, 1)
  const w = M.blendWeight(agg)
  assert.ok(w >= 0 && w <= 1)
})

test('experiments: the report-card arm gets Claude + WCE plus its own record, and no prices', () => {
  const ix = { min: 0, pts: 1, reb: 2, ast: 3, fg3m: 4 }
  const players = [{ name: 'Bam Adebayo', team: 'MIA', pos: 'Big', proj: { min: 33, pts: 19, reb: 9.8, ast: 3.6, fg3m: 0.9, fga: 15, fta: 5 }, log: [[34, 20, 10, 4, 1]], markets: [{ id: 'm1', stat: 'reb', k: 10, pModel: 0.47 }] }]
  const reportCard = { own: false, n: 2044, through: 'Oct 22', skill: -0.047, lean: 0.031, calibration: [{ n: 320, predicted: 0.06, actual: 0.04 }], stats: { pts: { n: 600, skill: -0.05, lean: 0.04 } } }
  const input = { game: { away: 'MIN', home: 'MIA', tip: Date.parse('2026-10-21T23:30:00Z') }, players, ix, teams: ['MIA (2025-26): pace 98'], health: { MIN: [], MIA: [] }, rosters: {}, reportCard }
  const rc = buildPrompt('claude_rc', input), wce = buildPrompt('claude_wce', input), box = buildPrompt('claude_box', input)
  assert.ok(rc.startsWith('YOUR TRACK RECORD'))
  assert.ok(rc.endsWith(wce))
  assert.match(rc, /4\.7% worse than the market's price/)
  assert.doesNotMatch(wce + box, /TRACK RECORD/)
  // Nothing in the card is a price from tonight, and nothing in it is an instruction to use a tool.
  assert.doesNotMatch(rc.split('\n\n')[0], /¢|ask|bid|Write|Read|tool|http/i)
})

test('the researcher: its template never holds a passcode, and its calls match the site', () => {
  const t = readFileSync(new URL('./research-prompt.md', import.meta.url), 'utf8')
  assert.match(t, /\{\{TOKEN\}\}/)
  assert.doesNotMatch(t, /[0-9a-f]{40,}/)
  assert.match(t, /job=edge-review/)
  assert.match(t, /job=edge-arm/)
  assert.match(t, /x-edge-research/)
  assert.match(t, /Never add a Claude arm/)
  for (const f of ['source', 'side', 'stats', 'minEdge']) assert.match(t, new RegExp(`"${f}"`))
})

test('the morning email: its template never holds a passcode, and it can only read', () => {
  const t = readFileSync(new URL('./digest-prompt.md', import.meta.url), 'utf8')
  assert.match(t, /\{\{TOKEN\}\}/)
  assert.doesNotMatch(t, /[0-9a-f]{40,}/)
  assert.match(t, /job=edge-review&nights=N/)
  assert.doesNotMatch(t, /edge-arm|edge-answer|edge-queue/)
  assert.match(t, /x-edge-digest/)
})
