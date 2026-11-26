"""
model_data.py — Module 3's table: every player-season 1979-80 on with its Savant value (computed by
tools/savant-value/value.py, the one implementation), age, possessions, games, and draft slot.

Shortened seasons: value is also given on an 82-game footing, value82 = value x 82 / games per team
that season (1998-99: 50, 2011-12: 66, 2019-20 and 2020-21 short). A definition, not a fit: a season
with 61% of the games can only produce 61% of the possessions.

    python3 model_data.py             # -> out/model_seasons.json (every season)
    python3 model_data.py --current   # the nightly re-mark: only the season in progress is recomputed (from
                                      # savant-current.json, 3 MB); past seasons are reused while their inputs are
                                      # unchanged (else it falls back to every season). 983 MB -> under 200 MB.
"""
import collections, json, os, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'tools', 'savant-value'))
sys.path.insert(0, os.path.join(HERE, '..'))
import value as V                       # noqa: E402
from br_crosswalk import canonical_id   # noqa: E402
from ledger import drafts               # noqa: E402

OUT = os.path.join(HERE, 'out')


BASIS = os.path.join(OUT, 'model_data_basis.json')


def basis(G, D):
    """What past seasons' rows depend on: the history file, the value weights and code, the page's position fixes,
    the team-game counts and draft slots of past seasons."""
    import hashlib
    h = hashlib.sha1()
    for f in (os.path.join(REPO, 'public', 'savant-data.json'), V.WEIGHTS, os.path.join(REPO, 'public', 'basketball-savant.html'),
              V.__file__, os.path.abspath(__file__)):
        h.update(open(f, 'rb').read())
    cur = max(G)
    h.update(json.dumps({s: t for s, t in G.items() if s != cur}, sort_keys=True).encode())
    h.update(json.dumps(D, sort_keys=True, default=str).encode())
    return h.hexdigest()


def build(current_only=False):
    model = json.load(open(V.WEIGHTS))
    G = json.load(open(os.path.join(OUT, 'games.json')))
    D = drafts()
    b = basis(G, D)
    cur = max(G)
    prev = None
    if current_only and os.path.exists(BASIS) and json.load(open(BASIS)).get('basis') == b:
        prev = [r for r in json.load(open(os.path.join(OUT, 'model_seasons.json'))) if r['season'] != cur]
        print(f'past seasons reused ({len(prev)} rows); recomputing {cur}')
    rows = V.load([os.path.join(REPO, 'public', 'savant-current.json')] if prev is not None else None)
    S = V.by_season(rows)
    if prev is not None:
        S = {s_: v for s_, v in S.items() if s_ == cur}
    ages = {}
    for f in (('savant-current.json',) if prev is not None else ('savant-data.json', 'savant-current.json')):
        p = os.path.join(REPO, 'public', f)
        if os.path.exists(p):
            for s, blk in json.load(open(p))['data'].items():
                for pl in blk['players']:
                    ages[(s, pl['id'])] = (pl.get('age'), pl.get('birthdate'))
    games = {s: statistics.median(len(v) for v in teams.values()) for s, teams in G.items()}
    # NBA Savant gave each player one id (pipeline/basketball/moved_player_ids.json, Nov 26 2026): the 15 careers it
    # split at 1996-97, and 59 players before it that no name matched, now carry an NBA id where canonical_id still
    # gives "br:<id>". A season before 1996-97 reads the draft through the moved ids, as it did under its "br:" id;
    # without that, 237 rows lose their pick and 20 players join the undrafted rookies (the T=1995 baseline 17 -> 37).
    # A season from 1996-97 on reads it as before: under the NBA id the crosswalk never found these 15 players' picks,
    # so those seasons have no draft slot and their projections treat them as undrafted. Kept as it was so the merge
    # moves no GM number; giving them their slot changes 15 how-it-turned-out trade values, up to 186 points (Glen
    # Rice and Muggsy Bogues, New York 2001), and is GM Savant's own change to make.
    mp = os.path.join(REPO, 'pipeline', 'basketball', 'moved_player_ids.json')
    moved = {k: v['to'] for k, v in json.load(open(mp))['moved'].items()} if os.path.exists(mp) else {}
    draft, draft_moved = {}, {}
    for y, d in D.items():
        for rnd, ov, team, pid, name in d['picks']:
            if pid:
                k = canonical_id(pid, name)
                draft.setdefault(k, (y, ov, rnd, team, pid))
                draft_moved.setdefault(moved.get(k, k), (y, ov, rnd, team, pid))
    out = []
    for s in sorted(S):
        rs = S[s]
        V.season_features(rs)
        V.apply_season(rs, model)
        g = games.get(s, 82)
        for r in rs:
            if r.get('value') is None:
                continue
            age, bd = ages.get((s, r['id']), (None, None))
            dr = (draft_moved if int(s[:4]) + 1 < 1997 else draft).get(r['id'])
            out.append({'season': s, 'y': int(s[:4]) + 1, 'id': r['id'], 'name': r['name'], 'team': r['team'], 'pos': r['pos'],
                        'age': age, 'value': round(r['value'], 2), 'value82': round(r['value'] * 82 / g, 2), 'poss': r['poss'],
                        'poss82': round(r['poss'] * 82 / g), 'gp': r['gp'], 'min': r['min'], 'team_games': g,
                        'draft_year': dr[0] if dr else None, 'draft_pick': dr[1] if dr else None, 'br_id': dr[4] if dr else None})
    # era footing: Savant value's league total per team-season drifts (late 1980s about 25% above the 2020s), so each
    # season is scaled to the all-season average total; valuer keeps points as the unit
    if prev is not None:                      # completed seasons set the era scale; they are unchanged
        es = json.load(open(os.path.join(OUT, 'era_scale.json')))
        ref, per_team = es['reference_total_per_team_season'], es['per_team_season']
    else:
        comp = [r for r in out if r['y'] <= 2026]
        tot = collections.defaultdict(float)
        for r in comp:
            tot[r['season']] += r['value82']
        per_team = {s_: tot[s_] / len(G[s_]) for s_ in tot}
        ref = sum(per_team.values()) / len(per_team)
    for r in out:
        f = ref / per_team.get(r['season'], ref)
        r['era_factor'] = round(f, 4)
        r['valuer'] = round(r['value82'] * f, 2)
    if prev is None:
        json.dump({'reference_total_per_team_season': ref, 'per_team_season': per_team}, open(os.path.join(OUT, 'era_scale.json'), 'w'), indent=0)
        json.dump({'basis': b}, open(BASIS, 'w'))
    return (prev + out) if prev is not None else out, games


if __name__ == '__main__':
    out, games = build(current_only='--current' in sys.argv)
    json.dump(out, open(os.path.join(OUT, 'model_seasons.json.tmp'), 'w'))
    os.replace(os.path.join(OUT, 'model_seasons.json.tmp'), os.path.join(OUT, 'model_seasons.json'))
    seasons = collections.Counter(r['season'] for r in out)
    print('player-seasons', len(out), 'seasons', len(seasons), min(seasons), max(seasons))
    print('with age', sum(1 for r in out if r['age'] is not None), '| with a draft slot', sum(1 for r in out if r['draft_pick']))
    print('short seasons:', {s: g for s, g in games.items() if g < 80})
