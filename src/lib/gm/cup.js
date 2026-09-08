// THE NBA CUP.
//
// The real tournament, with the real rules:
//
//   - Thirty teams in six groups of five, three per conference, drawn from pots by the
//     previous season's record so every group has a strong team and a weak one.
//   - Group play is four games — one against each team in your group — played on
//     designated nights in November. They are ordinary regular-season games as well: they
//     count in the standings and they count in the group table.
//   - The six group winners advance, plus one wild card per conference: the best
//     second-placed team, which is why a team can lose its group and still get in.
//   - Knockout is single elimination. Quarter-finals are hosted by the better seed;
//     the semi-finals and the final are at a neutral site.
//   - The quarter-finals and semi-finals count in the regular-season record. THE FINAL
//     DOES NOT — the two teams that reach it play 83 games and are credited with 82.
//
//   - Group tiebreakers, in order: head-to-head, point differential in group play, total
//     points scored in group play, then the previous season's record.
import { SEED } from './seed.js'

export const GROUP_GAMES = 4
export const GROUPS_PER_CONF = 3
export const GROUP_SIZE = 5
export const CUP_NAME = 'NBA Cup'

const TEAMS = () => Object.keys(SEED.teams)
const conf = (t) => SEED.teams[t]?.conf

// The draw. Teams are sorted by last season's record inside their conference and dealt into
// pots — best five in pot one, next five in pot two, and so on — then one team from each pot
// goes into each group. That is how the real draw works and it is why no group is a walkover.
export function drawGroups(r, standingsLastYear = null) {
  const groups = []
  for (const c of ['East', 'West']) {
    const teams = TEAMS().filter((t) => conf(t) === c)
    const rank = (t) => (standingsLastYear && standingsLastYear[t] != null
      ? -standingsLastYear[t]
      : r.rand())
    const ordered = teams.slice().sort((a, b) => rank(a) - rank(b))
    // Five pots of three.
    const pots = [0, 1, 2, 3, 4].map((i) => ordered.slice(i * GROUPS_PER_CONF, (i + 1) * GROUPS_PER_CONF))
    for (const pot of pots) r.shuffle(pot)
    for (let g = 0; g < GROUPS_PER_CONF; g++) {
      groups.push({
        id: `${c === 'East' ? 'E' : 'W'}${g + 1}`,
        conf: c,
        teams: pots.map((pot) => pot[g]).filter(Boolean),
      })
    }
  }
  return groups
}

export const groupOf = (groups, team) => groups.find((g) => g.teams.includes(team)) || null

// Every intra-group pairing, which is exactly the set of games the group stage is made of.
export function groupPairings(groups) {
  const out = []
  for (const g of groups) {
    for (let i = 0; i < g.teams.length; i++) {
      for (let j = i + 1; j < g.teams.length; j++) out.push({ group: g.id, a: g.teams[i], b: g.teams[j] })
    }
  }
  return out
}

// ------------------------------------------------------------------ the tables

export function groupTable(group, results) {
  const rows = group.teams.map((t) => ({ team: t, w: 0, l: 0, pf: 0, pa: 0, h2h: {} }))
  const by = new Map(rows.map((x) => [x.team, x]))
  for (const g of results) {
    if (!by.has(g.home) || !by.has(g.away)) continue
    const h = by.get(g.home), a = by.get(g.away)
    const homeWon = g.hs > g.as
    h.w += homeWon ? 1 : 0; h.l += homeWon ? 0 : 1
    a.w += homeWon ? 0 : 1; a.l += homeWon ? 1 : 0
    h.pf += g.hs; h.pa += g.as
    a.pf += g.as; a.pa += g.hs
    h.h2h[a.team] = (h.h2h[a.team] || 0) + (homeWon ? 1 : 0)
    a.h2h[h.team] = (a.h2h[h.team] || 0) + (homeWon ? 0 : 1)
  }
  rows.forEach((x) => { x.diff = x.pf - x.pa })
  rows.sort((x, y) => (
    y.w - x.w
    // Head-to-head between exactly these two, then point differential in group play, then
    // total points scored. The real order, and it matters: two 3-1 teams are separated by
    // the game they played against each other before anything else is looked at.
    || (y.h2h[x.team] ?? 0) - (x.h2h[y.team] ?? 0)
    || y.diff - x.diff
    || y.pf - x.pf
    || x.team.localeCompare(y.team)
  ))
  return { id: group.id, conf: group.conf, rows }
}

// Six winners plus the best runner-up in each conference.
export function qualifiers(groups, results) {
  const tables = groups.map((g) => groupTable(g, results))
  const winners = tables.map((t) => ({ ...t.rows[0], group: t.id, conf: t.conf, seedIn: 'winner' }))
  const wilds = []
  for (const c of ['East', 'West']) {
    const seconds = tables.filter((t) => t.conf === c).map((t) => ({ ...t.rows[1], group: t.id, conf: c }))
      .filter(Boolean)
    seconds.sort((x, y) => y.w - x.w || y.diff - x.diff || y.pf - x.pf || x.team.localeCompare(y.team))
    if (seconds[0]) wilds.push({ ...seconds[0], seedIn: 'wildcard' })
  }
  const field = [...winners, ...wilds]
  // Seeding inside each conference: group winners ahead of the wild card, then by record.
  const byConf = {}
  for (const c of ['East', 'West']) {
    byConf[c] = field.filter((x) => x.conf === c)
      .sort((x, y) => (x.seedIn === y.seedIn ? 0 : x.seedIn === 'winner' ? -1 : 1)
        || y.w - x.w || y.diff - x.diff)
      .map((x, i) => ({ ...x, seed: i + 1 }))
  }
  return { tables, field: [...byConf.East, ...byConf.West], byConf }
}

// ---------------------------------------------------------------- the knockout

export const ROUNDS = [
  { key: 'qf', name: 'Quarter-finals', where: 'in the higher seed’s building', counts: true },
  { key: 'sf', name: 'Semi-finals', where: 'in Las Vegas', counts: true },
  { key: 'final', name: 'The Final', where: 'in Las Vegas', counts: false },
]

// One-and-done, so a bracket is just a list of ties with a winner each.
export function openKnockout(byConf) {
  const ties = []
  for (const c of ['East', 'West']) {
    const s = byConf[c]
    // 1 v 4 and 2 v 3 inside the conference, which keeps East and West apart until Vegas.
    ties.push({ round: 'qf', conf: c, hi: s[0]?.team, lo: s[3]?.team })
    ties.push({ round: 'qf', conf: c, hi: s[1]?.team, lo: s[2]?.team })
  }
  return { stage: 'qf', ties: ties.filter((t) => t.hi && t.lo), champion: null }
}

export function advanceKnockout(kn) {
  const done = kn.ties.filter((t) => t.round === kn.stage)
  if (done.some((t) => !t.winner)) return kn
  if (kn.stage === 'qf') {
    for (const c of ['East', 'West']) {
      const w = done.filter((t) => t.conf === c).map((t) => t.winner)
      if (w.length === 2) kn.ties.push({ round: 'sf', conf: c, hi: w[0], lo: w[1], neutral: true })
    }
    kn.stage = 'sf'
    return kn
  }
  if (kn.stage === 'sf') {
    const finalists = done.map((t) => t.winner)
    if (finalists.length === 2) {
      kn.ties.push({ round: 'final', conf: 'Final', hi: finalists[0], lo: finalists[1], neutral: true })
    }
    kn.stage = 'final'
    return kn
  }
  if (kn.stage === 'final') {
    kn.champion = done[0]?.winner || null
    kn.stage = 'done'
  }
  return kn
}

export const roundName = (k) => (ROUNDS.find((x) => x.key === k) || {}).name || k
export const roundCounts = (k) => !!(ROUNDS.find((x) => x.key === k) || {}).counts

// ------------------------------------------------------------------- the banner
//
// Winning it is worth something and the user decides what. Raise the banner and the team
// plays harder for a fortnight — a real, small, temporary lift. Decline it and the club
// carries the slight instead: if it then wins something the players consider worth a
// banner, the boost is bigger and it lasts into the following autumn.
export const CUP_BOOST = { pct: 0.03, days: 14 }
export const DEFERRED_BOOST = { pct: 0.045, days: 60 }

export function raiseBanner(save, { raised, day }) {
  const banners = [...(save.banners || []), { kind: 'cup', season: save.franchise.currentSeason, raised }]
  return {
    ...save,
    banners,
    // `pending` is the promise the players are holding you to.
    cupBanner: { raised, season: save.franchise.currentSeason },
    morale: raised
      ? { ...(save.morale || {}), boost: CUP_BOOST.pct, until: (day ?? 0) + CUP_BOOST.days,
          why: 'Cup banner raised' }
      : (save.morale || {}),
    deferredBanner: raised ? (save.deferredBanner || null)
      : { from: 'cup', season: save.franchise.currentSeason },
  }
}

// What the team is playing at today, as a multiplier on its own profiles.
export function moraleNow(save, day) {
  const m = save?.morale
  if (!m || !m.boost) return { mult: 1, why: null }
  if (typeof m.until === 'number' && (day ?? 0) > m.until) return { mult: 1, why: null }
  return { mult: 1 + m.boost, why: m.why || 'Riding something' }
}
