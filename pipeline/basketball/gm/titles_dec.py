"""
titles_dec.py — every decision's expected titles, both grades, and the titles conservation check.

Each decision's titles are with it minus without it: in each season, the team's title chance at its strength minus at
its strength less the decision's points that season (titlecurve.with_without: a played season read off the team's
own replays at other strengths; a season ahead off the projected curve), ten seasons at 5%. Not the conserving split
(the check below uses that): the split shares out what a team-season won; with-and-without asks what this one decision
changed, so decisions' titles do not add up to the team's, just as decisions' points do not add up to GM Value Added.

As it turned out: the decision's points, season by season (the conserved stream conserve.py checks; for a re-signing,
an extension or a coach decision, the stream behind its shown grade; for a draft graded against the consensus board,
the chosen player's seasons less the best available's, the comparison its points make), with and without (the played
season's replays, or today's projection for seasons to come), ten seasons at 5% like the points.
At the time: the at-the-time points season by season as they were projected that day (the same point-in-time snapshots
the at-the-time grade sums; a draft pick's spread over its seasons by the slot curve; a coach decision's over the three
seasons its grade covers), with and without on the projected title curve as of that day. Nothing later is read.

The conservation check, for titles. In every played team-season (1980-81 to 2025-26) the team's expected titles above
an average team's (E - 1/N) split into: its decisions (each one's points that season x the slope); the moves no one
decided (conserve.py's booked moves x the slope); the league baseline (minus the league's average team value x the
slope: decisions count value above replacement, the curve starts at average); what player value misses (luck-adjusted
strength less team value above the league average, x the slope: coaching, fit, defense before 2007-08); the average
team's shortfall (E0 - 1/N: an average team wins less than its 1/N share, because titles go to the best); and, for a
team within titles.NEAR of average, the gap between the derivative and the secant. They must add up to E - 1/N; what is
left is the points check's own gap times the slope.

    python3 titles_dec.py      # -> out/gm_decision_titles.json, out/title_conservation.json; exit 1 if it does not add up
With GM_FREEZE=1 (the production refresh) an at-the-time titles grade, once written, is kept as stored
(out/frozen_titles_at_time.json), like the at-the-time points.
"""
import collections, json, os, sys

import grade as GR
import titlecurve as TC

OUT = GR.OUT
MAX_ONE, MAX_ALL = 0.02, 0.10          # titles: the points check's limits (50, 150) times a contender's slope, about


def career_seasons(br, Y):
    """A draftee's seasons, any team, ten from the season after the draft (projected where not yet played), as the
    drafting grade counts them."""
    aid = f'player:{br}'
    vid, pid = GR.vid_of(aid), GR.pid_of(aid)
    out = {y: GR.VAL.get((vid, y), 0.0) for y in range(Y + 1, min(Y + 1 + GR.HORIZON, GR.NOW_SEASON + 1))}
    if Y + 1 + GR.HORIZON > GR.NOW_SEASON:
        seasons, _ = GR.pv_player_seasons(pid, GR.TODAY)
        for y, v in seasons.items():
            if max(Y + 1, GR.NOW_SEASON) <= y < Y + 1 + GR.HORIZON:
                out[y] = out.get(y, 0.0) + v
    return out


_CG = None


def board_vs_slot(d):
    """A board pick at the time: the board's expected value for the chosen player's consensus rank less its expected
    value at the slot (an average pick there), on the same curve, as known on draft day (consensus.Grader.ev)."""
    global _CG
    import consensus
    from ledger import drafts
    if _CG is None:
        _CG = (consensus.Grader(GR), drafts())
    cg, DD = _CG
    Y = int(d['date'][:4])
    return cg.ev(Y, d['date'], DD, d['consensus_rank']) - cg.ev(Y, d['date'], DD, d['slot'])


def at_stream(d, slot_basis=False):
    """The at-the-time points by season, undiscounted, as known on the agreement day, and the season they count from."""
    y0, day = GR.season_of(d['agreed']), d['agreed']
    t = d['type']

    def seasons(a):
        s, _, _ = GR.pv(a, day)
        return s
    if t in ('trade', 'sign-and-trade'):
        st = collections.Counter()
        for a in d['in']:
            st.update(seasons(a))
        for a in d['out']:
            st.subtract(seasons(a))
        return sorted(st.items()), y0
    if d.get('asset') and t in ('signing', 'waiver claim', 're-signing', 'extension', 'waiver', 'release', 'left in free agency'):
        sign = -1 if t in ('waiver', 'release', 'left in free agency') else 1
        return sorted((y, sign * v) for y, v in seasons(d['asset']).items()), y0
    if t == 'draft':
        Y = int(d['date'][:4])
        shape = GR.slot_seasons(Y, d['slot'], d['date'])
        tot = sum(v * GR.w(y, Y + 1) for y, v in shape)
        target = board_vs_slot(d) if slot_basis and d.get('consensus_rank') else d['at_time']
        return ([(y, target * v / tot) for y, v in shape] if tot else []), Y + 1
    if t in ('coach hire', 'coach firing'):
        return [(y0 + k, d['at_time'] / 3) for k in range(3)], y0
    return [], y0


def scaled(st, y0, target):
    """The stream scaled so its ten seasons at 5% equal the stored grade (a frozen at-the-time grade, kept as stored)."""
    if target is None:
        return st
    tot = sum(v * GR.w(y, y0) for y, v in st if y0 <= y < y0 + GR.HORIZON)
    if abs(tot - target) <= 0.5 or not tot:
        return st
    return [(y, v * target / tot) for y, v in st]


def main():
    D = json.load(open(os.path.join(OUT, 'gm_decisions.json')))
    S = json.load(open(os.path.join(OUT, 'decision_streams.json')))
    K = json.load(open(os.path.join(OUT, 'decision_kept_streams.json')))
    out, per_season = {}, collections.defaultdict(float)
    mism = collections.Counter()
    for d in D:
        did, team = d['decision_id'], d['team']
        rec = {}
        y0 = GR.season_of(d['agreed'])
        # as it turned out
        # a draft pick, as it turned out: the player's seasons less an average pick's at that slot (the conserved slot
        # split), so the title number measures what the pick did to the roster. The board comparison (against the best
        # available) stays the drafting skill's: it measures judgment, not the roster.
        if did in S:
            st = S[did]
            yy = int(d['date'][:4]) + 1 if d['type'] == 'draft' else y0
            rec['titles_turned_out'] = TC.with_without(st, team, yy, 'turned_out')
        elif did in K:
            rec['titles_turned_out'] = TC.with_without(K[did], team, y0, 'turned_out')
        else:
            rec['titles_turned_out'] = 0.0 if d.get('turned_out') is not None else None
        if d.get('turned_out') is None:
            rec['titles_turned_out'] = None
        # the conserved streams, undiscounted by played season, for the check
        for y, v in S.get(did, []):
            if y <= TC.LAST_PLAYED:
                r = TC.realized(team, y)
                if r:
                    per_season[(team, y)] += v * r['slope']
        # at the time
        if d.get('at_time') is None:
            rec['titles_at_time'] = None
        else:
            st, ya = at_stream(d, slot_basis=True)
            if d['type'] in ('trade', 'sign-and-trade') or d.get('asset'):
                tot = sum(v * GR.w(y, ya) for y, v in st if ya <= y < ya + GR.HORIZON)
                mism[abs(tot - d['at_time']) > 0.5] += 1
                st = scaled(st, ya, d['at_time'])
            t, early = TC.with_without(st, team, ya, 'at_time', as_of=d['agreed'])
            rec['titles_at_time'] = None if early else t
        out[did] = {k: (None if v is None else round(v, 5)) for k, v in rec.items()}
    if os.environ.get('GM_FREEZE') == '1':          # at-the-time titles are written once, like the at-the-time points
        fp = os.path.join(OUT, 'frozen_titles_at_time.json')
        F = json.load(open(fp)) if os.path.exists(fp) else {}
        for did, rec in out.items():
            if did in F:
                rec['titles_at_time'] = F[did]
            elif rec['titles_at_time'] is not None:
                F[did] = rec['titles_at_time']
        json.dump(F, open(fp + '.tmp', 'w'), separators=(',', ':'))
        os.replace(fp + '.tmp', fp)
    tmp = os.path.join(OUT, 'gm_decision_titles.json.tmp')
    json.dump(out, open(tmp, 'w'), separators=(',', ':'))
    os.replace(tmp, os.path.join(OUT, 'gm_decision_titles.json'))
    print(f'{len(out)} decisions: titles as it turned out for {sum(1 for v in out.values() if v["titles_turned_out"] is not None)}, '
          f'at the time for {sum(1 for v in out.values() if v["titles_at_time"] is not None)}; at-the-time streams off the stored grade by more than 0.5 '
          f'points (scaled to it): {mism[True]} of {sum(mism.values())}', flush=True)
    return conservation(per_season)


def conservation(dec_titles):
    C = json.load(open(os.path.join(OUT, 'conservation.json')))
    league_avg = collections.defaultdict(list)
    for r in C['rows']:
        league_avg[r['season']].append(r['produced'])
    league_avg = {y: sum(v) / len(v) for y, v in league_avg.items()}
    rows, off = [], []
    for r in C['rows']:
        t, y = r['team'], r['season']
        if y > TC.LAST_PLAYED:
            continue
        re = TC.realized(t, y)
        if not re:
            continue
        sl = re['slope']
        parts = {'decisions': dec_titles.get((t, y), 0.0), 'booked': r['booked'] * sl, 'league_baseline': -league_avg[y] * sl,
                 'beyond_player_value': (re['strength'] - (r['produced'] - league_avg[y])) * sl, 'average_team_shortfall': re['E0'] - 1 / re['n'],
                 'derivative_gap': (re['E'] - re['E0']) - re['strength'] * sl}
        target = re['E'] - 1 / re['n']
        gap = sum(parts.values()) - target
        row = {'team': t, 'season': y, 'E': re['E'], 'above_average': round(target, 5), **{k: round(v, 5) for k, v in parts.items()},
               'gap': round(gap, 5), 'points_gap_x_slope': round(r['gap'] * sl, 5)}
        rows.append(row)
        if abs(gap) > 0.001:
            off.append(row)
    worst = max((abs(r['gap']) for r in rows), default=0.0)
    total = sum(abs(r['gap']) for r in rows)
    ok = worst <= MAX_ONE and total <= MAX_ALL
    expl = sum(abs(r['gap'] - r['points_gap_x_slope']) for r in rows)
    json.dump({'limits': [MAX_ONE, MAX_ALL], 'team_seasons': len(rows), 'off_by_0.001': off, 'rows': rows}, open(os.path.join(OUT, 'title_conservation.json'), 'w'))
    print(f'titles conservation: {len(rows)} team-seasons; {len(rows) - len(off)} add up to E - 1/N within 0.001 titles; '
          f'largest gap {worst:.4f}, all gaps {total:.4f} (the points check\'s own gaps times the slope account for all but {expl:.4f})')
    for r in sorted(off, key=lambda r: -abs(r['gap']))[:8]:
        print(f"   {r['team']} {r['season']}: above average {r['above_average']:+.3f}, gap {r['gap']:+.4f} (points gap x slope {r['points_gap_x_slope']:+.4f})")
    print(f"{'PASS' if ok else 'FAIL'}: largest {worst:.4f} (limit {MAX_ONE}), all {total:.4f} (limit {MAX_ALL})")
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
