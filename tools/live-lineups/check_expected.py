"""Does compact() + the reference fill_sheet.stints_for() reproduce expected-autofill-3-games.xlsx exactly?
Usage: python3 tools/live-lineups/check_expected.py"""
import sys, os, collections, openpyxl
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = os.path.join(ROOT, 'public/live-lineups/reference')
RAW = os.path.expanduser('~/Basketball-Savant/espn-cache/cbb/2026-27/raw')
sys.argv = [sys.argv[0], REF]
sys.path.insert(0, REF); sys.path.insert(0, os.path.dirname(__file__))
import fill_sheet as FS, compact as C

wb = openpyxl.load_workbook(os.path.join(REF, 'expected-autofill-3-games.xlsx'))
sl = wb['Stint Log']; hdr = [c.value for c in sl[1]]
exp = [dict(zip(hdr, [c.value for c in r])) for r in sl.iter_rows(min_row=2) if r[0].value]
bad = 0; i = 0
for gid in ('401906801', '401906802', '401906803'):
    g = C.load(f'{RAW}/{gid}.json.gz')
    rows, _, opp = FS.stints_for(g)
    print(gid, 'stints', len(rows), 'mins', round(sum(r['minutes'] for r in rows), 2),
          'pts', sum(r['u']['OU_pts'] for r in rows), sum(r['u']['Opp_pts'] for r in rows), 'final', g['score'])
    for k, s in enumerate(rows, 1):
        e = exp[i]; i += 1; u = s['u']
        got = {'Half': s['half'], 'Stint #': k, 'Start Clock': s['start'], 'End Clock': s['end'], 'OU Pts': u['OU_pts'], 'Opp Pts': u['Opp_pts'],
               'Off Poss (manual)': u['OU_poss'], 'Def Poss (manual)': u['Opp_poss'], 'OU FGA': u['OU_fga'], 'OU OREB': u['OU_oreb'],
               'OU TOV': u['OU_tov'], 'OU FTA': u['OU_fta'], 'Opp FGA': u['Opp_fga'], 'Opp OREB': u['Opp_oreb'], 'Opp TOV': u['Opp_tov'],
               'Opp FTA': u['Opp_fta'], 'OU 3PM': u['OU_fg3m'], 'OU 3PA': u['OU_fg3a'], 'Opp 3PM': u['Opp_fg3m'], 'Opp 3PA': u['Opp_fg3a'],
               'OU Rim FGA': u['OU_rim_fga'], 'Opp Rim FGA': u['Opp_rim_fga']}
        for j, nm in enumerate(sorted(s['players'], key=lambda x: x.split()[-1]), 1): got[f'P{j}'] = nm
        for h, v in got.items():
            if (e[h] or 0) != (v or 0): bad += 1; print('  DIFF row', i + 1, h, 'expected', e[h], 'got', v)
print('rows compared', i, 'of', len(exp), 'diffs', bad)
