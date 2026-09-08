// THE SEASON'S BOX SCORE.
//
// The engine has always produced a box score for every game and the season has always
// thrown it away. That was fine while a season was only a win-loss record, and it stopped
// being fine the moment anybody asked who the MVP was: an award voted off the ratings a
// player STARTED the year with is not an award, it is a restatement of the depth chart.
// Nobody wants to be told the best player in the league is the one the game already said
// was the best player in the league.
//
// So the season keeps what happened. One accumulator, folded forward game by game.
//
// The hard constraint this file exists to respect: `simulate()` must stay a pure function
// of the profiles handed to it, byte-identical across the JavaScript and Python engines —
// thirty fixtures check it on every run. So nothing here reaches into the possession loop.
// Everything is folded in AFTER a game is played, from what the engine already returned.
import { rotation, startersOf } from './sim.js'

export const GAME_MINUTES = 240

// Steals and blocks used to be attributed HERE, after the fact, from a generic defensive
// rating — because the engine did not credit them and doing so would have meant touching the
// possession loop. It never worked: two rounds of tuning and the league's steal leader was
// still a centre. It is gone. Savant measures a real steal rate and a real block rate for
// every player, the engine now credits both to the man who earned them, and this file just
// adds up what the box score says. A model you can delete is better than a model you can
// tune.

const round2 = (x) => Math.round(x * 100) / 100

const KEYS = ['pts', 'reb', 'oreb', 'dreb', 'ast', 'tov', 'fgm', 'fga', 'fg3m', 'fg3a',
  'ftm', 'fta', 'stl', 'blk']

// Fold one team's half of one game into the season accumulator.
//
// `box` is the engine's, keyed by profile id and covering both teams at once; `roster` is
// this team's sim profiles, which is how one shared box is split in two.
// `played` is the lineup the engine actually used. It is optional only so that older callers
// and tests keep working; when it is given it is believed, because it is the truth and the
// roster is only a guess at it.
export function accrue(stats, team, roster, box, played) {
  const pool = played || rotation(roster)
  const starters = startersOf(pool)
  for (const p of pool) {
    const b = stats[p.id] || (stats[p.id] = { id: p.id, n: p.n, team, g: 0, min: 0, started: 0 })
    b.team = team
    b.g += 1
    b.min = round2(b.min + p._share * GAME_MINUTES)
    if (starters.has(p.id)) b.started += 1
    const line = box[p.id]
    if (!line) continue
    for (const k of KEYS) if (line[k]) b[k] = round2((b[k] || 0) + line[k])
  }

}

// Per-game rates, which is the language every award is argued in.
export const perGame = (b, k) => (b && b.g ? (b[k] || 0) / b.g : 0)

// A readable line, rounded only at the edge — the accumulator stays fractional so a
// season's worth of attributed steals does not drift by the rounding on every game.
export function line(b) {
  if (!b || !b.g) return null
  const per = (k, d = 1) => Math.round(perGame(b, k) * 10 ** d) / 10 ** d
  return {
    id: b.id, n: b.n, team: b.team, g: b.g, started: b.started,
    mpg: per('min'), pts: per('pts'), reb: per('reb'), ast: per('ast'),
    stl: per('stl'), blk: per('blk'), tov: per('tov'),
    fgPct: b.fga ? b.fgm / b.fga : 0,
    fg3Pct: b.fg3a ? b.fg3m / b.fg3a : 0,
    // True shooting, the one efficiency number worth carrying: points per shooting
    // possession, where a shooting possession is a field-goal attempt plus the fraction of
    // a possession a trip to the line costs.
    ts: (b.fga || b.fta) ? (b.pts || 0) / (2 * ((b.fga || 0) + 0.44 * (b.fta || 0))) : 0,
  }
}

export const allLines = (stats) => Object.values(stats || {}).map(line).filter(Boolean)
