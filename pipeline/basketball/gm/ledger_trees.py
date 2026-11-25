"""ledger_trees.py — print an asset tree: what an asset was traded for, what that became, and so on.

    python3 ledger_trees.py <asset id> [depth]
"""
import collections, json, os, sys
from tenures import OUT

A = json.load(open(os.path.join(OUT, 'ledger_assets.json')))
E = json.load(open(os.path.join(OUT, 'ledger_events.json')))
X = json.load(open(os.path.join(OUT, 'ledger_edges.json')))
fwd = collections.defaultdict(list)
for a, b, tx, how in X:
    fwd[a].append((b, tx, how))
ev_of = collections.defaultdict(list)
for e in E:
    ev_of[(e['asset'], e['tx'])].append(e)


def label(aid):
    a = A.get(aid, {})
    if a.get('kind') == 'player':
        return a.get('name') or aid
    if a.get('kind') == 'pick':
        s = f"{a['year'] or 'year unknown'} round-{a['round']} pick"
        if a.get('original_owner'):
            s += f" ({a['original_owner']} own)"
        if a.get('became_name'):
            s += f" -> {a['became_name']} (#{a.get('overall')}, {a.get('selected_by')})"
        elif (a['year'] or 0) > 2026:
            s += ' (not yet conveyed)'
        if a.get('notes'):
            s += ' [' + '; '.join(a['notes'])[:80] + ']'
        return s
    if a.get('kind') == 'swap':
        return f"right to swap {a.get('year')} round-{a.get('round')} picks ({' / '.join(a.get('teams') or [])}): {a.get('resolved') or 'pending'}"
    return f"{a.get('kind')} {a.get('amount') or a.get('what') or ''}".strip()


TXDATE = {}
for e in E:
    if e.get('tx'):
        TXDATE.setdefault(e['tx'], e['date'])


def txdate(tx):
    return TXDATE.get(tx) or tx.split(':')[1]


def giver(aid, tx):
    e = (ev_of.get((aid, tx)) or [{}])[0]
    return e.get('from'), e.get('to')


def tree(node, since, holder, depth=3, pre='', seen=None, came_in=None):
    """What `holder` did with `node` after receiving it on `since`: each later trade (or the draft) it was
    part of, the assets the holder got back, and in turn what became of those."""
    seen = seen if seen is not None else set()
    out = []
    by_tx = collections.defaultdict(list)
    for b, tx, how in fwd.get(node, []):
        if txdate(tx) < since or (node, tx) in seen or tx == came_in:
            continue
        frm, to = giver(node, tx)
        if frm != holder:
            continue                       # only what this team did with it (a pick it traded away became someone else's player)
        by_tx[(tx, how)].append(b)
    for (tx, how), kids in sorted(by_tx.items(), key=lambda x: txdate(x[0][0])):
        seen.add((node, tx))
        frm, to = giver(node, tx)
        sent_with = sorted({label(a) for a, b2, t2, h2 in X if t2 == tx and h2 != 'became' and a != node and giver(a, tx)[0] == holder})
        out.append(f"{pre}{'became' if how == 'became' else 'traded by ' + str(holder) + ' to ' + str(to)} on {txdate(tx)}"
                   + (f" (sent with: {'; '.join(sent_with)})" if sent_with and how != 'became' else '') + (', for:' if how != 'became' else ':'))
        for b in sorted(set(kids)):
            out.append(f"{pre}   {label(b)}")
            if depth > 1:
                out += tree(b, txdate(tx), holder, depth - 1, pre + '      ', seen, came_in=tx)
    return out


if __name__ == '__main__':
    root = sys.argv[1]
    d = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    team = sys.argv[3] if len(sys.argv) > 3 else None
    first = sorted([e for e in E if e['asset'] == root and (team is None or e['to'] == team)], key=lambda e: e['date'])[0]
    print(label(root), '| held by', first['to'], 'from', first['date'])
    print('\n'.join(tree(root, first['date'], first['to'], d)))
