// Ship the big Savant data files gzipped.
//
// public/ holds ~137 MB of JSON that four pages fetch. Vercel counts build output toward
// Deployment Storage, and it keeps the last 20 production and 20 preview deployments no
// matter what the retention policy says — so at 215 MB a deployment, the floor alone was
// ~8.6 GB of a 10 GB allowance.
//
// This compresses those four files into dist/ and drops the originals. vercel.json rewrites
// /savant-data.json → /savant-data.json.gz and sets Content-Encoding: gzip, so the browser
// decompresses it transparently and the pages keep fetching the same URLs. Nothing in the
// repo or in the refresh bots changes: git still stores plain JSON, which also keeps the
// daily data commits small.
//
// Bonus: Basketball Savant now downloads ~10 MB instead of 64.5 MB before it can render.

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

// Only files big enough to be worth it, and only ones fetched as whole documents.
export const COMPRESSED = [
  'savant-data.json',
  'football-savant-data.json',
  'ufc-savant-data.json',
  'ufc-savant-fights.json',
]

const mb = (n) => (n / 1048576).toFixed(1)

export function compressData(dist) {
  const done = []
  for (const name of COMPRESSED) {
    const file = path.join(dist, name)
    if (!existsSync(file)) continue
    const raw = statSync(file).size
    const gz = gzipSync(readFileSync(file), { level: 6 })
    writeFileSync(`${file}.gz`, gz)
    rmSync(file)
    done.push({ name, raw, gz: gz.length })
  }
  return done
}

export default function compressDataPlugin() {
  let dist
  return {
    name: 'wce-compress-data',
    apply: 'build',
    configResolved(c) { dist = path.resolve(c.root, c.build.outDir) },
    closeBundle() {
      const done = compressData(dist)
      if (!done.length) return
      const raw = done.reduce((s, d) => s + d.raw, 0)
      const gz = done.reduce((s, d) => s + d.gz, 0)
      console.log(`  data: ${done.length} files gzipped, ${mb(raw)} MB → ${mb(gz)} MB (${Math.round(100 - (100 * gz) / raw)}% smaller)`)
    },
  }
}
