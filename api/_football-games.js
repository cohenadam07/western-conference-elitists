// api/_football-games.js — Football Savant below the season line: a player's games week by
// week and his recent form, his splits, his throw / target / rushing map and route tree, and
// the postseason game pages. One section of the AI connector (api/mcp.js), beside
// api/_football.js, whose player index, season files and name matching it shares.
//
// WHAT IT READS
// These views are drawn by the page from its own small public files, which the connector
// reads as they are published (no copy is made at build time):
//   football-weekly/<season>/<id>.json or pack-<nn>.json   one man's games, week by week
//   football-weekly/<season>/form-<n>.json                 everyone's last 4, 8 or 17 games
//   football-splits/<season>.json                          sums by down, distance, field ...
//   football-maps/<season>.json, football-routes/<season>.json
//   football-games/index.json and <game>.json              every postseason game since 1999
// Every cell in them is a count or a sum, so the rates are taken here exactly as the page takes
// them, with the page's rules: a split's headline rate is ranked against every player with a
// real sample in that split; a game's number is ranked against that season's full-season
// lines at his position ("a 90th-percentile level"); a route is coloured by how it went
// against his position on the same route, pulled toward average on a small sample.
// tools/savant-football/check.mjs lifts the page's own functions and holds every one of these
// to them.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SITE, SavantError, day, makeLoader, miss, norm, ordinal, thousands } from './_core.js'
import { SOURCE, cardUrl, display, loadMeta, loadSeason, parseSeason, played, resolvePlayer, rowsOf, seasonsOf, teamIn } from './_football.js'
import { parseStat, percentile } from './_football-lists.js'

const page = makeLoader('', { what: 'Football Savant', maxCached: 12, shape: () => true })
const GAMES_URL = `${SITE}/game.html`

const cellOf = (r, key) => (r.m && r.m[key]) || (r.xm && r.xm[key]) || null

// ---- the season pool a single game is ranked in --------------------------------------------
// poolVals() on the page: qualified players at the position that season with a value.
const pools = new WeakMap()
function seasonPool(file, pos, key) {
  let mine = pools.get(file)
  if (!mine) { mine = new Map(); pools.set(file, mine) }
  const k = `${pos}|${key}`
  if (!mine.has(k)) {
    const a = []
    for (const r of file.players) { if (!r.qualified || r.pos !== pos) continue; const c = cellOf(r, key); if (c && !miss(c[0])) a.push(c[0]) }
    mine.set(k, Float64Array.from(a).sort())
  }
  return mine.get(k)
}
// the page's median(): nothing with fewer than five
function median(a) { if (!a || a.length < 5) return null; const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2 }

// One man's games in one season, in whichever shape the season's index says they are stored.
async function weeklyOf(season, id) {
  const idx = await page.load(`football-weekly/${season}/index.json`).catch(() => null)
  if (!idx) return { idx: null, f: null }
  if (!idx.pack) return { idx, f: await page.load(`football-weekly/${season}/${id}.json`).catch(() => null) }
  const pack = await page.load(`football-weekly/${season}/pack-${String(id).slice(-idx.pack)}.json`).catch(() => null)
  return { idx, f: (pack && pack[id]) || null }
}

// ---- games, week by week, and recent form ---------------------------------------------------

export async function playerGames({ player, season, stats }) {
  const meta = await loadMeta()
  const wanted = parseSeason(season, meta)
  const who = await resolvePlayer(player, wanted, meta)
  const s = wanted || String(who.to)
  if (!played(who, s)) throw new SavantError(`${who.name} has no stats in ${s}. Football Savant has him in ${seasonsOf(who)}.`)
  const [file, { idx, f }] = await Promise.all([loadSeason(s), weeklyOf(s, who.id)])
  const row = rowsOf(file).get(who.id)
  const pos = (row && row.pos) || (f && f.pos) || who.pos
  const posMeta = meta.positions[pos] || { label: pos, peers: pos, headline: [] }
  const never = new Set(meta.seasonOnly || [])
  const byKey = Object.fromEntries(meta.metrics.map((m) => [m.key, m]))
  const tm = teamIn(meta, s)
  const oshow = (o) => { if (!o || o === 'BYE') return o || ''; const at = o[0] === '@'; return (at ? '@' : '') + tm(at ? o.slice(1) : o) }
  const vs = (o) => { const x = oshow(o); return !x ? '' : x[0] === '@' ? `at ${x.slice(1)}` : `vs ${x}` }

  // which stats: the asked-for ones, else his position's headline stats that have a game line
  const choices = meta.metrics.filter((m) => m.positions.includes(pos))
  let picked = (stats && stats.length ? stats.map((x) => parseStat(x, choices)) : (posMeta.headline || []).map((k) => byKey[k]).filter(Boolean)).slice(0, 8)
  const notWeekly = picked.filter((m) => never.has(m.key) || m.group === 'ath')
  picked = picked.filter((m) => !notWeekly.includes(m))
  if (f) picked = picked.filter((m) => (f.m || {})[m.key] && f.m[m.key].some((v) => v != null))
  const live = file.week || null

  const games = []
  if (f && idx) {
    const nW = Math.max(idx.week || 0, f.w[f.w.length - 1] || 0)
    const slate = (t, w) => (((idx.teams || {})[t] || {})[String(w)] || '')
    const team = (row && row.team) || f.t[f.t.length - 1]
    for (let w = 1; w <= nW; w++) {
      const i = f.w.indexOf(w)
      if (i < 0) {
        // between two clubs a week is only a bye if it was one for both
        let prev = null, next = null
        for (let k = 0; k < f.w.length; k++) { if (!f.t[k]) continue; if (f.w[k] < w) prev = f.t[k]; else if (f.w[k] > w) { next = f.t[k]; break } }
        if (prev && next && prev !== next && !(slate(prev, w) === 'BYE' && slate(next, w) === 'BYE')) { games.push({ week: w, status: 'between teams', between: `${tm(prev)} to ${tm(next)}` }); continue }
        const sl = slate(prev || next || team, w)
        games.push(sl === 'BYE' ? { week: w, status: 'bye' } : { week: w, status: 'did not play', opponent: oshow(sl) || null })
        continue
      }
      const g = { week: w, status: 'played', team: tm(f.t[i]), opponent: oshow(f.o[i]), stats: {} }
      for (const m of picked) {
        const v = f.m[m.key][i]
        if (v == null) { g.stats[m.key] = null; continue }
        const den = m.den && m.den !== 'g' && f.d && f.d[m.den] ? f.d[m.den][i] : null
        g.stats[m.key] = { value: v, display: display(m.unit, v), level: percentile(v, seasonPool(file, pos, m.key), m.lowerIsBetter), on: den }
      }
      games.push(g)
    }
  }
  const lines = picked.map((m) => {
    const pool = seasonPool(file, pos, m.key)
    const sc = row && cellOf(row, m.key)
    const played_ = games.filter((g) => g.status === 'played' && g.stats[m.key])
    let best = null
    for (const g of played_) if (!best || (m.lowerIsBetter ? g.stats[m.key].value < best.stats[m.key].value : g.stats[m.key].value > best.stats[m.key].value)) best = g
    const last = played_[played_.length - 1] || null
    const med = median(pool)
    return {
      key: m.key, label: m.label, lower_is_better: m.lowerIsBetter,
      season: sc ? { value: sc[0], display: display(m.unit, sc[0]), percentile: sc[1] } : null,
      best_game: best ? { week: best.week, opponent: best.opponent, display: best.stats[m.key].display, level: best.stats[m.key].level } : null,
      last_game: last ? { week: last.week, opponent: last.opponent, display: last.stats[m.key].display, level: last.stats[m.key].level } : null,
      position_median: med == null ? null : { value: med, display: display(m.unit, med) },
    }
  })

  // recent form: the page's last 4, 8 and 17 games, each against everyone's same stretch
  const form = []
  if (live && s === meta.latestSeason) {
    for (const n of [4, 8, 17]) {
      const ff = await page.load(`football-weekly/${s}/form-${n}.json`).catch(() => null)
      const w = ff && ff.players && ff.players[who.id]
      if (!w) continue
      const out = { last: n, games: w.n, reaches_back_into: w.from || null, qualified: !!w.q, stats: {} }
      for (const m of picked) {
        const v = (w.m || {})[m.key]
        if (miss(v)) continue
        const a = []
        for (const id in ff.players) { const r = ff.players[id]; if (r.q && r.pos === pos && !miss((r.m || {})[m.key])) a.push(r.m[m.key]) }
        out.stats[m.key] = { value: v, display: display(m.unit, v), percentile: percentile(v, Float64Array.from(a).sort(), m.lowerIsBetter) }
      }
      form.push(out)
    }
  }

  const peers = posMeta.peers
  const notes = [
    `A game's "level" is where that one game would rank among ${s}'s full-season lines by qualified ${peers}: one game is a small sample, and the season line is the settled reading.`,
  ]
  if (form.length) notes.push(`Recent form ranks his last N games (reaching back into last season where he has played fewer this year) against every qualified ${posMeta.label.toLowerCase()}'s same stretch. A short window rests on very little: read it as form, not as who he is.`)
  if (notWeekly.length) notes.push(`No game-by-game version of ${notWeekly.map((m) => m.label).join(', ')}: ${notWeekly.length === 1 ? 'it only exists' : 'they only exist'} over a season.`)
  const structured = {
    player: { id: who.id, name: who.name, position: posMeta.label }, season: s, in_progress: live ? { through_week: live } : null,
    stats: picked.map((m) => ({ key: m.key, label: m.label, lower_is_better: m.lowerIsBetter })), games, lines, form, notes,
    url: cardUrl(who.id, s), data_as_of: day(file.generated || meta.generated), source: SOURCE,
  }
  if (!f) return { structured, text: `No game-by-game lines for ${who.name} in ${s}${idx ? '' : ': they have not been published yet'}. His season line: nfl_get_player_profile.` }
  const L = [`${who.name} (${posMeta.label}), ${s} game by game${live ? `, through week ${live}` : ''}`]
  for (const g of games) {
    if (g.status !== 'played') { L.push(`Wk ${g.week}: ${g.status === 'bye' ? 'bye' : g.status === 'between teams' ? `between teams (${g.between})` : `did not play${g.opponent ? ` (${vs(g.opponent)})` : ''}`}`); continue }
    const bits = picked.map((m) => { const c = g.stats[m.key]; return `${m.label} ${c ? `${c.display}${c.level == null ? '' : ` (${ordinal(c.level)})`}` : '—'}` })
    L.push(`Wk ${g.week} ${vs(g.opponent)}: ${bits.join('; ')}`)
  }
  L.push('', 'Season line, best and last game:')
  for (const x of lines) {
    L.push(`- ${x.label}: ${x.season ? `${x.season.display} for the season (${x.season.percentile == null ? 'n/a' : ordinal(x.season.percentile)})` : 'no season line'}${x.best_game ? `; best wk ${x.best_game.week} ${vs(x.best_game.opponent)} ${x.best_game.display}` : ''}${x.last_game ? `; last wk ${x.last_game.week} ${x.last_game.display}` : ''}${x.position_median ? `; ${posMeta.label.toLowerCase()} median ${x.position_median.display}` : ''}${x.lower_is_better ? ' [lower is better]' : ''}`)
  }
  if (form.length) {
    L.push('', 'Recent form (percentile against everyone\'s same stretch):')
    for (const w of form) L.push(`- Last ${w.last} (${w.games} game${w.games === 1 ? '' : 's'}${w.reaches_back_into ? `, reaching back into ${w.reaches_back_into}` : ''}${w.qualified ? '' : ', under the qualifying line'}): ${picked.filter((m) => w.stats[m.key]).map((m) => `${m.label} ${w.stats[m.key].display} (${w.stats[m.key].percentile == null ? 'n/a' : ordinal(w.stats[m.key].percentile)})`).join('; ')}`)
  }
  L.push('', ...notes, '', `Card: ${structured.url} (open a stat's chart, Weekly)`, `Source: ${SOURCE}. Data as of ${structured.data_as_of}.`)
  return { structured, text: L.join('\n') }
}

// ---- splits ------------------------------------------------------------------------------
// The page's SPL_LEDGER: what each ledger counts, the smallest sample a row is ranked on, and
// its columns [heading, value(cell), format, headline].
const spPct = (a, b) => (b ? a / b * 100 : null)
export const SPL_LEDGER = {
  q: { name: 'Passing', unit: 'dropbacks', min: 15, cols: [
    ['Dropbacks', (c) => c[0], 'n'], ['EPA / dropback', (c) => (c[0] ? c[1] / c[0] : null), 'num3', true], ['Success', (c) => spPct(c[2], c[0]), 'pct0'],
    ['Cmp %', (c) => spPct(c[4], c[3]), 'pct0'], ['Yds / att', (c) => (c[3] ? c[5] / c[3] : null), 'num1'], ['TD', (c) => c[6], 'n'], ['INT', (c) => c[7], 'n'],
    ['Sack %', (c) => spPct(c[8], c[0]), 'pct1']] },
  r: { name: 'Rushing', unit: 'carries', min: 10, cols: [
    ['Carries', (c) => c[0], 'n'], ['EPA / carry', (c) => (c[0] ? c[1] / c[0] : null), 'num3', true], ['Yds / carry', (c) => (c[0] ? c[3] / c[0] : null), 'num1'],
    ['Success', (c) => spPct(c[2], c[0]), 'pct0'], ['TD', (c) => c[4], 'n'], ['1st down %', (c) => spPct(c[5], c[0]), 'pct0']] },
  t: { name: 'Receiving', unit: 'targets', min: 8, cols: [
    ['Targets', (c) => c[0], 'n'], ['EPA / target', (c) => (c[0] ? c[1] / c[0] : null), 'num3', true], ['Yds / target', (c) => (c[0] ? c[4] / c[0] : null), 'num1'],
    ['Catch %', (c) => spPct(c[3], c[0]), 'pct0'], ['Success', (c) => spPct(c[2], c[0]), 'pct0'], ['TD', (c) => c[5], 'n'], ['1st down %', (c) => spPct(c[6], c[0]), 'pct0']] },
}
// the page's signed(): the sign is decided after rounding
function signed(v, dp, plus, strip) {
  const mag = Math.abs(v).toFixed(dp)
  const body = strip ? mag.replace(/^0/, '') : mag
  if (!/[1-9]/.test(mag)) return body
  return (v < 0 ? '−' : plus ? '+' : '') + body
}
export function splFmt(f, v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (f === 'n') return String(Math.round(v))
  if (f === 'pct0') return `${Math.round(v)}%`
  if (f === 'pct1') return `${v.toFixed(1)}%`
  if (f === 'num1') return v.toFixed(1)
  return signed(v, 3, true, true)
}
const splPools = new WeakMap()
export function splRank(pack, ledger, key, v) {
  let mine = splPools.get(pack)
  if (!mine) { mine = new Map(); splPools.set(pack, mine) }
  const k = `${ledger}|${key}`
  if (!mine.has(k)) {
    const L = SPL_LEDGER[ledger]
    const pool = []
    for (const id in pack[ledger] || {}) { const c = pack[ledger][id][key]; if (c && c[0] >= L.min) pool.push(c[1] / c[0]) }
    mine.set(k, pool.length < 8 ? null : Float64Array.from(pool).sort())
  }
  const pool = mine.get(k)
  if (!pool) return null
  return { pct: percentile(v, pool, false), n: pool.length }
}
const splLedgers = (pos) => (pos === 'QB' ? ['q', 'r'] : pos === 'RB' ? ['r', 't'] : ['t', 'r'])

async function splits(who, s, pos, meta, ledgerWanted) {
  if (!/^(QB|RB|WR|TE)$/.test(pos)) throw new SavantError(`Splits are drawn for quarterbacks, running backs, receivers and tight ends; ${who.name} was a ${(meta.positions[pos] || {}).label || pos} in ${s}.`)
  const pack = await page.load(`football-splits/${s}.json`).catch(() => null)
  const have = splLedgers(pos).filter((k) => pack && pack[k] && pack[k][who.id])
  if (!have.length) throw new SavantError(`No splits for ${who.name} in ${s}.`)
  const ledger = ledgerWanted && have.includes(ledgerWanted) ? ledgerWanted : have[0]
  const L = SPL_LEDGER[ledger]
  const mine = pack[ledger][who.id]
  const lg = ((pack.lg || {})[ledger] || {})[pos] || {}
  const hot = L.cols.find((c) => c[3])
  const rowOf = (label, key) => {
    const c = mine[key]
    if (!c) return null
    const thin = c[0] < L.min
    const cols = L.cols.map((col) => {
      const v = col[1](c)
      const out = { label: col[0], value: v == null || !Number.isFinite(v) ? null : v, display: splFmt(col[2], v) }
      if (col[3] && !thin && v != null) { const rk = splRank(pack, ledger, key, v); if (rk && rk.pct != null) { out.percentile = rk.pct; out.ranked_among = rk.n } }
      return out
    })
    const lc = lg[key]
    return { split: label, key, thin, columns: cols, league: lc ? { label: hot[0], display: splFmt(hot[2], hot[1](lc)) } : null }
  }
  const groups = [{ group: 'All plays', rows: [rowOf('All plays', 'all')].filter(Boolean) }]
  for (const d of pack.dims || []) {
    if (!d[3].includes(ledger)) continue
    const rows = d[2].map((b) => rowOf(b[1], `${d[0]}.${b[0]}`)).filter(Boolean)
    if (rows.length) groups.push({ group: d[1], rows })
  }
  const live = !!pack.week && s === meta.latestSeason && meta.live
  const note = `His plays from scrimmage, taken apart. Kneel-downs, spikes and two-point tries are left out, so a total here can run a few plays under his season line. The ${hot[0]} in each row is ranked against every player with at least ${L.min} ${L.unit} in that same split; a row with fewer is too few to rank. "League" is the same number for every ${(meta.positions[pos] || {}).label.toLowerCase()} in that split. Play-action, blitz, motion and formation are charted from 2022; pressure, coverage and personnel come from the lineups published after a season${live ? `, so they are not here yet for ${s}` : ''}.`
  const text = [`${who.name}, ${s} splits: ${L.name.toLowerCase()} (${have.length > 1 ? `also: ${have.filter((k) => k !== ledger).map((k) => SPL_LEDGER[k].name.toLowerCase()).join(', ')}, with ledger "${have.filter((k) => k !== ledger)[0]}"` : 'the only ledger he has'})`]
  for (const g of groups) {
    text.push('', g.group)
    for (const r of g.rows) {
      text.push(`- ${r.split}: ${r.columns.map((c) => `${c.label} ${c.display}${c.percentile != null ? ` (${ordinal(c.percentile)} pct of ${c.ranked_among} ranked)` : ''}`).join(', ')}${r.league ? `; league ${r.league.display}` : ''}${r.thin ? ' [too few to rank]' : ''}`)
    }
  }
  text.push('', note)
  return { view: 'splits', ledger, ledgers: have, groups, notes: [note], text }
}

// ---- maps --------------------------------------------------------------------------------
const CELLS = ['bl', 'bm', 'br', 'sl', 'sm', 'sr', 'ml', 'mm', 'mr', 'dl', 'dm', 'dr']
const BAND_LABEL = { b: 'Behind the line', s: '0-9 yards', m: '10-19 yards', d: '20+ yards' }
const DIR_LABEL = { l: 'Left', m: 'Middle', r: 'Right' }
const GAP_LABEL = ['Left end', 'Left tackle', 'Left guard', 'Middle', 'Right guard', 'Right tackle', 'Right end']
const mapKindFor = (pos) => (pos === 'QB' ? 'qb' : pos === 'RB' ? 'rush' : pos === 'WR' || pos === 'TE' ? 'rec' : null)

async function fieldMap(who, s, pos, career) {
  const kind = mapKindFor(pos)
  if (!kind) throw new SavantError(`Field maps are drawn for quarterbacks (throws), running backs (carries by gap) and receivers and tight ends (targets).`)
  const idx = await page.load('football-maps/index.json').catch(() => ({}))
  const years = (((idx || {})[who.id] || {})[kind] || []).slice().sort()
  const ys = career ? years : years.filter((y) => String(y) === s)
  if (!ys.length) throw new SavantError(`No ${kind === 'rush' ? 'rushing' : kind === 'qb' ? 'throw' : 'target'} map for ${who.name}${career ? '' : ` in ${s}`}.${years.length ? ` He has one for ${years.join(', ')}.` : ''}`)
  // a career map is the season maps added cell by cell (loadCareerMap())
  let rec = null
  for (const y of ys) {
    const pack = await page.load(`football-maps/${y}.json`).catch(() => null)
    const r = ((pack || {})[kind] || {})[who.id]
    if (!r) continue
    if (!rec) rec = { n: 0, z: null, g: null }
    rec.n += r.n || 0
    for (const f of ['z', 'g']) {
      if (!r[f]) continue
      if (!rec[f]) rec[f] = r[f].map((c) => c.map(() => 0))
      r[f].forEach((c, ci) => c.forEach((v, vi) => { rec[f][ci][vi] += v || 0 }))
    }
  }
  if (!rec) throw new SavantError(`No map for ${who.name}.`)
  const when = career ? `${ys.length} charted season${ys.length === 1 ? '' : 's'}, ${ys[0]}-${ys[ys.length - 1]}` : s
  if (kind === 'rush') {
    const gaps = rec.g.map((c, i) => ({ gap: GAP_LABEL[i], carries: c[0], share: rec.n ? Math.round(c[0] / rec.n * 100) : 0, yards_per_carry: c[0] ? +(c[1] / c[0]).toFixed(1) : null, thin: c[0] < 3 }))
    const side = (a, b) => { const att = rec.g.slice(a, b).reduce((x, c) => x + c[0], 0); const y = rec.g.slice(a, b).reduce((x, c) => x + c[1], 0); return { share: rec.n ? Math.round(att / rec.n * 100) : 0, yards_per_carry: att ? +(y / att).toFixed(1) : null } }
    let best = null
    rec.g.forEach((c, i) => { if (c[0] >= 8 && (best == null || c[1] / c[0] > rec.g[best][1] / rec.g[best][0])) best = i })
    const out = { view: 'rush_map', when, carries: rec.n, gaps, sides: { left: side(0, 3), middle: side(3, 4), right: side(4, 7) }, best_gap: best == null ? null : { gap: GAP_LABEL[best], yards_per_carry: +(rec.g[best][1] / rec.g[best][0]).toFixed(1) } }
    const note = 'Where his carries went, by gap. Read it within this player: the page shades each gap against his own busiest one.'
    out.notes = [note]
    out.text = [`${who.name}, rushing map, ${when}: ${thousands(rec.n)} carries`, ...gaps.map((g) => `- ${g.gap}: ${g.share}% of carries (${g.carries})${g.yards_per_carry != null && !g.thin ? `, ${g.yards_per_carry.toFixed(1)} yards per carry` : ''}${g.thin ? ' [under 3 carries]' : ''}`),
      `Left side ${out.sides.left.share}%${out.sides.left.yards_per_carry != null ? `, ${out.sides.left.yards_per_carry.toFixed(1)} ypc` : ''}; middle ${out.sides.middle.share}%${out.sides.middle.yards_per_carry != null ? `, ${out.sides.middle.yards_per_carry.toFixed(1)} ypc` : ''}; right side ${out.sides.right.share}%${out.sides.right.yards_per_carry != null ? `, ${out.sides.right.yards_per_carry.toFixed(1)} ypc` : ''}.`,
      out.best_gap ? `Best gap (8+ carries): ${out.best_gap.gap}, ${out.best_gap.yards_per_carry.toFixed(1)} yards per carry.` : '', '', note]
    return out
  }
  const what = kind === 'qb' ? 'attempts' : 'targets'
  const cells = CELLS.map((c, i) => {
    const [a, comp, yds] = rec.z[i]
    return { depth: BAND_LABEL[c[0]], direction: DIR_LABEL[c[1]], [what]: a, share: rec.n ? Math.round(a / rec.n * 100) : 0, completions: comp, yards: Math.round(yds), yards_per_attempt: a ? +(yds / a).toFixed(1) : null, catch_rate: a ? Math.round(comp / a * 100) : null, thin: a < 3 }
  })
  const bands = ['d', 'm', 's', 'b'].map((k) => {
    const sum = [0, 0, 0]
    CELLS.forEach((c, i) => { if (c[0] === k) { sum[0] += rec.z[i][0]; sum[1] += rec.z[i][1]; sum[2] += rec.z[i][2] } })
    return { depth: BAND_LABEL[k], share: rec.n ? Math.round(sum[0] / rec.n * 100) : 0, yards_per_attempt: sum[0] ? +(sum[2] / sum[0]).toFixed(1) : null }
  })
  const dirs = { l: 0, m: 0, r: 0 }
  CELLS.forEach((c, i) => { dirs[c[1]] += rec.z[i][0] })
  const out = { view: kind === 'qb' ? 'throw_map' : 'target_map', when, [what]: rec.n, cells, bands, directions: { left: Math.round(dirs.l / rec.n * 100), middle: Math.round(dirs.m / rec.n * 100), right: Math.round(dirs.r / rec.n * 100) } }
  const note = `Where the ball was ${kind === 'qb' ? 'thrown' : 'aimed'}, by depth past the line and direction. Air yards are charted from 2006 on. Read it within this player.`
  out.notes = [note]
  out.text = [`${who.name}, ${kind === 'qb' ? 'throw' : 'target'} map, ${when}: ${thousands(rec.n)} ${what}`,
    ...cells.filter((c) => c[what]).map((c) => `- ${c.depth}, ${c.direction.toLowerCase()}: ${c.share}% (${c[what]})${c.thin ? ' [under 3]' : `, ${c.yards_per_attempt.toFixed(1)} yards per ${kind === 'qb' ? 'attempt' : 'target'}, ${c.catch_rate}% caught`}`),
    `By depth: ${bands.map((b) => `${b.depth} ${b.share}%${b.yards_per_attempt != null ? ` (${b.yards_per_attempt.toFixed(1)} y)` : ''}`).join('; ')}. Left / middle / right: ${out.directions.left} / ${out.directions.middle} / ${out.directions.right}%.`, '', note]
  return out
}

// ---- route tree --------------------------------------------------------------------------
const RT_SLOTS = ['SCREEN', 'FLAT', 'SLANT', 'QOUT', 'DOUT', 'OUT', 'HITCH', 'CROSS', 'IN', 'CORNER', 'POST', 'GO', 'WHEEL', 'ANGLE']
const RT_LABEL = { SCREEN: 'Screen', FLAT: 'Flat / swing', SLANT: 'Slant', QOUT: 'Quick out', DOUT: 'Deep out', OUT: 'Out', HITCH: 'Hitch / curl', CROSS: 'Crosser / drag', IN: 'In / dig', CORNER: 'Corner', POST: 'Post', GO: 'Go', WHEEL: 'Wheel', ANGLE: 'Angle' }
export const RT_K = 8
const rtPos = (pos) => (pos === 'WR' || pos === 'TE' || pos === 'RB' ? pos : pos === 'FB' ? 'RB' : null)
export function rtSum(packs, ys, id, pos) {
  let me = null, lg = null
  for (const y of ys) {
    const p = packs[y]
    if (!p || !p.p) continue
    const r = p.p[id], l = p.lg && p.lg[pos]
    if (!r) continue
    if (!me) { me = r.r.map((c) => c.map(() => 0)); lg = me.map((c) => c.map(() => 0)) }
    r.r.forEach((c, i) => c.forEach((v, k) => { me[i][k] += v }))
    if (l) l.forEach((c, i) => c.forEach((v, k) => { lg[i][k] += v }))
  }
  if (!me) return null
  const early = ys.some((y) => +y < 2023), late = ys.some((y) => +y >= 2023)
  if (early && late) {
    const o = RT_SLOTS.indexOf('OUT'), q = RT_SLOTS.indexOf('QOUT'), d = RT_SLOTS.indexOf('DOUT')
    for (const t of [me, lg]) for (let k = 0; k < t[o].length; k++) { t[o][k] += t[q][k] + t[d][k]; t[q][k] = 0; t[d][k] = 0 }
  }
  return { me, lg, folded: early && late }
}
// rtLean(): how a route went against his position on the same route, pulled toward average
export function rtLean(me, lg, mode) {
  const s = { tg: me[0], rec: me[1], yds: me[2], epa: me[3] }, L = { tg: lg[0], rec: lg[1], yds: lg[2], epa: lg[3] }
  if (!s.tg || !L.tg) return null
  let lv
  if (mode === 'epa') { lv = L.epa / L.tg; return (s.epa + RT_K * lv) / (s.tg + RT_K) - lv }
  if (mode === 'catch') { lv = L.rec / L.tg; return (s.rec + RT_K * lv) / (s.tg + RT_K) - lv }
  lv = L.yds / L.tg
  return (s.yds + RT_K * lv) / (s.tg + RT_K) - lv
}
async function routeTree(who, s, pos, career, meta) {
  const p = rtPos(pos)
  if (!p) throw new SavantError('Route trees are drawn for receivers, tight ends and backs.')
  const idx = await page.load('football-routes/index.json').catch(() => ({}))
  const all = ((idx || {})[who.id] || []).slice().sort()
  if (!all.length) throw new SavantError(`No route tree for ${who.name}: public charting has no targeted routes for him.`)
  let ys, note = ''
  if (career) ys = all
  else if (all.includes(+s)) ys = [+s]
  else {
    const prior = all.filter((y) => y < +s)
    if (!prior.length || +s < 2016) throw new SavantError(`No route tree for ${who.name} in ${s}.`)
    ys = [prior[prior.length - 1]]
    note = `${s}'s routes arrive in February, when the NFL publishes the season's participation file; this is ${ys[0]}.`
  }
  const packs = {}
  for (const y of ys) packs[y] = await page.load(`football-routes/${y}.json`).catch(() => null)
  const sum = rtSum(packs, ys, who.id, p)
  if (!sum) throw new SavantError(`No route tree for ${who.name}.`)
  let n = 0, ln = 0
  sum.me.forEach((c) => { n += c[0] }); sum.lg.forEach((c) => { ln += c[0] })
  const routes = RT_SLOTS.map((slot, i) => [slot, i]).filter(([, i]) => sum.me[i][0] > 0).sort((a, b) => sum.me[b[1]][0] - sum.me[a[1]][0]).map(([slot, i]) => {
    const c = sum.me[i], l = sum.lg[i]
    return {
      route: RT_LABEL[slot], targets: c[0], share: Math.round(c[0] / n * 100), position_share: ln ? Math.round(l[0] / ln * 100) : 0,
      catches: c[1], yards: Math.round(c[2]), catch_rate: Math.round(c[1] / c[0] * 100), yards_per_target: +(c[2] / c[0]).toFixed(1), epa_per_target: +(c[3] / c[0]).toFixed(2),
      vs_position: { epa_per_target: rtLean(c, l, 'epa'), catch_rate: rtLean(c, l, 'catch'), yards_per_target: rtLean(c, l, 'ypt') }, thin: c[0] < 5,
    }
  })
  const when = career ? `${ys.length} charted season${ys.length === 1 ? '' : 's'}, ${ys[0]}-${ys[ys.length - 1]}` : String(ys[0])
  const notes = [`Public charting records the route of the targeted man only, so this is a tree of targets, not of every route run. "vs position" is how the route went against the average ${p} on the same route that year, with ${RT_K} average targets mixed in so a small sample is pulled toward average.`]
  if (sum.folded) notes.push('The charting source renamed routes in 2023, splitting "out" into quick and deep outs; across a career that spans the change they are counted as one Out.')
  if (note) notes.push(note)
  const sgn = (v, dp) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(dp)
  const text = [`${who.name}, route tree, ${when}: ${thousands(n)} targets`,
    ...routes.map((r) => `- ${r.route}: ${r.targets} targets, ${r.share}% of his (position ${r.position_share}%), ${r.catch_rate}% caught, ${r.yards_per_target.toFixed(1)} yards and ${sgn(r.epa_per_target, 2)} EPA per target${r.vs_position.epa_per_target != null ? `; vs position ${sgn(r.vs_position.epa_per_target, 2)} EPA per target` : ''}${r.thin ? ' [under 5 targets]' : ''}`), '', ...notes]
  return { view: 'route_tree', when, targets: n, routes, notes, text }
}

export async function playerSplits({ player, season, view = 'splits', ledger }) {
  const meta = await loadMeta()
  const career = /^career$/i.test(String(season || '').trim())
  const wanted = career ? null : parseSeason(season, meta)
  const who = await resolvePlayer(player, wanted, meta)
  const s = wanted || String(who.to)
  if (!career && !played(who, s)) throw new SavantError(`${who.name} has no stats in ${s}. Football Savant has him in ${seasonsOf(who)}.`)
  const file = career ? null : await loadSeason(s)
  const row = file ? rowsOf(file).get(who.id) : null
  const pos = (row && row.pos) || who.pos
  if (career && view === 'splits') throw new SavantError('Splits are by season. Give a season, or ask for a map or the route tree over his career.')
  const out = view === 'splits' ? await splits(who, s, pos, meta, ledger)
    : view === 'route_tree' ? await routeTree(who, s, pos, career, meta)
      : await fieldMap(who, s, pos, career)
  const text = out.text.filter((x) => x !== undefined)
  delete out.text
  const structured = { player: { id: who.id, name: who.name, position: (meta.positions[pos] || {}).label || pos }, season: career ? 'career' : s, ...out, url: cardUrl(who.id, career ? 'career' : s), source: SOURCE }
  text.push('', `Card: ${structured.url}`, `Source: ${SOURCE}.`)
  return { structured, text: text.join('\n') }
}

// ---- postseason game pages ---------------------------------------------------------------
const ROUND = { WC: 'Wild Card', DIV: 'Divisional', CON: 'Conference Championship', SB: 'Super Bowl' }
const quarter = (n) => (n <= 4 ? `Q${n}` : n === 5 ? 'OT' : `OT${n - 4}`)

export async function nflGame({ game, season, team, opponent }) {
  const idx = await page.load('football-games/index.json')
  const names = await page.load('football-games/teams.json').catch(() => ({}))
  const tname = (t) => ((names || {})[t] || [t])[0] || t
  const meta = await loadMeta()
  const codeOf = (x) => {
    if (!x) return null
    const q = norm(x)
    for (const [c, v] of Object.entries(names || {})) if (norm(c) === q || norm(v[0]) === q || norm(v[0]).endsWith(` ${q}`)) return c
    for (const [c, e] of Object.entries(meta.era || {})) if (norm(e[1]) === q || norm(e[2]) === q) return c
    throw new SavantError(`"${x}" is not an NFL team I know. Give a code (KC) or a name (Chiefs).`)
  }
  let id = game && idx[game] ? game : null
  if (!id) {
    const s = season ? +String(season).slice(0, 4) : null
    const a = codeOf(team), b = codeOf(opponent)
    const hits = Object.entries(idx).filter(([, g]) => (s == null || g.s === s) && (!a || g.a === a || g.h === a) && (!b || g.a === b || g.h === b))
      .sort((x, y) => (x[1].d < y[1].d ? 1 : -1))
    if (game && !hits.length) throw new SavantError(`No postseason game "${game}". Search by season and team instead.`)
    if (hits.length !== 1 || (!a && !b)) {
      const list = hits.slice(0, 25).map(([gid, g]) => ({ id: gid, season: g.s, round: g.n, date: g.d, away: g.a, away_score: g.as, home: g.h, home_score: g.hs, url: `${GAMES_URL}#${gid}` }))
      const structured = { games: list, total: hits.length, game: null, source: SOURCE }
      if (!list.length) return { structured, text: 'No postseason game in Football Savant matches that. It has every playoff game from the 1999 season on.' }
      return { structured, text: `${hits.length} postseason game${hits.length === 1 ? '' : 's'} match${hits.length > 25 ? ', newest 25' : ''}. Ask again with one id:\n${list.map((g) => `- ${g.id}: ${g.season} ${g.round}, ${g.away} ${g.away_score} at ${g.home} ${g.home_score} (${g.date})`).join('\n')}` }
    }
    id = hits[0][0]
  }
  const g = await page.load(`football-games/${id}.json`)
  const away = g.away, home = g.home
  const winner = away.score > home.score ? away : home
  // win probability: the page's chart, as its biggest swings and where it ended up
  const wp = g.wp || []
  let swings = []
  for (let i = 1; i < wp.length; i++) swings.push({ at: wp[i][0], change: wp[i][1] - wp[i - 1][1] })
  swings = swings.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5)
  const keyPlays = (g.key || []).slice(0, 10).map((k) => ({ quarter: quarter(k.q), clock: k.c, team: k.t, play: k.d, win_probability_added: k.wpa, epa: k.epa }))
  const structured = {
    games: null, total: 1,
    game: {
      id: g.id, season: g.season, round: g.name || ROUND[g.type] || g.type, date: g.date, stadium: g.stadium, roof: g.roof, surface: g.surface, temp: g.temp ?? null, wind: g.wind ?? null,
      overtime: !!g.ot, spread: g.spread ?? null, referee: g.ref || null,
      away: { team: away.t, name: tname(away.t), score: away.score, by_quarter: away.line, coach: away.coach, qb: away.qb },
      home: { team: home.t, name: tname(home.t), score: home.score, by_quarter: home.line, coach: home.coach, qb: home.qb },
      scoring: (g.scoring || []).map((x) => ({ quarter: quarter(x.q), clock: x.c, team: x.t, play: x.d, away: x.a, home: x.h })),
      drives: (g.drives || []).map((d) => ({ team: d.t, quarter: quarter(d.q), clock: d.c, start: d.start, result: d.r, plays: d.p, yards: d.y })),
      key_plays: keyPlays,
      team_stats: g.team || null,
      box: g.box || null,
      biggest_win_probability_swings: swings,
    },
    url: `${GAMES_URL}#${g.id}`, source: SOURCE,
  }
  const ts = g.team || {}
  const tline = (t) => { const x = ts[t] || {}; return `${tname(t)}: ${x.yds ?? '?'} yards (${x.passYds ?? '?'} passing, ${x.rushYds ?? '?'} rushing) on ${x.plays ?? '?'} plays, ${x.fd ?? '?'} first downs, ${x.thirdC ?? '?'}/${x.thirdA ?? '?'} on third down, ${x.to ?? 0} giveaway${x.to === 1 ? '' : 's'}, ${x.sacksTaken ?? 0} sack${x.sacksTaken === 1 ? '' : 's'} taken${x.epaPlay != null ? `, ${x.epaPlay >= 0 ? '+' : '−'}${Math.abs(x.epaPlay).toFixed(2)} EPA/play` : ''}` }
  const box = g.box || {}
  const L = [`${g.name || ROUND[g.type]} (${g.season} season), ${g.date}: ${tname(away.t)} ${away.score}, ${tname(home.t)} ${home.score}${g.ot ? ' (OT)' : ''}. ${tname(winner.t)} won.`,
    `${g.stadium || ''}${g.roof ? `, ${g.roof}` : ''}${g.temp != null ? `, ${g.temp}°F` : ''}${g.spread != null ? `. Spread: ${home.t} ${g.spread > 0 ? '+' : ''}${g.spread}` : ''}. Coaches ${away.coach} and ${home.coach}; quarterbacks ${away.qb} and ${home.qb}.`,
    `By quarter: ${away.t} ${away.line.join('-')}; ${home.t} ${home.line.join('-')}.`,
    '', 'Team stats:', `- ${tline(away.t)}`, `- ${tline(home.t)}`]
  for (const [k, title, f] of [['pass', 'Passing', (p) => `${p.cmp}/${p.att}, ${p.yds} yards, ${p.td} TD, ${p.int} INT${p.sk ? `, ${p.sk} sacked` : ''}`], ['rush', 'Rushing', (p) => `${p.att} carries, ${p.yds} yards, ${p.td} TD`], ['rec', 'Receiving', (p) => `${p.rec}/${p.tgt ?? '?'} for ${p.yds} yards, ${p.td} TD`]]) {
    if (!box[k] || !box[k].length) continue
    L.push('', `${title}:`, ...box[k].slice(0, 8).map((p) => `- ${p.n} (${p.t}): ${f(p)}${p.epa != null ? `, ${p.epa >= 0 ? '+' : '−'}${Math.abs(p.epa).toFixed(1)} EPA` : ''}`))
  }
  if (structured.game.scoring.length) L.push('', 'Scoring:', ...structured.game.scoring.map((x) => `- ${x.quarter} ${x.clock} ${x.team}: ${x.play} (${away.t} ${x.away}, ${home.t} ${x.home})`))
  if (keyPlays.length) L.push('', 'Biggest plays by win probability added:', ...keyPlays.slice(0, 6).map((k) => `- ${k.quarter} ${k.clock} ${k.team}: ${k.play} (${k.win_probability_added >= 0 ? '+' : '−'}${Math.abs(k.win_probability_added * 100).toFixed(1)} pts of win probability)`))
  L.push('', `Drives and the win-probability chart are in the structured result and on the page: ${structured.url}`, `Source: ${SOURCE}.`)
  return { structured, text: L.join('\n') }
}

// ---- the tools -------------------------------------------------------------------------------

const row = z.record(z.string(), z.any())
export const tools = [
  {
    name: 'nfl_player_games',
    config: {
      title: 'NFL player game log',
      description:
        'An NFL player\'s season game by game on Football Savant (wcehoops.com), 1999 on: each week\'s opponent and his number in each stat, with where that one game would rank among the season\'s full-season lines at his position; byes and missed games; his season line, best game, last game and the position median; and, for the season being played, his last 4, 8 and 17 games ranked against everyone\'s same stretch. Defaults to his position\'s headline stats.',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id from nfl_search_players or a full name.'),
        season: z.string().trim().max(12).optional().describe('Year the season began. Omit for his latest.'),
        stats: z.array(z.string().max(80)).max(8).optional().describe('Stat keys or labels, e.g. ["epadb", "cpoe"]. Omit for his headline stats.'),
      },
      outputSchema: {
        player: row, season: z.string(), in_progress: row.nullable(), stats: z.array(row), games: z.array(row), lines: z.array(row), form: z.array(row),
        notes: z.array(z.string()), url: z.string(), data_as_of: z.string(), source: z.string(),
      },
      annotations: { title: 'NFL player game log', ...READ_ONLY },
    },
    run: (args) => playerGames(args),
  },
  {
    name: 'nfl_player_splits',
    config: {
      title: 'NFL player splits, maps and route tree',
      description:
        'Below an NFL player\'s season line on Football Savant (wcehoops.com). view "splits" (QB, RB, WR, TE): his plays by down, distance, field position, quarter, score, home/away, roof, and from 2022 play-action, blitz, motion and formation, each headline rate ranked against everyone with a real sample in that split. "throw_map" / "target_map" / "rush_map": where his throws, targets or carries went. "route_tree": his targets by route against his position. Maps and route trees also take season "career".',
      inputSchema: {
        player: z.string().trim().min(1).max(80).describe('Player id from nfl_search_players or a full name.'),
        view: z.enum(['splits', 'throw_map', 'target_map', 'rush_map', 'route_tree']).default('splits').describe('Which view.'),
        season: z.string().trim().max(12).optional().describe('Year the season began, or "career" for a map or route tree. Omit for his latest.'),
        ledger: z.enum(['q', 'r', 't']).optional().describe('Splits only: passing (q), rushing (r) or receiving (t). Omit for his main one.'),
      },
      outputSchema: { player: row, season: z.string(), view: z.string(), url: z.string(), source: z.string() },
      annotations: { title: 'NFL player splits, maps and route tree', ...READ_ONLY },
    },
    run: (args) => playerSplits(args),
  },
  {
    name: 'nfl_game',
    config: {
      title: 'NFL postseason game',
      description:
        'Football Savant\'s postseason game pages (wcehoops.com): every NFL playoff game from the 1999 season on. Find games by season and team(s), or open one by id: score by quarter, conditions and spread, team stats, passing, rushing and receiving box score, every scoring play, the plays that moved win probability most, every drive, and the biggest win-probability swings.',
      inputSchema: {
        game: z.string().trim().max(40).optional().describe('A game id from a previous answer, e.g. "2025_22_SEA_NE".'),
        season: z.string().trim().max(12).optional().describe('Year the season began, e.g. "2024" (its playoffs are in early 2025).'),
        team: z.string().trim().max(40).optional().describe('A team in the game: code or name.'),
        opponent: z.string().trim().max(40).optional().describe('The other team.'),
      },
      outputSchema: { games: z.array(row).nullable(), total: z.number(), game: row.nullable(), url: z.string().optional(), source: z.string() },
      annotations: { title: 'NFL postseason game', ...READ_ONLY },
    },
    run: (args) => nflGame(args),
  },
]
