// THE ROTATION, AND WHAT MINUTES COST.
//
// Five players on the floor for forty-eight minutes is 240 minutes a night. That is the
// entire budget, and it is why a deep roster is worth less than it looks: giving somebody
// minutes means taking them from somebody else, and a fifth good big plays none of them.
//
// The minutes you set here ARE the load the possession engine reads. This is not a
// preference that gets averaged into something — change a player's minutes and the games
// change.
//
// Fatigue is deliberately modest and deliberately grounded. Availability is a measured
// number in this data: what share of last season each player was actually able to play.
// Pushing a player above the load his body has already shown it can carry spends that
// number down; resting him lets it come back. The league's own baseline is about 72 games,
// and players past 31 lose roughly another 1.2% of a season per year of age — both from
// the availability model, not from a slider.
export const TEAM_MINUTES = 240
export const MAX_MINUTES = 38
export const MIN_ROTATION = 8

// What this player has shown he can carry: last season's minutes, adjusted for how much of
// it he was available for. A player who played 34 minutes but only 55 games has not shown
// he can carry 34 across a season.
export function sustainable(player, sim) {
  const mpg = sim?.mpg ?? player?.mpg ?? 14
  const av = (player?.av ?? 75) / 100
  const age = player?.a ?? 26
  const agePenalty = Math.max(0, age - 31) * 0.4
  return Math.max(8, Math.min(MAX_MINUTES, mpg * (0.72 + 0.4 * av) - agePenalty))
}

// The cost of a rotation, in expected availability. Above what he can carry, risk climbs;
// below it, he recovers some. Capped so no single decision ruins a season.
export function strain(player, sim, minutes) {
  const safe = sustainable(player, sim)
  const over = minutes - safe
  if (over <= 0) return { delta: Math.min(4, -over * 0.35), risk: 'rested' }
  const delta = -Math.min(16, over * 1.25)
  return {
    delta,
    risk: over > 8 ? 'heavy' : over > 3 ? 'stretched' : 'fine',
  }
}

// A sane default: best players first, inside the positional bands, up to what each can
// carry. This is what the coach does when the rotation is not yours.
export function autoRotation(roster, sim, bandOf, ratePerMin) {
  const BANDS = [['guard', 96], ['wing', 72], ['big', 72]]
  const out = {}
  for (const [band, budget] of BANDS) {
    const pool = roster.filter((p) => bandOf(p).key === band)
      .sort((a, b) => ratePerMin(b) - ratePerMin(a))
    let left = budget
    for (const p of pool) {
      if (left <= 0) break
      const s = sim.find((x) => x.n === p.n)
      const want = Math.min(sustainable(p, s), left)
      const give = Math.max(0, Math.round(want))
      if (give >= 6) { out[p.uid || p.n] = give; left -= give }
    }
    // Anything left over goes to whoever has the most room left in his body, not to
    // whoever happens to be first in the list. A thin roster still cannot cover 240
    // minutes without somebody going over — that tension is real and the screen shows it.
    if (left > 0) {
      const playing = pool.filter((p) => out[p.uid || p.n])
        .map((p) => ({ p, head: sustainable(p, sim.find((x) => x.n === p.n)) - out[p.uid || p.n] }))
        .sort((a, b) => b.head - a.head)
      for (const { p } of playing) {
        if (left <= 0) break
        const add = Math.min(left, MAX_MINUTES - out[p.uid || p.n])
        out[p.uid || p.n] += add
        left -= add
      }
    }
  }
  return out
}

// Total assigned, and whether it is legal.
export function checkRotation(minutes) {
  const total = Object.values(minutes || {}).reduce((s, m) => s + (m || 0), 0)
  const playing = Object.values(minutes || {}).filter((m) => m > 0).length
  return {
    total,
    playing,
    ok: total === TEAM_MINUTES && playing >= MIN_ROTATION,
    off: total - TEAM_MINUTES,
    why: total !== TEAM_MINUTES
      ? `${total} of ${TEAM_MINUTES} minutes assigned — ${total > TEAM_MINUTES ? 'over by' : 'short by'} ${Math.abs(total - TEAM_MINUTES)}.`
      : playing < MIN_ROTATION
        ? `Only ${playing} players in the rotation; a season needs at least ${MIN_ROTATION}.`
        : null,
  }
}

// Push the chosen minutes into the simulation profiles. `load` is what the engine reads.
// Assigning minutes must not assign HEALTH.
//
// This used to set `load` equal to the minutes asked for, which was harmless while load was
// only a minutes budget. It stopped being harmless the moment availability was read back out
// of it as `load / mpg`: setting a rotation made every one of your players a hundred per cent
// available, so your stars never missed a game and the other twenty-nine clubs still lost
// theirs. The ratio has to survive the override — he plays the minutes you asked for, on the
// nights he is fit, and he is fit exactly as often as he was before you touched the screen.
export function applyRotation(simRoster, roster, minutes) {
  if (!minutes) return simRoster
  const byName = {}
  for (const p of roster) byName[p.n] = minutes[p.uid || p.n]
  return simRoster.map((s) => {
    const m = byName[s.n]
    if (m === undefined) return s
    const av = Math.max(0.05, Math.min(1, (s.load || 0) / Math.max(1, s.mpg || 1)))
    return { ...s, mpg: m, load: Math.max(0, m * av) }
  })
}

/* ------------------------------------------------------------------- wear */

// Minutes are priced above, but nothing was spending them. A rotation screen that shows a
// player is "stretched" and then costs him nothing is a slider, not a decision.
//
// Wear accumulates from the minutes you actually assign, against the load a player has
// shown he can carry. It is deliberately slow: a full season ten minutes a night over the
// line costs a rotation player roughly a fifth of his availability, which is about what
// the real thing looks like — not a season-ending injury from one heavy week.
// Calibrated to the claim above rather than guessed: ten minutes a night over the line for
// a full 82 costs 10 x 0.024 x 82 = about 20 points of availability, a fifth of a season.
const WEAR_PER_MINUTE_OVER = 0.024      // per game, per minute above sustainable
const RECOVERY_PER_MINUTE_UNDER = 0.010 // rest gives some back, more slowly than it costs
const MAX_WEAR = 26                     // availability points, floored so nobody vanishes

export function accumulateWear(wear, roster, sim, minutes, games = 1) {
  const next = { ...(wear || {}) }
  for (const p of roster) {
    const key = p.uid || p.n
    const m = minutes?.[key]
    if (m === undefined) continue
    const s = (sim || []).find((x) => x.n === p.n)
    const safe = sustainable(p, s)
    const over = m - safe
    const step = over > 0
      ? over * WEAR_PER_MINUTE_OVER * games
      : over * RECOVERY_PER_MINUTE_UNDER * games      // negative: recovery
    next[key] = Math.max(0, Math.min(MAX_WEAR, (next[key] || 0) + step))
  }
  return next
}

// What a player's availability actually is right now, after what you have asked of him.
export const availabilityNow = (player, wear) => Math.max(25,
  Math.min(100, (player.av ?? 75) - (wear?.[player.uid || player.n] || 0)))

// Wear reaches the simulation the same way minutes do — through `load`, which is minutes
// times the share of them a player can be counted on for.
export function applyWear(simRoster, roster, wear) {
  if (!wear || !Object.keys(wear).length) return simRoster
  const byName = {}
  for (const p of roster) {
    const w = wear[p.uid || p.n] || 0
    if (w > 0.5) byName[p.n] = 1 - Math.min(0.3, w / 100)
  }
  return simRoster.map((s) => {
    const f = byName[s.n]
    return f === undefined ? s : { ...s, load: Math.max(1, s.load * f) }
  })
}

// A REFUSED TRADE REQUEST REACHES THE FLOOR THE SAME WAY WEAR DOES.
//
// Through `load`, which is the only channel the simulation has for "he is not giving you all
// of it". This is deliberately not a ratings change: he has not become a worse player, he has
// stopped volunteering, and if you trade him tomorrow the man who arrives is the man his new
// club thought they were getting. That also keeps the trade valuation honest — a sulking star
// is worth what a star is worth, which is exactly why refusing hurts.
export function applySulk(simRoster, roster, sulk) {
  if (!sulk || !Object.keys(sulk).length) return simRoster
  const byName = {}
  for (const p of roster) {
    const k = sulk[p.uid || p.n]
    if (k > 0) byName[p.n] = 1 - Math.min(0.25, k)
  }
  return simRoster.map((s) => {
    const f = byName[s.n]
    return f === undefined ? s : { ...s, load: Math.max(1, s.load * f) }
  })
}

// Who to warn about, worst first.
export function wornDown(roster, wear, threshold = 6) {
  return roster
    .map((p) => ({ p, w: wear?.[p.uid || p.n] || 0 }))
    .filter((x) => x.w >= threshold)
    .sort((a, b) => b.w - a.w)
    .map((x) => ({
      ...x,
      note: x.w >= 16 ? 'worn down — his availability has fallen a long way'
        : x.w >= 10 ? 'carrying a heavy load' : 'starting to wear',
    }))
}

// ------------------------------------------------------------------ rebalancing
//
// Two things made the minutes screen miserable and both were interface, not model.
//
// The first: the list was sorted by live minutes, so dragging a slider re-sorted the rows
// under the cursor and you ended up moving somebody else. The order is fixed now — by
// position band, then by how many minutes a player had when the screen opened — and it
// does not move while you edit.
//
// The second: 240 is a BUDGET, and a budget where every change has to be paid for by hand
// is a chore rather than a decision. Raising one man now takes the minutes from the others,
// proportionally, skipping anybody you have pinned. The trade-off is the point; doing the
// arithmetic is not.

// Position band, then quality — and NOT minutes. Ordering by minutes at all, even only as a
// tiebreak, leaves the row order a function of the thing you are dragging; the screen can
// memoise around that but the function should not need it. Best guards at the top, best
// wings, best bigs: the same order every render, and the order you would think in anyway.
export function rotationOrder(roster, bandOf, ratePerMin) {
  const BAND_RANK = { guard: 0, wing: 1, big: 2 }
  const rate = ratePerMin || (() => 0)
  return [...roster].sort((a, b) => {
    const ba = BAND_RANK[bandOf(a).key] ?? 9
    const bb = BAND_RANK[bandOf(b).key] ?? 9
    if (ba !== bb) return ba - bb
    const d = rate(b) - rate(a)
    if (d) return d
    return (a.n || '').localeCompare(b.n || '')
  })
}

// Set one player's minutes and pay for it out of everybody else's.
//
// `locked` is the set of players you have pinned. A pinned man and the man you are dragging
// never move; everyone else absorbs the difference in proportion to what they are already
// playing, which keeps the shape of a rotation rather than flattening it.
export function rebalance(minutes, roster, key, value, locked = new Set()) {
  const next = { ...minutes }
  const want = Math.max(0, Math.min(MAX_MINUTES, Math.round(value)))
  next[key] = want

  const keyOf = (p) => p.uid || p.n
  const others = roster.map(keyOf).filter((k) => k !== key && !locked.has(k))
  const total = () => Object.values(next).reduce((s, m) => s + (m || 0), 0)

  let off = total() - TEAM_MINUTES
  if (off === 0 || !others.length) return next

  // Give back or take away in proportion, then walk the remainder one minute at a time so
  // the total lands exactly on 240 rather than near it.
  const room = (k) => (off > 0 ? (next[k] || 0) : MAX_MINUTES - (next[k] || 0))
  const pool = others.filter((k) => room(k) > 0)
  const capacity = pool.reduce((s, k) => s + room(k), 0)
  if (capacity <= 0) return next

  const share = Math.min(Math.abs(off), capacity)
  // Weighted by what a man is already playing, in BOTH directions. Handing the minutes out
  // by remaining room instead looked fair and flattened the rotation: every bench player
  // crept up and the ten-man rotation became a twelve-man one nobody had asked for. Giving
  // them back to the men already on the floor keeps the shape you built.
  const inRotation = pool.filter((k) => (next[k] || 0) > 0 && room(k) > 0)
  const give = inRotation.length ? inRotation : pool
  const weights = give.map((k) => ({ k, w: Math.max(0.001, next[k] || 0.5) }))
  const wsum = weights.reduce((s, x) => s + x.w, 0)
  for (const { k, w } of weights) {
    const move = Math.round((w / wsum) * share)
    const step = off > 0 ? -Math.min(move, room(k)) : Math.min(move, room(k))
    next[k] = Math.max(0, Math.min(MAX_MINUTES, (next[k] || 0) + step))
  }

  // Rounding leaves a minute or two either way. Walk it off the men with the most room.
  let guard = 0
  while (total() !== TEAM_MINUTES && guard++ < 400) {
    const over = total() > TEAM_MINUTES
    // Spilling over: take from whoever is playing most, and hand out to whoever is already
    // playing before anyone on the end of the bench.
    const cand = pool
      .filter((k) => (over ? (next[k] || 0) > 0 : (next[k] || 0) < MAX_MINUTES))
      .sort((a, b) => (over
        ? (next[b] || 0) - (next[a] || 0)
        : ((next[b] || 0) > 0 ? 1 : 0) - ((next[a] || 0) > 0 ? 1 : 0) || (next[b] || 0) - (next[a] || 0)))
    if (!cand.length) break
    next[cand[0]] += over ? -1 : 1
  }
  return next
}

// Everything the screen needs to say about one player, in one call — so the row and the
// advice can never disagree with each other.
export function rotationAdvice(minutes, roster, sim, bandOf, ratePerMin) {
  const chk = checkRotation(minutes)
  const notes = []
  const keyOf = (p) => p.uid || p.n
  const playing = roster.filter((p) => (minutes[keyOf(p)] || 0) > 0)

  const overworked = playing.filter((p) => {
    const s = strain(p, (sim || []).find((x) => x.n === p.n), minutes[keyOf(p)] || 0)
    return s.risk === 'heavy'
  })
  if (overworked.length) {
    notes.push({ tone: 'bad', text: `${overworked.map((p) => p.n).join(', ')} ${overworked.length === 1
      ? 'is' : 'are'} well past what ${overworked.length === 1 ? 'his' : 'their'} body has carried. `
      + 'That is availability you are spending, and it does not come back inside a season.' })
  }

  // The most common real mistake: your best player is not playing the most minutes.
  const byRate = [...roster].sort((a, b) => ratePerMin(b) - ratePerMin(a))
  const best = byRate[0]
  const most = playing.sort((a, b) => (minutes[keyOf(b)] || 0) - (minutes[keyOf(a)] || 0))[0]
  if (best && most && keyOf(best) !== keyOf(most) && (minutes[keyOf(best)] || 0) + 4 < (minutes[keyOf(most)] || 0)) {
    notes.push({ tone: 'warn', text: `${best.n} is the best player on the floor per minute and `
      + `${most.n} is playing more of them.` })
  }

  const bands = { guard: 0, wing: 0, big: 0 }
  for (const p of playing) bands[bandOf(p).key] = (bands[bandOf(p).key] || 0) + (minutes[keyOf(p)] || 0)
  for (const [b, floor] of [['guard', 60], ['wing', 48], ['big', 48]]) {
    if (bands[b] < floor) {
      notes.push({ tone: 'warn', text: `Only ${bands[b]} minutes at ${b}. A lineup has to be `
        + 'able to take the floor, and the engine plays the minutes you set.' })
    }
  }

  if (chk.ok && !notes.length) {
    notes.push({ tone: 'good', text: 'A legal rotation nobody is being run into the ground by. '
      + 'The rest is which nine or ten men you want on the floor.' })
  }
  return { ...chk, bands, notes }
}
