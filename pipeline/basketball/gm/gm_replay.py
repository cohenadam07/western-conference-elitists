"""
gm_replay.py — Module 8's proof: run the whole update path against a replayed week, fed day by day, and show the
ledger, grades and page ending where the real history did.

It copies the pipeline into a sandbox (so the real outputs and page are untouched), sets the confirmation frontier
to the first day, and runs gm_update.py --asof <day> --offline for each day: sources cut at that day, the second-
source gate, the ledger, credit, frozen grades, the GM numbers and the page files. Then it compares the sandbox at
the end of the week with the real build (which saw the whole history at once), for everything dated up to the last
day: ledger events, decisions and their grades, and the page's decision logs.

    python3 gm_replay.py 2026-02-01 2026-02-07      # the 2025-26 trade deadline week -> out/replay_report.txt
"""
import datetime as dt, glob, gzip, json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(HERE, 'out')
BOX = os.environ.get('GM_REPLAY_BOX') or os.path.join(os.environ.get('TMPDIR', '/tmp'), 'gm-replay')


def sandbox(BOX):
    if os.path.exists(BOX):
        shutil.rmtree(BOX)
    gm = os.path.join(BOX, 'pipeline', 'basketball', 'gm')
    shutil.copytree(HERE, gm, ignore=shutil.ignore_patterns('__pycache__', 'out_*.log'))
    for f in glob.glob(os.path.join(REPO, 'pipeline', 'basketball', '*.py')):
        shutil.copy(f, os.path.join(BOX, 'pipeline', 'basketball'))
    shutil.copytree(os.path.join(REPO, 'pipeline', 'dataroom'), os.path.join(BOX, 'pipeline', 'dataroom'))
    pub = os.path.join(BOX, 'public')
    os.makedirs(pub)
    os.symlink(os.path.join(REPO, 'public', 'bcs'), os.path.join(pub, 'bcs'))           # read only: Coaching Savant
    shutil.copytree(os.path.join(REPO, 'public', 'dataroom'), os.path.join(pub, 'dataroom'))
    for f in ('news.json', 'basketball-coaching-savant.html'):
        shutil.copy(os.path.join(REPO, 'public', f), pub)
    os.makedirs(os.path.join(pub, 'gm-photos'))
    for f in ('pending.json', 'ledger_hold.json', 'fo_pending.json', 'frozen_at_time.json', 'confirmed_through.json', 'update_state.json', 'grade_state.json'):
        p = os.path.join(gm, 'out', f)
        if os.path.exists(p):
            os.remove(p)
    return gm


def load_gz(p):
    return json.loads(gzip.open(p).read())


def main(a, b):
    gm = sandbox(BOX)
    json.dump({'date': a, 'set_on': 'replay'}, open(os.path.join(gm, 'out', 'confirmed_through.json'), 'w'))
    # the reference: the same history as of the last day, built in one pass (same information, no day-by-day path)
    ONE = BOX + '-oneshot'
    gm1 = sandbox(ONE)
    json.dump({'date': a, 'set_on': 'oneshot'}, open(os.path.join(gm1, 'out', 'confirmed_through.json'), 'w'))
    # one at a time: each build needs up to ~0.6 GB, and two at once with everything else ran the Mac out of memory
    one = subprocess.run([sys.executable, os.path.join(gm1, 'gm_update.py'), '--asof', b, '--offline', '--full'], cwd=gm1, capture_output=True, text=True)
    log = [f'Replay of {a} to {b}, fed day by day through gm_update.py, each night incremental (sandbox {BOX}); the reference is one '
           f'full build as of {b}, run first and alone.', '']
    if one.returncode not in (0, 2):
        log.append('one-shot reference failed: ' + one.stderr[-1500:])
    log.append(f'reference (full, as of {b}): exit {one.returncode} | {peaks(gm1)}')
    d = dt.date.fromisoformat(a)
    while d.isoformat() <= b:
        r = subprocess.run([sys.executable, os.path.join(gm, 'gm_update.py'), '--asof', d.isoformat(), '--offline'], cwd=gm, capture_output=True, text=True)
        lines = [x for x in r.stdout.splitlines() if x.strip()]
        inc = next((x.strip() for x in lines if x.strip().startswith('incremental:')), '')
        mode = next((x.strip() for x in lines if x.strip().startswith('rebuild:')), '')
        log.append(f'{d}: exit {r.returncode}; ' + ' | '.join(x.strip() for x in lines[1:3]) + f' | {mode} {inc} | {peaks(gm)}')
        if r.returncode not in (0, 2):
            log.append(r.stderr[-1500:])
            break
        pend = json.load(open(os.path.join(gm, 'out', 'pending.json')))
        if pend:
            log.append('    held: ' + '; '.join(f"{v['date']} {v['text'][:90]}" for v in list(pend.values())[:4]))
        print(log[-1], flush=True)
        d += dt.timedelta(days=1)
    log.append('')
    log += same_files(gm1, gm)
    log.append('')
    log += compare(a, b, os.path.join(gm1, 'out'), os.path.join(ONE, 'public', 'gms'), gm, 'the one-shot build of the same history as of ' + b)
    log.append('')
    log += compare(a, b, OUT, os.path.join(REPO, 'public', 'gms'), gm, 'the full build (which also knows what happened after ' + b + ')')
    open(os.path.join(OUT, 'replay_report.txt'), 'w').write('\n'.join(log) + '\n')
    print('\n'.join(log))


def peaks(gm):
    """The night's largest step and its total time (gm_update.py writes each step's peak to out/update_peaks.txt)."""
    p = os.path.join(gm, 'out', 'update_peaks.txt')
    rows = [l.split() for l in open(p)] if os.path.exists(p) else []
    if not rows:
        return 'no steps run'
    mb = lambda r: int(r[r.index('MB') - 1].replace(',', ''))
    top = max(rows, key=mb)
    return f"largest step {os.path.basename(top[1])} {mb(top)} MB; {sum(int(r[r.index('MB') + 1].rstrip('s')) for r in rows)}s in steps"


def same_files(gm1, gm):
    """Every output file of the two sandboxes, by checksum (hashes.py: ignored files included, run-stamps left out)."""
    h = lambda root: dict(reversed(l.split(' ', 1)) for l in subprocess.run([sys.executable, os.path.join(HERE, 'hashes.py'), '--root', root],
                                                                            capture_output=True, text=True).stdout.splitlines())
    one, box = h(gm1), h(gm)
    diff = sorted(k for k in set(one) | set(box) if one.get(k) != box.get(k))
    # the one expected difference: the day each at-the-time grade was frozen (the day it first appeared, night by
    # night; the reference froze everything on its one day). Everything else must be identical.
    import gzip

    def load(root, k):
        p = os.path.join(root, '..', '..', '..', k)
        b = open(p, 'rb').read()
        return json.loads(gzip.decompress(b) if k.endswith('.gz') else b)

    def strip(x):
        if isinstance(x, dict):
            return {k: strip(v) for k, v in x.items() if k not in ('frozen_on', 'generated')}
        return [strip(v) for v in x] if isinstance(x, list) else x
    only_frozen = [k for k in diff if k in one and k in box and k.endswith(('.json', '.json.gz')) and strip(load(gm1, k)) == strip(load(gm, k))]
    real = [k for k in diff if k not in only_frozen]
    n = len(set(one) | set(box))
    out = [f'== Every output file, day by day (incremental) against the one full build: {n - len(diff)} of {n} byte-identical; '
           f'{len(only_frozen)} differ only in frozen_on (the day each grade was frozen: the day it appeared, against the reference\'s one day); '
           f'{len(real)} differ in anything else']
    out += [f'    differs: {k}' + ('' if k in one and k in box else ' (only in one of them)') for k in real[:20]]
    return out


def compare(a, b, ROUT, RPUB, gm, what):
    log = [f'== The replay against {what}']
    key = lambda e: (e['date'], e['asset'], e['from'], e['to'], e['kind'])
    real_e = {key(e) for e in json.load(open(os.path.join(ROUT, 'ledger_events.json'))) if e['date'] <= b}
    box_e = {key(e) for e in json.load(open(os.path.join(gm, 'out', 'ledger_events.json'))) if e['date'] <= b}
    week = lambda s_: {k for k in s_ if k[0] >= a}
    log.append(f'Ledger: {len(box_e)} events dated up to {b} in the replay, {len(real_e)} in the real build; '
               f'the week itself {len(week(box_e))} vs {len(week(real_e))}; only in the replay {len(box_e - real_e)}, only in the real build {len(real_e - box_e)}.')
    for k in sorted(real_e - box_e)[:8]:
        log.append(f'    only real:   {k}')
    for k in sorted(box_e - real_e)[:8]:
        log.append(f'    only replay: {k}')
    real_d = {x['decision_id']: x for x in json.load(open(os.path.join(ROUT, 'gm_decisions.json'))) if x['agreed'] <= b}
    box_d = {x['decision_id']: x for x in json.load(open(os.path.join(gm, 'out', 'gm_decisions.json'))) if x['agreed'] <= b}
    both = set(real_d) & set(box_d)
    at_same = sum(1 for k in both if real_d[k]['at_time'] == box_d[k]['at_time'])
    wk = [k for k in both if real_d[k]['agreed'] >= a]
    late = [x for x in json.load(open(os.path.join(gm, 'out', 'gm_decisions.json'))) if min(x['agreed'], x['date']) > b]
    log.append(f'Decisions in the replay dated after {b}: {len(late)} (an as-of build must know nothing later).')
    log.append(f'Decisions dated up to {b}: replay {len(box_d)}, real {len(real_d)}, in both {len(both)}; at-the-time grades identical {at_same} of {len(both)}; '
               f'the week: {len([k for k in box_d if box_d[k]["agreed"] >= a])} vs {len([k for k in real_d if real_d[k]["agreed"] >= a])}.')
    for k in sorted(set(real_d) - set(box_d), key=lambda k: real_d[k]['agreed'])[:6]:
        log.append(f"    only real:   {real_d[k]['agreed']} {real_d[k]['type']} {real_d[k]['team']} {(real_d[k].get('text') or real_d[k].get('player') or '')[:90]}")
    for k in sorted(set(box_d) - set(real_d), key=lambda k: box_d[k]['agreed'])[:6]:
        log.append(f"    only replay: {box_d[k]['agreed']} {box_d[k]['type']} {box_d[k]['team']} {(box_d[k].get('text') or box_d[k].get('player') or '')[:90]}")
    diff_at = [k for k in wk if real_d[k]['at_time'] != box_d[k]['at_time']]
    for k in diff_at[:5]:
        log.append(f"    at-the-time differs: {real_d[k]['agreed']} {real_d[k]['type']} {real_d[k]['team']}: real {real_d[k]['at_time']} replay {box_d[k]['at_time']}")
    # ---- the page: decision logs of every GM with a decision in the week
    teams = {real_d[k]['team'] for k in wk}
    idx = load_gz(os.path.join(RPUB, 'index.json.gz'))
    same = n = 0
    for p in idx['people']:
        if not any(s['team'] in teams and s['active'] for s in p['spells']):
            continue
        rg = load_gz(os.path.join(RPUB, 'g', f"{p['file']}.json.gz"))
        bp = os.path.join(BOX, 'public', 'gms', 'g', f"{p['file']}.json.gz")
        if not os.path.exists(bp):
            continue
        bg = load_gz(bp)
        cut = lambda g: [(x['id'], x['at_time']) for x in g['decisions'] if x['date'] <= b]
        n += 1
        same += cut(rg) == cut(bg)
    log.append(f'Page: the decision logs (ids and at-the-time grades up to {b}) of the {n} active GMs whose teams moved that week: {same} of {n} identical to the real page.')
    tq = sum(1 for k in both if real_d[k]['turned_out'] == box_d[k]['turned_out'])
    log.append(f'How-it-turned-out grades identical: {tq} of {len(both)} (they move with every game played after the decision).')
    return log


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
