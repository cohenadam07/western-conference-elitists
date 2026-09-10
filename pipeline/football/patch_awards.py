"""Merge agg/awards.json into an already-built football-savant-data.json.

The awards are career-level facts keyed by the same player id the dataset already uses, so
they can be attached to a finished file without re-running the whole pipeline — which
matters, because a full rebuild means re-downloading about 750 MB of nflverse sources.

build.py calls the same merge, so a future full rebuild carries awards too; this script is
for the case where the dataset is fine and only the awards are new.

    python3 awards.py                 # writes agg/awards.json
    python3 patch_awards.py           # folds it into public/football-savant-data.json
"""
import json, os, shutil, sys

AGG = os.environ.get('NFL_AGG', 'agg')
AWARDS = os.environ.get('NFL_AWARDS', os.path.join(AGG, 'awards.json'))
DATA = os.environ.get('NFL_DATA', '../../public/football-savant-data.json')


def attach(data, awards):
    """Put the awards on the dataset and report what they cover.

    Stored as one top-level map rather than copied onto every player-season: they describe
    a career, not a year, and the page reads them when it builds a career row.
    """
    data['awards'] = awards
    ids = set()
    for s in data['seasons']:
        for p in data['data'][s]['players']:
            ids.add(p['id'])
    known = [k for k in awards if k in ids]
    data['awardsMeta'] = {
        'source': 'nflverse draft_picks (Pro Bowl, All-Pro, Hall of Fame — drafted players '
                  'only, career totals including seasons before 1999) + Wikipedia '
                  '(MVP, OPOY, DPOY, OROY, DROY — resolved inside the winning season)',
        'players': len(known),
    }
    return len(known)


def main():
    if not os.path.exists(AWARDS):
        sys.exit('no awards at %s — run awards.py first' % AWARDS)
    if not os.path.exists(DATA):
        sys.exit('no dataset at %s' % DATA)
    with open(AWARDS) as f:
        awards = json.load(f)
    with open(DATA) as f:
        data = json.load(f)

    n = attach(data, awards)
    bak = DATA + '.bak'
    if not os.path.exists(bak):
        shutil.copy2(DATA, bak)
        print('kept a copy at %s' % bak)
    tmp = DATA + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    os.replace(tmp, DATA)
    print('merged awards for %d players in the dataset (%d rows carried)' % (n, len(awards)))
    print('%s is now %.1f MB' % (DATA, os.path.getsize(DATA) / 1e6))


if __name__ == '__main__':
    main()
