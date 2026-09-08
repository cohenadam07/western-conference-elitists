// Executing a trade against a career.
//
// The trade desk and the deadline inbox both validated deals and then did nothing with
// them: accepting an offer marked it "Done" and left the roster untouched. A trade that
// cannot actually happen is a calculator, not a game.
import { SEED } from './seed.js'
import { pickKey, movePick } from './picks.js'
import { league, rostersOf, simOf } from './league.js'
import { refill } from './offseason.js'

// Incoming players arrive with their simulation profile, not just a salary line.
//
// Not every contract has one: 87 of the 470 real deals belong to players with no NBA
// season for Savant to rate — 2026 rookies, two-way conversions, dead money. Trading for
// one used to hand the roster a cap line with nothing behind it, so the player existed on
// the sheet and could not take the floor. A replacement-level profile is the honest
// stand-in until he plays a season.
function simFor(team, capPlayer) {
  const found = simOf(team).find((p) => p.n === capPlayer.n)
  if (found) return { ...found }
  return {
    id: `acq-${capPlayer.n.replace(/\W+/g, '')}`,
    n: capPlayer.n,
    mpg: 12, load: 10,
    usg: 0.16, fg3r: 0.4, fg3: 0.33, fg2: 0.52, ft: 0.74, ftr: 0.22,
    tov: 0.135, oreb: 0.045, dreb: 0.135, ast: 0.11,
    dr: 45, dp: 45, de: 45,
  }
}

export function applyTrade(save, { other, out = [], inc = [], outPicks = [], inPicks = [] }, opts = {}) {
  const mine = save.franchise.team
  const L = league()

  // Match on a stable id. Name alone was wrong (two players share a name); name plus
  // salary was still wrong, because a trade can send out a player and bring back a
  // different one with the same name on the same money — which happened once in fifty-six
  // soak trades and removed the wrong row.
  const key = (p) => p.uid || `${p.n}|${p.s}`
  const goingOut = new Set(out.map(key))
  const comingIn = new Set(inc.map(key))

  // BOTH sides move. The players leaving your roster arrive on theirs, and vice versa —
  // with their simulation profiles, so an acquired player can actually take the floor.
  const arrive = (fromTeam, players) => players.map((p, i) => ({
    cap: { ...p, uid: p.uid || `${fromTeam}-in-${Date.now().toString(36)}-${i}` },
    sim: simFor(fromTeam, p),
  }))

  const mineIn = arrive(other, inc)
  const theirsIn = arrive(mine, out)

  const myCap = rostersOf(mine).filter((p) => !goingOut.has(key(p))).concat(mineIn.map((a) => a.cap))
  const theirCap = rostersOf(other).filter((p) => !comingIn.has(key(p))).concat(theirsIn.map((a) => a.cap))

  const leavingNames = new Set(out.map((p) => p.n))
  const arrivingNames = new Set(inc.map((p) => p.n))
  const mySim = simOf(mine).filter((p) => !leavingNames.has(p.n)).concat(mineIn.map((a) => a.sim).filter(Boolean))
  const theirSim = simOf(other).filter((p) => !arrivingNames.has(p.n)).concat(theirsIn.map((a) => a.sim).filter(Boolean))

  L.rosters = { ...L.rosters, [mine]: myCap, [other]: theirCap }
  L.sim = { ...L.sim, [mine]: mySim, [other]: theirSim }

  // Picks move too. Without a ledger in the save, a traded pick would reappear next time
  // the page rendered — the ledger has to be career state, not a render-time constant.
  // Picks move through the ledger's own bookkeeping, not by shuffling arrays: a swap seat
  // has to change hands INSIDE its group, or the next time the standings move the group
  // would hand the pick straight back to the team that traded it away.
  let ledger = JSON.parse(JSON.stringify(save.picks || {}))
  const ranks = opts.ranks || null
  for (const pk of outPicks) ledger = movePick(ledger, pk, other, ranks)
  for (const pk of inPicks) ledger = movePick(ledger, pk, mine, ranks)
  if (!ledger.$picks && ledger[mine] && ledger[other]) {
    // A career saved before protections existed keeps the old flat bookkeeping.
    const outKeys = new Set(outPicks.map(pickKey))
    const inKeys = new Set(inPicks.map(pickKey))
    const moved = ledger[mine].filter((p) => outKeys.has(pickKey(p)))
    const gained = ledger[other].filter((p) => inKeys.has(pickKey(p)))
    ledger[mine] = ledger[mine].filter((p) => !outKeys.has(pickKey(p))).concat(gained)
    ledger[other] = ledger[other].filter((p) => !inKeys.has(pickKey(p))).concat(moved)
  }

  return {
    ...save,
    league: { ...L, rosters: L.rosters, sim: L.sim },
    picks: ledger,
    records: { ...save.records, tradesMade: (save.records.tradesMade || 0) + 1 },
    // Who you have already done business with, and how often. The acceptance layer reads
    // this: a partner you have already extracted value from twice is not as helpful the
    // third time, which is what stops a deterministic engine being drained one small
    // favourable trade at a time.
    tradeHistory: { ...(save.tradeHistory || {}), [other]: ((save.tradeHistory || {})[other] || 0) + 1 },
    lastTrade: {
      with: other,
      sent: out.map((p) => p.n),
      got: inc.map((p) => p.n),
      sentPicks: outPicks.length,
      gotPicks: inPicks.length,
    },
  }
}

// A trade between two teams that are not you. Same bookkeeping, no career records — this
// is the league moving around you, which is the thing that makes it feel like a league.
export function applyLeagueTrade(save, { buyer, seller, deal }) {
  const L = league()
  const key = (p) => p.uid || `${p.n}|${p.s}`
  const outKeys = new Set((deal.out || []).map(key))       // leaving the buyer
  const inKeys = new Set((deal.inc || []).map(key))        // leaving the seller

  const move = (fromTeam, players) => players.map((p, i) => ({
    cap: { ...p, uid: p.uid || `${fromTeam}-mv-${Date.now().toString(36)}-${i}` },
    sim: simOf(fromTeam).find((x) => x.n === p.n) || null,
  }))
  const toSeller = move(buyer, deal.out || [])
  const toBuyer = move(seller, deal.inc || [])

  const buyerCap = rostersOf(buyer).filter((p) => !outKeys.has(key(p))).concat(toBuyer.map((a) => a.cap))
  const sellerCap = rostersOf(seller).filter((p) => !inKeys.has(key(p))).concat(toSeller.map((a) => a.cap))
  const outNames = new Set((deal.out || []).map((p) => p.n))
  const inNames = new Set((deal.inc || []).map((p) => p.n))
  const buyerSim = simOf(buyer).filter((p) => !outNames.has(p.n)).concat(toBuyer.map((a) => a.sim).filter(Boolean))
  const sellerSim = simOf(seller).filter((p) => !inNames.has(p.n)).concat(toSeller.map((a) => a.sim).filter(Boolean))

  L.rosters = { ...L.rosters, [buyer]: buyerCap, [seller]: sellerCap }
  L.sim = { ...L.sim, [buyer]: buyerSim, [seller]: sellerSim }

  // Everyone in this deal is off the market for a while.
  const moved = { ...(save.recentlyMoved || {}) }
  for (const p of [...(deal.out || []), ...(deal.inc || [])]) moved[p.uid || p.n] = 1

  let ledger = JSON.parse(JSON.stringify(save.picks || {}))
  for (const pk of (deal.outPicks || [])) ledger = movePick(ledger, pk, seller, null)
  for (const pk of (deal.inPicks || [])) ledger = movePick(ledger, pk, buyer, null)
  if (!ledger.$picks && ledger[buyer] && ledger[seller] && (deal.outPicks || []).length) {
    const keys = new Set(deal.outPicks.map(pickKey))
    const was = ledger[buyer].filter((p) => keys.has(pickKey(p)))
    ledger[buyer] = ledger[buyer].filter((p) => !keys.has(pickKey(p)))
    ledger[seller] = ledger[seller].concat(was)
  }
  return { ...save, league: { ...L }, picks: ledger, recentlyMoved: moved }
}

// Called when the calendar turns a page: last month's movers are available again.
export function coolDown(save) {
  const moved = {}
  for (const [k, n] of Object.entries(save.recentlyMoved || {})) {
    if (n > 1) moved[k] = n - 1
  }
  return { ...save, recentlyMoved: moved }
}

// A team that trades three for one is a team with an illegal roster. Real front offices
// sign minimum contracts the same afternoon; so does this.
export function refillLeague(save, r, year, min = 14) {
  const L = league()
  const rosters = { ...L.rosters }, sim = { ...L.sim }
  let touched = 0
  for (const team of Object.keys(rosters)) {
    if (rosters[team].length >= min) continue
    const filled = refill(sim[team], rosters[team], [], r, year, min)
    rosters[team] = filled.cap
    sim[team] = filled.sim
    touched++
  }
  if (!touched) return save
  L.rosters = rosters; L.sim = sim
  return { ...save, league: { ...L } }
}
