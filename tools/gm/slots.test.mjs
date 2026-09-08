// Three franchises, and the ability to walk away from one.
//
// The save layer used to be a single localStorage key, which meant "start a second
// career" and "destroy the first one" were the same action. These are the checks that
// three careers can coexist, that quitting keeps a file, that deleting removes one and
// only one, and that an old single-key save survives the upgrade.
//
//   node tools/gm/slots.test.mjs
import { SEED } from '../../src/lib/gm/seed.js'

// A localStorage that behaves like the browser's: string keys, string values, throws on
// nothing, and is the ONLY place the module is allowed to keep state.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
  clear: () => store.clear(),
}

const {
  newCareer, loadCareer, saveCareer, franchises, activeSlot, setActiveSlot,
  leaveCareer, deleteFranchise, firstEmptySlot, MAX_FRANCHISES, SLOTS,
} = await import('../../src/lib/gm/storage.js')

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const levels = { ...SEED.presets.guided.levels }
const make = (team, slot, name) => {
  const c = newCareer({ gm: { name }, team, preset: 'guided', levels, seed: 4242 + slot, slot })
  saveCareer(c)
  return c
}

console.log('— an empty cabinet —')
{
  const f = franchises()
  check('there are exactly three slots', f.length === MAX_FRANCHISES, `${f.length}`)
  check('all three start empty', f.every((x) => !x.summary))
  check('nothing is active', activeSlot() === null)
  check('the first empty slot is slot 1', firstEmptySlot() === 1)
}

console.log('\n— three careers at once —')
{
  make('BOS', 1, 'One')
  make('OKC', 2, 'Two')
  make('SAC', 3, 'Three')
  const f = franchises()
  check('all three slots are filled', f.every((x) => !!x.summary))
  check('each remembers its own club',
    f.map((x) => x.summary.team).join(',') === 'BOS,OKC,SAC', f.map((x) => x.summary?.team).join(','))
  check('each remembers its own GM',
    f.map((x) => x.summary.gm).join(',') === 'One,Two,Three')
  check('no empty slot is left', firstEmptySlot() === null)
  check('the summary carries a record book',
    typeof f[0].summary.wins === 'number' && typeof f[0].summary.titles === 'number')
  check('the summary is stamped with a time', f[0].summary.updatedAt > 0)
}

console.log('\n— loading one installs its league —')
{
  const a = loadCareer(1)
  check('slot 1 loads', !!a && a.franchise.team === 'BOS', a?.franchise?.team)
  check('and becomes the active franchise', activeSlot() === 1)
  const { rostersOf } = await import('../../src/lib/gm/league.js')
  const bos = rostersOf('BOS')
  check('its league is the installed one', bos.length > 0, `${bos.length} contracts`)
  const b = loadCareer(2)
  check('slot 2 loads over it', !!b && b.franchise.team === 'OKC')
  check('and is now active', activeSlot() === 2)
  check('slot 1 is untouched by the switch', franchises()[0].summary.team === 'BOS')
}

console.log('\n— saving writes back to the slot it came from —')
{
  setActiveSlot(2)
  const one = loadCareer(1)
  one.records.championships = 3
  // Active is 1 after the load; but even if it were not, the stamp decides.
  one.slot = 1
  setActiveSlot(2)
  saveCareer(one)
  check('the title landed in slot 1', franchises()[0].summary.titles === 3,
    `${franchises()[0].summary.titles}`)
  check('and not in slot 2', franchises()[1].summary.titles === 0)
}

console.log('\n— quit and save —')
{
  loadCareer(3)
  leaveCareer()
  check('nothing is active any more', activeSlot() === null)
  check('but all three careers are still on disk', franchises().every((x) => !!x.summary))
  check('loading with no slot returns nothing', loadCareer() === null)
  const back = loadCareer(3)
  check('and the career comes back when you pick it', !!back && back.franchise.team === 'SAC')
  check('with its record book intact', back.records.championships === 0)
}

console.log('\n— quit and delete —')
{
  loadCareer(2)
  deleteFranchise(2)
  const f = franchises()
  check('slot 2 is gone', !f[1].summary)
  check('slot 1 survives', f[0].summary?.team === 'BOS')
  check('slot 3 survives', f[2].summary?.team === 'SAC')
  check('nothing is active after deleting the open career', activeSlot() === null)
  check('the freed slot is offered next', firstEmptySlot() === 2)
  check('a new career takes it', make('MIA', 2, 'Four') && franchises()[1].summary.team === 'MIA')
}

console.log('\n— an old single-key save is not lost —')
{
  store.clear()
  const legacy = newCareer({ gm: { name: 'Legacy' }, team: 'DEN', preset: 'guided', levels, seed: 9 })
  store.set('wce.gm.career.v1', JSON.stringify(legacy))
  // A fresh module instance, because the migration is a once-per-load thing.
  const mod = await import(`../../src/lib/gm/storage.js?legacy=${Date.now()}`)
  const f = mod.franchises()
  check('the old career is now slot 1', f[0].summary?.team === 'DEN', f[0].summary?.team)
  check('and it is the active one', mod.activeSlot() === 1)
  check('the old key is cleaned up', store.get('wce.gm.career.v1') === undefined)
  check('the other two slots are free', !f[1].summary && !f[2].summary)
  check('it still loads', mod.loadCareer(1)?.gm.name === 'Legacy')
}

console.log('\n— a slot that holds junk is not a career —')
{
  store.clear()
  const mod = await import(`../../src/lib/gm/storage.js?junk=${Date.now()}`)
  localStorage.setItem('wce.gm.career.v1.s1', '{not json')
  localStorage.setItem('wce.gm.career.v1.s2', JSON.stringify({ schema: 1, league: {} }))
  const f = mod.franchises()
  check('unparseable slot reads as empty', !f[0].summary)
  check('a save from an older schema reads as empty', !f[1].summary)
  mod.setActiveSlot(1)
  check('and loading it hands back nothing rather than crashing', mod.loadCareer() === null)
  check('the dead active pointer is cleared', mod.activeSlot() === null)
  check('SLOTS is the list the UI iterates', SLOTS.join(',') === '1,2,3')
}

console.log(`\n${pass}/${pass + fail} checks pass`)
process.exit(fail ? 1 : 0)
