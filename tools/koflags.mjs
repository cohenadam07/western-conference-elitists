// tools/koflags.mjs — the Knockout holes the race server kept for a look (Flappy Hoops 2.13.3; api/race.js, kept 7 days):
// a hole whose replay had a make that was never reported, or that ended while a game still had time on its own clock.
//
//   KV_REST_API_URL=… KV_REST_API_READ_ONLY_TOKEN=… node tools/koflags.mjs [--save=dir] [--replay]
//
// Lists them, newest first (the party, the hole, how it ended, who was never reported, who still had time); --save
// writes each one as <dir>/<key>.json; --replay plays each again with the game's own rules as shipped
// (public/flappy-hoops/server/sim.mjs, koReplay) and says whether it comes out as the server had it. Read-only: a
// read-only token is all it needs (it only lists and gets).
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
if (!URL_ || !TOKEN) { console.error('needs KV_REST_API_URL and KV_REST_API_READ_ONLY_TOKEN'); process.exit(2) }
const args = process.argv.slice(2)
const save = (args.find((a) => a.startsWith('--save=')) || '').slice(7)

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) })
  if (!r.ok) throw new Error('redis ' + r.status)
  return (await r.json()).result
}
const parse = (str) => (str ? str.split(',').map((x) => { const [t, d] = x.split(':'); return [Number(t), /^[RUKLG]$/.test(d) ? d : Number(d)] }) : [])

const keys = (await redis(['LRANGE', 'fhko:flags', '0', '-1'])) || []
console.log(`${keys.length} kept`)
const S = args.includes('--replay') ? await import(pathToFileURL(path.resolve('public/flappy-hoops/server/sim.mjs')).href) : null
for (const key of keys) {
  const raw = await redis(['GET', key])
  if (!raw) { console.log(`${key}: gone (past its 7 days)`); continue }
  const f = JSON.parse(raw)
  const nm = (id) => (f.names && f.names[id]) || id
  console.log(`${key}  ${new Date(f.at).toISOString()}  ${f.world} hole ${f.hole + 1} (${f.holeId}), ended: ${f.how || '?'}${f.endedAt ? `, ${((f.endedAt - f.capAt) / 1000).toFixed(1)} s after its clock` : ''}, end tick ${f.koEnd}`)
  for (const u of f.unreported) console.log(`   never reported: ${nm(u.id)}'s make at tick ${u.k} (${(u.k / 120).toFixed(2)} s, ${u.f} flaps)`)
  for (const e of f.early) console.log(`   still had time: ${nm(e.id)} (its world at tick ${e.k} of ${f.koEnd})`)
  if (save) { fs.mkdirSync(save, { recursive: true }); fs.writeFileSync(path.join(save, key.replace(/:/g, '_') + '.json'), JSON.stringify(f, null, 1)) }
  if (S && f.holeId && f.sealed) {
    const inputs = Object.fromEntries(Object.entries(f.inputs).map(([id, str]) => [id, parse(str)]))
    const r = S.koReplay({ hole: f.holeId, seed: f.seed, inputs, until: f.cap + 2, cap: f.cap, deal: f.deal })
    console.log(`   replayed: ${r ? `tick ${r.T}, ${r.hash}${f.replay ? (r.hash === f.replay.hash ? ' (as the server had it)' : ` (the server had ${f.replay.hash})`) : ''}; makes ${JSON.stringify(r.fins)}` : 'no such hole'}`)
  } else if (S) console.log('   not replayable here (someone’s inputs were never sealed)')
}
