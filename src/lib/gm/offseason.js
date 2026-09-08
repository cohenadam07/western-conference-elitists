// The offseason: players age, contracts run down, and the record book rolls forward.
//
// Progression is NOT invented here. `SEED.prog` carries, per player, the projection
// model's absolute VORP for each of the next five seasons plus the probability he is
// still a rotation player — fitted in value_engine.py on 88,316 player-season x horizon
// rows (OOS R2 0.534 against a naive 0.322). The browser reads the table; it does not
// re-implement the model.
//
// The delta is ADDITIVE. VORP crosses zero, so a multiplicative "form factor" is
// undefined near replacement level — the first version of this table clamped all 553
// players to its floor because a small negative base flipped every ratio's sign.
import { SEED } from './seed.js'
import { league } from './league.js'
import { rng } from './sim.js'
import { youthPenalty, volatilityFor, ROOKIE_DEF_PENALTY, ROOKIE_TOV_PENALTY } from './form.js'

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// A one-VORP swing is a real but not enormous move: about 10% on efficiency and a third
// of a rotation role. Bounded so a single offseason never rewrites a player.
const EFF_PER_VORP = 0.045
const LOAD_PER_VORP = 0.16

// WHAT TRAINING CAMP BOUGHT.
//
// The camp screen has always offered an emphasis and it has never done anything, which is
// worse than not offering it. These are modest on purpose: a season of focused work is
// worth a point or two of a skill, not a new player. The age weighting is the one part
// with a measurement behind it — the progression model's own curve returns more than twice
// as much development at 22 as at 34, so skill work follows that and conditioning does not.
const EMPHASIS = {
  shooting: { skills: { sh: 2.2, gr: 1.1 }, av: 0, ageWeighted: true },
  defense: { skills: { pd: 2.0, rp: 1.6 }, av: 0, ageWeighted: true },
  conditioning: { skills: {}, av: 3.5, ageWeighted: false },
  development: { skills: { sh: 1.2, pm: 1.2, pd: 1.2, sc: 1.2 }, av: 0, ageWeighted: true },
}

export function ageWeight(age) {
  // 2.3x at 22 against 34, matching the progression model's own age curve.
  if (age <= 22) return 1.35
  if (age <= 25) return 1.1
  if (age <= 29) return 0.85
  if (age <= 33) return 0.68
  return 0.58
}

export function applyPractice(capRoster, emphasis) {
  const e = EMPHASIS[emphasis]
  if (!e) return capRoster
  return capRoster.map((p) => {
    const w = e.ageWeighted ? ageWeight(p.a ?? 27) : 1
    const next = { ...p }
    for (const [k, amount] of Object.entries(e.skills)) {
      if (typeof next[k] === 'number') next[k] = Math.max(1, Math.min(99, next[k] + amount * w))
    }
    if (e.av && typeof next.av === 'number') next.av = Math.max(1, Math.min(100, next.av + e.av))
    return next
  })
}

// ------------------------------------------------------- minutes and development
//
// Young players get better by playing. The projection model has nothing to say about this —
// it was fitted on what happened, and what happened already includes the minutes each man
// actually got — so this is an adjustment ON TOP of the projection, not a replacement for
// it: a twenty-two-year-old given thirty minutes finishes the year further along than the
// same twenty-two-year-old given twelve, and a thirty-year-old is who he is either way.
//
// Deliberately modest. Minutes are worth about a third of a VORP a year at the extreme,
// with a wide random band around it, because the counter-example is real and common: plenty
// of bad teams have played a young player forty minutes a night for three years and got a
// slightly older version of the same player back.
export const DEV_BASELINE_MPG = 18
export const DEV_MAX_GAIN = 0.34

export function minutesDevelopment(age, mpg, r) {
  const a = age ?? 26
  // The window is real and it closes: heaviest at 19-21, halved by 24, gone by 26.
  const window = a <= 21 ? 1 : a <= 23 ? 0.78 : a <= 25 ? 0.42 : a <= 26 ? 0.18 : 0
  if (window <= 0) return 0
  const load = Math.max(-1, Math.min(1, ((mpg ?? 0) - DEV_BASELINE_MPG) / 16))
  // Randomness both ways, and enough of it that heavy minutes are a bet rather than a
  // formula: the same player, same minutes, is anywhere from flat to a real jump.
  const noise = r ? r.gauss(1, 0.55) : 1
  return Math.max(-0.12, load * window * DEV_MAX_GAIN * Math.max(-0.35, noise))
}

export function ageRoster(simRoster, capRoster, yearIndex, r) {
  const outSim = [], outCap = [], departed = []
  const capByName = new Map(capRoster.map((p) => [p.n, p]))
  for (const p of simRoster) {
    const pr = SEED.prog[p.id]
    const cap = capByName.get(p.n)
    // NO PROJECTION ROW — a drafted rookie, a replacement signing, anybody who has never
    // played an NBA season. These used to be passed through untouched, which made them
    // immortal AND permanently nineteen: six seasons in, 258 of the league's 432 players
    // were under 23 because every draftee ever was still on a roster at his draft age.
    //
    // Without a model row the population curve does the work: the young improve, the old
    // decline, and fringe players wash out of the league the way fringe players do.
    if (!pr) {
      const age = (cap?.a ?? 24) + 1
      const quality = cap?.v ?? 0
      const washout = age < 21 ? 0.06
        : age < 25 ? 0.14 - Math.min(0.12, Math.max(0, quality) * 0.09)
          : age < 31 ? 0.10 - Math.min(0.09, Math.max(0, quality) * 0.07)
            : age < 34 ? 0.18
              : age < 37 ? 0.34
                : 0.6
      if (r.rand() < washout) {
        departed.push({ name: p.n, age, reason: age >= 33 ? 'retired' : 'out of the league' })
        continue
      }
      const growth = age <= 22 ? 0.09 : age <= 25 ? 0.05 : age <= 28 ? 0.01
        : age <= 31 ? -0.03 : age <= 34 ? -0.07 : -0.12
      // What he played this year, and what that bought him.
      const played = p.mpg ?? cap?.mpg ?? 12
      const devGain = minutesDevelopment(age, played, r)
      const np = { ...p }
      const lift = growth * 0.35 + devGain * 0.14
      for (const k of ['fg3', 'fg2', 'ft']) {
        if (typeof np[k] === 'number') np[k] = clamp(np[k] * (1 + lift), 0.05, 0.95)
      }
      np.load = Math.max(0.5, (p.load || 10) * (1 + growth))
      np.mpg = Math.max(2, (p.mpg || 12) * (1 + growth))
      // Young players grow out of the two things young players are bad at, and minutes are
      // most of how: defensive discipline and taking care of the ball are learned on the
      // floor rather than in the summer.
      for (const k of ['dr', 'dp', 'de']) {
        if (typeof np[k] === 'number') np[k] = clamp(np[k] + growth * 22 + devGain * 16, 1, 99)
      }
      if (typeof np.tov === 'number' && age <= 25) {
        np.tov = clamp(np.tov * (1 - 0.05 - Math.max(0, devGain) * 0.25), 0.02, 0.30)
      }
      // Volatility settles with experience. A twenty-year-old is a different player from
      // night to night; a twenty-six-year-old mostly is not.
      np.vol = volatilityFor({ ...cap, a: age }, np)
      outSim.push(np)
      if (cap) {
        outCap.push({ ...cap, a: Math.round(age * 10) / 10,
          v: Math.round(((cap.v ?? 0) + growth * 1.6 + devGain) * 100) / 100,
          devGain: Math.round(devGain * 100) / 100 })
      }
      continue
    }
    const h = Math.min(4, yearIndex)
    const age = (cap?.a ?? pr.age ?? 27) + 1

    // CAREERS END. The projection model covers five years; past that its survival number
    // stops moving, so nobody ever aged out — six simulated seasons in, Kawhi Leonard was
    // forty-one and still one of the eight best players alive. This is the population
    // hazard on top of it: retirement is rare before 33 and close to certain by 42, and a
    // genuinely great player hangs on a few years longer than a replacement one.
    const hazard = age < 31 ? 0.01
      : age < 33 ? 0.05
        : age < 35 ? 0.12
          : age < 37 ? 0.24
            : age < 39 ? 0.42
              : age < 41 ? 0.62
                : 0.85
    // CONDITIONAL survival, not cumulative. `pr.s[h]` is the probability a player is still
    // a rotation player h years from the base season — rolling that same number every year
    // compounds it, and an MVP had a better-than-even chance of simply vanishing inside six
    // seasons. What each year needs is the chance of surviving THIS year given he survived
    // the last, which is the ratio of consecutive horizons.
    const survivePrev = h > 0 ? (pr.s[h - 1] ?? 1) : 1
    const surviveNow = pr.s[h] ?? 1
    const conditional = survivePrev > 0 ? Math.min(1, surviveNow / survivePrev) : surviveNow
    const stature = Math.max(0.35, 1 - Math.max(0, (pr.v[h] ?? 0)) * 0.16)
    if (r.rand() > conditional || r.rand() < hazard * stature) {
      departed.push({ name: p.n, age, reason: age >= 33 ? 'retired' : 'out of the league' })
      continue
    }
    // Past the model's horizon the population aging curve carries the decline, rather than
    // the last projected year repeating for ever.
    const beyond = Math.max(0, yearIndex - 4)
    const drift = beyond === 0 ? 0
      : -beyond * (age < 30 ? 0.05 : age < 33 ? 0.14 : age < 36 ? 0.26 : 0.4)
    const devGain = minutesDevelopment(age, p.mpg ?? cap?.mpg ?? 12, r)
    const d = pr.v[h] - pr.v0 + drift + devGain
    const eff = clamp(1 + d * EFF_PER_VORP, 0.86, 1.16)
    const load = clamp(1 + d * LOAD_PER_VORP, 0.55, 1.45)
    const np = { ...p }
    // Shooting and finishing move; turnovers move the other way; role scales with load.
    for (const k of ['fg3', 'fg2', 'ft']) np[k] = clamp(p[k] * eff, 0.05, 0.95)
    np.usg = clamp(p.usg * (1 + d * 0.03), 0.05, 0.42)
    np.tov = clamp(p.tov / eff, 0.02, 0.30)
    np.load = Math.max(0.5, p.load * load)
    np.mpg = Math.max(2, p.mpg * load)
    for (const k of ['dr', 'dp', 'de']) np[k] = clamp(p[k] + d * 3.2 + devGain * 12, 1, 99)
    np.vol = volatilityFor({ ...cap, a: age }, np)
    outSim.push(np)
    // THE CAP SHEET AGES TOO. Only the simulation profile used to move, so every rating,
    // badge, trade valuation and scouting report kept reading a player's 2026-27 self for
    // ever — a thirty-four-year-old Shai Gilgeous-Alexander was still being priced as a
    // seven-VORP MVP because `v` never changed. Everything the front office sees is on the
    // cap sheet, so the cap sheet has to be the thing that ages.
    if (cap) {
      const projected = Math.round(((pr.v[h] ?? cap.v ?? 0) + drift + devGain) * 100) / 100
      outCap.push({
        ...cap,
        a: cap.a ? Math.round((cap.a + 1) * 10) / 10 : cap.a,
        v: projected,
        mpg: typeof cap.mpg === 'number' ? Math.max(4, Math.round(cap.mpg * load * 10) / 10) : cap.mpg,
        bpm: typeof cap.bpm === 'number'
          ? Math.round((cap.bpm + (projected - (cap.v ?? 0)) * 1.4) * 10) / 10 : cap.bpm,
      })
    }
  }
  return { sim: outSim, cap: outCap, departed }
}

// Contracts run down. A deal at its last year expires into free agency.
export function runContracts(capRoster) {
  const kept = [], expiring = []
  for (const p of capRoster) {
    const yr = (p.yr || 1) - 1
    if (yr <= 0) expiring.push(p)
    else kept.push({ ...p, yr })
  }
  return { kept, expiring }
}

export function rollSeason(save, { season, wins, losses, seed, run, pf, pa }) {
  const s = JSON.parse(JSON.stringify(save))
  const rec = s.records
  s.seasons.push({ season, wins, losses, seed,
    playoffRounds: run.seriesWon, confTitle: run.confTitle, champion: run.champion })
  rec.seasonsCompleted += 1
  rec.totalWins += wins
  rec.totalLosses += losses
  rec.playoffSeriesWon += run.seriesWon
  if (run.made) rec.playoffAppearances += 1
  if (run.confTitle) { rec.conferenceTitles += 1; rec.finalsAppearances += 1 }
  if (run.champion) {
    rec.championships += 1
    if (rec.fastestTitle === null || rec.seasonsCompleted < rec.fastestTitle)
      rec.fastestTitle = rec.seasonsCompleted
  }
  if (!rec.bestRecord || wins > rec.bestRecord.wins) rec.bestRecord = { season, wins, losses }
  if (!rec.worstRecord || wins < rec.worstRecord.wins) rec.worstRecord = { season, wins, losses }

  // The owner judges against the MANDATE, not raw wins — a 25-win rebuild can be a
  // success and a 45-win title-or-bust season a failure.
  const target = SEED.mandates[s.status.mandate]?.target ?? 44
  let score = (wins - target) / 12 + run.seriesWon * 0.35
  if (s.status.mandate === 'develop') score += 0.3
  s.status.ownerConfidence = Math.round((s.status.ownerConfidence + clamp(score, -2, 2)) * 100) / 100
  s.status.employed = s.status.ownerConfidence > -3.0
  s.franchise.currentSeason = nextSeasonLabel(season)
  s.badges = earnedBadges(rec, s.seasons)
  return s
}

export function nextSeasonLabel(label) {
  const a = parseInt(label.slice(0, 4), 10) + 1
  return `${a}-${String((a + 1) % 100).padStart(2, '0')}`
}

export const BADGES = [
  { id: 'champion', name: 'Champion', blurb: 'Won it all.', test: (r) => r.championships >= 1 },
  { id: 'dynasty', name: 'Dynasty', blurb: 'Three titles with one franchise.', test: (r) => r.championships >= 3 },
  { id: 'repeat', name: 'Back-to-Back', blurb: 'Titles in consecutive seasons.', test: (r, s) => consecutive(s, 2) },
  { id: 'quick_build', name: 'Quick Build', blurb: 'A title within three seasons of being hired.', test: (r) => (r.fastestTitle ?? 99) <= 3 },
  { id: 'seventy', name: '70-Win Season', blurb: 'Seventy regular-season wins.', test: (r) => (r.bestRecord?.wins ?? 0) >= 70 },
  { id: 'perennial', name: 'Perennial', blurb: 'Ten playoff appearances.', test: (r) => r.playoffAppearances >= 10 },
  { id: 'five_hundred', name: '500 Wins', blurb: 'Five hundred wins as GM.', test: (r) => r.totalWins >= 500 },
  { id: 'teardown', name: 'Full Teardown', blurb: 'A fifteen-win season. On purpose, presumably.', test: (r) => (r.worstRecord?.wins ?? 99) <= 15 },
  { id: 'tenured', name: 'Tenured', blurb: 'Fifteen seasons in the chair.', test: (r) => r.seasonsCompleted >= 15 },
]

function consecutive(seasons, n) {
  let run = 0
  for (const s of seasons) { run = s.champion ? run + 1 : 0; if (run >= n) return true }
  return false
}

export const earnedBadges = (rec, seasons) =>
  BADGES.filter((b) => b.test(rec, seasons)).map((b) => b.id)

export const makeRng = rng


// ---------------------------------------------------------------- refilling
//
// Players retire and contracts expire; nothing was ever added back. Over a long career
// that is not a cosmetic gap — a soak run of 64 seasons had rosters down to five players
// by year five, because attrition is one-way. Real teams refill to the fourteen-man
// minimum with minimum-salary signings, and so does this.

const MIN_SALARY = 2_300_000
const FIRST_INIT = ['J.', 'T.', 'D.', 'M.', 'A.', 'K.', 'R.', 'C.', 'B.', 'E.', 'N.', 'P.']
const SURNAMES = ['Whitlow', 'Kearns', 'Sarpong', 'Vukovic', 'Bassey', 'Ostrom', 'Nakamura',
  'Ferrand', 'Aldana', 'Brannon', 'Castellanos', 'Doyle', 'Ekwueme', 'Fairbanks', 'Gorski',
  'Halvorsen', 'Ibarra', 'Jelinek', 'Kowalczyk', 'Lindgren', 'Mbaye', 'Novotny', 'Oyelaran',
  'Petrosyan', 'Quintero', 'Rasheed', 'Stavros', 'Tuinei', 'Underwood', 'Villanueva']

// A replacement-level rotation body. Deliberately unremarkable: this is the floor of the
// league, and a team that has to lean on these should feel it.
export function replacementPlayer(r, i, year) {
  const jitter = (mu, sd) => Math.round((mu + r.gauss(0, sd)) * 1e4) / 1e4
  return {
    sim: {
      id: `rep-${year}-${i}`,
      // Names have to be distinct on one cap sheet. A six-by-eight pool collided four
      // ways in a single roster — "K. Kearns" next to "T. Kearns" next to "A. Kearns"
      // reads as a bug even when the simulation underneath is fine.
      n: `${FIRST_INIT[(i * 7 + r.randrange(FIRST_INIT.length)) % FIRST_INIT.length]} ${
        SURNAMES[(i * 5 + year * 3 + r.randrange(SURNAMES.length)) % SURNAMES.length]}`,
      // Floored, because a Gaussian draw around 11 with a spread of 3 goes negative about
      // once in every four hundred players — and a minutes load below zero is not a bad
      // player, it is an impossible one. It surfaced as a flaky soak failure once CPU
      // teams started refilling their own rosters and the draw ran forty times as often.
      mpg: Math.max(4, jitter(13, 3)), load: Math.max(3, jitter(11, 3)),
      usg: Math.max(0.08, jitter(0.163, 0.02)),
      fg3r: Math.max(0.1, jitter(0.42, 0.08)), fg3: Math.max(0.2, jitter(0.335, 0.03)),
      fg2: Math.max(0.35, jitter(0.52, 0.03)), ft: Math.max(0.5, jitter(0.74, 0.05)),
      ftr: Math.max(0.05, jitter(0.22, 0.05)), tov: Math.max(0.05, jitter(0.135, 0.02)),
      oreb: Math.max(0.01, jitter(0.045, 0.02)), dreb: Math.max(0.03, jitter(0.135, 0.04)),
      ast: Math.max(0.03, jitter(0.115, 0.04)),
      dr: Math.max(5, jitter(44, 12)), dp: Math.max(5, jitter(44, 12)),
      de: Math.max(5, jitter(44, 12)),
    },
    // A position and archetype, so a generated body reads like a player on the cap sheet
    // rather than a row of em-dashes. Derived from the profile that was just rolled.
    cap: { uid: `rep-${year}-${i}-${r.randrange(1e6)}`, n: '', s: MIN_SALARY, o: null, yr: 1,
           a: 25 + r.randrange(6), v: 0.0, mpg: 13, pos: null, arch: null,
           av: 85, bpm: Math.round(r.gauss(-2.6, 0.7) * 10) / 10 },
  }
}

// Position and archetype from how a player actually plays, using the same shapes the
// archetype engine found: size and rebounding push toward the frontcourt, assists toward
// the ball, three-point volume toward spacing.
export function describe(sim) {
  const big = sim.dreb * 3 + sim.oreb * 6 + (sim.dr - 45) / 60
  const ball = sim.ast * 3 + sim.usg * 1.5
  const slot = Math.max(1, Math.min(5, 3 + big * 2.2 - ball * 2.4))
  const pos = ['PG', 'SG', 'SF', 'PF', 'C'][Math.round(slot) - 1]
  let arch
  if (slot >= 4.2) arch = sim.fg3r > 0.3 ? 'Role Big' : 'Rim-Running Big'
  else if (slot >= 3.2) arch = sim.fg3r > 0.45 ? '3&D Role Player' : 'Role Big'
  else if (ball > 0.55) arch = sim.usg > 0.22 ? 'Combo Guard' : 'Pass-First Guard'
  else arch = sim.fg3r > 0.5 ? 'Movement Shooter' : '3&D Role Player'
  return { pos, arch, slot: Math.round(slot * 100) / 100 }
}

export function refill(simRoster, capRoster, additions, r, year, min = 14) {
  // The CAP SHEET is the source of truth for who is on the team. Savant rosters carry
  // more names than there are standard contracts, and once contracts start expiring the
  // two drift — a soak run had a 22-man sim roster against a 14-man cap sheet, so the
  // simulation was playing people the team no longer employed. Drop anyone without a deal.
  const onBooks = new Set(capRoster.map((p) => p.n))
  const sim = simRoster.filter((p) => onBooks.has(p.n))
  const cap = [...capRoster]
  for (const a of additions || []) {
    if (a.sim) sim.push(a.sim)
    if (a.cap) cap.push(a.cap)
  }
  let i = 0
  const signed = []
  const used = new Set(cap.map((p) => p.n))
  while (cap.length < min && i < 60) {
    const p = replacementPlayer(r, i++, year)
    if (used.has(p.sim.n)) continue
    used.add(p.sim.n)
    p.cap.n = p.sim.n
    Object.assign(p.cap, describe(p.sim))
    sim.push(p.sim); cap.push(p.cap); signed.push(p.cap.n)
  }
  return { sim, cap, signed }
}

// A drafted prospect arrives on a rookie-scale deal. What he becomes is already decided
// by draft.js and the user will not find out for four years.
export function rookieContract(prospect, pickNo, r) {
  const scale = pickNo && pickNo <= 30
    ? Math.round(12_500_000 * Math.pow(pickNo, -0.43)) : MIN_SALARY
  const grade = Math.max(0, Math.min(1, (31 - (pickNo || 45)) / 30))
  const jitter = (mu, sd) => Math.round((mu + r.gauss(0, sd)) * 1e4) / 1e4
  const age = prospect.age ?? 20
  const youth = youthPenalty(age)
  // Upside and floor come off the prospect itself: `_u` is what the draft model thinks he
  // could be, and a 'ready' prospect is one who is already most of it. They are carried on
  // the cap sheet because everything downstream — volatility, scouting, valuation — wants
  // to know the difference between a safe rotation player and a swing.
  // `_u` is a z-like score running about -2.8 to +2.9 with a mean near zero, so it maps
  // onto 0-1 by shifting and dividing rather than by dividing alone — the first version
  // handed the best prospect in the class an upside of 0.00, which is exactly the kind of
  // wrong that looks fine until you print it.
  const upside = Math.max(0, Math.min(1, ((prospect._u ?? 0) + 2.5) / 5))
  // Floor is how much of it he already is: a 'ready' prospect is most of the way there, a
  // project is not, and an older prospect is further along whatever his label.
  const floor = Math.max(0, Math.min(1,
    (prospect.type === 'ready' ? 0.62 : 0.2) + Math.max(0, age - 19) * 0.07))
  return {
    sim: {
      id: `rook-${prospect.id}`, n: prospect.name,
      mpg: jitter(10 + grade * 12, 3), load: jitter(9 + grade * 11, 3),
      usg: Math.max(0.08, jitter(0.15 + grade * 0.07, 0.02)),
      fg3r: Math.max(0.1, jitter(0.4, 0.08)), fg3: Math.max(0.2, jitter(0.32 + grade * 0.02, 0.03)),
      fg2: Math.max(0.35, jitter(0.5 + grade * 0.04, 0.03)), ft: Math.max(0.5, jitter(0.73, 0.05)),
      ftr: Math.max(0.05, jitter(0.23, 0.05)),
      tov: Math.max(0.05, jitter((0.145 - grade * 0.01) * (1 + youth * ROOKIE_TOV_PENALTY), 0.02)),
      oreb: Math.max(0.01, jitter(0.05, 0.02)), dreb: Math.max(0.03, jitter(0.14, 0.04)),
      ast: Math.max(0.03, jitter(0.12, 0.04)),
      // Defence and ball security are where a rookie is a rookie. The number he will
      // eventually be is `45 + grade * 8`; what he brings in October is that minus the
      // youth penalty, and he earns the rest back over the first few years by playing.
      dr: jitter(45 + grade * 8 - youth * ROOKIE_DEF_PENALTY, 11),
      dp: jitter(45 + grade * 8 - youth * ROOKIE_DEF_PENALTY, 11),
      de: jitter(45 + grade * 8 - youth * ROOKIE_DEF_PENALTY * 0.5, 11),
      vol: 1,
    },
    // A rate to be rated on, from the same draft grade that shaped the profile above —
    // roughly a +4 box plus/minus at the top of the lottery down to −3 late in the round.
    cap: { uid: `rook-${prospect.id}`, n: prospect.name, s: scale, o: null, yr: 4,
           a: age, v: 0.0, mpg: 12, av: 90, upside, floor,
           bpm: Math.round((-3 + grade * 7) * 10) / 10 },
  }
}

export function labelRookie(entry) {
  const cap = { ...entry.cap, ...describe(entry.sim) }
  // Volatility last, because it reads the finished profile.
  const sim = { ...entry.sim, vol: volatilityFor(cap, entry.sim) }
  return { ...entry, cap, sim }
}


// Re-signing an expiring player: he keeps everything about how he plays and gets a new
// deal. Without this the offseason quietly strips a roster to its long contracts — a
// three-season career came out as two stars and twelve minimum bodies, because free
// agency existed on screen and never reached the team.
export function reSign(capPlayer, simPlayer, aav, years) {
  return {
    sim: simPlayer ? { ...simPlayer } : null,
    cap: { ...capPlayer, uid: capPlayer.uid || `re-${capPlayer.n}-${Math.round(aav)}`,
           s: Math.round(aav), yr: Math.max(1, Math.round(years)), o: null },
  }
}

// ------------------------------------------------------- how the year changed people
//
// A season ends and everybody on the cap sheet is a slightly different player, and until
// now nothing said so. The number that matters is not the raw change — a 34-year-old
// losing half a point is normal and a 21-year-old gaining half a point is also normal —
// it is the change AGAINST what the age says should have happened.

// The expected year-on-year change in VORP by age — MEASURED from this game's own aging
// engine rather than asserted, by running `ageRoster` over all thirty real rosters twelve
// times and bucketing the change by starting age (n = 4,742 player-seasons):
//
//   19-20  +0.47      26-29  -0.12
//   21-25  +0.31      30+    -0.28
//
// crossing zero at about twenty-six and a half. The line below is fitted to those anchors.
// This is the number the development report measures against, which is the whole point:
// a 34-year-old losing half a point is the curve, not a collapse, and a 21-year-old
// holding steady is a problem even though nothing got worse.
export function expectedGain(age) {
  const a = age ?? 26
  return Math.max(-0.32, Math.min(0.55, 0.47 - (a - 20) * 0.068))
}

export const DEV = {
  leap: { label: 'Leap', tone: 'good', mark: '▲▲' },
  up: { label: 'Improved', tone: 'good', mark: '▲' },
  flat: { label: 'Held', tone: 'flat', mark: '—' },
  down: { label: 'Slipped', tone: 'bad', mark: '▼' },
  cliff: { label: 'Fell off', tone: 'bad', mark: '▼▼' },
}

export function developmentOf(before, after) {
  const d = (after.v ?? 0) - (before.v ?? 0)
  const exp = expectedGain(before.a ?? 26)
  const rel = d - exp
  const key = rel >= 0.55 ? 'leap' : rel >= 0.14 ? 'up' : rel <= -0.55 ? 'cliff' : rel <= -0.14 ? 'down' : 'flat'
  return { d, exp, rel, key, ...DEV[key] }
}

// The whole roster, sorted by who moved most — because the story of a season is usually
// one player who took a step and one who stopped taking them.
export function developmentReport(beforeCap, afterCap) {
  const by = new Map(afterCap.map((p) => [p.uid || p.n, p]))
  const rows = []
  for (const b of beforeCap) {
    const a = by.get(b.uid || b.n)
    if (!a) { rows.push({ n: b.n, a: b.a, gone: true }); continue }
    rows.push({
      n: b.n, uid: b.uid, age: a.a ?? b.a,
      from: b.v ?? 0, to: a.v ?? 0,
      mpg: a.mpg ?? b.mpg,
      ...developmentOf(b, a),
    })
  }
  rows.sort((x, y) => (y.rel ?? -99) - (x.rel ?? -99))
  const moved = rows.filter((r) => !r.gone)
  return {
    rows,
    risers: moved.filter((r) => r.key === 'leap' || r.key === 'up').length,
    fallers: moved.filter((r) => r.key === 'cliff' || r.key === 'down').length,
    best: moved[0] || null,
    worst: moved[moved.length - 1] || null,
    departed: rows.filter((r) => r.gone).map((r) => r.n),
  }
}

// ------------------------------------------------------- how young players play
//
// A rookie is not a small veteran. The two things that separate them are the two things
// every coach complains about — he does not know where to be on defence, and he gives the
// ball away — and neither is captured by simply being worse at everything. So the profile a
// drafted player arrives with is deliberately lopsided: his offence is roughly what he will
// be, his defence and his ball security are not, and both catch up over the first few years
// through `minutesDevelopment` above.
//
// The other half is volatility. A high-upside young player is not a steadily good player
// yet — he is a player who scores thirty-one one night and goes two-for-eleven the next,
// and that swing IS the upside as it is experienced. A high-floor prospect is the opposite:
// less to dream on, far more reliable in October. This is a per-player number the season
// reads on game day, so the same profile produces a different night each time.

// `youthPenalty` and `volatilityFor` live in form.js, so league.js can build a profile
// with a volatility on it without importing the whole offseason.
export { youthPenalty, volatilityFor } from './form.js'

