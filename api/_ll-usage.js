// api/_ll-usage.js — Live Lineups usage events (public/live-lineups.html).
//
// WRITE  POST /api/ll-usage      a navigator.sendBeacon batch: {"s": "<session id>", "e": [[t, kind, data?], ...]}
//        Public, like the page. Rewritten to /api/analytics/history?section=ll-usage so it costs no function slot.
//        Every field is checked against a fixed list and clipped; anything else is dropped. Nothing about the
//        visitor is stored: no IP, no user agent, no location, no cookies, nothing typed. Only what the page sends:
//        a random session id made on page load, a time, an event kind and a few enumerated values.
// CHECK  GET /api/ll-usage?check=<session id>   counts of that one session's events today, by kind. Used to prove
//        events land (preview and production tests). The id is 16 random hex characters, so it can't be guessed.
// READ   GET /api/status?key=<WCE_STATUS_KEY>&part=ll   the Control Room's summary (api/_status.js, behind its key).
//
// STORE (Upstash, the site's store)
//   wce:ll:<env>:d:<YYYY-MM-DD, Chicago>   list of event JSON, oldest first, capped at 20,000 a day, kept 120 days
//   <env> is "prod" for production and "pv" for previews and local runs, so test traffic never mixes in.
// A batch costs 3 commands. The page sends one batch a minute while open (with the heartbeat), plus one when
// it is hidden or closed.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { redisPipeline, parseJSONSafe } from './analytics/_lib.js'

const ENV = process.env.VERCEL_ENV === 'production' ? 'prod' : 'pv'
const KEEP_DAYS = 120
const MAX_PER_DAY = 20000
const MAX_BATCH = 60
const SID = /^[a-f0-9]{16}$/

// kind -> allowed fields and their allowed values (a RegExp or a Set); values outside are dropped
const WORD = /^[a-z0-9-]{1,16}$/
const FIELDS = {
  open: { team: /^\d{1,6}$/, mode: new Set(['live', 'replay']), dev: new Set(['phone', 'tablet', 'desktop']), st: WORD, ver: /^[0-9.]{1,10}$/ },
  tab: { tab: new Set(['now', 'shots', 'players', 'sheet']), st: WORD },
  pick: { sel: /^[0-9|,-]{1,80}$/, label: /^[\p{L}\p{M} .,'’-]{1,90}$/u, from: new Set(['picker', 'list']), st: WORD },
  drawer: { st: WORD },
  seg: { seg: new Set(['lineups', 'players', 'shooting', 'opp']), st: WORD },
  download: { fmt: new Set(['xlsx', 'csv']), scope: new Set(['game', 'season']), st: WORD },
  half: {},
  banner: { kind: new Set(['delayed', 'badsub', 'hidden', 'unreachable', 'other']) },
  hb: { st: WORD, p: /^[1-9]$/, vis: new Set(['1']) },
}

const chicagoDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))

function clean(sid, raw, now) {
  if (!Array.isArray(raw) || raw.length < 2) return null
  const [t0, kind, data] = raw
  const spec = FIELDS[kind]
  if (!spec) return null
  let t = Number(t0)
  if (!Number.isFinite(t) || t < now - 6 * 3600e3 || t > now + 60e3) t = now // a beacon held by a sleeping phone, or a wrong clock
  const ev = { t: Math.round(t), s: sid, k: kind }
  if (data && typeof data === 'object') {
    for (const [f, rule] of Object.entries(spec)) {
      const v = data[f]
      if (v == null) continue
      const s = String(v).slice(0, 100)
      if (rule instanceof Set ? rule.has(s) : rule.test(s)) ev[f] = s
    }
  }
  return ev
}

async function bodyOf(req) {
  if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string') return parseJSONSafe(req.body, {})
  if (Buffer.isBuffer(req.body)) return parseJSONSafe(req.body.toString('utf8'), {})
  const chunks = []; let size = 0
  for await (const c of req) { size += c.length; if (size > 32768) return {}; chunks.push(c) }
  return parseJSONSafe(Buffer.concat(chunks).toString('utf8'), {})
}

const storeReady = () => Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN))
const kDay = (day, env = ENV) => `wce:ll:${env}:d:${day}`

export async function llUsageHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!storeReady()) return res.status(204).end()
  try {
    if (req.method === 'GET') {
      const sid = new URL(req.url, 'http://localhost').searchParams.get('check') || ''
      if (!SID.test(sid)) return res.status(400).json({ error: 'check=<session id>' })
      const now = Date.now(); const days = [...new Set([chicagoDay(now - 86400e3), chicagoDay(now)])]
      const got = await redisPipeline(days.map((d) => ['LRANGE', kDay(d), 0, -1]))
      const kinds = {}; let n = 0
      for (const r of got) for (const x of r.result || []) { const e = parseJSONSafe(x, null); if (e && e.s === sid) { n++; kinds[e.k] = (kinds[e.k] || 0) + 1 } }
      return res.status(200).json({ env: ENV, session: sid, events: n, kinds })
    }
    if (req.method !== 'POST') return res.status(405).end()
    const body = await bodyOf(req)
    const sid = String(body?.s || '')
    if (!SID.test(sid) || !Array.isArray(body.e)) return res.status(400).end()
    const now = Date.now()
    const byDay = {}
    for (const raw of body.e.slice(0, MAX_BATCH)) { const ev = clean(sid, raw, now); if (ev) (byDay[chicagoDay(ev.t)] ||= []).push(JSON.stringify(ev)) }
    const cmds = []
    for (const [day, list] of Object.entries(byDay)) cmds.push(['RPUSH', kDay(day), ...list], ['LTRIM', kDay(day), -MAX_PER_DAY, -1], ['EXPIRE', kDay(day), KEEP_DAYS * 86400])
    if (cmds.length) await redisPipeline(cmds)
    return res.status(204).end()
  } catch {
    return res.status(204).end() // the page never waits on or retries this; a lost batch is fine
  }
}

// ------------------------------------------------------------------ the Control Room's summary
const STATE_NAME = { pre: 'pre-game', half: 'halftime', final: 'final' }
export async function readLlUsage({ days = 14, sessions = 25 } = {}) {
  const now = Date.now()
  const dayList = []; for (let i = days - 1; i >= 0; i--) dayList.push(chicagoDay(now - i * 86400e3))
  const uniq = [...new Set(dayList)]
  const got = await redisPipeline(uniq.map((d) => ['LRANGE', kDay(d, 'prod'), 0, -1]))
  const perDay = []; const tabs = {}; const picks = {}; const downloads = {}; const segs = {}; const banners = {}; const devices = {}
  let halftimes = 0, drawers = 0
  const S = new Map()
  uniq.forEach((day, i) => {
    const evs = (got[i]?.result || []).map((x) => parseJSONSafe(x, null)).filter(Boolean)
    const sids = new Set(); let opens = 0
    for (const e of evs) {
      sids.add(e.s)
      let s = S.get(e.s); if (!s) S.set(e.s, (s = { id: e.s, first: e.t, last: e.t, events: [], minutes: {} }))
      s.first = Math.min(s.first, e.t); s.last = Math.max(s.last, e.t)
      if (e.k === 'hb') { const key = e.st === 'live' ? `live ${e.p === '2' ? '2nd half' : e.p === '1' ? '1st half' : 'OT'}` : STATE_NAME[e.st] || e.st || '?'; s.minutes[key] = (s.minutes[key] || 0) + 1; continue }
      s.events.push(e)
      if (e.k === 'open') { opens++; Object.assign(s, { team: e.team, mode: e.mode, dev: e.dev }); if (e.dev) devices[e.dev] = (devices[e.dev] || 0) + 1 }
      else if (e.k === 'tab' && e.tab) tabs[e.tab] = (tabs[e.tab] || 0) + 1
      else if (e.k === 'pick') { const l = e.label || (e.sel ? 'a lineup' : 'Whole game'); picks[l] = (picks[l] || 0) + 1 }
      else if (e.k === 'download') { const l = `${e.fmt || '?'} · ${e.scope === 'season' ? 'Whole season' : 'This game'}`; downloads[l] = (downloads[l] || 0) + 1 }
      else if (e.k === 'drawer') drawers++
      else if (e.k === 'seg' && e.seg) segs[e.seg] = (segs[e.seg] || 0) + 1
      else if (e.k === 'half') halftimes++
      else if (e.k === 'banner' && e.kind) banners[e.kind] = (banners[e.kind] || 0) + 1
    }
    perDay.push({ day, events: evs.length, sessions: sids.size, opens })
  })
  const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }))
  const recent = [...S.values()].sort((a, b) => b.last - a.last).slice(0, sessions)
    .map((s) => ({ ...s, openMin: Math.round((s.last - s.first) / 60000), events: s.events.slice(-200).map((e) => { const r = { ...e }; delete r.s; return r }) }))
  return { now, days: perDay, totals: { tabs: sorted(tabs), picks: sorted(picks).slice(0, 25), downloads: sorted(downloads), drawer: drawers, segments: sorted(segs), halftime: halftimes, banners: sorted(banners), devices: sorted(devices) }, sessions: recent }
}
