// THE ROOKIE CLASS.
//
// Every first-year player in the league was the same man. Not visibly — three of them were
// visibly wrong, a twenty-six-year-old Darryn Peterson and a forty-four-year-old Cameron
// Boozer, both the wreckage of a bad name join — but quietly, which was worse. Thirty-one
// rookies arrived carrying no position and no skill vector at all, so the generic archetype
// filler handed all of them the same nine numbers and the same label: 3&D Role Player. A
// seven-foot-three centre and a six-foot-one point guard, described identically.
//
// The first fix built them from a published big board: rank, position, height. Three facts.
// It was a real improvement and it was still guessing, because three facts cannot tell a
// scoring guard from a passing one.
//
// This version stops guessing. Every one of these men played a season, and Savant measured
// it: usage and true shooting, three-point and free-throw percentage, assist and turnover
// rates, offensive and defensive rebounding, steal and block rates, box plus/minus split
// into its halves, strength of schedule — plus a tape-measured height, weight, wingspan,
// standing reach and vertical. The seed carries all of it (see patch_gm_real_defense.py),
// along with the real draft slot and Savant's own archetype. So a rookie is built from the
// season he actually played.
//
// What that buys, concretely: Darius Acuff shot 44% from three on a 29.5 usage with a 32.2
// assist rate and a 6.5 turnover rate, and Morez Johnson blocked 4.8% of everything at the
// rim on a 21.1 usage. Those are different players now, and they were not before.
//
// Ratings are set by RANK WITHIN THE CLASS rather than against the NBA. A draft class is
// argued relatively — the best shooter in the room, the best passer — and the bands below
// are already scaled to what a first-year player is, so the top of a class lands where a
// good rookie lands and not where an All-Star does.

const norm = (n) => String(n || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'‘’`]/g, '').replace(/-/g, ' ')
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
  .replace(/\s+/g, ' ').trim()

const inches = (ft, i) => ft * 12 + i
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// Young players on the seed's cap sheets with no college row of their own — drafted in an
// earlier year, or from a league Savant's draft board does not cover. They are here only
// because they carry no position either, and a man with no position is a man the archetype
// table cannot see. A label, nothing more.
const EXTRA = [
  ['Tucker DeVries', 'Wing', inches(6, 7)],
  ['Milos Uzan', 'Guard', inches(6, 4)],
  ['J’Vonne Hadley', 'Wing', inches(6, 6)],
  ['Bogoljub Markovic', 'Big', inches(6, 11)],
  ['Nate Bittle', 'Big', inches(7, 0)],
  ['Tarik Biberovic', 'Wing', inches(6, 7)],
]
const EXTRA_INDEX = new Map(EXTRA.map(([n, pos, ht]) => [norm(n), { pos, ht }]))
export const extraOf = (name) => EXTRA_INDEX.get(norm(name)) || null

/* ------------------------------------------------------------------ where he plays */

// The five-man slot the rest of the game speaks in: 1 is a point guard, 5 is a centre.
// Savant's position gives the band and the tape measure moves him inside it, so a
// six-foot-one guard and a six-six guard are not the same player.
export function slotOf(pos, ht) {
  const H = typeof ht === 'number' ? ht : 78
  if (/guard/i.test(pos || '')) return clamp(1.0 + (H - 72) * 0.15, 1.0, 2.6)
  if (/wing|forward/i.test(pos || '')) return clamp(2.5 + (H - 76) * 0.16, 2.4, 3.9)
  if (/big|cent/i.test(pos || '')) return clamp(3.9 + (H - 80) * 0.16, 3.8, 5.0)
  return 3
}

export const POS_LABEL = (slot) => (slot < 1.5 ? 'PG' : slot < 2.5 ? 'SG'
  : slot < 3.6 ? 'SF' : slot < 4.6 ? 'PF' : 'C')

/* ------------------------------------------------------------------ how good he is */

// The seed's own rookie curve, read off its twenty-three tiers: value follows an exact power
// law (1.392 x slot^-0.62 reproduces every one of them) and minutes are exactly linear to a
// floor of twelve. Box plus/minus is interpolated from the tiers as observed, because it is
// not a clean function of either.
//
// Slot is now the REAL draft pick, which is what the curve was always meant to take. It is
// compressed slightly at the very top, because the first three names on a board change places
// every week and the raw curve makes the first worth twice the third.
const BPM_CURVE = [[1, 0.6], [2, -0.3], [3, -0.6], [4, -0.8], [5, -1.0], [6, -1.1],
  [8, -1.2], [10, -1.3], [15, -1.4], [60, -1.6]]

export const effSlot = (pick) => 1 + (Math.max(1, pick || 45) - 1) * 0.82

export const valueAt = (pick) => Math.round(1.392 * Math.pow(effSlot(pick), -0.62) * 1000) / 1000
export const minutesAt = (pick) => Math.round(Math.max(12, 25.5 - 0.45 * (effSlot(pick) - 1)) * 10) / 10
export function bpmAt(pick) {
  const x = effSlot(pick), c = BPM_CURVE
  if (x <= c[0][0]) return c[0][1]
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i][0]) {
      const [x0, y0] = c[i - 1], [x1, y1] = c[i]
      return Math.round((y0 + (y1 - y0) * ((x - x0) / (x1 - x0))) * 100) / 100
    }
  }
  return c[c.length - 1][1]
}

/* ------------------------------------------------------------------ the college season */

// Where the game's nine axes come from. Each is a small expression over the college season,
// and every one of them is a number somebody measured rather than a number somebody assumed.
// `c` is the college row, `b` the tape measure.
const AXES = {
  // Shooting is the three, anchored by the free-throw line — the single best public
  // predictor of whether a college shooter keeps shooting in the NBA.
  sh: (c, b) => 0.72 * v(c.tp3, 35.7) + 0.28 * v(c.ft, 77.4),
  // Gravity is a shot defenders have to leave their man to contest: accuracy times volume.
  gr: (c, b) => v(c.tp3, 35.7) * 0.6 + v(c.tp3r, 30) * 0.4,
  // Scoring is volume AT efficiency. Either alone lies: a 33-usage chucker and a 62 true
  // shooting garbage-time big are both the wrong answer.
  sc: (c, b) => 0.55 * v(c.usg, 25.1) + 0.45 * v(c.ts, 0.6) * 100,
  pm: (c, b) => 0.7 * v(c.ast, 18.5) + 0.3 * v(c.ator, 1.74) * 10,
  // Ball security is the turnover rate, inverted, with the assist-to-turnover ratio as a
  // second opinion — a high-usage creator turns it over more and should not be punished
  // for the usage alone.
  bs: (c, b) => -v(c.tov, 9.7) * 1.6 + v(c.ator, 1.74) * 4,
  // Rim protection is blocks, and length. Standing reach is the thing that actually
  // contests a shot at the rim.
  rp: (c, b) => 0.72 * v(c.blk, 3.1) * 3 + 0.28 * v(b.reach, 106) * 0.6,
  // Perimeter defence is steals plus the defensive half of box plus/minus, which catches
  // the men who are good at it without gambling.
  pd: (c, b) => 0.58 * v(c.stl, 2.18) * 4 + 0.42 * v(c.dbpm, 3.26) * 2.5,
  sz: (c, b) => 0.45 * v(b.height, 79) + 0.3 * v(b.wing, 82) + 0.25 * v(b.weight, 215) * 0.12,
  // Rim pressure is getting to the line and to the offensive glass — both of which are
  // getting to where the defence does not want you.
  rpr: (c, b) => 0.5 * v(c.ftr, 40) + 0.5 * v(c.oreb, 6.7) * 3,
}
const v = (x, dflt) => (typeof x === 'number' && Number.isFinite(x) ? x : dflt)

// What a first-year player can be rated. Size is the one axis where a rookie is already
// finished — a seven-footer is a seven-footer in October — so it alone reaches the top.
const BAND = {
  sh: [28, 78], gr: [25, 76], sc: [28, 78], pm: [20, 82], bs: [25, 80],
  rp: [12, 84], pd: [25, 76], sz: [10, 92], rpr: [25, 78],
}
export const KEYS = Object.keys(AXES)

// Rank within the class, on every axis at once. Built once from whatever rows are handed in.
export function classScale(rows) {
  const scale = {}
  for (const k of KEYS) {
    const vals = rows.map((r) => AXES[k](r.col || {}, r.body || {}))
      .filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
    scale[k] = vals
  }
  return scale
}

const pct = (sorted, x) => {
  if (!sorted || !sorted.length) return 0.5
  let lo = 0, hi = sorted.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m }
  return sorted.length > 1 ? lo / (sorted.length - 1) : 0.5
}

export function skillsFor(row, scale) {
  const c = row.col || {}, b = row.body || {}
  const out = {}
  for (const k of KEYS) {
    const raw = AXES[k](c, b)
    const p = Number.isFinite(raw) ? pct(scale[k], raw) : 0.5
    const [lo, hi] = BAND[k]
    out[k] = Math.round(lo + (hi - lo) * p)
  }
  return out
}

// College steal and block rates, brought onto the NBA scale the possession engine reads.
// A class averages 2.18 steal percent and 3.11 block percent against an NBA rotation's 1.72
// and 1.84 — college is a softer league in both directions and by nearly the same factor,
// which is a pleasant surprise and means one coefficient does both.
export const COLLEGE_TO_NBA = 0.75
export const stealRate = (c) => Math.round(clamp(v(c?.stl, 2.18) * COLLEGE_TO_NBA, 0.3, 4.5) * 100) / 100
export const blockRate = (c) => Math.round(clamp(v(c?.blk, 3.11) * COLLEGE_TO_NBA, 0.15, 9) * 100) / 100

/* ------------------------------------------------------------------ what he might be */

// Upside and floor: the pair everything downstream reads to tell a swing apart from a safe
// rotation player — night-to-night volatility, how a scout reports him, what a rival will
// give up. Where he was taken is the market's opinion; what he did in college is the
// evidence; how old he is says how much of it he has already banked.
export const upsideAt = (pick, bpm) => clamp(
  Math.round(((1.02 - 0.16 * Math.log(Math.max(1, pick || 45)))
    + clamp(((bpm ?? 6.6) - 6.6) / 24, -0.12, 0.16)) * 100) / 100, 0.25, 0.97)

export const floorAt = (pick, age, c) => clamp(Math.round((
  0.16 + Math.max(0, (age ?? 20) - 19) * 0.09
  + ((pick || 45) > 25 ? 0.06 : 0)
  // A man who does not turn it over and makes his free throws is further along than a man
  // of the same age who does neither, whatever his ceiling.
  + clamp((9.7 - v(c?.tov, 9.7)) * 0.012, -0.06, 0.06)
  + clamp((v(c?.ft, 77.4) - 77.4) * 0.002, -0.04, 0.05)) * 100) / 100, 0, 0.9)

// Age on opening night, from a real date of birth — the seed now carries one for every man
// in the class, which is what finally killed the guessing that made Cameron Boozer forty-four.
export function ageOf(row, startYear) {
  const d = row?.born && /^\d{4}-\d{2}-\d{2}$/.test(row.born) ? row.born.split('-').map(Number) : null
  if (d) {
    return Math.round(((Date.UTC(startYear, 9, 21) - Date.UTC(d[0], d[1] - 1, d[2]))
      / 31557600000) * 100) / 100
  }
  const a = row?.a
  if (typeof a === 'number' && a >= 18.3 && a <= 24.5) return Math.round(a * 100) / 100
  return 19.8
}

/* ------------------------------------------------------------------ the repair */

// A row is a member of a draft class if the seed found it a draft year and either a season
// or a tape measure. Much better than any name list: it is exactly the men the pipeline could
// identify as prospects, and it cannot be wrong about a veteran who shares a name. The `or`
// matters — Karim Lopez was drafted out of the New Zealand Breakers, so Savant's college
// table has nothing on him, and he is no less a rookie for it. His axes fall back to the
// class median, which is what those defaults are for, and his size is still his own.
export const isRookieRow = (c) => !!(c && c.dyear && (c.col || c.body))

export function repair(c, startYear, scale) {
  if (!isRookieRow(c)) {
    const e = extraOf(c?.n)
    if (!e || c?.pos) return c
    const slot = slotOf(e.pos, e.ht)
    return { ...c, pos: POS_LABEL(slot), slot, ht: e.ht }
  }
  const out = { ...c }
  // A first-year player has no prior professional season, so a `stale` join on one of them
  // is not a stale reading — it is a different man, and everything that came across with him
  // goes: the id, the age, the ratings, the skill vector.
  if (c.stale) {
    delete out.stale
    delete out.pid
    for (const k of KEYS) delete out[k]
    delete out.arch
  }
  const pick = c.dpick || 45
  const slot = slotOf(c.dpos, c.body?.height)
  const age = ageOf(c, startYear)
  const first = c.dyear >= startYear
  Object.assign(out, skillsFor(c, scale), {
    slot,
    pos: POS_LABEL(slot),
    ht: c.body?.height,
    a: age,
    upside: upsideAt(pick, c.col?.bpm),
    floor: floorAt(pick, age, c.col),
    arch: c.darch || out.arch,
    board: pick,
    stlr: stealRate(c.col),
    blkr: blockRate(c.col),
    rookie: first,
  })
  // A man a year into his career keeps the season he actually played in the NBA; only the
  // men who have never played one are priced off the draft.
  if (first) {
    out.v = valueAt(pick)
    out.bpm = bpmAt(pick)
    out.mpg = minutesAt(pick)
  }
  return out
}
