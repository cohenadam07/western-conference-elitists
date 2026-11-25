"""
pagefacts.py — the parsed facts the pipeline takes from fetched pages, so the cloud never needs (or holds) a raw page.

The repo is public, and a release would publish whatever it carries. So the pages stay on the Mac; what travels to the
cloud (encrypted, state_bundle.py) is only what the pipeline reads out of them, as plain data:

    tx_<season>.json.gz      every transaction paragraph: date, plain text, the player names and team codes it links,
                             and its parse (ledger.parse: kind, legs, players, picks, notes) — no markup
    totals_<season>.json.gz  the season totals table, one row per player-team: BR id, team, minutes, name
    drafts.json.gz           every draft: date and picks (round, overall, team, BR id, name)
    nba_movement.json.gz     NBA.com's player-movement rows (its own JSON data, the fields as given)
    team_links.json.gz       the team names the transaction pages link, by season

Every reader (ledger, grade, tenures, gm_update) uses the raw page when it has it and these facts when it doesn't;
GM_FACTS_ONLY=1 (the cloud) reads only the facts. python3 pagefacts.py check builds the facts from the pages and
confirms each reader returns the same thing both ways.

    python3 pagefacts.py export [--season 2027]    # on the Mac: all seasons, or just one (the nightly Mac lane)
    python3 pagefacts.py check
"""
import gzip, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
DIR = os.environ.get('GM_FACTS') or os.path.join(OUT, 'facts')
ONLY = os.environ.get('GM_FACTS_ONLY') == '1'


def path(name):
    return os.path.join(DIR, name + '.json.gz')


def load(name):
    p = path(name)
    return json.loads(gzip.open(p).read()) if os.path.exists(p) else None


def save(name, obj):
    os.makedirs(DIR, exist_ok=True)
    tmp = path(name) + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode(), 9, mtime=0))
    os.replace(tmp, path(name))


def raw(url):
    """The cached page, unless this run reads facts only."""
    if ONLY:
        return None
    from fetch import get
    c, b = get(url, offline=True)
    return b if c == 200 else None


# ---------------------------------------------------------------- what each reader takes from a page
def tx_rows_from_page(y, b):
    import html as H
    from br_tx import iso, url
    t = b.decode()
    rows = []
    for d, body in re.findall(r'<li[^>]*><span>([^<]+)</span>(.*?)</li>', t, re.S):
        date, approx = iso(d.strip())
        for k, p in enumerate(re.findall(r'<p[^>]*>(.*?)</p>', body, re.S)):
            rows.append({'season_end': y, 'date': date, 'approx': approx, 'n': k, 'html': p,
                         'text': ' '.join(H.unescape(re.sub(r'<[^>]+>', '', p)).split()), 'source': url(y),
                         'names': [re.sub(r'<[^>]+>', '', m) for m in re.findall(r'<a href="/players/[^"]+">([^<]+)</a>', p)],
                         'teams': re.findall(r'<a href="/teams/([A-Z]{3})/', p)})
    return rows


def tx_rows(y):
    """A season's paragraphs: from the page (with its markup, for the parser) or from the facts (already parsed)."""
    from br_tx import url
    b = raw(url(y))
    if b is not None:
        return tx_rows_from_page(y, b)
    return load(f'tx_{y}')


def totals_rows_from_page(b):
    t = b.decode('utf8', 'replace')
    # the regular season's table only: the page also carries the playoffs (totals_stats_post), and Savant value is a
    # regular-season value, so playoff minutes would tilt a traded player's shares toward his playoff team
    i = t.find('id="totals_stats"')
    if i >= 0:
        t = t[i:t.find('</table>', i)]
    out = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        pid = re.search(r'data-append-csv="([^"]+)"', tr)
        tm = re.search(r'data-stat="team_name_abbr"[^>]*>(?:<a[^>]*>)?([A-Z0-9]{2,3})', tr)
        if not (pid and tm):
            continue
        m = re.search(r'data-stat="mp"[^>]*>(?:<[^>]+>)*([\d,]+)', tr)       # a league leader's minutes are in <strong>
        nm = re.search(r'data-stat="name_display"[^>]*>(?:<a[^>]*>)?([^<]+)', tr)
        out.append([pid.group(1), tm.group(1), int(m.group(1).replace(',', '')) if m else None, nm.group(1) if nm else None])
    return out


def totals_rows(y):
    """[(BR id, team, minutes or None, name as the page gives it)] for a season, or None."""
    from br_more import totals
    if not ONLY:
        b = totals(y)
        if b:
            return totals_rows_from_page(b)
    return load(f'totals_{y}')


def drafts_from_pages():
    import ledger
    saved, ledger.ASOF = ledger.ASOF, None
    try:
        return {str(y): d for y, d in ledger._drafts_from_pages().items()}
    finally:
        ledger.ASOF = saved


def nba_rows():
    from ledger import NBA_FEED
    b = raw(NBA_FEED)
    if b is not None:
        return json.loads(b)['NBA_Player_Movement']['rows']
    return load('nba_movement')


def team_links_from_pages():
    from br_tx import url, FIRST, LAST
    out = []
    for y in range(FIRST, LAST + 1):
        b = raw(url(y))
        if b is not None:
            out += [[y, ab, nm] for ab, nm in re.findall(r'href="/teams/([A-Z]{3})/\d{4}\.html">([^<]+)</a>', b.decode())]
    return out


def team_links():
    if not ONLY:
        L = team_links_from_pages()
        if L:
            return L
    return load('team_links') or []


# ---------------------------------------------------------------- export and check
def export(season=None):
    import ledger, br_tx
    from br_more import totals
    seasons = [season] if season else list(range(br_tx.FIRST, br_tx.LAST + 1))
    n = 0
    for y in seasons:
        b = raw(br_tx.url(y))
        if b is not None:
            rows = tx_rows_from_page(y, b)
            for r in rows:
                r['parsed'] = ledger.parse(r)
                del r['html']
            save(f'tx_{y}', rows)
            n += 1
        tb = totals(y)
        if tb:
            save(f'totals_{y}', totals_rows_from_page(tb))
    save('drafts', drafts_from_pages())
    rows = nba_rows()
    if rows is not None:
        save('nba_movement', rows)
    save('team_links', team_links_from_pages())
    print(f'facts written to {DIR}: {n} transaction season(s), drafts, NBA.com movement, team links')


def check():
    """Every reader, from the pages and from the facts: the same answer."""
    import importlib, ledger
    global ONLY
    export()
    results = {}
    for only in (False, True):
        ONLY = only
        importlib.reload(ledger)
        P = ledger.paragraphs()
        results[only] = {'paragraphs': [ledger.parse(p) for p in P], 'drafts': ledger.drafts(), 'rosters': {f'{k[0]}|{k[1]}': v for k, v in ledger.rosters().items()},
                         'nba': nba_rows(), 'team_links': team_links(), 'names': [(p.get('names'), p.get('teams')) for p in P]}
    for k in results[False]:
        a, b = json.dumps(results[False][k], sort_keys=True, default=str), json.dumps(results[True][k], sort_keys=True, default=str)
        print(f'{k:12} {"same" if a == b else "DIFFERENT"} ({len(results[False][k]) if hasattr(results[False][k], "__len__") else ""})')
    return all(json.dumps(results[False][k], sort_keys=True, default=str) == json.dumps(results[True][k], sort_keys=True, default=str) for k in results[False])


if __name__ == '__main__':
    if sys.argv[1:2] == ['export']:
        export(int(sys.argv[sys.argv.index('--season') + 1]) if '--season' in sys.argv else None)
    elif sys.argv[1:2] == ['check']:
        sys.exit(0 if check() else 1)
