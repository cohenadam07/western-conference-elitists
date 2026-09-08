// The real pick ledger, protections, swaps, the open market, and shopping a package.
//
//   node tools/gm/picks.test.mjs
import { SEED } from '../../src/lib/gm/seed.js'
import { setLeague, newLeague, rostersOf, allRosters } from '../../src/lib/gm/league.js'
import { newCareer } from '../../src/lib/gm/storage.js'
import { REAL_LEDGER, SWAP_GROUPS } from '../../src/lib/gm/pickData.js'
import {
  newPickLedger, rebuildLedger, allPicks, ownedBy, movePick, pickKey, pickValue,
  conveyanceOdds, landsInRange, strengthRanks, describePick, rollProtection, violatesStepien,
} from '../../src/lib/gm/picks.js'
import {
  seedPool, exceptionsFor, canSign, signFromPool, waiveToPool, rosterCheck,
  cpuFillFromPool, poolIsClean, MIN_SALARY, MIN_ROSTER,
} from '../../src/lib/gm/pool.js'
import { shopPackage } from '../../src/lib/gm/trade/negotiate.js'
import { applyTrade } from '../../src/lib/gm/trades.js'
import { rng } from '../../src/lib/gm/sim.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const TEAMS = Object.keys(SEED.teams)
setLeague(newLeague('2026-27'))
const ranks = strengthRanks(null)

console.log('— the dataset describes every pick exactly once —')
{
  const years = Object.keys(REAL_LEDGER)
  check('five drafts are covered', years.length === 5, years.join(','))
  let missing = []
  for (const y of years) for (const r of [1, 2]) for (const t of TEAMS) {
    if (!REAL_LEDGER[y][r][t]) missing.push(`${y}/${r}/${t}`)
  }
  check('every team has a line in every round of every year', missing.length === 0,
    missing.slice(0, 5).join(' '))
  // Every group a spec points at must exist, and must hand out exactly as many picks as
  // it pools — an assign list one short would silently vanish a first-round pick.
  const refs = new Set()
  for (const y of years) for (const r of [1, 2]) for (const t of TEAMS) {
    const sp = REAL_LEDGER[y][r][t]
    const m = /@(\w+)/.exec(sp)
    if (m) refs.add(m[1])
  }
  const orphans = [...refs].filter((g) => !SWAP_GROUPS[g])
  check('every swap group referenced exists', orphans.length === 0, orphans.join(','))
  const wrong = Object.entries(SWAP_GROUPS)
    .filter(([, g]) => g.pool.length !== g.assign.length)
    .map(([k]) => k)
  check('every swap group deals out as many picks as it pools', wrong.length === 0, wrong.join(','))
  const badTeam = Object.entries(SWAP_GROUPS)
    .flatMap(([k, g]) => [...g.pool, ...g.assign].filter((t) => !SEED.teams[t]).map((t) => `${k}:${t}`))
  check('every team code in a group is a real club', badTeam.length === 0, badTeam.slice(0, 4).join(' '))
}

console.log('\n— and the ledger built from it balances —')
{
  const real = rebuildLedger(newPickLedger('2026-27', { real: true }), ranks)
  const held = TEAMS.reduce((n, t) => n + ownedBy(real, t).length, 0)
  const forfeited = allPicks(real).filter((p) => p.forfeit).length
  check('three hundred picks, all accounted for', held + forfeited === 300, `${held} + ${forfeited}`)
  check('some are forfeited outright', forfeited > 0, `${forfeited}`)
  check('ownership is nothing like even', new Set(TEAMS.map((t) => ownedBy(real, t).length)).size > 4)
  const most = TEAMS.slice().sort((a, b) => ownedBy(real, b).length - ownedBy(real, a).length)
  check('the biggest hoard is much bigger than the smallest',
    ownedBy(real, most[0]).length >= ownedBy(real, most[29]).length * 2,
    `${most[0]} ${ownedBy(real, most[0]).length} vs ${most[29]} ${ownedBy(real, most[29]).length}`)
  check('a team can hold picks that are not its own',
    ownedBy(real, most[0]).some((p) => p.from !== most[0]))

  const clean = rebuildLedger(newPickLedger('2026-27', { real: false }), ranks)
  const sizes = new Set(TEAMS.map((t) => ownedBy(clean, t).length))
  check('the clean slate gives everybody ten', sizes.size === 1 && sizes.has(10), [...sizes].join(','))
  check('and every pick a team holds on a clean slate is its own',
    TEAMS.every((t) => ownedBy(clean, t).every((p) => p.from === t)))
}

console.log('\n— a protection is a probability, not a promise —')
{
  const real = rebuildLedger(newPickLedger('2026-27', { real: true }), ranks)
  const prot = allPicks(real).filter((p) => p.prot)
  check('protected picks exist', prot.length > 0, `${prot.length}`)
  const odds = prot.map((p) => conveyanceOdds(p, ranks))
  check('none of them is a certainty', odds.every((o) => o < 1))
  check('and none is impossible either', odds.every((o) => o > 0))
  check('the spread is real, not one constant', new Set(odds.map((o) => o.toFixed(2))).size > 3)
  // A top-4 protected pick from a projected 2nd-worst team conveys less than half the
  // time; the same protection on a projected 20th-worst team is a formality. The real
  // league's worst team lands top-four 52% of the time, so 57% here is the right side of
  // the same number — the difference is the lottery, which the draft runs separately.
  const bad = 1 - landsInRange(2, 1, 4)
  const good = 1 - landsInRange(20, 1, 4)
  check('a bad team conveys a top-4 protected pick less than half the time', bad < 0.5, bad.toFixed(2))
  check('and roughly as often as the real lottery says', bad > 0.35 && bad < 0.5, bad.toFixed(2))
  check('a good team almost always does', good > 0.99, good.toFixed(2))
  check('an unprotected pick always conveys', conveyanceOdds({ from: 'BOS', round: 1 }, ranks) === 1)
  const p = prot[0]
  check('a protected pick is worth less than the same pick unprotected',
    pickValue(p, ranks[p.from], 2026) < pickValue({ ...p, prot: undefined }, ranks[p.from], 2026),
    `${pickValue(p, ranks[p.from], 2026)} vs ${pickValue({ ...p, prot: undefined }, ranks[p.from], 2026)}`)
  check('and it explains itself', /Protected/.test(describePick(p, ranks, real.$groups)))
  // The valuation must never invert. A protected pick worth more than the same pick
  // unprotected is a valuation the AI can be milked through, and two different integration
  // schemes for the two cases produced exactly that.
  let inverted = 0
  for (let slot = 1; slot <= 30; slot++) {
    for (const [lo, hi] of [[1, 4], [1, 10], [1, 14], [5, 20]]) {
      const a2 = pickValue({ from: 'X', year: 2029, round: 1, prot: { lo, hi, to: 'Y' } }, slot, 2026)
      const b2 = pickValue({ from: 'X', year: 2029, round: 1 }, slot, 2026)
      if (a2 > b2) inverted++
    }
  }
  check('no protection ever makes a pick more valuable', inverted === 0, `${inverted} cases`)
  const worst = pickValue({ from: 'X', year: 2029, round: 1, prot: { lo: 1, hi: 4, to: 'Y' } }, 1, 2026)
  const worstUn = pickValue({ from: 'X', year: 2029, round: 1 }, 1, 2026)
  check('top-4 protection guts the worst team\u2019s pick', worst < worstUn * 0.35,
    `${(worst / 1e6).toFixed(1)}M of ${(worstUn / 1e6).toFixed(1)}M`)
  const late = pickValue({ from: 'X', year: 2029, round: 1, prot: { lo: 1, hi: 4, to: 'Y' } }, 27, 2026)
  const lateUn = pickValue({ from: 'X', year: 2029, round: 1 }, 27, 2026)
  check('and is worth nothing at all on a contender\u2019s pick', Math.abs(late - lateUn) < 1e5,
    `${(late / 1e6).toFixed(2)}M vs ${(lateUn / 1e6).toFixed(2)}M`)
  const rolled = rollProtection({ ...p, prot: { lo: 1, hi: 4, to: 'BOS' } }, 2)
  check('one that does not convey rolls to the next year', rolled && rolled.year === p.year + 1)
  check('and the protection narrows as it rolls', rolled.prot.hi === 3, JSON.stringify(rolled.prot))
  const last = rollProtection({ ...p, year: 2029, prot: { lo: 1, hi: 1, to: 'BOS' } }, 1)
  check('until it finally conveys unprotected', last && !last.prot && last.owner === 'BOS')
}

console.log('\n— a swap hands the better pick to the right seat —')
{
  const real = rebuildLedger(newPickLedger('2026-27', { real: true }), ranks)
  const grouped = allPicks(real).filter((p) => p.group)
  check('swap picks exist', grouped.length > 0, `${grouped.length}`)
  const g = 'S27C'          // Denver, Oklahoma City, the Clippers and Toronto
  const seats = allPicks(real).filter((p) => p.group === g)
  check('the 2027 four-team ladder is populated', seats.length === SWAP_GROUPS[g].pool.length,
    `${seats.length} of ${SWAP_GROUPS[g].pool.length}`)
  const bySeat = seats.slice().sort((a, b) => a.seat - b.seat)
  check('seats are dealt best-first', bySeat.every((p, i) => p.seat === i))
  check('and the best seat goes where the group says',
    bySeat[0].owner === SWAP_GROUPS[g].assign[0], `${bySeat[0].owner}`)
  check('Oklahoma City really does take two of them',
    SWAP_GROUPS[g].assign.filter((t) => t === 'OKC').length === 2)
  check('a swap explains which seat you hold', /seat \d/.test(describePick(bySeat[0], ranks, real.$groups)))

  // The one that used to be silently wrong: moving a swap seat has to change the seat
  // INSIDE the group, or the next rebuild hands it straight back.
  const seat = bySeat[0]
  const to = TEAMS.find((t) => t !== seat.owner && !SWAP_GROUPS[g].assign.includes(t))
  let led = movePick(real, seat, to, ranks)
  check('a traded swap seat changes hands', ownedBy(led, to).some((p) => pickKey(p) === pickKey(seat)))
  led = rebuildLedger(led, ranks)
  check('and it stays changed after the standings move',
    ownedBy(led, to).some((p) => pickKey(p) === pickKey(seat)),
    `went back to ${allPicks(led).find((p) => pickKey(p) === pickKey(seat))?.owner}`)
}

console.log('\n— second-rounders are tradeable —')
{
  const real = rebuildLedger(newPickLedger('2026-27', { real: true }), ranks)
  const seconds = allPicks(real).filter((p) => p.round === 2)
  check('half the ledger is second-rounders', seconds.length === 150, `${seconds.length}`)
  check('they carry a value', seconds.some((p) => pickValue(p, ranks[p.from], 2026) > 0))
  check('and less than a first from the same club', (() => {
    const t = 'BOS'
    const f = ownedBy(real, t).find((p) => p.round === 1 && p.from === t)
    const s = ownedBy(real, t).find((p) => p.round === 2 && p.from === t)
    return !f || !s || pickValue(s, ranks[t], 2026) < pickValue(f, ranks[t], 2026)
  })())
  // Stepien only ever cared about firsts, and still should.
  const noFirsts = seconds.slice(0, 10)
  check('a pile of seconds does not satisfy the Stepien rule',
    !violatesStepien(noFirsts, 'BOS', 2026).ok)
}

console.log('\n— the open market never closes —')
{
  let sv = newCareer({ gm: { name: 'T' }, team: 'BOS', preset: 'guided',
    levels: { ...SEED.presets.guided.levels }, seed: 4242 })
  check('a career starts with a standing pool', (sv.pool || []).length > 0, `${(sv.pool || []).length}`)
  // The bug this exists to prevent: the pool was seeded by copying men off other clubs'
  // simulation profiles, so the second pick in the draft showed up as a free agent and
  // signing him would have put the same player on two rosters.
  const contracted = new Set(TEAMS.flatMap((t) => rostersOf(t).map((x) => x.n)))
  const doubled = sv.pool.filter((x) => contracted.has(x.n)).map((x) => x.n)
  check('nobody in the pool is under contract anywhere', doubled.length === 0, doubled.slice(0, 3).join(', '))
  check('and the invariant is checkable from the screen', poolIsClean(sv.pool))
  // The same bug invented ages: a nineteen-year-old rookie was listed at thirty-two.
  check('every free agent has a real age', sv.pool.every((x) => x.a >= 19 && x.a <= 40),
    sv.pool.map((x) => x.a).filter((a2) => a2 < 19 || a2 > 40).join(','))
  check('and a position and an archetype', sv.pool.every((x) => x.pos && x.arch))
  const onePlayer = new Set(sv.pool.map((x) => x.n))
  check('and nobody appears in the pool twice', onePlayer.size === sv.pool.length)
  const exc = exceptionsFor('BOS', rostersOf('BOS'))
  check('the minimum is always one of the doors', exc.some((e) => e.key === 'min'))
  check('and every door explains itself', exc.every((e) => e.why && e.why.length > 20))

  const man = sv.pool[0]
  check('a minimum contract is legal', canSign(sv, man, MIN_SALARY).ok)
  const big = canSign(sv, man, 40e6)
  check('a max contract is not', !big.ok, big.rule)
  check('and the refusal names the rule', /exception|Roster/.test(big.rule || ''), big.rule)

  const before = rostersOf('BOS').length
  sv = signFromPool(sv, man, { salary: MIN_SALARY, years: 1 })
  check('signing adds him to the roster', rostersOf('BOS').length === before + 1)
  check('and takes him off the market', !sv.pool.some((p) => p.n === man.n))
  check('the signing is reported back', sv.lastSigning?.name === man.n)

  // Waiving is the other half, and the money does not go away.
  const cut = rostersOf('BOS').find((p) => p.s > MIN_SALARY)
  const sv2 = waiveToPool(sv, cut)
  check('waiving removes him', !rostersOf('BOS').some((p) => (p.uid || p.n) === (cut.uid || cut.n)))
  check('but leaves the money on the books',
    (sv2.deadMoney || []).some((d) => d.n === cut.n && d.s === cut.s))
  check('and puts him on the market', sv2.pool.some((p) => p.n === cut.n))
  const waived = sv2.pool.find((p) => p.n === cut.n)
  check('with the player still behind the name', !!waived.sim,
    'his simulation profile was read after he had already been removed')
  check('and his real age, not an invented one', Math.abs(waived.a - cut.a) < 0.01,
    `${waived.a} vs ${cut.a}`)
  const sv3 = signFromPool(sv2, waived, { salary: MIN_SALARY })
  check('signing him back restores the same player',
    rostersOf('BOS').some((p) => p.n === cut.n && Math.abs(p.a - cut.a) < 0.01))
  check('and the pool is still clean afterwards', poolIsClean(sv3.pool))
  check('a man under contract cannot be signed again',
    !canSign(sv3, { n: cut.n }, MIN_SALARY).ok,
    canSign(sv3, { n: cut.n }, MIN_SALARY).rule)

  // A team below fourteen is the whole reason this exists.
  const short = { ...sv2 }
  const rc = rosterCheck(short)
  check('the roster count is reported', typeof rc.n === 'number' && rc.n > 0, `${rc.n}`)
  const filled = cpuFillFromPool(sv2, rng(7))
  check('the other twenty-nine work the same market',
    Object.keys(SEED.teams).filter((t) => t !== 'BOS')
      .every((t) => rostersOf(t).length >= MIN_ROSTER))
  check('and it is reported on the wire', Array.isArray(filled.poolNews))
}

console.log('\n— the finder shops a package —')
{
  setLeague(newLeague('2026-27'))
  const sv = newCareer({ gm: { name: 'T' }, team: 'BOS', preset: 'guided',
    levels: { ...SEED.presets.guided.levels }, seed: 77 })
  const led = rebuildLedger(sv.picks, ranks)
  const roster = [...rostersOf('BOS')].sort((a, b) => b.s - a.s)
  const opts = { rosters: allRosters(), ledger: led, ranks, year: 2026 }

  const one = shopPackage({ players: [roster[0]], picks: [] }, 'BOS', opts)
  check('one player still works', one.length === 29, `${one.length}`)
  const two = shopPackage({ players: [roster[0], roster[2]], picks: [] }, 'BOS', opts)
  check('two players is a different question', two.length === 29)
  check('and the offers differ from the single-player ones',
    JSON.stringify(two.map((r) => r.interest)) !== JSON.stringify(one.map((r) => r.interest)))
  check('a package is worth more to somebody than its best single piece',
    Math.max(...two.map((r) => r.interest)) > Math.max(...one.map((r) => r.interest)))

  const pk = ownedBy(led, 'BOS').filter((p) => p.round === 1).slice(0, 1)
  const withPick = shopPackage({ players: [roster[0]], picks: pk }, 'BOS', opts)
  check('picks can go on the block too', withPick.length === 29)
  check('and adding a first raises what they will give',
    Math.max(...withPick.map((r) => r.interest)) > Math.max(...one.map((r) => r.interest)))
  const picksOnly = shopPackage({ players: [], picks: pk }, 'BOS', opts)
  check('picks alone are a legal package', picksOnly.length === 29)
  check('an empty block asks nobody anything', shopPackage({ players: [], picks: [] }, 'BOS', opts).length === 0)

  const offered = withPick.find((r) => r.offers.length)
  if (offered) {
    check('an offer names what comes back', offered.offers[0].pieces.length > 0,
      offered.offers[0].pieces.join(', '))
    check('and every offer it makes is one they would actually do',
      withPick.every((r) => r.offers.every((o) => o.theirs.need <= 0)))
  } else {
    check('an offer names what comes back', false, 'nobody made one')
    check('and every offer it makes is one they would actually do', false, 'nobody made one')
  }
}

console.log('\n— trading a pick still works end to end —')
{
  setLeague(newLeague('2026-27'))
  let sv = newCareer({ gm: { name: 'T' }, team: 'BOS', preset: 'guided',
    levels: { ...SEED.presets.guided.levels }, seed: 31 })
  const mine = ownedBy(sv.picks, 'BOS')[0]
  const before = ownedBy(sv.picks, 'BOS').length
  sv = applyTrade(sv, { other: 'SAC', out: [], inc: [], outPicks: [mine], inPicks: [] }, { ranks })
  check('the pick leaves your ledger', ownedBy(sv.picks, 'BOS').length === before - 1,
    `${ownedBy(sv.picks, 'BOS').length} vs ${before}`)
  check('and arrives in theirs', ownedBy(sv.picks, 'SAC').some((p) => pickKey(p) === pickKey(mine)))
  const round = rebuildLedger(sv.picks, ranks)
  check('and it is still theirs after the standings move',
    ownedBy(round, 'SAC').some((p) => pickKey(p) === pickKey(mine)))
  check('the ledger survives a save and a reload',
    ownedBy(JSON.parse(JSON.stringify(sv.picks)), 'SAC').some((p) => pickKey(p) === pickKey(mine)))
}

console.log(`\n${pass}/${pass + fail} checks pass`)
process.exit(fail ? 1 : 0)
