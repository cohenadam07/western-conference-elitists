"""br_more.py — the rest of what the ledger reads from Basketball-Reference: every draft (1979 on) and the
season totals pages the Mac's cache_br lacks (who played for which team)."""
import os, sys
from fetch import get
BR = 'https://www.basketball-reference.com'
# Basketball Savant's own BR cache on the Mac; in the cloud, the copy of its totals pages in the state bundle
CACHE_BR = os.environ.get('GM_CACHE_BR') or os.path.expanduser('~/Basketball-Savant/cache_br')
NOW = 2027      # the season in progress: its totals page changes nightly, so ours (refreshed by mac_pull.sh) comes first


def draft_url(y):
    return f'{BR}/draft/NBA_{y}.html'


def totals(y):
    """The season totals page (per-team rows for traded players): the Mac's cache_br first, then ours."""
    p = os.path.join(CACHE_BR, f'NBA_{y}_totals.html')
    if y < NOW and os.path.exists(p):
        return open(p, 'rb').read()
    c, b = get(f'{BR}/leagues/NBA_{y}_totals.html', offline=y < NOW or bool(os.environ.get('GM_OFFLINE')))
    if c != 200 and os.path.exists(p):
        return open(p, 'rb').read()
    return b if c == 200 else None


if __name__ == '__main__':
    for y in range(1979, 2027):
        c, b = get(draft_url(y)); print('draft', y, c, flush=True)
    for y in range(1980, 2028):
        print('totals', y, 'ok' if totals(y) else 'missing', flush=True)
