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

// Who handles it when it is not you. Used to tell the player what happened rather than
// silently doing it behind their back.
export const handledBy = (domain) => SEED.domains?.[domain]?.auto
  || 'Your staff handle this one.'
