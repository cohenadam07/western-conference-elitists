// GM Savant on a phone-sized screen, tapped, not hovered (jsdom; `npm i --no-save jsdom` first).
//   node tools/savant-gm/tap.mjs [public dir]
// Loads public/gm-savant.html at 375px with its data read from public/gms, and checks that every detail opens by a tap:
// each explainer button opens its own entry (title matching the key's), a second tap closes it, tapping elsewhere
// closes it, the tap-to-read details open, the portfolio chart answers a tap, and the card's newer lines render.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { JSDOM } from 'jsdom';

const PUB = path.resolve(process.argv[2] || 'public');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('ok', msg); } else { fail++; console.log('not ok', msg); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const html = fs.readFileSync(path.join(PUB, 'gm-savant.html'), 'utf8').replace(/<script src="\/wce-nav\.js"[^>]*><\/script>/, '');
const readJson = (url) => {
  const p = path.join(PUB, decodeURIComponent(new URL(url, 'http://x').pathname));
  const f = fs.existsSync(p) ? p : p + '.gz';
  if (!fs.existsSync(f)) return null;
  const raw = fs.readFileSync(f);
  return JSON.parse((f.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8'));
};
const dom = new JSDOM(html, {
  url: 'http://localhost/gm-savant.html', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.innerWidth = 375; w.innerHeight = 812;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
    w.fetch = async (url) => { const j = readJson(url); return { ok: !!j, status: j ? 200 : 404, json: async () => j }; };
  },
});
const w = dom.window, d = w.document;
const tap = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const pop = () => d.getElementById('expl');
const EXPL = w.eval('EXPL');

for (let i = 0; i < 50 && !d.querySelector('#homeBoard tr.link'); i++) await wait(50);
ok(d.querySelector('#homeBoard tr.link'), 'the home board loads at 375px');

// every explainer button on the home page opens its own entry, and a second tap closes it
const ibs = [...d.querySelectorAll('.ib')];
const wrong = [];
for (const b of ibs) {
  tap(b);
  const k = b.dataset.x;
  if (pop().hidden || !EXPL[k] || !pop().querySelector('.xh').textContent.startsWith(EXPL[k].title)) wrong.push(k);
  tap(b);
  if (!pop().hidden) wrong.push(k + ' (did not close)');
}
ok(ibs.length > 5 && !wrong.length, `every explainer button on the home page opens its own entry and closes on a second tap (${ibs.length}; wrong: ${wrong.join(', ') || 'none'})`);
tap(ibs[0]); tap(d.body);
ok(pop().hidden, 'a tap elsewhere closes the explainer');

// every explainer key used in the page source exists, and no two entries share a title
const keys = [...new Set([...html.matchAll(/info\('([a-z_]+)'\)/g)].map((m) => m[1]))];
ok(keys.every((k) => EXPL[k]), `every info() key in the page has an entry (${keys.length})`);
const titles = Object.values(EXPL).map((e) => e.title);
ok(new Set(titles).size === titles.length, 'no two explainers share a title');

// a GM card: Krause (the inherited sentence), then the log's tap details
const idx = readJson('http://x/gms/index.json');
const file = (name) => (idx.people.find((p) => p.name === name) || {}).file;
w.location.hash = 'g=' + file('Jerry Krause');
for (let i = 0; i < 60 && !(d.getElementById('log') && d.querySelector('#log tr td')); i++) await wait(50);
ok(d.querySelector('#log tr td'), 'a GM card opens (Jerry Krause)');
const inh = d.getElementById('inhNote');
ok(inh && !inh.hidden && inh.textContent.includes('Michael Jordan'), 'the inherited sentence names Michael Jordan');
const tb = d.querySelector('#log .tipb');
if (tb) { tap(tb); ok(!pop().hidden && pop().textContent.length > 10, 'a tap-to-read detail in the log opens'); tap(d.body); }
ok(!d.querySelector('#log [title]'), 'no hover-only title details in the log');
const hit = d.querySelector('#port .hit');
if (hit) { tap(hit); ok(!d.getElementById('tip').hidden, 'the portfolio chart answers a tap'); }

// a board-era GM: draft rows carry the board, and its explainer opens
w.location.hash = 'g=' + file('Sam Presti');
await wait(300);
for (let i = 0; i < 60 && !(d.querySelector('#log .ts')); i++) await wait(50);
const draftChip = [...d.querySelectorAll('#logFilter .chip')].find((c) => c.dataset.t === 'draft');
if (draftChip) { tap(draftChip); await wait(50); }
const bn = [...d.querySelectorAll('#log .ts')].find((x) => /best available|consensus/.test(x.textContent));
ok(bn, 'a board-era draft row says where the pick stood on the consensus board (Sam Presti)');
const bib = bn && bn.querySelector('.ib');
if (bib) { tap(bib); ok(!pop().hidden && pop().querySelector('.xh').textContent.startsWith(EXPL.board.title), 'its explainer opens "The board"'); tap(d.body); }
const skill = d.querySelector('#skills');
ok(skill && skill.textContent.includes('Drafting'), 'the skills tiles render');
skill.querySelectorAll('.ib').forEach((b) => { tap(b); if (pop().hidden || !pop().querySelector('.xh').textContent.startsWith(EXPL[b.dataset.x].title)) wrong.push('skills:' + b.dataset.x); tap(b); });
ok(!wrong.length, `every explainer button on the card opens its own entry (wrong: ${wrong.join(', ') || 'none'})`);

// titles (v1.1.0): the board is ranked by the blend; the metric switch and the slider re-rank it; the card has a titles
// panel with its pool; every decision row carries expected titles and the blend
w.location.hash = '';
await wait(200);
const firstName = () => (d.querySelector('#homeBoard tr.link td') || {}).textContent;
const blendTop = firstName();
ok(blendTop === w.eval('IDX').boards.all[0].name, `the home board opens ranked by the blend (${blendTop})`);
const slider = d.getElementById('homeBlend');
slider.value = '100'; slider.dispatchEvent(new w.Event('input', { bubbles: true }));
const byTitles = w.eval('IDX').boards.all.slice().sort((a, b) => b.titles_added - a.titles_added)[0].name;
ok(firstName() === byTitles && /Titles only/.test(d.getElementById('homeBlendNote').textContent), `the slider at titles only ranks by expected titles added (${firstName()})`);
slider.value = '0'; slider.dispatchEvent(new w.Event('input', { bubbles: true }));
const byPoints = w.eval('IDX').boards.all.slice().sort((a, b) => b.gva - a.gva)[0].name;
ok(firstName() === byPoints, `the slider at wins only ranks by points (${firstName()})`);
tap([...d.querySelectorAll('#homeMetric button')].find((b) => b.dataset.v === 'titles'));
ok(d.getElementById('homeBlendCtl').hidden && firstName() === byTitles, 'the expected-titles switch ranks by titles and hides the slider');
ok(/against/.test(d.getElementById('homePool').textContent), 'the board names its pool');
w.location.hash = 'g=' + file('Jerry Krause');
for (let i = 0; i < 60 && !(d.querySelector('#tbars .row')); i++) await wait(50);
ok(d.querySelector('#tbars .row') && /vs /.test(d.getElementById('tbars').textContent), 'the card shows the blend and titles bars with their pool (Krause)');
ok(/Titles won/.test(d.getElementById('titleTiles').textContent) && /Playoff luck/.test(d.getElementById('luck').textContent), 'titles won, expected titles and playoff luck are on the card');
const hdr = d.querySelector('#log tr').textContent;
ok(/Titles, turned out/.test(hdr) && /Blended/.test(hdr), 'every decision row carries expected titles and the blend');
const ibs2 = [...d.querySelectorAll('#tbars .ib, #titleTiles .ib, #luck .ib')];
const wrong2 = ibs2.filter((b) => { tap(b); const bad = pop().hidden || !pop().querySelector('.xh').textContent.startsWith(EXPL[b.dataset.x].title); tap(b); return bad; }).map((b) => b.dataset.x);
ok(ibs2.length >= 6 && !wrong2.length, `every titles explainer on the card opens its own entry (${ibs2.length}; wrong: ${wrong2.join(', ') || 'none'})`);
const wide = [...d.querySelectorAll('.blendctl input')].every((x) => x.getAttribute('aria-label'));
ok(wide, 'the slider has a label');

// salaries (null until 1.1.0): the banner lists what they will change, every badge opens it at its own line
const ban = d.getElementById('salaries'), keysSoon = [...d.querySelectorAll('#salList li')].map((li) => li.dataset.k);
ok(!ban.hidden && keysSoon.join() === 'fa,resign,trades,lists,left_fa,cap', `the salaries banner shows, with its six lines (${keysSoon.join()})`);
w.location.hash = 'g=' + file('Jerry Krause');
for (let i = 0; i < 60 && !(d.querySelector('#skills .soon')); i++) await wait(50);
await wait(300);
const badges = [...d.querySelectorAll('#card .soon')].filter((b) => !b.closest('[hidden]'));
const seen = new Set(badges.map((b) => b.dataset.soon));
ok(['fa', 'resign', 'trades', 'lists'].every((k) => seen.has(k)) && d.querySelector('#inhSoon .soon') && d.querySelector('#leftSoon .soon'), `the card carries badges on free agency, re-signing, trades and both lists (${[...seen].join()})`);
ok(badges.every((b) => b.tagName === 'BUTTON' && b.type === 'button' && b.textContent.trim()), 'every badge is a labelled button, so it takes focus');
const wrongSoon = badges.filter((b) => { ban.open = false; tap(b); const hl = [...d.querySelectorAll('#salList li.hl')].map((li) => li.dataset.k); return !ban.open || hl.join() !== b.dataset.soon; }).map((b) => b.dataset.soon);
ok(!wrongSoon.length, `every badge opens the banner at its own line (${badges.length}; wrong: ${wrongSoon.join(', ') || 'none'})`);
const lfChip = [...d.querySelectorAll('#logFilter button, #logFilter .chip')].find((c) => /free agency/i.test(c.textContent) && /left/i.test(c.textContent));
ok(lfChip, 'the log has a left-in-free-agency filter (Krause)');
if (lfChip) { tap(lfChip); await wait(50); ok(!d.getElementById('logNote').hidden && d.querySelector('#logNote .soon[data-soon="left_fa"]'), 'the log filtered to left in free agency carries its badge'); }
w.location.hash = 'g=' + file('Sam Presti');
for (let i = 0; i < 60 && !(d.querySelector('#activeTiles .soon-card')); i++) await wait(50);
const cap = d.querySelector('#activeTiles .soon-card');
ok(cap && cap.querySelector('.soon[data-soon="cap"]') && !/null|undefined|NaN/.test(cap.textContent), 'an active GM shows a clean cap outlook "coming soon" card (Sam Presti)');
ok(!/\b(null|undefined|NaN)\b/.test(d.getElementById('card').textContent), 'no null, undefined or NaN anywhere on the card');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
