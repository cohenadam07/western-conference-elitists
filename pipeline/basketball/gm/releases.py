"""releases.py — read team releases: publication date and the sentences carrying titles or reporting lines."""
import json, re, html as H, sys
from fetch import get
KEY = r'(final say|non-?basketball|vice chairman|co-interim|co-general|senior advis|President|General Manager|Executive Vice|report(?:s|ing)? to|oversee|responsible for|decision|Senior Advisor|Chief Executive|CEO|Alternate Governor|interim)'


def read(u):
    c, b = get(u, delay=3)
    if c != 200:
        return {'url': u, 'code': c}
    t = b.decode('utf8', 'replace')
    d = (re.findall(r'"datePublished"\s*:\s*"([^"]+)"', t) or re.findall(r'article:published_time" content="([^"]+)"', t) or re.findall(r'"date(?:Created|Modified)"\s*:\s*"([^"]+)"', t) or [None])[0]
    body = ' '.join(H.unescape(re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>', ' ', t, flags=re.S)).split())
    sents = [s for s in re.split(r'(?<=[.!?”"])\s+(?=[A-Z“"])', body) if re.search(KEY, s) and 30 < len(s) < 400]
    return {'url': u, 'code': c, 'published': d, 'says': sents[:5]}


if __name__ == '__main__':
    out = [read(u.strip()) for u in open(sys.argv[1]) if u.strip()]
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
    for r in out:
        print(r['code'], r.get('published'), r['url'].split('nba.com')[-1][:80])
        for s in r.get('says', [])[:3]:
            print('     ', s[:230])
