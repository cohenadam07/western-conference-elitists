"""
gm_refit.py — Module 8: the yearly refit, after the Finals (.github/workflows/gm-savant-refit.yml).

The season just finished becomes a target. The projection model's out-of-sample test (grouped by player, proj.py
eval) is rerun with it, and the pick curve's single-pick error comes from its new fit. Both are compared with the last
version's numbers in out/models/refit_log.json. A refit more than 1% worse on either does not ship: no new version is
written and the run fails, which lights the Control Room. Otherwise the new point-in-time versions are written
(proj_<T>, picks_<T>, instream_<T>) and old ones are never rewritten, so every frozen at-the-time grade keeps the
version it names.

    python3 gm_refit.py [--season T]      # T = the season that just ended (default: this year after July 1)
"""
import datetime as dt, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, 'out', 'models')
LOG = os.path.join(MODELS, 'refit_log.json')
TOL = 0.01


def run(script, *args, env=None):
    r = subprocess.run([sys.executable, os.path.join(HERE, script), *args], cwd=HERE, env={**os.environ, **(env or {})}, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f'{script} {" ".join(args)} failed:\n{r.stderr[-1500:]}')
    return r.stdout


def proj_rmse():
    rows = [l for l in open(os.path.join(HERE, 'out', 'proj_eval.txt')) if re.match(r'\s*\d+\s+\d+\s+[\d.]+', l)]
    vals = [float(l.split()[2]) for l in rows]
    return round(sum(vals) / len(vals), 3)


def main():
    t = dt.date.today()
    T = int(sys.argv[sys.argv.index('--season') + 1]) if '--season' in sys.argv else (t.year if t.month >= 7 else t.year - 1)
    log = json.load(open(LOG)) if os.path.exists(LOG) else []
    if os.path.exists(os.path.join(MODELS, f'proj_{T}.json')):
        print(f'version {T} already exists: nothing to refit'); return
    prev = log[-1] if log else None
    if prev is None:                                  # first refit: measure the current version as the baseline
        run('proj.py', 'eval', env={'GM_LAST_COMPLETE': str(T - 1)})
        pk = json.load(open(os.path.join(MODELS, f'picks_{T - 1}.json')))
        prev = {'season': T - 1, 'proj_rmse': proj_rmse(), 'picks_rmse': pk['single_pick_rmse'], 'shipped': True, 'on': 'baseline'}
        log.append(prev)
    run('proj.py', 'eval', env={'GM_LAST_COMPLETE': str(T)})
    new_proj = proj_rmse()
    run('picks.py', 'fit', env={'GM_LAST_COMPLETE': str(T), 'GM_FIT_ONLY': str(T)})
    new_picks = json.load(open(os.path.join(MODELS, f'picks_{T}.json')))['single_pick_rmse']
    worse = [n for n, a, b in (('projection', new_proj, prev['proj_rmse']), ('pick curve', new_picks, prev['picks_rmse'])) if a > b * (1 + TOL)]
    rec = {'season': T, 'proj_rmse': new_proj, 'picks_rmse': round(new_picks, 3), 'against': prev['season'], 'shipped': not worse, 'on': t.isoformat(),
           'worse': worse}
    if worse:
        os.remove(os.path.join(MODELS, f'picks_{T}.json'))
        log.append(rec)
        json.dump(log, open(LOG, 'w'), indent=1)
        print(f"::error::the {T} refit is worse than version {prev['season']} on {', '.join(worse)} (projection RMSE {new_proj} vs {prev['proj_rmse']}, "
              f"pick curve {new_picks:.1f} vs {prev['picks_rmse']:.1f}); it does not ship")
        sys.exit(1)
    run('proj.py', 'fit', env={'GM_LAST_COMPLETE': str(T), 'GM_FIT_ONLY': str(T)})
    run('instream.py', 'fit', env={'GM_LAST_COMPLETE': str(T), 'GM_FIT_ONLY': str(T)})
    log.append(rec)
    json.dump(log, open(LOG, 'w'), indent=1)
    print(f'version {T} shipped: projection RMSE {new_proj} (was {prev["proj_rmse"]}), pick curve {new_picks:.1f} (was {prev["picks_rmse"]:.1f})')


if __name__ == '__main__':
    main()
