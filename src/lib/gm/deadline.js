// The trade deadline as an event, not a place you stop simming.
//
// AI teams call YOU. Each one has a stance derived from its actual record — a contender
// pays a premium for win-now and will attach picks; a rebuilding team wants youth and
// picks and will absorb salary to get them. Every offer generated here is checked
// against the same cap engine the user's own proposals go through, so nothing arrives
// in the inbox that could not legally be done.
import { SEED } from './seed.js'
import { rostersOf } from './league.js'
import { validateTrade, teamSalary, status } from './cap.js'
import { pickKey, pickValue, strengthRanks, label as pickLabel, violatesStepien } from './picks.js'

export const DEADLINE_GAME = 55 // ~ early February in an 82-game season

export function stance(rec) {
  const gp = rec.w + rec.l
  if (!gp) return 'fringe'
  const pace = (rec.w / gp) * 82
  if (pace >= 52) return 'contending'
  if (pace >= 43) return 'fringe'
  if (pace >= 33) return 'retooling'
  return 'rebuilding'
}

const WANT = {
  contending: { youth: 0.8, picks: 0.7, now: 1.3 },
  fringe: { youth: 1.0, picks: 1.0, now: 1.0 },
  retooling: { youth: 1.15, picks: 1.2, now: 0.85 },
  rebuilding: { youth: 1.4, picks: 1.45, now: 0.6 },
}

// Rough surplus for a player under contract — production priced against salary.
function worth(p) {
  const v = p.v ?? 0
  const base = SEED.picks.replacement + v * SEED.picks.perVorp
  const yrs = Math.max(1, p.yr || 1)
  let t = 0
  for (let i = 0; i < yrs; i++) t += (base - p.s) * Math.pow(SEED.picks.discount, i)
  // Bounded. Raw surplus says a 2-VORP player on a five-year $3M deal is a $138M asset,
  // which is true arithmetic and useless as a trade price: nobody can assemble $138M of
  // return for a contract that only lets its team take back $6M. Unbounded, it also
  // generated single offers worth +$310M. Capped at roughly what a max contract is worth
  // in a year, which is the most anyone will actually pay for one player.
  return Math.max(-60e6, Math.min(60e6, t))
}

function desire(p, st) {
  const w = WANT[st]
  const age = p.a ?? 27
  const v = worth(p)
  let mult = 1
  if (age <= 24) mult *= w.youth
  else if ((p.v ?? 0) >= 1.5) mult *= w.now
  return v * mult
}

// `myRoster` is the CAREER roster, not the seed. Reading SEED.rosters[mine] meant the
// deadline offered players who had already been traded away or whose contracts had
// expired — the phone rang about people the team no longer employed.
export function generateOffers(mine, seasonState, r, ledger, year, max = 4, myRoster = null) {
  // Two passes. The first looks for packages near fair value; if a team's roster makes
  // that impossible — apron teams with big contracts and little to match them — the
  // second lowers the bar rather than leaving the phone silent all deadline.
  const roster = myRoster || rostersOf(mine)
  const first = collectOffers(mine, seasonState, r, ledger, year, max, 0.55, roster)
  if (first.length) return first
  return collectOffers(mine, seasonState, r, ledger, year, max, 0.32, roster)
}

function collectOffers(mine, seasonState, r, ledger, year, max, floorRatio, myRosterIn) {
  const ranks = strengthRanks(seasonState)
  const myRoster = myRosterIn
  const myPicks = ledger[mine] || []
  const offers = []
  const others = Object.keys(SEED.teams).filter((t) => t !== mine)
  r.shuffle(others)

  for (const t of others) {
    if (offers.length >= max) break
    const theirRoster = rostersOf(t)
    const theirPicks = (ledger[t] || []).filter((p) => p.year > year && !p.forfeit)
    const st = stance(seasonState?.rec?.[t] || { w: 0, l: 0 })

    // What do they want from me? The asset their stance values most that they can afford
    // to chase — not simply my best player.
    // Targets have to be ACQUIRABLE, not just desirable. Boston's most valuable contract
    // is a $3M deal carrying $138M of surplus — and no over-the-cap team can legally
    // trade for it, because it can only take back about $6M in return. Chasing the best
    // asset regardless of salary meant half the league generated zero deadline calls.
    // Real front offices know a minimum-salary gem is untradeable; this encodes that.
    const theirSt = status(teamSalary(theirRoster))
    const floor = theirSt.underCap ? 1_000_000 : 6_000_000
    const targets = myRoster
      .map((p, i) => ({ p, i, d: desire(p, st) }))
      .filter((x) => x.d > 1_500_000 && x.p.s >= floor)
      .sort((a, b) => b.d - a.d)
      .slice(0, 8)
    if (!targets.length) continue
    const target = targets[r.randrange(targets.length)]

    // Assemble by SALARY FIRST, then judge the value.
    //
    // The original did it the other way round: build a package the AI likes, then hope it
    // is cap-legal. It almost never was — fourteen of thirty teams generated no deadline
    // calls at all, because matching a $30M contract requires a specific combination of
    // salaries and random assembly essentially never lands in the window. Searching
    // combinations of one to three of their contracts finds the legal shapes first, and
    // value becomes the filter rather than the search.
    const ask = worth(target.p)
    const cands = theirRoster
      .map((p, i) => ({ p, i }))
      .sort((x, y) => y.p.s - x.p.s)
      .slice(0, 12)
    const combos = []
    for (let i = 0; i < cands.length; i++) {
      combos.push([cands[i]])
      for (let j = i + 1; j < cands.length; j++) {
        combos.push([cands[i], cands[j]])
        for (let k = j + 1; k < cands.length; k++) combos.push([cands[i], cands[j], cands[k]])
      }
    }
    r.shuffle(combos)
    let made = false
    for (const give of combos) {
      if (made) break
      const cap = validateTrade([
        { team: mine, roster: myRoster, out: [target.p], inc: give.map((g) => g.p) },
        { team: t, roster: theirRoster, out: give.map((g) => g.p), inc: [target.p] },
      ])
      if (!cap.ok) continue

      let value = give.reduce((s2, g) => s2 + worth(g.p), 0)
      const givePicks = []
      // Picks close the gap when the salary shapes do not reach fair value on their own,
      // which is exactly what picks are for at a deadline.
      const pk = [...theirPicks]
      r.shuffle(pk)
      for (const pp of pk) {
        if (value >= ask * 0.9) break
        if (givePicks.length >= 2) break
        givePicks.push(pp)
        value += pickValue(pp, ranks[pp.from], year)
      }
      if (value < ask * floorRatio) continue

      const theirAfter = [...(ledger[t] || [])].filter(
        (pp) => !givePicks.some((g) => pickKey(g) === pickKey(pp)))
      if (!violatesStepien(theirAfter, t, year).ok) continue
      made = true
      offers.push({
        id: `${t}-${offers.length}`,
        team: t,
        stance: st,
        want: target.p,
        give: give.map((g) => g.p),
        givePicks,
        value,
        target: target.d,
        notes: cap.notes,
        pitch: PITCH[st](t, target.p),
      })
    }
  }
  return offers
}

const PITCH = {
  contending: (t, p) => `${SEED.teams[t].name} think they are a piece away and want ${p.n} for the run.`,
  fringe: (t, p) => `${SEED.teams[t].name} are on the bubble and are asking about ${p.n}.`,
  retooling: (t, p) => `${SEED.teams[t].name} are reshaping the roster and have called about ${p.n}.`,
  rebuilding: (t, p) => `${SEED.teams[t].name} are selling and will take on money to get ${p.n}.`,
}

// Was this a good deal for the user? Same currency as everything else.
export function offerMargin(offer, ranks, year) {
  const inValue = offer.give.reduce((s, p) => s + worth(p), 0)
    + offer.givePicks.reduce((s, p) => s + pickValue(p, ranks[p.from], year), 0)
  const outValue = worth(offer.want)
  return inValue - outValue
}
