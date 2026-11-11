// api/_analysis.js — WCE Pro analysis: savant_sql and savant_analyze (research/analysis/BUILD.md).
//
// Listed only on a connector address whose key carries the founder tier (api/_keys.js `tier`), or on
// every valid key once PRO_ANALYSIS_OPEN is on (api/mcp.js analysisFor). Nothing is charged: the data
// sources' terms limit commercial use, so there is no paywall, price or payment code anywhere.
//
//   savant_sql       one read-only SELECT over every Data Room table (api/_sql.js: the engine and its locks)
//   savant_analyze   a study over the full data with its confidence built in (api/_analyze.js)
//
// Not a function itself: Vercel skips api files that start with an underscore.

import { z } from 'zod'
import { READ_ONLY, SavantError } from './_core.js'

const SOURCE = 'The WCE Data Room, Western Conference Elitists (wcehoops.com), computed on WCE\'s server'
export const COMPUTED = 'Every number here is computed by this query from the Data Room\'s rows (counts, sums, averages and the like over the rows it read); no Savant page shows it as such.'
const open = z.object({}).passthrough()
const lazySql = () => import('./_sql.js')
const lazyAnalyze = () => import('./_analyze.js')

const short = (v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v)

export async function savantSql({ sql, max_rows: maxRows = 500 } = {}) {
  const { runSql, MAX_ROWS } = await lazySql()
  const r = await runSql(sql, { maxRows: Math.min(MAX_ROWS, Math.max(1, maxRows)) })
  const through = Object.entries(r.through).map(([t, d]) => `${t} through ${d || 'unknown'}`).join('; ')
  const scanned = r.scanned ? `${(r.scanned.row_groups_read || 0).toLocaleString('en-US')} row groups read (of ${(r.scanned.row_groups_in_files || 0).toLocaleString('en-US')} in the files scanned)${r.bytes_read != null ? `, ${(r.bytes_read / 1e6).toFixed(1)} MB fetched` : ''}` : 'not measured'
  const structured = {
    columns: r.columns, types: r.types, rows: r.rows, row_count: r.total, rows_returned: r.rows.length, truncated: r.truncated,
    scanned: { ...(r.scanned || {}), bytes_fetched: r.bytes_read }, tables: r.tables, data_through: r.through,
    ms: r.ms, computed: true, computed_note: COMPUTED, source: SOURCE,
  }
  const text = [
    `savant_sql: ${r.total.toLocaleString('en-US')} row${r.total === 1 ? '' : 's'}${r.truncated ? `; the first ${r.rows.length} are below (rows are capped at ${MAX_ROWS}: aggregate, filter or ORDER BY … LIMIT to see the rest)` : ''}. Columns: ${r.columns.map((c, i) => `${c} (${r.types[i].toLowerCase()})`).join(', ')}.`,
    ...r.rows.slice(0, 60).map((row) => JSON.stringify(row.map(short))),
    r.rows.length > 60 ? `… ${r.rows.length - 60} more rows in the structured result` : '',
    '',
    `Data through: ${through}. Scanned: ${scanned}. ${(r.ms / 1000).toFixed(1)} s.`,
    `${COMPUTED} Column definitions: savant_dictionary. Source: ${SOURCE}.`,
  ].filter((x) => x !== '').join('\n')
  return { structured, text }
}

export async function savantAnalyze(args = {}) {
  const { analyze } = await lazyAnalyze()
  const r = await analyze(args)
  const through = Object.entries(r.through || {}).map(([t, d]) => `${t} through ${d || 'unknown'}`).join('; ')
  const { interpretation, warnings = [], method, tables, observations, ms, bytes_read: bytes, through: th, multiple_comparisons: mc, ...numbers } = r
  const cannot = cannotAccount(args)
  const structured = { study: args.study, interpretation, ...numbers, warnings, multiple_comparisons: mc || null, cannot_account_for: cannot, method, observations, tables, data_through: th, ms, computed: true, source: SOURCE }
  const text = [
    interpretation,
    warnings.length ? `Warnings: ${warnings.join(' ')}` : '',
    mc ? `Multiple comparisons: ${mc}` : '',
    `What this cannot account for: ${cannot.join(' ')}`,
    '',
    `Numbers: ${JSON.stringify(numbers, (k, v) => short(v))}`.slice(0, 6000),
    '',
    `Method: ${method}`,
    `Sample: ${Number(observations).toLocaleString('en-US')} rows from ${tables.join(', ')}. Data through: ${through}. ${(ms / 1000).toFixed(1)} s. Computed on WCE's server from the Data Room's rows. Source: ${SOURCE}.`,
  ].filter((x) => x !== '').join('\n')
  return { structured, text }
}

// What no study over these rows can see, by kind of study: said every time, not left to the reader.
function cannotAccount(args) {
  const out = ['These are observational rows, so any gap or coefficient is an association: whatever moves with both the groups (or predictors) and the outcome is not held fixed unless it is in the model.']
  if (args.study === 'compare' || args.study === 'trend') out.push('Not adjusted for opponent, venue, score or roster unless your SQL restricts or groups by them.')
  if (args.study === 'regress') out.push('Only the predictors named are held fixed; their linear form is assumed (add squares or groups in the SQL to test that).')
  if (args.study === 'stability') out.push('Split-half reliability measures within-season consistency, not whether the skill carries to next season or a new team.')
  if (args.study === 'distribution') out.push('The percentile is only as meaningful as the pool your SQL defined; it is not opponent-adjusted.')
  if (/plays/.test(String(args.sql || ''))) out.push('Play-level rows: plays within a game share conditions, which is why the cluster column matters.')
  return out
}

// ---- the guides (out of the up-front text: an assistant asks for them) ----------------------------
const ROLES = {
  compare: { columns: 'outcome (number or 0/1), group, cluster (game_id for plays and shots; team or player for seasons)', options: 'reference (the group the others are measured against), stat (a Basketball Savant key such as tp3 for its settle point), resamples (200 to 5,000; default 2,000)', returns: "each group's mean or rate and sample; each difference from the reference with a 95% interval and p-value from a bootstrap that resamples whole clusters; the cluster-robust analytic test beside it; Cohen's d or h; a verdict (real, real but small, probably noise, too few); Holm-adjusted p-values when there are 3+ groups" },
  regress: { columns: 'outcome, predictors (a list of numeric columns), categorical (a list: each value becomes an indicator against the most common), cluster', options: 'model: linear (default) or logistic (0/1 outcome)', returns: 'coefficients (odds ratios for logistic) with 95% intervals and p-values, errors clustered by the column named (CR1), R² or log-loss against the base rate, VIFs and a warning when predictors are badly correlated' },
  stability: { columns: 'player, season, date, numerator, denominator (one row per player-game), team (for team_last_25), pool (a column to take the prior within, e.g. position)', options: 'window: last_third (pipeline/cfb/player_study.py) or team_last_25 (pipeline/basketball/settle_points.py); min_sample (a player-season\'s denominator to qualify); stat (a Basketball Savant key for its published settle point)', returns: 'split-half reliability (200 seeded splits, Spearman–Brown to a full season), the settle point k by grid search, the closed-form k, the Savant bar verdict (full ≥ 0.5, hatched ≥ 0.3, context ≥ 0.15)' },
  trend: { columns: 'outcome, period (season, or a YYYY-MM month), cluster', options: '', returns: 'each period with a 95% interval; the slope per period and the last period against the first, cluster-robust, Holm-adjusted' },
  distribution: { columns: 'value, id (names each member)', options: 'pool (the pool in words: required), target (a value) or target_id (a member), higher_is_better (default true)', returns: 'the percentile (share of the pool below, ties half) and the pool\'s n, mean, SD and quantiles' },
}
export function guide(study) {
  const studies = study && ROLES[study] ? [study] : Object.keys(ROLES)
  const L = ['savant_analyze: give study, sql (one SELECT under savant_sql\'s rules, one row per observation), columns {role: column name} and options {}.', '']
  for (const s of studies) L.push(`${s}: columns ${ROLES[s].columns}.${ROLES[s].options ? ` Options: ${ROLES[s].options}.` : ''} Returns ${ROLES[s].returns}.`)
  L.push('', 'Every answer leads with a plain-language reading, then the numbers; states its samples; warns when a group is too small; names what it cannot account for. Associations, not causes.')
  return { structured: { guide: Object.fromEntries(studies.map((s) => [s, ROLES[s]])) }, text: L.join('\n') }
}
export const SQL_RULES = 'savant_sql: one read-only SELECT (or WITH … SELECT) in DuckDB SQL. Tables are <sport>.<table> (dictionary: {} lists them); each has season (\'2024-25\' NBA and college basketball, \'2025\' otherwise), and WHERE season = … or season IN (…) reads only those seasons. Dates are DATE values. Allowed: any SQL over the tables, CTEs, window functions, range/generate_series/unnest. Refused: writes, COPY, ATTACH, INSTALL, LOAD, SET, PRAGMA, file and URL functions, system catalogs, a second statement. Limits: 500 rows back (with the full count), a 22-second run, about 25 MB of columns per scan (SELECT * over every season of a big table is past it: name columns, filter seasons, aggregate).'

const sqlText = z.string()   // length and content are checked by the engine (api/_sql.js checkSql)
const lazyRoom = () => import('./_dataroom.js')

export const tools = [
  {
    name: 'savant_sql',
    config: {
      title: 'Read-only SQL over every WCE Data Room table',
      description: 'WCE Pro: one read-only DuckDB SELECT over every Data Room table and season, run on WCE\'s server. Tables <sport>.<table> (nba.shots, nfl.plays, cbb.games …), each with season (filter it to read fewer). 500 rows back, with the full count, rows scanned and data-through dates. dictionary: {} lists tables, {sport, table} their columns. Neither: the rules.',
      inputSchema: {
        sql: sqlText.optional(),
        dictionary: z.object({ sport: z.string().optional(), table: z.string().optional() }).optional(),
      },
      outputSchema: z.object({ computed: z.boolean().optional(), source: z.string().optional() }).passthrough(),
      annotations: { title: 'Read-only SQL over every WCE Data Room table', ...READ_ONLY },
    },
    run: async (args) => {
      if (args.dictionary && args.dictionary.sport != null && !['nba', 'nfl', 'cfb', 'cbb', 'ufc'].includes(args.dictionary.sport)) throw new SavantError('dictionary.sport is one of nba, nfl, cfb, cbb, ufc.')
      if (args.dictionary) return (await lazyRoom()).savantDictionary(args.dictionary)
      if (!args.sql) return { structured: { rules: SQL_RULES }, text: SQL_RULES }
      return savantSql(args)
    },
  },
  {
    name: 'savant_analyze',
    config: {
      title: 'A statistical study over the WCE Data Room',
      description: 'WCE Pro: a study over the full Data Room, confidence built in. compare (is a gap real?), regress (what moves an outcome), stability (skill or noise; settle point), trend (has it changed?), distribution (percentile in a named pool). sql gives one row per observation; columns maps roles to its columns. Intervals, clustered errors, samples, a plain verdict. Send study alone first for its roles.',
      inputSchema: {
        study: z.enum(['compare', 'regress', 'stability', 'trend', 'distribution']),
        sql: sqlText.optional(),
        columns: open.optional(),
        options: open.optional(),
      },
      outputSchema: z.object({ study: z.string().optional(), interpretation: z.string().optional() }).passthrough(),
      annotations: { title: 'A statistical study over the WCE Data Room', ...READ_ONLY },
    },
    run: (args) => {
      if (!args.sql) return guide(args.study)
      for (const [k, v] of Object.entries(args.columns || {})) if (!(typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')))) throw new SavantError(`columns.${k} must be a column name (or, for predictors and categorical, a list of them).`)
      const flat = { ...(args.options || {}), ...(args.columns || {}), study: args.study, sql: args.sql }
      // distribution's pool is words (an option); stability's pool is a column: the role wins for stability.
      if (args.study === 'distribution') flat.pool = (args.options || {}).pool ?? (args.columns || {}).pool
      if (args.study === 'distribution' && !flat.pool) throw new SavantError('Name the pool in words: options.pool ("qualified NBA guards, 2024-25").')
      return savantAnalyze(flat)
    },
  },
]
export const ANALYSIS_TOOLS = tools.map((t) => t.name)
// What the analysis tools stand in for on the addresses that list them: savant_sql answers every
// savant_data question (any table, any filter, any season, 500 rows) and every savant_dictionary one.
export const REPLACED = ['savant_data', 'savant_dictionary']
