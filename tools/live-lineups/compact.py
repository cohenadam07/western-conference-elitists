"""ESPN men's college basketball summary JSON -> the compact game the backtest parser reads.

Play rows: [period, clock, team_id, type, text, scoreValue, scoringPlay, shootingPlay, [participant ids], x, y, homeScore, awayScore]
box: {team_id: [[athlete_id, name, starter, didNotPlay, pos], ...]}

The browser does the same thing in public/live-lineups/js/engine.js `compact()`; tools/live-lineups/parity.mjs
checks the two produce identical possessions on the same raw files.
"""
import json, gzip


def compact(raw, gid=None):
    comp = raw['header']['competitions'][0]
    home = away = None
    score = {}
    for c in comp['competitors']:
        tid = c['team']['id']
        if c['homeAway'] == 'home': home = tid
        else: away = tid
        score[tid] = c.get('score')
    box = {}
    for t in raw.get('boxscore', {}).get('players', []) or []:
        tid = t['team']['id']
        rows = []
        for st in t.get('statistics', [])[:1]:
            for a in st.get('athletes', []):
                ath = a['athlete']
                rows.append([ath['id'], ath.get('displayName', ''), bool(a.get('starter')), bool(a.get('didNotPlay')),
                             (ath.get('position') or {}).get('abbreviation', '')])
        box[tid] = rows
    plays = []
    for p in raw.get('plays', []) or []:
        co = p.get('coordinate') or {}
        plays.append([p['period']['number'], p['clock']['displayValue'], (p.get('team') or {}).get('id'),
                      (p.get('type') or {}).get('text', ''), p.get('text', ''), p.get('scoreValue', 0) or 0,
                      bool(p.get('scoringPlay')), bool(p.get('shootingPlay')),
                      [a['athlete']['id'] for a in (p.get('participants') or []) if a.get('athlete')],
                      co.get('x'), co.get('y'), p.get('homeScore'), p.get('awayScore')])
    return dict(gid=gid or comp.get('id'), date=comp.get('date'), home=home, away=away, score=score, box=box, plays=plays)


def load(path):
    return compact(json.load(gzip.open(path) if path.endswith('.gz') else open(path)))
