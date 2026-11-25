"""
state_bundle.py — what the cloud refresh carries between nights, packed and encrypted with a repo secret.

The repo is public and so are its releases, so nothing raw ever leaves the Mac: the bundle holds only the pipeline's
own parsed outputs (out/) and the parsed page facts (out/facts, pagefacts.py), never a fetched page. It is encrypted
(AES-256, PBKDF2 key from GM_STATE_KEY: on the Mac in ~/.config/wce/gm-state.key, in the cloud the repo secret of the
same name) before it is uploaded, so the release asset is ciphertext.

    python3 state_bundle.py list                    # what the full bundle holds, and its size
    python3 state_bundle.py pack  gm-state.enc      # the whole state (the Mac's first seed; the cloud after a clean run)
    python3 state_bundle.py pack  gm-mac.enc --mac  # the Mac lane's nightly: this season's facts and luck margins
    python3 state_bundle.py unpack gm-state.enc     # into out/
"""
import datetime as dt, glob, io, os, subprocess, sys, tarfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
LEAVE_OUT = {'snapshots.json',   # stored projections for reading; grading never loads them (20 MB)
             'br_tx.json'}       # paragraph table for the Module 1 front-office report, not the nightly path (10 MB)


def season():
    t = dt.date.today()
    return t.year + (1 if t.month >= 7 else 0)


def members(mac=False):
    if mac:
        y = season()
        names = [f'facts/tx_{y}.json.gz', f'facts/totals_{y}.json.gz', 'facts/drafts.json.gz', 'facts/nba_movement.json.gz',
                 'facts/team_links.json.gz', 'luck_margins.json', 'playoff_data.json']
        return [n for n in names if os.path.exists(os.path.join(OUT, n))]
    out = []
    for f in sorted(glob.glob(os.path.join(OUT, '**', '*'), recursive=True)):
        rel = os.path.relpath(f, OUT)
        if os.path.isfile(f) and os.path.basename(f) not in LEAVE_OUT and not f.endswith(('.tmp', '.log')):   # logs are runs, not state
            out.append(rel)
    return out


def tar_bytes(names):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz', compresslevel=9) as t:
        for n in names:
            t.add(os.path.join(OUT, n), arcname=n)
    return buf.getvalue()


def no_markup(names):
    """A last guard: refuse to pack anything that looks like a fetched page."""
    bad = []
    for n in names:
        p = os.path.join(OUT, n)
        if n.endswith('.html') or n.endswith('.htm'):
            bad.append(n)
            continue
        head = open(p, 'rb').read(2 ** 20)
        if n.endswith('.gz'):
            import gzip
            head = gzip.decompress(open(p, 'rb').read())[:2 ** 20]
        if b'<html' in head.lower() or b'<!doctype' in head.lower() or b'<td' in head or b'<a href=' in head:
            bad.append(n)
    return bad


def key():
    k = os.environ.get('GM_STATE_KEY')
    if not k:
        p = os.environ.get('GM_STATE_KEY_FILE') or os.path.expanduser('~/.config/wce/gm-state.key')
        k = open(p).read().strip() if os.path.exists(p) else None
    if not k:
        raise SystemExit('no GM_STATE_KEY (env) or ~/.config/wce/gm-state.key: the bundle is never written unencrypted')
    return k


def openssl(args, data):
    env = dict(os.environ, GM_STATE_KEY=key())
    r = subprocess.run(['openssl', 'enc', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-md', 'sha256', *args, '-pass', 'env:GM_STATE_KEY'],
                       input=data, capture_output=True, env=env)
    if r.returncode:
        raise SystemExit('openssl: ' + r.stderr.decode()[-300:])
    return r.stdout


def main():
    cmd = sys.argv[1]
    mac = '--mac' in sys.argv
    if cmd == 'list':
        names = members(mac)
        raw = sum(os.path.getsize(os.path.join(OUT, n)) for n in names)
        groups = {}
        for n in names:
            g = n.split('/')[0] if '/' in n else ('state' if n in ('frozen_at_time.json', 'grade_state.json', 'update_state.json', 'pending.json',
                                                                    'ledger_hold.json', 'fo_pending.json', 'confirmed_through.json', 'model_data_basis.json')
                                                 else 'outputs and inputs (parsed)')
            groups.setdefault(g, []).append(n)
        for g, ns in groups.items():
            print(f'{g}: {len(ns)} files, {sum(os.path.getsize(os.path.join(OUT, n)) for n in ns) / 2**20:.1f} MB')
        print(f'total {len(names)} files, {raw / 2**20:.1f} MB on disk, {len(tar_bytes(names)) / 2**20:.1f} MB packed; '
              f'left out: {", ".join(sorted(LEAVE_OUT))}; anything that looks like a page: {no_markup(names) or "none"}')
    elif cmd == 'pack':
        names = members(mac)
        bad = no_markup(names)
        if bad:
            raise SystemExit(f'refusing to pack page markup: {bad}')
        enc = openssl(['-salt'], tar_bytes(names))
        open(sys.argv[2], 'wb').write(enc)
        print(f'{sys.argv[2]}: {len(names)} files, {len(enc) / 2**20:.1f} MB, encrypted')
    elif cmd == 'unpack':
        data = openssl(['-d'], open(sys.argv[2], 'rb').read())
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as t:
            for m in t.getmembers():
                if m.name.startswith('/') or '..' in m.name.split('/') or not (m.isfile() or m.isdir()):
                    raise SystemExit(f'unsafe member {m.name}')
            t.extractall(OUT, filter='data')
        print(f'unpacked into {OUT}')


if __name__ == '__main__':
    main()
