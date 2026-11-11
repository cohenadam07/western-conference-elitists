// api/_status.js — the WCE Control Room's feed: what every job behind wcehoops.com is doing,
// every deploy, and the site's reach, in one private answer. The Control Room (Adam's Claude
// mod, opened with /wce) reads it; the jobs write to it.
//
// Served at /api/status (vercel.json rewrites it to api/analytics/history.js?section=status,
// so it costs no function slot: the Hobby plan allows 12 and the site uses 11).
//
// READ   GET /api/status?key=<WCE_STATUS_KEY>&part=jobs    every job, the last day of runs, deploys
//        GET /api/status?key=<WCE_STATUS_KEY>&part=reach   visits, connector calls, keys, newsletter, Dynasty
// The key is in the address on purpose: answers are cached at Vercel's edge for a few seconds
// (jobs 15 s, reach 2 min), and the cache is keyed on the full address, so a request without
// the key can never be handed a cached answer.
//
// WRITE  POST /api/status   Authorization: Bearer <WCE_STATUS_KEY, or a GitHub OIDC token>
//        { job, state: start|success|failure|cancelled, detail?, run?, source?, t? }
// The GitHub workflows prove themselves with GitHub's own signed token (githubOidcOk below), so
// no secret lives on GitHub; the Mac and the Control Room use the key.
// Every job checks in when it starts and when it ends (.github/scripts/control-room.sh, from the
// GitHub workflows and the Mac's launchd jobs). The first failure in a row, and the recovery after
// it, go to Adam's phone through ntfy (WCE_NTFY_TOPIC); repeats of the same failure don't.
// `t` (an ISO time) backfills an event from history: it is listed but changes no state and
// pushes nothing.
//
// WHAT IT STORES (Upstash, the site's store)
//   wce:status:jobs     hash   <job id> -> JSON of its latest state
//   wce:status:events   list   newest first, the last 600 check-ins
// A check-in costs 4 commands, a read of the jobs 2, a read of the reach 3. With the edge cache,
// an open Control Room costs a few hundred commands an hour at most.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { createPublicKey, verify as verifySig } from 'node:crypto'
import { parseJSONSafe, queryVisits, redisPipeline, timingSafeEqual, toHash, toISODate } from './analytics/_lib.js'
import { readUsage } from './_usage.js'
import { K_KEYS } from './_keys.js'
import { buttondown, buttondownConfigured } from './_forms.js'

const K_JOBS = 'wce:status:jobs'
const K_EVENTS = 'wce:status:events'
const MAX_EVENTS = 600
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_dSRz3SHX46QxsOZ51kMBWdru0yeV'
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_SGFwo9EvFolJJ1JSESkUFoDY'
const REPO = 'cohenadam07/western-conference-elitists'

// Every job behind the site. `cron` is the job's own schedule (UTC for GitHub, Eastern for the
// Mac's launchd jobs), used for "next run" and the timeline. `maxAgeH`: a job that hasn't checked
// in for this long is late; GitHub starts scheduled runs hours late at busy times, so these are
// generous. `lane` places it on the Control Room's map.
export const JOBS = [
  {
    id: 'basketball-tracking', name: 'NBA tracking upload', lane: 'mac', product: 'basketball',
    cron: ['30 4,10 * * *'], tz: 'America/New_York', maxAgeH: 20,
    cadence: '4:30 and 10:30am on the Mac, and on wake. Sends the NBA tables the cloud can\'t reach, then starts a cloud refresh.',
  },
  {
    id: 'news', name: 'News feed', lane: 'mac', product: 'news',
    cron: ['0 8,14 * * *', '30 23 * * *'], tz: 'America/New_York', maxAgeH: 10,
    cadence: '8am, 2pm and 11:30pm on the Mac. Runs only while the Mac is awake.',
  },
  {
    id: 'basketball-savant', name: 'Basketball Savant refresh', lane: 'github', product: 'basketball',
    workflow: 'basketball-savant-cloud.yml', maxAgeH: 30, tz: 'UTC',
    cron: ['17 16 * * *', '41 22 * * *', '41 1 * * *', '11 3 * * *', '41 9 * * *', '13 15 * * *'],
    cadence: 'Game days: watches from about 11:17am until every game is final. Rebuilds every day at about 4:41am and 10:13am.',
  },
  {
    id: 'college-savant', name: 'College Basketball Savant refresh', lane: 'github', product: 'basketball',
    workflow: 'college-basketball-savant-cloud.yml', maxAgeH: 30, tz: 'UTC',
    cron: ['47 16 * * *', '23 22 * * *', '19 1 * * *', '37 3 * * *', '29 10 * * *'],
    cadence: 'Game days: watches from about noon ET until every game is final. Rebuilds daily at about 5:29am ET.',
  },
  {
    id: 'college-savant-freshness', name: 'College freshness alarm', lane: 'github', product: 'basketball',
    workflow: 'college-basketball-savant-freshness.yml', maxAgeH: 30, tz: 'UTC', cron: ['37 17 * * *'],
    cadence: 'Daily. Fails if College Basketball Savant goes 30 hours without a refresh, or the cloud is blocked from ESPN.',
  },
  {
    id: 'college-football-savant', name: 'College Football Savant refresh', lane: 'github', product: 'football',
    workflow: 'college-football-savant-refresh.yml', maxAgeH: 30, tz: 'UTC', cron: ['7 10 * 8-12,1 *', '13 8 * 8-12,1 0'],
    cadence: 'Daily at about 5am ET, late August to the title game, plus Sunday at about 3am ET. Commits only when a file changed.',
  },
  {
    id: 'college-football-savant-freshness', name: 'College football freshness alarm', lane: 'github', product: 'football',
    workflow: 'college-football-savant-freshness.yml', maxAgeH: 30, tz: 'UTC', cron: ['41 15 * 8-12,1 *'],
    cadence: 'Daily in season. Fails if College Football Savant goes 36 hours without a refresh, or its newest final is more than four days old.',
  },
  {
    id: 'basketball-history', name: 'History additions', lane: 'github', product: 'basketball',
    workflow: 'basketball-savant-ext.yml', maxAgeH: 8, tz: 'UTC', cron: ['23 */2 * * *'],
    cadence: 'Every 2 hours. Publishes only when the Mac has sent a new seed.',
  },
  {
    id: 'basketball-freshness', name: 'Freshness alarm', lane: 'github', product: 'basketball',
    workflow: 'basketball-savant-freshness.yml', maxAgeH: 30, tz: 'UTC', cron: ['7 16 * * *'],
    cadence: 'Daily. Fails if Basketball Savant goes 30 hours without a refresh.',
  },
  {
    id: 'football-savant', name: 'Football Savant refresh', lane: 'github', product: 'football',
    workflow: 'football-savant-refresh.yml', maxAgeH: 30, tz: 'UTC', cron: ['11 11 * * *', '41 4 * * 1,2,5'],
    cadence: 'Daily about 6:11am, plus late nights after Sunday, Monday and Thursday games.',
  },
  {
    id: 'football-injuries', name: 'Football injuries', lane: 'github', product: 'football',
    workflow: 'football-injuries.yml', maxAgeH: 10, tz: 'UTC',
    cron: ['17 0-4/2,12-22/2 * * *', '47 17-23 * * 3-5', '47 15-23 * * 0', '47 0-4 * * 1'],
    cadence: 'Every 2 hours, and more often around games.',
  },
  {
    id: 'football-rebuild', name: 'Football full rebuild', lane: 'github', product: 'football',
    workflow: 'football-savant-rebuild.yml', maxAgeH: null, tz: 'UTC', cron: [],
    cadence: 'By hand only. Rebuilds every season since 1999.',
  },
  {
    id: 'ufc-savant', name: 'UFC Savant refresh', lane: 'github', product: 'ufc',
    workflow: 'ufc-savant-refresh.yml', maxAgeH: 132, tz: 'UTC', cron: ['0 13 * * 1', '0 13 * * 3'],
    cadence: 'Monday and Wednesday mornings. GitHub often starts these a few hours late.',
  },
  {
    id: 'weekly-snapshot', name: 'Weekly snapshot', lane: 'github', product: 'basketball',
    workflow: 'savant-weekly.yml', maxAgeH: 180, tz: 'UTC', cron: ['17 12 * * 4'],
    cadence: 'Thursday morning. Saves the week\'s percentiles and drafts the movers newsletter.',
  },
  {
    id: 'connector-coverage', name: 'Connector coverage test', lane: 'github', product: 'connector',
    workflow: 'connector-coverage.yml', maxAgeH: 180, tz: 'UTC', cron: ['23 12 * * 0'],
    cadence: 'Sunday morning. Checks the AI connector covers every feature of the site.',
  },
  {
    id: 'deploy-batch', name: 'Deploy batch', lane: 'site', product: 'site',
    workflow: 'deploy-batch.yml', maxAgeH: 30, tz: 'UTC', cron: [],
    cadence: 'Puts the data bots\' updates on the live site at most every 4 hours (none overnight), and right away for injury news in NFL game windows. Code changes still deploy at once.',
  },
  {
    id: 'site-watch', name: 'Site watch', lane: 'site', product: 'site',
    workflow: 'site-watch.yml', maxAgeH: 4, tz: 'UTC', cron: ['7,37 * * * *'],
    cadence: 'Every 30 minutes (GitHub skips some): the homepage, a Savant page, the AI connector and the latest deploy.',
  },
]
const JOB_IDS = new Set(JOBS.map((j) => j.id))
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/
const STATES = new Set(['start', 'success', 'failure', 'cancelled'])

/* ------------------------------------------------------------------ *
 * Schedules: when a cron expression fires, in its own time zone
 * ------------------------------------------------------------------ */

function field(spec, min, max) {
  const out = new Set()
  for (const part of String(spec).split(',')) {
    const [range, stepS] = part.split('/')
    const step = stepS ? Math.max(1, Number(stepS)) : 1
    let lo, hi
    if (range === '*') { lo = min; hi = max }
    else if (range.includes('-')) { [lo, hi] = range.split('-').map(Number) }
    else { lo = Number(range); hi = stepS ? max : lo }
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && max === 6 ? 0 : v)
  }
  return out
}

function parseCron(expr) {
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/)
  return {
    m: [...field(m, 0, 59)].sort((a, b) => a - b), h: field(h, 0, 23), dom: field(dom, 1, 31),
    mon: field(mon, 1, 12), dow: field(dow, 0, 6), domAny: dom === '*', dowAny: dow === '*',
  }
}

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const fmts = {}
function local(t, tz) {
  const f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', month: 'numeric', day: 'numeric', hour: 'numeric', weekday: 'short',
  }))
  const p = {}
  for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value
  return { mon: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, dow: WD[p.weekday] }
}

// Every firing of `crons` between `from` and `to` (ms), oldest first. Both zones used here are a
// whole number of hours off UTC, so a local hour starts on a UTC hour.
export function firings(crons, tz, from, to, limit = 200) {
  const parsed = crons.map(parseCron)
  const out = []
  for (let t = Math.floor(from / HOUR) * HOUR; t <= to && out.length < limit; t += HOUR) {
    const L = local(t, tz)
    for (const c of parsed) {
      if (!c.h.has(L.hour) || !c.mon.has(L.mon)) continue
      const domOk = c.dom.has(L.day), dowOk = c.dow.has(L.dow)
      const dayOk = c.domAny && c.dowAny ? true : c.domAny ? dowOk : c.dowAny ? domOk : domOk || dowOk
      if (!dayOk) continue
      for (const m of c.m) {
        const f = t + m * 60000
        if (f >= from && f <= to) out.push(f)
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b).slice(0, limit)
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

function storeReady() {
  return Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN))
}

async function readJobsAndEvents() {
  const [jobs, events] = await redisPipeline([['HGETALL', K_JOBS], ['LRANGE', K_EVENTS, 0, MAX_EVENTS - 1]])
  const state = {}
  for (const [id, raw] of Object.entries(toHash(jobs?.result))) state[id] = parseJSONSafe(raw, null)
  const list = (events?.result || []).map((e) => parseJSONSafe(e, null)).filter(Boolean)
  return { state, events: list }
}

/* ------------------------------------------------------------------ *
 * Phone pushes (ntfy)
 * ------------------------------------------------------------------ */

async function push({ title, message, priority = 'high', tags = 'rotating_light', click }) {
  const topic = process.env.WCE_NTFY_TOPIC
  if (!topic) return false
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: title.replace(/[^\x20-\x7E]/g, ''),
        Priority: priority,
        Tags: tags,
        ...(click ? { Click: click } : {}),
      },
      body: message,
      signal: AbortSignal.timeout(4000),
    })
    return res.ok
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Writes: a job checking in
 * ------------------------------------------------------------------ */

const clip = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '')

export async function checkIn(body, now = Date.now()) {
  const job = String(body?.job || '')
  const state = String(body?.state || '')
  if (!ID_RE.test(job)) return { status: 400, json: { error: 'job must be a short lowercase id' } }
  if (!STATES.has(state)) return { status: 400, json: { error: 'state must be start, success, failure or cancelled' } }
  const run = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(body?.run || '') ? body.run : ''
  const detail = clip(body?.detail, 300)
  const source = ['github', 'mac', 'site', 'hand'].includes(body?.source) ? body.source : 'github'
  const at = body?.t ? Date.parse(body.t) : NaN
  const backfill = Number.isFinite(at) && at < now - 60000

  const [prevRow] = await redisPipeline([['HGET', K_JOBS, job]])
  const prev = parseJSONSafe(prevRow?.result, null) || {}
  const t = backfill ? at : now

  const event = { t, job, state, ...(detail ? { detail } : {}), ...(run ? { run } : {}), source }
  if (state !== 'start' && prev.state === 'start' && prev.run && prev.run === run) event.dur = Math.max(0, t - prev.since)

  const cmds = [['LPUSH', K_EVENTS, JSON.stringify(event)], ['LTRIM', K_EVENTS, 0, MAX_EVENTS - 1]]
  let next = null
  if (!backfill) {
    next = { ...prev, state, t, source, detail: detail || null, run: run || null, backfilled: false }
    if (state === 'start') next.since = t
    else {
      next.lastEnd = t
      next.dur = event.dur ?? null
      if (state === 'success') next.lastOk = t
      if (state === 'failure') {
        next.lastFail = t
        next.failDetail = detail || ((prev.streak || 0) > 0 ? prev.failDetail : null) || null
        next.failRun = run || null
      }
      // A failure streak is counted so a job failing every run pushes once, not every time.
      next.streak = state === 'failure' ? (prev.streak || 0) + 1 : state === 'success' ? 0 : prev.streak || 0
    }
    cmds.push(['HSET', K_JOBS, job, JSON.stringify(next)])
  } else if (!prev.state) {
    // History for a job with no live check-in yet: its newest backfilled end becomes its state.
    if (state !== 'start' && (!prev.lastEnd || t > prev.lastEnd)) {
      const seeded = { ...prev, state, t, source, detail: detail || null, run: run || null, lastEnd: t, backfilled: true }
      if (state === 'success') seeded.lastOk = t
      cmds.push(['HSET', K_JOBS, job, JSON.stringify(seeded)])
    }
  }
  await redisPipeline(cmds)

  // Pushes: the first failure in a row, and getting better after one. Backfills never push.
  let pushed = null
  if (!backfill) {
    const meta = JOBS.find((j) => j.id === job)
    const name = meta?.name || job
    if (state === 'failure' && (prev.streak || 0) === 0) {
      pushed = (await push({ title: `WCE: ${name} failed`, message: detail || 'It failed. Open the Control Room (/wce) for details.', click: run || undefined })) ? 'failure' : 'unsent'
    } else if (state === 'success' && (prev.streak || 0) > 0) {
      pushed = (await push({ title: `WCE: ${name} is back`, message: detail || 'It ran cleanly again.', priority: 'default', tags: 'white_check_mark', click: run || undefined })) ? 'recovered' : 'unsent'
    }
  }
  return { status: 200, json: { ok: true, job, state, backfill, pushed, known: JOB_IDS.has(job) } }
}

/* ------------------------------------------------------------------ *
 * Reads: the jobs
 * ------------------------------------------------------------------ */

const STALLED_H = 7 // longer than any job's timeout: a "start" this old never finished

function jobView(meta, s, now) {
  const fromCron = meta.cron?.length
  const next = fromCron ? firings(meta.cron, meta.tz, now, now + 8 * DAY, 1)[0] || null : null
  const view = {
    id: meta.id, name: meta.name, lane: meta.lane, product: meta.product, cadence: meta.cadence,
    workflow: meta.workflow ? `https://github.com/${REPO}/actions/workflows/${meta.workflow}` : null,
    next, maxAgeH: meta.maxAgeH,
    last: s ? { state: s.state, t: s.t, detail: s.detail || null, run: s.run || null, dur: s.dur ?? null } : null,
    since: s?.state === 'start' ? s.since : null,
    lastOk: s?.lastOk || null, lastFail: s?.lastFail || null, failDetail: s?.failDetail || null,
    failRun: s?.failRun || null, streak: s?.streak || 0, backfilled: Boolean(s?.backfilled),
  }
  let status
  if (!s) status = meta.maxAgeH == null ? 'manual' : 'waiting'
  else if (s.state === 'start') status = now - s.since > STALLED_H * HOUR ? 'stalled' : 'running'
  else if (s.state === 'failure') status = 'failed'
  else if (meta.maxAgeH != null && now - (s.lastEnd || s.t) > meta.maxAgeH * HOUR) status = 'late'
  else status = s.state === 'cancelled' ? 'cancelled' : 'ok'
  view.status = status
  return view
}

async function readDeploys() {
  const token = process.env.VERCEL_ANALYTICS_TOKEN || process.env.VERCEL_ACCESS_TOKEN
  if (!token) return { error: 'no Vercel token' }
  // Not CANCELED: the data bots' commits are skipped on purpose (scripts/vercel-ignore.sh) and
  // would otherwise fill the list, and hide a failed build behind them.
  const p = new URLSearchParams({ projectId: PROJECT_ID, teamId: TEAM_ID, limit: '15', state: 'BLOCKED,BUILDING,ERROR,INITIALIZING,QUEUED,READY' })
  try {
    const res = await fetch(`https://api.vercel.com/v6/deployments?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { error: `Vercel answered ${res.status}` }
    const json = await res.json()
    return {
      list: (json.deployments || []).map((d) => ({
        id: d.uid,
        state: d.readyState || d.state || 'UNKNOWN',
        target: d.target || 'preview',
        created: d.created || d.createdAt || null,
        building: d.buildingAt || null,
        ready: d.ready || null,
        message: clip(d.meta?.githubCommitMessage || '', 120) || null,
        author: d.meta?.githubCommitAuthorLogin || d.meta?.githubCommitAuthorName || d.creator?.username || null,
        sha: d.meta?.githubCommitSha ? d.meta.githubCommitSha.slice(0, 7) : null,
        inspect: d.inspectorUrl || null,
      })),
    }
  } catch (err) {
    return { error: String(err?.message || err).slice(0, 120) }
  }
}

export async function readJobs(now = Date.now()) {
  const [{ state, events }, deploys] = await Promise.all([readJobsAndEvents(), readDeploys()])
  const jobs = JOBS.map((meta) => jobView(meta, state[meta.id], now))
  // A job that checked in but isn't in the list above still shows, so nothing goes missing.
  for (const [id, s] of Object.entries(state)) {
    if (!JOB_IDS.has(id) && s) jobs.push(jobView({ id, name: id, lane: s.source === 'mac' ? 'mac' : 'github', product: 'other', cadence: 'Not in the Control Room\'s list yet.', cron: [], maxAgeH: null }, s, now))
  }
  const dayAgo = now - 26 * HOUR
  const recent = events.filter((e) => e.t >= dayAgo).sort((a, b) => a.t - b.t)
  // The timeline's future: when each job is due next, for the coming 12 hours.
  const upcoming = []
  for (const meta of JOBS) {
    if (!meta.cron?.length) continue
    for (const t of firings(meta.cron, meta.tz, now, now + 12 * HOUR, 30)) upcoming.push({ job: meta.id, t })
  }
  const counts = {}
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1
  return { now, jobs, events: recent, upcoming, deploys, counts }
}

/* ------------------------------------------------------------------ *
 * Reads: the reach
 * ------------------------------------------------------------------ */

async function settle(promise) {
  try { return await promise } catch (err) { return { error: String(err?.message || err).slice(0, 160) } }
}

export async function readReach(now = Date.now()) {
  const today = toISODate(now)
  const weekAgo = toISODate(now - 6 * DAY)
  const day = today

  const store = settle((async () => {
    const [keys, ballots, daily] = await redisPipeline([['HLEN', K_KEYS], ['GET', 'dyn:n'], ['GET', `dyn:daily:${day}:cnt`]])
    return { keys: Number(keys?.result) || 0, ballots: Number(ballots?.result) || 0, dailyToday: Number(daily?.result) || 0 }
  })())
  const connector = settle((async () => {
    const u = await readUsage({ from: weekAgo, to: today, now })
    const byDay = Object.fromEntries((u.daily || []).map((d) => [d.date, d]))
    return {
      today: byDay[today]?.calls || 0,
      errorsToday: byDay[today]?.errors || 0,
      connectionsToday: byDay[today]?.connections || 0,
      week: Array.from({ length: 7 }, (_, i) => { const d = toISODate(now - (6 - i) * DAY); return { date: d, calls: byDay[d]?.calls || 0 } }),
      topTools: (u.tools || []).slice(0, 5).map((t) => ({ tool: t.key, calls: t.calls })),
    }
  })())
  const visits = settle((async () => {
    // Same window format as the analytics snapshot (api/analytics/snapshot.js): dates, both ends in.
    const rows = await queryVisits({ by: ['day'], since: weekAgo, until: today })
    const byDay = {}
    for (const r of rows) {
      const d = r.timestamp ? toISODate(r.timestamp) : null
      if (d) byDay[d] = { visitors: Number(r.visitors) || 0, pageviews: Number(r.pageviews) || 0 }
    }
    return {
      today: byDay[today] || { visitors: 0, pageviews: 0 },
      week: Array.from({ length: 7 }, (_, i) => { const d = toISODate(now - (6 - i) * DAY); return { date: d, ...(byDay[d] || { visitors: 0, pageviews: 0 }) } }),
    }
  })())
  const newsletter = settle((async () => {
    if (!buttondownConfigured()) return { error: 'Buttondown not set up' }
    const r = await buttondown('GET', '/subscribers?type=regular&page_size=1')
    return r.ok ? { subscribers: Number(r.json?.count) || 0 } : { error: `Buttondown answered ${r.status}` }
  })())

  const [s, c, v, n] = await Promise.all([store, connector, visits, newsletter])
  return {
    now,
    visits: v,
    connector: c,
    keys: s.error ? s : { founding: s.keys },
    dynasty: s.error ? s : { ballots: s.ballots, dailyToday: s.dailyToday },
    newsletter: n,
    // Step 3 of the Control Room: these need keys the site doesn't have yet.
    youtube: { connected: false },
    social: { connected: false },
    search: { connected: false },
  }
}

/* ------------------------------------------------------------------ *
 * The handler (called from api/analytics/history.js for section=status)
 * ------------------------------------------------------------------ */

function presented(req) {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  return new URL(req.url, 'http://localhost').searchParams.get('key') || ''
}

// GitHub's own proof that a request comes from a workflow in this repo on main: an OIDC token
// (each workflow has `id-token: write`; control-room.sh asks for one with the audience below).
// So the workflows check in with no secret stored on GitHub at all. GitHub's signing keys are
// fetched from its public key set and kept for an hour.
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
const OIDC_AUDIENCE = 'wcehoops-status'
let jwks = { at: 0, keys: [] }
const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

async function githubKey(kid) {
  const find = () => jwks.keys.find((k) => k.kid === kid)
  if (Date.now() - jwks.at < HOUR && find()) return find()
  const res = await fetch(`${OIDC_ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) return null
  jwks = { at: Date.now(), keys: (await res.json()).keys || [] }
  return find() || null
}

export async function githubOidcOk(token, now = Date.now()) {
  const parts = String(token).split('.')
  if (parts.length !== 3) return false
  try {
    const header = JSON.parse(b64url(parts[0]).toString('utf8'))
    const claims = JSON.parse(b64url(parts[1]).toString('utf8'))
    if (header.alg !== 'RS256') return false
    const jwk = await githubKey(header.kid)
    if (!jwk) return false
    const signed = verifySig('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]))
    const s = now / 1000
    return signed && claims.iss === OIDC_ISSUER && claims.aud === OIDC_AUDIENCE &&
      claims.repository === REPO && claims.ref === 'refs/heads/main' &&
      Number(claims.exp) > s && Number(claims.nbf ?? 0) <= s + 60
  } catch {
    return false
  }
}

async function authorized(req, key) {
  const shown = presented(req)
  if (shown && timingSafeEqual(shown, key)) return true
  return shown.split('.').length === 3 && githubOidcOk(shown)
}

async function bodyOf(req) {
  if (req.body != null && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return parseJSONSafe(req.body, {})
  const chunks = []
  let size = 0
  for await (const c of req) { size += c.length; if (size > 16384) break; chunks.push(c) }
  return parseJSONSafe(Buffer.concat(chunks).toString('utf8'), {})
}

export async function statusHandler(req, res) {
  const key = process.env.WCE_STATUS_KEY
  if (!key) return res.status(503).json({ error: 'WCE_STATUS_KEY is not set: the Control Room feed is off.' })
  if (!(await authorized(req, key))) return res.status(401).json({ error: 'unauthorized' })
  if (!storeReady()) return res.status(503).json({ error: 'The data store is not set up.' })

  try {
    if (req.method === 'POST') {
      res.setHeader('Cache-Control', 'no-store')
      const { status, json } = await checkIn(await bodyOf(req))
      return res.status(status).json(json)
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET or POST' })
    const params = new URL(req.url, 'http://localhost').searchParams
    const part = params.get('part') || 'jobs'
    // Edge-cached only when the key is in the address (the cache is keyed on the address, so
    // only someone holding the key can be served it). A read that proved itself in a header
    // (site watch's GitHub token) is never cached: its address alone would open the cache.
    const cacheable = Boolean(params.get('key'))
    const cache = (s) => res.setHeader('Cache-Control', cacheable ? `public, s-maxage=${s}, stale-while-revalidate=${s}` : 'private, no-store')
    if (part === 'reach') {
      cache(120)
      return res.status(200).json(await readReach())
    }
    cache(15)
    return res.status(200).json(await readJobs())
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: String(err?.message || err).slice(0, 200) })
  }
}
