// Savant value and the All-Savant Team, for the connector build.
//
// The page and this build run one implementation: public/savant-value.js, imported here for
// its side effect (it sets globalThis.SavantValue). The learned numbers are
// public/savant-value.json, written by tools/savant-value/value.py. tools/savant-value/check.mjs
// holds the JavaScript to value.py's math on every player of several seasons.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import '../../public/savant-value.js'

const SV = globalThis.SavantValue

/** The learned model, or null when the file is missing (the build then goes without). */
export function readValueModel(publicDir) {
  const f = path.join(publicDir, 'savant-value.json')
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}

// Stored the way the page prints them, so the connector and the cards never differ by a
// rounding: value as the page's Math.round, per-100 numbers as its sign + abs().toFixed(1).
const asPageInt = (v) => Math.round(v)
const asPage1 = (v) => (v < 0 ? -1 : 1) * Number(Math.abs(v).toFixed(1)) || 0

/**
 * Value for every player of one season, and the two teams.
 * @param players rows with the page's positions already applied (p.pos)
 * @returns { byId: Map(id -> [value, per100, posRank|null, parts[]]), teams: [[id x5], [id x5]] }
 */
export function seasonValue(players, model) {
  const res = SV.season(players, model)
  const teams = SV.team(players, res, model, null, 2)
  // rank among qualified players at the position, by value
  const rankOf = new Map()
  for (const pos of SV.POSITIONS) {
    const q = [...res.values()].filter((v) => v.q && v.pos === pos).sort((a, b) => b.value - a.value)
    q.forEach((v, i) => rankOf.set(v.id, [i + 1, q.length]))
  }
  const keys = model.parts.map((p) => p.key)
  const byId = new Map()
  for (const [id, v] of res) {
    const rk = rankOf.get(id)
    byId.set(id, [asPageInt(v.value), asPage1(v.rate), rk ? rk[0] : null, keys.map((k) => asPage1(v.parts[k] || 0))])
  }
  const count = {}
  for (const pos of SV.POSITIONS) count[pos] = [...res.values()].filter((v) => v.q && v.pos === pos).length
  return { byId, teams: teams.map((t) => t.map((x) => x.p.id)), count }
}

/** What the season file's fields mean, for meta.json. */
export function valueMeta(model) {
  return {
    what: 'Savant value: the points a player added to his team that season above a replacement-level player at his position (Guard, Wing, Big), on the stats that are his own and the possessions he played. Missed games cost him. The All-Savant Team is the highest value at two guard, two wing and one big spot, a 1st team and a 2nd, qualified players only, one team per player.',
    how: 'Rate = points per 100 possessions vs. an average player at his position, from box stats (shooting efficiency, usage, 3-point and free-throw rate, assist %, turnovers, rebound % at both ends, steals, blocks), each pulled toward the position average by its settle point and weighted by what it is worth in luck-adjusted on/off (learned on 2009-10 to 2024-25) and by the share of it that follows a player to a new team. From 2009-10 the rate also takes in part of what his luck-adjusted on/off says beyond the box score: weight w / (w + K), w = 1 / (1/minutes on + 1/team minutes without him), about 13% for a full-time starter. Value = (rate - the 25th-percentile qualified rate at his position) x possessions / 100.',
    checks: 'On the held-out 2025-26 season, a player\'s 2024-25 rate correlated .37 with his 2025-26 luck-adjusted on/off; BPM .35. Checked against the real All-NBA, never tuned to it: since 1988-89, 63% of our 1st and 2nd teamers made the real 1st or 2nd team.',
    row: 'sv: [points over replacement (whole points), points per 100 vs. an average player at his position (one decimal), rank among qualified players at his position (null if not qualified), parts per 100 in the order of parts (one decimal)]. Rounded exactly as the page prints them.',
    season: 'all_savant: [1st team ids, 2nd team ids], each guard, guard, wing, wing, big. value_count: qualified players at each position.',
    parts: model.parts.map((p) => ({ key: p.key, label: p.label })),
    K: model.K,
    learned: model.learned,
    page: 'https://wcehoops.com/basketball-savant.html',
  }
}
