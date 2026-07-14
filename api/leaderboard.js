// Comp Chain daily leaderboard — Vercel serverless function backed by Upstash Redis
// (Vercel KV). Enable "Upstash for Redis" in the Vercel dashboard; it injects
// KV_REST_API_URL + KV_REST_API_TOKEN. Until then this degrades gracefully
// (returns { configured: false }) and the UI hides the board.
//
// Storage: one hash per day, cc:lb:<day>, field = lowercased name -> JSON entry
// { name, moves, hints, ts }. Only a player's best (fewest moves, then hints) is
// kept. Keys expire after 4 days. Scores are self-reported — this is a fun board,
// not a ranked ladder — but inputs are validated and clamped.

import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

// Explicit-name filter. obscenity catches embedded/obfuscated profanity
// ("fuckface", "sh1thead", "n1gger") while its dataset avoids false positives
// ("Hitchcock", "Scunthorpe", "assassin"). A second pass on the separator-stripped
// name also catches spaced/dotted evasions ("f u c k", "f.u.c.k").
const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })
const isBadName = (name) => {
  try {
    const s = String(name)
    return matcher.hasMatch(s) || matcher.hasMatch(s.replace(/[^a-zA-Z0-9]/g, ''))
  } catch { return false }
}

async function redis(cmd) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) throw new Error('redis ' + r.status)
  return (await r.json()).result
}

function readBoard(flat) {
  const entries = []
  for (let i = 0; i + 1 < (flat || []).length; i += 2) {
    try { entries.push(JSON.parse(flat[i + 1])) } catch { /* skip */ }
  }
  entries.sort((a, b) => a.moves - b.moves || a.hints - b.hints || a.ts - b.ts)
  return entries
}

function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const d = new Date(day + 'T00:00:00Z').getTime()
  if (isNaN(d)) return false
  const now = Date.now()
  return d >= now - 3 * 86400000 && d <= now + 2 * 86400000   // within a few days of server time
}

export default async function handler(req, res) {
  if (!URL || !TOKEN) { res.status(200).json({ configured: false, entries: [] }); return }

  try {
    if (req.method === 'GET') {
      const day = String(req.query.day || '')
      if (!validDay(day)) { res.status(400).json({ error: 'bad day' }); return }
      const entries = readBoard(await redis(['HGETALL', 'cc:lb:' + day]))
      res.status(200).json({ configured: true, count: entries.length, entries: entries.slice(0, 25) })
      return
    }

    if (req.method === 'POST') {
      const b = req.body || {}
      const day = String(b.day || '')
      if (!validDay(day)) { res.status(400).json({ error: 'bad day' }); return }
      let name = String(b.name || '').replace(/[^\w \-.'#!]/g, '').trim().slice(0, 18)
      if (!name) name = 'Anonymous'
      if (isBadName(name)) { res.status(400).json({ error: 'name', reason: 'inappropriate' }); return }
      const moves = Math.max(1, Math.min(40, parseInt(b.moves, 10) || 0))
      const hints = Math.max(0, Math.min(30, parseInt(b.hints, 10) || 0))
      const key = 'cc:lb:' + day
      const field = name.toLowerCase()

      let prev = null
      try { const p = await redis(['HGET', key, field]); prev = p ? JSON.parse(p) : null } catch { /* none */ }
      const better = !prev || moves < prev.moves || (moves === prev.moves && hints < prev.hints)
      if (better) {
        await redis(['HSET', key, field, JSON.stringify({ name, moves, hints, ts: Date.now() })])
        await redis(['EXPIRE', key, 4 * 86400])
      }
      const entries = readBoard(await redis(['HGETALL', key]))
      const rank = entries.findIndex((e) => e.name.toLowerCase() === field) + 1
      res.status(200).json({ configured: true, ok: true, better, rank, count: entries.length, entries: entries.slice(0, 25) })
      return
    }

    res.status(405).json({ error: 'method not allowed' })
  } catch {
    res.status(500).json({ error: 'leaderboard unavailable' })
  }
}
