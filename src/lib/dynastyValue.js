/* The value curve — how a crowd rating becomes a trade value.
 *
 * WHY THIS EXISTS
 * Elo is an excellent ordinal scale and a terrible cardinal one. It answers "who would the
 * crowd rank higher", not "how much is he worth", and its differences are small: the whole
 * board spans 1115 to 1850, a ratio of 1.66. Summing those numbers made two throw-ins beat a
 * franchise player — Nurkic (1195) + Jaylin Williams (1158) = 2353 against Luka at 1825.
 * That is not a rounding problem, it is the wrong scale. Dynasty value is steeply convex at
 * the top because roster spots are scarce: you play your best players and quantity does not
 * substitute for quality.
 *
 * WHY NOT EXPONENTIATE THE RATING
 * Elo ratings are log-strengths, so 10^(R/400) is the textbook cardinal reading, and it was
 * the first thing tried. It cannot work here, because the rating distribution is not shaped
 * for it: ranks 1-10 are spread 14 Elo points per player while ranks 200-347 are spread 0.34.
 * Any exponential steep enough to sink that tail also makes the top so dominant that two
 * top-15 players cannot add up to the number one asset — which is its own kind of wrong.
 *
 * WHAT THIS DOES INSTEAD
 * Take the curve shape from the domain — dynasty value charts decay roughly exponentially by
 * rank — and let the crowd decide who sits where. Value is TOP * exp(-rank/LAMBDA), with rank
 * a CONTINUOUS coordinate interpolated from the rating, so a player who gains ground without
 * passing anyone still ticks up. Order is untouched: the curve is monotone in rating, so the
 * board reads exactly as the market voted. Only magnitudes change.
 *
 * LAMBDA = 40 was calibrated against real trades on the live board:
 *   Luka         beats  Nurkic + Jaylin Williams        by 96%   <- the failure that started this
 *   a top-5      beats  three players ranked 55-65      by 24%   <- quality over quantity
 *   but #1       LOSES  to #12 + #18                    by 29%   <- stars still add up
 * At 55 and above the top-5 starts losing to three mids, which is the bug returning. At 30 the
 * tail dies so fast that most of the league is worth nothing at all.
 */

export const VALUE_TOP = 10000
export const VALUE_LAMBDA = 40

/* Sorted ratings, high to low, plus the rank each distinct rating starts at. Built once per
 * board read and passed around, so the curve is one shared object rather than a recompute. */
export function buildScale(ratings) {
  const sorted = (ratings || []).filter((r) => Number.isFinite(r)).sort((a, b) => b - a)
  return { sorted, n: sorted.length }
}

/* Continuous rank for a rating: where it sits in the sorted board, interpolated inside its
 * own gap. Ties share the midpoint of their block so identical ratings are identically
 * valued — which matters in the tail, where hundreds of players sit on the same number. */
export function effRank(scale, rating) {
  const a = scale.sorted
  const n = a.length
  if (!n || !Number.isFinite(rating)) return 0
  // first index with a[i] <= rating, and last index with a[i] >= rating
  let lo = 0, hi = n
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] > rating) lo = m + 1; else hi = m }
  const first = lo
  let lo2 = 0, hi2 = n
  while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (a[m] >= rating) lo2 = m + 1; else hi2 = m }
  const last = lo2 - 1

  if (last >= first) return (first + last) / 2          // exact match, possibly a tie block
  // strictly between two ratings (or off an end): interpolate
  const above = first - 1, below = first
  if (above < 0) return 0
  if (below >= n) return n - 1
  const span = a[above] - a[below]
  const frac = span > 0 ? (a[above] - rating) / span : 0.5
  return above + frac
}

export function valueOf(scale, rating) {
  return VALUE_TOP * Math.exp(-effRank(scale, rating) / VALUE_LAMBDA)
}

/* Rounded for display. Below ~1 the curve is quoting fractions of a point, which reads as
 * false precision — everything down there is a throw-in, so it floors at 1. */
export function displayValue(scale, rating) {
  return Math.max(1, Math.round(valueOf(scale, rating)))
}
