// Checks for the Control Room feed's Muse check-ins (api/_status.js): the separate key, what it
// can and can't do, post and snapshot check-ins, the numbers, and staleness. Run:
//   node --test tools/control-room/check.mjs
// Upstash is replaced by an in-memory store; ntfy calls are counted, never sent.

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.KV_REST_API_URL = 'https://store.test'
process.env.KV_REST_API_TOKEN = 'store-token'
process.env.WCE_STATUS_KEY = 'wcs_' + 'a'.repeat(48)
process.env.WCE_MUSE_KEY = 'wcm_' + 'b'.repeat(48)
process.env.WCE_NTFY_TOPIC = 'test-topic'
delete process.env.VERCEL_ANALYTICS_TOKEN
delete process.env.VERCEL_ACCESS_TOKEN

/* ---------- a tiny Upstash ---------- */
let db
let pushes
function run([cmd, ...a]) {
  const get = (k, kind) => db.get(k) ?? (kind === 'hash' ? new Map() : [])
  switch (cmd) {
    case 'HGET': return get(a[0], 'hash').get(a[1]) ?? null
    case 'HSET': { const h = get(a[0], 'hash'); h.set(a[1], a[2]); db.set(a[0], h); return 1 }
    case 'HGETALL': return [...get(a[0], 'hash')].flat()
    case 'HLEN': return get(a[0], 'hash').size
    case 'LPUSH': { const l = get(a[0]); l.unshift(a[1]); db.set(a[0], l); return l.length }
    case 'LTRIM': { const l = get(a[0]); db.set(a[0], l.slice(Number(a[1]), Number(a[2]) + 1)); return 'OK' }
    case 'LRANGE': { const l = get(a[0]); const end = Number(a[2]); return l.slice(Number(a[1]), end < 0 ? undefined : end + 1) }
    case 'GET': return db.get(a[0]) ?? null
    default: return null
  }
}
globalThis.fetch = async (url, init = {}) => {
  url = String(url)
  if (url === 'https://store.test/pipeline') {
    const cmds = JSON.parse(init.body)
    return new Response(JSON.stringify(cmds.map((c) => ({ result: run(c) }))), { status: 200 })
  }
  if (url.startsWith('https://ntfy.sh/')) { pushes.push({ title: init.headers?.Title, body: init.body }); return new Response('ok') }
  return new Response('not here', { status: 404 })
}

const S = await import('../../api/_status.js')

beforeEach(() => { db = new Map(); pushes = [] })

/* ---------- calling the handler like Vercel does ---------- */
async function call({ method = 'POST', auth, query = '', body } = {}) {
  const req = {
    method, url: `/api/analytics/history?section=status${query}`,
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
    body,
  }
  let status = 0, json = null
  const res = { setHeader() {}, status(s) { status = s; return this }, json(j) { json = j; return this } }
  await S.statusHandler(req, res)
  return { status, json }
}
const MUSE = process.env.WCE_MUSE_KEY
const MAIN = process.env.WCE_STATUS_KEY
const post = (job, extra = {}) => ({ job, state: 'success', kind: 'post', url: 'https://www.instagram.com/p/ABC123/', ...extra })
const snap = (job, metrics) => ({ job, state: 'success', kind: 'snapshot', metrics })
const jobOf = async (id, now) => (await S.readJobs(now)).jobs.find((j) => j.id === id)

/* ---------- the key ---------- */

test('the Muse key can post a check-in for its jobs', async () => {
  const r = await call({ auth: MUSE, body: post('muse-instagram') })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.ok, true)
  const j = await jobOf('muse-instagram')
  assert.equal(j.status, 'ok')
  assert.equal(j.lastPost.url, 'https://www.instagram.com/p/ABC123/')
})

test('the Muse key cannot read the feed', async () => {
  for (const part of ['jobs', 'reach', 'll']) {
    const r = await call({ method: 'GET', auth: MUSE, query: `&part=${part}` })
    assert.equal(r.status, 403)
  }
})

test('the Muse key in the address is not accepted', async () => {
  const r = await call({ method: 'GET', query: `&part=jobs&key=${MUSE}` })
  assert.equal(r.status, 401)
  const w = await call({ query: `&key=${MUSE}`, body: post('muse-instagram') })
  assert.equal(w.status, 401)
})

test('the Muse key cannot check in for any other job', async () => {
  for (const job of ['basketball-savant', 'site-watch', 'made-up-job']) {
    const r = await call({ auth: MUSE, body: { job, state: 'failure', detail: 'x' } })
    assert.equal(r.status, 403, job)
  }
  assert.equal(db.get('wce:status:events'), undefined, 'nothing written')
})

test('a wrong key is refused', async () => {
  const r = await call({ auth: 'wcm_' + 'c'.repeat(48), body: post('muse-instagram') })
  assert.equal(r.status, 401)
})

test('the main key still works as before, and its Muse check-ins get Muse\'s checks', async () => {
  const g = await call({ method: 'GET', auth: MAIN, query: '&part=jobs' })
  assert.equal(g.status, 200)
  const ok = await call({ auth: MAIN, body: { job: 'news', state: 'success', source: 'mac' } })
  assert.equal(ok.status, 200)
  const bad = await call({ auth: MAIN, body: { job: 'muse-threads', state: 'success' } })
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /kind/)
})

test('with no Muse key set, the Muse key does nothing', async () => {
  const saved = process.env.WCE_MUSE_KEY
  delete process.env.WCE_MUSE_KEY
  try {
    const r = await call({ auth: saved, body: post('muse-instagram') })
    assert.equal(r.status, 401)
  } finally { process.env.WCE_MUSE_KEY = saved }
})

/* ---------- what Muse sends ---------- */

test('post check-ins are validated and say what was wrong', async () => {
  const cases = [
    [{ job: 'muse-instagram', state: 'success', kind: 'post' }, /needs its url/],
    [post('muse-instagram', { url: 'http://www.instagram.com/p/x' }), /https link on instagram\.com/],
    [post('muse-instagram', { url: 'https://evil.example/p/x' }), /instagram\.com/],
    [post('muse-threads', { url: 'https://www.instagram.com/p/x' }), /threads\.com or threads\.net/],
    [post('muse-instagram', { url: 'not a link' }), /not a link/],
    [{ job: 'muse-facebook', state: 'failure', kind: 'post' }, /detail saying why/],
    [post('muse-instagram', { state: 'start' }), /success or failure/],
    [post('muse-instagram', { t: '2026-11-01T00:00:00Z' }), /backfilling/],
    [{ job: 'muse-instagram', state: 'success', kind: 'story' }, /post or snapshot/],
  ]
  for (const [body, re] of cases) {
    const r = await call({ auth: MUSE, body })
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.match(r.json.error, re)
  }
})

test('every platform accepts its own links', async () => {
  for (const [job, url] of [
    ['muse-instagram', 'https://instagram.com/reel/XYZ/'],
    ['muse-threads', 'https://www.threads.com/@wcehoops/post/ABC'],
    ['muse-threads', 'https://www.threads.net/@wcehoops/post/ABC'],
    ['muse-facebook', 'https://www.facebook.com/wcehoops/posts/123'],
    ['muse-facebook', 'https://fb.watch/abc/'],
  ]) {
    const r = await call({ auth: MUSE, body: post(job, { url }) })
    assert.equal(r.status, 200, `${job} ${url}: ${JSON.stringify(r.json)}`)
  }
})

test('an oversized body is refused', async () => {
  const r = await call({ auth: MUSE, body: post('muse-instagram', { detail: 'x'.repeat(5000) }) })
  assert.equal(r.status, 413)
})

test('a failed post goes red, pushes once, and a good post recovers it', async () => {
  const fail = { job: 'muse-facebook', state: 'failure', kind: 'post', detail: 'Facebook rejected the video: too long' }
  await call({ auth: MUSE, body: fail })
  await call({ auth: MUSE, body: fail })
  assert.equal((await jobOf('muse-facebook')).status, 'failed')
  assert.equal(pushes.length, 1, 'one push for a streak')
  assert.match(pushes[0].title, /Facebook \(Muse\) failed/)
  await call({ auth: MUSE, body: post('muse-facebook', { url: 'https://www.facebook.com/wcehoops/posts/1' }) })
  assert.equal((await jobOf('muse-facebook')).status, 'ok')
  assert.equal(pushes.length, 2)
  assert.match(pushes[1].title, /is back/)
})

/* ---------- the numbers ---------- */

test('a snapshot stores the numbers, drops unknown fields and says which', async () => {
  const r = await call({ auth: MUSE, body: snap('muse-instagram', { followers: '1,240', reach_24h: 5300, views_24h: null, mood: 'great' }) })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.deepEqual(r.json.dropped, ['mood'])
  const social = await S.readSocial()
  assert.equal(social.connected, true)
  assert.deepEqual(social.platforms.instagram.metrics, { followers: 1240, reach_24h: 5300, views_24h: null })
  const j = await jobOf('muse-instagram')
  assert.equal(j.status, 'ok')
  assert.ok(j.lastSnap)
})

test('a snapshot with bad or no numbers is refused', async () => {
  for (const metrics of [undefined, [], {}, { followers: null }, { followers: -3 }, { followers: 'lots' }, { mood: 1 }]) {
    const r = await call({ auth: MUSE, body: snap('muse-threads', metrics) })
    assert.equal(r.status, 400, JSON.stringify(metrics))
  }
  assert.equal((await S.readSocial()).connected, false)
})

test('a good snapshot keeps a red light red (until a post goes through) and doesn\'t push', async () => {
  await call({ auth: MUSE, body: { job: 'muse-threads', state: 'failure', kind: 'post', detail: 'Threads was down' } })
  assert.equal(pushes.length, 1)
  await call({ auth: MUSE, body: snap('muse-threads', { followers: 300 }) })
  const j = await jobOf('muse-threads')
  assert.equal(j.status, 'failed')
  assert.equal(pushes.length, 1, 'no "is back" from numbers alone')
})

test('a failed snapshot goes red with the reason', async () => {
  const r = await call({ auth: MUSE, body: { job: 'muse-threads', state: 'failure', kind: 'snapshot', detail: 'insights not available' } })
  assert.equal(r.status, 200)
  const j = await jobOf('muse-threads')
  assert.equal(j.status, 'failed')
  assert.match(j.failDetail, /Couldn't read the numbers: insights not available/)
})

test('the week\'s change is worked out from the snapshot about 7 days back', async () => {
  const DAY = 86400000
  const now = Date.parse('2026-11-23T23:00:00Z')
  for (let i = 9; i >= 0; i--) {
    const r = await S.museCheckIn(snap('muse-instagram', { followers: 1000 + (9 - i) * 10, reach_24h: 100 }), now - i * DAY)
    assert.equal(r.status, 200)
  }
  // two the same day: the later one counts
  await S.museCheckIn(snap('muse-instagram', { followers: 1095 }), now + 1000)
  const p = (await S.readSocial(now + 2000)).platforms.instagram
  assert.equal(p.metrics.followers, 1095)
  assert.equal(p.since, '2026-11-16')
  assert.equal(p.change7.followers, 1095 - 1020)
  assert.equal(p.change7.reach_24h, undefined, 'missing metric has no change')
  assert.equal(p.followers.length, 10)
  assert.equal(p.followers.at(-1).n, 1095)
  // and it reaches the reach answer
  const reach = await S.readReach(now + 2000)
  assert.equal(reach.social.platforms.instagram.metrics.followers, 1095)
})

/* ---------- staleness ---------- */

test('no Muse check-in of either kind for 26 hours turns the light late', async () => {
  const HOUR = 3600000
  const t0 = Date.parse('2026-11-20T23:00:00Z')
  await S.museCheckIn(snap('muse-facebook', { followers: 50 }), t0)
  assert.equal((await jobOf('muse-facebook', t0 + 25 * HOUR)).status, 'ok')
  assert.equal((await jobOf('muse-facebook', t0 + 27 * HOUR)).status, 'late')
  const j = await jobOf('muse-facebook', t0 + 27 * HOUR)
  assert.equal(j.next, null, 'no cron, no next run')
})

test('before Muse ever checks in, its lights wait (not red)', async () => {
  const feed = await S.readJobs()
  for (const id of S.MUSE_JOBS) assert.equal(feed.jobs.find((j) => j.id === id).status, 'waiting')
  assert.equal(feed.counts.failed || 0, 0)
})

/* ---------- the map ---------- */

test('the map and timeline show all three Muse lights', async () => {
  const D = await import('../../public/control/draw.js')
  for (const id of S.MUSE_JOBS) {
    assert.ok(D.MAP_JOB_IDS.includes(id), `${id} on the map`)
    assert.ok(D.TIMELINE_ORDER.includes(id), `${id} on the timeline`)
    assert.ok(D.lanePath(`reach:${id}`), `${id} has a wire`)
  }
  // every job in the feed has a light (a job left off the map once hid a red light)
  for (const j of S.JOBS) assert.ok(D.TIMELINE_ORDER.includes(j.id), `${j.id} on the timeline`)
  await call({ auth: MUSE, body: post('muse-instagram') })
  await call({ auth: MUSE, body: snap('muse-instagram', { followers: 1240 }) })
  const feed = await S.readJobs()
  const reach = { social: await S.readSocial() }
  const svg = D.drawMap(feed, reach, [], Date.now(), null)
  assert.match(svg, /data-id="muse-instagram"/)
  assert.match(svg, /1,240 followers/)
  assert.match(svg, /posted just now/)
  assert.match(svg, /POSTED BY MUSE/)
  // nothing overlaps in the reach column
  const boxes = [...D.REACH, ...D.SOCIAL].sort((a, b) => a.y - b.y)
  for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].y >= boxes[i - 1].y + boxes[i - 1].h, `${boxes[i].id} overlaps ${boxes[i - 1].id}`)
  assert.ok(boxes.at(-1).y + boxes.at(-1).h < 740, 'clear of the checks band')
})

test('GM Savant\'s four jobs share one box: worst light, wires for the refresh, a card that lists all four', async () => {
  const D = await import('../../public/control/draw.js')
  const four = ['gm-savant', 'gm-mac-pull', 'gm-savant-freshness', 'gm-savant-refit']
  assert.deepEqual(D.GROUPS['gm-group'], four)
  for (const id of four) {
    assert.ok(S.JOBS.some((j) => j.id === id), `${id} is a feed job`)
    assert.ok(D.MAP_JOB_IDS.includes(id), `${id} lights the map`)
    assert.equal(D.boxOf(id), 'gm-group')
  }
  assert.ok(D.lanePath('in:gm-savant') && D.lanePath('out:gm-savant'), 'the refresh travels the wires')
  // nothing overlaps in the engines column, and it stays inside its group box and above the checks band
  const eng = [...D.ENGINES].sort((a, b) => a.y - b.y)
  for (let i = 1; i < eng.length; i++) assert.ok(eng[i].y >= eng[i - 1].y + eng[i - 1].h, `${eng[i].id} overlaps ${eng[i - 1].id}`)
  assert.ok(eng.at(-1).y + eng.at(-1).h < Math.min(...D.WATCHERS.map((w) => w.y)) - 40, 'engines clear the checks band')
  assert.ok(Math.max(...D.WATCHERS.map((w) => w.y + w.h)) < D.MAP_H - 30, 'checks clear the legend')
  const job = (id, status) => ({ id, name: id, lane: 'github', status, last: null, next: null, since: null })
  const feed = { now: Date.now(), jobs: [job('gm-savant', 'ok'), job('gm-mac-pull', 'failed'), job('gm-savant-freshness', 'ok'), job('gm-savant-refit', 'late')], events: [], upcoming: [], deploys: {}, counts: {} }
  const jobs = new Map(feed.jobs.map((j) => [j.id, j]))
  assert.equal(D.groupStatus('gm-group', jobs), 'failed')
  const svg = D.drawMap(feed, null, [], feed.now, null)
  assert.match(svg, /data-id="gm-group"/)
  assert.match(svg, />GM Savant</)
  assert.match(svg, /1 of 4 jobs red/)
  jobs.get('gm-mac-pull').status = 'ok'
  assert.equal(D.groupStatus('gm-group', jobs), 'late')
  assert.match(D.drawMap({ ...feed, jobs: [...jobs.values()] }, null, [], feed.now, null), /1 of 4 jobs late/)
  for (const id of four) assert.doesNotMatch(svg, new RegExp(`data-id="${id}"`), `${id} has no box of its own`)
})
