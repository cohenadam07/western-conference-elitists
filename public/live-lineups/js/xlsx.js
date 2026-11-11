// Fill Lucas's tracker by editing the workbook's XML in place. Only the Stint Log input cells (and, when needed, new Roster
// rows) change; every other byte of the template is carried over, so dropdowns, red error flags, notes, frozen panes,
// column widths and every formula survive by construction.
// Why not ExcelJS: its round trip of this template dropped 10 column widths and duplicated both dropdown ranges
// (tools/live-lineups/xlsx_compare.py, Nov 11 2026). Pure JS, so the page stays serverless; JSZip is passed in.

const INPUTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AP'];
export const MAX_ROWS = 999; // the template's formulas run to row 1000

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export const normName = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z]/g, '');
const lastOf = s => { const p = String(s).trim().split(/\s+/); return (['Jr.', 'Sr.', 'II', 'III', 'IV', 'Jr'].includes(p[p.length - 1]) && p.length > 1 ? p[p.length - 2] : p[p.length - 1]).toLowerCase(); };
export function excelSerial({ y, m, d }) { return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; }

function splitRows(xml) { // [head, row2chunk, row3chunk, ..., (tail inside last chunk)]
  const parts = xml.split(/(?=<row )/); const byRow = new Map();
  parts.forEach((p, i) => { const m = /^<row r="(\d+)"/.exec(p); if (m) byRow.set(Number(m[1]), i); });
  return { parts, byRow };
}
function cellXml(ref, s, v) {
  const sa = s ? ` s="${s}"` : '';
  if (v === null || v === undefined || v === '') return `<c r="${ref}"${sa}/>`;
  if (typeof v === 'number') return `<c r="${ref}"${sa} t="n"><v>${v}</v></c>`;
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}
function setCells(chunk, row, vals) { // vals: {col: value}
  for (const [col, v] of Object.entries(vals)) {
    const ref = `${col}${row}`;
    const re = new RegExp(`<c r="${ref}"(\\s[^>]*?)?(?:/>|>[\\s\\S]*?</c>)`);
    const m = re.exec(chunk);
    if (m) { const s = /\ss="(\d+)"/.exec(m[1] || ''); chunk = chunk.slice(0, m.index) + cellXml(ref, s && s[1], v) + chunk.slice(m.index + m[0].length); }
    else { // insert in column order
      const colNum = c => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
      const cells = [...chunk.matchAll(/<c r="([A-Z]+)\d+"/g)]; let at = chunk.indexOf('</row>');
      for (const c of cells) if (colNum(c[1]) > colNum(col)) { at = c.index; break; }
      chunk = chunk.slice(0, at) + cellXml(ref, null, v) + chunk.slice(at);
    }
  }
  return chunk;
}
function readSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
}
function cellValue(chunk, ref, ss) {
  const m = new RegExp(`<c r="${ref}"(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</c>)`).exec(chunk); if (!m || !m[2]) return null;
  const t = /\st="(\w+)"/.exec(m[1] || ''); const v = /<v>([\s\S]*?)<\/v>/.exec(m[2]); const is = /<t[^>]*>([\s\S]*?)<\/t>/.exec(m[2]);
  if (t && t[1] === 's') return v ? ss[Number(v[1])] : null;
  if (t && t[1] === 'inlineStr') return is ? unesc(is[1]) : null;
  return v ? (t && t[1] === 'str' ? unesc(v[1]) : Number(v[1])) : null;
}

async function sheetPaths(zip) {
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const target = {}; for (const m of rels.matchAll(/<Relationship [^>]*Id="(\w+)"[^>]*Target="([^"]+)"/g)) target[m[1]] = m[2];
  for (const m of rels.matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*Id="(\w+)"/g)) target[m[2]] = m[1];
  const out = {}; for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="(\w+)"/g)) out[unesc(m[1])] = 'xl/' + target[m[2]].replace(/^\/?xl\//, '');
  return { wb, out };
}

// Read the Roster tab: [{row, jersey, name}]
export async function readRoster(JSZip, templateBuf) {
  const zip = await JSZip.loadAsync(templateBuf); const { out } = await sheetPaths(zip);
  const ss = readSharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string'));
  const xml = await zip.file(out['Roster']).async('string'); const { parts, byRow } = splitRows(xml);
  const roster = [];
  for (let r = 2; r <= 30; r++) { const i = byRow.get(r); if (i == null) continue; const name = cellValue(parts[i], `B${r}`, ss); if (name) roster.push({ row: r, jersey: cellValue(parts[i], `A${r}`, ss), name }); }
  return roster;
}

// Match an ESPN player to the Roster tab's spelling. Returns the roster name or null.
export function rosterMatch(roster, name, jersey) {
  const n = normName(name); let hit = roster.find(r => normName(r.name) === n);
  if (!hit) hit = roster.find(r => lastOf(r.name) === lastOf(name) && jersey != null && String(r.jersey) === String(jersey));
  if (!hit) { const same = roster.filter(r => lastOf(r.name) === lastOf(name)); if (same.length === 1 && normName(same[0].name)[0] === n[0]) hit = same[0]; }
  return hit ? hit.name : null;
}

// games: [{ label, date:{y,m,d}, opp, rows:[{half, start, end, players:[{name, jersey, pos}], u}] }]
// Returns { data: Uint8Array, added: [{name, jersey}], rows: n, truncated }
export async function fillWorkbook(JSZip, templateBuf, games) {
  const zip = await JSZip.loadAsync(templateBuf); const { wb, out } = await sheetPaths(zip);
  const ss = readSharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string'));
  // roster
  const rXml = await zip.file(out['Roster']).async('string'); const R = splitRows(rXml);
  const roster = [];
  for (let r = 2; r <= 30; r++) { const i = R.byRow.get(r); if (i == null) continue; const name = cellValue(R.parts[i], `B${r}`, ss); if (name) roster.push({ row: r, jersey: cellValue(R.parts[i], `A${r}`, ss), name }); }
  const added = []; let nextFree = 2; const used = new Set(roster.map(r => r.row));
  const spell = (p) => {
    const hit = rosterMatch(roster, p.name, p.jersey); if (hit) return hit;
    while (used.has(nextFree) && nextFree <= 30) nextFree++;
    if (nextFree > 30) return p.name;
    const row = nextFree; used.add(row);
    const jer = p.jersey != null && p.jersey !== '' && !Number.isNaN(Number(p.jersey)) ? Number(p.jersey) : (p.jersey ?? '');
    const i = R.byRow.get(row);
    const vals = { A: jer, B: p.name }; if (p.pos) vals.C = p.pos;
    if (i != null) R.parts[i] = setCells(R.parts[i], row, vals);
    roster.push({ row, jersey: jer, name: p.name }); added.push({ name: p.name, jersey: jer, row });
    return p.name;
  };
  // stint log
  const sXml = await zip.file(out['Stint Log']).async('string'); const S = splitRows(sXml);
  const clear = {}; for (const c of INPUTS) clear[c] = null;
  S.parts[S.byRow.get(2)] = setCells(S.parts[S.byRow.get(2)], 2, clear); // the EXAMPLE row
  let row = 2, truncated = false;
  for (const gm of games) {
    gm.rows.forEach((s, k) => {
      if (row > MAX_ROWS + 1) { truncated = true; return; }
      const u = s.u; const names = [...s.players].sort((a, b) => lastOf(a.name) < lastOf(b.name) ? -1 : lastOf(a.name) > lastOf(b.name) ? 1 : 0).map(spell);
      const v = { A: gm.label, B: excelSerial(gm.date), C: gm.opp, D: s.half, E: k + 1, F: s.start, G: s.end,
        I: names[0], J: names[1], K: names[2], L: names[3], M: names[4], N: u.OU_pts, O: u.Opp_pts, P: u.OU_poss, Q: u.Opp_poss,
        R: u.OU_fga, S: u.OU_oreb, T: u.OU_tov, U: u.OU_fta, V: u.Opp_fga, W: u.Opp_oreb, X: u.Opp_tov, Y: u.Opp_fta,
        Z: u.OU_fg3m, AA: u.OU_fg3a, AB: u.Opp_fg3m, AC: u.Opp_fg3a, AD: u.OU_rim_fga, AE: u.Opp_rim_fga, AP: s.note || 'Auto-filled from play-by-play' };
      const i = S.byRow.get(row); if (i != null) S.parts[i] = setCells(S.parts[i], row, v);
      row++;
    });
  }
  zip.file(out['Stint Log'], S.parts.join(''));
  zip.file(out['Roster'], R.parts.join(''));
  // Excel and Sheets recompute every formula on open
  zip.file('xl/workbook.xml', wb.replace(/<calcPr(?![^>]*fullCalcOnLoad)/, '<calcPr fullCalcOnLoad="1"'));
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { data, added, rows: row - 2, truncated };
}
