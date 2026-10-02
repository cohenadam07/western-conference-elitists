// A real page for every player on Basketball Savant: /player/<slug>.
//
// Basketball Savant is one HTML file that builds every profile in the reader's browser, so to a
// search engine it is a single URL with no players on it, and every shared link previews as the
// same generic card. This writes plain HTML for each player at build time:
//
//   dist/player/<slug>/index.html   his latest season: percentile bars (vs the league, and vs his
//                                   position), stat line, honours, comps, a season-by-season table,
//                                   and a button into the full interactive tool
//   dist/player/index.html          the directory: this season by team, then everyone A–Z
//   dist/player/p.css, p.js         shared by every page
//
// It also returns the small script seo-build adds to the tool itself, which keeps the address
// bar on the player you're looking at and gives Share a real link (player-links.client.js).
//
// The numbers come from savant-core.mjs, which mirrors the tool's own maths and is checked
// against it by `npm run check:players`. Called from seo-build.mjs, which adds the URLs to the
// sitemap. If anything here throws, seo-build logs it and ships the site without player pages
// rather than failing the deploy (the data bots push to main all day).
//
// ON SIZE: there are ~3,800 of these and Vercel keeps dozens of old deployments, so every byte
// here is multiplied by about 150,000. That is why the markup leans on things HTML allows but
// people rarely write by hand: unquoted attributes, no closing </tr> </td> </li> </p>, tables
// for the stat rows, and the newsletter form and season links added by p.js instead of repeated
// in every file. Keep it that way; `npm run check:players` fails if the average page grows
// past its budget.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assignSlugs, createEngine, inFt, loadPageConfig, miss, ordinal, slugify, smpl, val } from './savant-core.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOL = '/basketball-savant.html'
const SITE_NAME = 'Western Conference Elitists'

/** A season needs this many qualified players before its percentiles mean anything (early in a
 *  new season nobody has reached the games floor yet, so the page stays on last season). */
export const MIN_POOL = 30

/** The six bars on the link-preview image (api/og.js): scoring, efficiency, playmaking,
 *  rebounding, defensive activity, overall impact. All tracked since 1979-80. */
export const CARD_STATS = ['pts', 'ts', 'ast', 'reb75', 'stk75', 'bpm']

// Bump when the preview image's design changes, so link previews refetch it.
const CARD_VERSION = 1

const NAV = [
  [TOOL, 'Basketball Savant'],
  ['/player', 'Players'],
  ['/draft-savant.html', 'Draft Savant'],
  ['/football-savant.html', 'Football Savant'],
  ['/articles', 'Analysis'],
  ['/news', 'News'],
]

// Box Plus/Minus is points per 100 possessions, not a percentage. The tool's config gives the
// three BPM stats the signed-percent unit, so it prints "+14.2%"; here they read "+14.2".
const NOT_A_PERCENT = new Set(['bpm', 'obpm', 'dbpm'])
const shownText = (r) => (NOT_A_PERCENT.has(r.key) && r.unit === 'sgn' ? r.text.replace(/%$/, '') : r.text)

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f1 = (v) => (miss(v) ? '—' : (+v).toFixed(1))
const peers = (pos) => (pos === 'Big' ? 'bigs' : pos === 'Wing' ? 'wings' : 'guards')
const initials = (nm) => (nm || '').split(' ').map((s) => s[0] || '').slice(0, 2).join('').toUpperCase()
const years = (e) => `${String(e.oldest).slice(0, 4)}–${+String(e.newest).slice(0, 4) + 1}`
const isNbaId = (id) => /^\d+$/.test(String(id))
const toolLink = (id, season) => `${TOOL}?p=${encodeURIComponent(id)}${season ? `&s=${encodeURIComponent(season)}` : ''}`
const list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1])

function fmtBirth(b) {
  if (!b) return null
  const d = String(b).split('T')[0].split('-')
  if (d.length < 3) return null
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d[1] - 1]
  return mo ? `${mo} ${+d[2]}, ${d[0]}` : null
}

const HEAD_LINKS =
  '<link rel=icon type=image/svg+xml href=/favicon.svg><link rel=apple-touch-icon href=/apple-touch-icon.png>' +
  '<link rel=preconnect href=https://fonts.gstatic.com crossorigin><link rel=stylesheet href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">' +
  '<link rel=stylesheet href=/player/p.css>' +
  '<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)}</script><script defer src=/_vercel/insights/script.js></script>'

// These tags are read by other people's scrapers, some of them crude, so unlike the rest of the
// page they keep their quotes and sit inside a real <head>. To keep ~3,800 heads small:
//   - one <meta> carries both name="description" and property="og:description" (every major
//     scraper looks the tag up by whichever attribute it wants)
//   - no og:url (scrapers use the canonical link) and no twitter:title/description/image (X,
//     iMessage, Slack and Discord all fall back to the og: tags)
function head({ title, ogTitle, description, url, image, imageAlt, type }) {
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${esc(title)}</title><meta name="description" property="og:description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}">` +
    `<meta property="og:type" content="${type}"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:title" content="${esc(ogTitle || title)}">` +
    `<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(imageAlt)}"><meta name="twitter:card" content="summary_large_image">` +
    HEAD_LINKS +
    '</head><body>'
  )
}

const TOP =
  `<div class=top><a class=br href=${TOOL}><i>WCE</i><b>Basketball <span>Savant</span></b></a><nav class=nav aria-label="WCE Hoops">` +
  NAV.map(([h, t]) => `<a href=${h}>${t}</a>`).join('') +
  '<a class=sub href=/newsletter>Subscribe</a></nav></div>'

// ---------------------------------------------------------------- one player

function statRow(r) {
  const attr = (r.stable ? '' : ' class=u') + (r.league == null ? '' : ` style=--v:${r.league}`) // .u = small sample, drawn hatched
  const bar = r.league == null ? '<td class=e>' : `<td>${r.league}`
  return `<tr${attr}><th>${esc(r.label)}${bar}<td>${r.position == null ? '·' : r.position}<td>${esc(shownText(r))}`
}

function statCard(title, rows, pos) {
  if (!rows.length) return ''
  let html = `<section class=c><h2>${title}</h2><table class=s><tr class=h><th>Stat<th>Percentile vs league<th>vs ${peers(pos)}<th>Value`
  let sub = null
  for (const r of rows) {
    if (r.sub !== sub) { sub = r.sub; if (sub) html += `<tr class=g><th>${esc(sub)}` }
    html += statRow(r)
  }
  return html + '</table></section>'
}

const isMark = (r) => r.layer === 'output' && ['off', 'def', 'val'].includes(r.group) && r.stable && r.league != null

/** The paragraph under the name. Tenseless on purpose: the season may still be in progress. */
function lede(e, row, season, prof, eng) {
  const out = []
  const L = row.line
  if (L && !miss(L.ppg)) out.push(`${e.name}, ${season} with ${row.team}: ${f1(L.ppg)} points, ${f1(L.rpg)} rebounds and ${f1(L.apg)} assists in ${f1(L.mpg)} minutes a game.`)
  const pool = eng.qualifiedCount(season)
  const q = eng.CFG.qualify || {}
  if (pool < MIN_POOL) return out.join(' ')
  if (!row.qualified) {
    out.push(`He fell short of the qualifying floor (${q.min_gp} games at ${q.min_mpg} minutes a game), so the percentiles below set a small sample against the ${pool} players who cleared it.`)
    return out.join(' ')
  }
  const marks = prof.filter(isMark)
  if (marks.length >= 6) {
    const hi = [...marks].sort((a, b) => b.league - a.league).slice(0, 3)
    const lo = [...marks].sort((a, b) => a.league - b.league).filter((r) => !hi.includes(r)).slice(0, 2)
    const say = (rs) => list(rs.map((r, i) => `${r.label} (${ordinal(r.league)}${i === 0 ? ' percentile' : ''})`))
    out.push(`Against the ${pool} players who qualified that season, his highest marks are ${say(hi)}; his lowest are ${say(lo)}.`)
  }
  return out.join(' ')
}

function describe(e, row, season, prof, usable) {
  const L = row.line
  const line = L && !miss(L.ppg) ? `${f1(L.ppg)} PPG, ${f1(L.rpg)} RPG, ${f1(L.apg)} APG` : ''
  const best = usable && row.qualified ? prof.filter(isMark).sort((a, b) => b.league - a.league).slice(0, 2) : []
  let d = `${e.name}’s ${season} percentile profile` + (line ? `: ${line}.` : '.')
  if (best.length === 2) d += ` ${ordinal(best[0].league)} percentile in ${best[0].label}, ${ordinal(best[1].league)} in ${best[1].label}.`
  d += e.seasons.length > 1 ? ` All ${e.seasons.length} seasons on Basketball Savant.` : ' On Basketball Savant.'
  return d
}

function renderPlayer(ctx, e) {
  const { eng, slugs, site, stamp, split } = ctx
  const slug = slugs.get(e.id)
  const url = `${site}/player/${slug}`
  // Which season the page leads with:
  //   still playing (appeared in either of the two newest seasons) -> his latest season that has
  //     a real comparison pool, so a brand-new season falls back to the one before it
  //   retired -> his career-best season, so Michael Jordan's page opens on 1987-88 rather than
  //     on his last year in Washington. Every season is in the table either way.
  const peak = eng.peakSeason(e.id)
  const latest = e.seasons.find((s) => ctx.usable.has(s)) || e.newest
  const active = ctx.recent.has(e.newest)
  const season = !active && peak && ctx.usable.has(peak) ? peak : latest
  const usable = ctx.usable.has(season)
  const row = e.rows[season]
  const prof = eng.profile(row, season)
  const by = (k) => prof.find((r) => r.key === k)
  const acc = eng.accolades(e.id, season)
  const pos = row.pos
  const q = eng.CFG.qualify || {}

  const title = `${e.name} — NBA Percentile Profile | Basketball Savant`
  const description = describe(e, row, season, prof, usable)
  const image = `${site}/api/og?p=${slug}&v=${stamp}`

  // What the link-preview image needs; api/og.js reads it straight out of this page.
  const card = {
    n: e.name, t: row.team, p: pos, s: season,
    l: row.line && !miss(row.line.ppg) ? [f1(row.line.ppg), f1(row.line.rpg), f1(row.line.apg)] : null,
    b: CARD_STATS.map((k) => by(k)).filter(Boolean).map((r) => [r.label, usable ? r.league : null, shownText(r)]),
    a: acc.slice(0, 3).map((a) => a.short),
    k: peak === season,
  }

  const meta = [`<b>${esc(row.team)}</b>`, pos, season]
  if (row.college) meta.push(esc(row.college))
  if (row.exp != null) meta.push('Year ' + row.exp)
  if (row.age != null) meta.push('age ' + Math.floor(row.age))
  const born = fmtBirth(row.birthdate)
  if (born) meta.push('born ' + born)
  if (!row.qualified) meta.push('unqualified')

  const L = row.line
  const statline = L ? '<p class=sl>' + [['PPG', L.ppg], ['RPG', L.rpg], ['APG', L.apg], ['TPG', L.tpg], ['MPG', L.mpg]].map(([l, v]) => `<span><b>${f1(v)}</b> ${l}</span>`).join('') : ''
  const accos = acc.length ? '<p class=ac>' + acc.map((a) => `<span${a.major ? ' class=mj' : ''}>${esc(a.short)}</span>`).join('') : ''

  const wt = val(row, 'strength'), vt = val(row, 'vert'), la = val(row, 'lateral')
  const meas = [
    ['Height', miss(val(row, 'height')) ? null : inFt(val(row, 'height'))],
    ['Wingspan', miss(val(row, 'length')) ? null : inFt(val(row, 'length'))],
    ['Reach', miss(val(row, 'reach')) ? null : inFt(val(row, 'reach'))],
    ['Max vert', miss(vt) ? null : vt.toFixed(1) + '"'],
    ['Weight', miss(wt) ? null : String(Math.round(wt))],
    ['Lane agility', miss(la) ? null : la.toFixed(1) + 's'],
  ].filter(([, v]) => v != null)
  const measHtml = meas.length ? '<dl class=ms>' + meas.map(([l, v]) => `<div><dt>${l}<dd>${esc(v)}</div>`).join('') + '</dl>' : ''

  const more = e.seasons.length > 1
    ? `Compare players, chart any stat over time, and flip through all ${e.seasons.length} of his seasons.`
    : 'Compare players and chart any stat over time.'
  const headshot = isNbaId(e.id) ? `<img src=https://cdn.nba.com/headshots/nba/latest/260x190/${e.id}.png alt="" width=88 height=88 onerror=this.remove()>` : ''

  let body = `<div class=w>${TOP}<p class=bc><a href=${TOOL}>Basketball Savant</a> / <a href=/player>Players</a> / ${esc(e.name)}`
  body +=
    `<header class=id><div class=ih><div class=hw><span>${esc(initials(e.name))}</span>${headshot}</div><div class=it>` +
    `${peak === season ? '<div class=pk>CAREER BEST</div>' : ''}<h1>${esc(e.name)}</h1>` +
    `<p class=meta>${meta.join(' · ')}${statline}${accos}</div></div>` +
    `<div class=go><a class=btn href="${esc(toolLink(e.id, season))}">Open the interactive profile →</a>` +
    `<button class="btn alt" type=button data-share>Share</button><small>${more}</small></div>${measHtml}</header>`

  // A new season that hasn't built a comparison pool yet: say so, and show where he is so far.
  if (active && e.newest !== season) {
    const n = e.rows[e.newest], nl = n.line
    body += `<p class=note><b>${e.newest}</b>${nl && !miss(nl.ppg) ? ` so far: ${f1(nl.ppg)} PPG, ${f1(nl.rpg)} RPG, ${f1(nl.apg)} APG with ${esc(n.team)}.` : ' is under way.'} Percentiles for the new season appear once enough players reach the ${q.min_gp}-game qualifying mark; until then this page shows ${season}.`
  } else if (!usable) {
    body += `<p class=note>Percentiles for ${season} appear once enough players reach the ${q.min_gp}-game qualifying mark. The values below are his season so far.`
  }
  const other = split.get(e.id)
  if (other && slugs.has(other)) {
    const o = eng.index.get(other)
    body += `<p class=note>${isNbaId(other) ? `Seasons from ${o.oldest} on` : `Seasons before ${e.oldest}`} for ${esc(e.name)} are on a separate page: <a href=/player/${slugs.get(other)}>${esc(o.name)}, ${o.oldest} to ${o.newest}</a>.`
  }

  let text = lede(e, row, season, prof, eng)
  if (!active && season === peak && e.seasons.length > 1) text += ` This is his best season by Box Plus/Minus; all ${e.seasons.length} are in the table below.`
  if (text) body += `<p class=lede>${esc(text)}`

  if (usable) {
    body +=
      `<div class=key><p>Bars rank him against all ${eng.qualifiedCount(season)} qualified players in ${season}; the second number is his rank among the ${eng.qualifiedCount(season, pos)} qualified ${peers(pos)}. 50 is average, and a higher percentile is always the better mark.</p>` +
      '<div class=ramp aria-hidden=true><i></i><span><b>Poor</b><b>Elite</b></span></div><div class=hx><i></i>Small sample</div></div>'
  }
  const g = (k) => prof.filter((r) => r.group === k)
  body += statCard('Role', g('ctx'), pos)
  body += `<div class=cols>${statCard('Offense', g('off'), pos)}${statCard('Defense', g('def'), pos)}</div>`
  body += statCard('Value', g('val'), pos)

  // Comps and weak spots: only the current season's 500+ minute players carry them.
  const compCard = (c, word) => {
    const s = slugs.get(c.id)
    return `<li><a href="${s ? '/player/' + s : esc(toolLink(c.id))}" style=--v:${c.score}><b>${esc(c.name)}<span>${c.score}%</span></b><i></i><small>${esc(c.team)} · ${word}</small></a>`
  }
  if (row.comps && row.comps.length) {
    body += `<section class=c><h2>Statistical comps</h2><p class=cap>closest profiles by usage, shooting, playmaking, rebounding &amp; rim protection · ${season} · 500+ min<ul class=cg>${row.comps.map((c) => compCard(c, 'match')).join('')}</ul></section>`
  }
  const WK = eng.CFG.weakness || {}
  const flaws = row.wflaws && row.wflaws.length ? row.wflaws : null
  const wcomps = row.wcomps && row.wcomps.length ? row.wcomps : null
  if (flaws || wcomps) {
    body += `<section class=c><h2>Weakness comps</h2><p class=cap>who shares his flaws, ranked against other ${peers(pos)} · ${season} · ${WK.min_minutes || 500}+ min`
    if (flaws) {
      body += '<h3>Where he ranks worst</h3><ul class=wk>' + flaws.map((f) => `<li style=--v:${Math.max(f.pct, 2)}><b>${esc((WK.dims || {})[f.k] || f.k)}</b><i></i><span>${ordinal(f.pct)} percentile</span>`).join('') + '</ul>'
    }
    if (wcomps) {
      const best = Math.max(...wcomps.map((c) => c.score))
      const low = best <= (WK.low_match != null ? WK.low_match : 62)
      if (low) body += `<p class=note><b>Low match.</b> No one in ${season} really shares this weakness profile; his closest is only ${best}% comparable. Read these as loose, not as comps.`
      body += `<ul class=cg>${wcomps.map((c) => compCard(c, low ? 'comparable · low match' : 'comparable')).join('')}</ul>`
    }
    body += '</section>'
  }

  // Every season, oldest first. p.js turns each season into a link that opens it in the tool.
  const rows = [...e.seasons].reverse().map((s) => {
    const r = e.rows[s], l = r.line || {}
    const ts = val(r, 'ts'), bpm = val(r, 'bpm'), gp = smpl(r, 'avail')
    const bp = ctx.usable.has(s) ? eng.pct(r, s, 'bpm') : null
    const hon = eng.accolades(e.id, s).map((a) => a.short).join(' · ')
    return (
      `<tr${s === season ? ' class=on' : ''}><th>${s}${s === peak ? '<b>★</b>' : ''}<td>${esc(r.team)}<td>${r.age == null ? '—' : Math.floor(r.age)}<td>${miss(gp) ? '—' : gp}<td>${f1(l.mpg)}<td>${f1(l.ppg)}<td>${f1(l.rpg)}<td>${f1(l.apg)}` +
      `<td>${miss(ts) ? '—' : '.' + String(Math.round(ts * 1000)).padStart(3, '0')}<td>${miss(bpm) ? '—' : (bpm >= 0 ? '+' : '−') + Math.abs(bpm).toFixed(1)}<td>${bp == null ? '—' : bp}<td>${esc(hon)}`
    )
  })
  body +=
    `<section class=c><h2>Season by season</h2><div class=tw><table class=t data-p="${esc(e.id)}"><thead><tr><th>Season<th>Team<th>Age<th>GP<th>MPG<th>PPG<th>RPG<th>APG<th>TS%<th>BPM<th>BPM %ile<th>Honours<tbody>${rows.join('')}</table></div>` +
    `<p class=fn>BPM %ile ranks his Box Plus/Minus against that season’s qualified players.${peak ? ' ★ is his best season by Box Plus/Minus, among seasons that clear the games floor.' : ''}</section>`

  body +=
    '<div data-nl=player-page></div>' +
    `<footer class=ft><p>Every percentile compares him with players who qualified in the same season (${q.min_gp}+ games at ${q.min_mpg}+ minutes a game). Rates are per 75 possessions.${ctx.dataDate ? ` Data through ${ctx.dataDate}.` : ''}` +
    `<p><a href=${TOOL}>Basketball Savant</a> · <a href=/player>All players</a> · <a href="/">wcehoops.com</a> · <a href=/privacy>Privacy</a></footer>` +
    `</div><script type=application/json id=card>${JSON.stringify(card).replace(/</g, '\\u003c')}</script><script defer src=/player/p.js></script>`

  return head({ title, ogTitle: `${e.name} — NBA Percentile Profile`, description, url, image, imageAlt: `${e.name} percentile bars, ${season}`, type: 'profile' }) + body
}

// ---------------------------------------------------------------- the directory

function renderDirectory(ctx) {
  const { eng, slugs, site } = ctx
  const all = [...eng.index.values()].filter((e) => slugs.has(e.id))
  const cur = eng.seasons[0]
  const li = (e, extra) => `<li><a href=/player/${slugs.get(e.id)}>${esc(e.name)}</a> <small>${extra}</small>`
  const byName = (a, b) => a.name.localeCompare(b.name, 'en')

  const teams = new Map()
  for (const p of eng.playersOf(cur)) { if (!slugs.has(p.id)) continue; if (!teams.has(p.team)) teams.set(p.team, []); teams.get(p.team).push(eng.index.get(p.id)) }
  const teamHtml = [...teams.keys()].sort().map((t) => `<div data-sec><h3>${esc(t)}</h3><ul class=dl>${teams.get(t).sort(byName).map((e) => li(e, e.rows[cur].pos)).join('')}</ul></div>`).join('')

  const letters = new Map()
  for (const e of all) { const k = (slugify(e.name)[0] || '#').toUpperCase(); if (!letters.has(k)) letters.set(k, []); letters.get(k).push(e) }
  const keys = [...letters.keys()].sort()
  const azHtml = keys.map((k) => `<div data-sec id=az-${k}><h3>${k}</h3><ul class=dl>${letters.get(k).sort(byName).map((e) => li(e, years(e))).join('')}</ul></div>`).join('')

  const n = all.length.toLocaleString('en-US')
  const span = `${eng.seasons[eng.seasons.length - 1]} to ${cur}`
  const title = 'Every NBA Player on Basketball Savant | Western Conference Elitists'
  const description = `Percentile profiles for ${n} NBA players across ${eng.seasons.length} seasons, ${span}: every stat ranked against the league and against the player’s position.`
  return (
    head({ title, description, url: `${site}/player`, image: `${site}/og-card.png`, imageAlt: 'Basketball Savant by Western Conference Elitists', type: 'website' }) +
    `<div class=w>${TOP}<p class=bc><a href=${TOOL}>Basketball Savant</a> / Players` +
    `<header class=id><h1>Every player on Basketball Savant</h1><p class=meta>${n} players · ${eng.seasons.length} seasons · ${span}. Each page ranks a player’s season against the league and against his position.</header>` +
    '<input class=dq type=search data-filter placeholder="Filter by name…" aria-label="Filter players by name" autocomplete=off>' +
    `<section class=c><h2>${cur} by team</h2>${teamHtml}</section>` +
    `<section class=c><h2>All players, A–Z</h2><p class=az>${keys.map((k) => `<a href=#az-${k}>${k}</a>`).join('')}</p>${azHtml}</section>` +
    '<div data-nl=player-directory></div>' +
    `<footer class=ft><p><a href=${TOOL}>Basketball Savant</a> · <a href="/">wcehoops.com</a> · <a href=/privacy>Privacy</a></footer></div><script defer src=/player/p.js></script>`
  )
}

// ---------------------------------------------------------------- build

/**
 * Careers the data splits in two: pre-1996 seasons under a Basketball-Reference id, the rest
 * under an NBA id (it happens where the name alone couldn't be matched — Patrick Ewing, Glen
 * Rice, Larry Johnson). Each half links to the other. Only when the hand-off is unambiguous:
 * exactly one same-name profile ending 1995-96 and exactly one starting 1996-97.
 */
export function findSplits(eng) {
  const groups = new Map()
  for (const e of eng.index.values()) { if (!groups.has(e.name)) groups.set(e.name, []); groups.get(e.name).push(e) }
  const out = new Map()
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const before = list.filter((e) => !isNbaId(e.id) && e.newest === '1995-96')
    const after = list.filter((e) => isNbaId(e.id) && e.oldest === '1996-97')
    if (before.length === 1 && after.length === 1) { out.set(before[0].id, after[0].id); out.set(after[0].id, before[0].id) }
  }
  return out
}

/** Load the data and everything the pages share. Also used by the tests and the snapshot script. */
export function loadSavant(root) {
  const cfg = loadPageConfig(path.join(root, 'public', 'basketball-savant.html'))
  const DATA = JSON.parse(readFileSync(path.join(root, 'public', 'savant-data.json'), 'utf8'))
  const eng = createEngine(DATA, cfg)
  return { eng, slugs: assignSlugs(eng) }
}

export function makeContext({ eng, slugs, site }) {
  const iso = eng.generated && !isNaN(Date.parse(eng.generated)) ? new Date(eng.generated).toISOString().slice(0, 10) : null
  return {
    eng, slugs, site,
    usable: new Set(eng.seasons.filter((s) => eng.qualifiedCount(s) >= MIN_POOL)),
    recent: new Set(eng.seasons.slice(0, 2)), // played in either of these = still playing
    split: findSplits(eng),
    dataIso: iso,
    dataDate: iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null,
    stamp: `${(iso || '0').replace(/-/g, '')}${CARD_VERSION}`,
  }
}

/** The script seo-build adds to the tool: the slug rule plus the few ids whose slug isn't just their name. */
export function toolScript({ eng, slugs }) {
  const odd = {}
  for (const e of eng.index.values()) if (slugs.has(e.id) && slugs.get(e.id) !== slugify(e.name)) odd[String(e.id)] = slugs.get(e.id)
  const fold = { ð: 'd', đ: 'd', þ: 'th', ø: 'o', ł: 'l', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i' }
  const client = readFileSync(path.join(HERE, 'player-links.client.js'), 'utf8')
    .replace('/*__SLUGIFY__*/', `var FOLD=${JSON.stringify(fold)};\n  ${slugify.toString()}`)
    .replace('/*__ODD__*/{}', JSON.stringify(odd))
  if (client.includes('/*__')) throw new Error('player-pages: player-links.client.js placeholders were not filled')
  if (/<\/script/i.test(client)) throw new Error('player-pages: player-links.client.js must not contain a closing script tag')
  return client
}

const minCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/\s*([{};,])\s*/g, '$1').replace(/;}/g, '}').trim() + '\n'

export { renderPlayer, renderDirectory }

/**
 * Write every player page into dist/. Returns what the sitemap and the build log need.
 * Throws on a broken page shape; the caller decides whether that fails the build.
 */
export function buildPlayerPages({ root, dist, site }) {
  const ctx = makeContext({ ...loadSavant(root), site })
  const { eng, slugs } = ctx
  const cur = eng.seasons[0]

  // Render everything in memory first, so a failure can't leave a half-written folder behind.
  // One malformed row costs that player his page (and is named in the build log); more than a
  // handful means something is wrong with the data or the template, and that throws.
  const pages = []
  const skipped = []
  for (const e of eng.index.values()) {
    try {
      pages.push({ e, slug: slugs.get(e.id), html: renderPlayer(ctx, e) })
    } catch (err) {
      skipped.push(`${e.name} (${e.id}): ${err && err.message ? err.message : err}`)
    }
  }
  if (skipped.length > Math.max(5, eng.index.size * 0.01)) throw new Error(`player-pages: ${skipped.length} players failed to render, e.g. ${skipped.slice(0, 3).join('; ')}`)
  const built = new Set(pages.map((p) => p.e.id))
  for (const id of [...slugs.keys()]) if (!built.has(id)) slugs.delete(id) // nothing links to a page that wasn't written
  const directory = renderDirectory(ctx)
  const css = minCss(readFileSync(path.join(HERE, 'player-pages.css'), 'utf8'))
  const js = readFileSync(path.join(HERE, 'player-pages.client.js'), 'utf8')
  const script = toolScript(ctx)

  const dir = path.join(dist, 'player')
  mkdirSync(dir, { recursive: true })
  let bytes = 0
  const urls = [{ loc: `${site}/player`, priority: '0.7', lastmod: ctx.dataIso }]
  for (const { e, slug, html } of pages) {
    mkdirSync(path.join(dir, slug), { recursive: true })
    writeFileSync(path.join(dir, slug, 'index.html'), html)
    bytes += Buffer.byteLength(html)
    urls.push({ loc: `${site}/player/${slug}`, priority: e.newest === cur ? '0.6' : '0.4', lastmod: ctx.dataIso })
  }
  writeFileSync(path.join(dir, 'index.html'), directory)
  writeFileSync(path.join(dir, 'p.css'), css)
  writeFileSync(path.join(dir, 'p.js'), js)
  return { count: pages.length, bytes, urls, toolScript: script, skipped }
}
