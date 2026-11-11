#!/usr/bin/env node
// tools/keys/tier.mjs <email> founder|none — set the tier on every connector key an email holds
// (research/analysis/BUILD.md §6). "founder" opens WCE Pro analysis (savant_sql, savant_analyze) on
// that person's own address; "none" takes it away. Every other field of each key record is kept.
//
// Reads the store from the environment, as the site does (KV_REST_API_URL / KV_REST_API_TOKEN, or the
// UPSTASH_REDIS_REST_* pair). Never prints a key or its hash: only each key's 12-character id (what
// /analytics already shows) and what changed. A copy of the connector caches a key for ten minutes,
// so a change reaches every address within ten minutes.
//
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node tools/keys/tier.mjs someone@example.com founder
//   node tools/keys/tier.mjs someone@example.com founder --dry-run

const K_KEYS = 'wce:mcp:keys'
const TIERS = new Set(['founder', 'none'])

export function retier(records, email, tier) {
  // records: [[id, json]] -> [[id, newJson]] for the ones that change, and a summary
  const want = String(email).trim().toLowerCase()
  const changes = []
  let held = 0
  for (const [id, raw] of records) {
    let rec
    try { rec = JSON.parse(raw) } catch { continue }
    if (String(rec.email || '').toLowerCase() !== want) continue
    held++
    const next = { ...rec }
    if (tier === 'none') delete next.tier
    else next.tier = tier
    if ((rec.tier || null) !== (next.tier || null)) changes.push([id, JSON.stringify(next), rec.tier || null])
  }
  return { held, changes }
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry-run')
  const [email, tier] = args.filter((a) => a !== '--dry-run')
  if (!email || !email.includes('@') || !TIERS.has(tier)) { console.error('usage: node tools/keys/tier.mjs <email> founder|none [--dry-run]'); process.exit(2) }
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || '').replace(/\/$/, '')
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN
  if (!url || !token) { console.error('Set KV_REST_API_URL and KV_REST_API_TOKEN (the site\'s Upstash store; `vercel env pull` writes them).'); process.exit(2) }
  const send = async (command) => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command.map(String)), signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`the store answered ${res.status}`)
    const body = await res.json()
    if (body.error) throw new Error(String(body.error).slice(0, 200))
    return body.result
  }
  const flat = await send(['HGETALL', K_KEYS])
  const pairs = Array.isArray(flat) ? flat : Object.entries(flat || {}).flat()
  const records = []
  for (let i = 0; i + 1 < pairs.length; i += 2) records.push([pairs[i], pairs[i + 1]])
  const { held, changes } = retier(records, email, tier)
  if (!held) { console.log(`${email} holds no key. A free key is emailed from https://wcehoops.com/#ai; run this again once it arrives.`); process.exit(1) }
  for (const [id, json, was] of changes) {
    console.log(`${dry ? 'would set' : 'set'} key ${id}: tier ${was || 'none'} -> ${tier}`)
    if (!dry) await send(['HSET', K_KEYS, id, json])
  }
  console.log(`${email}: ${held} key${held === 1 ? '' : 's'}, ${changes.length} changed${dry ? ' (dry run: nothing written)' : ''}. Live within ten minutes.`)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1) })
