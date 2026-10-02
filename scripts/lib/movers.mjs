// Weekly percentile snapshots, and the "biggest movers" newsletter draft built from two of them.
//
// Basketball Savant's data file only ever holds the season to date, so "who moved this week"
// can't be read from it: last week's numbers are gone the moment the nightly refresh lands.
// scripts/savant-snapshot.mjs therefore saves a small copy of where every player stands once a
// week (data/savant-snapshots/<season>/<date>.json, in git, not deployed), and
// scripts/movers-draft.mjs compares the two newest.
//
// What counts as a move:
//   - the player qualified in BOTH snapshots (the same pool the site ranks against)
//   - an outcome stat (shooting, playmaking, rebounding, defense, overall value; not height,
//     minutes or style stats like 3PA rate), past its stabilization sample in both snapshots
//   - percentile vs the league, exactly as the player pages show it
// Each player appears once, under his single biggest change, so one hot shooting week doesn't
// fill the whole list with the same name.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ordinal } from './savant-core.mjs'
import { MIN_POOL } from './player-pages.mjs'

export const SNAP_DIR = path.join('data', 'savant-snapshots')
const UTM = 'utm_source=newsletter&utm_medium=email&utm_campaign=weekly-board'

const isOutcome = (r) => r.layer === 'output' && ['off', 'def', 'val'].includes(r.group)
const NOT_A_PERCENT = new Set(['bpm', 'obpm', 'dbpm']) // see player-pages.mjs
const shown = (r) => (NOT_A_PERCENT.has(r.key) && r.unit === 'sgn' ? r.text.replace(/%$/, '') : r.text)

/** Where every player in the current season stands right now. */
export function takeSnapshot(eng, slugs) {
  const season = eng.seasons[0]
  const dataDay = eng.generated && !isNaN(Date.parse(eng.generated)) ? new Date(eng.generated).toISOString().slice(0, 10) : null
  // Qualified players only: a move needs him qualified in both snapshots, and it keeps each
  // file small enough to live in git all season. Per stat: [value as shown, league percentile,
  // 1 if past its stabilization sample].
  const players = {}
  for (const p of eng.playersOf(season)) {
    if (!p.qualified) continue
    const m = {}
    for (const r of eng.profile(p, season)) if (isOutcome(r) && r.league != null) m[r.key] = [shown(r), r.league, r.stable ? 1 : 0]
    players[String(p.id)] = { n: p.name, t: p.team, s: slugs.get(p.id), m }
  }
  return {
    season,
    dataDay, // the day the data was generated: this is the snapshot's date
    generated: eng.generated || null,
    pool: eng.qualifiedCount(season),
    labels: Object.fromEntries(eng.metrics.filter(isOutcome).map((m) => [m.key, m.label])),
    players,
  }
}

/** Seasons that have at least one snapshot, newest first. */
export function listSeasons(root) {
  const dir = path.join(root, SNAP_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((d) => /^\d{4}-\d{2}$/.test(d) && listSnapshots(root, d).length).sort().reverse()
}

export function listSnapshots(root, season) {
  const dir = path.join(root, SNAP_DIR, season)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map((f) => ({ day: f.slice(0, 10), file: path.join(dir, f) }))
}
export const readSnapshot = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** Save a snapshot unless there is nothing new to save. Returns { written, reason, file }. */
export function saveSnapshot(root, snap, { force = false } = {}) {
  if (!snap.dataDay) return { written: false, reason: 'savant-data.json has no "generated" date, so the snapshot cannot be dated' }
  if (snap.pool < MIN_POOL) return { written: false, reason: `${snap.season} has ${snap.pool} qualified players so far; percentiles start once there are ${MIN_POOL}` }
  const dir = path.join(root, SNAP_DIR, snap.season)
  const file = path.join(dir, `${snap.dataDay}.json`)
  if (existsSync(file) && !force) return { written: false, reason: `already have the snapshot for ${snap.dataDay} (the data has not been refreshed since)`, file }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(snap) + '\n')
  return { written: true, file }
}

/**
 * Compare two snapshots of the same season.
 * @returns {{ ok: boolean, reason?: string, season, from, to, days, risers: Move[], fallers: Move[] }}
 */
export function computeMovers(prev, cur, { top = 5, minDelta = 5 } = {}) {
  const base = { season: cur.season, from: prev.dataDay, to: cur.dataDay, days: Math.round((Date.parse(cur.dataDay) - Date.parse(prev.dataDay)) / 86400000), risers: [], fallers: [] }
  if (prev.season !== cur.season) return { ...base, ok: false, reason: `the snapshots are from different seasons (${prev.season} and ${cur.season})` }
  if (prev.pool < MIN_POOL || cur.pool < MIN_POOL) return { ...base, ok: false, reason: 'not enough qualified players yet for percentiles to mean anything' }

  const best = []
  for (const [id, now] of Object.entries(cur.players)) {
    const was = prev.players[id] // only qualified players are in a snapshot
    if (!was) continue
    let top1 = null
    for (const [key, [text, league, stable]] of Object.entries(now.m)) {
      const before = was.m[key]
      if (!before || !stable || !before[2]) continue
      const delta = league - before[1]
      if (!top1 || Math.abs(delta) > Math.abs(top1.delta)) top1 = { id, key, label: cur.labels[key] || key, name: now.n, team: now.t, slug: now.s, from: before[1], to: league, delta, valueFrom: before[0], valueTo: text }
    }
    if (top1 && Math.abs(top1.delta) >= minDelta) best.push(top1)
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'en')
  base.risers = best.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta || byName(a, b)).slice(0, top)
  base.fallers = best.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta || byName(a, b)).slice(0, top)
  if (!base.risers.length && !base.fallers.length) return { ...base, ok: false, reason: `nobody moved ${minDelta} or more percentile points between ${base.from} and ${base.to}` }
  return { ...base, ok: true }
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const day = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The email, as a Buttondown draft: { subject, description, body }. A person edits and sends it. */
export function moversDraft(r, { site }) {
  const item = (m) =>
    `<li><strong><a href="${site}/player/${m.slug}?${UTM}">${esc(m.name)}</a></strong> (${esc(m.team)}) · ${esc(m.label)}: ` +
    `${ordinal(m.from)} → <strong>${ordinal(m.to)} percentile</strong> (${esc(m.valueFrom)} → ${esc(m.valueTo)})</li>`
  const section = (title, list) => (list.length ? `<h2>${title}</h2>\n<ul>\n${list.map(item).join('\n')}\n</ul>` : '')
  const lead = r.risers[0] || r.fallers[0]
  return {
    subject: `The Weekly Board: ${lead.name} ${lead.delta > 0 ? 'climbs' : 'drops'} ${Math.abs(lead.delta)} percentile points in ${lead.label}`,
    description: `The biggest percentile movers on Basketball Savant, ${day(r.from)} to ${day(r.to)}.`,
    body: [
      '<p>[Your intro. A sentence or two on the week, and which of these moves you believe.]</p>',
      `<p><em>Biggest percentile moves on Basketball Savant between ${day(r.from)} and ${day(r.to)} (${r.season}). Each percentile ranks the player against every qualified player this season; each player is listed once, under his largest change.</em></p>`,
      section('Risers', r.risers),
      section('Fallers', r.fallers),
      `<hr />\n<p>Every player’s full profile is at <a href="${site}/player?${UTM}">wcehoops.com/player</a>. Forwarded this? <a href="${site}/newsletter?${UTM}">Subscribe here</a>.</p>`,
    ].filter(Boolean).join('\n\n'),
  }
}
