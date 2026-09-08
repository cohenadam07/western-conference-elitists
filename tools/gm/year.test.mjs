// The shape of a year: chapters, negotiation, development, and a postseason that takes
// longer than one click.
//
//   node tools/gm/year.test.mjs
import { SEED } from '../../src/lib/gm/seed.js'
import { setLeague, newLeague, rostersOf } from '../../src/lib/gm/league.js'
import { newCareer } from '../../src/lib/gm/storage.js'
import { PHASES, chapterOf, nextPhase } from '../../src/lib/gm/phase.js'
import { makePersonality, Negotiation, rivalOffers, appealOf } from '../../src/lib/gm/fa.js'
import { developmentReport, developmentOf, expectedGain } from '../../src/lib/gm/offseason.js'
import { newSeason, playNext } from '../../src/lib/gm/season.js'
import {
  openBracket, stepBracket, playRound, playThisSeries, bracketResult, roundSeries,
  ROUNDS, roundName, teamRun,
} from '../../src/lib/gm/playoffs.js'
import { rng } from '../../src/lib/gm/sim.js'
import { simOf } from '../../src/lib/gm/league.js'
import { generateClass } from '../../src/lib/gm/draft.js'
import { enrich } from '../../src/lib/gm/prospects.js'
import {
  minutesDevelopment, rookieContract, labelRookie, youthPenalty, volatilityFor,
} from '../../src/lib/gm/offseason.js'
import { formFor } from '../../src/lib/gm/form.js'
import { rotationOrder, rebalance, rotationAdvice } from '../../src/lib/gm/rotation.js'
import { advisor, topNeeds, NEED_WEIGHT_FLOOR } from '../../src/lib/gm/advisor.js'
import { savantProfile, findPlayer, percentile, rotationSize } from '../../src/lib/gm/savant.js'
import { mandateFor } from '../../src/lib/gm/storage.js'
import { COACHING } from '../../src/lib/gm/phase.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
setLeague(newLeague('2026-27'))
const save = newCareer({ gm: { name: 'T' }, team: 'BOS', preset: 'guided',
  levels: { ...SEED.presets.guided.levels }, seed: 808 })

console.log('— every turn of the calendar is a chapter —')
{
  let missing = []
  for (let i = 0; i < PHASES.length - 1; i++) {
    const from = PHASES[i], to = nextPhase(from.key)
    if (!to) continue
    const ch = chapterOf(save, from.key, to.key, { record: '30–20', games: 50 })
    if (!ch) { missing.push(from.key); continue }
    if (!ch.closing || !ch.opening || !ch.blurb) missing.push(`${from.key}:thin`)
  }
  check('there is a card for every phase change', missing.length === 0, missing.join(','))
  const ch = chapterOf(save, 'camp', 'preseason', { trades: 3, emphasis: 'shooting' })
  check('it names what is closing and what is opening',
    ch.closing === 'Training camp' && ch.opening === 'Preseason')
  check('it carries the dates', !!ch.closingDate && !!ch.openingDate)
  check('and facts you could check', ch.closed.some((f) => /3 trades made/.test(f)),
    ch.closed.join(' · '))
  check('the payroll position is always on it', ch.closed.some((f) => /Payroll/.test(f)))
  check('it briefs the next chapter', ch.asks.length > 0, `${ch.asks.length}`)
  check('chapters are numbered and keep counting across seasons',
    chapterOf({ ...save, records: { ...save.records, seasonsCompleted: 2 } }, 'camp', 'preseason', {}).n
      > chapterOf(save, 'camp', 'preseason', {}).n)
  const end = chapterOf(save, 'postseason', 'review', { champion: 'Celtics' })
  check('the year ends with the champion on the card', end.closed.some((f) => /Celtics won/.test(f)),
    end.closed.join(' · '))
}

console.log('\n— a lowball lands differently every time —')
{
  const lines = new Set()
  const drivers = new Set()
  for (let i = 0; i < 40; i++) {
    const p = makePersonality(rng(500 + i), 24 + (i % 12))
    const n = new Negotiation({ name: `P${i}`, market: 20e6, personality: p, teamWins: 41, r: rng(9 + i) })
    drivers.add(n.driver)
    const res = n.offer({ aav: 6e6, years: 2, incumbent: true })
    check.silent = true
    lines.add(res.message)
  }
  check('forty lowballs do not produce one sentence', lines.size > 8, `${lines.size} distinct`)
  check('and players differ in what drives them', drivers.size >= 3, [...drivers].join(','))

  // The same man, lowballed three times, should not repeat himself.
  const p = makePersonality(rng(3), 27)
  const n = new Negotiation({ name: 'Q', market: 20e6, personality: p, teamWins: 41, r: rng(11) })
  const said = [n.offer({ aav: 6e6, years: 2 }).message, n.offer({ aav: 6e6, years: 2 }).message]
  check('the same player does not repeat himself', said[0] !== said[1], said.join(' // '))
  check('the reaction names who said it', /—/.test(said[0]))
  check('a lowball is reported as an insult, not a counter',
    n.offer({ aav: 5e6, years: 2 }).result !== 'counter')

  // Where the insult line sits depends on the man and the team.
  const moneyFirst = makePersonality(rng(1), 30)
  moneyFirst.weights = { money: 0.7, years: 0.06, role: 0.06, contention: 0.06, market: 0.06, loyalty: 0.06 }
  const ringFirst = { ...moneyFirst, weights: { money: 0.1, years: 0.1, role: 0.1, contention: 0.5, market: 0.1, loyalty: 0.1 } }
  const a = new Negotiation({ name: 'A', market: 20e6, personality: moneyFirst, teamWins: 60, r: rng(2) })
  const b = new Negotiation({ name: 'B', market: 20e6, personality: ringFirst, teamWins: 60, r: rng(2) })
  check('a money-first player is insulted sooner', a.insultLine > b.insultLine,
    `${a.insultLine.toFixed(2)} vs ${b.insultLine.toFixed(2)}`)
  const bLose = new Negotiation({ name: 'B', market: 20e6, personality: ringFirst, teamWins: 20, r: rng(2) })
  check('and the same man is harder to please on a bad team', bLose.insultLine > b.insultLine,
    `${bLose.insultLine.toFixed(2)} vs ${b.insultLine.toFixed(2)}`)
}

console.log('\n— winning makes a player want to stay —')
{
  const rate = (wins, rank) => {
    let signed = 0
    for (let i = 0; i < 300; i++) {
      const p = makePersonality(rng(1000 + i), 26 + (i % 9))
      const r = rng(7 + i)
      const ranks = {}
      Object.keys(SEED.teams).forEach((t, j) => { ranks[t] = 1 + j })
      ranks.BOS = rank
      const rivals = rivalOffers({ team: 'BOS' }, 20e6, r, ranks)
      const neg = new Negotiation({ name: 'P', market: 20e6, personality: p, teamWins: wins, r, rivals })
      const res = neg.offer({ aav: neg.ask, years: 3, role: 0.62, ...appealOf('BOS', ranks), incumbent: true })
      if (res.result === 'signed') signed++
    }
    return signed / 300
  }
  const bad = rate(22, 2), mid = rate(41, 15), good = rate(62, 29)
  check('a contender keeps more of its own than a bad team does', good > bad + 0.3,
    `${(good * 100).toFixed(0)}% vs ${(bad * 100).toFixed(0)}%`)
  check('and it runs in order', good >= mid && mid >= bad,
    `${(bad * 100).toFixed(0)} / ${(mid * 100).toFixed(0)} / ${(good * 100).toFixed(0)}`)
  check('your own club is priced like the twenty-nine, not at a flat 0.5',
    JSON.stringify(appealOf('BOS', { BOS: 29 })) !== JSON.stringify(appealOf('BOS', { BOS: 2 })))
}

console.log('\n— the year is measured against the age, not against last year —')
{
  // Checked against the measured buckets the curve was fitted to, not against a feeling.
  const MEASURED = [[20, 0.47], [23, 0.31], [27.5, -0.12], [32, -0.28]]
  const off = MEASURED.map(([a2, m]) => Math.abs(expectedGain(a2) - m))
  check('the curve matches what the aging engine actually does', Math.max(...off) < 0.12,
    MEASURED.map(([a2, m], i) => `${a2}: ${expectedGain(a2).toFixed(2)} vs ${m} (${off[i].toFixed(2)})`).join(' · '))
  check('a twenty-year-old is expected to gain', expectedGain(20) > 0.3, `${expectedGain(20)}`)
  check('a thirty-five-year-old is expected to lose', expectedGain(35) < -0.25, `${expectedGain(35)}`)
  check('it crosses zero around twenty-six and a half',
    expectedGain(26) > 0 && expectedGain(28) < 0,
    `${expectedGain(26).toFixed(2)} / ${expectedGain(28).toFixed(2)}`)

  const flat21 = developmentOf({ a: 21, v: 1 }, { a: 22, v: 1 })
  check('a young player standing still has regressed', flat21.key === 'down' || flat21.key === 'cliff',
    flat21.key)
  const flat34 = developmentOf({ a: 34, v: 3 }, { a: 35, v: 3 })
  check('an old player standing still has improved', flat34.key === 'up' || flat34.key === 'leap',
    flat34.key)
  check('every verdict carries a mark and a tone',
    ['leap', 'up', 'flat', 'down', 'cliff'].every((k) => {
      const d = developmentOf({ a: 27, v: 2 }, { a: 28, v: 2 })
      return d.mark && d.tone && d.label
    }))

  const before = rostersOf('BOS')
  const after = before.map((p, i) => ({ ...p, a: (p.a ?? 26) + 1, v: (p.v ?? 0) + (i % 3 === 0 ? 1.2 : -0.4) }))
  const rep = developmentReport(before, after.slice(0, before.length - 1))
  check('the report covers the whole roster', rep.rows.length === before.length, `${rep.rows.length}`)
  check('it is sorted best first', rep.rows[0].rel >= (rep.rows[1].rel ?? -99))
  check('it counts risers and fallers', rep.risers > 0 && rep.fallers > 0,
    `${rep.risers}/${rep.fallers}`)
  check('and it notices who is gone', rep.departed.length === 1, rep.departed.join(','))
  check('the best and worst are named', !!rep.best && !!rep.worst)
}

console.log('\n— the postseason is an event —')
{
  const st = newSeason(4321)
  playNext(st, st.schedule.length)
  const b = openBracket(st)
  check('opening the bracket plays nothing', b.series.every((s) => s.games.length === 0))
  check('it opens on the play-in', b.stage === 'playin')
  check('with both conferences separate', new Set(b.series.map((s) => s.conf)).size === 2)

  const stages = [b.stage]
  let games = 0
  while (b.stage !== 'done' && games < 400) {
    const before = b.stage
    stepBracket(b)
    games++
    if (b.stage !== before) stages.push(b.stage)
  }
  check('it takes a whole postseason of games, not a click', games > 60, `${games} games`)
  check('and it passes through every named round',
    stages.join(',') === 'playin,r1,r2,cf,finals,done', stages.join(','))
  const res = bracketResult(b)
  check('the rounds are named the way the league names them',
    res.rounds.some((r) => r.name === 'Conference quarterfinals')
    && res.rounds.some((r) => r.name === 'Conference semifinals')
    && res.rounds.some((r) => r.name === 'Conference finals')
    && res.rounds.some((r) => r.name === 'NBA Finals'),
    [...new Set(res.rounds.map((r) => r.name))].join(' | '))
  check('there is exactly one Finals', res.rounds.filter((r) => r.name === 'NBA Finals').length === 1)
  check('the Finals are East against West',
    res.conf.East !== res.conf.West && !!res.conf.East && !!res.conf.West)
  check('a champion is crowned', !!res.champion)
  check('every series goes to a winner', res.rounds.every((r) => !!r.winner))
  check('no series runs past seven', res.rounds.every((r) => r.games.length <= 7))
  check('the winner of a series won more games',
    res.rounds.every((r) => r.w[r.winner] > r.w[r.winner === r.hi ? r.lo : r.hi]))
  check('the record book can still read it', teamRun(res, res.champion).champion === true)
  check('fifteen series in a bracket', res.rounds.length === 15, `${res.rounds.length}`)

  // Three ways to play it, one answer.
  const byRound = openBracket(st)
  let g2 = 0
  while (byRound.stage !== 'done' && g2++ < 20) playRound(byRound)
  check('playing round by round gives the same champion',
    bracketResult(byRound).champion === res.champion,
    `${bracketResult(byRound).champion} vs ${res.champion}`)
  const bySeries = openBracket(st)
  let g3 = 0
  while (bySeries.stage !== 'done' && g3++ < 200) {
    const open = roundSeries(bySeries, bySeries.stage).filter((s) => !s.winner)
    if (!open.length) { stepBracket(bySeries); continue }
    playThisSeries(bySeries, open[0])
  }
  check('and so does playing it series by series',
    bracketResult(bySeries).champion === res.champion,
    `${bracketResult(bySeries).champion} vs ${res.champion}`)

  check('every round has a name and a line of its own',
    ROUNDS.every((r) => r.name && r.short && r.blurb))
  check('the play-in is a round in its own right', ROUNDS[0].key === 'playin')
  check('roundName answers for a key', roundName('cf') === 'Conference finals')
}

console.log('\n— the rotation is a budget, not a puzzle —')
{
  const bandOf = (p) => ({ key: p.band })
  const ratePerMin = (p) => p.rate ?? 0
  const roster = Array.from({ length: 14 }, (_, i) => ({
    n: `P${i}`, uid: `u${i}`, a: 26, av: 82, mpg: 20, rate: 14 - i,
    band: i < 5 ? 'guard' : i < 10 ? 'wing' : 'big',
  }))
  let mins = {}
  roster.forEach((p, i) => { mins[p.uid] = i < 5 ? 34 : i < 9 ? 17 : 0 })
  const total = (m) => Object.values(m).reduce((s, x) => s + (x || 0), 0)

  // The bug: the list was sorted by live minutes, so dragging re-sorted the rows under the
  // cursor and you moved somebody else.
  const o1 = rotationOrder(roster, bandOf, ratePerMin).map((p) => p.uid)
  rebalance(mins, roster, 'u0', 12)
  const o2 = rotationOrder(roster, bandOf, ratePerMin).map((p) => p.uid)
  check('the order does not depend on the minutes at all', o1.join() === o2.join(),
    `${o1.slice(0, 4).join()} vs ${o2.slice(0, 4).join()}`)
  check('and it is grouped by band', (() => {
    const bands = rotationOrder(roster, bandOf, ratePerMin).map((p) => p.band)
    return bands.join(',') === bands.slice().sort((a, b) =>
      ['guard', 'wing', 'big'].indexOf(a) - ['guard', 'wing', 'big'].indexOf(b)).join(',')
  })())

  let m2 = { ...mins }
  for (const v of [38, 20, 0, 30, 12, 38]) {
    m2 = rebalance(m2, roster, 'u0', v)
    if (total(m2) !== 240) { check('every move lands exactly on 240', false, `${v} -> ${total(m2)}`); break }
    if (m2.u0 !== v) { check('the man you dragged gets what you asked for', false, `${v} -> ${m2.u0}`); break }
  }
  check('every move lands exactly on 240', total(m2) === 240, `${total(m2)}`)
  check('the man you dragged gets what you asked for', m2.u0 === 38, `${m2.u0}`)
  check('nobody is pushed past the maximum', Object.values(m2).every((x) => x <= 38))
  check('and nobody goes negative', Object.values(m2).every((x) => x >= 0))
  check('the bench does not creep into the rotation',
    roster.slice(9).every((p) => (m2[p.uid] || 0) === 0),
    roster.slice(9).map((p) => m2[p.uid]).join(','))

  const locked = new Set(['u1', 'u2'])
  const kept = { ...m2 }
  const m3 = rebalance(m2, roster, 'u0', 10, locked)
  check('pinned players do not move', m3.u1 === kept.u1 && m3.u2 === kept.u2,
    `${kept.u1}->${m3.u1}, ${kept.u2}->${m3.u2}`)
  check('and the budget still balances around them', total(m3) === 240, `${total(m3)}`)

  const adv = rotationAdvice(m3, roster, [], bandOf, ratePerMin)
  check('the screen says what is wrong in words', adv.notes.length > 0)
  check('it counts the minutes by band',
    adv.bands.guard + adv.bands.wing + adv.bands.big === 240,
    JSON.stringify(adv.bands))
  // The most common real mistake, named.
  const lopsided = rebalance(m3, roster, 'u0', 6)
  const adv2 = rotationAdvice(lopsided, roster, [], bandOf, ratePerMin)
  check('it notices when your best player is not playing the most',
    adv2.notes.some((n) => /best player on the floor per minute/.test(n.text)),
    adv2.notes.map((n) => n.text.slice(0, 40)).join(' | '))
}

console.log('\n— the advisor answers "what do I do to be good" —')
{
  setLeague(newLeague('2026-27'))
  const seen = { labels: new Set(), items: new Set(), grades: new Set() }
  let stuckFound = false, apronFound = false, shortFound = false, hoardFound = false
  for (const t of Object.keys(SEED.teams)) {
    const sv = newCareer({ gm: { name: 'T' }, team: t, preset: 'guided',
      levels: { ...SEED.presets.guided.levels, rotations: 'manual' }, seed: 500 })
    const a = advisor(sv, { phase: 'offseason' })
    seen.labels.add(a.ctx.label)
    a.items.forEach((i) => seen.items.add(i.key))
    a.grades.list.forEach((g) => seen.grades.add(g.grade))
    if (a.items.some((i) => i.key === 'stuck')) stuckFound = true
    if (a.items.some((i) => i.key === 'apron2')) apronFound = true
    if (a.items.some((i) => i.key === 'short')) shortFound = true
    if (a.items.some((i) => i.key === 'hoard')) hoardFound = true

    // Nothing may be silent, wordless, or unactionable.
    for (const i of a.items) {
      if (!i.title || !i.fact || !i.tell || !i.read) {
        check('every item has both voices and a fact', false, `${t}/${i.key}`)
      }
    }
    for (const g of a.grades.list) {
      if (!g.fact || !g.why || !g.lever) check('every grade explains itself', false, `${t}/${g.key}`)
    }
  }
  check('every item has both voices and a fact', true)
  check('every grade explains itself', true)
  check('the league reads as more than one kind of team', seen.labels.size >= 4,
    [...seen.labels].join(', '))
  check('and the grades are not all the same letter', seen.grades.size >= 4, [...seen.grades].join(','))
  check('somebody is expensive and not contending', stuckFound)
  check('somebody is stuck above the second apron', apronFound)
  check('somebody is short of the roster minimum', shortFound)
  check('and a contender is told to spend its picks', hoardFound)

  // The mandate has to be one a sane owner would set.
  const byMandate = {}
  for (const t of Object.keys(SEED.teams)) {
    const m = mandateFor(t)
    byMandate[m] = (byMandate[m] || 0) + 1
  }
  check('mandates are set from the roster, not from a constant',
    Object.keys(byMandate).length >= 3, JSON.stringify(byMandate))
  check('and nobody good is told to tank', mandateFor('OKC') === 'title', mandateFor('OKC'))
  check('nor anybody bad told to contend',
    ['develop', 'playoffs'].includes(mandateFor('WAS')), mandateFor('WAS'))

  // Needs must be informative: an axis the fit model does not weight is not a need.
  const sv = newCareer({ gm: { name: 'T' }, team: 'PHX', preset: 'guided',
    levels: { ...SEED.presets.guided.levels }, seed: 4 })
  const a = advisor(sv, { phase: 'offseason' })
  check('a deficit on an axis the model ignores is not reported as a need',
    topNeeds(a.ctx, 5).every((n) => n.weight >= NEED_WEIGHT_FLOOR),
    topNeeds(a.ctx, 5).map((n) => `${n.label} w${n.weight.toFixed(2)}`).join(', '))
  const spread = {}
  for (const t of Object.keys(SEED.teams)) {
    const n = topNeeds(advisor(newCareer({ gm: { name: 'T' }, team: t, preset: 'guided',
      levels: { ...SEED.presets.guided.levels }, seed: 1 }), { phase: 'offseason' }).ctx, 1)[0]
    if (n) spread[n.key] = (spread[n.key] || 0) + 1
  }
  check('needs differ across the league rather than naming one axis every time',
    Object.keys(spread).length >= 3, JSON.stringify(spread))

  check('the verdict is one readable line', /projected wins/.test(a.verdict), a.verdict)
  check('every phase has a line on what good looks like',
    PHASES.every((ph) => !!COACHING[ph.key]),
    PHASES.filter((ph) => !COACHING[ph.key]).map((ph) => ph.key).join(','))
}

console.log('\n— the player page —')
{
  setLeague(newLeague('2026-27'))
  const found = findPlayer('Jayson Tatum')
  check('a player resolves by name from anywhere in the league', !!found && found.team === 'BOS',
    found?.team)
  const byUid = findPlayer(found.cap.uid)
  check('and by id', byUid?.cap.n === 'Jayson Tatum')
  check('an unknown name resolves to nothing rather than throwing', findPlayer('Nobody At All') === null)

  const pr = savantProfile(found.cap, found.sim, found.team)
  check('the page has all three columns',
    pr.offense.length > 6 && pr.defense.length > 3 && pr.value.length >= 4,
    `${pr.offense.length}/${pr.defense.length}/${pr.value.length}`)
  check('every row carries a number, not just a percentile',
    [...pr.offense, ...pr.defense, ...pr.value].every((r) => r.v !== undefined))
  check('percentiles are in range',
    [...pr.offense, ...pr.defense, ...pr.value]
      .every((r) => r.p === null || (r.p >= 0 && r.p <= 100)))

  // Percentiles are against the ROTATION. Including twelfth men drags every distribution
  // down and hands ordinary starters eightieth percentiles.
  check('the comparison set is the league rotation, not every contract',
    rotationSize() > 300 && rotationSize() < 460, `${rotationSize()}`)

  // Turnovers scored the wrong way round would praise a player for his worst trait.
  const clean = percentile((r) => r.sim?.tov, 0.06, true)
  const loose = percentile((r) => r.sim?.tov, 0.18, true)
  check('a low turnover rate scores better than a high one', clean > loose, `${clean} vs ${loose}`)

  // Comps come from Savant now rather than from a nine-axis distance computed here — nine
  // dimensions could not tell two big men apart, which is why the section read badly.
  check('comps come back and are not the player himself',
    pr.comps.length >= 3 && pr.comps.every((c) => c.name !== 'Jayson Tatum'),
    pr.comps.map((c) => `${c.name} ${c.similarity}%`).join(', '))
  check('comps are ordered by similarity',
    pr.comps.every((c, i) => i === 0 || c.similarity <= pr.comps[i - 1].similarity),
    pr.comps.map((c) => c.similarity).join(','))
  check('and a comp resolves to a real player page',
    !!savantProfile(pr.comps[0].cap, null, pr.comps[0].team))

  check('the projection runs five years out', (pr.projection || []).length === 5,
    `${(pr.projection || []).length}`)
  check('a page can be built for a player with no simulation profile',
    !!savantProfile(found.cap, null, found.team))

  // Every rotation player in the league must produce a page without throwing.
  let broke = null
  for (const t of Object.keys(SEED.teams)) {
    for (const c of rostersOf(t)) {
      try { savantProfile(c, null, t) } catch (e) { broke = `${c.n}: ${e.message}`; break }
    }
    if (broke) break
  }
  check('every player in the league has a page', !broke, broke || '')
}

console.log('\n— a slider moves one player and nobody else —')
{
  const bandOf = (p) => ({ key: p.band })
  const roster = Array.from({ length: 12 }, (_, i) => ({
    n: `P${i}`, uid: `u${i}`, a: 26, av: 82, mpg: 20, band: i < 5 ? 'guard' : i < 9 ? 'wing' : 'big',
  }))
  const mins = {}
  roster.forEach((p, i) => { mins[p.uid] = i < 5 ? 34 : i < 9 ? 17 : 0 })
  // What the screen now does: set one key, leave the rest alone.
  const direct = { ...mins, u0: 12 }
  check('the other players do not move', roster.slice(1).every((p) => direct[p.uid] === mins[p.uid]))
  check('and the total is allowed to be wrong',
    Object.values(direct).reduce((a2, b) => a2 + b, 0) !== 240)
  // And the button that fixes it is still there.
  const evened = rebalance(direct, roster, 'u1', direct.u1)
  check('evening out puts it back on 240',
    Object.values(evened).reduce((a2, b) => a2 + b, 0) === 240,
    `${Object.values(evened).reduce((a2, b) => a2 + b, 0)}`)
}

console.log('\n— minutes develop young players —')
{
  const r = rng(4)
  const at = (age, mpg) => {
    let t = 0
    for (let i = 0; i < 400; i++) t += minutesDevelopment(age, mpg, rng(i))
    return t / 400
  }
  check('heavy minutes help a twenty-year-old', at(20, 34) > 0.12, at(20, 34).toFixed(3))
  check('and thin minutes cost him', at(20, 8) < 0, at(20, 8).toFixed(3))
  check('the effect shrinks with age',
    at(20, 34) > at(23, 34) && at(23, 34) > at(25, 34),
    `${at(20, 34).toFixed(2)} / ${at(23, 34).toFixed(2)} / ${at(25, 34).toFixed(2)}`)
  check('and is gone by twenty-seven', Math.abs(at(28, 34)) < 0.001, at(28, 34).toFixed(3))
  check('it is modest, not a cheat code', at(20, 38) < 0.5, at(20, 38).toFixed(3))
  // Randomness both ways: the same player and the same minutes are not the same answer.
  const draws = Array.from({ length: 200 }, (_, i) => minutesDevelopment(21, 32, rng(i)))
  check('the same minutes do not always buy the same jump',
    new Set(draws.map((x) => x.toFixed(2))).size > 20, `${new Set(draws.map((x) => x.toFixed(2))).size} distinct`)
  check('and heavy minutes sometimes buy nothing at all', draws.some((x) => x <= 0),
    `${draws.filter((x) => x <= 0).length} of 200`)
}

console.log('\n— young players play like young players —')
{
  const r = rng(9)
  const cls = enrich(generateClass(r, 60, 2027), r)
  const young = cls.filter((x) => (x.age ?? 20) <= 19.5)
  const older = cls.filter((x) => (x.age ?? 20) >= 21.5)
  const mk = (pr, pick) => labelRookie(rookieContract(pr, pick, rng(pick + Math.round(pr.age * 10))))
  const meanOf = (list, f) => list.reduce((s2, x) => s2 + f(x), 0) / (list.length || 1)
  const yd = meanOf(young.map((x) => mk(x, 8)), (e) => e.sim.dp)
  const od = meanOf(older.map((x) => mk(x, 8)), (e) => e.sim.dp)
  check('a nineteen-year-old defends worse than a twenty-two-year-old', yd < od - 3,
    `${yd.toFixed(1)} vs ${od.toFixed(1)}`)
  const yt = meanOf(young.map((x) => mk(x, 8)), (e) => e.sim.tov)
  const ot = meanOf(older.map((x) => mk(x, 8)), (e) => e.sim.tov)
  check('and gives it away more often', yt > ot + 0.005, `${yt.toFixed(3)} vs ${ot.toFixed(3)}`)
  check('the youth penalty is full at nineteen and gone by twenty-four',
    youthPenalty(19) === 1 && youthPenalty(24) === 0)

  // Upside must actually come off the prospect, not off a constant.
  const ups = cls.map((x) => mk(x, 8).cap.upside)
  check('upside is read from the draft model', new Set(ups.map((u) => u.toFixed(2))).size > 10,
    `${new Set(ups.map((u) => u.toFixed(2))).size} distinct`)
  const best = cls.slice().sort((a2, b) => b._u - a2._u)[0]
  check('and the best prospect in the class has the highest of it',
    mk(best, 1).cap.upside > 0.8, `${mk(best, 1).cap.upside.toFixed(2)}`)

  // Volatility: swing for the young and the high-upside, steadiness for the rest.
  const swingy = volatilityFor({ a: 19, upside: 0.95, floor: 0.15 }, { usg: 0.26 })
  const safe = volatilityFor({ a: 19, upside: 0.5, floor: 0.85 }, { usg: 0.26 })
  const vet = volatilityFor({ a: 30 }, { usg: 0.20 })
  check('a high-upside teenager swings hardest', swingy > safe && swingy > vet,
    `${swingy} vs ${safe} vs ${vet}`)
  check('a high-floor prospect is steadier than a swing', safe < swingy, `${safe} vs ${swingy}`)
  check('and a settled veteran is steadier than either young player', vet < safe, `${vet} vs ${safe}`)
  check('volatility stays inside sane bounds',
    [swingy, safe, vet].every((v) => v >= 0.55 && v <= 2.2))

  // The league is built with volatility on every profile, and it tracks age.
  setLeague(newLeague('2026-27'))
  const all = Object.keys(SEED.teams).flatMap((t) => rostersOf(t)
    .map((c, i) => ({ c, v: (simOf(t)[i] || {}).vol })))
  check('every profile in the league carries one', all.every((x) => typeof x.v === 'number'))
  const mv = (f) => { const l = all.filter(f); return l.reduce((s2, x) => s2 + x.v, 0) / l.length }
  check('and the young swing more than the old',
    mv((x) => (x.c.a ?? 26) <= 22) > mv((x) => (x.c.a ?? 26) >= 30) + 0.15,
    `${mv((x) => (x.c.a ?? 26) <= 22).toFixed(2)} vs ${mv((x) => (x.c.a ?? 26) >= 30).toFixed(2)}`)
}

console.log('\n— and form is applied outside the engine —')
{
  // The engine must stay a pure function of what it is handed: the server replays a claimed
  // season against Basketball-Savant's Python engine and the two agree draw for draw.
  const prof = { id: 'x', n: 'X', mpg: 30, load: 14, usg: 0.25, fg3r: 0.4, fg3: 0.36,
    fg2: 0.52, ft: 0.8, ftr: 0.25, tov: 0.11, oreb: 0.03, dreb: 0.15, ast: 0.2,
    dr: 50, dp: 50, de: 50, vol: 1.6 }
  const nights = Array.from({ length: 40 }, (_, i) => formFor(prof, i * 7919))
  check('a night differs from the profile', nights.some((n) => n.fg3 !== prof.fg3))
  check('and from other nights', new Set(nights.map((n) => n.fg3.toFixed(4))).size > 20,
    `${new Set(nights.map((n) => n.fg3.toFixed(4))).size} distinct`)
  check('the same night twice is the same night',
    formFor(prof, 12345).fg3 === formFor(prof, 12345).fg3)
  check('defence does not swing by the evening',
    nights.every((n) => n.dp === prof.dp && n.dr === prof.dr))
  check('usage swings harder than efficiency, because volume is what makes a big night',
    Math.max(...nights.map((n) => Math.abs(n.usg / prof.usg - 1)))
      > Math.max(...nights.map((n) => Math.abs(n.fg3 / prof.fg3 - 1))))
  const steady = { ...prof, vol: 0.7 }
  const sd = (v) => { const m = v.reduce((a2, b) => a2 + b, 0) / v.length
    return Math.sqrt(v.reduce((s2, x) => s2 + (x - m) ** 2, 0) / v.length) }
  const swing = sd(nights.map((n) => n.usg))
  const calm = sd(Array.from({ length: 40 }, (_, i) => formFor(steady, i * 7919).usg))
  check('a volatile player swings further than a steady one', swing > calm * 1.5,
    `${swing.toFixed(4)} vs ${calm.toFixed(4)}`)
  check('a profile with no volatility is returned untouched',
    formFor({ n: 'Y', fg3: 0.35 }, 5).fg3 === 0.35)
}

console.log(`\n${pass}/${pass + fail} checks pass`)
process.exit(fail ? 1 : 0)
