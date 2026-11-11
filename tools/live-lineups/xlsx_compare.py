"""Round-trip check: does a written workbook keep every feature of the template?
Usage: python3 tools/live-lineups/xlsx_compare.py <template.xlsx> <written.xlsx> [--inputs-only-diff]
Reports differences in data validations, conditional formatting, notes, freeze panes, column widths, formulas,
and (for non-Stint-Log sheets) values."""
import sys, openpyxl
A = openpyxl.load_workbook(sys.argv[1]); B = openpyxl.load_workbook(sys.argv[2])
print('sheets same:', B.sheetnames == A.sheetnames, '| fullCalcOnLoad:', B.calculation.fullCalcOnLoad)
def feats(ws):
    return dict(dv=sorted((str(d.sqref), d.type, d.formula1, d.showErrorMessage) for d in ws.data_validations.dataValidation),
                cf=sorted((str(r.sqref), tuple((x.type, tuple(x.formula or ()), x.operator) for x in r.rules)) for r in ws.conditional_formatting),
                notes={c.coordinate: c.comment.text for r in ws.iter_rows() for c in r if c.comment},
                freeze=ws.freeze_panes, widths={k: round(v.width or 0, 2) for k, v in ws.column_dimensions.items() if v.width},
                formulas={c.coordinate: c.value for r in ws.iter_rows() for c in r if isinstance(c.value, str) and c.value.startswith('=')},
                values={c.coordinate: c.value for r in ws.iter_rows() for c in r if c.value is not None and not (isinstance(c.value, str) and c.value.startswith('='))})
tot = 0
for a in A:
    b = B[a.title]; fa, fb = feats(a), feats(b)
    for k in fa:
        if a.title == 'Stint Log' and k == 'values': continue  # inputs are expected to change
        if a.title == 'Roster' and k == 'values' and '--roster-may-grow' in sys.argv:
            fa[k] = {x: v for x, v in fa[k].items()}; fb[k] = {x: v for x, v in fb[k].items() if x in fa[k]}
        if fa[k] != fb[k]:
            if isinstance(fa[k], dict):
                d = [(x, fa[k].get(x), fb[k].get(x)) for x in sorted(set(fa[k]) | set(fb[k])) if fa[k].get(x) != fb[k].get(x)]
                print(f'  {a.title}: {k} differs in {len(d)} cells, e.g. {d[:2]}'); tot += len(d)
            else:
                print(f'  {a.title}: {k} differs'); print('    template', fa[k][:4] if isinstance(fa[k], list) else fa[k]); print('    written ', fb[k][:4] if isinstance(fb[k], list) else fb[k]); tot += 1
    print(f'{a.title}: dv {len(fa["dv"])}->{len(fb["dv"])}, cf {len(fa["cf"])}->{len(fb["cf"])}, notes {len(fa["notes"])}->{len(fb["notes"])}, '
          f'freeze {fa["freeze"]}->{fb["freeze"]}, widths {len(fa["widths"])}->{len(fb["widths"])}, formulas {len(fa["formulas"])}->{len(fb["formulas"])}')
print('TOTAL DIFFERENCES', tot)
