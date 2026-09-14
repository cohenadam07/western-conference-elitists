// HOW MUCH OF THE JOB YOU WANT.
//
// The control surface underneath this is ten separate domains, each set to manual or auto.
// That is the right model and the wrong first question: nobody arriving at a front-office
// game wants to rule on two-way contracts before they have made a trade. So there are three
// doors, and each one is a real job rather than a difficulty slider — the simulation is
// identical in all three; what changes is how much of the work is yours.
import { SEED } from './seed.js'

const AUTO = {
  trades: 'auto', free_agency: 'auto', draft: 'auto', extensions: 'auto',
  rotations: 'auto', practice: 'auto', staff: 'auto', finances: 'auto',
  tactics: 'auto', two_way: 'auto',
}

// WHICH OF THE TEN DIALS ACTUALLY DO ANYTHING.
//
// The control surface declares ten domains and the mode picker counted all ten, so the
// recommended career told a new user that "4 of 10 decisions are yours" when the code
// consulted exactly two. That is not a rounding error — it is the game describing a job it
// does not give you, on the first screen, before you have played a minute.
//
// Three honest states, and the surface shows which is which:
//   routed  the dial changes what happens — set it to auto and the assistant does it
//   yours   the work exists and is yours to do, but the dial cannot hand it to the assistant
//   planned nothing is built yet; it is handled for you because there is nothing to hand over
//
// The rule for moving something up this list is the same as everywhere else in this codebase:
// a `controls()` call site, or it does not count.
export const DOMAIN_STATUS = {
  rotations: 'routed',
  draft: 'routed',
  trades: 'yours',
  free_agency: 'yours',
  staff: 'yours',
  practice: 'yours',
  extensions: 'planned',
  finances: 'planned',
  tactics: 'planned',
  two_way: 'planned',
}

export const LIVE_DOMAINS = Object.keys(DOMAIN_STATUS)
  .filter((k) => DOMAIN_STATUS[k] !== 'planned')

// How many of the levers that exist this preset hands you. Counted against the live ones, so
// the number on the card is a number the game can keep.
export const yoursIn = (levels = {}) =>
  LIVE_DOMAINS.filter((k) => (levels[k] ?? 'manual') === 'manual').length

export const MODES = [
  {
    key: 'easy',
    label: 'Trade desk',
    tag: 'Easy',
    blurb: 'You make trades. Everything else is run by your staff.',
    detail: 'The deadline, the phone calls, the cap rules that decide whether a deal is even '
      + 'legal. Your assistant re-signs the roster, makes the picks and sets the rotation.',
    teaches: ['salary_cap', 'matching', 'apron', 'value', 'stepien'],
    levels: { ...AUTO, trades: 'manual' },
  },
  {
    key: 'medium',
    label: 'General manager',
    tag: 'Medium',
    blurb: 'Trades, contracts and the draft. The coaching staff coaches.',
    detail: 'Everything that decides who is on the roster: the deadline, your own free agents, '
      + 'extensions, and draft night. Minutes, practice and scheme stay with the coach.',
    teaches: ['bird_rights', 'market_price', 'draft_board', 'surplus', 'tax'],
    levels: { ...AUTO, trades: 'manual', free_agency: 'manual', draft: 'manual', extensions: 'manual' },
  },
  {
    key: 'hard',
    label: 'The whole job',
    tag: 'Hard',
    blurb: 'Everything. Negotiations, the scouting department, the rotation and its minutes.',
    detail: 'Every lever there is: what you pay and what you say in the room, who scouts which '
      + 'league, how the roster fits together, and who plays how many minutes — against what '
      + 'those minutes cost a body over eighty-two games.',
    teaches: ['negotiation', 'scouting', 'fit', 'rotation', 'fatigue'],
    levels: {
      trades: 'manual', free_agency: 'manual', draft: 'manual', extensions: 'manual',
      rotations: 'manual', practice: 'manual', staff: 'manual', finances: 'manual',
      tactics: 'manual', two_way: 'manual',
    },
  },
]

export const MODE = Object.fromEntries(MODES.map((m) => [m.key, m]))

// What a save is actually set to. Derived from the levels rather than stored twice, so a
// player who hand-edits one domain gets an honest answer instead of a stale label.
export function modeOf(save) {
  const lv = save?.controlSurface?.levels || {}
  const manual = Object.keys(lv).filter((k) => lv[k] === 'manual')
  if (manual.length >= 9) return MODE.hard
  if (manual.length >= 4) return MODE.medium
  if (manual.length <= 2) return MODE.easy
  return { ...MODE.medium, label: 'Custom', tag: 'Custom' }
}

// Is this domain the user's problem, or the staff's?
export const controls = (save, domain) => (save?.controlSurface?.levels?.[domain] ?? 'manual') === 'manual'

// THE THIRD LEVEL IS NOT THE SECOND ONE.
//
// `controls()` answers manual-or-not, which is the right question for "should this screen
// exist" and the WRONG one for "should the assistant just do it". There are three levels and
// `advised` is the interesting one — the assistant recommends and you approve — so a feature
// that resolves itself on anything that is not `manual` silently takes the decision away from
// the default career, where every domain is set to advised.
export const levelOf = (save, domain) => save?.controlSurface?.levels?.[domain] ?? 'manual'
export const delegated = (save, domain) => levelOf(save, domain) === 'auto'

// Who handles it when it is not you. Used to tell the player what happened rather than
// silently doing it behind their back.
export const handledBy = (domain) => SEED.domains?.[domain]?.auto
  || 'Your staff handle this one.'
