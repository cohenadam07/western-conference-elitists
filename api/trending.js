// api/trending.js — "trending players" by recent search volume, backed by Upstash Redis
// (the same Vercel KV as api/leaderboard.js). Until KV is configured it returns
// { configured: false, ids: [] } and the Basketball Savant page falls back to its built-in
// trend score, so the home screen always has trending players.
//
//   POST { id }  -> ZINCRBY today's sorted set for that player id (records one search)
//   GET          -> most-searched player ids over the last 7 days, recency-weighted
//
// Storage: one sorted set per UTC day, bs:trend:<YYYYMMDD>, member = player id, score = count.
// Keys expire after 12 days. GET unions the last 7 days with decreasing weights into a short-
// lived key and reads the top members.

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

const DAYS = 7
const TOP = 12

async function redis(cmd) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) throw new Error('redis ' + r.status)
  return (await r.json()).result
}

// UTC day keys, newest first
function dayKeys(n) {
  const keys = []
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    const d = new Date(now - i * 86400000)
    const stamp = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
    keys.push('bs:trend:' + stamp)
  }
  return keys
}

export default async function handler(req, res) {
  if (!URL || !TOKEN) { res.status(200).json({ configured: false, ids: [] }); return }

  try {
    if (req.method === 'POST') {
      const id = parseInt((req.body || {}).id, 10)
      if (!Number.isInteger(id) || id <= 0 || id > 99999999) {
        res.status(400).json({ error: 'bad id' }); return
      }
      const key = dayKeys(1)[0]
      await redis(['ZINCRBY', key, 1, String(id)])
      await redis(['EXPIRE', key, 12 * 86400])
      res.status(200).json({ ok: true }); return
    }

    if (req.method === 'GET') {
      const keys = dayKeys(DAYS)
      const dest = 'bs:trend:u' + DAYS
      const weights = keys.map((_, i) => DAYS - i)            // today heaviest
      await redis(['ZUNIONSTORE', dest, keys.length, ...keys, 'WEIGHTS', ...weights])
      await redis(['EXPIRE', dest, 300])
      const flat = (await redis(['ZREVRANGE', dest, 0, TOP - 1, 'WITHSCORES'])) || []
      const top = []
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const id = parseInt(flat[i], 10)
        if (Number.isInteger(id)) top.push({ id, score: Number(flat[i + 1]) || 0 })
      }
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
      res.status(200).json({ configured: true, ids: top.map((t) => t.id), top })
      return
    }

    res.status(405).json({ error: 'method not allowed' })
  } catch {
    res.status(200).json({ configured: false, ids: [] })     // fail soft -> page uses its fallback
  }
}
