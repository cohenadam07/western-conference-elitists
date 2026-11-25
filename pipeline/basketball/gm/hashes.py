"""
hashes.py — a checksum of every output the chain and the page build write, ignored files included, so two builds can
be compared exactly (the memory rework against the build before it; an incremental night against a full rebuild).
Run-stamps are left out: the logs, chain_status/peaks, and the page index's "generated" time.

    python3 hashes.py > a.txt; ...; python3 hashes.py > b.txt; diff a.txt b.txt
    python3 hashes.py --root <sandbox>/pipeline/basketball/gm
"""
import glob, gzip, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = {'chain_status.txt', 'chain_peaks.txt', 'update_peaks.txt', 'chain_hashes.txt', 'control_detail.txt', 'replay_report.txt',
        'frozen_at_time.json', 'pending.json', 'confirmed_through.json', 'review_report.txt',
        'update_state.json', 'grade_state.json', 'model_data_basis.json', 'fo_pending.json'}   # state, not output


def digest(path):
    b = open(path, 'rb').read()
    if path.endswith('index.json.gz'):
        d = json.loads(gzip.decompress(b))
        d.get('meta', {}).pop('generated', None)
        b = json.dumps(d, sort_keys=True).encode()
    elif path.endswith('.gz'):
        b = gzip.decompress(b)
    return hashlib.sha1(b).hexdigest()[:16]


def main(root):
    repo = os.path.abspath(os.path.join(root, '..', '..', '..'))
    files = [f for f in glob.glob(os.path.join(root, 'out', '**', '*'), recursive=True)
             if os.path.isfile(f) and os.path.basename(f) not in SKIP and '/models/' not in f and not f.endswith('.tmp')]
    files += glob.glob(os.path.join(repo, 'public', 'gms', '**', '*.gz'), recursive=True)
    for f in sorted(files, key=lambda f: os.path.relpath(f, repo)):
        print(digest(f), os.path.relpath(f, repo))


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--root') + 1] if '--root' in sys.argv else HERE)
