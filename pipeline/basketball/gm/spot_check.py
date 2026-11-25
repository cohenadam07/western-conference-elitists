"""
spot_check.py — Module 9's spot-check: one GM at a time, everything the page says about him next to what it rests on,
for a person to read. For each: the tenure and its source, the headline and its rank, both value lines, the skills,
his three biggest moves with both grades, whether every team-season he ran balances (conserve.py), his trades'
audit (audit_trades.py: zero-sum, picks at the slot), and anything flagged.

    python3 spot_check.py "Sam Presti" "Daryl Morey" ...      -> out/spot_check.txt
"""
import collections, gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
PUB = os.path.join(HERE, '..', '..', '..', 'public', 'gms')
K = '0.05'


def main(names):
    idx = json.loads(gzip.open(os.path.join(PUB, 'index.json.gz')).read())
    T = json.load(open(os.path.join(OUT, 'gm_tenures.json')))
    C = json.load(open(os.path.join(OUT, 'conservation.json')))
    off = {(r['team'], r['season']): r['gap'] for r in C['off']}
    D = json.load(open(os.path.join(OUT, 'gm_decisions.json')))
    S = json.load(open(os.path.join(OUT, 'decision_streams.json')))
    alls = sorted((s for p in idx['people'] for s in json.loads(gzip.open(os.path.join(PUB, 'g', p['file'] + '.json.gz')).read())['spells'] if s.get('gm_value_added') and s.get('ranked')),
                  key=lambda s: -s['gm_value_added'][K])
    out = []
    for name in names:
        p = next((x for x in idx['people'] if x['name'] == name), None)
        if not p:
            out.append(f'{name}: not found\n')
            continue
        g = json.loads(gzip.open(os.path.join(PUB, 'g', p['file'] + '.json.gz')).read())
        for s in g['spells']:
            ten = next((t for t in T if t['person'] == name and t['team'] == s['team'] and t['start'] == s['start']), None) or \
                next((t for t in T if t['person'] == name and t['team'] == s['team'] and t['start'] <= (s['end'] or '9999') and (t.get('end') or '9999') >= s['start']), {})
            src = ten.get('sources') or ten.get('start_source') or ten.get('source')
            src = src if isinstance(src, str) else (src[0] if src else None)
            if isinstance(src, dict):
                src = src.get('url') or json.dumps(src)[:120]
            d = s.get('detail') or {}
            out.append(f"{name}, {s['team']} {s['start']} to {s['end'] or 'now'} ({s['seasons']} seasons{', shared' if s.get('shared') else ''})")
            out.append(f"  tenure source: {', '.join(ten.get('sources') or []) or 'none'}" + (f"; start: \"{ten['start_line'][:110]}\"" if ten.get('start_line') else f" (start {ten.get('start_precision')})"))
            if s.get('gm_value_added'):
                rank = next((i for i, x in enumerate(alls, 1) if x is s or (x['team'] == s['team'] and x['start'] == s['start'] and x.get('gm_value_added') == s['gm_value_added'])), None)
                where = f"{s.get('pct_all')}th percentile, rank {rank} of {len(alls)} ranked" if s.get('ranked') else 'not ranked: under two seasons'
                out.append(f"  GM Value Added {s['gm_value_added'][K]:+,.0f} ({s['gm_value_added_per_season']:+,.0f} a season; {where}): produced {s['produced_margin_adj']:+,.0f} + left {s['left'][K]:,.0f} - inherited {s['inherited'][K]:,.0f}; "
                           f"player-value line {s['gm_value_added_player'][K]:+,.0f}")
            else:
                out.append('  not ranked (too short, or before the margin data)')
            tr, dr, fa = d.get('trades') or {}, d.get('drafting') or {}, d.get('free_agency') or {}
            out.append(f"  trades {tr.get('n', 0)}: {tr.get('turned_out', 0):+,.0f} as they turned out, {tr.get('at_time', 0):+,.0f} at the time | drafting {dr.get('picks', 0)} picks "
                       f"{dr.get('over_slot', 0):+,.0f} over slot | free agency {(fa.get('stars') or 0) + (fa.get('role') or 0):+,.0f} | re-signing (value kept, not added) {d.get('re_signing', 0):+,.0f}")
            mine = [x for x in D if x['team'] == s['team'] and s['start'] <= x['agreed'] <= (s['end'] or '9999') and x.get('turned_out') is not None
                    and any(c['person'] == name for c in (x.get('credit') or {}).get('people', [])) and x.get('additive', True)]
            for x in sorted(mine, key=lambda x: -abs(x['turned_out']))[:3]:
                what = (x.get('text') or x.get('player') or x.get('coach') or '')[:110]
                out.append(f"    {x['agreed']} {x['type']}: {x['turned_out']:+,.0f} as it turned out, {x['at_time'] if x['at_time'] is not None else 'n/a'} at the time - {what}")
            y0, y1 = int(s['start'][:4]) + (1 if s['start'][5:7] >= '07' else 0), int((s['end'] or '2026-06-30')[:4]) + (1 if (s['end'] or '2026-06-30')[5:7] >= '07' else 0)
            gaps = {y: off[(s['team'], y)] for y in range(y0, min(y1, 2026) + 1) if (s['team'], y) in off}
            out.append(f"  conservation: {'every team-season he ran balances' if not gaps else 'off: ' + ', '.join(f'{y} {v:+.1f}' for y, v in gaps.items())}")
            lc = sum(1 for x in mine if x.get('low_confidence'))
            out.append(f"  flagged low confidence: {lc} of {len(mine)} decisions")
        out.append('')
    text = '\n'.join(out)
    open(os.path.join(OUT, 'spot_check.txt'), 'w').write(text + '\n')
    print(text)


if __name__ == '__main__':
    main(sys.argv[1:])
