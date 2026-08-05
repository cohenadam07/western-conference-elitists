/* Coins and cosmetics.
 *
 * Purely local: the wallet lives in this browser, and nothing here touches the race API.
 * That is a deliberate limit, not an oversight — a server-backed wallet is only worth
 * building if these ever cost money or confer an advantage, and cosmetics do neither. Anyone
 * determined enough to edit localStorage has awarded themselves a different coloured ball.
 */
const WALLET_KEY = 'flaphoops.wallet'

/* Beating par is the thing worth paying for, so the curve is steep at the top and never
   zero — a hole you fought through for twenty flaps still pays something, or grinding the
   easiest hole would be the optimal way to earn, which is nobody's idea of a game. */
export function coinsForHole(par, flaps, sank) {
  if (!sank) return 0
  const d = par - flaps
  if (d >= 4) return 60
  if (d >= 2) return 40
  if (d >= 0) return 25
  if (d >= -3) return 12
  return 5
}
/* Racing pays more than solo: someone else was trying to beat you. */
export const coinsForPlace = (place, players) =>
  place == null ? 0 : Math.round((30 + Math.max(0, players - place) * 14) * (place === 1 ? 1.6 : 1))

export const BALLS = [
  { id: 'classic', name: 'Leather',   price: 0,    kind: 'ball', a: '#F0803F', b: '#A8441B', seam: 'rgba(40,16,6,.8)' },
  { id: 'street',  name: 'Blacktop',  price: 150,  kind: 'ball', a: '#8E8B86', b: '#3C3A37', seam: 'rgba(12,12,12,.85)' },
  { id: 'glass',   name: 'Backboard', price: 350,  kind: 'ball', a: '#BFE2EE', b: '#4E8098', seam: 'rgba(20,50,64,.7)' },
  { id: 'ember',   name: 'Ember',     price: 700,  kind: 'ball', a: '#FFD79A', b: '#C4331B', seam: 'rgba(70,10,0,.75)', glow: '#FF6A2A' },
  { id: 'moon',    name: 'Moonrock',  price: 1200, kind: 'ball', a: '#E8ECF5', b: '#6A7288', seam: 'rgba(30,36,50,.6)', glow: '#9FB6D8' },
  { id: 'gold',    name: 'Solid gold', price: 2500, kind: 'ball', a: '#FFE9A8', b: '#B8862A', seam: 'rgba(70,45,0,.7)', glow: '#FFC844' },
]
export const TRAILS = [
  { id: 'none',    name: 'None',      price: 0,    kind: 'trail', color: 'rgba(217,98,43,.30)', width: 2 },
  { id: 'chalk',   name: 'Chalk',     price: 120,  kind: 'trail', color: 'rgba(232,220,200,.45)', width: 3 },
  { id: 'sparks',  name: 'Sparks',    price: 400,  kind: 'trail', color: 'rgba(255,176,74,.6)', width: 3, spark: true },
  { id: 'comet',   name: 'Comet',     price: 900,  kind: 'trail', color: 'rgba(150,210,255,.6)', width: 5, fade: true },
  { id: 'rainbow', name: 'Rainbow',   price: 2000, kind: 'trail', color: null, width: 5, rainbow: true },
]
export const CATALOG = [...BALLS, ...TRAILS]
export const itemById = (id) => CATALOG.find((i) => i.id === id) || null

const blank = () => ({ coins: 0, owned: ['classic', 'none'], ball: 'classic', trail: 'none' })
export function loadWallet() {
  try {
    const w = JSON.parse(localStorage.getItem(WALLET_KEY) || 'null')
    if (!w || typeof w.coins !== 'number') return blank()
    // repair rather than reset: a wallet missing its freebies should not cost someone their coins
    if (!Array.isArray(w.owned)) w.owned = ['classic', 'none']
    for (const free of ['classic', 'none']) if (!w.owned.includes(free)) w.owned.push(free)
    if (!itemById(w.ball)) w.ball = 'classic'
    if (!itemById(w.trail)) w.trail = 'none'
    return w
  } catch { return blank() }
}
export function saveWallet(w) {
  try { localStorage.setItem(WALLET_KEY, JSON.stringify(w)) } catch { /* private mode */ }
  return w
}
export const award = (w, coins) => saveWallet({ ...w, coins: w.coins + coins })
export function buy(w, id) {
  const item = itemById(id)
  if (!item || w.owned.includes(id) || w.coins < item.price) return w
  return saveWallet({ ...w, coins: w.coins - item.price, owned: w.owned.concat(id) })
}
export function equip(w, id) {
  const item = itemById(id)
  if (!item || !w.owned.includes(id)) return w
  return saveWallet({ ...w, [item.kind]: id })
}
