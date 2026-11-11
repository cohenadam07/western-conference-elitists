// Ad-hoc: run SQL or a study against the live release from this Mac. node tools/analysis/try.mjs '<sql>' | --study '<json>'
process.env.SQL_TMP = process.env.SQL_TMP || (await import('node:os')).tmpdir()
const [, , a, b] = process.argv
const S = await import('../../api/_sql.js')
const A = await import('../../api/_analyze.js')
const t = Date.now()
try {
  const r = a === '--study' ? await A.analyze(JSON.parse(b)) : await S.runSql(a)
  console.log(JSON.stringify(r, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v)).slice(0, Number(process.env.MAXOUT) || 3000))
} catch (e) { console.log('ERR', e.message) }
console.log('ms', Date.now() - t)
