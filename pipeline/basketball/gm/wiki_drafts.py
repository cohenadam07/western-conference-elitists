"""wiki_drafts.py — each draft's picks with their original owner, from Wikipedia's draft pages
("Golden State Warriors (from Minnesota)"). Used to resolve pick swaps and to name the original owner of
every pick. One request every 6 s; stops on a 429.

    python3 wiki_drafts.py      # -> out/wiki_drafts.json  {year: {'revid', 'url', 'picks': {overall: {team, from, player}}}}
"""
import json, os, re, urllib.parse
from fetch import get
from tenures import OUT, team_by_name

API = 'https://en.wikipedia.org/w/api.php'


def page(y):
    t = f'{y}_NBA_draft'
    c, b = get(f'{API}?action=parse&page={t}&prop=wikitext|revid&format=json&redirects=1', delay=6)
    if c == 429:
        raise SystemExit('Wikipedia answered 429: stopped')
    if c != 200:
        return None
    p = json.loads(b)['parse']
    return p['revid'], p['wikitext']['*'], f"https://en.wikipedia.org/w/index.php?title={t}&oldid={p['revid']}"


def picks(y, w):
    out = {}
    for row in w.split('\n|-'):
        row = '\n'.join(l for l in row.split('\n') if not l.startswith(('!', '{|', '|+')))
        cells = [c.strip() for c in re.split(r'\n\|(?!\})', row) if c.strip()]
        nums = [re.sub(r'.*\|', '', re.sub(r'[\[\]]', '', c)) for c in cells[:2]]
        if len(cells) < 5 or not all(n.strip().isdigit() for n in nums):
            continue
        rnd, ov = int(nums[0]), int(nums[1])
        teamcell = next((c for c in cells[2:] if re.search(r'\[\[[^\]]+(?:Pistons|Warriors|Celtics|Lakers|Knicks|Nets|Bulls|Heat|Magic|Hawks|Hornets|Bobcats|Wizards|Bullets|Raptors|76ers|Cavaliers|Pacers|Bucks|Timberwolves|Thunder|SuperSonics|Trail Blazers|Jazz|Nuggets|Suns|Kings|Clippers|Rockets|Spurs|Mavericks|Grizzlies|Pelicans)', c)), None)
        if not teamcell:
            continue
        team = re.search(r'\[\[([^\]|]+)', teamcell).group(1)
        frm = re.search(r'\(from \[\[([^\]|]+)', teamcell) or re.search(r"\(from ((?:L\.A\. |LA )?[A-Z][\w\.' ]+?)\s*(?:,|\)|\{|via)", teamcell)
        pl = re.search(r'sortname\|([^|}]+)\|([^|}]+)', cells[2]) or re.search(r'\[\[(?:[^\]|]+\|)?([^\]]+)\]\]', cells[2])
        name = (pl.group(1) + ' ' + pl.group(2)) if pl and pl.lastindex == 2 else (pl.group(1) if pl else None)
        fname = frm.group(1).strip() if frm else None
        if fname in ('L.A. Clippers', 'LA Clippers'):
            fname = 'Los Angeles Clippers'
        elif fname in ('L.A. Lakers', 'LA Lakers'):
            fname = 'Los Angeles Lakers'
        out[ov] = {'round': rnd, 'team': team_by_name(team, f'{y}-06-15'), 'from': team_by_name(fname, f'{y}-06-15') if fname else None,
                   'team_name': team, 'from_name': fname, 'player': name}
    return out


if __name__ == '__main__':
    res = {}
    for y in range(1980, 2027):
        p = page(y)
        if not p:
            print(y, 'missing'); continue
        revid, w, url = p
        pk = picks(y, w)
        res[y] = {'revid': revid, 'url': url, 'picks': pk}
        print(y, len(pk), 'picks,', sum(1 for v in pk.values() if v['from']), 'with an original owner other than the selecting team', flush=True)
    json.dump(res, open(os.path.join(OUT, 'wiki_drafts.json'), 'w'), indent=0)
