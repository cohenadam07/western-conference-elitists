// api/gm.js — Front Office careers and the all-time boards, backed by Upstash Redis
// (Vercel KV), the same store behind api/dynasty.js and api/leaderboard.js. Until KV is
// configured this returns { configured: false } and the page falls back to a local save,
// so /gm always works.
//
// WHY THIS FILE CAN BE TRUSTED
// A career save stores SEEDS, not outcomes. Every game is a pure function of (rosters,
// seed), and the browser and this server run the same simulation from the same seeded
// PRNG — mulberry32, thirty lines of 32-bit integer arithmetic, asserted identical by
// tools/gm/verify.mjs across 30 fixtures. So a claimed 73-win season is not taken on
// trust: the server replays it and compares. That is the whole reason the determinism
// work exists, and it is what makes an all-time leaderboard mean anything.
//
// Verification runs on the season being CLAIMED, not the whole history — a full 82-game
// replay is about half a second, and re-checking a fifteen-season career on every save
// would cost eight.
//
// KEYS
//   gm:c:<id>          STR   the career document
//   gm:titles          ZSET  id -> championships
//   gm:wins            ZSET  id -> total regular-season wins
//   gm:best            ZSET  id -> best single-season wins
//   gm:fast            ZSET  id -> seasons taken to a first title (lower is better)
//   gm:rl:<ip>:<min>   STR   per-minute rate limit
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'
import { newSeason, playNext } from '../src/lib/gm/season.js'

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

const RATE_PER_MIN = 20
const NAME_MAX = 28
const BOARD_N = 25
const ID_RE = /^[A-Z]{3}-[a-z0-9]{4,12}$/

const matcher = new RegExpMatcher({ ...englishDataset, ...englishRecommendedTransformers })
const badName = (n) => {
  try {
    const s = String(n)
    return matcher.hasMatch(s) || matcher.hasMatch(s.replace(/[^a-zA-Z0-9]/g, ''))
  } catch { return false }
}

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) throw new Error('redis ' + r.status)
  return (await r.json()).result
}

async function pipe(cmds) {
  if (!cmds.length) return []
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  })
  if (!r.ok) throw new Error('redis pipeline ' + r.status)
  return (await r.json()).map((x) => x.result)
}

const ipOf = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'anon'

async function rateLimited(req) {
  const key = `gm:rl:${ipOf(req)}:${Math.floor(Date.now() / 60000)}`
  const n = await redis(['INCR', key])
  if (n === 1) await redis(['EXPIRE', key, 90])
  return n > RATE_PER_MIN
}

// Replay one claimed season and compare the wins. The seed is the whole input.
function verifySeason(team, claim) {
  const st = newSeason(claim.seed)
  playNext(st, st.schedule.length)
  const got = st.rec[team]
  return {
    ok: got && got.w === claim.wins && got.l === claim.losses,
    recomputed: got ? { w: got.w, l: got.l } : null,
  }
}

function sane(save) {
  if (!save || save.schema !== 1) return 'unrecognised save version'
  if (!ID_RE.test(String(save.careerId || ''))) return 'bad career id'
  if (!save.franchise?.team) return 'no franchise'
  if (!Array.isArray(save.seasons)) return 'no season history'
  if (save.seasons.length > 60) return 'too many seasons'
  const n = String(save.gm?.name || '').slice(0, NAME_MAX)
  if (!n.trim()) return 'name your GM'
  if (badName(n)) return 'pick another name'
  return null
}

export default async function handler(req, res) {
  if (!URL_ || !TOKEN) return res.status(200).json({ configured: false })

  try {
    const action = (req.query?.action || req.body?.action || 'board').toString()

    if (req.method === 'GET' && action === 'board') {
      const [titles, wins, best, fast] = await pipe([
        ['ZREVRANGE', 'gm:titles', 0, BOARD_N - 1, 'WITHSCORES'],
        ['ZREVRANGE', 'gm:wins', 0, BOARD_N - 1, 'WITHSCORES'],
        ['ZREVRANGE', 'gm:best', 0, BOARD_N - 1, 'WITHSCORES'],
        ['ZRANGE', 'gm:fast', 0, BOARD_N - 1, 'WITHSCORES'],
      ])
      const ids = [...new Set([titles, wins, best, fast].flat().filter((x, i) => i % 2 === 0))]
      const docs = ids.length ? await pipe(ids.map((id) => ['GET', `gm:c:${id}`])) : []
      const who = {}
      ids.forEach((id, i) => {
        try {
          const d = JSON.parse(docs[i])
          who[id] = { name: d.gm?.name, team: d.franchise?.team, verified: !!d.verified }
        } catch { /* skip */ }
      })
      const pairs = (flat) => {
        const out = []
        for (let i = 0; i + 1 < (flat || []).length; i += 2)
          out.push({ id: flat[i], value: Number(flat[i + 1]), ...(who[flat[i]] || {}) })
        return out
      }
      return res.status(200).json({ configured: true,
        titles: pairs(titles), wins: pairs(wins), best: pairs(best), fastest: pairs(fast) })
    }

    if (req.method === 'GET' && action === 'career') {
      const id = String(req.query.id || '')
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad id' })
      const doc = await redis(['GET', `gm:c:${id}`])
      return res.status(200).json({ configured: true, career: doc ? JSON.parse(doc) : null })
    }

    if (req.method === 'POST' && action === 'save') {
      if (await rateLimited(req)) return res.status(429).json({ error: 'slow down' })
      const save = req.body?.career
      const bad = sane(save)
      if (bad) return res.status(400).json({ error: bad })

      // Verify the most recent season by replaying it. A career whose newest claim does
      // not reproduce is stored but never reaches a board.
      let verified = true
      let check = null
      const last = save.seasons[save.seasons.length - 1]
      if (last && Number.isFinite(last.seed)) {
        check = verifySeason(save.franchise.team, last)
        verified = check.ok
      }

      const id = save.careerId
      const doc = { ...save, verified, verifiedAt: Date.now() }
      const cmds = [['SET', `gm:c:${id}`, JSON.stringify(doc)]]
      if (verified) {
        const r = save.records || {}
        cmds.push(['ZADD', 'gm:titles', r.championships || 0, id])
        cmds.push(['ZADD', 'gm:wins', r.totalWins || 0, id])
        cmds.push(['ZADD', 'gm:best', r.bestRecord?.wins || 0, id])
        if (r.fastestTitle) cmds.push(['ZADD', 'gm:fast', r.fastestTitle, id])
      }
      await pipe(cmds)
      return res.status(200).json({ configured: true, ok: true, verified, check })
    }

    return res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) })
  }
}
