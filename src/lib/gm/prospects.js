// PROSPECT PROFILES — the draft-room version of a Savant page.
//
// A generated prospect used to be a name, an age and a hidden number. That is enough to
// run a draft and nothing like enough to make one interesting: you cannot argue about a
// player you cannot see. So every prospect now carries what the site's draft profiles
// carry — where he plays, how he measures, what he is, and where his game is strong and
// thin — on the SAME skill axes the fit model was fitted on, so a rookie and a fifteen-year
// veteran are described in one language.
//
// The truth of all that is hidden. What a team sees is the truth blurred by how well its
// scouts cover him, which is the entire point of the department.
import { SEED } from './seed.js'
import { REGIONS, REGION, AXES, accuracyFor } from './scouts.js'

const D = SEED.draft

/* ------------------------------------------------------------------ where from */

const SCHOOLS = {
  acc: ['Duke', 'North Carolina', 'Louisville', 'Virginia', 'Miami', 'Syracuse', 'Wake Forest'],
  sec: ['Kentucky', 'Arkansas', 'Alabama', 'Tennessee', 'Auburn', 'Texas A&M', 'LSU'],
  b1g: ['Michigan State', 'Indiana', 'Illinois', 'Purdue', 'UCLA', 'Maryland', 'Ohio State'],
  b12: ['Kansas', 'Baylor', 'Houston', 'Texas Tech', 'Arizona', 'Iowa State', 'BYU'],
  bigeast: ['Villanova', 'UConn', 'Creighton', 'Marquette', 'St. John’s', 'Providence'],
  midmajor: ['Gonzaga', 'Saint Mary’s', 'Dayton', 'VCU', 'Belmont', 'Murray State', 'Yale',
    'UC Santa Barbara', 'Grand Canyon'],
  euro: ['Real Madrid', 'Barcelona', 'Olympiacos', 'Fenerbahçe', 'Žalgiris', 'Baskonia',
    'Partizan', 'Virtus Bologna'],
  euro2: ['Ratiopharm Ulm', 'Cholet', 'Joventut', 'Mega Basket', 'Élan Béarnais', 'Trento'],
  nbl: ['Sydney Kings', 'Melbourne United', 'Perth Wildcats', 'Illawarra Hawks', 'NZ Breakers'],
  africa: ['AS Douanes', 'Petro de Luanda', 'Al Ahly', 'NBA Academy Africa', 'Rivers Hoopers'],
  latam: ['Flamengo', 'Franca', 'Boca Juniors', 'Quimsa'],
  gleague: ['G League Ignite', 'Rio Grande Valley', 'College Park', 'Santa Cruz'],
  prep: ['Montverde Academy', 'IMG Academy', 'Overtime Elite', 'Sunrise Christian', 'Link Academy'],
}

// Name pools that fit where he is from, because "Kai Whitfield of Žalgiris" reads wrong.
const NAMES = {
  us: {
    first: ['Amari', 'Kai', 'Deshawn', 'Tariq', 'Marcus', 'Jalen', 'Obi', 'Theo', 'Cade',
      'Silas', 'Dante', 'Trey', 'Malik', 'Noah', 'Zion', 'Brayden', 'Jaxon', 'Corey'],
    last: ['Whitfield', 'Mabry', 'Bright', 'Croft', 'Doyle', 'Ferris', 'Vance', 'Holloway',
      'Sturdivant', 'Beckham', 'Rowe', 'Crenshaw', 'Pickett', 'Vaughn'],
  },
  euro: {
    first: ['Luka', 'Nikola', 'Ivan', 'Jonas', 'Mateo', 'Andrei', 'Kristaps', 'Elias', 'Rui',
      'Tomas', 'Sasha', 'Goran', 'Matteo', 'Arnas'],
    last: ['Petrov', 'Lindqvist', 'Novak', 'Marchetti', 'Ivanov', 'Karlsson', 'Radic',
      'Vasiljević', 'Kuzmanov', 'Bertans', 'Sarr', 'Jokubaitis', 'Pereira'],
  },
  africa: {
    first: ['Kofi', 'Emeka', 'Ade', 'Femi', 'Yusuf', 'Ousmane', 'Mamadou', 'Chidi', 'Tafari'],
    last: ['Okonkwo', 'Achebe', 'Kimani', 'Ndiaye', 'Bello', 'Sowande', 'Boateng', 'Diallo',
      'Mensah', 'Traoré'],
  },
  latam: {
    first: ['Diego', 'Mateo', 'Rafael', 'Bruno', 'Tomás', 'Santiago'],
    last: ['Barrera', 'Vasquez', 'Ferreira', 'Sandoval', 'Delgado', 'Reyes', 'Aguilar'],
  },
}
const NAME_POOL = {
  acc: 'us', sec: 'us', b1g: 'us', b12: 'us', bigeast: 'us', midmajor: 'us',
  gleague: 'us', prep: 'us', nbl: 'us', euro: 'euro', euro2: 'euro',
  africa: 'africa', latam: 'latam',
}

/* --------------------------------------------------------------- archetypes */

// What each archetype looks like on the fit model's axes, before talent is applied.
// League average on these scales is about 50.
const ARCH = {
  'Combo Guard': { slot: 1.6, sh: 62, gr: 60, rp: 22, pd: 50, pm: 62, sc: 78, sz: 30, rpr: 64, bs: 52 },
  'Pass-First Guard': { slot: 1.2, sh: 48, gr: 44, rp: 20, pd: 48, pm: 80, sc: 52, sz: 28, rpr: 52, bs: 62 },
  'Movement Shooter': { slot: 2.4, sh: 80, gr: 70, rp: 24, pd: 44, pm: 46, sc: 54, sz: 40, rpr: 40, bs: 50 },
  '3&D Role Player': { slot: 3.0, sh: 66, gr: 46, rp: 38, pd: 72, pm: 38, sc: 34, sz: 52, rpr: 44, bs: 54 },
  'Jumbo Creator': { slot: 3.3, sh: 54, gr: 66, rp: 40, pd: 58, pm: 66, sc: 74, sz: 64, rpr: 66, bs: 50 },
  'Role Big': { slot: 4.3, sh: 44, gr: 40, rp: 66, pd: 42, pm: 40, sc: 34, sz: 76, rpr: 52, bs: 50 },
  'Rim-Running Big': { slot: 4.8, sh: 22, gr: 34, rp: 80, pd: 34, pm: 30, sc: 26, sz: 84, rpr: 74, bs: 46 },
}
export const ARCHETYPES = Object.keys(ARCH)
const SKILL_FIELDS = ['sh', 'gr', 'rp', 'pd', 'pm', 'sc', 'sz', 'rpr', 'bs']
export const SKILL_LABEL = {
  sh: 'Shooting', gr: 'Gravity', rp: 'Rim protection', pd: 'Perimeter defence',
  pm: 'Playmaking', sc: 'Self creation', sz: 'Size', rpr: 'Rim pressure', bs: 'Ball security',
}

const POS_BY_SLOT = (slot) => (slot < 1.6 ? 'PG' : slot < 2.5 ? 'SG' : slot < 3.5 ? 'SF'
  : slot < 4.5 ? 'PF' : 'C')

// Measurements that match the position, because a 6'2" centre reads as a bug.
function measure(slot, r) {
  const inches = Math.round(70 + slot * 2.6 + r.gauss(0, 1.1))
  const wing = inches + Math.round(1.5 + r.gauss(1.6, 1.4))
  const weight = Math.round(160 + slot * 17 + r.gauss(0, 11))
  const fmt = (i) => `${Math.floor(i / 12)}'${i % 12}"`
  return { height: fmt(inches), heightIn: inches, wingspan: fmt(wing), weight: `${weight} lbs` }
}

/* ------------------------------------------------------------------ the class */

// Attach everything a scout would have on file. The hidden outcome (`_vorp4`, `_u`) is
// untouched — this decorates the same prospect the draft engine already generates.
export function enrich(prospects, r) {
  const bag = []
  for (const reg of REGIONS) {
    for (let i = 0; i < Math.round(reg.share * 100); i++) bag.push(reg.key)
  }
  // Archetypes are drawn at the LEAGUE's own frequencies — the minutes shares the fit model
  // was fitted on — not uniformly. Uniform drawing put three rim-running bigs in the top
  // seven of a class, which no draft has ever looked like.
  const archBag = []
  for (const a of ARCHETYPES) {
    const key = `a_${a.replace(/&/g, '').replace(/\s+/g, '_')}`
    const share = SEED.fit?.arch_mean?.[key] ?? 1 / ARCHETYPES.length
    for (let i = 0; i < Math.max(1, Math.round(share * 100)); i++) archBag.push(a)
  }
  const used = new Set()
  return prospects.map((p) => {
    const region = bag[r.randrange(bag.length)]
    const pool = NAMES[NAME_POOL[region]]
    let name
    for (let tries = 0; tries < 40; tries++) {
      name = `${pool.first[r.randrange(pool.first.length)]} ${pool.last[r.randrange(pool.last.length)]}`
      if (!used.has(name)) break
    }
    used.add(name)
    const arch = archBag[r.randrange(archBag.length)]
    const base = ARCH[arch]
    // Talent lifts the whole profile, and it lifts the archetype's own strengths most —
    // an elite shooter is elite at shooting, not uniformly better at everything.
    const lift = (p._u / Math.sqrt(D.load * D.load + 1)) * 11
    const skills = {}
    for (const f of SKILL_FIELDS) {
      const emphasis = (base[f] - 50) / 50
      skills[f] = Math.max(5, Math.min(99, Math.round(
        base[f] + lift * (0.7 + 0.5 * emphasis) + r.gauss(0, 7))))
    }
    // Younger and further from the NBA means "project"; older producers are "ready".
    const collegeAge = p.age
    const type = collegeAge <= 19.4 || region === 'prep' ? 'project'
      : collegeAge >= 21 ? 'ready' : (r.rand() < 0.5 ? 'project' : 'ready')
    const slot = Math.max(1, Math.min(5, base.slot + r.gauss(0, 0.35)))
    const schools = SCHOOLS[region]
    return {
      ...p,
      name,
      region,
      regionLabel: REGION[region].label,
      school: schools[r.randrange(schools.length)],
      arch,
      type,
      slot: Math.round(slot * 100) / 100,
      pos: POS_BY_SLOT(slot),
      ...measure(slot, r),
      skills,
      // The year label a draft profile uses.
      classYear: collegeAge <= 19.3 ? 'Fr.' : collegeAge <= 20.3 ? 'So.'
        : collegeAge <= 21.3 ? 'Jr.' : 'Sr.',
    }
  })
}

/* ------------------------------------------------------ what your staff sees */

// The observed profile. Noise on each axis shrinks with scouting accuracy, and a scout who
// reads one part of the game especially well is sharper on exactly those fields.
export function scoutedProfile(prospect, staff, r, opts = {}) {
  const acc = accuracyFor(prospect, staff, opts)
  const spread = 26 * (1 - acc.q)              // ~20 points blind, ~10 well covered
  const sharpFields = acc.by ? (AXES.find((a) => a.key === acc.by.axis)?.fields || []) : []
  const seen = {}
  for (const f of SKILL_FIELDS) {
    const sd = sharpFields.includes(f) ? spread * 0.55 : spread
    seen[f] = Math.max(1, Math.min(99, Math.round(prospect.skills[f] + r.gauss(0, sd * 0.4))))
  }
  return {
    ...acc,
    seen,
    sharp: sharpFields,
    confidence: acc.q >= 0.5 ? 'high' : acc.q >= 0.4 ? 'fair' : acc.q >= 0.3 ? 'thin' : 'guesswork',
  }
}

/* ---------------------------------------------------------------- the report */

const STRENGTH_LINE = {
  sh: 'The jumper is real — he can be played off the catch on day one.',
  gr: 'Defences already account for him away from the ball, which is the hard part to teach.',
  rp: 'Protects the rim on his own; you can play him at the back of a scheme.',
  pd: 'Guards his position on an island and can be hidden nowhere on the floor.',
  pm: 'Sees the next pass before the first one arrives.',
  sc: 'Can get his own shot when the offence stalls, which is what separates starters from bench.',
  sz: 'Genuine NBA size for the position, with the frame to carry more.',
  rpr: 'Gets downhill and lives at the rim and the line.',
  bs: 'Takes care of the ball under pressure.',
}
const CONCERN_LINE = {
  sh: 'The shot is the swing skill and right now it is a real question.',
  gr: 'Nobody guards him off the ball yet, which shrinks the floor for whoever plays with him.',
  rp: 'Not a rim deterrent, so he needs a centre who is.',
  pd: 'Gets hunted on switches; that has to change or he cannot close games.',
  pm: 'Reads are late — he plays fast rather than early.',
  sc: 'Cannot create his own look, so his minutes depend on other people.',
  sz: 'Undersized for the spot he will have to guard.',
  rpr: 'Lives on the perimeter and does not pressure the rim.',
  bs: 'Loose with the ball into traffic.',
}

const VOICE = {
  project: ['what he becomes', 'the tools are the bet', 'two years from useful, five from good'],
  ready: ['what he is now', 'he can play in October', 'the floor is the appeal'],
}

// A report reads off the SCOUTED profile, never the truth — and says plainly when nobody
// has actually watched him.
export function report(prospect, view, opts = {}) {
  const ranked = Object.entries(view.seen).sort((a, b) => b[1] - a[1])
  const strengths = ranked.slice(0, 2).map(([f]) => STRENGTH_LINE[f])
  const concerns = ranked.slice(-2).reverse().map(([f]) => CONCERN_LINE[f])
  const by = view.by
  const lean = by ? VOICE[by.lean] : null

  const head = !by ? 'No report on file — you have no scouting department.'
    : view.covered
      ? `${by.name} has watched him live in ${prospect.regionLabel}.`
      : `${by.name} filed this off tape. Nobody on staff covers ${prospect.regionLabel}.`

  const projection = view.q < 0.32
    ? 'Our read on him is close to a coin flip. Anyone telling you otherwise is guessing.'
    : lean
      ? `${by.name} grades him on ${lean[0]}: ${lean[1]}.`
      : ''

  return {
    head,
    strengths,
    concerns,
    projection,
    confidence: view.confidence,
    workouts: view.workouts || 0,
    sharpNote: by && view.sharp.length
      ? `Reads ${AXES.find((a) => a.key === by.axis).label} better than most, so those grades are firmer.`
      : null,
  }
}

// A letter grade off the board position the team's own scouting produced. Deliberately
// coarse: a grade is an opinion, and precision would be a lie.
export function gradeOf(boardRank, n = 60) {
  const pct = boardRank / n
  if (pct <= 0.05) return 'A+'
  if (pct <= 0.12) return 'A'
  if (pct <= 0.22) return 'A−'
  if (pct <= 0.35) return 'B+'
  if (pct <= 0.5) return 'B'
  if (pct <= 0.68) return 'B−'
  if (pct <= 0.85) return 'C+'
  return 'C'
}
