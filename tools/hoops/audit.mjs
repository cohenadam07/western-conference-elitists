import { G } from './solver.mjs'
import { audit, report, ok } from './design.mjs'
let bad = 0, total = 0
for (let i = 0; i < G.LEVELS.length; i++) {
  const L = G.LEVELS[i]
  if (!L.zones || !L.zones.length) { console.log(`  ${L.world.padEnd(7)} ${L.name.padEnd(16)} (no modifiers)`); continue }
  const a = audit(i)
  if (a.ok) for (const z of a.zones) { total++; if (!ok(z)) bad++ }
  console.log('  ' + L.world.padEnd(7) + report(L.name, a).trim())
}
console.log(`\n${bad} of ${total} modifiers are not pulling their weight.`)
