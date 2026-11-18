"""Python side of the parity test: compact -> parse_game -> stints for each home team and away team.
Usage: python3 tools/live-lineups/parity_dump.py <list.txt> <out.jsonl>"""
import sys, os, json, gzip
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = os.path.join(ROOT, 'public/live-lineups/reference')
lst, out = sys.argv[1], sys.argv[2]
sys.argv = [sys.argv[0], REF]
sys.path.insert(0, REF); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse, fill_sheet as FS, compact as C
with open(out, 'w') as fo:
    for path in open(lst).read().split():
        try: g = C.load(path)
        except Exception as e: fo.write(json.dumps(dict(path=path, err='load ' + type(e).__name__)) + '\n'); continue
        try: res, st = parse.parse_game(g)
        except Exception as e: res, st = None, 'exc ' + type(e).__name__
        rec = dict(path=path, gid=g['gid'], status=st)
        if res:
            rec['errs'], rec['checks'] = res['errs'], res['checks']; rec['poss'] = res['poss']
            rec['stints'] = {}
            for t in [t for t in g['box'] if t]:
                FS.OU = t
                try:
                    rows, _, _ = FS.stints_for(g)
                    rec['stints'][t] = [dict(half=r['half'], start=r['start'], end=r['end'], players=sorted(r['players']), u={k: v for k, v in r['u'].items() if v}) for r in rows]
                except AssertionError: rec['stints'][t] = 'size'
                except Exception as e: rec['stints'][t] = 'exc ' + type(e).__name__
        fo.write(json.dumps(rec) + '\n')
