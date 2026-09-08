// Career persistence. Local for now, but the shape is the one career.py writes, so the
// same document moves to a server (Upstash, like api/dynasty.js) without a migration.
import { DEFAULT_GM } from './gmProfile.js'
import { SEED } from './seed.js'
import { newPickLedger, rebuildLedger, strengthRanks } from './picks.js'
import { newLeague, setLeague, migrateLeague, DATA_REV } from './league.js'
import { makeFrontOffices } from './trade/agents.js'
import { makeScoutMarket } from './scouts.js'
import { seedPool } from './pool.js'
import { autoRotation } from './rotation.js'
import { bandOf, ratePerMin, teamContext } from './trade/context.js'

// ---------------------------------------------------------------- franchises
//
// Three save slots, not one. A GM game you cannot walk away from is a GM game you can
// only ever play once — the interesting question ("what would this roster look like if I
// had blown it up instead?") requires a second file to answer. The old single-key save is
// migrated into slot 1 the first time this module runs, so nobody loses a career to the
// upgrade.

const LEGACY_KEY = 'wce.gm.career.v1'
const INDEX_KEY = 'wce.gm.franchises.v1'
export const MAX_FRANCHISES = 3
export const SLOTS = [1, 2, 3]
const slotKey = (n) => `${LEGACY_KEY}.s${n}`
export const SAVE_VERSION = 2

const ls = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v); return true } catch { return false } },
  del(k) { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}

function readIndex() {
  try {
    const ix = JSON.parse(ls.get(INDEX_KEY) || 'null')
    if (ix && typeof ix === 'object') return { active: SLOTS.includes(ix.active) ? ix.active : null }
  } catch { /* ignore */ }
  return { active: null }
}

const writeIndex = (ix) => ls.set(INDEX_KEY, JSON.stringify(ix))

// The migration runs once, and only when slot 1 is genuinely empty: re-running it would
// overwrite a newer career with a stale one.
let migrated = false
function migrateLegacy() {
  if (migrated) return
  migrated = true
  const raw = ls.get(LEGACY_KEY)
  if (!raw) return
  if (!ls.get(slotKey(1))) {
    ls.set(slotKey(1), raw)
    const ix = readIndex()
    if (!ix.active) writeIndex({ active: 1 })
  }
  ls.del(LEGACY_KEY)
}

function readSlot(n) {
  migrateLegacy()
  try {
    const raw = ls.get(slotKey(n))
    if (!raw) return null
    const save = JSON.parse(raw)
    if (!save || save.schema !== SAVE_VERSION || !save.league) return null
    return save
  } catch {
    return null
  }
}

// What the franchise picker shows without loading a whole league into memory: who you
// are, where you are, and how it has gone.
export function summaryOf(save) {
  if (!save) return null
  const r = save.records || {}
  return {
    slot: save.slot ?? null,
    team: save.franchise?.team ?? null,
    gm: save.gm?.name || 'General manager',
    avatar: save.gm || null,
    season: save.franchise?.currentSeason ?? null,
    hired: save.franchise?.hiredSeason ?? null,
    phase: save.phase || 'camp',
    mode: save.controlSurface?.preset || 'custom',
    seasons: r.seasonsCompleted || 0,
    wins: r.totalWins || 0,
    losses: r.totalLosses || 0,
    titles: r.championships || 0,
    playoffs: r.playoffAppearances || 0,
    employed: save.status?.employed !== false,
    updatedAt: save.updatedAt || null,
  }
}

// Always three entries, in slot order — an empty slot is a real thing the menu draws, not
// an absence it has to infer from a short list.
export function franchises() {
  migrateLegacy()
  return SLOTS.map((slot) => ({ slot, summary: summaryOf(readSlot(slot)) }))
}

export function activeSlot() {
  migrateLegacy()
  return readIndex().active
}

export function setActiveSlot(slot) {
  writeIndex({ active: SLOTS.includes(slot) ? slot : null })
}

export const firstEmptySlot = () => (franchises().find((f) => !f.summary) || {}).slot ?? null

// What ownership asks of a club, from what the club actually is. Thresholds sit on the
// projected-wins curve the fit model produces, so a genuine contender is told to win it and
// a genuine rebuild is told to develop.
export function mandateFor(team) {
  let wins = 41
  try { wins = teamContext(team, { phase: 'offseason' }).wins } catch { /* seed-only fallback */ }
  if (wins >= 54) return 'title'
  if (wins >= 47) return 'win_round'
  if (wins >= 36) return 'playoffs'
  return 'develop'
}

export function newCareer({ gm, team, preset, levels, season = '2026-27', seed: fixed, slot, realPicks }) {
  // The league has to exist before the rotation can be drawn from it.
  const league = setLeague(newLeague(season))
  // A real career gets a random seed. A test passes its own, so that a soak run is
  // reproducible: an invariant suite that reports 36/36 on one run and 34/36 on the next
  // is not an invariant suite, it is a rumour.
  const seed = fixed ?? Math.floor(Math.random() * 2 ** 31)
  return {
    // THE WHOLE LEAGUE is career state, not just your team. Carrying only the user's
    // roster and reading the other twenty-nine out of the seed meant a player you traded
    // for never actually left his old team — the deadline would offer him to you again,
    // and no CPU team could ever change shape.
    //
    // Every contract gets a stable id. Matching players by name — even name plus salary —
    // is a bug waiting to happen: a trade that sent Keon Ellis out and brought a different
    // Keon Ellis in on the same salary removed the wrong row. Ids end the whole class of it.
    league,
    // Start on the coach's rotation rather than an empty one: the screen is for ADJUSTING
    // minutes, and handing somebody 240 unassigned minutes is a puzzle, not a decision.
    rotation: autoRotation(league.rosters[team] || [], league.sim[team] || [], bandOf, ratePerMin),
    // Twenty-nine other front offices, each with its own tastes and its own scouting
    // error. Drawn once from the career seed so a league is consistent and two careers
    // are not the same league.
    frontOffices: makeFrontOffices(seed),
    // The scouting department: who is available to hire, who you employ, and which
    // prospects you have spent workouts on. A board is only as good as this.
    scoutMarket: makeScoutMarket(seed),
    scouts: makeScoutMarket(seed).slice(6, 9),
    workouts: {},
    // The open market never closes. A roster can fall below fourteen in December through a
    // trade or a waiver, and the minimum-salary pool is how that gets fixed.
    pool: seedPool({ rngSeed: seed }),
    exceptionsUsed: {},
    phase: 'camp',
    camp: {},
    // The pick ledger is career state. Rebuilding it at render time meant a traded pick
    // reappeared the next time the page drew itself.
    // Real ownership by default: the league as it actually stands, hoards and protections
    // and forfeited picks included. `realPicks: false` hands every team its own back.
    picks: rebuildLedger(newPickLedger(season, { real: realPicks !== false }), strengthRanks(null)),
    realPicks: realPicks !== false,
    schema: SAVE_VERSION,
    dataRev: DATA_REV,
    // Which of the three files this career lives in. Stamped once, so every later save
    // writes back to the slot it came from rather than to whichever one is active.
    slot: SLOTS.includes(slot) ? slot : (firstEmptySlot() ?? 1),
    updatedAt: Date.now(),
    careerId: `${team}-${seed.toString(36)}`,
    gm: { ...DEFAULT_GM, ...gm },
    franchise: { team, hiredSeason: season, currentSeason: season },
    controlSurface: { preset, levels },
    rngSeed: seed,
    seasons: [],
    records: {
      championships: 0, finalsAppearances: 0, conferenceTitles: 0,
      playoffSeriesWon: 0, playoffAppearances: 0,
      bestRecord: null, worstRecord: null,
      totalWins: 0, totalLosses: 0, seasonsCompleted: 0, fastestTitle: null,
      tradesMade: 0,
    },
    badges: [],
    // The mandate is set from the roster you are actually handed, not from a constant.
    // Telling a 21-win rebuild to make the playoffs is not a hard job, it is an incoherent
    // one — and it made the advisor grade every bad team an F on day one for a target
    // nobody sane would have set them.
    // The one-word key stays, because trust, the advisor and the report all read it. What
    // is new is the mandate itself: a target derived from this roster rather than looked up
    // in a table of four, and two or three objectives drawn from the actual players and the
    // actual pick ledger. See mandate.js.
    status: { employed: true, ownerConfidence: 0, mandate: mandateFor(team) },
  }
}

// Loading a career makes it the active one AND installs its league. Both halves matter:
// the league module is a singleton, so opening slot 2 while slot 1's rosters are still
// installed would value slot 2's trades against slot 1's league.
export function loadCareer(slot) {
  const n = SLOTS.includes(slot) ? slot : activeSlot()
  if (!n) return null
  const save = readSlot(n)
  if (!save) {
    if (activeSlot() === n) setActiveSlot(null)
    return null
  }
  if (!SLOTS.includes(save.slot)) save.slot = n
  setActiveSlot(n)
  // A save older than the current seed facts gets repaired on the way in — narrowly, only
  // what is demonstrably broken. See migrateLeague: the alternative is that a bug fixed in
  // how the league is BUILT never reaches anybody who had already started playing, which is
  // how Cameron Boozer stayed forty-four years old for a week after he was fixed.
  if ((save.dataRev || 0) < DATA_REV) {
    const before = save.league
    save.league = migrateLeague(before, { seasonsElapsed: save.records?.seasonsCompleted || 0 })
    save.dataRev = DATA_REV
    saveCareer(save)
  }
  // Whatever the save holds IS the league from here on.
  setLeague(save.league)
  return save
}

export function saveCareer(save) {
  if (!save) return false
  const n = SLOTS.includes(save.slot) ? save.slot : (activeSlot() ?? 1)
  save.slot = n
  save.updatedAt = Date.now()
  const ok = ls.set(slotKey(n), JSON.stringify(save))
  if (ok && activeSlot() !== n) setActiveSlot(n)
  return ok
}

// Quit and keep it: the file stays on disk, nothing is active, you are back at the menu.
export function leaveCareer() {
  setActiveSlot(null)
}

// Quit and burn it. Only ever from an explicit confirmation — there is no undo.
export function deleteFranchise(slot) {
  if (!SLOTS.includes(slot)) return false
  ls.del(slotKey(slot))
  if (activeSlot() === slot) setActiveSlot(null)
  return true
}

// Kept for the old "resign and start over" path: wipe whichever career is open.
export function clearCareer() {
  const n = activeSlot()
  if (n) deleteFranchise(n)
  ls.del(LEGACY_KEY)
}

// ---------------------------------------------------------------- server sync
//
// Local is the working copy; the server is the record. Every save writes locally first
// and then pushes — so a career survives a dropped connection, and the boards only ever
// show careers the server has replayed and confirmed.

export async function pushCareer(save) {
  try {
    const r = await fetch('/api/gm?action=save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ career: save }),
    })
    if (!r.ok) return { ok: false }
    return await r.json()
  } catch {
    return { ok: false }
  }
}

export async function fetchBoards() {
  try {
    const r = await fetch('/api/gm?action=board')
    if (!r.ok) return null
    const d = await r.json()
    return d.configured ? d : null
  } catch {
    return null
  }
}

// Save locally, then push. Local never waits on the network.
export function saveAndSync(save) {
  const ok = saveCareer(save)
  pushCareer(save)
  return ok
}
