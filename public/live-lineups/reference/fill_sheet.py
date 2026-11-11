"""Fill Lucas's tracker (the exact workbook we sent) from play-by-play: one Stint Log row per OU stint.
Stints come from replaying substitutions (exact clocks); stats from parsed possessions inside each stint.
Usage: python3 -I code/fill_sheet.py <code_dir> <template.xlsx> <out.xlsx> <gid>[,<gid>...]"""
import sys, json, gzip, collections, datetime
sys.path.insert(0, sys.argv[1]); import parse
import openpyxl
TPL, OUT, GIDS = (sys.argv[2], sys.argv[3], sys.argv[4].split(',')) if len(sys.argv) > 4 else (None, None, [])
OU = '201'

def clock(sec_left):
    s = round(sec_left); return f'{s // 60}:{s % 60:02d}'

def stints_for(g):
    plays = g['plays']; box = g['box']
    names = {a[0]: a[1] for t, ath in box.items() for a in ath}
    opp = [t for t in box if t != OU][0]
    five = {a[0] for a in box[OU] if a[2]}
    el = lambda p: parse.elapsed(p[0], p[1])
    # boundaries: every clock where OU's five changes (after applying the whole substitution group), plus halftime
    out = []; start = 0.0; cur = frozenset(five)
    i = 0; n = len(plays)
    while i < n:
        p = plays[i]
        if p[3] == 'Substitution' and p[2] == OU:
            t = el(p); per, clk = p[0], p[1]; new = set(cur)
            while i < n and plays[i][0] == per and plays[i][1] == clk:
                q = plays[i]
                if q[3] == 'Substitution' and q[2] == OU and q[8]:
                    (new.discard if 'subbing out' in q[4] else new.add)(q[8][0])
                i += 1
            new = frozenset(new)
            if new != cur:
                assert len(new) == 5, (p, new)
                if t > start: out.append((start, t, cur))
                start, cur = t, new
            continue
        if p[3] == 'End Period':
            t = el(p)
            if t > start: out.append((start, t, cur))
            start = t
        i += 1
    last_t = el(plays[-1])
    if last_t > start: out.append((start, last_t, cur))  # game in progress: the open stint
    r, st = parse.parse_game(g); assert r, st
    P = r['poss']
    rows = []
    for k, (a, b, f) in enumerate(out):
        key = '|'.join(sorted(f))
        u = collections.Counter()
        for p in P:
            if not (a <= p['t0'] < b or (p['t0'] == b and k == len(out) - 1)): continue
            side = 'OU' if p['off'] == OU else 'Opp'
            five_p = p['off5'] if p['off'] == OU else p['def5']
            if five_p != key: u['mismatch'] += 1
            u[side + '_poss'] += 1
            for s in ('pts', 'fga', 'oreb', 'tov', 'fta', 'fg3m', 'fg3a', 'rim_fga'): u[f'{side}_{s}'] += p[s]
        half = 1 if a < 1200 else 2
        base = 1200 if half == 1 else 2400
        rows.append(dict(half=half, start=clock(base - a), end=clock(base - b), players=[names[x] for x in f], u=u, minutes=(b - a) / 60))
    return rows, names[list(f)[0]] if False else None, opp

def main():
    wb = openpyxl.load_workbook(TPL)
    sl = wb['Stint Log']
    hdr = {sl.cell(1, c).value: c for c in range(1, sl.max_column + 1)}
    # clear the EXAMPLE row's inputs
    for h in ('Game', 'Date', 'Opponent', 'Half', 'Stint #', 'Start Clock', 'End Clock', 'P1', 'P2', 'P3', 'P4', 'P5', 'OU Pts', 'Opp Pts',
              'Off Poss (manual)', 'Def Poss (manual)', 'OU FGA', 'OU OREB', 'OU TOV', 'OU FTA', 'Opp FGA', 'Opp OREB', 'Opp TOV', 'Opp FTA',
              'OU 3PM', 'OU 3PA', 'Opp 3PM', 'Opp 3PA', 'OU Rim FGA', 'Opp Rim FGA', 'Notes'):
        sl.cell(2, hdr[h]).value = None
    roster = {wb['Roster'].cell(r, 2).value for r in range(2, 31)} - {None}
    row = 2; check = []
    for gid in GIDS:
        g = json.load(gzip.open(f'bt/ou27/games/{gid}.json.gz'))
        rows, _, opp = stints_for(g)
        oname = {'2400': 'MVSU', '2837': 'East Texas A&M', '2453': 'North Alabama'}.get(opp, opp)
        # stored date is ESPN's UTC date; both games tipped in the evening Central time, so the local date is one day earlier.
        # The live page should convert the event's full UTC timestamp to America/Chicago instead.
        d = datetime.date.fromisoformat(g['date'][:10]) - datetime.timedelta(days=1) if g.get('date') else None
        tot = collections.Counter(); mm = 0
        for k, s in enumerate(rows, 1):
            u = s['u']
            vals = {'Game': f'{oname} {d.month}/{d.day}' if d else oname, 'Date': d, 'Opponent': oname, 'Half': s['half'], 'Stint #': k,
                    'Start Clock': s['start'], 'End Clock': s['end'], 'OU Pts': u['OU_pts'], 'Opp Pts': u['Opp_pts'],
                    'Off Poss (manual)': u['OU_poss'], 'Def Poss (manual)': u['Opp_poss'],
                    'OU FGA': u['OU_fga'], 'OU OREB': u['OU_oreb'], 'OU TOV': u['OU_tov'], 'OU FTA': u['OU_fta'],
                    'Opp FGA': u['Opp_fga'], 'Opp OREB': u['Opp_oreb'], 'Opp TOV': u['Opp_tov'], 'Opp FTA': u['Opp_fta'],
                    'OU 3PM': u['OU_fg3m'], 'OU 3PA': u['OU_fg3a'], 'Opp 3PM': u['Opp_fg3m'], 'Opp 3PA': u['Opp_fg3a'],
                    'OU Rim FGA': u['OU_rim_fga'], 'Opp Rim FGA': u['Opp_rim_fga'], 'Notes': 'Auto-filled from play-by-play'}
            for j, nm in enumerate(sorted(s['players'], key=lambda x: x.split()[-1]), 1): vals[f'P{j}'] = nm
            for h, v in vals.items(): sl.cell(row, hdr[h]).value = v
            missing = [p for p in s['players'] if p not in roster]
            if missing: print('NOT ON ROSTER', missing)
            tot['OU'] += u['OU_pts']; tot['Opp'] += u['Opp_pts']; tot['mis'] += u['mismatch']; mm += s['minutes']; row += 1
        check.append((gid, oname, dict(tot), round(mm, 2), g['score'] if 'score' in g else None, len(rows)))
    wb.calculation.fullCalcOnLoad = True  # Excel/Sheets recompute every formula on open
    wb.save(OUT)
    for c in check: print(c)


if __name__ == '__main__':
    main()
