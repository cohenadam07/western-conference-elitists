// Lottery, prospects and the draft — the browser port of draft_engine.py.
//
// The scouting fog is CALIBRATED, not invented. Running trajectory/'s leave-one-draft-out
// predictions against real outcomes for 479 drafted prospects gives correlation +0.537,
// against 0.497 for the real NBA draft order — so the model beats the league's collective
// judgment out of sample, and 0.54 is what "elite scouting" means here. Not 0.9. A
// top-quintile prospect still busts about a fifth of the time.
import { SEED } from './seed.js'
import { rng } from './sim.js'
import { accuracyFor } from './scouts.js'

const D = SEED.draft
const FIRST = ['Amari', 'Kai', 'Deshawn', 'Luka', 'Tariq', 'Bode', 'Marcus', 'Ivan', 'Jalen',
  'Obi', 'Theo', 'Rui', 'Cade', 'Nikola', 'Emeka', 'Silas', 'Dante', 'Kofi', 'Mateo', 'Zion',
  'Trey', 'Andrei', 'Malik', 'Jonas', 'Hugo', 'Diego', 'Ade', 'Kristaps', 'Noah', 'Elias']
const LAST = ['Whitfield', 'Okonkwo', 'Barrera', 'Petrov', 'Achebe', 'Lindqvist', 'Mabry',
  'Toussaint', 'Vasquez', 'Bright', 'Ferreira', 'Novak', 'Kimani', 'Sandoval', 'Halloran',
  'Ndiaye', 'Rasmussen', 'Croft', 'Bello', 'Marchetti', 'Doyle', 'Ivanov', 'Sowande',
  'Ferris', 'Delgado', 'Karlsson', 'Boateng', 'Reyes', 'Vance', 'Aguilar']

// Inverse normal CDF (Acklam) — thresholds are set from the real base rates so the
// marginal outcome distribution is correct by construction.
function probit(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) return -probit(1 - p)
  const q = p - 0.5, r2 = q * q
  return ((((((a[0] * r2 + a[1]) * r2 + a[2]) * r2 + a[3]) * r2 + a[4]) * r2 + a[5]) * q) /
    (((((b[0] * r2 + b[1]) * r2 + b[2]) * r2 + b[3]) * r2 + b[4]) * r2 + 1)
}

// Four picks drawn by weighted combination, the rest by record. This is why the worst
// team in the league lands 5th far more often than 1st.
export function runLottery(seedsWorstFirst, r) {
  const pool = seedsWorstFirst.slice(0, 14)
  const odds = new Map(pool.map((t, i) => [t, D.odds[i]]))
  const winners = []
  for (let k = 0; k < 4; k++) {
    const tot = pool.reduce((s, t) => s + odds.get(t), 0)
    let acc = 0, x = r.rand() * tot
    for (let i = 0; i < pool.length; i++) {
      acc += odds.get(pool[i])
      if (acc >= x) { winners.push(pool.splice(i, 1)[0]); break }
    }
  }
  return [...winners, ...pool, ...seedsWorstFirst.slice(14)]
}

export function generateClass(r, n = 60, year = 2027) {
  const s = Math.sqrt(D.load * D.load + 1)
  let cum = 0
  const thr = {}
  for (const k of ['Fringe', 'Rotation', 'Starter']) { cum += D.buckets[k].p; thr[k] = s * probit(cum) }
  const out = []
  for (let i = 0; i < n; i++) {
    const z = r.gauss(0, 1)
    const u = D.load * z + r.gauss(0, 1)
    const bucket = u < thr.Fringe ? 'Fringe' : u < thr.Rotation ? 'Rotation'
      : u < thr.Starter ? 'Starter' : 'Star'
    const b = D.buckets[bucket]
    out.push({
      id: `${year}-${i}`,
      name: `${FIRST[r.randrange(FIRST.length)]} ${LAST[r.randrange(LAST.length)]}`,
      age: Math.round(r.gauss(19.6, 1.1) * 10) / 10,
      _u: u, _bucket: bucket,
      _vorp4: Math.max(-0.4, r.gauss(b.mu, b.sd)),
    })
  }
  return out
}

// Scouting: correlate with the OUTCOME, not with latent talent, so the dial means exactly
// what the measured 0.537 means.
export function scout(prospects, r, quality = D.scoutElite) {
  const s = Math.sqrt(D.load * D.load + 1)
  const out = prospects.map((p) => ({
    ...p,
    scout: quality * (p._u / s) + Math.sqrt(Math.max(0, 1 - quality * quality)) * r.gauss(0, 1),
  }))
  out.slice().sort((a, b) => b.scout - a.scout).forEach((p, i) => { p.board = i + 1 })
  return out
}

// YOUR board is not one number applied to everyone. It is assembled prospect by prospect
// from the department you hired: sharp where your scouts actually watch games, close to a
// coin flip where nobody does. Hiring a European scout is visible here and nowhere else.
export function scoutWithStaff(prospects, staff, r, opts = {}) {
  const s = Math.sqrt(D.load * D.load + 1)
  const out = prospects.map((p) => {
    const acc = accuracyFor(p, staff, opts)
    return {
      ...p,
      q: acc.q,
      covered: acc.covered,
      scoutedBy: acc.by ? acc.by.name : null,
      scout: acc.q * (p._u / s) + Math.sqrt(Math.max(0, 1 - acc.q * acc.q)) * r.gauss(0, 1),
    }
  })
  out.slice().sort((a, b) => b.scout - a.scout).forEach((p, i) => { p.board = i + 1 })
  return out
}

// Each AI team drafts off its OWN noisy board, which is why the same class produces a
// different draft every time and why reaching is a real thing rather than a script.
export function runDraft(order, prospects, r, userTeam, quality = {}) {
  const boards = {}
  for (const t of order) {
    const q = quality[t] ?? (D.scoutPoor + r.rand() * (D.scoutElite - D.scoutPoor))
    const b = {}
    scout(prospects, r, q).forEach((p) => { b[p.id] = p.scout })
    boards[t] = b
  }
  const taken = new Set(), picks = []
  for (let round = 0; round < 2; round++)
    for (let slot = 0; slot < order.length; slot++) {
      const t = order[slot]
      const avail = prospects.filter((p) => !taken.has(p.id))
      if (!avail.length) break
      const overall = round * order.length + slot + 1
      if (t === userTeam) { picks.push({ overall, round: round + 1, team: t, userPick: true }); continue }
      let best = avail[0]
      for (const p of avail) if (boards[t][p.id] > boards[t][best.id]) best = p
      taken.add(best.id)
      picks.push({ overall, round: round + 1, team: t, prospect: best })
    }
  return { picks, taken }
}
