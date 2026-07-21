// api/trending.js — "trending players/prospects" by recent search volume, backed by Upstash
// Redis (the same Vercel KV as api/leaderboard.js). Until KV is configured it returns
// { configured: false, ids: [] } and the page falls back to its built-in ranking, so the home
// screen always has something to show.
//
//   POST { id, ns }  -> ZINCRBY today's sorted set for that id (records one search)
//   GET  ?ns=        -> most-searched ids over the last 7 days, recency-weighted, + momentum
//
// ns namespaces the two savants: 'bs' (Basketball Savant, numeric ids) and 'dr' (Draft Savant,
// slug ids). Storage: one sorted set per UTC day, <ns>:trend:<YYYYMMDD>, member = id, score =
// count. Keys expire after 12 days. GET unions the last 7 days (recency-weighted) for ranking
// and compares a recent vs prior window for the up/down (fire/ice) momentum.

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

const DAYS = 7
const TOP = 12
const ID_RE = /^[A-Za-z0-9_.-]{1,48}$/          // numeric NBA ids and draft slugs both fit

function nsOf(v) { return v === 'dr' ? 'dr' : 'bs' }   // whitelist; default basketball savant

async function redis(cmd) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) throw new Error('redis ' + r.status)
  return (await r.json()).result
}

// UTC day keys for a namespace, newest first
function dayKeys(n, ns) {
  const keys = []
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    const d = new Date(now - i * 86400000)
    const stamp = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
    keys.push(ns + ':trend:' + stamp)
  }
  return keys
}

export default async function handler(req, res) {
  if (!URL || !TOKEN) { res.status(200).json({ configured: false, ids: [] }); return }

  try {
    if (req.method === 'POST') {
      const b = req.body || {}
      const ns = nsOf(String(b.ns || 'bs'))
      const id = String(b.id == null ? '' : b.id).trim()
      if (!ID_RE.test(id)) { res.status(400).json({ error: 'bad id' }); return }
      const key = dayKeys(1, ns)[0]
      await redis(['ZINCRBY', key, 1, id])
      await redis(['EXPIRE', key, 12 * 86400])
      res.status(200).json({ ok: true }); return
    }

    if (req.method === 'GET') {
      const ns = nsOf(String(req.query.ns || 'bs'))
      const keys = dayKeys(DAYS, ns)                          // day0 (today) .. day6
      const dest = ns + ':trend:u' + DAYS
      const weights = keys.map((_, i) => DAYS - i)            // today heaviest -> ranking
      await redis(['ZUNIONSTORE', dest, keys.length, ...keys, 'WEIGHTS', ...weights])
      await redis(['EXPIRE', dest, 300])
      const flat = (await redis(['ZREVRANGE', dest, 0, TOP - 1, 'WITHSCORES'])) || []
      const top = []
      for (let i = 0; i + 1 < flat.length; i += 2) {
        if (ID_RE.test(String(flat[i]))) top.push({ id: String(flat[i]), score: Number(flat[i + 1]) || 0 })
      }

      // Momentum: recent (last 3 days) vs prior (days 3-6), per-day averages.
      if (top.length) {
        const rKeys = keys.slice(0, 3), pKeys = keys.slice(3, 7)
        const rDest = ns + ':trend:r3', pDest = ns + ':trend:p4'
        await redis(['ZUNIONSTORE', rDest, rKeys.length, ...rKeys])
        await redis(['ZUNIONSTORE', pDest, pKeys.length, ...pKeys])
        await redis(['EXPIRE', rDest, 300]); await redis(['EXPIRE', pDest, 300])
        const ids = top.map((t) => t.id)
        const rS = (await redis(['ZMSCORE', rDest, ...ids])) || []
        const pS = (await redis(['ZMSCORE', pDest, ...ids])) || []
        top.forEach((t, i) => {
          const rawR = Number(rS[i]) || 0, rawP = Number(pS[i]) || 0
          let trend = 'flat'
          if (rawR + rawP >= 2) {
            const r = rawR / rKeys.length, p = rawP / pKeys.length
            if (p <= 0 && r > 0) trend = 'up'
            else { const ratio = r / (p || 1e-9); trend = ratio >= 1.3 ? 'up' : ratio <= 0.7 ? 'down' : 'flat' }
          }
          t.trend = trend
        })
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
