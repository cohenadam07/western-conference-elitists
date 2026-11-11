"""After LibreOffice recalculation: Half/clock formats, minutes, points, and the template's three red-flag rules.
Usage: python3 tools/live-lineups/check_ot.py <recalculated.xlsx> <our_pts> <opp_pts> <expected_minutes>"""
import sys, re, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True); ws = wb['Stint Log']
rows = [[c.value for c in r] for r in ws.iter_rows(min_row=2, max_col=42) if r[0].value not in (None, '')]
col = lambda L: openpyxl.utils.column_index_from_string(L) - 1
bad = []
for i, r in enumerate(rows, 2):
    half, f, g = r[col('D')], r[col('F')], r[col('G')]
    if str(half) not in ('1', '2', 'OT1', 'OT2', 'OT3'): bad.append(f'row {i} Half {half!r} not a dropdown value')
    for c in (f, g):
        if not (isinstance(c, str) and re.fullmatch(r'\d{1,2}:\d\d', c)) or c.startswith('-'): bad.append(f'row {i} clock {c!r}')
        elif str(half).startswith('OT') and int(c.split(':')[0]) > 5: bad.append(f'row {i} OT clock over 5:00 {c!r}')
    names = [r[col(x)] for x in 'IJKLM']; key = r[col('AF')]
    if any(n and names.count(n) > 1 for n in names): bad.append(f'row {i} red flag: duplicate player')
    if any(names) and key in (None, ''): bad.append(f'row {i} red flag: players but no Lineup Key')
mins = sum(r[col('H')] or 0 for r in rows); us = sum(r[col('N')] for r in rows); them = sum(r[col('O')] for r in rows)
gs = wb['Game Summary']; g2 = [c.value for c in gs[2]]
print(f'rows {len(rows)}, halves {sorted({str(r[col("D")]) for r in rows})}, minutes {mins:.2f}, points {us}-{them}, Game Summary row: stints {g2[2]}, minutes {g2[3]}, {g2[4]}-{g2[5]}')
ot = [f'{r[col("D")]} {r[col("F")]}-{r[col("G")]}' for r in rows if str(r[col('D')]).startswith('OT')]; print('OT rows:', ', '.join(ot))
ok = not bad and abs(mins - float(sys.argv[4])) < 1e-6 and (us, them) == (int(sys.argv[2]), int(sys.argv[3])) and abs((g2[3] or 0) - float(sys.argv[4])) < 1e-6
for b in bad[:10]: print('  ', b)
print('red flags / format problems:', len(bad), '|', 'PASS' if ok else 'FAIL')
