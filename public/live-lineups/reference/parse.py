"""Parse ESPN CBB play-by-play into possessions with both lineups.
Usage: python3 -I parse.py <games_dir> <out.pkl>
"""
import json, gzip, glob, sys, os, collections
import pandas as pd

def clock_s(c):
    if ':' in c:
        m, s = c.split(':'); return int(m) * 60 + float(s)
    return float(c)

def elapsed(period, c):
    t = clock_s(c)
    if period <= 2: return (period - 1) * 1200 + (1200 - t)
    return 2400 + (period - 3) * 300 + (300 - t)

def remaining_reg(period, c):
    t = clock_s(c)
    return (1200 - 1200 + t) if period == 2 else (1200 + t if period == 1 else 0)

RIM_TYPES = {'LayUpShot', 'DunkShot', 'TipShot'}

def parse_game(g):
    plays = g['plays']; box = g['box']
    teams = [t for t in box if t]
    if len(teams) != 2: return None, 'teams'
    lineup = {}
    for t in teams:
        st = [a[0] for a in box[t] if a[2]]
        if len(st) != 5: return None, 'starters'
        lineup[t] = set(st)
    opp = {teams[0]: teams[1], teams[1]: teams[0]}
    home = g['home']
    roster = {t: {a[0] for a in box[t]} for t in teams}
    errs = 0; checks = 0
    poss = []
    cur = None   # current possession accumulator

    def new_poss(off, i):
        p = plays[i]
        hs, as_ = p[11] or 0, p[12] or 0
        m = (hs - as_) if off == home else (as_ - hs)
        return dict(off=off, de=opp[off], period=p[0], clock=p[1], t0=elapsed(p[0], p[1]),
                    margin=m, pts=0, opp_pts=0, fga=0, fg3a=0, fg3m=0, fg2a=0, rim_fga=0, rim_fgm=0, fgm=0,
                    fta=0, ftm=0, oreb=0, tov=0, off5=None, def5=None, n_ev=0, sh3=[])

    def close(endtype):
        nonlocal cur
        if cur is not None and cur['n_ev'] > 0:
            cur['end'] = endtype
            poss.append(cur)
        cur = None

    def snap(c):
        if c['off5'] is None:
            c['off5'] = '|'.join(sorted(lineup[c['off']])); c['def5'] = '|'.join(sorted(lineup[c['de']]))

    n = len(plays); i = 0; consumed = set()
    pending_sub = collections.defaultdict(lambda: [[], []])
    while i < n:
        p = plays[i]
        per, clk, tid, typ, txt, sv, scoring, shooting, parts = p[:9]
        if typ == 'Substitution':
            if i in consumed: i += 1; continue
            # apply subs at this clock in order, looking past dead-ball events (FTs, fouls, timeouts) at the same clock;
            # check lineup size only after the whole group (in/out/in patterns around free throws)
            j = i; touched = set()
            while j < n and plays[j][1] == clk and plays[j][0] == per:
                q = plays[j]
                if q[3] == 'Substitution':
                    pid = q[8][0] if q[8] else None
                    t = q[2]
                    if pid and t in lineup:
                        touched.add(t)
                        if 'subbing out' in q[4]:
                            if pid in lineup[t]: lineup[t].discard(pid)
                            else: errs += 1
                        else:
                            if pid in lineup[t]: errs += 1
                            lineup[t].add(pid)
                    if j != i: consumed.add(j)
                elif not ('FreeThrow' in q[3] or q[3] in ('PersonalFoul', 'Technical Foul', 'Dead Ball Rebound') or 'TimeOut' in q[3]):
                    break
                j += 1
            j = i + 1
            for t in touched:
                if len(lineup[t]) != 5: return None, 'size'
            i = j; continue
        if typ in ('End Period', 'End Game'):
            close('period'); i += 1; continue
        if tid not in lineup:
            i += 1; continue
        # lineup sanity: player credited with an action must be on the floor
        if parts and typ not in ('PersonalFoul', 'Technical Foul') and parts[0] in roster.get(tid, ()):
            checks += 1
            if parts[0] not in lineup[tid]: errs += 1
        is_ft = 'FreeThrow' in typ
        is_fga = shooting and not is_ft
        is_tov = 'Turnover' in typ
        if typ == 'Offensive Rebound':
            if cur is None: cur = new_poss(tid, i)
            if cur['off'] == tid:
                cur['oreb'] += 1; cur['n_ev'] += 1
            i += 1; continue
        if typ == 'Defensive Rebound':
            # ends opponent's possession
            if cur is not None and cur['off'] == opp[tid]:
                close('dreb')
            elif cur is not None and cur['off'] == tid:
                pass  # mislabeled; ignore
            i += 1; continue
        if is_fga or is_ft or is_tov:
            if cur is None or cur['off'] != tid:
                close('flip')
                cur = new_poss(tid, i)
            snap(cur)
            cur['n_ev'] += 1
            if is_tov:
                cur['tov'] += 1; close('tov'); i += 1; continue
            if is_fga:
                three = (sv == 3)
                cur['fga'] += 1
                if three:
                    cur['fg3a'] += 1; cur['sh3'].append(parts[0] if parts else None)
                else:
                    cur['fg2a'] += 1
                    if typ in RIM_TYPES: cur['rim_fga'] += 1
                if scoring:
                    cur['fgm'] += 1; cur['pts'] += sv
                    if three: cur['fg3m'] += 1
                    elif typ in RIM_TYPES: cur['rim_fgm'] += 1
                    # and-one: FTs by same team at same clock follow (allow fouls/subs/timeouts between)
                    k = i + 1; andone = False
                    while k < n and plays[k][1] == clk and plays[k][0] == per:
                        if 'FreeThrow' in plays[k][3] and plays[k][2] == tid: andone = True; break
                        if plays[k][3] in ('PersonalFoul', 'Substitution', 'Technical Foul') or 'TimeOut' in plays[k][3]: k += 1; continue
                        break
                    if not andone: close('fgm')
                i += 1; continue
            if is_ft:
                cur['fta'] += 1
                if scoring: cur['ftm'] += 1; cur['pts'] += 1
                # is this the last FT of the trip? look ahead for another FT by same team (skipping subs/fouls/timeouts/deadball rebs)
                k = i + 1; more = False
                while k < n:
                    q = plays[k]
                    if 'FreeThrow' in q[3] and q[2] == tid: more = True; break
                    if q[3] in ('Substitution', 'PersonalFoul', 'Technical Foul', 'Dead Ball Rebound') or 'TimeOut' in q[3]: k += 1; continue
                    break
                if not more and scoring: close('ftm')
                i += 1; continue
        i += 1
    close('end')
    return dict(poss=poss, errs=errs, checks=checks), 'ok'

def main(src, out):
    rows = []; status = collections.Counter(); qual = []
    for f in sorted(glob.glob(src + '/*.json.gz')):
        try: g = json.load(gzip.open(f))
        except Exception: status['badjson'] += 1; continue
        try: res, st = parse_game(g)
        except Exception as e: status['exc:' + type(e).__name__] += 1; continue
        status[st] += 1
        if res is None: continue
        P = res['poss']
        # validation: points by team vs final score
        pts = collections.Counter()
        for p in P: pts[p['off']] += p['pts']
        final = {k: int(v) for k, v in g['score'].items() if v is not None and k}
        score_ok = all(abs(pts[t] - final.get(t, -999)) == 0 for t in final)
        offc = collections.Counter(p['off'] for p in P)
        qual.append(dict(gid=g['gid'], date=g['date'], errs=res['errs'], checks=res['checks'],
                         score_ok=score_ok, score_diff=sum(abs(pts[t] - final.get(t, 0)) for t in final),
                         poss_a=offc.get(list(final)[0], 0) if final else 0, poss_b=offc.get(list(final)[1], 0) if len(final) > 1 else 0, n=len(P)))
        for p in P:
            p['gid'] = g['gid']; p['date'] = g['date']; rows.append(p)
    df = pd.DataFrame(rows); q = pd.DataFrame(qual)
    df.to_pickle(out); q.to_pickle(out.replace('.pkl', '_quality.pkl'))
    print(dict(status)); print(q.describe().T)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
