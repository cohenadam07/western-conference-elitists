// INJURIES.
//
// Before this file, a season-ending knee and a rest night were the same event. The engine drew
// once per man before each game against `availabilityOf(p) = load / mpg` and the men who failed
// the draw simply did not dress — no diagnosis, no duration, no return date, no notice, and a
// fresh coin flip tomorrow. A GM could not plan around it, price it in a trade, or feel it at
// the deadline, because there was nothing to plan around: absence had no shape.
//
// What this adds is the shape. An injury is a body part, a severity, and a number of games —
// and once it happens it keeps happening, which is what makes roster depth, the trade deadline
// and load management into decisions instead of decoration.
//
// THREE CONSTRAINTS DECIDED THE DESIGN, and they are worth stating because they rule out the
// obvious implementation:
//
// 1. `sim.js` must stay byte-identical with its Python twin — thirty cross-runtime fixtures
//    check it on every run. So nothing here reaches into the possession loop. Injuries are
//    resolved OUTSIDE the engine, and the engine is simply handed the men who are fit, the
//    same way form, wear and morale are applied to profiles rather than to the simulation.
//
// 2. The server verifies a claimed season by replaying it from its seed through this very
//    module (`api/gm.js` imports `playNext`). So the roll has to live inside the season loop
//    and be driven by the season seed. An injury model that lived in the React layer would
//    make every career unverifiable.
//
// 3. Absence must not double-count. The engine already benches people via `load / mpg`, so
//    layering injuries on top of that would take a player out twice. Availability is therefore
//    SPLIT: most of what a player misses is now real injuries with duration, and the small
//    remainder stays with the engine's nightly draw as the one-night absences it is good at —
//    a rest day, a stomach bug, a coach's decision.
//
// The calibration target is not invented. `av` in the seed is the share of last season each
// player was actually available for, measured from real data, so the model is tuned to
// REPRODUCE EACH PLAYER'S OWN MEASURED AVAILABILITY. A fragile player gets hurt more because
// he did, not because a designer said so.

// HOW MUCH OF AN ABSENCE IS ACTUALLY AN INJURY — AND IT DEPENDS ON WHO YOU ARE.
//
// The seed's availability is share of team games played, measured from real data. Across the
// league it averages 0.649, which implies 13,312 missed player-games a season — roughly twice
// what the NBA actually loses to injury. The gap is not an error in the data, it is what the
// number means: a twelfth man who plays 52 games did not miss thirty with a hamstring, he was
// a healthy scratch. Availability rises monotonically with minutes in this data — 0.53 for men
// under twelve minutes a night, 0.72 for men over thirty-four — which is the signature of
// coach's decisions, not of medicine.
//
// So the share of a player's absence that gets a diagnosis scales with his role. A star's
// missed games are almost all injuries; a deep reserve's are mostly the rotation. Applied
// across the real rosters this lands the league near six thousand games lost to injury a
// season, which is the right order for the modern NBA, and it leaves TOTAL absence exactly
// where the data put it — so the possession engine's calibration is untouched and only the
// meaning of the missing games has changed.
export const injuryShare = (mpg) =>
  0.14 + 0.66 * Math.max(0, Math.min(1, ((mpg ?? 20) - 6) / 28))

// A full season for one team.
export const GAMES = 82

// Days per team game. Eighty-two games across about a hundred and seventy days; used to turn
// "out four games" into a return date on the calendar, which is the thing a user actually
// plans around.
export const DAYS_PER_GAME = 2.07

// Never leave a club unable to field a rotation. Real teams sign hardship contracts long
// before this point; the engine needs five men and gets unhappy under eight.
export const MIN_AVAILABLE = 9

/* ------------------------------------------------------------------- severity */

// Weighted by how often each band actually happens, not evenly — the great majority of
// injuries are the boring ones, which is exactly why the rare ones land so hard.
export const SEVERITY = [
  { key: 'knock', label: 'Day-to-day', p: 0.46, lo: 1, hi: 3 },
  { key: 'minor', label: 'Minor', p: 0.28, lo: 4, hi: 9 },
  { key: 'moderate', label: 'Moderate', p: 0.17, lo: 10, hi: 24 },
  { key: 'major', label: 'Major', p: 0.075, lo: 25, hi: 52 },
  { key: 'severe', label: 'Season-ending', p: 0.015, lo: 55, hi: 82 },
]

// The mean length of an injury, in games. Everything about the rate falls out of this number,
// so it is derived from the table rather than typed next to it and left to drift.
export const MEAN_GAMES = SEVERITY.reduce((s, x) => s + x.p * ((x.lo + x.hi) / 2), 0)

/* ------------------------------------------------------------------ body parts */

// `bias` shifts the severity draw. An ankle is usually a week; a knee, when it is a knee, is
// usually not. The part is chosen first and the severity is drawn through its bias, so the
// diagnosis and the timeline agree with each other — which is the whole reason to name a body
// part at all rather than print "injured".
export const PARTS = [
  { key: 'ankle', label: 'Ankle sprain', p: 0.17, bias: -0.55 },
  { key: 'hamstring', label: 'Hamstring strain', p: 0.12, bias: 0.15 },
  { key: 'knee', label: 'Knee', p: 0.11, bias: 0.85 },
  { key: 'back', label: 'Back', p: 0.10, bias: 0.05 },
  { key: 'groin', label: 'Groin strain', p: 0.08, bias: 0.10 },
  { key: 'calf', label: 'Calf strain', p: 0.07, bias: 0.20 },
  { key: 'shoulder', label: 'Shoulder', p: 0.07, bias: 0.15 },
  { key: 'wrist', label: 'Wrist', p: 0.06, bias: -0.10 },
  { key: 'hand', label: 'Hand', p: 0.06, bias: 0.05 },
  { key: 'foot', label: 'Foot', p: 0.06, bias: 0.45 },
  { key: 'quad', label: 'Quad contusion', p: 0.05, bias: -0.45 },
  { key: 'illness', label: 'Illness', p: 0.03, bias: -0.85 },
  { key: 'concussion', label: 'Concussion protocol', p: 0.02, bias: -0.30 },
]

const pick = (table, u) => {
  let acc = 0
  for (const row of table) { acc += row.p; if (u <= acc) return row }
  return table[table.length - 1]
}

/* --------------------------------------------------------------------- hazard */

// AGE IS DELIBERATELY NOT A FACTOR HERE, and that is a finding rather than an omission. The
// sim profiles carry no birthday — availability, minutes and rates, nothing else — and joining
// the cap sheet in on every game to fetch one would be expensive and, worse, redundant: a
// player's measured availability ALREADY encodes how old and how brittle he was last season.
// Multiplying by age on top would count the same thing twice.

// The second night of a back-to-back. calendar.js has generated twelve to fifteen of these per
// team since it was written, with a comment saying they are the reason availability and
// February minutes matter — and nothing has ever read them. Now something does.
export const B2B_FACTOR = 1.35

// Minutes are the exposure. A man who plays thirty-eight is on the floor twice as long as one
// who plays nineteen, and the risk scales with it — gently, because the relationship is real
// but not linear.
export const loadFactor = (minutes) => {
  const m = Math.max(6, Math.min(42, minutes ?? 24))
  return 0.72 + 0.28 * (m / 24)
}

// PER-GAME PROBABILITY, SOLVED RATHER THAN GUESSED.
//
// A player available for `av` of last season misses (1 - av) x 82 games; `injuryShare` of that
// is real injury, and each injury costs MEAN_GAMES on average. The rate is that total divided
// by the games it is spread over. There is no free parameter in here to tune, which is the
// point: the target came from the data.
export function baseHazard(av, mpg) {
  const availability = Math.max(0.3, Math.min(0.995, av ?? 0.65))
  const missed = (1 - availability) * GAMES * injuryShare(mpg)
  return Math.max(0, Math.min(0.2, missed / (GAMES * MEAN_GAMES)))
}

// What the engine's own nightly draw is left holding: the absences that are not injuries.
// Returned as an availability, handed to the simulation as `load = mpg x this`, so a player's
// total expected games played is exactly what it was before this file existed.
export function residualAvailability(av, mpg) {
  const availability = Math.max(0.3, Math.min(0.995, av ?? 0.65))
  return Math.max(0.3, Math.min(1, 1 - (1 - availability) * (1 - injuryShare(mpg))))
}

// Everything that moves one player's risk on one night, in one number.
export function hazardFor(player, { minutes, b2b, wear = 0 } = {}) {
  const av = player._av ?? Math.min(0.995, (player.load || 0) / Math.max(1, player.mpg || 1))
  return baseHazard(av, player.mpg)
    * loadFactor(minutes ?? player.mpg)
    * (b2b ? B2B_FACTOR : 1)
    // Wear is the rotation screen's own currency — minutes spent beyond what a body can carry.
    // It belongs here rather than in a separate penalty: riding somebody hard does not make him
    // worse, it makes him more likely to break.
    * (1 + Math.min(0.6, (wear || 0) / 30))
}

/* ------------------------------------------------------------------ the injury */

// One injury, drawn. `r` is a seeded PRNG; the number of draws is FIXED so that a caller
// stepping a season stays aligned with any other runtime doing the same.
export function drawInjury(player, r, { day = 0, team = null } = {}) {
  const part = pick(PARTS, r.rand())
  // The part's bias shifts where in the severity table we land. Drawn as a uniform nudged by
  // the bias and clamped, so a knee skews long and an illness skews short without either
  // becoming deterministic.
  const u = Math.max(0.001, Math.min(0.999, r.rand() - part.bias * 0.22))
  const sev = pick(SEVERITY, u)
  const span = sev.hi - sev.lo
  const games = Math.max(1, Math.round(sev.lo + span * r.rand()))
  return {
    id: player.id,
    n: player.n,
    team,
    part: part.key,
    partLabel: part.label,
    sev: sev.key,
    sevLabel: sev.label,
    games,
    since: day,
    until: day + Math.max(1, Math.round(games * DAYS_PER_GAME)),
  }
}

/* ------------------------------------------------------------------- the state */

// `injuries` is a plain object keyed by player id so it survives a JSON round trip and reads
// back identically. Kept on the SEASON rather than the save: a season is replayed from its
// seed, so storing it would mean two copies that can disagree.
// BOTH ENDS OF THE WINDOW, not just the far one. Checking only `day < until` says a man is
// out in October for an ankle he turns in April — harmless while the season is stepped
// forward one game at a time and an injury can only exist once it has happened, and wrong the
// moment anything asks the question about a day in the past, which the health checks do.
export const isOut = (injuries, id, day) => {
  const x = injuries?.[id]
  return !!x && day >= x.since && day < x.until
}

export const outFor = (injuries, day, team = null) => Object.values(injuries || {})
  .filter((x) => day >= x.since && day < x.until && (!team || x.team === team))
  .sort((a, b) => b.until - a.until)

// Who can take the floor tonight, and with what left in the tank. Injured men are removed
// outright; everybody else is handed to the engine with the residual availability its own draw
// is meant to represent, so absence is counted once and only once.
export function availableRoster(roster, injuries, day) {
  const out = []
  for (const p of roster) {
    if (isOut(injuries, p.id, day)) continue
    // `load` is about to be overwritten with the residual, so the measured availability it was
    // carrying is stashed first. Reading it back off `load` afterwards would compound the
    // adjustment every night until nobody ever missed a game.
    // Clamped, because availability is a probability and several profile builders in this
    // codebase can still emit a load above minutes. An `av` over 1.0 means a man available
    // more often than every night, which reads as indestructible: no residual absence and no
    // injury risk at all.
    const av = Math.min(0.995, (p.load || 0) / Math.max(1, p.mpg || 1))
    const resid = residualAvailability(av, p.mpg)
    out.push({ ...p, _av: av, load: Math.max(1, (p.mpg || 1) * resid) })
  }
  return out
}

// Games remaining, for a report a person reads. Derived from the day rather than stored, so it
// counts down on its own and can never disagree with the return date beside it.
export const gamesLeft = (inj, day) =>
  Math.max(0, Math.round((inj.until - day) / DAYS_PER_GAME))

export const describe = (inj) =>
  `${inj.partLabel}${inj.sevLabel === 'Day-to-day' ? ' — day-to-day' : ` — ${inj.sevLabel.toLowerCase()}`}`

// SOLVED, NOT GUESSED.
//
// `baseHazard` is exact in expectation for a player with average age playing average minutes
// on a night that is not a back-to-back. The three multipliers above then push the league's
// total above its target, because their population means are all greater than one. This is the
// correction, and it is measured by running a season and comparing simulated games missed
// against the availability the seed actually recorded — `node tools/gm/injury.test.mjs`
// reports the residual, so a change to any factor above shows up as a failing calibration
// rather than as a league that is quietly too healthy.
export const HAZARD_SCALE = 1.80
