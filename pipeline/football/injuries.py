#!/usr/bin/env python3
"""NFL injury status for Football Savant -> public/football-injuries/current.json.

Football Savant's cards are built from nflverse, which says what a player did, not
whether he can play this week. This job fills that gap from two free feeds:

  ESPN   site.api.espn.com/.../nfl/injuries   every run (a few times a day)
  Sleeper api.sleeper.app/v1/players/nfl      at most once a day, as Sleeper asks;
                                               the injured slice is cached between runs
                                               in data/football-sleeper-injuries.json

Ids: ESPN ids are mapped to GSIS (Football Savant's ids) with nflverse's players.csv,
then with Sleeper's own gsis_id/espn_id pairs for anyone nflverse misses. Sleeper rows
carry gsis_id directly. Anyone who still fails to map is logged and left out.

When both feeds have a player, the more recently updated entry wins. Healthy players
are left out of the file. Trust the feed: there is no manual override.

The file also names the current NFL week and the teams on bye, from the nflverse
schedule, so the page can tell a bye from an injury.

Fail-safe: if ESPN cannot be read, or the merged result is implausibly small, the last
good file is kept untouched and the job exits non-zero (the Action goes red, sends mail).

Stdlib only, so the Action needs no installs.

  python3 injuries.py                      # writes ../../public/football-injuries/current.json
  INJ_OUT=/tmp/x.json python3 injuries.py  # somewhere else
"""
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
# In a folder of its own: the connector-coverage check runs on every change to a top-level
# public/*.json, and this file changes many times a day.
OUT = os.environ.get('INJ_OUT', os.path.join(REPO, 'public', 'football-injuries', 'current.json'))
# Outside pipeline/football/, whose changes set off the full Football Savant refresh.
STATE = os.environ.get('INJ_STATE', os.path.join(REPO, 'data'))
SLEEPER_CACHE = os.path.join(STATE, 'football-sleeper-injuries.json')
SLEEPER_MAX_AGE_H = 20          # "once a day", with slack for a drifting schedule

ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries'
SLEEPER_URL = 'https://api.sleeper.app/v1/players/nfl'
NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download'
PLAYERS_URL = NFLVERSE + '/players/players.csv'
SCHEDULE_URL = NFLVERSE + '/schedules/games.csv'

# The one vocabulary the page and the fantasy tools read.
ORDER = ['IR', 'PUP', 'Out', 'Suspended', 'Doubtful', 'Questionable']
# Out, IR, PUP and Suspended mean he will not play; Q and D are a warning only.
WONT_PLAY = {'IR', 'PUP', 'Out', 'Suspended'}

# Sleeper never clears a tag it set, so a Sleeper-only flag is believed only if his news
# moved recently: two weeks for game-status tags, half a year for IR / PUP / suspension.
SLEEPER_FRESH_DAYS = {'Questionable': 14, 'Doubtful': 14, 'Out': 21,
                      'IR': 183, 'PUP': 183, 'Suspended': 183}

# Fewer flagged players than this in-season means a feed came back broken, not that the
# league got healthy. (A typical October week has 250-350.)
MIN_IN_SEASON = 60


def log(*a):
    print(*a, file=sys.stderr)


def get(url, timeout=90, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'wcehoops-football-savant/1.0'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - every failure is retried the same way
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError('%s: %s' % (url, last))


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_time(s):
    if not s:
        return None
    s = s.strip().replace('Z', '+00:00')
    if re.match(r'.*T\d\d:\d\d\+', s):            # ESPN drops the seconds
        s = s.replace('+', ':00+', 1)
    try:
        t = dt.datetime.fromisoformat(s)
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def norm_status(raw):
    """Map either feed's wording onto ORDER; None for healthy / unknown."""
    if not raw:
        return None
    s = raw.strip().lower()
    if s in ('active', 'na', 'dnr', 'cov', ''):
        return None
    if 'reserve' in s or s in ('ir', 'injured reserve') or s.startswith('ir'):
        return 'IR'
    if 'pup' in s or 'physically unable' in s:
        return 'PUP'
    if s.startswith('sus'):
        return 'Suspended'
    if s.startswith('doubt'):
        return 'Doubtful'
    if s.startswith('question'):
        return 'Questionable'
    if s.startswith('out') or s == 'o':
        return 'Out'
    return None


# ---------------------------------------------------------------- id crosswalk

def load_crosswalk(sleeper_rows, sleeper_ids):
    """espn_id -> (gsis_id, team) from nflverse players.csv, topped up from Sleeper."""
    espn2 = {}
    gsis_team = {}
    try:
        text = get(PLAYERS_URL).decode('utf-8', 'replace')
        for r in csv.DictReader(io.StringIO(text)):
            g = (r.get('gsis_id') or '').strip()
            e = (r.get('espn_id') or '').strip()
            if g:
                gsis_team[g] = (r.get('latest_team') or '').strip()
            if g and e:
                espn2[e.split('.')[0]] = g
    except RuntimeError as e:
        log('nflverse players.csv unavailable, Sleeper ids only:', e)
    for e, g in sleeper_ids.items():
        espn2.setdefault(str(e), g)
    for p in sleeper_rows:
        g = p.get('gsis_id')
        if g and p.get('team') and g not in gsis_team:
            gsis_team[g] = p['team']
    return espn2, gsis_team


# ---------------------------------------------------------------- feeds

ESPN_ID = re.compile(r'/id/(\d+)')


def espn_entries():
    """(flagged entries, {espn_id: time} for players ESPN lists as back to Active)."""
    j = json.loads(get(ESPN_URL))
    out, cleared = [], {}
    for team in j.get('injuries', []):
        for i in team.get('injuries', []):
            ath = i.get('athlete') or {}
            eid = None
            for ln in ath.get('links') or []:
                m = ESPN_ID.search(ln.get('href') or '')
                if m:
                    eid = m.group(1)
                    break
            status = norm_status(i.get('status')) or norm_status(((i.get('type') or {}).get('description')))
            if not status:
                if eid and (i.get('status') or '').lower() == 'active':
                    cleared[eid] = parse_time(i.get('date'))
                continue
            det = i.get('details') or {}
            body = det.get('type') or None
            out.append({
                'espn_id': eid,
                'name': ath.get('displayName'),
                'pos': ((ath.get('position') or {}).get('abbreviation')),
                'status': status,
                'body': body,
                'side': det.get('side') if det.get('side') in ('Left', 'Right') else None,
                'note': (i.get('shortComment') or '').strip() or None,
                'return_est': det.get('returnDate') or None,
                'updated_at': parse_time(i.get('date')),
                'source': 'ESPN',
            })
    return out, cleared


def sleeper_rows():
    """The injured slice of Sleeper's player feed, fetched at most once a day.

    Returns (flagged rows, espn_id -> gsis_id pairs for rostered players). Only that
    much is cached between runs, so the committed cache stays small."""
    os.makedirs(STATE, exist_ok=True)
    cached = None
    try:
        cached = json.load(open(SLEEPER_CACHE))
        age_h = (now_utc() - parse_time(cached['fetched_at'])).total_seconds() / 3600
        if age_h < SLEEPER_MAX_AGE_H:
            log('Sleeper: using cache from %.1f h ago' % age_h)
            return cached['players'], cached.get('ids', {})
    except (OSError, ValueError, KeyError, TypeError):
        pass
    try:
        j = json.loads(get(SLEEPER_URL, timeout=180))
    except RuntimeError as e:
        log('Sleeper fetch failed, keeping cache:', e)
        return (cached or {}).get('players', []), (cached or {}).get('ids', {})
    rows, ids = [], {}
    for p in j.values():
        if (p.get('sport') or 'nfl') != 'nfl':
            continue
        g = (p.get('gsis_id') or '').strip() or None
        st = norm_status(p.get('injury_status'))
        if g and p.get('espn_id') and p.get('team'):
            ids[str(p['espn_id'])] = g
        if not g or not st or not p.get('active') or not p.get('team'):
            continue
        upd = p.get('news_updated')
        rows.append({
            'gsis_id': g,
            'espn_id': p.get('espn_id'),
            'team': p.get('team'),
            'name': ' '.join(x for x in (p.get('first_name'), p.get('last_name')) if x),
            'pos': p.get('position'),
            'status': st,
            'body': p.get('injury_body_part') or None,
            'note': p.get('injury_notes') or None,
            'updated_at': iso(dt.datetime.fromtimestamp(upd / 1000, dt.timezone.utc)) if upd else None,
        })
    with open(SLEEPER_CACHE, 'w') as f:
        json.dump({'fetched_at': iso(now_utc()), 'players': rows, 'ids': ids}, f,
                  separators=(',', ':'), sort_keys=True)
    log('Sleeper: fetched, %d flagged, %d id pairs' % (len(rows), len(ids)))
    return rows, ids


# ---------------------------------------------------------------- week and byes

def week_and_byes(today):
    """Current regular-season week (the first one not fully in the past) and its bye teams."""
    text = get(SCHEDULE_URL).decode('utf-8', 'replace')
    rows = list(csv.DictReader(io.StringIO(text)))
    seasons = [int(r['season']) for r in rows if r.get('season', '').isdigit()]
    season = max(seasons)
    reg = [r for r in rows if r.get('season') == str(season) and r.get('game_type') == 'REG']
    by_week = {}
    for r in reg:
        try:
            d = dt.date.fromisoformat(r['gameday'])
        except (KeyError, ValueError):
            continue
        w = int(r['week'])
        by_week.setdefault(w, {'last': d, 'teams': set()})
        by_week[w]['last'] = max(by_week[w]['last'], d)
        by_week[w]['teams'].update((r['home_team'], r['away_team']))
    if not by_week:
        return season, None, []
    all_teams = set().union(*(v['teams'] for v in by_week.values()))
    week = next((w for w in sorted(by_week) if by_week[w]['last'] >= today), None)
    if week is None:
        return season, None, []           # regular season is over
    return season, week, sorted(all_teams - by_week[week]['teams'])


# ---------------------------------------------------------------- merge and write

def main():
    t0 = now_utc()
    try:
        espn, espn_cleared = espn_entries()
    except RuntimeError as e:
        log('ESPN unavailable; keeping the last good file:', e)
        return 2
    sl, sl_ids = sleeper_rows()
    espn2gsis, gsis_team = load_crosswalk(sl, sl_ids)
    epoch = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)

    merged = {}
    unmapped = []
    for e in espn:
        g = espn2gsis.get(e['espn_id'] or '')
        if not g:
            unmapped.append('%s (%s, espn %s)' % (e['name'], e['pos'], e['espn_id']))
            continue
        e = dict(e, gsis_id=g)
        prev = merged.get(g)
        if not prev or (e['updated_at'] or epoch) > (prev['updated_at'] or epoch):
            merged[g] = e
    cleared = {espn2gsis[k]: v for k, v in espn_cleared.items() if k in espn2gsis}

    for s in sl:
        g, st = s['gsis_id'], s['status']
        su = parse_time(s.get('updated_at'))
        cur = merged.get(g)
        if cur:
            # ESPN's entry is the richer one (note, side, return date). Sleeper replaces it
            # only when the two disagree and Sleeper's news is the newer.
            if st == cur['status'] or not su or (cur['updated_at'] and su <= cur['updated_at']):
                continue
        else:
            if not su or (t0 - su).days > SLEEPER_FRESH_DAYS.get(st, 14):
                continue                      # a tag Sleeper never cleared
            if g in cleared and cleared[g] and cleared[g] >= su:
                continue                      # ESPN has him back to Active since
        merged[g] = {
            'gsis_id': g, 'name': s['name'], 'pos': s['pos'], 'status': st,
            'body': s['body'], 'side': None, 'note': s['note'], 'return_est': None,
            'updated_at': su, 'source': 'Sleeper',
        }

    try:
        season, week, byes = week_and_byes(dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date())
    except RuntimeError as e:
        log('schedule unavailable; bye list left empty:', e)
        season, week, byes = None, None, []

    players = {}
    for g, e in merged.items():
        players[g] = {k: v for k, v in {
            'status': e['status'],
            'out': e['status'] in WONT_PLAY,
            'body': e['body'],
            'side': e['side'],
            'note': e['note'],
            'return_est': e['return_est'],
            'name': e['name'],
            'pos': e['pos'],
            'team': gsis_team.get(g) or None,
            'source': e['source'],
            'updated_at': iso(e['updated_at']) if e['updated_at'] else None,
        }.items() if v is not None}

    if week is not None and len(players) < MIN_IN_SEASON:
        log('only %d flagged players in-season; the feed looks broken, keeping the last good file'
            % len(players))
        return 3

    out = {
        'generated_at': iso(t0),
        'season': season,
        'week': week,
        'bye_teams': byes,
        'statuses': ORDER,
        'wont_play': sorted(WONT_PLAY),
        'sources': ['ESPN', 'Sleeper'],
        'players': dict(sorted(players.items())),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
    # The Action commits only when something besides generated_at changed.
    os.replace(tmp, OUT)

    counts = {s: sum(1 for p in players.values() if p['status'] == s) for s in ORDER}
    log('wrote %s: %d players %s; week %s, bye %s'
        % (os.path.relpath(OUT, REPO), len(players), counts, week, ','.join(byes) or '-'))
    if unmapped:
        log('%d ESPN entries could not be mapped to a GSIS id:' % len(unmapped))
        for u in unmapped[:40]:
            log('  ' + u)
    return 0


if __name__ == '__main__':
    sys.exit(main())
