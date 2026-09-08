// One player's effect on an average team's net rating, through the measured fit model.
//
// The model is linear in minutes-weighted skill means, so putting a player on the floor
// for his share of the minutes moves each mean by (his value − the league mean) × that
// share. Summed through the standardised coefficients, that is his marginal net rating —
// and unlike box plus/minus it knows that gravity and point-of-attack defence carry a
// team while rim pressure and raw three-point volume do not.
import { SEED } from '../seed.js'

const F = SEED.fit
const FIELD = {
  spacing: 'sh', gravity: 'gr', rimprot: 'rp', poa: 'pd',
  playmaking: 'pm', size: 'sz', rimpress: 'rpr', ballsec: 'bs',
}
const archKey = (a) => `a_${String(a || '').replace(/&/g, '').replace(/\s+/g, '_')}`

export function fitContribution(player, opts = {}) {
  if (!F) return 0
  const share = Math.max(0.02, Math.min(0.16, (opts.minutes ?? player.mpg ?? 14) / 240))
  let net = 0
  for (const [key, field] of Object.entries(FIELD)) {
    const c = F.coef[key]
    const v = player[field]
    if (c === undefined || v === undefined || v === null) continue
    net += c * (share * (v - F.mean[key])) / (F.scale[key] || 1)
  }
  // Being a shot creator raises the team's on-ball load, which helps until it collides.
  if ((player.sc ?? 0) > 75 && F.coef.onball_load !== undefined) {
    const x0 = F.mean.onball_load, x1 = x0 + share
    net += F.coef.onball_load * ((x1 - x0) / (F.scale.onball_load || 1))
    if (F.coef.x_collide !== undefined) {
      net += F.coef.x_collide * ((x1 * x1 - x0 * x0) / (F.scale.x_collide || 1))
    }
  }
  const k = archKey(player.arch)
  if (F.arch_coef && F.arch_coef[k] !== undefined) {
    net += F.arch_coef[k] * (share / (F.arch_scale[k] || 1))
  }
  return net
}
