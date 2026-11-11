// tools/analysis/run.mjs — run SQL (or studies) through the real engine, for the Python checks.
//   echo '{"sql": ["SELECT ..."], "studies": [{...}]}' | node tools/analysis/run.mjs
// Reads the local Parquet copies (tools/analysis/serve.mjs) unless ANALYSIS_REMOTE=1 (the live release).
// Every row comes back (maxRows lifted): this is the engine under test, not the tool's 500-row cap.
import { start } from './serve.mjs'
const chunks = []
for await (const c of process.stdin) chunks.push(c)
const job = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const srv = process.env.ANALYSIS_REMOTE === '1' ? null : await start()
const S = await import('../../api/_sql.js')
const A = await import('../../api/_analyze.js')
const out = { sql: [], studies: [], observations: [] }
for (const q of job.sql || []) {
  try { const r = await S.runSql(q, { maxRows: 1e7, wallMs: 120000, budget: 1e9 }); out.sql.push({ columns: r.columns, rows: r.rows, ms: r.ms }) } catch (e) { out.sql.push({ error: e.message }) }
}
for (const st of job.studies || []) {
  try { out.studies.push(await A.analyze(st)) } catch (e) { out.studies.push({ error: e.message }) }
}
for (const q of job.observations || []) {   // a study's rows, exactly as the study sees them
  try { out.observations.push(await S.withObservations(q, async (ctx) => ({ columns: ctx.cols.map((c) => c[0]), rows: (await ctx.q('SELECT * FROM $T')).rows }), { wallMs: 120000, budget: 1e9 })) } catch (e) { out.observations.push({ error: e.message }) }
}
// To a file when asked (a pipe can be cut short by the exit below), else stdout.
if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(out))
else await new Promise((r) => process.stdout.write(JSON.stringify(out), r))
if (srv) await srv.close()
process.exit(0)
