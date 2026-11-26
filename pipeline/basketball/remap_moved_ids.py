"""
remap_moved_ids.py — give a player one id everywhere NBA Savant stores him (moved_player_ids.json).

Fifteen careers were split at 1996-97: the seasons before it under a Basketball-Reference id ("br:ewingpa01"), the
rest under the NBA id (121), because the name alone could not be matched (two NBA ids share it, or NBA.com spells it
another way). Micheal Ray Richardson was never matched at all, nor were 58 more players who left before 1996-97
(Tiny Archibald, Fat Lever, World B. Free...): those are matched by season, team and minutes against NBA.com's career
totals, as GM Savant 1.0.2 matches players, each with its evidence in moved_player_ids.json. One player is left under
his "br:" id, Mark Jones (br:jonesma02, 16 minutes in 1983-84): NBA.com has no career totals for its only Mark Jones of
the time, so nothing could be checked. The archive is edited in place in the repo (accents,
value bars, Synergy ids, positions...), so this is an in-place pass too, like those, rather than a rebuild:

  public/savant-data.json       every row's id (and display name, where NBA.com abbreviates it); and moved_ids {old id: new id} at the top, which the page, the site's
                                API files (scripts/lib/savant-api.mjs) and the connector read to redirect an old id
  public/savant-allsavant.json  the All-Savant slots, keyed by id
  public/basketball-savant.html the awards block (AWARDS.players, keyed by id; AWARDS.unresolved)

Idempotent: a second run changes nothing. It stops before writing anything if a season would hold one id twice.
build_historical.py and gen_historical_comps.py apply the same file when the archive is rebuilt.

    python3 pipeline/basketball/remap_moved_ids.py [--check]     # --check: report, write nothing
    python3 pipeline/basketball/remap_moved_ids.py --audit       # exit 1 if any career is still split

The audit: a player whose first NBA.com season in the archive already counts years of NBA experience (exp 2 or
more) must have his earlier seasons under the same id; where they sit under another id (same last name, his age
continuing across the gap), that is a split. On Nov 26, 2026 it found exactly the fifteen fixed here, and none since.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PUB = os.path.join(ROOT, 'public')


def moved():
    """{old id: new id} from moved_player_ids.json."""
    return {k: v['to'] for k, v in json.load(open(os.path.join(HERE, 'moved_player_ids.json')))['moved'].items()}


def names():
    """{player id: display name} where NBA.com's is abbreviated (moved_player_ids.json "names")."""
    out = {}
    for k, v in json.load(open(os.path.join(HERE, 'moved_player_ids.json'))).get('names', {}).items():
        out[int(k) if k.isdigit() else k] = v['name']
    return out


def remap_archive(d, M):
    n = 0
    for season, v in d['data'].items():
        seen = set()
        for p in v.get('players', []):
            if p['id'] in M:
                p['id'] = M[p['id']]
                n += 1
            if p['id'] in seen:
                raise SystemExit(f'{season}: id {p["id"]} would appear twice; nothing written')
            seen.add(p['id'])
    d['moved_ids'] = {k: v for k, v in sorted(M.items())}
    N = names()
    for v in d['data'].values():
        for p in v.get('players', []):
            if p['id'] in N and p['name'] != N[p['id']]:
                p['name'] = N[p['id']]
                n += 1
    return n


def remap_slots(a, M):
    n = 0
    for season, slots in a['seasons'].items():
        for old, new in M.items():
            if old in slots:
                if str(new) in slots:
                    raise SystemExit(f'All-Savant {season}: both {old} and {new} hold a slot; nothing written')
                slots[str(new)] = slots.pop(old)
                n += 1
    return n


AWARDS_RE = re.compile(r'(const AWARDS = )(\{.*?\});\n')


def remap_awards(html, M):
    m = AWARDS_RE.search(html)
    if not m:
        raise SystemExit('basketball-savant.html: no AWARDS block found')
    aw = json.loads(m.group(2))
    n = 0
    for old, new in M.items():
        if old in aw.get('players', {}):
            got = aw['players'].pop(old)
            have = aw['players'].get(str(new))
            # one man's honours, now under one key (a list per award code keeps both parts' seasons)
            aw['players'][str(new)] = merge_honours(have, got) if have else got
            n += 1
    if 'unresolved' in aw:
        aw['unresolved'] = [x for x in aw['unresolved'] if x not in M]
    block = json.dumps(aw, separators=(',', ':'), ensure_ascii=False)
    return html[:m.start(2)] + block + html[m.end(2):], n


def merge_honours(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = merge_honours(out[k], v) if k in out else v
        return out
    if isinstance(a, list) and isinstance(b, list):
        return sorted(set(a) | set(b)) if all(isinstance(x, (str, int)) for x in a + b) else a + [x for x in b if x not in a]
    return a


def audit(d):
    """[(NBA id, name, the other id holding his earlier seasons)] for every career still split."""
    import datetime as dt
    import unicodedata
    def last(n):
        n = ''.join(c for c in unicodedata.normalize('NFD', (n or '').lower()) if unicodedata.category(c) != 'Mn')
        n = re.sub(r'\s+(jr|sr|ii|iii|iv|v)\.?$', '', n.replace('.', '').replace("'", '').strip())
        return n.split()[-1] if n else ''
    rows = {}
    for season, v in d['data'].items():
        y = int(season[:4]) + 1
        for p in v.get('players', []):
            rows.setdefault(p['id'], []).append((y, p))
    for r in rows.values():
        r.sort(key=lambda t: t[0])
    out = []
    for i, r in rows.items():
        y0, p0 = r[0]
        if not isinstance(i, int) or y0 < 1997 or (p0.get('exp') or 0) < 2 or not p0.get('birthdate'):
            continue
        a0 = (dt.date(1996, 2, 1) - dt.date.fromisoformat(p0['birthdate'])).days / 365.25
        for j, rj in rows.items():
            ly, lp = max((t for t in rj if t[0] <= 1996), default=(None, None), key=lambda t: t[0])
            if j == i or ly is None or ly < y0 - 3 or last(lp['name']) != last(p0['name']) or any(y >= 1997 for y, _ in rj):
                continue
            if abs(lp['age'] + (1996 - ly) - a0) <= 1.3:
                out.append((i, p0['name'], j))
    return out


def main():
    if '--audit' in sys.argv:
        d = json.load(open(os.path.join(PUB, 'savant-data.json')))
        split = audit(d)
        only = sorted({p['id'] for v in d['data'].values() for p in v.get('players', []) if isinstance(p['id'], str)})
        print(f'careers still split: {len(split)}' + ''.join(f'\n  {n} ({i}): earlier seasons under {j}' for i, n, j in split))
        print(f'players with no NBA id (one id each, not split): {len(only)}')
        sys.exit(1 if split else 0)
    check = '--check' in sys.argv
    M = moved()
    fd = os.path.join(PUB, 'savant-data.json')
    d = json.load(open(fd))
    n1 = remap_archive(d, M)
    fa = os.path.join(PUB, 'savant-allsavant.json')
    a = json.load(open(fa))
    n2 = remap_slots(a, M)
    fh = os.path.join(PUB, 'basketball-savant.html')
    html = open(fh, encoding='utf-8').read()
    html2, n3 = remap_awards(html, M)
    print(f'{len(M)} moved ids and {len(names())} display names: {n1} archive rows, {n2} All-Savant slots, {n3} awards entries')
    if check:
        return
    # the files keep their own formats: the archive compact with ASCII escapes (as the passes before this wrote
    # it), the slots compact UTF-8
    for f, text in ((fd, json.dumps(d, separators=(',', ':'))), (fa, json.dumps(a, separators=(',', ':'), ensure_ascii=False)),
                    (fh, html2)):
        tmp = f + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fh_:
            fh_.write(text)
        os.replace(tmp, f)


if __name__ == '__main__':
    main()
