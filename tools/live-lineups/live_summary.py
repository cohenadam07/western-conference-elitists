"""Summarise test 6 logs (research/live-lineups-test/live/<label>/refresh-log.jsonl) into numbers for BUILD-REPORT.

usage: python3 tools/live-lineups/live_summary.py fdu-etam kc-famu dart-ualb
"""
import json, re, sys
from datetime import datetime

ROOT = 'research/live-lineups-test/live'
TO = re.compile(r'time ?out', re.I)


def t(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def summary(label):
    rows = [json.loads(l) for l in open(f'{ROOT}/{label}/refresh-log.jsonl')]
    ref = [r for r in rows if r['kind'] == 'refresh']
    live = [r for r in ref if r['espn'].get('state') == 'in']
    gaps = [t(b['wall']) - t(a['wall']) for a, b in zip(live, live[1:])]
    lights = {}
    for r in live:
        c = (r['page'].get('recon') or {}).get('cls', '-')
        lights[c] = lights.get(c, 0) + 1
    # non-green episodes: from the first non-green refresh to the next green one
    eps, cur = [], None
    for r in live:
        c = (r['page'].get('recon') or {}).get('cls', '-')
        if c != 'green' and cur is None:
            cur = {'start': r['wall'], 'clock': r['espn'].get('detail'), 'worst': c, 'text': r['page']['recon']['text'], 'n': 0}
        if cur is not None:
            if c == 'green':
                cur['secs'] = round(t(r['wall']) - t(cur['start']))
                eps.append(cur); cur = None
            else:
                cur['n'] += 1
                if c == 'red': cur['worst'] = 'red'
    if cur is not None:
        cur['secs'] = None; eps.append(cur)
    # stoppages ESPN marks as timeouts: group consecutive refreshes whose last play is a timeout at the same clock
    tos, cur = [], None
    for r in live:
        e = r['espn']
        if TO.search(e.get('lastType') or ''):
            k = (e['lastClock'], e['lastType'])
            if cur is None or cur['key'] != k:
                cur = {'key': k, 'first': r['wall'], 'last': r['wall'], 'refreshes': 0, 'banners': set(), 'clocks': set()}
                tos.append(cur)
            cur['last'] = r['wall']; cur['refreshes'] += 1; cur['clocks'].add(e.get('clock'))
            for b in r['page']['banners']: cur['banners'].add(b)
        else:
            cur = None
    # banner changes during timeouts (the 1 s sampler), matched by wall time
    bc = [r for r in rows if r['kind'] == 'banner-change']
    for to in tos:
        for r in bc:
            if t(to['first']) <= t(r['wall']) <= t(to['last']) + 15:
                for b in r['banners']: to['banners'].add(b)
    delayed = [r for r in bc if any('Data delayed' in b for b in r['banners'])]
    delayed += [r for r in ref if any('Data delayed' in b for b in r['page']['banners'])]
    repairs = sorted({x for r in ref for x in r['page'].get('repairs', [])})
    hidden = any(r['page'].get('lineupOk') is False for r in ref)
    errs = [r for r in rows if r['kind'] in ('console-error', 'pageerror')]
    end = next((r for r in rows if r['kind'] == 'end'), None)
    return {
        'label': label, 'refreshes': len(ref), 'live_refreshes': len(live),
        'live_span_min': round((t(live[-1]['wall']) - t(live[0]['wall'])) / 60, 1) if live else 0,
        'from': live[0]['espn'].get('detail') if live else None, 'to': live[-1]['espn'].get('detail') if live else None,
        'gap_median_s': sorted(gaps)[len(gaps) // 2] if gaps else None, 'gap_max_s': round(max(gaps), 1) if gaps else None,
        'lights': lights, 'non_green': eps,
        'timeouts': [{'at': k['key'][0], 'type': k['key'][1], 'secs': round(t(k['last']) - t(k['first'])) + 15, 'refreshes': k['refreshes'],
                      'espn_clock': sorted(c for c in k['clocks'] if c), 'banners': sorted(k['banners'])} for k in tos],
        'data_delayed': [(r['wall'], r.get('band') or r.get('espn', {}).get('detail')) for r in delayed],
        'repairs': repairs, 'lineups_hidden': hidden, 'errors': [r['text'][:200] for r in errs], 'end': end,
    }


if __name__ == '__main__':
    out = [summary(l) for l in sys.argv[1:]]
    json.dump(out, open(f'{ROOT}/summary.json', 'w'), indent=1, default=list)
    for s in out:
        print(f"\n== {s['label']}: {s['refreshes']} refreshes ({s['live_refreshes']} live) over {s['live_span_min']} min, {s['from']} -> {s['to']}; gap median {s['gap_median_s']:.1f}s max {s['gap_max_s']}s")
        print(f"   lights {s['lights']}; repairs {s['repairs'] or 'none'}; lineups hidden {s['lineups_hidden']}; errors {len(s['errors'])}; Data delayed {len(s['data_delayed'])}")
        for e in s['non_green']: print(f"   non-green at {e['clock']}: {e['n']} refresh(es), {e['secs']}s, worst {e['worst']}: {e['text']}")
        for to in s['timeouts']: print(f"   timeout {to['type']} at {to['at']}: ~{to['secs']}s, {to['refreshes']} refreshes, ESPN clock {to['espn_clock']}, banners {to['banners'] or 'none'}")
        for d in s['data_delayed']: print(f"   DATA DELAYED {d}")
        for e in s['errors']: print(f"   ERROR {e}")
