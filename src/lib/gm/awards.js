// THE AWARDS.
//
// Voted off what actually happened, never off the ratings a player started the year with.
// That distinction is the whole point: a season where the MVP is simply whoever had the
// highest VORP in October is not a season, it is a lookup, and it would make the simulation
// decorative. Everything here reads the box scores the possession engine produced.
//
// Where the real voting is known to be biased, that bias is reproduced rather than
// corrected, because the award is a story about the season and not a measurement:
//   - MVP goes to production ON A GOOD TEAM. Fifty-win teams win it; thirty-win teams do
//     not, whatever the numbers say.
//   - Defensive Player of the Year is a big man's award far more often than it should be.
//   - Most Improved rewards the size of the jump, which favours players who were nobody.
//   - Sixth Man requires actually coming off the bench.
import { SEED } from './seed.js'
import { rostersOf, simOf } from './league.js'

const TEAMS = () => Object.keys(SEED.teams)
const per = (v, g) => (g > 0 ? v / g : 0)

// Season totals per player, from the games that were played. `results` alone does not carry
// box scores, so the season keeps a running tally instead — this reads that.
export function seasonStats(state) {
  return state.stats || {}
}

// Everything the voters look at, in one row per player.
export function ballotRows(state) {
  const stats = seasonStats(state)
  const rows = []
  for (const team of TEAMS()) {
    const rec = state.rec[team] || { w: 0, l: 0 }
    const played = rec.w + rec.l
    const winPct = played ? rec.w / played : 0
    const sims = simOf(team)
    for (const cap of rostersOf(team)) {
      const sim = sims.find((x) => x.n === cap.n)
      const st = stats[sim?.id] || stats[cap.n]
      if (!st || !st.g) continue
      const g = st.g
      rows.push({
        name: cap.n, team, id: sim?.id || cap.n, cap, sim,
        g,
        mpg: per(st.min, g),
        pts: per(st.pts, g),
        reb: per(st.reb, g),
        ast: per(st.ast, g),
        stl: per(st.stl, g),
        blk: per(st.blk, g),
        tov: per(st.tov, g),
        fgm: st.fgm, fga: st.fga,
        ts: st.fga ? st.pts / (2 * (st.fga + 0.44 * (st.fta || 0))) : 0,
        started: st.started || 0,
        winPct,
        wins: rec.w,
        age: cap.a ?? 26,
        // A rookie is a man in his first season, and nothing else. The age fallback that
        // used to stand in for this put Cooper Flagg and Ace Bailey — both a year into their
        // careers — on the Rookie of the Year ballot, because they are still twenty.
        rookie: !!cap.rookie || !!cap.rookieYear || cap.exp === 0,
        big: (cap.sz ?? 50) >= 58 || /C|PF/.test(cap.pos || ''),
        rimprot: cap.rp ?? 50,
        poa: cap.pd ?? 50,
      })
    }
  }
  return rows
}

// A share of the vote, from a score. The top man rarely runs away with it, so the shares
// are softened rather than winner-take-all.
function ballot(rows, score, n = 5) {
  const scored = rows.map((r) => ({ ...r, score: score(r) })).filter((r) => Number.isFinite(r.score))
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, n)
  const floor = top.length ? Math.min(...top.map((x) => x.score)) : 0
  const tot = top.reduce((s, x) => s + Math.max(0.001, x.score - floor * 0.86), 0) || 1
  return top.map((x) => ({ ...x, share: Math.max(0.001, x.score - floor * 0.86) / tot }))
}

// A game-count floor, because the real awards have one and because a man who played nine
// games and averaged thirty should not be Most Valuable anything.
const ELIGIBLE = (r, frac = 0.6) => r.g >= Math.max(8, Math.round((r.gamesInSeason || 82) * frac))

export function vote(state, opts = {}) {
  const all = ballotRows(state)
  const gamesPlayed = Math.max(...TEAMS().map((t) => (state.rec[t]?.w || 0) + (state.rec[t]?.l || 0)), 1)
  const rows = all.map((r) => ({ ...r, gamesInSeason: gamesPlayed }))
  const eligible = rows.filter((r) => ELIGIBLE(r))
  const pool = eligible.length >= 12 ? eligible : rows

  // MVP: production, and the team's record. The record term is deliberately heavy — this is
  // how the award is actually voted, not how it ought to be.
  const mvp = ballot(pool, (r) => (
    (r.pts * 1.0 + r.reb * 0.62 + r.ast * 1.05 + r.stl * 1.6 + r.blk * 1.3 - r.tov * 1.1)
    * (0.55 + r.winPct * 0.95)
    * (0.85 + Math.min(1, r.mpg / 32) * 0.15)
  ))

  // DPOY: stops, rim protection, and a thumb firmly on the scale for size.
  const dpoy = ballot(pool, (r) => (
    (r.blk * 3.4 + r.stl * 2.6 + r.reb * 0.35)
    * (0.6 + r.winPct * 0.8)
    * (r.big ? 1.22 : 1)
    + r.rimprot * 0.035 + r.poa * 0.02
  ))

  const rookies = rows.filter((r) => r.rookie)
  const roy = ballot(rookies.length ? rookies : [], (r) => (
    r.pts * 1.0 + r.reb * 0.6 + r.ast * 0.9 + r.stl * 1.4 + r.blk * 1.2 - r.tov * 0.8
  ))

  // Sixth Man: has to have come off the bench in most of his games AND actually be a bench
  // player. The start count alone is not enough — a star on a short rotation can trail his
  // own team-mates in the engine's minutes order without being anybody's sixth man — so the
  // award also asks that he play bench minutes, which is what the word means.
  const bench = pool.filter((r) => r.started < r.g * 0.35 && r.mpg <= 30)
  const smoy = ballot(bench, (r) => r.pts * 1.15 + r.ast * 0.9 + r.reb * 0.5)

  // Most Improved: the size of the jump against what he was, which is why it so often goes
  // to somebody nobody had heard of.
  const mip = ballot(pool.filter((r) => (r.cap.v ?? 0) > 0.2), (r) => {
    const was = (r.cap.mpg ?? 12)
    const jump = r.mpg - was
    return jump * 0.9 + (r.pts - (r.cap.v ?? 0) * 4) * 0.5
  })

  // All-NBA and All-Defensive: three teams of five, taken in order off the same scores, and
  // positionally balanced the way the ballots used to be — two guards, two forwards, a
  // centre — because five centres is not a team.
  const allNba = teams(pool, (r) => (
    (r.pts + r.reb * 0.7 + r.ast * 1.1 + r.stl * 1.7 + r.blk * 1.4 - r.tov)
    * (0.7 + r.winPct * 0.6)), 3)
  const allDef = teams(pool, (r) => (
    r.blk * 3.2 + r.stl * 2.8 + r.reb * 0.3 + r.rimprot * 0.03 + r.poa * 0.03), 2)
  const allRookie = teams(rookies, (r) => r.pts + r.reb * 0.6 + r.ast * 0.9, 2, false)

  return {
    mvp, dpoy, roy, smoy, mip,
    allNba, allDef, allRookie,
    // A flat list, which is what the screen and the record book both want.
    list: [
      { key: 'mvp', name: 'Most Valuable Player', winner: mvp[0], ballot: mvp },
      { key: 'dpoy', name: 'Defensive Player of the Year', winner: dpoy[0], ballot: dpoy },
      { key: 'roy', name: 'Rookie of the Year', winner: roy[0], ballot: roy },
      { key: 'smoy', name: 'Sixth Man of the Year', winner: smoy[0], ballot: smoy },
      { key: 'mip', name: 'Most Improved Player', winner: mip[0], ballot: mip },
    ].filter((a) => a.winner),
  }
}

const SLOT = (r) => (/C/.test(r.cap.pos || '') ? 'C'
  : /G/.test(r.cap.pos || '') ? 'G' : 'F')

// Teams of five, positionally balanced: two guards, two forwards, one centre.
function teams(rows, score, count, balanced = true) {
  const scored = rows.map((r) => ({ ...r, score: score(r) }))
    .filter((r) => Number.isFinite(r.score))
    .sort((a, b) => b.score - a.score)
  const out = []
  const used = new Set()
  for (let t = 0; t < count; t++) {
    const need = balanced ? { G: 2, F: 2, C: 1 } : { G: 5, F: 5, C: 5 }
    const team = []
    for (const r of scored) {
      if (used.has(r.id)) continue
      if (team.length >= 5) break
      const slot = SLOT(r)
      if (balanced && need[slot] <= 0) continue
      need[slot] -= 1
      used.add(r.id)
      team.push(r)
    }
    // A thin league (or a short season) can leave a team unfilled; take the best available
    // rather than shipping a team of three.
    if (team.length < 5) {
      for (const r of scored) {
        if (team.length >= 5) break
        if (used.has(r.id)) continue
        used.add(r.id); team.push(r)
      }
    }
    if (team.length) out.push(team)
  }
  return out
}

// Which of these are yours, and how big a deal it is.
export function yours(awards, team) {
  const hits = []
  for (const a of awards.list) {
    if (a.winner?.team === team) hits.push({ kind: 'award', key: a.key, name: a.name, who: a.winner.name })
  }
  awards.allNba.forEach((tm, i) => tm.filter((r) => r.team === team).forEach((r) => {
    hits.push({ kind: 'all-nba', tier: i + 1, name: `All-NBA ${['First', 'Second', 'Third'][i]} Team`, who: r.name })
  }))
  awards.allDef.forEach((tm, i) => tm.filter((r) => r.team === team).forEach((r) => {
    hits.push({ kind: 'all-def', tier: i + 1, name: `All-Defensive ${['First', 'Second'][i]} Team`, who: r.name })
  }))
  awards.allRookie.forEach((tm, i) => tm.filter((r) => r.team === team).forEach((r) => {
    hits.push({ kind: 'all-rookie', tier: i + 1, name: `All-Rookie ${['First', 'Second'][i]} Team`, who: r.name })
  }))
  return hits
}
