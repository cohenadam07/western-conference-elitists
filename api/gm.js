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
import { runPlayoffs } from '../src/lib/gm/playoffs.js'
import { setLeague } from '../src/lib/gm/league.js'
import { CBA } from '../src/lib/gm/cap.js'
import { ACCEPTED_VERSIONS } from '../src/lib/gm/schema.js'

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

const RATE_PER_MIN = 20
const NAME_MAX = 28
const BOARD_N = 25
const ID_RE = /^[A-Z]{3}-[a-z0-9]{4,12}$/

// englishDataset is a builder, not a payload. Spreading it hands RegExpMatcher an
// object whose `terms` is not iterable, and the module throws on import — which means
// this whole endpoint was dead on arrival, not merely wrong: every request to /api/gm
// failed before a line of it ran. It needs .build().
const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })
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

// Replay one claimed season — the regular season AND the postseason — and report what
// actually happened. The seed is the whole input: runPlayoffs derives the play-in, the
// bracket and every series from state.seed, so a title is as reproducible as a win total.
//
// This used to compare wins and losses only, which left the headline board unguarded:
// gm:titles was ranked on save.records.championships, a number the client simply
// asserted. Verifying a season and ranking a different quantity is not verification.
export function replaySeason(team, claim, league) {
  // THE MISSING INPUT.
  //
  // A season is a function of (seed, the league that played it). The server used to get
  // only the seed and replay against the default rosters, so verification held for
  // exactly one kind of career: one that never made a trade. Measured: an untouched
  // OKC reproduced 55-27, and the same seed after moving a single player claimed 56-26
  // while the server still computed 55-27. Every real career failed, silently, and
  // therefore never reached a board.
  //
  // The claim now carries the roster state that played the season, and the caller has
  // already checked that state is a legal league.
  setLeague(league)
  const st = newSeason(claim.seed)
  playNext(st, st.schedule.length)
  const got = st.rec[team]
  if (!got) return { ok: false, why: 'team not in the replayed league' }
  if (got.w !== claim.wins || got.l !== claim.losses) {
    return { ok: false, why: 'record does not reproduce',
      claimed: { w: claim.wins, l: claim.losses }, recomputed: { w: got.w, l: got.l } }
  }
  let run = { seriesWon: 0, confTitle: false, champion: false }
  try {
    const po = runPlayoffs(st)
    run = {
      seriesWon: (po.rounds || []).filter((r) => r.winner === team).length,
      confTitle: !!(po.rounds || []).some((r) => r.name === 'Conference final' && r.winner === team),
      champion: po.champion === team,
    }
  } catch (e) {
    return { ok: false, why: 'postseason did not replay: ' + String(e.message || e) }
  }
  return { ok: true, wins: got.w, losses: got.l, ...run }
}

// What the server has proven for itself, built only from seasons it replayed. Nothing
// the client asserts ever reaches a board.
export function emptyTally() {
  return { through: 0, wins: 0, losses: 0, titles: 0, confTitles: 0,
    seriesWon: 0, best: 0, fastestTitle: null }
}

// IS THIS A LEAGUE, OR A WISH.
//
// Accepting the roster state from the client closes the "I invented a win total" hole
// and opens a smaller one: "I gave myself five Jokićs". These are the cheap, certain
// checks — every man in exactly one place, rosters the size rosters are, no contract
// above what the CBA allows. It does not prove the league is the one the career
// actually arrived at; it proves nobody handed themselves an impossible one.
const ROSTER_MIN = 8
const ROSTER_MAX = 21

export function leagueIsLegal(league) {
  if (!league || typeof league !== 'object') return { ok: false, why: 'no roster state sent' }
  const sim = league.sim
  const caps = league.rosters
  if (!sim || !caps) return { ok: false, why: 'roster state is not a league' }
  const teams = Object.keys(sim)
  if (teams.length !== 30) return { ok: false, why: `league has ${teams.length} clubs, not 30` }
  const seen = new Set()
  const maxDeal = (CBA?.max || CBA?.cap || 60e6) * 1.5
  for (const t of teams) {
    const r = sim[t]
    const c = caps[t]
    if (!Array.isArray(r) || !Array.isArray(c)) return { ok: false, why: `${t} has no roster` }
    if (c.length < ROSTER_MIN || c.length > ROSTER_MAX) {
      return { ok: false, why: `${t} carries ${c.length} players` }
    }
    for (const p of c) {
      const id = String(p.uid || `${t}:${p.n}`)
      if (seen.has(id)) return { ok: false, why: `${p.n} appears on more than one roster` }
      seen.add(id)
      if (Number.isFinite(p.s) && p.s > maxDeal) {
        return { ok: false, why: `${p.n} is on an impossible contract` }
      }
    }
  }
  return { ok: true, players: seen.size }
}

// One season per save, at the moment it completes — that is when the client still holds
// the roster state that played it, and it is the only time it sends it. The server keeps
// its own running tally and advances it strictly in order; a season that never arrives
// leaves a gap, and the tally stops there rather than quietly skipping it. `pending` is
// how far behind the board is, and it is reported rather than hidden.
export function verifyNewest(team, seasons, kickoff, prev) {
  const t = { ...emptyTally(), ...(prev || {}) }
  const idx = (seasons?.length || 0) - 1
  const pendingOf = (tt) => Math.max(0, (seasons?.length || 0) - tt.through)
  if (idx < 0) return { tally: t, verified: false, why: 'no seasons yet', pending: 0 }
  if (t.through > idx) return { tally: t, verified: true, why: 'already counted', pending: 0 }
  if (t.through !== idx) {
    return { tally: t, verified: false, pending: pendingOf(t),
      why: `verified through season ${t.through} of ${seasons.length}; the ones between never arrived` }
  }
  const legal = leagueIsLegal(kickoff)
  if (!legal.ok) return { tally: t, verified: false, pending: pendingOf(t), why: legal.why }
  const claim = seasons[idx]
  if (!claim || !Number.isFinite(claim.seed)) {
    return { tally: t, verified: false, pending: pendingOf(t), why: 'season has no seed' }
  }
  const r = replaySeason(team, claim, kickoff)
  if (!r.ok) return { tally: t, verified: false, pending: pendingOf(t), why: r.why, detail: r }

  t.through = idx + 1
  t.wins += r.wins
  t.losses += r.losses
  t.seriesWon += r.seriesWon
  if (r.confTitle) t.confTitles += 1
  if (r.champion) {
    t.titles += 1
    if (t.fastestTitle === null || t.through < t.fastestTitle) t.fastestTitle = t.through
  }
  if (r.wins > t.best) t.best = r.wins
  return { tally: t, verified: true, pending: pendingOf(t), why: null }
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

      const id = save.careerId
      const team = save.franchise.team

      // Carry forward what the server has already proven for this career, so a save only
      // ever replays the seasons it has not seen. The previous tally is read from the
      // server's own copy — never from the incoming body, which the client controls.
      let prev = null
      try {
        const existing = await redis(['GET', `gm:c:${id}`])
        if (existing) {
          const old = JSON.parse(existing)
          // A tally only carries forward for the same franchise. Switch clubs under the
          // same id and it starts again rather than inheriting someone else's wins.
          if (old?.tally && old.franchise?.team === team) prev = old.tally
        }
      } catch { prev = null }

      const kickoff = req.body?.kickoff || null
      const { tally, verified, pending, why } = verifyNewest(team, save.seasons, kickoff, prev)
      const failure = verified ? null : { why }

      // The document keeps the client's own history for display, but the score written to
      // every board comes from the tally the server built by replaying. A career can post
      // whatever records it likes; nothing reads them here.
      const doc = { ...save, tally, verified, pending,
        failure: failure || null, verifiedAt: Date.now() }
      const cmds = [['SET', `gm:c:${id}`, JSON.stringify(doc)]]
      if (tally.through > 0 && !failure) {
        cmds.push(['ZADD', 'gm:titles', tally.titles, id])
        cmds.push(['ZADD', 'gm:wins', tally.wins, id])
        cmds.push(['ZADD', 'gm:best', tally.best, id])
        if (tally.fastestTitle) cmds.push(['ZADD', 'gm:fast', tally.fastestTitle, id])
      }
      await pipe(cmds)
      return res.status(200).json({ configured: true, ok: true, verified,
        pending, tally, failure })
    }

    return res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) })
  }
}
