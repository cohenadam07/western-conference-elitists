// WHAT YOU HAVE TOLD THE LEAGUE YOU ARE DOING.
//
// Every team in the NBA knows, by about January, which side of the line every other team is
// on. It is the single most important piece of information in the trade market and it was
// the one thing the user could not communicate: he could offer a player and hear a price,
// but he could not say "we are trying to win this year" and have the phone ring differently.
//
// So a stance is a public declaration, and the consequence of it is EXACTLY what it is in
// real life: it changes who calls about whom.
//
//   * A seller is telling the league his now-value is for sale. Teams stop calling about
//     his twenty-two-year-old and start calling about his twenty-nine-year-old starter,
//     because that is the man he has just said he will move.
//
//   * A buyer is telling the league he intends to win this season. Teams know exactly what
//     that costs, so they ask for the young men and the picks — the things a buyer has
//     already decided he is willing to spend.
//
// What a stance emphatically does NOT do is move a price. That is the whole discipline of
// it. If declaring "seller" got more back for a thirty-year-old, the stance would be a
// button you press before every trade and the market would be a joke. It reshapes the
// package; it does not discount it. The tension is real and it is entirely in the
// composition: say you are buying and they will ask for the kid you like.
//
// And it stays "within reason". The tilt is bounded at a third either way, it scales with
// how good the player actually is — a thirty-one-year-old twelfth man is not "an older
// productive player", he is a salary — and it can only ever re-rank men a team already
// wanted. Nobody calls about somebody they do not want because you announced something.

export const STANCES = ['neutral', 'buy', 'sell']

export const STANCE_LABEL = {
  neutral: 'Listening',
  buy: 'Buying',
  sell: 'Selling',
}

export const STANCE_BLURB = {
  neutral: 'You are taking calls on anybody. Teams ask for whoever they happen to want.',
  buy: 'You are trying to win this season. Teams will ask for your young players and your picks.',
  sell: 'You are moving now-value. Teams will ask for your older productive players.',
}

// How far a declaration can move a front office's shopping list. A third, and no further:
// past that a stance stops being information and starts being a cheat code.
export const STANCE_TILT = 0.35

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const ramp = (x, lo, hi) => clamp((x - lo) / (hi - lo), 0, 1)

// How much of this man is what he does NOW. Nothing at twenty-two, all of it by twenty-nine.
export const nowness = (p) => ramp(p?.a ?? 27, 22, 29)

// And how much of him is what he might yet be. Upside where the cap sheet carries one —
// every drafted player does — and read off age and rate where it does not.
export function promise(p) {
  const young = 1 - ramp(p?.a ?? 27, 21, 26)
  const up = typeof p?.upside === 'number' ? p.upside : ramp(p?.v ?? 0, 0, 2.5)
  return young * (0.45 + 0.55 * up)
}

// Only a player worth having is interesting to either kind of team. This is the term that
// keeps a stance reasonable: it scales the whole tilt by whether the man is any good, so a
// declaration reshapes the top of a shopping list and leaves the bottom of it alone.
export const useful = (p) => ramp(p?.v ?? 0, 0.1, 1.6)

// The multiplier a rival applies to one of YOUR players because of what you have declared.
export function stanceTaste(p, stance) {
  if (stance !== 'buy' && stance !== 'sell') return 1
  const now = nowness(p) * useful(p)
  const later = promise(p)
  const t = stance === 'sell' ? now - later : later - now
  return 1 + clamp(t, -1, 1) * STANCE_TILT
}

// Draft capital is future currency, so it moves with the young men rather than against them.
export function stancePickTaste(stance) {
  if (stance === 'buy') return 1 + STANCE_TILT * 0.7
  if (stance === 'sell') return 1 - STANCE_TILT * 0.5
  return 1
}

// What the panel says they are after, given what you have told them.
export const stanceAsk = (stance) => (stance === 'buy'
  ? 'young players and draft capital — you told them you are buying'
  : stance === 'sell'
    ? 'the veterans you said you would move'
    : null)

export const readStance = (save) => (STANCES.includes(save?.stance) ? save.stance : 'neutral')
