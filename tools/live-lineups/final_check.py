"""Check a downloaded "This game" tracker against ESPN's official box score, after LibreOffice recalculation.
Usage: python3 tools/live-lineups/final_check.py <recalculated.xlsx> <downloaded.csv> <gid> <teamId>

Checks: ESPN status is final; the Stint Log's points for each side equal ESPN's final score and the sum of ESPN's
box-score player points; minutes sum to 40:00 plus 5:00 per overtime; every half/OT period runs from 20:00 (5:00) to 0:00
with no gaps; Half and clocks are the template's formats; the template's three red-flag rules, re-evaluated on the
recalculated values; no error values in any sheet; the Game Summary row; the CSV equals the Stint Log inputs; and each
player's minutes on the floor against ESPN's (rounded) box-score minutes."""
import csv, json, re, subprocess, sys, openpyxl

xf, cf, gid, team = sys.argv[1:5]
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
url = f'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={gid}'
d = json.loads(subprocess.run(['curl', '-s', '-A', UA, url], capture_output=True, check=True).stdout)  # python.org certs fail here
comp = d['header']['competitions'][0]; st = comp['status']
us = next(c for c in comp['competitors'] if c['id'] == team); them = next(c for c in comp['competitors'] if c['id'] != team)
periods = max(st.get('period', 2), 2); want_min = 40 + 5 * (periods - 2)
box = {}
for side in d['boxscore']['players']:
    lab = side['statistics'][0]['labels']; iM, iP = lab.index('MIN'), lab.index('PTS')
    box[side['team']['id']] = {a['athlete']['displayName']: (int(a['stats'][iM] or 0), int(a['stats'][iP] or 0))
                               for a in side['statistics'][0]['athletes'] if a.get('stats')}
box_pts = {k: sum(v[1] for v in m.values()) for k, m in box.items()}
fails, notes = [], []
def check(ok, msg):
    (notes if ok else fails).append(('ok   ' if ok else 'FAIL ') + msg)

check(st['type']['state'] == 'post' and st['type'].get('completed'), f"ESPN status {st['type']['name']} ({st['type'].get('detail')}), {periods - 2} OT")
check(int(us['score']) == box_pts[team] and int(them['score']) == box_pts[them['id']],
      f"ESPN header {us['team']['abbreviation']} {us['score']} - {them['team']['abbreviation']} {them['score']} = box-score player points {box_pts[team]}-{box_pts[them['id']]}")

wb = openpyxl.load_workbook(xf, data_only=True); ws = wb['Stint Log']
hdr = [c.value for c in ws[1]]; col = {h: i for i, h in enumerate(hdr)}
rows = [[c.value for c in r] for r in ws.iter_rows(min_row=2, max_col=len(hdr)) if r[0].value not in (None, '')]
pts_us = sum(r[col['OU Pts']] for r in rows); pts_them = sum(r[col['Opp Pts']] for r in rows)
mins = sum(r[col['Minutes']] or 0 for r in rows)
check((pts_us, pts_them) == (int(us['score']), int(them['score'])), f'Stint Log points {pts_us}-{pts_them} vs ESPN final {us["score"]}-{them["score"]}')
check(abs(mins - want_min) < 1e-6, f'Stint Log minutes {mins:.4f} vs {want_min}:00 ({len(rows)} stints)')

secs = lambda c: int(c.split(':')[0]) * 60 + int(c.split(':')[1])
halves = {}
for i, r in enumerate(rows, 2):
    h, f, g = str(r[col['Half']]), r[col['Start Clock']], r[col['End Clock']]
    if h not in ('1', '2', 'OT1', 'OT2', 'OT3', 'OT4'): fails.append(f'FAIL row {i} Half {h!r}')
    for c in (f, g):
        if not (isinstance(c, str) and re.fullmatch(r'\d{1,2}:\d\d', c)): fails.append(f'FAIL row {i} clock {c!r}')
    halves.setdefault(h, []).append((i, f, g))
for h, rs in halves.items():
    top = '5:00' if h.startswith('OT') else '20:00'
    chain = rs[0][1] == top and rs[-1][2] == '0:00' and all(a[2] == b[1] for a, b in zip(rs, rs[1:])) and all(secs(a[1]) > secs(a[2]) for a in rs)
    check(chain, f'Half {h}: {len(rs)} stints, {rs[0][1]} to {rs[-1][2]}, contiguous with no gaps or zero-length stints')

P = [col[x] for x in ('P1', 'P2', 'P3', 'P4', 'P5')]; key = col['Lineup Key']; red = []
for i, r in enumerate(rows, 2):
    names = [r[j] for j in P]
    if any(n not in (None, '') and names.count(n) > 1 for n in names): red.append(f'row {i}: duplicate player (P1-P5 rule)')
    if any(n not in (None, '') for n in names) and r[key] in (None, ''): red.append(f'row {i}: players but no Lineup Key (AF rule)')
    if r[key] not in (None, '') and sum(1 for n in names if n not in (None, '')) == 5 and sum(names.count(n) for n in names) > 5: red.append(f'row {i}: Lineup Key over a repeated player (AF rule)')
    if sum(1 for n in names if n not in (None, '')) != 5: red.append(f'row {i}: {sum(1 for n in names if n)} players, not 5')
check(not red, f'red flags after recalculation: {len(red)} (template rules: duplicate player; players with no Lineup Key; key over a repeated player; plus five players per row)')
fails += ['FAIL   ' + x for x in red[:10]]

errs = [f'{s.title}!{c.coordinate} {c.value}' for s in wb for r in s.iter_rows() for c in r
        if isinstance(c.value, str) and (re.match(r'#(N/A|VALUE!|REF!|DIV/0!|NAME\?|NUM!|NULL!)', c.value) or c.value.startswith('Err:'))]
check(not errs, f'error values in any sheet after recalculation: {len(errs)} {errs[:5]}')

gs = wb['Game Summary']; gh = [c.value for c in gs[1]]
gr = [r for r in gs.iter_rows(min_row=2, values_only=True) if r[0] not in (None, '')]
g = dict(zip(gh, gr[0])) if len(gr) == 1 else {}
check(len(gr) == 1 and g.get('Stints') == len(rows) and abs((g.get('Minutes logged') or 0) - want_min) < 1e-6 and (g.get('OU Pts'), g.get('Opp Pts')) == (int(us['score']), int(them['score'])),
      f"Game Summary: {len(gr)} row(s): {g.get('Game')}, stints {g.get('Stints')}, minutes {g.get('Minutes logged')}, {g.get('OU Pts')}-{g.get('Opp Pts')}, possessions {g.get('Off Poss')}/{g.get('Def Poss')}")

with open(cf, newline='') as fh: C = list(csv.DictReader(fh))
csv_cols = [h for h in C[0].keys() if h not in ('Date',)] if C else []
cdiff = []
for k, (a, r) in enumerate(zip(C, rows)):
    for h in csv_cols:
        x = r[col[h]] if h in col else None
        if str(a[h]).strip() != ('' if x is None else str(x)).strip(): cdiff.append(f'row {k + 2} {h}: csv {a[h]!r} xlsx {x!r}')
check(len(C) == len(rows) and not cdiff, f'CSV {len(C)} rows vs Stint Log {len(rows)}, {len(csv_cols)} columns compared, differences {len(cdiff)} {cdiff[:3]}')

po = wb['Player On-Off']; ph = [c.value for c in po[4]]; on = {}
for r in po.iter_rows(min_row=5, values_only=True):
    if r[0] not in (None, ''): on[r[0]] = r[ph.index('Min ON')] or 0
ours = {n: m for n, (m, _) in box[team].items()}
diffs = sorted(((n, ours.get(n), round(on.get(n, 0), 2)) for n in set(ours) | {k for k, v in on.items() if v}), key=lambda t: -abs((t[1] or 0) - t[2]))
worst = max(abs((a or 0) - b) for _, a, b in diffs)
missing = [n for n, a, b in diffs if (a or 0) > 0 and b == 0 or a is None]
check(worst <= 1.0 + 1e-9 and not missing, f'player minutes vs ESPN box (ESPN rounds to whole minutes): {len([x for x in diffs if x[1]])} players, largest gap {worst:.2f} min'
      + (f', names not matched: {missing}' if missing else ''))
print('\n'.join(notes + fails))
print('per-player minutes (ESPN, tracker):', '; '.join(f'{n} {a}/{b:.2f}' for n, a, b in diffs if a or b))
print('RESULT', 'PASS' if not fails else f'FAIL ({len(fails)})')
