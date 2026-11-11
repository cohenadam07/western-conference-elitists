"""Summarise test 6 logs (research/live-lineups-test/live/<label>/refresh-log.jsonl) into numbers for BUILD-REPORT.

usage: python3 tools/live-lineups/live_summary.py fdu-etam=401919759 kc-famu=401921005 dart-ualb=401920234
Timeouts come from ESPN's own play list (fetched now): each is matched to the refreshes where ESPN's clock sat at that
time in that period, so a timeout followed by substitutions at the same clock still counts.
"""
import json, re, subprocess, sys
from datetime import datetime

ROOT = 'research/live-lineups-test/live'
TO = re.compile(r'time ?out', re.I)


def t(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'


def espn_timeouts(gid):
    url = f'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={gid}'
    d = json.loads(subprocess.run(['curl', '-s', '-A', UA, url], capture_output=True, check=True).stdout)  # python.org certs fail here
    out = []
    for p in d.get('plays', []):
        ty = p.get('type', {}).get('text', '')
        if TO.search(ty) and (not out or out[-1][:2] != (p['period']['number'], p['clock']['displayValue'])):
            out.append((p['period']['number'], p['clock']['displayValue'], ty))
    return out


def summary(label, gid=None):
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
    # timeouts: refreshes where ESPN's clock sat at a timeout's time in its period
    tos = []
    for per, clk, ty in (espn_timeouts(gid) if gid else []):
        rs = [r for r in live if r['espn'].get('period') == per and r['espn'].get('clock') == clk]
        if not rs: continue
        tos.append({'key': (f'{per}-{clk}', ty), 'first': rs[0]['wall'], 'last': rs[-1]['wall'], 'refreshes': len(rs),
                    'banners': {b for r in rs for b in r['page']['banners']}, 'clocks': {clk},
                    'lights': sorted({(r['page'].get('recon') or {}).get('cls', '-') for r in rs})})
    # every long stoppage: ESPN's clock frozen 90+ s (covers TV timeouts ESPN never posts as a play, and halftime)
    from itertools import groupby
    stops = []
    for k, g in groupby(live, key=lambda r: (r['espn'].get('period'), r['espn'].get('clock'), r['espn'].get('detail') == 'Halftime')):
        g = list(g); secs = t(g[-1]['wall']) - t(g[0]['wall']) + 15
        if secs >= 90:
            stops.append({'at': 'Halftime' if k[2] else f'{k[0]}-{k[1]}', 'secs': round(secs), 'refreshes': len(g),
                          'last_plays': sorted({r['espn'].get('lastType') or '' for r in g}),
                          'banners': sorted({b for r in g for b in r['page']['banners']}),
                          'lights': sorted({(r['page'].get('recon') or {}).get('cls', '-') for r in g})})
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
                      'espn_clock': sorted(c for c in k['clocks'] if c), 'banners': sorted(k['banners']), 'lights': k['lights']} for k in tos],
        'stoppages': stops, 'data_delayed': [(r['wall'], r.get('band') or r.get('espn', {}).get('detail')) for r in delayed],
        'repairs': repairs, 'lineups_hidden': hidden, 'errors': [r['text'][:200] for r in errs], 'end': end,
    }


if __name__ == '__main__':
    out = [summary(*a.split('=')) for a in sys.argv[1:]]
    json.dump(out, open(f'{ROOT}/summary.json', 'w'), indent=1, default=list)
    for s in out:
        print(f"\n== {s['label']}: {s['refreshes']} refreshes ({s['live_refreshes']} live) over {s['live_span_min']} min, {s['from']} -> {s['to']}; gap median {s['gap_median_s'] and round(s['gap_median_s'], 1)}s max {s['gap_max_s']}s")
        print(f"   lights {s['lights']}; repairs {s['repairs'] or 'none'}; lineups hidden {s['lineups_hidden']}; errors {len(s['errors'])}; Data delayed {len(s['data_delayed'])}")
        for e in s['non_green']: print(f"   non-green at {e['clock']}: {e['n']} refresh(es), {e['secs']}s, worst {e['worst']}: {e['text']}")
        for to in s['timeouts']: print(f"   timeout {to['type']} at {to['at']}: ~{to['secs']}s, {to['refreshes']} refreshes, ESPN clock {to['espn_clock']}, lights {to['lights']}, banners {to['banners'] or 'none'}")
        for st in s['stoppages']: print(f"   stoppage {st['at']}: ~{st['secs']}s, {st['refreshes']} refreshes, plays {st['last_plays']}, lights {st['lights']}, banners {st['banners'] or 'none'}")
        for d in s['data_delayed']: print(f"   DATA DELAYED {d}")
        for e in s['errors']: print(f"   ERROR {e}")
