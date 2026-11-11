"""v5: the Spreadsheet tab (Lucas's tracker, filled live) + 4-tab band. Usage: python3 code/mock5.py"""
import sys, os, json, gzip, math, html
sys.argv = [sys.argv[0], os.path.join(os.getcwd(), 'code')]
import mock3 as M, mock4 as M4, fill_sheet as FS, parse
E = html.escape
M4.TABS[:] = ['Right now', 'Shots and scoring', 'Their key players', 'Spreadsheet']
ROSTER = {'Ben Moser': 0, 'Xzayvier Brown': 1, 'Pop Isaacs': 2, 'Quincy Wadley': 3, 'Gage Mayfield': 4, 'B.J. Edwards': 5, 'Finley Keeffe': 6,
          'Dayton Forsythe': 7, 'Kai Rogers': 8, 'Yaak Yaak': 9, 'Khani Rooths': 11, 'Tae Davis': 13, 'Tyler Hendricks': 15, 'Duke Brennan': 32, 'Derrion Reid': 35}
P3, SD = 0.339, 1.167

CSS5 = r'''
.sheetbar{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:18px 32px 12px}
.sheetbar h2{margin-bottom:2px}
.sheetbar p{font-size:14px;color:var(--muted);max-width:66ch}
.acts{display:flex;gap:10px;align-items:center;flex:none}
.scope{display:flex;gap:3px;padding:3px;background:#EDE8E6;border-radius:999px;margin-right:6px}
.scope button{appearance:none;border:0;background:transparent;font:500 13px/1 "Libre Franklin",sans-serif;color:var(--muted);padding:8px 12px;border-radius:999px}
.scope button[aria-pressed=true]{background:#fff;color:var(--ink);font-weight:600;box-shadow:0 1px 2px rgba(36,28,29,.12)}
.grid{margin:0 32px;border:1px solid #CFC8C4;background:#fff;overflow:hidden;position:relative}
.grid::after{content:"";position:absolute;top:0;right:0;bottom:0;width:56px;background:linear-gradient(90deg,rgba(255,255,255,0),#fff);pointer-events:none}
table.xl{border-collapse:collapse;font:400 12.5px/1.2 "Libre Franklin",Calibri,sans-serif;white-space:nowrap;width:max-content}
.xl th{background:#841617;color:#fff;font-weight:600;padding:7px 8px;border:1px solid #6c1213;text-align:center;line-height:1.15;white-space:normal;vertical-align:middle}
.xl th.rn,.xl td.rn{background:#F1EEEC;color:#8a8183;border-color:#DCD6D3;font-weight:400;width:30px;text-align:center;padding:0 4px}
.xl td{border:1px solid #E1DCD9;padding:5px 8px;height:26px}
.xl td.in{background:#FFF8E1}
.xl td.calc{background:#EEF6E8}
.xl td.n{text-align:right}
.xl td.c{text-align:center}
.xl td.l{text-align:left}
.xl tr.onrow td{font-style:italic;box-shadow:inset 0 2px 0 -1px transparent}
.xl tr.onrow td.in,.xl tr.onrow td.calc{background:#FCEDED}
.xl tr.onrow td.rn{background:#841617;color:#FDF9D8;font-style:normal;font-weight:600}
.xl td .neg{color:#9C2B2C}
.sheettabs{display:flex;gap:0;margin:0 32px;border:1px solid #CFC8C4;border-top:0;background:#F1EEEC;font-size:13px}
.sheettabs span{padding:7px 16px;border-right:1px solid #DCD6D3;color:var(--muted)}
.sheettabs span.on{background:#fff;color:var(--crimson);font-weight:600;box-shadow:inset 0 2px 0 var(--crimson)}
.sheettabs em{margin-left:auto;padding:7px 12px;font-style:normal;color:var(--muted)}
.legend{display:flex;gap:18px;align-items:center;padding:8px 32px 2px;font-size:12.5px;color:var(--muted)}
.legend i{display:inline-block;width:12px;height:12px;border:1px solid #DCD6D3;vertical-align:-2px;margin-right:6px}
'''


def rows_live(L):
    g = json.load(gzip.open('bt/ou27/games/401906802.json.gz'))
    cut = L['cut']
    plays = [p for p in g['plays'] if parse.elapsed(p[0], p[1]) <= cut]
    rows, _, _ = FS.stints_for(dict(g, plays=plays))
    # extend the open stint to the snapshot clock
    return rows


def fmt(v, d=1):
    if v is None or v == '': return ''
    s = f'{v:.{d}f}' if isinstance(v, float) else str(v)
    return s.replace('-', '−') if s.startswith('-') else s


def sheet_screen(L, S):
    d = dict(L, mode='live')
    rows = rows_live(L)
    cols = ['Half', 'Stint #', 'Start Clock', 'End Clock', 'Minutes', 'P1', 'P2', 'P3', 'P4', 'P5', 'OU Pts', 'Opp Pts', 'Off Poss', 'Def Poss',
            '+/-', 'Net Rtg', '+/- (95%)', 'Luck-Adj Net', 'OU 3PM', 'OU 3PA']
    calc = {'Minutes', 'Off Poss', 'Def Poss', '+/-', 'Net Rtg', '+/- (95%)', 'Luck-Adj Net'}
    th = '<th class="rn"></th>' + ''.join(f'<th>{E(c)}</th>' for c in cols)
    body = ''
    for k, s in enumerate(rows, 1):
        u = s['u']; op, dp = u['OU_poss'], u['Opp_poss']
        net = (100 * (u['OU_pts'] / op - u['Opp_pts'] / dp)) if op and dp else None
        ci = (1.96 * SD * 100 * math.sqrt(1 / op + 1 / dp)) if op and dp else None
        lnet = (100 * ((u['OU_pts'] - 3 * (u['OU_fg3m'] - P3 * u['OU_fg3a'])) / op - (u['Opp_pts'] - 3 * (u['Opp_fg3m'] - P3 * u['Opp_fg3a'])) / dp)) if op and dp else None
        pl = sorted(s['players'], key=lambda x: x.split()[-1])
        live = (k == len(rows))
        v = {'Half': s['half'], 'Stint #': k, 'Start Clock': s['start'], 'End Clock': '' if live else s['end'], 'Minutes': round(s['minutes'], 1),
             'OU Pts': u['OU_pts'], 'Opp Pts': u['Opp_pts'], 'Off Poss': op, 'Def Poss': dp, '+/-': u['OU_pts'] - u['Opp_pts'],
             'Net Rtg': round(net, 1) if net is not None else '', '+/- (95%)': f'±{round(ci)}' if ci else '', 'Luck-Adj Net': round(lnet, 1) if lnet is not None else '',
             'OU 3PM': u['OU_fg3m'], 'OU 3PA': u['OU_fg3a']}
        for j, nm in enumerate(pl, 1): v[f'P{j}'] = nm
        tds = f'<td class="rn">{"Now" if live else k + 1}</td>'
        for c in cols:
            val = v.get(c, '')
            cls = ('calc' if c in calc else 'in') + (' n' if isinstance(val, (int, float)) or c in ('+/- (95%)',) else ' c' if c in ('Half', 'Stint #', 'Start Clock', 'End Clock') else ' l')
            txt = fmt(val)
            if isinstance(val, (int, float)) and val < 0: txt = f'<span class="neg">{txt}</span>'
            tds += f'<td class="{cls}">{txt}</td>'
        body += f'<tr class="{"onrow" if live else ""}">{tds}</tr>'
    grid = f'<div class="grid" role="region" aria-label="Stint Log" tabindex="0"><table class="xl"><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>'
    tabs = '<div class="sheettabs"><span>Instructions</span><span>Roster</span><span class="on">Stint Log</span><span>Lineup Summary</span><span>Player On-Off</span><span>Game Summary</span><em>Scroll right for every column</em></div>'
    bar = f'''<div class="sheetbar"><div><h2>Your lineup tracker</h2><p>The workbook we sent, filling itself in. A new row starts at every substitution. The download keeps all your tabs and formulas.</p></div>
<div class="acts"><div class="scope" role="group" aria-label="What to include"><button aria-pressed="true">This game</button><button aria-pressed="false">Whole season</button></div>
<button class="btn" type="button">Download for Excel</button><button class="btn ghost" type="button">CSV</button></div></div>'''
    legend = '<div class="legend"><span><i style="background:#FFF8E1"></i>Filled in from the play-by-play</span><span><i style="background:#EEF6E8"></i>Your formulas</span><span><i style="background:#FCEDED"></i>The group on the floor now, still counting</span></div>'
    page_body = M4.band4(d, 'live', 'Spreadsheet') + bar + grid + tabs + legend + '<div style="flex:1"></div>' + M.footer('live')
    return M.page('Oklahoma lineup tracker', page_body, f'<style>{M4.CSS4}{CSS5}</style>')


if __name__ == '__main__':
    L = json.load(open('mock/live.json')); S = json.load(open('mock/shots.json'))
    open('mock/v5_sheet.html', 'w').write(sheet_screen(L, S))
    open('mock/v5_now.html', 'w').write(M4.now_screen(L, S))
