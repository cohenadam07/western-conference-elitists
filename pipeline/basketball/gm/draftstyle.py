"""
draftstyle.py — how a GM drafts against the consensus board (boards.py, consensus.py), 2005 on: every pick in a
draft with two or more boards.

  deviation   he passed on the consensus best available; how far: the chosen player's board rank minus the best
              available's (a reach is positive)
  success     each deviation against the player he passed on: a hit when the chosen player's first ten seasons beat
              the best available's; the total is the sum of those differences (the drafting grade, as it turned out)
  fit/talent  inferred from roster needs at Guard, Wing and Big. On draft day his roster's minutes from the season just
              ended (players he still held), by position, against the league's share at each position that season;
              the position furthest below the league's share is the one his roster lacked. A talent pick takes the
              consensus best available. A fit pick passes on him for a player at the lacking position when the best
              available plays another one. Any other pass is "other". Positions are each player's first NBA season's.
  minutes     how much the chosen player played for the team that drafted him in his first four seasons
Positions inferred from minutes say nothing of what the front office was told; the label says "inferred from
roster needs".

    python3 draftstyle.py      # -> out/gm_draft_style.json, keyed by decision id
"""
import collections, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
import gm5  # noqa: E402
GR = gm5.GR

POS = ('Guard', 'Wing', 'Big')
FIRST = 2005
MIN_YEARS = 4


def main():
    first_pos, mins = {}, collections.defaultdict(float)
    league = collections.defaultdict(lambda: collections.Counter())
    for r in sorted(GR.ROWS, key=lambda r: r['y']):
        first_pos.setdefault(r['id'], r['pos'])
        league[r['y']][r['pos']] += r['min'] or 0
    for r in GR.ROWS:
        mins[(r['id'], r['y'])] += r['min'] or 0
    dr = [d for d in gm5.D if d['type'] == 'draft' and d.get('grade_basis') == 'consensus' and int(d['date'][:4]) >= FIRST]
    H = gm5.holdings([(d['date'], d['team']) for d in dr])
    out = {}
    for d in dr:
        Y = int(d['date'][:4])
        team = d['team']
        mine = collections.Counter()
        for a in H.get((d['date'], team), []):
            if not a.startswith('player:'):
                continue
            pid, vid = GR.pid_of(a), GR.vid_of(a)
            sh = GR.SHARE.get((vid, Y), {}).get(team, 0.0)
            if pid in first_pos and sh:
                mine[first_pos[pid]] += mins.get((pid, Y), 0.0) * sh
        tot, lt = sum(mine.values()), sum(league[Y].values())
        lacking = None
        if tot and lt:
            gap = {p: mine[p] / tot - league[Y][p] / lt for p in POS}
            lacking = min(POS, key=lambda p: (gap[p], p))
            if gap[lacking] >= 0:
                lacking = None
        cp = first_pos.get(GR.pid_of(f"player:{d['player_br']}"))
        bp = first_pos.get(GR.pid_of(f"player:{d['best_available_br']}")) if d.get('best_available_br') else None
        dev = not d.get('easy_pick')
        cls = 'talent' if not dev else ('fit' if lacking and cp == lacking and bp and bp != lacking else 'other')
        aid = f"player:{d['player_br']}"
        pid, vid = GR.pid_of(aid), GR.vid_of(aid)
        played = sum(mins.get((pid, y), 0.0) * GR.SHARE.get((vid, y), {}).get(team, 0.0) for y in range(Y + 1, Y + 1 + MIN_YEARS))
        seen = min(MIN_YEARS, GR.NOW_SEASON - Y)          # seasons he could have played so far (the one in progress counts)
        out[d['decision_id']] = {'deviation': dev, 'reach': (d['consensus_rank'] - d['best_available_rank']) if dev else 0,
                                 'fit_class': cls, 'lacking': lacking, 'chosen_pos': cp, 'best_available_pos': bp,
                                 'roster_share': {p: round(mine[p] / tot, 3) for p in POS} if tot else None,
                                 'minutes_for_team': round(played), 'minutes_seasons': max(0, seen),
                                 'hit': (d['turned_out'] > 0) if dev else None}
    json.dump(out, open(os.path.join(OUT, 'gm_draft_style.json'), 'w'), indent=0)
    c = collections.Counter(v['fit_class'] for v in out.values())
    print('board picks', len(out), dict(c), '| no lacking position', sum(1 for v in out.values() if v['lacking'] is None))


if __name__ == '__main__':
    main()
