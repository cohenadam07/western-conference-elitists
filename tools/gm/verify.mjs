// Cross-runtime determinism check. Run: node tools/gm/verify.mjs
// The browser sim and Basketball-Savant/sim_engine.py must agree exactly from the same
// seed, because the server verifies a claimed season by replaying it.
import { readFileSync } from 'node:fs'
import { SEED } from '../../src/lib/gm/seed.js'
import { newLeague, setLeague, allRosters } from '../../src/lib/gm/league.js'
import { simulate } from '../../src/lib/gm/sim.js'

const fx = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)))
let pass = 0, fail = 0

// THE CONSTANTS THEMSELVES, BY NAME, BEFORE A SINGLE GAME IS REPLAYED.
//
// Every constant in this engine is solved rather than guessed, and each one lives in two
// places: sim_engine.py and SEED.cal. Nothing mechanically held them in step, so a value
// recalibrated on one side stayed put on the other — which is how the browser and the Python
// engine spent a while disagreeing about how often a shot gets blocked.
//
// Drift used to surface, when it surfaced at all, as a handful of mismatched box scores with
// no indication of which number had moved. This says which one, and it says it first.
if (fx.cal) {
  const drift = []
  for (const [k, v] of Object.entries(fx.cal)) {
    const mine = k === 'pace' ? SEED.cal?.pace : SEED.cal?.[k]
    if (mine === undefined) drift.push(`${k}: python ${v}, browser MISSING`)
    else if (Math.abs(mine - v) > 1e-12) drift.push(`${k}: python ${v}, browser ${mine}`)
  }
  if (drift.length) {
    console.log('CALIBRATION DRIFT — the two engines do not agree on what they are:')
    for (const d of drift) console.log(`  ${d}`)
    console.log('\nRegenerate with `python gm_fixtures.py`, or fix whichever side is stale.')
    process.exit(1)
  }
  console.log(`constants: ${Object.keys(fx.cal).length}/${Object.keys(fx.cal).length} identical`)
}
for (const c of fx.cases) {
  const { score, box, nPoss } = simulate(SEED.sim[c.home], SEED.sim[c.away], c.seed)
  const sum = (k) => Object.values(box).reduce((s, v) => s + (v[k] || 0), 0)
  const got = { hs: score.home, as: score.away, poss: nPoss,
                pts: sum('pts'), fga: sum('fga'), ast: sum('ast'), reb: sum('reb'),
                stl: sum('stl'), blk: sum('blk') }
  // stl and blk are compared because they were NOT, and the two engines spent a while
  // disagreeing about them in silence: the browser read its steal and block constants from
  // the seed, sim_engine.py kept module defaults that `load_calibration` never overrode, and
  // all thirty fixtures still passed because none of them looked at those two columns. A
  // guarantee is only as wide as the columns it checks.
  const keys = ['hs', 'as', 'poss', 'pts', 'fga', 'ast', 'reb', 'stl', 'blk']
  const bad = keys.filter((k) => got[k] !== c[k])
  if (!bad.length) pass++
  else {
    fail++
    console.log(`FAIL ${c.away}@${c.home} seed ${c.seed} — ${bad.join(', ')}`)
    console.log(`  python ${keys.map((k) => `${k}=${c[k]}`).join(' ')}`)
    console.log(`  js     ${keys.map((k) => `${k}=${got[k]}`).join(' ')}`)
  }
}
console.log(`\ncross-runtime determinism: ${pass}/${pass + fail} fixtures identical`)
process.exit(fail ? 1 : 0)
