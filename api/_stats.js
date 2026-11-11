// api/_stats.js — the arithmetic under savant_analyze (api/_analyze.js): distributions, least
// squares with cluster-robust errors, logistic regression, Holm's adjustment, a seeded generator.
// Pure functions with no I/O, so tools/analysis/stats-check.py can hold each of them to statsmodels
// and scipy on the same inputs (research/analysis/BUILD.md §5 "Statistics").
//
// Conventions, chosen to match statsmodels exactly:
//   OLS, no cluster       the classical covariance s²(X'X)⁻¹, t intervals on N−K degrees of freedom
//   OLS, cluster          CR1: (X'X)⁻¹ (Σ_g s_g s_g') (X'X)⁻¹ × G/(G−1) × (N−1)/(N−K)
//                         (statsmodels cov_type='cluster', use_correction=True), t intervals on G−1
//                         degrees of freedom (use_t=True)
//   logit                 the information matrix, or for clusters the same CR1 sandwich around it;
//                         normal intervals (statsmodels' default for Logit)
//   logit                 Newton–Raphson from zero, stops at a change below 1e-10
// Not a function itself: Vercel skips api files that start with an underscore.

// ---- distributions ---------------------------------------------------------------------------------
export const normCdf = (z) => normalCdfExact(z)

function logGamma(x) {
  const g = 7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  x -= 1
  let a = c[0]
  const t = x + g + 0.5
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}
// Regularized incomplete beta I_x(a, b), continued fraction (Lentz), to ~1e-14.
function betaInc(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lbeta)
  if (x > (a + 1) / (a + b + 2)) return 1 - betaInc(1 - x, b, a)
  let f = 1, c = 1, d = 0
  for (let i = 0; i <= 400; i++) {
    const m = i >> 1
    let num
    if (i === 0) num = 1
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + num * d; if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d
    c = 1 + num / c; if (Math.abs(c) < 1e-300) c = 1e-300
    const cd = c * d
    f *= cd
    if (Math.abs(1 - cd) < 1e-15) break
  }
  return front * (f - 1) / a
}
// Student t: P(T <= t) on df degrees of freedom (df = Infinity is the normal).
export function tCdf(t, df) {
  if (!Number.isFinite(df) || df > 1e7) return normalCdfExact(t)
  const x = df / (df + t * t)
  const tail = 0.5 * betaInc(x, df / 2, 0.5)
  return t > 0 ? 1 - tail : tail
}
function normalCdfExact(z) {
  // Through the incomplete gamma: P = 0.5 * erfc(-z/√2), erfc(u) = Q(1/2, u²).
  const u = (z * z) / 2
  const q = gammaQ(0.5, u)
  return z >= 0 ? 1 - 0.5 * q : 0.5 * q
}
function gammaQ(a, x) {
  if (x <= 0) return 1
  const gln = logGamma(a)
  if (x < a + 1) { // series for P
    let ap = a, sum = 1 / a, del = sum
    for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-16) break }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln)
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a); b += 2
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d; const del = d * c; h *= del
    if (Math.abs(del - 1) < 1e-16) break
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h
}
// Two-sided p from the upper tail itself (no 1 − cdf, which loses everything past ~1e-16).
export function twoSidedP(t, df) {
  const a = Math.abs(t)
  if (!Number.isFinite(a)) return Number.isNaN(a) ? NaN : 0
  const tail = !Number.isFinite(df) || df > 1e7 ? 0.5 * gammaQ(0.5, (a * a) / 2) : 0.5 * betaInc(df / (df + a * a), df / 2, 0.5)
  return Math.min(1, 2 * tail)
}
export function tQuantile(p, df) {
  // Bisection on tCdf: slow but exact to the precision of tCdf, and called a handful of times.
  let lo = -1e3, hi = 1e3
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < p) lo = mid; else hi = mid; if (hi - lo < 1e-13) break }
  return (lo + hi) / 2
}

// ---- linear algebra (small K) ---------------------------------------------------------------------
export function invert(A) {
  const n = A.length
  const M = A.map((r, i) => [...r.map(Number), ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12 * Math.max(1, Math.abs(A[c][c]))) return null   // singular: a predictor is a copy of others
    ;[M[c], M[p]] = [M[p], M[c]]
    const d = M[c][c]
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j] }
  }
  return M.map((r) => r.slice(n))
}
export const matVec = (A, v) => A.map((r) => r.reduce((s, x, j) => s + x * v[j], 0))
export const matMul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)))

// The sandwich: A (Σ s s') A, from per-cluster score sums s_g (length K).
export function sandwich(Ainv, scores, factor) {
  const K = Ainv.length
  const B = Array.from({ length: K }, () => new Array(K).fill(0))
  for (const s of scores) for (let i = 0; i < K; i++) { const si = s[i]; if (si) for (let j = 0; j < K; j++) B[i][j] += si * s[j] }
  return matMul(matMul(Ainv, B), Ainv).map((r) => r.map((x) => x * factor))
}

// ---- intervals and adjustment ----------------------------------------------------------------------
export function coefTable(names, beta, cov, df) {
  const q = tQuantile(0.975, df)
  return names.map((name, i) => {
    const se = Math.sqrt(Math.max(0, cov[i][i]))
    const t = se > 0 ? beta[i] / se : NaN
    return { term: name, estimate: beta[i], std_error: se, ci_low: beta[i] - q * se, ci_high: beta[i] + q * se, t, p_value: se > 0 ? twoSidedP(t, df) : null }
  })
}
// Holm's step-down adjustment: adjusted p-values in the original order.
export function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null).sort((a, b) => a[0] - b[0])
  const out = ps.map(() => null)
  let run = 0
  idx.forEach(([p, i], r) => { run = Math.max(run, Math.min(1, (idx.length - r) * p)); out[i] = run })
  return out
}

// ---- a seeded generator (mulberry32): the same request resamples the same way, every time -------
export function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
export function seedOf(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

export function quantile(sorted, p) {
  if (!sorted.length) return null
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo)
}
export function pearson(a, b) {
  const n = a.length; if (n < 3) return NaN
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] } ma /= n; mb /= n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN
}

// ---- regression from sufficient statistics ---------------------------------------------------------
// OLS: xtx (K×K), xty (K), yty, N, and for clusters the per-cluster score sums after the fit (the
// caller computes them, in SQL, with the fitted beta). Returns everything but the clustered part,
// which clusterOls adds.
export function olsFit(xtx, xty, yty, N, ybar) {
  const K = xty.length
  const A = invert(xtx)
  if (!A) return null
  const beta = matVec(A, xty)
  const xb = matVec(xtx, beta)
  const sse = yty - 2 * beta.reduce((s, b, i) => s + b * xty[i], 0) + beta.reduce((s, b, i) => s + b * xb[i], 0)
  const sst = yty - N * ybar * ybar
  const df = N - K
  const s2 = sse / df
  return { beta, Ainv: A, sse, sst, r2: sst > 0 ? 1 - sse / sst : null, df, s2, cov: A.map((r) => r.map((x) => x * s2)) }
}
export const crFactorLinear = (G, N, K) => (G / (G - 1)) * ((N - 1) / (N - K))
