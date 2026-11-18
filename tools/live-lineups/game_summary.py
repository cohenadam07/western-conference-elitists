"""Print the recalculated Game Summary of one or more workbooks and compare them.
Usage: python3 tools/live-lineups/game_summary.py <expected_recalc.xlsx> <got_recalc.xlsx>"""
import sys, openpyxl
def gs(f):
    ws = openpyxl.load_workbook(f, data_only=True)['Game Summary']; hdr = [c.value for c in ws[1]]
    return hdr, [list(r) for r in ws.iter_rows(min_row=2, values_only=True) if r[0] not in (None, '')]
he, E = gs(sys.argv[1]); hg, G = gs(sys.argv[2])
print(' | '.join(str(h) for h in he[:9]))
for r in G: print(' | '.join(f'{v:.2f}' if isinstance(v, float) else str(v) for v in r[:9]))
diff = sum(1 for a, b in zip(E, G) for x, y in zip(a, b) if (round(x, 6) if isinstance(x, float) else x) != (round(y, 6) if isinstance(y, float) else y)) + abs(len(E) - len(G))
print(f'Game Summary: {len(G)} games, cells differing from expected: {diff}')
