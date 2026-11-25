"""
titles_study2.py — for the "without" side of a trade's titles: is a traded player's production on his new team a fair
stand-in for what he would have produced in his old role, or does it carry the new team's context?

For every player traded away (trade decisions with an at-the-time grade), the three seasons from the trade's season on
that have been played: his value that season (all teams) against his at-the-time projection for it (the snapshot the
grade used). If the gap depends on the team he played for (its rating against the old team's), his production
elsewhere carries the new role, and the at-the-time projection is the better "without". Players who stayed (re-signed
with the same team, same projection rule) are the baseline for the gap itself.

    python3 titles_study2.py    # -> out/title_study2.txt
"""
import collections, json, os
import numpy as np

import grade as GR
import titles as T

RATING = {(T.y_of(s), t): v for s in T.SEASONS for t, v in T.rating(s).items()}


def main():
    D = json.load(open(os.path.join(GR.OUT, 'gm_decisions.json')))
    rows, stay = [], []
    for d in D:
        if d['type'] == 'trade' and d['at_time'] is not None:
            assets, kind = d['out'], 'traded'
        elif d['type'] == 're-signing' and d['at_time'] is not None and d.get('asset'):
            assets, kind = [d['asset']], 'stayed'
        else:
            continue
        y0 = GR.season_of(d['agreed'])
        for a in assets:
            if not a.startswith('player:'):
                continue
            proj, _, _ = GR.pv(a, d['agreed'])
            vid = GR.vid_of(a)
            for y in range(y0, min(y0 + 3, 2027)):
                if y not in proj or (vid, y) not in GR.VAL:
                    continue
                sh = GR.SHARE.get((vid, y), {})
                if not sh:
                    continue
                dest = max(sh, key=sh.get)
                gap = GR.VAL[(vid, y)] - proj[y]
                if kind == 'stayed':
                    stay.append(gap)
                    continue
                if dest == d['team'] or (y, dest) not in RATING or (y, d['team']) not in RATING:
                    continue
                rows.append((gap, RATING[(y, dest)] - RATING[(y, d['team'])], proj[y], RATING[(y, dest)]))
    R = np.array(rows)
    gap, dr, pj, dest = R.T
    X = np.c_[np.ones_like(dr), dr, pj]
    b, res, *_ = np.linalg.lstsq(X, gap, rcond=None)
    sig2 = ((gap - X @ b) ** 2).sum() / (len(gap) - 3)
    se = np.sqrt(np.diag(sig2 * np.linalg.inv(X.T @ X)))
    rng = np.random.default_rng(4)
    out = [f'traded players, seasons after the trade: {len(R)}; gap = value that season - at-the-time projection for it',
           f'  mean gap {gap.mean():+.1f} value points (players who stayed, re-signed: {np.mean(stay):+.1f}, n {len(stay)})',
           f'  gap on (new team rating - old team rating) and the projection: per margin point {b[1]:+.2f} (se {se[1]:.2f}); '
           f'per projected point {b[2]:+.3f} (se {se[2]:.3f})']
    for lo, hi in ((-20, -3), (-3, 0), (0, 3), (3, 20)):
        sel = (dr >= lo) & (dr < hi)
        bs = [rng.choice(gap[sel], sel.sum()).mean() for _ in range(1000)]
        out.append(f'  new team {lo:+d} to {hi:+d} margin points against the old: n {sel.sum():4}, mean gap {gap[sel].mean():+.1f} '
                   f'[{np.percentile(bs, 2.5):+.1f}, {np.percentile(bs, 97.5):+.1f}]')
    open(os.path.join(GR.OUT, 'title_study2.txt'), 'w').write('\n'.join(out) + '\n')
    print('\n'.join(out))


if __name__ == '__main__':
    main()
