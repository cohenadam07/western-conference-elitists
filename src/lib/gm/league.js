// THE LEAGUE.
//
// Thirty rosters, thirty sets of simulation profiles, and one pick ledger — all of it
// mutable, all of it owned by the career rather than read out of the static seed.
//
// This existed as a bug for a long time and it was the worst kind: the career carried the
// user's roster and read the other twenty-nine straight from the seed, so a player you
// traded for stayed on his old team forever. The deadline then offered him to you again —
// Tyrese Maxey for Tyrese Maxey — and no CPU team could ever change. A league where only
// one roster moves is not a league.
import { SEED } from './seed.js'
import { volatilityFor, youthPenalty, ROOKIE_DEF_PENALTY, ROOKIE_TOV_PENALTY } from './form.js'
import { repair as repairRookie, isRookieRow, classScale, stealRate, blockRate } from './rookies.js'

// The cap sheet says who is on the team THIS season; the simulation profiles say how each
// player played LAST season, listed under the team he played for then. Pairing them by team
// was wrong twice over:
//
//   * anyone who changed teams in the offseason sat on his new team's cap sheet and his old
//     team's simulation roster, so neither team could play him;
//   * and "Nikola Jokic" in the profiles never matched "Nikola Jokic" with an accent on the
//     cap sheet.
//
// Ninety-three rotation players were on a payroll and not on the floor. Denver simulated
// its season without Nikola Jokic. The contract is the source of truth for employment, so
// profiles are now matched TO contracts, by normalised name, across the whole league.
function norm(n) {
  return String(n || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[.'\u2018\u2019`]/g, '').replace(/-/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ').trim()
}

// A profile for a contract with no season on record — a rookie, a two-way conversion, a
// star who missed the whole year. Built from what the cap sheet does know about him, so he
// plays like himself rather than not at all.
function profileFrom(c) {
  const bpm = typeof c.bpm === 'number' ? c.bpm : -1.5
  const mpg = Math.max(8, Math.min(36, c.mpg || 16))
  const av = (c.av ?? 75) / 100
  // A man who has never played a professional game is bad at the two things every rookie is
  // bad at, and the seed's own draftees were the only ones getting that treatment — the
  // thirty-four already on cap sheets when the career starts were arriving as finished
  // players. Same penalty, same curve, applied wherever the profile is synthetic.
  const youth = c.rookie ? youthPenalty(c.a) : 0
  const dPen = youth * ROOKIE_DEF_PENALTY
  return {
    id: c.pid || `syn-${c.uid}`,
    n: c.n,
    mpg,
    load: Math.max(4, mpg * av),
    usg: Math.max(0.09, Math.min(0.34, 0.14 + (bpm + 2) * 0.017 + ((c.sc ?? 45) - 45) * 0.0016)),
    fg3r: Math.max(0.05, Math.min(0.78, 0.16 + ((c.sh ?? 45) / 100) * 0.6)),
    fg3: Math.max(0.24, Math.min(0.42, 0.30 + ((c.sh ?? 45) - 50) * 0.0011)),
    fg2: Math.max(0.40, Math.min(0.66, 0.51 + ((c.rpr ?? 50) - 50) * 0.0009)),
    ft: 0.76,
    ftr: Math.max(0.08, Math.min(0.45, 0.18 + ((c.rpr ?? 50) - 50) * 0.0022)),
    tov: Math.max(0.06, Math.min(0.24,
      (0.145 - ((c.bs ?? 50) - 50) * 0.0008) * (1 + youth * ROOKIE_TOV_PENALTY))),
    oreb: Math.max(0.008, Math.min(0.12, 0.02 + ((c.sz ?? 50) - 50) * 0.0011)),
    dreb: Math.max(0.05, Math.min(0.3, 0.11 + ((c.sz ?? 50) - 50) * 0.0018)),
    ast: Math.max(0.04, Math.min(0.42, 0.09 + ((c.pm ?? 45) - 45) * 0.0035)),
    // The penalty lands where a rookie is actually a rookie: on-ball and on the weak side,
    // where the whole job is knowing in advance where the ball is going. Rim protection is
    // mostly length and standing reach, which a nineteen-year-old already has — so it takes
    // a quarter of it, and none of these can be driven through the floor.
    // Real rates where the man has one, and his college rates scaled to the NBA where he
    // has only ever played in college. Without these a rookie never steals or blocks
    // anything, because the engine credits by rate and his would be zero.
    stlr: c.stlr ?? (c.col ? stealRate(c.col) : 1.7),
    blkr: c.blkr ?? (c.col ? blockRate(c.col) : 1.8),
    dr: Math.max(5, (c.rp ?? 45) - dPen * 0.25),
    dp: Math.max(5, (c.pd ?? 45) - dPen),
    de: Math.max(5, 45 + (bpm + 2) * 4 - dPen * 0.75),
    synthetic: true,
  }
}

// Fifty-nine contracts carry no skill vector — draftees and two-way conversions who have
// never played an NBA game, so there is nothing to measure. Left empty they are invisible
// to everything built on those axes: no badges, no read from the fit model, and a training
// camp emphasis that silently does nothing to the youngest players on the roster, which is
// precisely who it should help most.
//
// So they get a profile shaped by POSITION and scaled by how good the cap sheet thinks
// they are. It is a prior, not a measurement, and it is marked as one.
const ARCH_BY_SLOT = [
  [1.8, 'Pass-First Guard', { sh: 46, gr: 44, rp: 20, pd: 47, pm: 62, sc: 52, sz: 28, rpr: 52, bs: 58 }],
  [2.6, 'Combo Guard', { sh: 56, gr: 54, rp: 22, pd: 48, pm: 54, sc: 62, sz: 32, rpr: 58, bs: 50 }],
  [3.5, '3&D Role Player', { sh: 58, gr: 46, rp: 36, pd: 60, pm: 40, sc: 42, sz: 50, rpr: 46, bs: 52 }],
  [4.3, 'Role Big', { sh: 42, gr: 42, rp: 60, pd: 44, pm: 40, sc: 38, sz: 68, rpr: 54, bs: 50 }],
  [9, 'Rim-Running Big', { sh: 26, gr: 36, rp: 72, pd: 36, pm: 32, sc: 30, sz: 78, rpr: 68, bs: 48 }],
]

function fillSkills(c) {
  const KEYS = ['sh', 'gr', 'rp', 'pd', 'pm', 'sc', 'sz', 'rpr', 'bs']
  if (KEYS.some((k) => typeof c[k] === 'number')) return c
  const slot = typeof c.slot === 'number' ? c.slot
    : ({ PG: 1.2, SG: 2.2, SF: 3.1, PF: 4.1, C: 4.9 }[c.pos] ?? 3)
  const [, arch, base] = ARCH_BY_SLOT.find(([hi]) => slot < hi) || ARCH_BY_SLOT[2]
  // Better players are better at their archetype's own strengths, not uniformly better.
  const lift = Math.max(-8, Math.min(14, ((c.bpm ?? -1.5) + 2) * 3.2))
  const out = { ...c, arch: c.arch || arch, inferredSkills: true }
  for (const k of KEYS) {
    const emphasis = (base[k] - 50) / 50
    out[k] = Math.max(5, Math.min(95, Math.round(base[k] + lift * (0.7 + 0.5 * emphasis))))
  }
  return out
}

// FIVE MEN ARE ON TWO CAP SHEETS AT ONCE.
//
// Not a near-miss or a name collision: Bradley Beal is on the Clippers and on Phoenix, in
// rows that are byte-identical down to the salary. Damian Lillard is on Milwaukee and on
// Portland. Two clubs pay each of them, both clubs play them, and the league quietly
// carries five players who do not exist.
//
// It survived a long time because nothing ever counted anybody twice. It surfaced the day
// the season started keeping box scores: a handful of players had appeared in more than
// eighty-two games, five teams were somehow playing more than two hundred and forty minutes
// a night and five were playing fewer, and the arithmetic could not be argued with.
//
// The two copies are identical, so nothing in the data says which one is live — this is a
// fact about the world, and it is resolved as one. Each of the five was waived or traded and
// the seed kept the row he left behind:
//
//   Bradley Beal              waived by Phoenix, signed with the Clippers
//   Damian Lillard            waived by Milwaukee, signed back in Portland
//   Klay Thompson             left Dallas for Miami
//   Kentavious Caldwell-Pope  left Memphis for Philadelphia
//   Olivier-Maxence Prosper   left Dallas for Memphis
//
// Fixed here rather than in the seed, because the seed is generated and a hand edit would
// not survive the next regeneration.
const DOUBLE_BOOKED = {
  'bradley beal': 'LAC',
  'damian lillard': 'POR',
  'klay thompson': 'MIA',
  'kentavious caldwell pope': 'PHI',
  'olivier maxence prosper': 'MEM',
}

// Who is on two cap sheets, and where each of them was sent. Exported so a test can say
// what it found rather than only that something is wrong — a duplicate that is NOT in the
// table above is a new one, and the test names it instead of letting it through.
export function doubleBooked() {
  const where = new Map()
  for (const team of Object.keys(SEED.teams)) {
    for (const p of SEED.rosters[team] || []) {
      const k = norm(p.n)
      if (!where.has(k)) where.set(k, { n: p.n, teams: [] })
      const e = where.get(k)
      if (!e.teams.includes(team)) e.teams.push(team)
    }
  }
  return [...where.values()].filter((e) => e.teams.length > 1)
    .map((e) => ({ ...e, keep: DOUBLE_BOOKED[norm(e.n)] || [...e.teams].sort()[0],
      listed: !!DOUBLE_BOOKED[norm(e.n)] }))
}

export function newLeague(season = SEED.season) {
  const startYear = parseInt(String(season), 10) || 2026
  const index = new Map()
  for (const t of Object.keys(SEED.sim || {})) {
    for (const p of SEED.sim[t] || []) {
      const k = norm(p.n)
      if (!index.has(k)) index.set(k, p)
    }
  }
  const elsewhere = new Map()
  for (const d of doubleBooked()) elsewhere.set(norm(d.n), d.keep)

  // A draft class is argued relatively — the best shooter in the room, the best passer — so
  // the whole class is ranked once, here, before anybody is built. Ranking per player would
  // mean each rookie was measured against a different set.
  const scale = classScale(Object.values(SEED.rosters).flat().filter(isRookieRow))

  const rosters = {}, sim = {}
  for (const team of Object.keys(SEED.teams)) {
    // The seed contains two duplicated contracts — Jonathan Isaac appears twice for
    // Orlando and Haywood Highsmith twice for Phoenix, same salary, same everything. Two
    // clubs were paying real money for a player who does not exist twice, the development
    // report keyed by id silently dropped one of the pair, and it surfaced only as a React
    // duplicate-key warning on a random career seed. Deduplicated here rather than in the
    // seed file, because the seed is generated and a hand edit would not survive the next
    // regeneration.
    const seen = new Set()
    const roster = (SEED.rosters[team] || [])
      .filter((p) => {
        const k = norm(p.n)
        if (seen.has(k)) return false
        // And the league-wide version of the same problem: a man on two clubs' books plays
        // for the one he actually signed with. An unlisted duplicate still resolves — to the
        // alphabetically first club, so it is at least deterministic — and the league test
        // names it so it does not stay unlisted for long.
        const both = elsewhere.get(k)
        if (both && both !== team) return false
        seen.add(k)
        return true
      })
      // Rookies first, so the class is rebuilt from the draft board before the generic
      // archetype filler ever sees it — left to fillSkills they all came out identical.
      .map((p, i) => fillSkills(repairRookie({ ...p, uid: p.uid || `${team}-${i}` },
        startYear, scale)))
    rosters[team] = roster
    // Carry the cap sheet's spelling forward so every later lookup matches by name.
    sim[team] = roster.map((c) => {
      const hit = index.get(norm(c.n))
      const prof = hit ? { ...hit, n: c.n } : profileFrom(c)
      // How much this man swings from night to night, carried on the profile so the season
      // can read it on game day. A young high-usage player is a different player from
      // evening to evening; a settled veteran mostly is not.
      // Nobody is structurally incapable. A handful of men measured a flat zero last
      // season — an injury year, a nine-game call-up — and a zero rate would mean the engine
      // could never credit them a steal or a block for as long as the career runs, which is
      // a different claim from "he did not get one last year".
      //
      // `||` and not `??` ON PURPOSE: zero and missing are treated the same, which is exactly
      // what `raw(p, "stlpct", 1.7) or 1.7` does on the Python side. The two runtimes have to
      // arrive at the same number for the same man or the replay check is worthless, and
      // matching Python's falsy `or` is how they do it.
      return { ...prof,
        stlr: prof.stlr || 1.7,
        blkr: prof.blkr || 1.8,
        vol: volatilityFor(c, prof) }
    })
  }
  return { season, rosters, sim }
}

// The live league for this career. A module-level handle rather than a parameter threaded
// through forty call sites — but set explicitly, never implicitly, so a test or a soak run
// can hold its own and two careers can never share one.
let CURRENT = null

export function setLeague(l) { CURRENT = l; return l }
export function league() { return CURRENT || (CURRENT = newLeague()) }
export function resetLeague() { CURRENT = null }

export const rostersOf = (team) => league().rosters[team] || []
export const simOf = (team) => league().sim[team] || []
export const allRosters = () => league().rosters
export const allSim = () => league().sim

// Who is on this team, from the career rather than from the seed.
export const teamsIn = () => Object.keys(league().rosters)

// Sim profiles for a team, dropped to those actually under contract. The cap sheet is the
// source of truth for employment; Savant rosters carry more names than there are deals.
export function playableSim(team) {
  const onBooks = new Set(rostersOf(team).map((p) => p.n))
  return simOf(team).filter((p) => onBooks.has(p.n))
}

// The user's own roster and profiles, from the league.
export const rosterOf = (save) => (save?.league?.rosters?.[save.franchise.team])
  || rostersOf(save?.franchise?.team)
export const mySimOf = (save) => (save?.league?.sim?.[save.franchise.team])
  || simOf(save?.franchise?.team)

/* ------------------------------------------------------------ saves made yesterday */

// A CAREER CARRIES ITS OWN FROZEN LEAGUE, AND THAT IS THE POINT.
//
// Everything the user does — a trade, a signing, six years of aging — happens to the league
// stored on the save, not to the seed. Which is right, and which also means that fixing a bug
// in how the league is BUILT does nothing for anybody already playing. Cameron Boozer was
// forty-four years old in the seed; he was rebuilt from his real birthday and his Duke
// season; and he stayed forty-four for everyone who had already started a franchise, because
// their forty-four-year-old was written to disk weeks ago.
//
// So a save is repaired on load. The rule is narrow on purpose: REPLACE ONLY WHAT IS
// DEMONSTRABLY BROKEN, and fill in what is merely missing. Rebuilding wholesale would be
// easy and would quietly erase the thing the save exists for — three seasons of development,
// the trade the user is proud of, the twenty-two-year-old who is now good.
//
// `dataRev` is the version of the seed-derived facts. Bump it whenever the pipeline learns
// something a live career should be told about.
export const DATA_REV = 3

const plausibleAge = (a) => typeof a === 'number' && a >= 17 && a <= 45

// A row is broken if it cannot be true of anybody: an impossible age, a first-year player
// carrying somebody else's professional season, or a man with nowhere to play.
function isBroken(p, years) {
  if (!plausibleAge(p.a)) return true
  if (p.stale && (p.exp === 0 || p.rookie_slot != null)) return true
  if ((p.exp === 0 || p.rookie) && p.a > 25.5 + years) return true
  return false
}

export function migrateLeague(league, opts = {}) {
  if (!league || !league.rosters) return league
  const years = Math.max(0, opts.seasonsElapsed || 0)
  const startYear = parseInt(String(SEED.season), 10) || 2026
  const seedRows = new Map()
  for (const t of Object.keys(SEED.rosters || {})) {
    for (const p of SEED.rosters[t] || []) seedRows.set(norm(p.n), p)
  }
  const seedSim = new Map()
  for (const t of Object.keys(SEED.sim || {})) {
    for (const p of SEED.sim[t] || []) seedSim.set(norm(p.n), p)
  }
  const scale = classScale(Object.values(SEED.rosters).flat().filter(isRookieRow))

  const rosters = {}, sim = {}
  const fixed = []
  for (const team of Object.keys(league.rosters)) {
    rosters[team] = (league.rosters[team] || []).map((p) => {
      const seedRow = seedRows.get(norm(p.n))
      if (!seedRow) return p
      const broken = isBroken(p, years)
      if (broken && isRookieRow(seedRow)) {
        // Rebuild the identity and the ratings from the season he really played, then hand
        // back the years the career has already run. His contract, his club and everything
        // the user did to him are the save's and stay the save's.
        const fresh = repairRookie({ ...seedRow }, startYear, scale)
        fixed.push(`${p.n} ${p.a} -> ${(fresh.a + years).toFixed(2)}`)
        return {
          ...p,
          ...pickIdentity(fresh),
          a: Math.round((fresh.a + years) * 100) / 100,
          stale: undefined,
        }
      }
      if (broken) {
        // Not a draftee — the only thing that can be salvaged honestly is the age, from the
        // seed's own row plus the seasons this career has run.
        if (plausibleAge(seedRow.a)) {
          fixed.push(`${p.n} ${p.a} -> ${(seedRow.a + years).toFixed(2)}`)
          return { ...p, a: Math.round((seedRow.a + years) * 100) / 100, stale: undefined }
        }
        return p
      }
      // Not broken — only fill what is absent, never overwrite what the career has earned.
      const add = {}
      if (!p.pos && typeof p.slot !== 'number' && typeof seedRow.slot === 'number') {
        add.pos = seedRow.pos; add.slot = seedRow.slot
      }
      if (!p.comps && seedRow.comps) add.comps = seedRow.comps
      return Object.keys(add).length ? { ...p, ...add } : p
    })

    sim[team] = (league.sim?.[team] || []).map((p) => {
      // Steal and block rates did not exist when older saves were written, and without them
      // the possession engine can never credit anybody either — a whole career of games with
      // no steals and no blocks in any box score.
      if (p.stlr > 0 && p.blkr > 0) return p
      const s = seedSim.get(norm(p.n))
      const cap = rosters[team].find((c) => norm(c.n) === norm(p.n))
      return {
        ...p,
        stlr: p.stlr || s?.stlr || (cap?.col ? stealRate(cap.col) : 1.7),
        blkr: p.blkr || s?.blkr || (cap?.col ? blockRate(cap.col) : 1.8),
      }
    })
  }
  return { ...league, rosters, sim, $fixed: fixed }
}

// The parts of a rebuilt row that describe WHO HE IS rather than what the career did to him.
const IDENTITY = ['pos', 'slot', 'ht', 'arch', 'upside', 'floor', 'stlr', 'blkr', 'board',
  'sh', 'gr', 'rp', 'pd', 'pm', 'sc', 'sz', 'rpr', 'bs']
function pickIdentity(fresh) {
  const out = {}
  for (const k of IDENTITY) if (fresh[k] !== undefined) out[k] = fresh[k]
  return out
}
