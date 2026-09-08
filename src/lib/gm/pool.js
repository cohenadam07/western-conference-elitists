// THE OPEN MARKET — free agents, year round.
//
// Free agency used to exist only inside the offseason screen, which is wrong in a way that
// bites: a roster can fall below the fourteen-player minimum in December through a trade,
// an injury or a waiver, and there was no way to fix it until July. In the real league the
// minimum-salary market never closes. Somebody is always available, and a team a man short
// is always signing.
//
// The CBA rules that matter here, and they are the ones that make the screen a decision
// rather than a shopping trip:
//   - A minimum contract can be signed by ANY team at ANY time, over the cap, over the
//     tax, over both aprons. This is the one door that is never shut.
//   - Cap room, if you have it, buys anybody up to the room.
//   - The mid-level is available to teams under the second apron, at the taxpayer size if
//     you are over the tax, and using it hard-caps you at the first apron for the year.
//   - Fifteen standard contracts is the maximum; fourteen is the minimum you may carry.
import { SEED } from './seed.js'
import { CBA, teamSalary, status } from './cap.js'
import { league, rostersOf, simOf } from './league.js'
import { replacementPlayer, describe } from './offseason.js'
import { marketPrice } from './fa.js'
import { rng } from './sim.js'

export const MIN_ROSTER = 14
// Fifteen STANDARD contracts plus three two-ways. The cap sheets in this game are the real
// ones and they carry both kinds — thirty teams range from twelve to twenty-two rows — so
// fifteen as a hard ceiling would have declared most of the league illegal on day one.
// Fourteen as the floor is the number that matters, and five clubs start below it.
export const MAX_ROSTER = 18
export const MIN_SALARY = 2_300_000

// What a pool player asks for. Nobody in the standing pool is getting the mid-level in
// February — the market has already spoken about them — so the ask is bounded by what the
// remaining exceptions can actually pay.
export function askingPrice(p) {
  const v = Number.isFinite(p.v) ? p.v : 0
  const raw = marketPrice(v, p.a ?? 28, p.mpg ?? 16, p.svc ?? 4)
  return Math.max(MIN_SALARY, Math.round((Number.isFinite(raw) ? raw : MIN_SALARY) * 0.72))
}

// Which exceptions this team can actually use today.
export function exceptionsFor(team, roster) {
  const st = status(teamSalary(roster || rostersOf(team)))
  const out = [{ key: 'min', label: 'Minimum', cap: MIN_SALARY,
    why: 'Always available, to every team, at any point in the year.' }]
  if (st.space > MIN_SALARY) {
    out.unshift({ key: 'room', label: 'Cap room', cap: Math.floor(st.space),
      why: 'You are under the cap. Room can be spent on anybody up to its size.' })
    if (st.space > CBA.mle_room) {
      out.push({ key: 'mle_room', label: 'Room exception', cap: CBA.mle_room,
        why: 'The smaller exception a team keeps after it has spent its room.' })
    }
  } else if (st.overApron2) {
    out.push({ key: 'none', label: 'Second apron', cap: 0, blocked: true,
      why: 'Above the second apron a team may sign nobody but minimum contracts.' })
  } else if (st.overTax || st.overApron1) {
    out.push({ key: 'mle_tax', label: 'Taxpayer mid-level', cap: CBA.mle_tax,
      why: 'The tax-team mid-level. Using it hard-caps you at the first apron for the season.' })
  } else {
    out.push({ key: 'mle_nontax', label: 'Non-taxpayer mid-level', cap: CBA.mle_nontax,
      why: 'The full mid-level. Using it hard-caps you at the first apron for the season.' })
  }
  return out.filter((e) => !e.blocked || out.length === 1)
}

export const maxSigning = (team, roster) =>
  Math.max(...exceptionsFor(team, roster).map((e) => e.cap), MIN_SALARY)

// Can this signing happen, and if not, exactly which rule says no?
export function canSign(save, player, salary) {
  const team = save.franchise.team
  const roster = rostersOf(team)
  // The belt to the pool generator's braces. If a name in the pool is somehow under
  // contract somewhere, signing him would put the same player on two rosters — refuse it
  // and say so, rather than quietly cloning a man.
  const holder = Object.keys(SEED.teams).find((t) => rostersOf(t).some((p) => p.n === player?.n))
  if (holder) {
    return { ok: false, rule: 'Already under contract',
      detail: `${player.n} is on ${holder}'s books. He is not a free agent.` }
  }
  if (roster.length >= MAX_ROSTER) {
    return { ok: false, rule: 'Roster limit',
      detail: `You are carrying ${roster.length}. Fifteen standard deals and three two-ways is the `
        + 'maximum — waive somebody before you sign anybody.' }
  }
  const used = (save.exceptionsUsed || {})
  const opts = exceptionsFor(team, roster).filter((e) => !used[e.key] || e.key === 'min')
  const fit = opts.find((e) => salary <= e.cap)
  if (!fit) {
    const best = Math.max(...opts.map((e) => e.cap), MIN_SALARY)
    return { ok: false, rule: 'No exception fits',
      detail: `The most you can offer today is ${Math.round(best / 1e5) / 10}M. `
        + `${opts.map((e) => e.label).join(', ')} — everything else is spent or unavailable.` }
  }
  return { ok: true, via: fit }
}

// The standing pool.
//
// It is GENERATED, never borrowed. The first version of this seeded the pool from the tail
// of every club's simulation profiles, which produced two bugs at once: the men in it were
// under contract somewhere — the second pick in the draft appeared as a free agent, and
// signing him would have put the same player on two rosters — and their ages were invented
// on the spot, so a nineteen-year-old rookie was listed at thirty-two. The league already
// has a generator for exactly this kind of player, the one that refills a short roster; use
// that, and every man in the pool is genuinely unsigned by construction.
export function seedPool(save, r0) {
  const r = r0 || rng((save.rngSeed ?? 1) ^ 0x5eed)
  const year = save.franchise?.currentSeason ? parseInt(save.franchise.currentSeason, 10) : 2026
  const taken = new Set(Object.keys(SEED.teams).flatMap((t) => rostersOf(t).map((p) => p.n)))
  const out = []
  for (let i = 0; out.length < 24 && i < 120; i++) {
    const p = replacementPlayer(r, i, year)
    if (taken.has(p.sim.n)) continue
    taken.add(p.sim.n)
    out.push({
      ...p.cap,
      n: p.sim.n,
      ...describe(p.sim),
      v: p.cap.v ?? 0,
      mpg: p.sim.mpg,
      s: MIN_SALARY, yr: 1, from: null,
      uid: `pool-${p.sim.id}`,
      sim: p.sim,
      pool: true,
    })
  }
  return out
}

// Nobody in the pool may also be under contract. This is the invariant the first version
// broke, and it is cheap enough to assert every time the screen draws.
export const poolIsClean = (pool) => {
  const contracted = new Set(Object.keys(SEED.teams).flatMap((t) => rostersOf(t).map((p) => p.n)))
  return !(pool || []).some((p) => contracted.has(p.n))
}

export const poolOf = (save) => save.pool || []

// Signing writes to the league, because the roster is the league's, not the screen's.
export function signFromPool(save, player, { salary, years = 1 }) {
  const chk0 = canSign(save, player, salary)
  // A signing the rules refuse is not a signing. Returning the save untouched is the
  // honest failure: the screen already says why, and silently doing it anyway is how a
  // cap game stops meaning anything.
  if (!chk0.ok) return save
  const team = save.franchise.team
  const L = league()
  const cap = {
    ...player, s: salary, yr: years, o: null,
    uid: player.uid || `${team}-sign-${Date.now().toString(36)}`,
    pool: undefined,
  }
  const sim = player.sim
    ? { ...player.sim, n: player.n }
    : { n: player.n, load: Math.min(18, 8 + Math.max(0, (player.v ?? 0)) * 6), v: player.v ?? 0 }
  const rosters = { ...L.rosters, [team]: [...rostersOf(team), cap] }
  const sims = { ...L.sim, [team]: [...simOf(team), sim] }
  L.rosters = rosters
  L.sim = sims
  const used = { ...(save.exceptionsUsed || {}) }
  const chk = canSign(save, player, salary)
  if (chk.ok && chk.via.key !== 'min') used[chk.via.key] = true
  return {
    ...save,
    league: { ...L },
    pool: poolOf(save).filter((p) => (p.uid || p.n) !== (player.uid || player.n)),
    exceptionsUsed: used,
    lastSigning: { name: player.n, salary, via: chk.ok ? chk.via.label : 'minimum' },
  }
}

// Waiving puts a man on the market and leaves his money on your books. That is the whole
// trade-off, and it is why a bad contract is a bad contract.
export function waiveToPool(save, player) {
  const team = save.franchise.team
  const L = league()
  const key = player.uid || player.n
  // Grab his simulation profile BEFORE taking him off the roster — reading it afterwards
  // finds nothing, and he goes onto the market as a name with no player behind it.
  const profile = simOf(team).find((x) => x.n === player.n) || player.sim || null
  L.rosters = { ...L.rosters, [team]: rostersOf(team).filter((p) => (p.uid || p.n) !== key) }
  L.sim = { ...L.sim, [team]: simOf(team).filter((p) => p.n !== player.n) }
  const dead = [...(save.deadMoney || []), { n: player.n, s: player.s, yr: player.yr || 1 }]
  return {
    ...save,
    league: { ...L },
    deadMoney: dead,
    // He keeps his real profile on the way out, so signing him back — by you or by anybody
    // else — restores the player rather than a replacement-level copy of his name.
    pool: [...poolOf(save), { ...player, from: team, pool: true, uid: `pool-${key}`,
      sim: profile }],
  }
}

// The other twenty-nine work the same market. A team below the minimum signs somebody
// today, not in July — which is what stops the league quietly playing shorthanded.
export function cpuFillFromPool(save, r) {
  const L = league()
  const rosters = { ...L.rosters }
  const sims = { ...L.sim }
  let pool = poolOf(save)
  const news = []
  for (const t of Object.keys(SEED.teams)) {
    if (t === save.franchise.team) continue
    while ((rosters[t] || []).length < MIN_ROSTER && pool.length) {
      const best = pool.reduce((b, p) => (!b || (p.v ?? 0) > (b.v ?? 0) ? p : b), null)
      pool = pool.filter((p) => p !== best)
      rosters[t] = [...(rosters[t] || []), { ...best, s: MIN_SALARY, yr: 1, pool: undefined,
        uid: `${t}-sign-${(r ? r.randrange(1e6) : Math.floor(Math.random() * 1e6)).toString(36)}` }]
      sims[t] = [...(sims[t] || []), { n: best.n, load: 10, v: best.v ?? 0 }]
      news.push(`${SEED.teams[t]?.name || t} sign <b>${best.n}</b> to fill the roster.`)
    }
  }
  L.rosters = rosters
  L.sim = sims
  return { ...save, league: { ...L }, pool, poolNews: news.slice(0, 3) }
}

// What the home screen shows in red when you are a man short.
export function rosterCheck(save) {
  const n = rostersOf(save.franchise.team).length
  if (n < MIN_ROSTER) {
    return { ok: false, short: MIN_ROSTER - n, n,
      detail: `You are carrying ${n}. The league minimum is ${MIN_ROSTER} — sign ${MIN_ROSTER - n} more from the open market.` }
  }
  if (n > MAX_ROSTER) {
    return { ok: false, over: n - MAX_ROSTER, n,
      detail: `You are carrying ${n}. Eighteen is the maximum — waive ${n - MAX_ROSTER}.` }
  }
  return { ok: true, n }
}
