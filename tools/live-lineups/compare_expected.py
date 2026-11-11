"""Compare a downloaded tracker against reference/expected-autofill-3-games.xlsx on the Stint Log inputs (cell for cell).
Usage: python3 tools/live-lineups/compare_expected.py <expected.xlsx> <got.xlsx>"""
import sys, openpyxl, datetime
E = openpyxl.load_workbook(sys.argv[1])['Stint Log']; G = openpyxl.load_workbook(sys.argv[2])['Stint Log']
cols = [c for c in range(1, 43) if c not in range(8, 9) and c not in range(32, 42)]  # inputs: A-G, I-AE, AP
n = bad = 0
for r in range(2, 1001):
    for c in cols:
        e, g = E.cell(r, c).value, G.cell(r, c).value
        if isinstance(e, datetime.datetime): e = e.date()
        if isinstance(g, datetime.datetime): g = g.date()
        if e is None and g is None: continue
        n += 1
        if e != g: bad += 1; print('DIFF', E.cell(r, c).coordinate, repr(e), repr(g)) if bad <= 20 else None
print(f'Stint Log input cells compared: {n}, differences: {bad}')
