"""
gm_update.py — Module 8: NBA GM Savant keeps itself current. One pass of the update path:

  1. sources      refetch the season in progress: Basketball-Reference's transactions page, ESPN's transactions,
                  NBA.com's player movement, the draft page on draft night, and yesterday's ESPN scoreboard (game
                  dates and margins). More often around the draft, free agency and the deadline (windows(), below).
  2. confirm      a new Basketball-Reference transaction counts only once a second source agrees: ESPN or NBA.com
                  naming one of its players within three days, or, for a trade of picks only, an ESPN line or a WCE
                  news headline naming both teams. Until then it is held out of the ledger (ledger_hold.json) and
                  listed in pending.json; anything still unconfirmed after 48 hours is a warning for the Control Room.
  3. front office ESPN lines and WCE news headlines about hires, firings and title changes in basketball operations
                  open a tenure with its source (fo_pending.json, "pending confirmation"); it confirms itself when a
                  second source agrees. Coach hires come from Coaching Savant's own files.
  4. rebuild      ledger, credit, grades (GM_FREEZE=1: at-the-time grades are frozen once written; lottery odds and
                  pick values come from the standings as of today), the GM numbers, the page files, the catalog.
  5. heartbeat    out/gm-refresh.json: when it last ran clean, what it covers, what is pending and how old.

    python3 gm_update.py                  # today, with the network
    python3 gm_update.py --asof 2026-02-05 --offline     # replay a day from cached sources (gm_replay.py)
"""
import argparse, collections, datetime as dt, json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
from fetch import get  # noqa: E402

PENDING = os.path.join(OUT, 'pending.json')
HOLD = os.path.join(OUT, 'ledger_hold.json')
FRONTIER = os.path.join(OUT, 'confirmed_through.json')     # rows dated before this were accepted when the job began
FO = os.path.join(OUT, 'fo_pending.json')
BEAT = os.path.join(ROOT, 'data', 'gm-refresh.json')
WARN_H = 48


def season_end(d):
    return int(d[:4]) + (1 if d[5:7] >= '07' else 0)


def windows(d):
    """Busy stretches, when the job runs more often (the workflow's extra crons) and pages are refetched sooner."""
    md = d[5:]
    if '06-20' <= md <= '07-10':
        return 'draft and free agency'
    if '01-25' <= md <= '02-12':
        return 'trade deadline'
    return None


# ---------------------------------------------------------------- 1. sources
def refresh_sources(today, offline):
    import br_tx, espn_tx
    from ledger import NBA_FEED, draft_url
    y = season_end(today)
    age = 1 if windows(today) else 6
    notes = []
    import pagefacts
    if pagefacts.ONLY:
        # the cloud: Basketball-Reference and NBA.com pages come only as parsed facts from the Mac lane; ESPN directly
        if not offline:
            c, b = get(espn_tx.url(y), delay=4, max_age_h=age)
            notes.append(f'{espn_tx.url(y).split("/")[2]} {c}')
            scoreboard(today)
        subprocess.run([sys.executable, os.path.join(HERE, 'espn_tx.py')], check=True, cwd=HERE, capture_output=True)
        return notes
    if not offline:
        for url in (br_tx.url(y), espn_tx.url(y), NBA_FEED):
            c, b = get(url, delay=4, max_age_h=age)
            notes.append(f'{url.split("/")[2]} {c}')
        if '06-20' <= today[5:] <= '06-30':
            get(draft_url(today[:4] and int(today[:4])), delay=4, max_age_h=0.25)
        scoreboard(today)
    for script in ('br_tx.py', 'espn_tx.py'):
        subprocess.run([sys.executable, os.path.join(HERE, script)], check=True, cwd=HERE, capture_output=True)
    return notes


def scoreboard(today):
    """Yesterday's games from ESPN (cloud-reachable) into games.json and results.json for the season in progress;
    earlier seasons come from stats.nba.com through the Mac lane (games.py)."""
    import espn_tx  # noqa: F401  (same ESPN host and manners)
    yday = (dt.date.fromisoformat(today) - dt.timedelta(days=1)).isoformat()
    url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={yday.replace('-', '')}"
    c, b = get(url, delay=4, max_age_h=2)
    if c != 200:
        return
    from tenures import franchise
    G, R = json.load(open(os.path.join(OUT, 'games.json'))), json.load(open(os.path.join(OUT, 'results.json')))
    y = season_end(yday)
    s = f'{y - 1}-{str(y)[2:]}'
    for ev in json.loads(b).get('events', []):
        comp = ev['competitions'][0]
        if comp.get('status', {}).get('type', {}).get('completed') is not True or str(ev.get('season', {}).get('type')) != '2':
            continue
        side = [(x['team']['abbreviation'], int(x['score'])) for x in comp['competitors']]
        for (ab, pts), (_, opp) in ((side[0], side[1]), (side[1], side[0])):
            ab = ESPN_AB.get(ab, ab)
            G.setdefault(s, {}).setdefault(ab, [])
            if yday not in G[s][ab]:
                G[s][ab] = sorted(G[s][ab] + [yday])
                R.setdefault(s, {}).setdefault(ab, []).append([yday, 'W' if pts > opp else 'L', float(pts - opp)])
    for name, obj in (('games.json', G), ('results.json', R)):
        tmp = os.path.join(OUT, name + '.tmp')
        json.dump(obj, open(tmp, 'w'))
        os.replace(tmp, os.path.join(OUT, name))


ESPN_AB = {'GS': 'GSW', 'NY': 'NYK', 'NO': 'NOP', 'SA': 'SAS', 'UTAH': 'UTA', 'WSH': 'WAS', 'PHX': 'PHX', 'BKN': 'BKN'}


# ---------------------------------------------------------------- 2. confirm
def norm(s):
    import unicodedata
    return ' '.join(re.sub(r'[^a-z ]', ' ', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()).split())


TEAM_WORDS = {'ATL': 'hawks', 'BOS': 'celtics', 'BRK': 'nets', 'CHI': 'bulls', 'CHO': 'hornets', 'CLE': 'cavaliers', 'DAL': 'mavericks', 'DEN': 'nuggets',
              'DET': 'pistons', 'GSW': 'warriors', 'HOU': 'rockets', 'IND': 'pacers', 'LAC': 'clippers', 'LAL': 'lakers', 'MEM': 'grizzlies', 'MIA': 'heat',
              'MIL': 'bucks', 'MIN': 'timberwolves', 'NOP': 'pelicans', 'NYK': 'knicks', 'OKC': 'thunder', 'ORL': 'magic', 'PHI': '76ers', 'PHO': 'suns',
              'POR': 'blazers', 'SAC': 'kings', 'SAS': 'spurs', 'TOR': 'raptors', 'UTA': 'jazz', 'WAS': 'wizards'}


def confirm(asof, now):
    """Hold every new Basketball-Reference paragraph until a second source agrees. Returns (held, newly confirmed)."""
    import ledger
    from ledger import ASOF  # noqa: F401
    frontier = json.load(open(FRONTIER))['date'] if os.path.exists(FRONTIER) else asof
    if not os.path.exists(FRONTIER):
        json.dump({'date': frontier, 'set_on': now}, open(FRONTIER, 'w'))
    os.environ.pop('GM_LEDGER_NOHOLD', None)
    saved_hold = ledger.held
    ledger.held = lambda: set()                     # read every paragraph, then decide
    try:
        paras = [p for p in ledger.paragraphs() if p['date'] and frontier <= p['date'] <= asof]
    finally:
        ledger.held = saved_hold
    espn = [e for e in json.load(open(os.path.join(OUT, 'espn_tx.json'))) if e['date'] <= asof]
    import pagefacts
    nba = [r for r in (pagefacts.nba_rows() or []) if r['TRANSACTION_DATE'][:10] <= asof]
    news = load_news(asof)
    pend = json.load(open(PENDING)) if os.path.exists(PENDING) else {}
    held, confirmed = [], []
    near = lambda a, b_, n=3: abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(b_)).days) <= n
    for p in paras:
        k = ledger.para_key(p)
        names = [norm(m) for m in p['names']]       # the players and teams the paragraph links (pagefacts)
        teams = p['teams']
        why = None
        for n in names:
            if any(n and n in norm(e['text']) and near(e['date'], p['date']) for e in espn):
                why = 'ESPN'; break
            if any(n and n in norm(r['TRANSACTION_DESCRIPTION']) and near(r['TRANSACTION_DATE'][:10], p['date']) for r in nba):
                why = 'NBA.com'; break
        if not why and not names and len(set(teams)) >= 2:
            words = [TEAM_WORDS.get(t) for t in set(teams)]
            if all(words) and any(all(w in norm(h['title']) for w in words) and near(h['published'][:10], p['date']) for h in news):
                why = 'WCE news'
        if why:
            if k in pend:
                confirmed.append({**pend.pop(k), 'confirmed_by': why, 'confirmed_on': now})
            continue
        rec = pend.setdefault(k, {'key': k, 'date': p['date'], 'text': p['text'], 'source': p['source'], 'first_seen': now})
        held.append(rec)
    for k in [k for k in pend if k not in {h['key'] for h in held}]:
        pend.pop(k)                                  # gone from the source (corrected or withdrawn)
    json.dump(pend, open(PENDING, 'w'), indent=0)
    json.dump(sorted(pend), open(HOLD, 'w'))
    return held, confirmed


def load_news(asof):
    p = os.path.join(ROOT, 'public', 'news.json')
    if not os.path.exists(p):
        return []
    d = json.load(open(p))
    return [h for h in d.get('headlines', []) if h.get('published', '')[:10] <= asof]


# ---------------------------------------------------------------- 3. front office
FO_PAT = re.compile(r'\b(named|hired|promoted|fired|relieved|parted ways with|stepped down|resigned|reassigned)\b.*\b(general manager|president of basketball operations|'
                    r'head of basketball operations|executive vice president of basketball operations|basketball operations)\b', re.I)


def front_office(asof, now):
    """New hires, firings and title changes in basketball operations: each opens (or closes) a tenure with its
    source and waits for a second source. Returns the pending list."""
    from tenures import franchise
    espn = [e for e in json.load(open(os.path.join(OUT, 'espn_tx.json'))) if e['date'] <= asof and FO_PAT.search(e['text'])]
    news = [h for h in load_news(asof) if FO_PAT.search(h['title'])]
    T = json.load(open(os.path.join(OUT, 'gm_tenures.json')))
    known = {(t['team'], norm(t['person'])) for t in T}
    fo = json.load(open(FO)) if os.path.exists(FO) else {}
    frontier = json.load(open(FRONTIER))['date'] if os.path.exists(FRONTIER) else asof
    for e in espn:
        if e['date'] < frontier:
            continue
        m = re.search(r"(?:Named|Hired|Promoted|Fired|Relieved)\s+(?:[a-z ]+? )?([A-Z][\w.'\-]+(?: [A-Z][\w.'\-]+)+)", e['text'])
        if not m:
            continue
        who, team = m.group(1), franchise(e['team']) or e['team']
        kind = 'leaves' if re.search(r'fired|relieved|parted|stepped down|resigned', e['text'], re.I) else 'starts'
        k = f"{team}|{norm(who)}|{kind}|{e['date']}"
        if kind == 'starts' and (team, norm(who)) in known:
            continue
        rec = fo.setdefault(k, {'team': team, 'person': who, 'kind': kind, 'date': e['date'], 'line': e['text'], 'source': e.get('source') or 'ESPN transactions',
                                'first_seen': now, 'status': 'pending confirmation', 'confirmations': []})
        last = who.split()[-1].lower()
        for h in news:
            if last in h['title'].lower() and TEAM_WORDS.get(team, '~') in h['title'].lower() and abs((dt.date.fromisoformat(h['published'][:10]) - dt.date.fromisoformat(e['date'])).days) <= 4:
                if h['url'] not in rec['confirmations']:
                    rec['confirmations'].append(h['url'])
        if rec['confirmations']:
            rec['status'] = 'confirmed'
    json.dump(fo, open(FO, 'w'), indent=0)
    return [r for r in fo.values() if r['status'] != 'confirmed']


# ---------------------------------------------------------------- 4. rebuild, only what changed
STATE = os.path.join(OUT, 'update_state.json')


def sha(path):
    import hashlib
    return hashlib.sha1(open(path, 'rb').read()).hexdigest() if os.path.exists(path) else None


def code_hash():
    import glob, hashlib
    h = hashlib.sha1()
    for f in sorted(glob.glob(os.path.join(HERE, '*.py')) + glob.glob(os.path.join(HERE, '*.json')) + glob.glob(os.path.join(HERE, 'page', '*'))
                    + [os.path.join(ROOT, 'tools', 'savant-value', 'value.py')]):
        if os.path.isfile(f):
            h.update(f.encode()); h.update(open(f, 'rb').read())
    return h.hexdigest()


def fingerprints(date):
    """(transactions, everything): what the ledger and credit read, and what any output reads. A stat of the fetch
    cache (name and size: a refetched page with the same content keeps its size) catches a page added or changed."""
    import br_tx, espn_tx
    from fetch import CACHE, path_of
    from ledger import NBA_FEED, draft_url
    y = season_end(date)
    cache = sorted((f, os.path.getsize(os.path.join(CACHE, f))) for f in os.listdir(CACHE) if not f.endswith('.url') and os.path.isfile(os.path.join(CACHE, f))) \
        if os.path.isdir(CACHE) else []
    tx = [code_hash(), date, os.environ.get('GM_ASOF')] + [sha(path_of(u)) for u in (br_tx.url(y), espn_tx.url(y), NBA_FEED, draft_url(y))] + \
         [sha(os.path.join(OUT, f)) for f in ('br_tx.json', 'espn_tx.json', 'ledger_hold.json', 'fo_pending.json', 'fo_events.json')] + [cache]
    import pagefacts
    facts = sorted((f, sha(os.path.join(pagefacts.DIR, f))) for f in os.listdir(pagefacts.DIR)) if os.path.isdir(pagefacts.DIR) else []
    tx.append(facts)
    rest = [sha(os.path.join(OUT, f)) for f in ('games.json', 'results.json', 'model_seasons.json', 'luck_margins.json', 'frozen_at_time.json')] + \
           [sha(os.path.join(ROOT, 'public', 'bcs', 'index.json'))] + \
           (sorted((f, os.path.getsize(os.path.join(CACHE, 'dataroom', f))) for f in os.listdir(os.path.join(CACHE, 'dataroom')))
            if os.path.isdir(os.path.join(CACHE, 'dataroom')) else [])
    import hashlib
    t = hashlib.sha1(json.dumps(tx, default=str).encode()).hexdigest()
    return t, hashlib.sha1(json.dumps([t, rest], default=str).encode()).hexdigest()


def run(script, env, *args):
    t = time.time()
    r = subprocess.run([sys.executable, os.path.join(HERE, 'peak.py'), os.path.join(HERE, script), *args], cwd=HERE,
                       env=dict(env, PEAK_LOG=os.path.join(OUT, 'update_peaks.txt')), capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f'{script} failed:\n{r.stderr[-2000:]}')
    print(f'  {script} {time.time() - t:.0f}s', flush=True)
    return r.stdout


def rebuild(asof, light, full=False, offline=False):
    """Only what changed (a full rebuild with --full, and every Monday from the workflow):
      - nothing new since the last clean run (same day, same sources, same values) -> nothing is rebuilt;
      - tonight's Savant values for the season in progress (model_data.py --current: past seasons reused) and the
        season's luck-adjusted margins;
      - the ledger and credit only when a transaction, a hold or a front-office change is new;
      - grades: frozen at-the-time grades are never recomputed, and a how-it-turned-out grade that reads nothing
        live (no asset still held, no season from the current one on) is carried over (grade.py, GM_INCREMENTAL);
      - the GM numbers and the page from those, writing only the page files whose content changed."""
    env = dict(os.environ, GM_FREEZE='1')
    if asof:
        env['GM_ASOF'] = asof
    if not full:
        env['GM_INCREMENTAL'] = '1'
    open(os.path.join(OUT, 'update_peaks.txt'), 'w').close()
    date = asof or dt.date.today().isoformat()
    import pagefacts
    if not offline:                                   # the night's values (a replay keeps the sources it was given)
        run('model_data.py', env, *([] if full else ['--current']))
        if not pagefacts.ONLY:
            run('luck.py', env)                       # (the cloud gets the margins from the Mac lane: they need BR's league page)
    st = json.load(open(STATE)) if os.path.exists(STATE) else {}
    tx_fp, all_fp = fingerprints(date)
    outputs = all(os.path.exists(os.path.join(OUT, f)) for f in ('gm_decisions.json', 'gm_spells.json', 'gm_detail.json'))
    if not full and outputs and st.get('all') == all_fp:
        print('  nothing new since the last clean run: no rebuild', flush=True)
        return 'unchanged'
    if full or not outputs or st.get('tx') != tx_fp:
        run('ledger.py', env)
        run('credit.py', env)
    else:
        print('  ledger and credit: no new transaction or front-office change, kept', flush=True)
    out = run('grade.py', env)
    for line in out.splitlines():
        if line.startswith('incremental:') or line.startswith('duplicates'):
            print('   ', line)
    run('conserve.py', env)                          # no point credited twice: a failure stops the night
    # holding and draft style feed skills; the title model (odds, projected curves) and each decision's titles, whose
    # conservation check also stops the night
    for s in ('holding.py', 'draftstyle.py', 'titles_ref.py', 'titles.py', 'titles_dec.py'):
        run(s, env)
    for s in ('gm5.py', 'gm5_detail.py') + (() if light else ('repeat6.py', 'report6.py')) + ('build_page.py',):
        run(s, env)
    subprocess.run([sys.executable, os.path.join(HERE, 'page', 'assemble.py')], check=True, capture_output=True)
    subprocess.run([sys.executable, os.path.join(ROOT, 'pipeline', 'dataroom', 'catalog.py'), 'nba'], check=True, capture_output=True)
    tx_fp, all_fp = fingerprints(date)               # after: the frozen grades written tonight are part of the state
    json.dump({'tx': tx_fp, 'all': all_fp, 'date': date, 'full': full, 'at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')},
              open(STATE, 'w'))
    return 'full' if full else 'incremental'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--asof')
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--light', action='store_true', help='skip the weekly repeatability test')
    ap.add_argument('--no-rebuild', action='store_true')
    ap.add_argument('--full', action='store_true', help='rebuild everything (weekly; and whenever history changes)')
    a = ap.parse_args()
    today = a.asof or dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date().isoformat()
    now = (a.asof + 'T12:00:00Z') if a.asof else dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    print(f'NBA GM Savant update for {today}' + (f' ({windows(today)})' if windows(today) else ''), flush=True)
    notes = refresh_sources(today, a.offline)
    held, confirmed = confirm(today, now)
    print(f'  transactions: {len(held)} held for a second source, {len(confirmed)} newly confirmed', flush=True)
    fo = front_office(today, now)
    print(f'  front office: {len(fo)} change(s) pending confirmation', flush=True)
    if not a.no_rebuild:
        mode = rebuild(a.asof, a.light or bool(a.asof), full=a.full, offline=a.offline)
        print(f'  rebuild: {mode}', flush=True)
    t_now = dt.datetime.fromisoformat(now.replace('Z', '+00:00'))
    old = [h for h in held if (t_now - dt.datetime.fromisoformat(h['first_seen'].replace('Z', '+00:00'))).total_seconds() > WARN_H * 3600]
    old_fo = [r for r in fo if (t_now - dt.datetime.fromisoformat(r['first_seen'].replace('Z', '+00:00'))).total_seconds() > WARN_H * 3600]
    D = json.load(open(os.path.join(OUT, 'gm_decisions.json')))
    G = json.load(open(os.path.join(OUT, 'games.json')))
    beat = {'last_ok': now, 'asof': today, 'through': max(d['date'] for d in D if d['date'] <= today), 'decisions': len(D), 'sources': notes,
            'games_through': max((d for v in G.values() for ds in v.values() for d in ds if d <= today), default=None),
            'held': len(held), 'unconfirmed_over_48h': [{'date': h['date'], 'text': h['text'][:200], 'first_seen': h['first_seen']} for h in old],
            'front_office_pending': [{k: r[k] for k in ('team', 'person', 'kind', 'date', 'line', 'first_seen')} for r in fo],
            'front_office_over_48h': len(old_fo), 'window': windows(today)}
    detail = f"{len(held)} transaction(s) waiting for a second source, {len(fo)} front-office change(s) pending confirmation" + (
        '; pending: ' + '; '.join(f"{r['person']} ({r['team']}, {r['kind']})" for r in fo[:3]) if fo else '')
    open(os.path.join(OUT, 'control_detail.txt'), 'w').write(detail)
    if not a.asof:
        os.makedirs(os.path.dirname(BEAT), exist_ok=True)
        json.dump(beat, open(BEAT, 'w'), indent=1)
    print(json.dumps({k: beat[k] for k in ('asof', 'through', 'held', 'front_office_over_48h')}))
    if old or old_fo:
        print(f'::warning::{len(old)} transaction(s) and {len(old_fo)} front-office change(s) unconfirmed for more than {WARN_H} hours')
        sys.exit(2)                                  # the workflow reports exit 2 to the Control Room as a warning


if __name__ == '__main__':
    main()
