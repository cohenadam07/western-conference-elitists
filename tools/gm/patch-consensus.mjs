// Put the Dynasty Exchange's crowd ratings into the seed.
//
// The trade engine's talent estimate is built from box plus/minus, and box plus/minus has a
// known bias: it rewards efficiency, and efficiency is easiest at low usage. Measured against
// the crowd board, we rank a low-usage player about 18 places better than the crowd does and
// a high-usage player 19 places worse — a usage coefficient of −514 rank places per unit of
// usage, on 369 joined players.
//
// The board has its own bias in the other direction — it is a fantasy DYNASTY board, so it
// pays for youth and for counting stats. Neither system is right. Carrying the rating lets
// the engine use the disagreement as a bounded correction rather than believing either one.
//
//   node tools/gm/patch-consensus.mjs
import fs from 'node:fs'

const SEEDJS = 'src/lib/gm/seed.js'
const BOARD = 'public/dynasty/players.json'

const norm = (n) => String(n || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'`]/g, '').replace(/-/g, ' ')
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim()

const board = JSON.parse(fs.readFileSync(BOARD, 'utf8'))
const src = fs.readFileSync(SEEDJS, 'utf8')
const [head, body] = src.split('export const SEED = ')
const seed = JSON.parse(body.trim().replace(/;$/, ''))

const byName = new Map(board.players.map((p) => [norm(p.name), p]))
// Rank on the board, so the seed carries a position rather than an Elo number whose scale
// means nothing outside its own page.
const sorted = [...board.players].sort((a, b) => b.rating - a.rating)
const rankOf = new Map(sorted.map((p, i) => [norm(p.name), i + 1]))

let hit = 0, miss = 0
for (const team of Object.keys(seed.rosters)) {
  for (const p of seed.rosters[team]) {
    const k = norm(p.n)
    const d = byName.get(k)
    if (!d) { miss++; continue }
    p.cr = rankOf.get(k)                 // consensus rank, 1 = best
    hit++
  }
}
seed.consensus = {
  source: board.source,
  note: 'Crowd board rank. A fantasy dynasty board: it pays for youth and counting stats, '
    + 'and it is used only as a bounded correction to a measured talent estimate.',
  n: sorted.length,
}
fs.writeFileSync(SEEDJS, head + 'export const SEED = ' + JSON.stringify(seed) + '\n')
console.log(`consensus rank attached to ${hit} contracts, ${miss} without a board entry`)
console.log(`board: ${board.source}, ${sorted.length} players`)
