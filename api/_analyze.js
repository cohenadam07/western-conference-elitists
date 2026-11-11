// api/_analyze.js — savant_analyze: statistics with confidence built in, over the full Data Room
// (research/analysis/BUILD.md §4). The caller describes a study and gives one SELECT that returns its
// observations (savant_sql's rules and locks, api/_sql.js withObservations); the server does the rest.
//
//   compare        is the gap between groups real? means or rates, the difference with a 95% interval,
//                  a cluster bootstrap p-value (whole games or teams are resampled, never single rows),
//                  the cluster-robust analytic test beside it, the effect size, a one-line verdict
//   regress        what moves an outcome holding the others fixed: linear or logistic, coefficients with
//                  95% intervals, errors clustered by the column the caller names, R² or log-loss, VIFs
//   stability      skill or noise: split-half reliability and the settle point, by the Savant backtests'
//                  own method (pipeline/cfb/player_study.py, pipeline/basketball/settle_points.py)
//   trend          has it changed: each period with its interval, the slope across periods and the
//                  last period against the first
//   distribution   where a value sits in a pool the caller names: its percentile and the pool's summary
//
// Every answer leads with a plain-language reading, then the numbers; states its samples; warns when a
// group is too small (with Basketball Savant's settle points where the stat has one); names what it
// cannot account for; adjusts for multiple comparisons (Holm) when it tests several at once; and says
// "associated with", never "causes": these are observational rows.
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { SavantError } from './_core.js'
import { withObservations } from './_sql.js'
import { coefTable, crFactorLinear, holm, invert, matVec, olsFit, pearson, quantile, rng, sandwich, seedOf, tQuantile, twoSidedP } from './_stats.js'

// Basketball Savant's settle points: SETTLE_K in public/basketball-savant.html ([k against the position
// mean, k with last season]), measured by pipeline/basketball/settle_points.py. A copy, held to the page
// by tools/analysis/check.mjs so the two can never differ. Units: attempts for shooting rates,
// possessions for per-75 and the possession-based rates, games for the per-game ones.
export const SETTLE_K = { ts: [282, 422], efg: [251, 376], pps: [150, 266], tp3: [94, 133], tp2: [150, 237], ft: [38, 67], tp3r: [9, 42], ftr: [60, 150], p3pt: [22, 79], pts: [188, 631], ast75: [188, 596], tov75: [398, 1000], reb75: [224, 668], stl: [750, 1496], blk: [335, 841], stk75: [447, 1059], drv: [106, 447], potast: [126, 422], ast: [141, 501], usg: [112, 422], oreb: [266, 708], dreb: [316, 841], rim: [237, 298], tov: [631, 1259], selfcr: [5, 24], uast: [13, 42], uast3: [8, 22], ppaint: [27, 89], gmsc: [4, 13] }
const SETTLE_UNIT = { ts: 'shooting attempts', efg: 'field-goal attempts', pps: 'shots', tp3: '3-point attempts', tp2: '2-point attempts', ft: 'free-throw attempts', tp3r: 'field-goal attempts', ftr: 'field-goal attempts', p3pt: 'points', rim: 'possessions', tov: 'possessions', selfcr: 'games', uast: 'games', uast3: 'games', ppaint: 'games', gmsc: 'games' }
const settleUnit = (k) => SETTLE_UNIT[k] || 'possessions'

const MIN_N = 30, MIN_CLUSTERS = 10
const fmt = (x, d = 3) => (x == null || !Number.isFinite(x) ? 'n/a' : Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : Number(x.toPrecision(Math.max(d, 1))).toString())
const pct = (x) => (x == null ? 'n/a' : `${(100 * x).toFixed(1)}%`)
const num = (x) => `${Number(x).toPrecision(17)}`   // a fitted number written into the study's own SQL

// The caller's column names, checked against what their SELECT returned.
function column(cols, name, what, { numeric = false } = {}) {
  if (!name) throw new SavantError(`Give ${what}: the name of a column your SQL returns (it returned ${cols.map((c) => c[0]).join(', ')}).`)
  const c = cols.find(([n]) => n === name) || cols.find(([n]) => n.toLowerCase() === String(name).toLowerCase())
  if (!c) throw new SavantError(`Your SQL returned no column "${name}" for ${what}. It returned: ${cols.map((x) => x[0]).join(', ')}.`)
  if (numeric && !/INT|DOUBLE|FLOAT|DECIMAL|REAL|BOOLEAN|NUMERIC/.test(c[1])) throw new SavantError(`${what} ("${c[0]}") must be a number (it is ${c[1]}). CAST it, or for a yes/no use CASE WHEN … THEN 1 ELSE 0 END.`)
  return c[0]
}

// ---- compare ----------------------------------------------------------------------------------------
async function compare(args, ctx) {
  const y = column(ctx.cols, args.outcome, 'outcome', { numeric: true })
  const g = column(ctx.cols, args.group, 'group')
  const c = args.cluster ? column(ctx.cols, args.cluster, 'cluster') : null
  const Y = `CAST(${ctx.ident(y)} AS DOUBLE)`, G = `CAST(${ctx.ident(g)} AS VARCHAR)`, C = c ? `CAST(${ctx.ident(c)} AS VARCHAR)` : 'CAST(rowid AS VARCHAR)'
  if (!c && ctx.n > 200000) throw new SavantError(`${ctx.n.toLocaleString('en-US')} rows with no cluster column: name one (game_id, team, player) so the bootstrap resamples whole games, not single rows.`)
  const rows = (await ctx.q(`SELECT ${G} AS g, ${C} AS c, count(*) AS n, sum(${Y}) AS s1, sum(${Y} * ${Y}) AS s2, bool_and(${Y} IN (0, 1)) AS bin FROM $T WHERE ${Y} IS NOT NULL AND ${G} IS NOT NULL GROUP BY 1, 2`)).rows
  if (!rows.length) throw new SavantError('No rows with both an outcome and a group.')
  const levels = [...new Set(rows.map((r) => r[0]))]
  if (levels.length < 2) throw new SavantError(`The group column has one value only ("${levels[0]}"): nothing to compare.`)
  if (levels.length > 20) throw new SavantError(`The group column has ${levels.length} values; compare takes at most 20. Group them in the SQL (CASE WHEN …).`)
  const binary = rows.every((r) => r[5] === true)
  // per group totals
  const tot = Object.fromEntries(levels.map((l) => [l, { n: 0, s1: 0, s2: 0, clusters: 0 }]))
  for (const [l, , n, s1, s2] of rows) { const t = tot[l]; t.n += n; t.s1 += s1; t.s2 += s2; t.clusters++ }
  const order = args.reference != null && levels.includes(String(args.reference)) ? [String(args.reference), ...levels.filter((l) => l !== String(args.reference))] : levels.slice().sort((a, b) => tot[b].n - tot[a].n)
  const ref = order[0]
  const groups = order.map((l) => { const t = tot[l]; const m = t.s1 / t.n; const v = t.n > 1 ? (t.s2 - t.n * m * m) / (t.n - 1) : NaN; return { group: l, n: t.n, clusters: c ? t.clusters : null, mean: m, sd: Math.sqrt(Math.max(0, v)) } })
  // cluster table: cluster -> per-group [n, s1]
  const cl = new Map()
  for (const [l, k, n, s1] of rows) { let e = cl.get(k); if (!e) { e = { n: new Float64Array(order.length), s: new Float64Array(order.length) }; cl.set(k, e) } const i = order.indexOf(l); e.n[i] += n; e.s[i] += s1 }
  const clusters = [...cl.values()]
  const Gn = clusters.length
  // the bootstrap: whole clusters, B resamples, capped so B × clusters stays near 4e7 operations
  const B = Math.max(400, Math.min(args.resamples || 2000, Math.floor(4e7 / Math.max(1, Gn * order.length))))
  const rand = rng(seedOf(JSON.stringify({ s: args.sql, y, g, c })))
  const diffs = order.slice(1).map(() => new Float64Array(B))
  const sn = new Float64Array(order.length), ss = new Float64Array(order.length)
  for (let b = 0; b < B; b++) {
    sn.fill(0); ss.fill(0)
    for (let i = 0; i < Gn; i++) { const e = clusters[(rand() * Gn) | 0]; for (let j = 0; j < order.length; j++) { sn[j] += e.n[j]; ss[j] += e.s[j] } }
    const m0 = ss[0] / sn[0]
    for (let j = 1; j < order.length; j++) diffs[j - 1][b] = ss[j] / sn[j] - m0
  }
  const tests = order.slice(1).map((l, idx) => {
    const a = groups[idx + 1], r = groups[0]
    const d = a.mean - r.mean
    const arr = Array.from(diffs[idx]).filter(Number.isFinite).sort((x, z) => x - z)
    const lo = quantile(arr, 0.025), hi = quantile(arr, 0.975)
    const below = arr.filter((x) => x <= 0).length / arr.length, above = arr.filter((x) => x >= 0).length / arr.length
    const pBoot = Math.max(1 / arr.length, Math.min(1, 2 * Math.min(below, above)))
    // the analytic twin: y on a group dummy, two groups, CR1 errors (statsmodels OLS cov_type='cluster')
    const an = twoGroupCR(clusters, 0, idx + 1, r.mean, d, !!c)
    const es = binary ? { name: "Cohen's h", value: 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a.mean)))) - 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, r.mean)))) }
      : { name: "Cohen's d", value: d / Math.sqrt(((a.n - 1) * a.sd ** 2 + (r.n - 1) * r.sd ** 2) / (a.n + r.n - 2)) }
    return { group: l, versus: ref, difference: d, ci_low: lo, ci_high: hi, p_bootstrap: pBoot, analytic: an, effect_size: es, resamples: arr.length }
  })
  const adj = holm(tests.map((t) => t.p_bootstrap))
  tests.forEach((t, i) => { t.p_adjusted = tests.length > 1 ? adj[i] : t.p_bootstrap })
  const settle = args.stat && SETTLE_K[args.stat] ? SETTLE_K[args.stat][0] : null
  const warnings = []
  for (const gr of groups) {
    if (gr.n < MIN_N) warnings.push(`"${gr.group}" has ${gr.n} observations (under ${MIN_N}).`)
    if (c && gr.clusters < MIN_CLUSTERS) warnings.push(`"${gr.group}" comes from ${gr.clusters} ${args.cluster_label || 'clusters'} (under ${MIN_CLUSTERS}): its interval is unreliable.`)
    if (settle && args.sample_is_settle_unit !== false && gr.n < settle) warnings.push(`"${gr.group}" holds ${gr.n} ${settleUnit(args.stat)}, under Basketball Savant's settle point for ${args.stat} (${settle}): more of its number is noise than signal.`)
  }
  if (!c) warnings.push('No cluster column was named, so each row was resampled on its own. Rows from the same game or player are not independent; name a cluster (game_id, team) for honest intervals.')
  for (const t of tests) {
    const few = groups.some((gr) => (gr.group === t.group || gr.group === ref) && (gr.n < MIN_N || (c && gr.clusters < MIN_CLUSTERS)))
    const real = t.p_adjusted < 0.05 && (t.ci_low > 0 || t.ci_high < 0)
    t.verdict = few ? 'too few' : real ? (Math.abs(t.effect_size.value) < 0.1 ? 'real, but small' : 'real') : 'probably noise'
  }
  const what = binary ? 'rate' : 'mean'
  const show = (x) => (binary ? pct(x) : fmt(x, 4))
  const lines = tests.map((t) => `${t.group} vs ${ref}: ${show(groups.find((x) => x.group === t.group).mean)} vs ${show(groups[0].mean)}, a difference of ${binary ? `${(100 * t.difference).toFixed(1)} points` : fmt(t.difference, 3)} (95% interval ${binary ? `${(100 * t.ci_low).toFixed(1)} to ${(100 * t.ci_high).toFixed(1)}` : `${fmt(t.ci_low, 3)} to ${fmt(t.ci_high, 3)}`}). Verdict: ${t.verdict}.`)
  return {
    interpretation: `${lines.join(' ')} The ${what}s differ ${tests.some((t) => t.verdict.startsWith('real')) ? 'by more than chance would explain' : 'by no more than chance could explain'}; this is an association in the rows, not proof of a cause.`,
    groups, tests, binary, clusters: c ? Gn : null, resamples: B,
    multiple_comparisons: tests.length > 1 ? `${tests.length} groups were each compared with "${ref}"; p-values are Holm-adjusted.` : null,
    warnings,
    method: `Difference in ${what}s (${order.length > 2 ? 'each group against the reference' : 'two groups'}). 95% interval and p-value from a bootstrap of ${B.toLocaleString('en-US')} resamples of whole ${c ? `${args.cluster} values` : 'rows'} (seeded, so the same request gives the same answer); the analytic column is the same difference from least squares with ${c ? 'cluster-robust (CR1)' : 'classical'} errors. Effect size ${binary ? "Cohen's h (rates)" : "Cohen's d (pooled SD)"}.`,
  }
}

function twoGroupCR(clusters, ri, ai, b0, b1, clustered) {
  // y = b0 + b1·D over the rows of the two groups; X'X from totals, scores from cluster sums.
  let N = 0, NA = 0, sse = 0
  const scores = []
  for (const e of clusters) {
    const na = e.n[ai], nr = e.n[ri]
    if (!na && !nr) continue
    N += na + nr; NA += na
    const ea = e.s[ai] - (b0 + b1) * na, er = e.s[ri] - b0 * nr
    scores.push([ea + er, ea])
  }
  const A = invert([[N, NA], [NA, NA]])
  if (!A) return null
  const Gc = scores.length
  if (!clustered) return null   // without clusters the bootstrap stands alone (rows resampled one by one)
  const cov = sandwich(A, scores, crFactorLinear(Gc, N, 2))
  const se = Math.sqrt(cov[1][1]), df = Gc - 1, q = tQuantile(0.975, df)
  void sse
  return { std_error: se, ci_low: b1 - q * se, ci_high: b1 + q * se, p_value: twoSidedP(b1 / se, df), df }
}

// ---- regress ------------------------------------------------------------------------------------------
async function regress(args, ctx) {
  const y = column(ctx.cols, args.outcome, 'outcome', { numeric: true })
  const preds = (args.predictors || []).map((p) => column(ctx.cols, p, 'a predictor', { numeric: true }))
  const cats = (args.categorical || []).map((p) => column(ctx.cols, p, 'a categorical predictor'))
  if (!preds.length && !cats.length) throw new SavantError('Give predictors (numeric columns) and/or categorical (columns whose values become indicator terms).')
  const c = args.cluster ? column(ctx.cols, args.cluster, 'cluster') : null
  const model = args.model === 'logistic' ? 'logistic' : 'linear'
  const terms = [['(intercept)', '1.0']]
  for (const p of preds) terms.push([p, `CAST(${ctx.ident(p)} AS DOUBLE)`])
  for (const cc of cats) {
    const lv = (await ctx.q(`SELECT CAST(${ctx.ident(cc)} AS VARCHAR) AS v, count(*) AS n FROM $T WHERE ${ctx.ident(cc)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 41`)).rows
    if (lv.length > 40) throw new SavantError(`"${cc}" has more than 40 values; group it in the SQL first.`)
    if (lv.length < 2) throw new SavantError(`"${cc}" has one value only.`)
    for (const [v] of lv.slice(1)) terms.push([`${cc}=${v}`, `(CAST(${ctx.ident(cc)} AS VARCHAR) = '${String(v).replace(/'/g, "''")}')::DOUBLE`])
    terms.reference = { ...(terms.reference || {}), [cc]: lv[0][0] }
  }
  if (terms.length > 31) throw new SavantError(`That is ${terms.length - 1} terms; the limit is 30.`)
  const K = terms.length
  const Y = `CAST(${ctx.ident(y)} AS DOUBLE)`
  const complete = [Y, ...preds.map((p) => ctx.ident(p)), ...cats.map((p) => ctx.ident(p)), ...(c ? [ctx.ident(c)] : [])].map((e) => `${e} IS NOT NULL`).join(' AND ')
  const X = terms.map(([, e]) => e)
  const C = c ? `CAST(${ctx.ident(c)} AS VARCHAR)` : null
  // one pass: N, Σy, Σy², X'X, X'y (and whether y is 0/1)
  const sums = []
  for (let i = 0; i < K; i++) for (let j = i; j < K; j++) sums.push(`sum((${X[i]}) * (${X[j]}))`)
  const head = (await ctx.q(`SELECT count(*), sum(${Y}), sum(${Y} * ${Y}), bool_and(${Y} IN (0, 1)), ${C ? `count(DISTINCT ${C})` : '0'}, ${sums.join(', ')}, ${X.map((e) => `sum((${e}) * ${Y})`).join(', ')} FROM $T WHERE ${complete}`)).rows[0]
  const [N, sy, syy, isBin, G] = head
  if (!N || N <= K) throw new SavantError(`Only ${N || 0} complete rows for ${K} terms.`)
  if (model === 'logistic' && !isBin) throw new SavantError('A logistic model needs a 0/1 outcome.')
  const xtx = Array.from({ length: K }, () => new Array(K).fill(0))
  let p = 5
  for (let i = 0; i < K; i++) for (let j = i; j < K; j++) { xtx[i][j] = xtx[j][i] = head[p++] }
  const xty = head.slice(p, p + K)
  // collinearity: VIFs from the predictors' correlation matrix (built from the same sums)
  const vif = []
  if (K > 2) {
    const m = xtx[0].map((s) => s / N)
    const cov = (i, j) => xtx[i][j] / N - m[i] * m[j]
    const idx = Array.from({ length: K - 1 }, (_, i) => i + 1)
    const R = idx.map((i) => idx.map((j) => cov(i, j) / Math.sqrt(cov(i, i) * cov(j, j))))
    const Ri = invert(R)
    if (!Ri) throw new SavantError('Two or more predictors are exact copies of each other (or one is constant): drop one.')
    idx.forEach((i, k) => vif.push({ term: terms[i][0], vif: Ri[k][k] }))
  }
  const warnings = []
  const high = vif.filter((v) => v.vif > 5)
  if (high.length) warnings.push(`Badly correlated predictors (VIF over 5: ${high.map((v) => `${v.term} ${v.vif.toFixed(1)}`).join(', ')}): their separate coefficients are unstable, though their joint effect is not.`)
  if (c && G < 20) warnings.push(`Only ${G} clusters: cluster-robust errors are unreliable below about 20 to 30.`)
  if (!c) warnings.push('No cluster column: errors assume every row is independent. Rows from one game or team rarely are; name a cluster.')
  if (N < 10 * K) warnings.push(`${N} rows for ${K - 1} predictors is thin (under 10 per term).`)
  const names = terms.map(([n]) => n)
  let beta, cov, df, fit
  if (model === 'linear') {
    const f = olsFit(xtx, xty, syy, N, sy / N)
    if (!f) throw new SavantError('The predictors are collinear (one is a combination of others): drop one.')
    beta = f.beta
    if (c) {
      const e = `(${Y} - (${X.map((x, i) => `${num(beta[i])} * (${x})`).join(' + ')}))`
      const sc = (await ctx.q(`SELECT ${X.map((x) => `sum((${x}) * ${e})`).join(', ')} FROM $T WHERE ${complete} GROUP BY ${C}`)).rows
      cov = sandwich(f.Ainv, sc, crFactorLinear(sc.length, N, K)); df = sc.length - 1
    } else { cov = f.cov; df = f.df }
    fit = { r_squared: f.r2, adj_r_squared: f.r2 == null ? null : 1 - (1 - f.r2) * (N - 1) / (N - K), residual_sd: Math.sqrt(f.s2) }
  } else {
    beta = new Array(K).fill(0)
    let H = null, ll = null
    for (let it = 0; it < 30; it++) {
      const eta = X.map((x, i) => `${num(beta[i])} * (${x})`).join(' + ')
      const P = `(1.0 / (1.0 + exp(-(${eta}))))`
      const hs = []
      for (let i = 0; i < K; i++) for (let j = i; j < K; j++) hs.push(`sum((${X[i]}) * (${X[j]}) * ${P} * (1 - ${P}))`)
      const r = (await ctx.q(`SELECT ${hs.join(', ')}, ${X.map((x) => `sum((${x}) * (${Y} - ${P}))`).join(', ')}, sum(CASE WHEN ${Y} = 1 THEN ln(greatest(${P}, 1e-300)) ELSE ln(greatest(1 - ${P}, 1e-300)) END) FROM $T WHERE ${complete}`)).rows[0]
      H = Array.from({ length: K }, () => new Array(K).fill(0)); let q = 0
      for (let i = 0; i < K; i++) for (let j = i; j < K; j++) { H[i][j] = H[j][i] = r[q++] }
      const grad = r.slice(q, q + K); ll = r[q + K]
      const Hi = invert(H)
      if (!Hi) throw new SavantError('The logistic model did not converge (perfect separation, or collinear predictors).')
      const step = matVec(Hi, grad)
      beta = beta.map((b, i) => b + step[i])
      if (Math.max(...step.map(Math.abs)) < 1e-10) break
      if (it === 29) warnings.push('The logistic fit stopped at 30 iterations before fully converging.')
    }
    // final Hessian and log-likelihood at the converged beta
    const eta = X.map((x, i) => `${num(beta[i])} * (${x})`).join(' + ')
    const P = `(1.0 / (1.0 + exp(-(${eta}))))`
    const hs = []
    for (let i = 0; i < K; i++) for (let j = i; j < K; j++) hs.push(`sum((${X[i]}) * (${X[j]}) * ${P} * (1 - ${P}))`)
    const r = (await ctx.q(`SELECT ${hs.join(', ')}, sum(CASE WHEN ${Y} = 1 THEN ln(greatest(${P}, 1e-300)) ELSE ln(greatest(1 - ${P}, 1e-300)) END) FROM $T WHERE ${complete}`)).rows[0]
    H = Array.from({ length: K }, () => new Array(K).fill(0)); let q = 0
    for (let i = 0; i < K; i++) for (let j = i; j < K; j++) { H[i][j] = H[j][i] = r[q++] }
    ll = r[q]
    const Hi = invert(H)
    if (c) {
      const sc = (await ctx.q(`SELECT ${X.map((x) => `sum((${x}) * (${Y} - ${P}))`).join(', ')} FROM $T WHERE ${complete} GROUP BY ${C}`)).rows
      cov = sandwich(Hi, sc, crFactorLinear(sc.length, N, K)); df = Infinity
    } else { cov = Hi; df = Infinity }
    const ybar = sy / N
    const ll0 = N * (ybar * Math.log(ybar) + (1 - ybar) * Math.log(1 - ybar))
    fit = { log_loss: -ll / N, log_likelihood: ll, null_log_loss: -ll0 / N, pseudo_r_squared: 1 - ll / ll0 }
  }
  const coefs = coefTable(names, beta, cov, df)
  if (model === 'logistic') coefs.forEach((x) => { x.odds_ratio = Math.exp(x.estimate) })
  const moving = coefs.slice(1).filter((x) => x.p_value != null && x.p_value < 0.05)
  const say = (x) => `${x.term} ${model === 'logistic' ? `(odds ×${fmt(x.odds_ratio, 3)} per unit)` : `(${x.estimate >= 0 ? '+' : ''}${fmt(x.estimate, 3)} per unit)`}`
  return {
    interpretation: `${moving.length ? `Holding the other terms fixed, ${moving.map(say).join(', ')} ${moving.length === 1 ? 'is' : 'are'} associated with ${y} beyond what noise would explain (95% intervals exclude zero).` : `No term is associated with ${y} beyond what noise would explain, holding the others fixed.`} ${coefs.slice(1).filter((x) => !(x.p_value < 0.05)).length ? `Not distinguishable from zero: ${coefs.slice(1).filter((x) => !(x.p_value < 0.05)).map((x) => x.term).join(', ')}.` : ''} ${model === 'linear' ? `R² ${fmt(fit.r_squared, 3)}.` : `Log-loss ${fmt(fit.log_loss, 4)} against ${fmt(fit.null_log_loss, 4)} for the base rate alone.`} Associations, not causes: anything that moves with these predictors and the outcome is not held fixed.`,
    model, coefficients: coefs, fit, rows: N, clusters: c ? G : null, df: Number.isFinite(df) ? df : null,
    reference_levels: terms.reference || null, vif, warnings,
    method: `${model === 'linear' ? 'Least squares' : 'Logistic regression (Newton–Raphson)'} on ${N.toLocaleString('en-US')} complete rows${c ? `, standard errors clustered by ${c} (${G.toLocaleString('en-US')} clusters, CR1${model === 'logistic' ? ', normal intervals, as statsmodels' : ', t on G−1 degrees of freedom'})` : model === 'linear' ? ', classical standard errors' : ', standard errors from the information matrix'}. Categorical columns become indicators against their most common value.`,
  }
}

// ---- trend -----------------------------------------------------------------------------------------------
async function trend(args, ctx) {
  const y = column(ctx.cols, args.outcome, 'outcome', { numeric: true })
  const per = column(ctx.cols, args.period, 'period')
  const c = args.cluster ? column(ctx.cols, args.cluster, 'cluster') : null
  const Y = `CAST(${ctx.ident(y)} AS DOUBLE)`, P = `CAST(${ctx.ident(per)} AS VARCHAR)`, C = c ? `CAST(${ctx.ident(c)} AS VARCHAR)` : 'CAST(rowid AS VARCHAR)'
  if (!c && ctx.n > 500000) throw new SavantError(`${ctx.n.toLocaleString('en-US')} rows with no cluster column: name one (game_id, team, player).`)
  const rows = (await ctx.q(`SELECT ${P}, ${C}, count(*), sum(${Y}), sum(${Y} * ${Y}), bool_and(${Y} IN (0, 1)) FROM $T WHERE ${Y} IS NOT NULL AND ${P} IS NOT NULL GROUP BY 1, 2`)).rows
  const periods = [...new Set(rows.map((r) => r[0]))].sort()
  if (periods.length < 2) throw new SavantError('A trend needs at least two periods.')
  if (periods.length > 80) throw new SavantError(`${periods.length} periods; the limit is 80.`)
  const binary = rows.every((r) => r[5] === true)
  const idx = new Map(periods.map((p, i) => [p, i]))
  const by = periods.map(() => ({ n: 0, s1: 0, s2: 0, cl: new Map() }))
  const cl = new Map()
  for (const [p, k, n, s1, s2] of rows) {
    const i = idx.get(p), b = by[i]; b.n += n; b.s1 += s1; b.s2 += s2; b.cl.set(k, (b.cl.get(k) || [0, 0]).map((v, j) => v + [n, s1][j]))
    let e = cl.get(k); if (!e) { e = []; cl.set(k, e) } e.push([i, n, s1])
  }
  const out = by.map((b, i) => {
    const m = b.s1 / b.n
    let u = 0; for (const [nn, ss] of b.cl.values()) u += (ss - m * nn) ** 2
    const Gp = b.cl.size
    const se = c ? Math.sqrt((Gp / (Gp - 1)) * u) / b.n : Math.sqrt(Math.max(0, (b.s2 - b.n * m * m) / (b.n - 1)) / b.n)
    const df = c ? Gp - 1 : b.n - 1
    const q = df > 0 ? tQuantile(0.975, df) : NaN
    return { period: periods[i], n: b.n, clusters: c ? Gp : null, value: m, ci_low: m - q * se, ci_high: m + q * se, std_error: se }
  })
  // slope across periods (period index 0..P−1), least squares on every row, errors clustered
  let N = 0, Sx = 0, Sxx = 0, Sy = 0, Sxy = 0
  for (const b of by.map((b, i) => [b, i])) { const [v, i] = b; N += v.n; Sx += i * v.n; Sxx += i * i * v.n; Sy += v.s1; Sxy += i * v.s1 }
  const A = invert([[N, Sx], [Sx, Sxx]])
  const beta = matVec(A, [Sy, Sxy])
  const scores = [...cl.values()].map((list) => list.reduce((s, [i, n, s1]) => { const e = s1 - (beta[0] + beta[1] * i) * n; return [s[0] + e, s[1] + i * e] }, [0, 0]))
  const G = scores.length
  const covS = sandwich(A, scores, crFactorLinear(G, N, 2))
  const seS = Math.sqrt(covS[1][1]), dfS = G - 1, qS = tQuantile(0.975, dfS)
  const slope = { per_period: beta[1], ci_low: beta[1] - qS * seS, ci_high: beta[1] + qS * seS, p_value: twoSidedP(beta[1] / seS, dfS) }
  // last against first, cluster-robust (two periods only)
  const f = 0, l = periods.length - 1
  const pair = []
  for (const list of cl.values()) { let nf = 0, sf = 0, nl = 0, sl = 0; for (const [i, n, s1] of list) { if (i === f) { nf += n; sf += s1 } if (i === l) { nl += n; sl += s1 } } if (nf || nl) pair.push({ n: Float64Array.from([nf, nl]), s: Float64Array.from([sf, sl]) }) }
  const d = out[l].value - out[f].value
  const an = twoGroupCR(pair, 0, 1, out[f].value, d, true)
  const lastFirst = { from: periods[f], to: periods[l], difference: d, ...(an ? { ci_low: an.ci_low, ci_high: an.ci_high, p_value: an.p_value } : {}) }
  const adj = holm([slope.p_value, lastFirst.p_value ?? null])
  slope.p_adjusted = adj[0]; lastFirst.p_adjusted = adj[1]
  const warnings = out.filter((o) => o.n < MIN_N || (c && o.clusters < MIN_CLUSTERS)).map((o) => `${o.period} has ${o.n} observations${c ? ` from ${o.clusters} clusters` : ''}: its interval is wide or unreliable.`)
  if (!c) warnings.push('No cluster column: rows were treated as independent. Name a cluster (game_id, team, player) for honest intervals.')
  const show = (x) => (binary ? pct(x) : fmt(x, 4))
  const beyond = slope.p_adjusted < 0.05 || (lastFirst.p_adjusted != null && lastFirst.p_adjusted < 0.05)
  return {
    interpretation: `${y} went from ${show(out[f].value)} in ${periods[f]} to ${show(out[l].value)} in ${periods[l]}. ${beyond ? 'The change is beyond what noise would explain' : 'The change is within what noise could produce'} (slope ${binary ? `${(100 * slope.per_period).toFixed(2)} points` : fmt(slope.per_period, 3)} per period, 95% interval ${binary ? `${(100 * slope.ci_low).toFixed(2)} to ${(100 * slope.ci_high).toFixed(2)}` : `${fmt(slope.ci_low, 3)} to ${fmt(slope.ci_high, 3)}`}). A trend in the rows, not its cause.`,
    periods: out, slope, last_vs_first: lastFirst, binary, clusters: c ? G : null,
    multiple_comparisons: 'Two tests (the slope, and the last period against the first); p-values are Holm-adjusted.',
    warnings,
    method: `Each period's ${binary ? 'rate' : 'mean'} with a 95% interval from ${c ? `errors clustered by ${c}` : 'its standard error'}; the slope is least squares of the outcome on the period's position (0, 1, 2 …) over every row, ${c ? 'cluster-robust (CR1)' : 'classical'}; periods sort as text (seasons and YYYY-MM dates sort in time).`,
  }
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`

// ---- distribution ------------------------------------------------------------------------------------------
async function distribution(args, ctx) {
  const v = column(ctx.cols, args.value, 'value', { numeric: true })
  const id = args.id ? column(ctx.cols, args.id, 'id') : null
  if (!args.pool || String(args.pool).trim().length < 3) throw new SavantError('Name the pool in words (pool: "qualified NBA guards, 2024-25"): a percentile means nothing without it.')
  const rows = (await ctx.q(`SELECT ${id ? `CAST(${ctx.ident(id)} AS VARCHAR)` : 'NULL'}, CAST(${ctx.ident(v)} AS DOUBLE) FROM $T WHERE ${ctx.ident(v)} IS NOT NULL`)).rows
  if (rows.length < 5) throw new SavantError(`The pool has ${rows.length} members; at least 5 are needed.`)
  const vals = rows.map((r) => r[1]).sort((a, b) => a - b)
  let target = args.target
  let who = null
  if (args.target_id != null) {
    if (!id) throw new SavantError('target_id needs id: the column that names each member.')
    const hit = rows.filter((r) => r[0] === String(args.target_id))
    if (!hit.length) throw new SavantError(`"${args.target_id}" is not in the pool.`)
    if (hit.length > 1) throw new SavantError(`"${args.target_id}" appears ${hit.length} times in the pool; give one row per member.`)
    target = hit[0][1]; who = String(args.target_id)
  }
  const n = vals.length
  const mean = vals.reduce((s, x) => s + x, 0) / n
  const sd = Math.sqrt(vals.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
  const summary = { n, mean, sd, min: vals[0], p10: quantile(vals, 0.1), p25: quantile(vals, 0.25), median: quantile(vals, 0.5), p75: quantile(vals, 0.75), p90: quantile(vals, 0.9), max: vals[n - 1] }
  let percentile = null
  if (target != null) {
    const t = Number(target)
    if (!Number.isFinite(t)) throw new SavantError('target must be a number.')
    let below = 0, equal = 0
    for (const x of vals) { if (x < t) below++; else if (x === t) equal++ }
    const p = (100 * (below + 0.5 * equal)) / n
    percentile = args.higher_is_better === false ? 100 - p : p
    target = t
  }
  return {
    interpretation: target != null ? `${who || String(target)} sits at the ${ordinal(Math.round(percentile))} percentile of ${args.pool} (${n.toLocaleString('en-US')} members; median ${fmt(summary.median, 4)}).` : `${args.pool}: ${n.toLocaleString('en-US')} members, median ${fmt(summary.median, 4)}, middle half ${fmt(summary.p25, 4)} to ${fmt(summary.p75, 4)}.`,
    pool: args.pool, target, target_id: who, percentile, higher_is_better: args.higher_is_better !== false, summary,
    warnings: n < 30 ? [`The pool has ${n} members: one place in it moves the percentile by ${(100 / n).toFixed(1)} points.`] : [],
    method: `Percentile = the share of the pool below the value, ties counted half${args.higher_is_better === false ? ', flipped because lower is better' : ''}. Quartiles by linear interpolation. The pool is exactly the rows your SQL returned.`,
  }
}

// ---- stability -------------------------------------------------------------------------------------------
const K_GRID = [...new Set(Array.from({ length: 161 }, (_, i) => Math.round(10 ** (i / 40) * 10) / 10))].sort((a, b) => a - b)
const N_SPLITS = 200

async function stability(args, ctx) {
  const pl = column(ctx.cols, args.player, 'player')
  const se = column(ctx.cols, args.season || 'season', 'season')
  const dt = column(ctx.cols, args.date || 'date', 'date')
  const nu = column(ctx.cols, args.numerator, 'numerator', { numeric: true })
  const de = column(ctx.cols, args.denominator, 'denominator', { numeric: true })
  const window = args.window === 'team_last_25' ? 'team_last_25' : 'last_third'
  const tm = window === 'team_last_25' ? column(ctx.cols, args.team || 'team', 'team') : null
  const pool = args.pool ? column(ctx.cols, args.pool, 'pool') : null
  const rows = (await ctx.q(`SELECT CAST(${ctx.ident(se)} AS VARCHAR), CAST(${ctx.ident(pl)} AS VARCHAR), CAST(${ctx.ident(dt)} AS VARCHAR), CAST(${ctx.ident(nu)} AS DOUBLE), CAST(${ctx.ident(de)} AS DOUBLE), ${tm ? `CAST(${ctx.ident(tm)} AS VARCHAR)` : 'NULL'}, ${pool ? `CAST(${ctx.ident(pool)} AS VARCHAR)` : 'NULL'} FROM $T WHERE ${ctx.ident(de)} > 0 AND ${ctx.ident(nu)} IS NOT NULL ORDER BY 1, 2, 3`)).rows
  if (rows.length < 200) throw new SavantError(`Only ${rows.length} game rows: too few to measure stability.`)
  // player-seasons
  const ps = new Map()
  for (const r of rows) { const k = `${r[0]}\u0001${r[1]}`; let e = ps.get(k); if (!e) { e = { season: r[0], player: r[1], pool: r[6], games: [] }; ps.set(k, e) } e.games.push(r) }
  const list = [...ps.values()]
  const minS = Number(args.min_sample) || 0
  const qual = list.filter((p) => p.games.reduce((s, g) => s + g[4], 0) >= minS)
  if (qual.length < 40) throw new SavantError(`Only ${qual.length} qualified player-seasons (40 are needed). Lower min_sample or widen the seasons.`)
  const rand = rng(seedOf(JSON.stringify({ s: args.sql, nu, de, minS })))
  // split-half (player_study.split_half): each player-season's games shuffled and dealt alternately into
  // two halves; each half's rate, demeaned within its season; Pearson r; 200 splits averaged.
  // Each player-season's games as two typed arrays, shuffled in place (Fisher–Yates) on every split and
  // dealt alternately: the same exact half split as player_study's random-rank parity, without a sort.
  const nums = qual.map((p) => Float64Array.from(p.games, (g) => g[3]))
  const dens = qual.map((p) => Float64Array.from(p.games, (g) => g[4]))
  const seasonIx = new Map()
  const sIdx = Int32Array.from(qual, (p) => { if (!seasonIx.has(p.season)) seasonIx.set(p.season, seasonIx.size); return seasonIx.get(p.season) })
  const S = seasonIx.size
  const maxLen = Math.max(...qual.map((p) => p.games.length))
  const perm = new Int32Array(maxLen)
  const A = new Float64Array(qual.length), Bv = new Float64Array(qual.length), ok = new Uint8Array(qual.length)
  const rs = [], nbars = []
  for (let it = 0; it < N_SPLITS; it++) {
    let d0 = 0, d1 = 0
    const sumA = new Float64Array(S), sumB = new Float64Array(S), cnt = new Float64Array(S)
    for (let i = 0; i < qual.length; i++) {
      const nu = nums[i], de = dens[i], n = nu.length
      for (let j = 0; j < n; j++) perm[j] = j
      for (let j = n - 1; j > 0; j--) { const k = (rand() * (j + 1)) | 0; const t = perm[j]; perm[j] = perm[k]; perm[k] = t }
      let n0 = 0, q0 = 0, n1 = 0, q1 = 0
      for (let j = 0; j < n; j++) { const g = perm[j]; if (j % 2 === 0) { n0 += nu[g]; q0 += de[g] } else { n1 += nu[g]; q1 += de[g] } }
      d0 += q0; d1 += q1
      ok[i] = q0 > 0 && q1 > 0 ? 1 : 0
      if (ok[i]) { A[i] = n0 / q0; Bv[i] = n1 / q1; sumA[sIdx[i]] += A[i]; sumB[sIdx[i]] += Bv[i]; cnt[sIdx[i]]++ }
    }
    // each half's rate demeaned within its season, then Pearson r
    const a = [], b = []
    for (let i = 0; i < qual.length; i++) if (ok[i]) { const k = sIdx[i]; a.push(A[i] - sumA[k] / cnt[k]); b.push(Bv[i] - sumB[k] / cnt[k]) }
    const r = pearson(a, b)
    if (Number.isFinite(r)) { rs.push(r); nbars.push((d0 / qual.length + d1 / qual.length) / 2) }
  }
  const r = rs.reduce((x, y) => x + y, 0) / rs.length
  const rSd = Math.sqrt(rs.reduce((x, y) => x + (y - r) ** 2, 0) / rs.length)
  const nbar = nbars.reduce((x, y) => x + y, 0) / nbars.length
  const full = (2 * r) / (1 + r)
  const kFormula = r > 0.02 ? (nbar * (1 - r)) / r : Infinity
  const typical = quantile(qual.map((p) => p.games.reduce((s, g) => s + g[4], 0)).sort((x, y) => x - y), 0.5)
  // the settle point: the k that best predicts the rest of a season from a window of it, shrinking toward a prior.
  const pairs = []
  if (window === 'last_third') {
    // player_study.settle_grid: window = his last third of games (at least 2), prior = the season's rate over every row
    const mu = new Map()
    for (const p of qual) { const e = mu.get(p.season) || [0, 0]; for (const g of p.games) { e[0] += g[3]; e[1] += g[4] } mu.set(p.season, e) }
    for (const p of qual) {
      const g = p.games, n = g.length
      if (n < 6) continue
      const w = Math.max(2, Math.ceil(n / 3))
      const win = g.slice(-w), rest = g.slice(0, n - w)
      const nw = win.reduce((s, x) => s + x[4], 0), nf = rest.reduce((s, x) => s + x[4], 0)
      if (nw <= 0 || nf < 0.5 * (nw + nf)) continue
      const m = mu.get(p.season)
      pairs.push([nw, win.reduce((s, x) => s + x[3], 0) / nw, rest.reduce((s, x) => s + x[3], 0) / nf, m[0] / m[1], -Infinity, Infinity])
    }
  } else {
    // settle_points.py: window = the team's last 25 games of the season; prior = the qualified mean of
    // player rates (by pool, e.g. position, when given), clamped to the qualified range
    const lastDates = new Map()
    const teamDates = new Map()
    for (const r of rows) { const k = `${r[0]}\u0001${r[5]}`; let s = teamDates.get(k); if (!s) { s = new Set(); teamDates.set(k, s) } s.add(r[2]) }
    for (const [k, s] of teamDates) lastDates.set(k, new Set([...s].sort().slice(-25)))
    const means = new Map()
    for (const p of qual) { const n = p.games.reduce((s, g) => s + g[3], 0), d = p.games.reduce((s, g) => s + g[4], 0); const k = `${p.season}\u0001${p.pool}`; const e = means.get(k) || []; e.push(n / d); means.set(k, e) }
    for (const p of qual) {
      const ms = means.get(`${p.season}\u0001${p.pool}`); if (!ms || ms.length < 5) continue
      const mu = ms.reduce((s, x) => s + x, 0) / ms.length, lo = Math.min(...ms), hi = Math.max(...ms)
      let nw = 0, xw = 0, ns = 0, xs = 0
      for (const g of p.games) { ns += g[4]; xs += g[3]; const last = lastDates.get(`${g[0]}\u0001${g[5]}`); if (last && last.has(g[2])) { nw += g[4]; xw += g[3] } }
      const nf = ns - nw
      if (nf < 0.5 * ns || nw <= 0) continue
      pairs.push([nw, xw / nw, (xs - xw) / nf, mu, lo, hi])
    }
  }
  let settle = null
  if (pairs.length >= 60) {
    const rmse = (k) => Math.sqrt(pairs.reduce((s, [nw, vw, vf, mu, lo, hi]) => { const prior = Math.max(lo, Math.min(hi, mu)); const e = (nw * vw + k * prior) / (nw + k) - vf; return s + e * e }, 0) / pairs.length)
    let best = null
    for (const k of K_GRID) { const e = rmse(k); if (!best || e < best[1]) best = [k, e] }
    settle = { k: best[0], pairs: pairs.length, rmse_raw: rmse(0), rmse_settled: best[1], method: window === 'team_last_25' ? "settle_points.py: the team's last 25 games against the rest of the season" : "player_study.py: the last third of his games against the rest of his season" }
  }
  const verdict = !Number.isFinite(full) ? 'too few' : full >= 0.5 ? 'skill (a full bar on the Savant pages)' : full >= 0.3 ? 'part skill (hatched on the Savant pages)' : full >= 0.15 ? 'mostly noise (context only)' : 'noise (dropped on the Savant pages)'
  const published = args.stat && SETTLE_K[args.stat] ? { stat: args.stat, k_mean_prior: SETTLE_K[args.stat][0], k_with_last_season: SETTLE_K[args.stat][1], unit: settleUnit(args.stat), source: 'Basketball Savant SETTLE_K (pipeline/basketball/settle_points.py)' } : null
  const warnings = []
  if (window === 'team_last_25' && !pool) warnings.push('No pool column (position): the prior is the qualified league mean, where the Basketball Savant fit uses the position mean, so k can differ somewhat from the published one.')
  if (rSd > 0.1) warnings.push(`The split-half correlation varies a lot between splits (SD ${rSd.toFixed(2)}): few or small player-seasons.`)
  return {
    interpretation: `Over a typical season (${fmt(typical, 3)} in its sample unit), this stat is ${verdict}: split-half reliability ${fmt(full, 2)} for a full season (two random halves correlate at ${fmt(r, 2)}).${settle ? ` It settles at about ${fmt(settle.k, 3)}: at that sample a player's own number and the average deserve equal weight.` : ''}${published ? ` Basketball Savant's published settle point for ${args.stat} is ${published.k_mean_prior} ${published.unit}.` : ''}`,
    player_seasons: qual.length, game_rows: rows.length, typical_sample: typical,
    split_half: { r, sd: rSd, splits: rs.length, full_season_reliability: full, half_sample: nbar }, settle, settle_k_formula: kFormula,
    verdict, published, warnings,
    method: `Split-half: ${rs.length} random splits of each player-season's games (seeded), each half's rate demeaned within its season, Pearson r averaged, stepped up to a full season with Spearman–Brown (2r/(1+r)). Settle point: grid search (1 to 10,000) for the k whose estimate (n·x + k·prior)/(n + k) from the window best predicts the rest of the season (lowest RMSE), ${settle ? settle.method : 'not enough pairs (60 needed)'}. Closed form for comparison: k = n(1−r)/r. Verdict thresholds as on the Savant pages: 0.5 full bar, 0.3 hatched, 0.15 context.`,
  }
}

const STUDIES = { compare, regress, trend, distribution, stability }
export const STUDY_NAMES = Object.keys(STUDIES)

export async function analyze(args = {}) {
  const fn = STUDIES[args.study]
  if (!fn) throw new SavantError(`Pick a study: ${STUDY_NAMES.join(', ')}.`)
  const res = await withObservations(args.sql, (ctx) => fn(args, ctx))
  return res
}
