"""v3 'bench board' mockups for the OU live lineup page, built from real snapshot data.
Usage: python3 code/mock3.py   (reads mock/live.json, mock/half.json; writes mock/v3_*.html)"""
import json, collections, html

OPP_FULL = 'Mississippi Valley State'
OPP = 'MVSU'
E = html.escape


def last(n):
    parts = n.split()
    return parts[-2] if parts[-1] in ('Jr.', 'Sr.', 'II', 'III') else parts[-1]


def mmss(m):
    s = round(m * 60)
    return f'{s // 60}:{s % 60:02d}'


def sgn(x, d=0):
    v = round(x, d) if d else round(x)
    if v == 0: return '0'
    return f'+{v:g}' if v > 0 else f'−{abs(v):g}'


def pct(x): return f'{round(x)}%'


def made(s):
    a, b = map(int, s.split('-'))
    return a, b


# ---------- takeaways (rules that the live page will run) ----------
def takeaways(d, mode):
    T, P = d['team_tonight'], d['team_prior']
    out = []
    tf_opp = d['team_fouls'].get('OPP', 0)
    second = d['period'] >= 2
    clock_min = int(d['clock'].split(':')[0])
    if mode in ('live', 'all'):
        # 1. opponent foul trouble on the floor
        opp_rank = {r['name']: i for i, r in enumerate(sorted(d['opp_players'], key=lambda r: -r['min']))}
        for r in d['opp_now']:
            f = r['fouls']
            trouble = f >= 4 or (not second and f >= 3) or (not second and f >= 2 and clock_min >= 10)
            if trouble:
                rank = opp_rank[r['name']]
                role = ['their most-used player', 'their second most-used player', 'their third most-used player'][rank] if rank < 3 else 'in the game'
                why = f'He is {role} tonight ({round(r["min"])} min).'
                if tf_opp == 6: why += f' {OPP} also has 6 team fouls, so their next foul puts you in the bonus.'
                elif tf_opp >= 7: why += f' {OPP} has {tf_opp} team fouls, so every foul sends you to the line.'
                out.append(dict(p=1, kind='Attack', head=f'Go at {r["name"]}. He has {f} fouls.', why=why))
        if not out and tf_opp >= 6:
            out.append(dict(p=2, kind='Attack', head=f'{OPP} has {tf_opp} team fouls.',
                            why='Their next foul puts you in the bonus.' if tf_opp == 6 else 'Every foul now sends you to the line.'))
    # 2. shooting luck
    lo, lw = T['pm_opp3_luck'], T['pm_own3_luck']
    adj = T['pm'] - lo - lw
    om, oa = made(T['opp3']); wm, wa = made(T['own3'])
    if abs(lo) >= 4 or abs(lw) >= 4:
        lead = T['pm']
        if abs(adj - lead) <= 2.5:
            head = f'The {lead}-point lead is earned. Shooting luck has about cancelled out.' if lead > 0 else f'Shooting luck has about cancelled out.'
            kind = 'Big picture'
        elif adj < lead:
            head = f'Most of the {lead}-point lead is real: about {round(adj)} without shooting luck.' if adj > 0 else 'Shooting luck is carrying this lead.'
            kind = "Don't overreact"
        else:
            head = f'You are playing better than the score. Without shooting luck you would be up about {round(adj)}.'
            kind = "Don't overreact"
        def part(m, a, luck, who):
            eff = 'helped you by' if luck > 0 else 'cost you'
            return f'{who} {m} for {a} from three, which has {eff} about {abs(round(luck * 2) / 2):g} points'
        why = part(om, oa, lo, f'{OPP} is') + '. ' + part(wm, wa, lw, 'You are') + '. Neither tends to last.'
        out.append(dict(p=3, kind=kind, head=head, why=why))
    # 3. shot mix vs before tonight
    if T['tpa'] - P['tpa'] >= 8:
        out.append(dict(p=4, kind='Worth knowing', head='You are taking far more threes than usual.',
                        why=f'{pct(T["tpa"])} of your shots tonight are threes, up from {pct(P["tpa"])} before tonight. Shots at the rim are {pct(T["rim"])}, down from {pct(P["rim"])}.'))
    elif P['tpa'] - T['tpa'] >= 8:
        out.append(dict(p=4, kind='Worth knowing', head='You are taking fewer threes than usual.',
                        why=f'{pct(T["tpa"])} of your shots are threes, down from {pct(P["tpa"])} before tonight.'))
    # 4. forced turnovers
    if T['tov_forced'] >= 24:
        out.append(dict(p=5, kind='Keep doing', head='Your defense is forcing a lot of turnovers.',
                        why=f'{round(T["tov_forced"])} per 100 possessions tonight. The D1 average is 17.'))
    # 5. the current matchup on paper
    if mode in ('live', 'all'):
        e = d['exp_now']; u = d['exp_unrated']
        size = 'about even' if abs(e) < 2 else (f'by about {round(abs(e))} per 100 possessions')
        head = (f'On paper, this five beats theirs {size}.' if e >= 2 else
                f'On paper, this five loses to theirs {size}.' if e <= -2 else
                f'On paper, this matchup is about even.')
        why = f'Rough read: {u} of the 10 have little college data yet.' if u >= 4 else 'Based on every player’s results over the last season.'
        out.append(dict(p=6 if e > -5 or u >= 4 else 2, kind='On paper', head=head, why=why))
    out.sort(key=lambda x: x['p'])
    if mode == 'all': return out
    return [t for t in out if t['kind'] != 'On paper'][:3 if mode == 'live' else 4]


def takeaways_all(d): return takeaways(d, 'all')


# ---------- pieces ----------
def pips(f, warn):
    cls = 'pips warn' if warn else 'pips'
    return f'<span class="{cls}" role="img" aria-label="{f} fouls">' + ''.join(
        f'<i class="{"on" if i < f else ""}"></i>' for i in range(5)) + '</span>'


def floor_rows(rows, opp, second):
    h = []
    for r in rows:
        warn = r['fouls'] >= 4 or (not second and r['fouls'] >= 3)
        hl = ' hot' if (opp and warn) else (' warn' if warn else '')
        h.append(f'<li class="pl{hl}"><span class="nm">{E(r["name"])}</span><span class="mn">{round(r["min"])} min</span>{pips(r["fouls"], warn)}</li>')
    return '\n'.join(h)


def strip(d, compact=False):
    """Game flow: margin chart + who's-been-out-there rows. x = elapsed seconds over 2,400."""
    G = 2400; cut = d['cut']
    x = lambda t: 100 * t / G
    tl = d['timeline']
    ms = [m for _, m in tl]
    top = max(8, max(ms) + 4); bot = min(-8, min(ms) - 4)
    y = lambda m: 100 * (top - m) / (top - bot)
    pth = f'M0,{y(0):.2f}'
    for i, (t, m) in enumerate(tl):
        pth += f' H{x(t):.2f} V{y(m):.2f}'
    line = pth
    area = pth + f' H{x(cut):.2f} V{y(0):.2f} Z'
    y0 = y(0)
    svg = f'''<svg class="flow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <defs><clipPath id="up"><rect x="0" y="0" width="100" height="{y0:.2f}"/></clipPath><clipPath id="dn"><rect x="0" y="{y0:.2f}" width="100" height="{100 - y0:.2f}"/></clipPath></defs>
  <rect x="{x(cut):.2f}" y="0" width="{100 - x(cut):.2f}" height="100" class="future"/>
  <line x1="0" x2="100" y1="{y0:.2f}" y2="{y0:.2f}" class="zero"/>
  <line x1="50" x2="50" y1="0" y2="100" class="half"/>
  <path d="{area}" class="a-up" clip-path="url(#up)"/><path d="{area}" class="a-dn" clip-path="url(#dn)"/>
  <path d="{line}" class="ln"/>
</svg>'''
    lead = d['score']['OU'] - d['score']['OPP']
    ticks = ''.join(f'<span class="yt" style="top:{y(v):.2f}%">{sgn(v)}</span>' for v in (10, 20, 30) if bot < v < top)
    br = d.get('best_run'); runtag = ''
    if br and br.get('margin', 0) >= 10:
        who = 'Oklahoma' if br['team'] == 'OU' else OPP
        runtag = f'<span class="run" style="left:{x(br["t0"]):.2f}%;width:{x(br["t1"]) - x(br["t0"]):.2f}%"><b>{who} {br["us"]}\u2013{br["them"]} run</b></span>'
    flow = f'''<div class="row flowrow"><div class="lab"><span class="lab-h">Oklahoma lead</span></div>
<div class="track flowtrack">{svg}{ticks}<span class="now" style="left:{x(cut):.2f}%"></span><span class="nowtag" style="left:{x(cut):.2f}%;top:{y(lead):.2f}%">{sgn(lead)}</span>{runtag}</div><div class="tot"></div></div>'''
    # group stints by five
    agg = collections.OrderedDict()
    for s in d['stints']:
        k = tuple(s['players'])
        a = agg.setdefault(k, dict(min=0, pm=0, st=[]))
        a['min'] += (s['t1'] - s['t0']) / 60; a['pm'] += s['pm']; a['st'].append(s)
    now = tuple(d['ou_now']) if d['period'] and d.get('mode') == 'live' else None
    order = sorted(agg, key=lambda k: -agg[k]['min'])
    keep = order[:3]
    if now and now not in keep: keep.append(now)
    rest = [k for k in order if k not in keep]
    rows = []
    def blocks(sts, nowk=False):
        b = ''
        for s in sts:
            c = 'p' if s['pm'] > 0 else 'n' if s['pm'] < 0 else 'z'
            cur = ' cur' if (nowk and s is d['stints'][-1]) else ''
            b += f'<span class="blk {c}{cur}" style="left:{x(s["t0"]):.2f}%;width:{max(.35, x(s["t1"]) - x(s["t0"])):.2f}%" title="{sgn(s["pm"])}"></span>'
        return b
    for k in keep:
        a = agg[k]; isnow = (k == now)
        tag = '<span class="ontag">Now</span>' if isnow else ''
        rows.append(f'''<div class="row{' isnow' if isnow else ''}"><div class="lab"><span class="five">{E(', '.join(last(n) for n in k))}</span>{tag}</div>
<div class="track">{blocks(a['st'], isnow)}<span class="now" style="left:{x(cut):.2f}%"></span></div><div class="tot"><span class="tm">{mmss(a['min'])}</span><span class="pm {('p' if a['pm'] > 0 else 'n' if a['pm'] < 0 else 'z')}">{sgn(a['pm'])}</span></div></div>''')
    if rest:
        rm = sum(agg[k]['min'] for k in rest); rp = sum(agg[k]['pm'] for k in rest)
        rows.append(f'''<div class="row other"><div class="lab"><span class="five">{len(rest)} other groups</span></div>
<div class="track">{blocks([s for k in rest for s in agg[k]['st']])}<span class="now" style="left:{x(cut):.2f}%"></span></div><div class="tot"><span class="tm">{mmss(rm)}</span><span class="pm {('p' if rp > 0 else 'n' if rp < 0 else 'z')}">{sgn(rp)}</span></div></div>''')
    axis = '''<div class="row axis"><div class="lab"></div><div class="track axtrack"><span style="left:0">Tip-off</span><span style="left:50%">Half</span><span style="left:100%">End</span></div><div class="tot"><span class="tm">Min</span><span class="pm z">+/−</span></div></div>'''
    return flow + '\n'.join(rows) + axis


def band(d, mode, logo_mark):
    ou, op = d['score']['OU'], d['score']['OPP']
    tf = d['team_fouls']
    if mode == 'half':
        status = '<span class="per">End of first half</span><span class="clk">Halftime</span>'
        foulrow = '<div class="fouls"><span>Team fouls reset for the second half</span><span class="live"><span class="dot still"></span>Final first-half data</span></div>'
    else:
        status = f'<span class="per">2nd half</span><span class="clk">{d["clock"]}</span>'
        o, p = tf.get('OU', 0), tf.get('OPP', 0)
        chip = lambda n, mine: ('<span class="chip">In the bonus</span>' if n >= 7 and n < 10 else '<span class="chip">Double bonus</span>' if n >= 10 else
                                ('<span class="chip soft">Bonus on next foul</span>' if n == 6 and not mine else ''))
        foulrow = f'''<div class="fouls"><span>Oklahoma team fouls <b>{o}</b>{chip(o, True)}</span><span>{OPP} team fouls <b>{p}</b>{chip(p, False)}</span><span class="live"><span class="dot"></span>Live, updated 6 sec ago</span></div>'''
    return f'''<header class="band">
  <div class="sb">
    <div class="team us"><img class="mark" src="ou_mark.png" alt="Oklahoma"><span class="tn">Oklahoma</span><span class="sc">{ou}</span></div>
    <div class="status">{status}</div>
    <div class="team them"><span class="sc">{op}</span><span class="tn"><span class="full">{OPP_FULL}</span><span class="short">{OPP}</span></span></div>
  </div>
  {foulrow}
</header>'''


def tk_html(items):
    lead, rest = items[0], items[1:]
    h = f'''<div class="lead"><p class="kind">{E(lead["kind"])}</p><h1>{E(lead["head"])}</h1><p class="why">{E(lead["why"])}</p></div><ul class="notes">'''
    for t in rest:
        h += f'<li><p class="kind">{E(t["kind"])}</p><div><p class="nh">{E(t["head"])}</p><p class="why">{E(t["why"])}</p></div></li>'
    return h + '</ul>'


CSS = r'''
@import url('https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700&family=Libre+Franklin:wght@400;500;600;700&display=swap');
:root{--crimson:#841617;--crimson-2:#6c1213;--cream:#FDF9D8;--paper:#F7F5F3;--ink:#241C1D;--muted:#6E6466;--rule:#E3DDDA;--minus:#A99FA1;--even:#D9D3D0;--tint:rgba(132,22,23,.08)}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--paper);color:var(--ink);font:400 16px/1.45 "Libre Franklin",system-ui,sans-serif;font-variant-numeric:tabular-nums;min-height:100vh;display:flex;flex-direction:column}
.slab{font-family:"Zilla Slab",Georgia,serif}
/* scoreboard band */
.band{background:var(--crimson);color:var(--cream)}
.sb{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:10px 32px 8px;gap:24px}
.team{display:flex;align-items:center;gap:14px;min-width:0}
.team.them{justify-content:flex-end}
.mark{height:46px;width:auto;display:block}
.tn{font:600 20px/1.1 "Zilla Slab",Georgia,serif;letter-spacing:.2px;opacity:.92;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc{font:700 50px/1 "Zilla Slab",Georgia,serif;letter-spacing:-.5px}
.us .sc{margin-left:auto}
.them .sc{margin-right:auto;opacity:.8}
.status{display:flex;flex-direction:column;align-items:center;line-height:1.1}
.per{font-size:14px;font-weight:500;opacity:.8}
.clk{font:600 30px/1.05 "Zilla Slab",Georgia,serif}
.half-clk .clk{font-size:22px}
.fouls{display:flex;gap:28px;align-items:center;padding:8px 32px;background:var(--crimson-2);font-size:14px;color:rgba(253,249,216,.86)}
.fouls b{color:var(--cream);font-weight:700;margin-left:4px}
.chip{display:inline-block;margin-left:8px;padding:1px 9px;border-radius:999px;background:var(--cream);color:var(--crimson);font-weight:600;font-size:12.5px}
.chip.soft{background:transparent;color:var(--cream);box-shadow:inset 0 0 0 1px rgba(253,249,216,.7)}
.live{margin-left:auto;display:flex;align-items:center;gap:8px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--cream);animation:beat 2.4s ease-out infinite}
.dot.still{animation:none;opacity:.6}
@keyframes beat{0%{box-shadow:0 0 0 0 rgba(253,249,216,.7)}70%,100%{box-shadow:0 0 0 7px rgba(253,249,216,0)}}
@media (prefers-reduced-motion:reduce){.dot{animation:none}}
/* main */
main{flex:1;display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:0;padding:0 32px}
.say{padding:22px 36px 16px 0;border-right:1px solid var(--rule)}
.kind{font-size:13.5px;font-weight:600;color:var(--crimson)}
.lead{padding-left:18px;border-left:5px solid var(--crimson);margin-bottom:14px}
.lead h1{font:700 31px/1.14 "Zilla Slab",Georgia,serif;letter-spacing:-.2px;margin:2px 0 8px;text-wrap:balance}
.lead .why{font-size:16px;color:var(--muted);max-width:58ch}
.notes{list-style:none}
.notes li{display:grid;grid-template-columns:120px 1fr;gap:16px;padding:11px 0 11px 23px;border-top:1px solid var(--rule)}
.notes .kind{padding-top:2px;font-size:13px}
.nh{font-weight:600;font-size:16.5px;line-height:1.3;text-wrap:pretty}
.notes .why{font-size:14.5px;color:var(--muted);margin-top:2px;max-width:62ch}
.floor{padding:18px 0 16px 32px}
h2{font:600 21px/1.2 "Zilla Slab",Georgia,serif}
.grp+.grp{margin-top:14px}
.grp-h{display:flex;justify-content:space-between;align-items:baseline;font-size:13.5px;color:var(--muted);padding-bottom:5px;border-bottom:1px solid var(--rule)}
.grp-h b{color:var(--ink);font-weight:600;font-size:14.5px}
.grp ul{list-style:none}
.short{display:none}
h2+.grp{margin-top:8px}
.pl{display:grid;grid-template-columns:1fr 54px 62px;align-items:center;gap:10px;padding:3px 8px;margin:1px -8px;font-size:15px;border-radius:6px}
.pl .mn{color:var(--muted);font-size:13.5px;text-align:right}
.pl.hot{background:var(--crimson);color:var(--cream)}
.pl.hot .mn{color:rgba(253,249,216,.8)}
.pl.warn .nm{font-weight:600}
.pips{display:flex;gap:3px;justify-content:flex-end}
.pips i{width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.25px var(--minus)}
.pips i.on{background:var(--ink);box-shadow:none}
.pips.warn i.on{background:var(--crimson)}
.pl.hot .pips i{box-shadow:inset 0 0 0 1.25px rgba(253,249,216,.55)}
.pl.hot .pips i.on{background:var(--cream)}
.paper{margin-top:12px;padding-top:10px;border-top:1px solid var(--rule);font-size:13.5px;line-height:1.4;color:var(--muted)}
.paper b{color:var(--ink);font-weight:600}
/* strip */
.strip{padding:14px 32px 4px;border-top:1px solid var(--rule);background:#fff}
.strip-h{display:flex;justify-content:space-between;align-items:baseline;gap:24px;margin-bottom:8px}
.strip-h p{font-size:14px;color:var(--muted);max-width:60ch;text-align:right}
.row{display:grid;grid-template-columns:300px minmax(0,1fr) 92px;align-items:center;gap:16px;min-height:26px}
.lab{display:flex;align-items:center;gap:8px;min-width:0}
.five{font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lab-h{font-size:13.5px;color:var(--muted)}
.ontag{flex:none;font-size:11.5px;font-weight:600;color:var(--cream);background:var(--crimson);border-radius:999px;padding:1px 8px}
.isnow .five{font-weight:600}
.other .five{color:var(--muted)}
.track{position:relative;height:16px;background:repeating-linear-gradient(90deg,transparent 0 calc(12.5% - 1px),var(--rule) calc(12.5% - 1px) 12.5%);border-radius:3px}
.row:not(.flowrow):not(.axis) .track{background-color:#F3F0EE}
.blk{position:absolute;top:0;bottom:0;border-radius:2px}
.blk.p{background:var(--crimson)}
.blk.n{background:var(--minus)}
.blk.z{background:var(--even)}
.blk.cur{outline:2px solid var(--ink);outline-offset:1px}
.now{position:absolute;top:-3px;bottom:-3px;width:0;border-left:1.5px solid var(--ink)}
.flowrow{min-height:78px;margin-bottom:6px}
.flowrow .lab{align-self:start;padding-top:2px}
.flowtrack{height:78px;background:none}
.flow{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.flow .future{fill:#F3F0EE}
.flow .zero{stroke:var(--minus);stroke-width:1;vector-effect:non-scaling-stroke}
.flow .half{stroke:var(--minus);stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
.flow .a-up{fill:rgba(132,22,23,.14)}
.flow .a-dn{fill:rgba(110,100,102,.18)}
.flow .ln{fill:none;stroke:var(--crimson);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.yt{position:absolute;left:-30px;transform:translateY(-50%);font-size:11.5px;color:var(--muted)}
.nowtag{position:absolute;transform:translate(8px,-50%);font:700 15px/1 "Zilla Slab",Georgia,serif;color:var(--crimson);background:#fff;padding:2px 4px;border-radius:4px}
.flowrow .now{top:0;bottom:0}
.run{position:absolute;top:0;height:6px;border:1.5px solid var(--crimson);border-bottom:0;border-radius:3px 3px 0 0}
.run b{position:absolute;left:50%;top:6px;transform:translateX(-50%);white-space:nowrap;font-size:11.5px;font-weight:600;color:var(--crimson)}
.tot{display:flex;justify-content:flex-end;gap:12px;font-size:13.5px}
.tm{color:var(--muted);min-width:34px;text-align:right}
.pm{min-width:30px;text-align:right;font-weight:700}
.pm.p{color:var(--crimson)}.pm.n{color:var(--muted)}.pm.z{color:var(--muted);font-weight:500}
.axis{min-height:24px}
.axtrack{background:none;height:18px}
.axtrack span{position:absolute;transform:translateX(-50%);font-size:12px;color:var(--muted)}
.axtrack span:first-child{transform:none}.axtrack span:last-child{transform:translateX(-100%)}
.axis .tot span{font-size:12px;font-weight:500}
/* footer */
.foot{display:flex;align-items:center;gap:20px;padding:8px 32px 14px;background:#fff}
.btn{appearance:none;border:0;cursor:pointer;font:600 15px/1 "Libre Franklin",system-ui,sans-serif;padding:11px 20px;border-radius:999px;background:var(--crimson);color:var(--cream)}
.btn:focus-visible,.seg button:focus-visible,.x:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.btn.ghost{background:transparent;color:var(--crimson);box-shadow:inset 0 0 0 1.5px var(--crimson)}
.src{font-size:13px;color:var(--muted)}
.wce{margin-left:auto;display:flex;align-items:center;gap:8px;padding:5px 12px 5px 5px;border-radius:999px;background:#fff;box-shadow:inset 0 0 0 1px var(--rule);font-size:12.5px;color:var(--muted);text-decoration:none}
.wce img{width:24px;height:24px;border-radius:7px;display:block}
.wce b{color:var(--ink);font-weight:600}
/* drawer */
.scrim{position:fixed;inset:0;background:rgba(36,28,29,.42)}
.drawer{position:fixed;top:0;right:0;bottom:0;width:600px;background:#fff;display:flex;flex-direction:column;box-shadow:-24px 0 48px rgba(36,28,29,.18)}
.dh{display:flex;align-items:center;justify-content:space-between;padding:20px 28px 14px}
.dh h2{font-size:26px}
.x{appearance:none;border:0;background:#F1EDEB;color:var(--ink);font:600 14px/1 "Libre Franklin",sans-serif;padding:10px 14px;border-radius:999px;cursor:pointer}
.seg{display:flex;gap:4px;margin:0 28px;padding:4px;background:#F1EDEB;border-radius:999px}
.seg button{flex:1;appearance:none;border:0;background:transparent;font:500 14px/1 "Libre Franklin",sans-serif;color:var(--muted);padding:9px 0;border-radius:999px;cursor:pointer}
.seg button[aria-selected=true]{background:#fff;color:var(--ink);font-weight:600;box-shadow:0 1px 2px rgba(36,28,29,.12)}
.db{flex:1;overflow:auto;padding:18px 28px 28px}
.db h3{font:600 18px/1.25 "Zilla Slab",Georgia,serif;margin:6px 0 4px}
.db .intro{font-size:14px;color:var(--muted);margin-bottom:12px;max-width:62ch}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{font-weight:500;color:var(--muted);text-align:right;padding:6px 0 6px 10px;border-bottom:1px solid var(--rule);vertical-align:bottom;line-height:1.25}
th:first-child,td:first-child{text-align:left;padding-left:0}
td{text-align:right;padding:7px 0 7px 10px;border-bottom:1px solid #EFEAE8}
td.g{max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tr.isnow td{font-weight:600}
tr.isnow td.g::after{content:"On now";margin-left:6px;font-size:11px;font-weight:600;color:var(--cream);background:var(--crimson);border-radius:999px;padding:1px 6px}
td.p{color:var(--crimson);font-weight:600}
.bar{display:inline-block;vertical-align:middle;height:6px;border-radius:3px;background:var(--even);width:56px;position:relative;margin-left:6px}
.bar i{position:absolute;top:0;bottom:0;background:var(--crimson);border-radius:3px}
.bar::after{content:"";position:absolute;left:50%;top:-2px;bottom:-2px;border-left:1px solid var(--muted)}
.sec{margin-top:26px}
th.nw{white-space:nowrap}
td.g{max-width:230px}
.early{color:var(--muted);font-size:12.5px}
.df{display:flex;gap:12px;align-items:center;padding:14px 28px;border-top:1px solid var(--rule)}
.df .src{margin-left:auto}
/* halftime */
.minutes .pl{grid-template-columns:1fr 110px 62px}
.mbar{height:6px;border-radius:3px;background:#EDE8E6;position:relative}
.mbar i{position:absolute;left:0;top:0;bottom:0;background:var(--ink);border-radius:3px}
/* phone */
@media (max-width:700px){
  .sb{grid-template-columns:1fr auto;padding:12px 16px 8px;gap:4px 12px}
  .team.them{grid-column:1;grid-row:2;justify-content:flex-start}
  .team.them .sc{order:2;margin-left:auto;margin-right:0}
  .team.them .tn{order:1;padding-left:50px}
  .full{display:none}.short{display:inline}
  .status{grid-column:2;grid-row:1/3}
  .mark{height:36px}.sc{font-size:38px}.tn{font-size:17px}.clk{font-size:26px}
  .fouls{flex-wrap:wrap;gap:4px 16px;padding:8px 16px}
  .live{margin-left:0}
  main{grid-template-columns:1fr;padding:0 16px}
  .say{padding:20px 0 12px;border-right:0}
  .lead h1{font-size:25px}
  .notes li{grid-template-columns:1fr;gap:2px;padding-left:23px}
  .floor{padding:16px 0 20px;border-top:1px solid var(--rule)}
  .strip{padding:16px}
  .strip-h{flex-direction:column;gap:2px}.strip-h p{text-align:left}
  .row{grid-template-columns:minmax(0,1fr) 84px;gap:2px 10px}
  .row .lab{grid-column:1/3}
  .row .track{grid-column:1}
  .flowrow .lab{display:none}
  .row.axis .lab{display:none}
  .yt{left:4px}
  .foot{flex-wrap:wrap;padding:12px 16px 20px}
  .wce{margin-left:0}
}
'''


def page(title, body, extra_head=''):
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(title)}</title><style>{CSS}</style>{extra_head}</head><body>{body}</body></html>'''


def footer(mode):
    btn = '<button class="btn" type="button" aria-controls="numbers" aria-expanded="false">See all the numbers</button>'
    return f'''<footer class="foot">{btn}<span class="src">ESPN play-by-play, refreshed every 15 seconds</span>
<a class="wce" href="https://wcehoops.com" aria-label="Powered by Western Conference Elitists"><img src="wce_s.png" alt=""><span>Powered by <b>WCE</b></span></a></footer>'''


def live_screen(d, drawer=False):
    d = dict(d, mode='live')
    items = takeaways(d, 'live')
    second = d['period'] >= 2
    last_st = d['stints'][-1]
    together = mmss((last_st['t1'] - last_st['t0']) / 60)
    paper = [t for t in takeaways_all(d) if t['kind'] == 'On paper']
    e = d['exp_now']
    floor = f'''<section class="floor" aria-label="On the floor">
<div class="grp"><div class="grp-h"><b>Oklahoma on the floor</b><span>Together {together}</span></div><ul>{floor_rows(d['ou_now_rows'], False, second)}</ul></div>
<div class="grp"><div class="grp-h"><b>{OPP} on the floor</b><span>Minutes and fouls tonight</span></div><ul>{floor_rows(d['opp_now'], True, second)}</ul></div>
{''.join(f'<p class="paper"><b>{E(t["head"])}</b> {E(t["why"])}</p>' for t in paper)}
</section>'''
    body = band(d, 'live', True) + f'''<main><section class="say" aria-label="What matters now">{tk_html(items)}</section>{floor}</main>
<section class="strip" aria-labelledby="st"><div class="strip-h"><h2 id="st">Who has been out there</h2><p>A record of who played when. One game is too few minutes to judge a group.</p></div>{strip(d)}</section>''' + footer('live')
    if drawer: body += drawer_html(d)
    return page('Oklahoma live lineups', body)


def drawer_html(d):
    agg = collections.OrderedDict()
    for s in d['stints']:
        a = agg.setdefault(tuple(s['players']), dict(min=0))
        a['min'] += (s['t1'] - s['t0']) / 60
    ukey = {tuple(u['players']): u for u in d['units']}
    rows = ''
    for k in sorted(agg, key=lambda k: -agg[k]['min']):
        u = ukey.get(k)
        if not u or not u['tonight']: continue
        t, s = u['tonight'], u['season']
        adj = t['pm'] - t['pm_opp3_luck'] - t['pm_own3_luck']
        best = s['best']; w = min(50, abs(best) / 6 * 50)
        bar = f'<span class="bar"><i style="{"left:50%" if best >= 0 else f"left:{50 - w:.0f}%"};width:{w:.0f}%"></i></span>'
        now = ' class="isnow"' if list(k) == d['ou_now'] else ''
        rows += f'<tr{now}><td class="g">{E(", ".join(last(n) for n in k))}</td><td>{mmss(agg[k]["min"])}</td><td class="{"p" if t["pm"] > 0 else ""}">{sgn(t["pm"])}</td><td>{sgn(adj)}</td><td>{(sgn(best, 1) + bar) if s['trust'] >= .05 else '<span class="early">Too early</span>'}</td></tr>'
    T, P = d['team_tonight'], d['team_prior']
    def f3(s):
        m, a = made(s); return f'{m}–{a} <span style="color:var(--muted)">({round(100 * m / a) if a else 0}%)</span>'
    shoot = [('Your threes', f3(T['own3']), f3(P['own3'])), (f'{OPP} threes', f3(T['opp3']), f3(P['opp3'])),
             ('Share of your shots that are threes', pct(T['tpa']), pct(P['tpa'])), ('Share of your shots at the rim', pct(T['rim']), pct(P['rim'])),
             ('Share of their shots at the rim', pct(T['rim_allowed']), pct(P['rim_allowed'])), ('Turnovers forced per 100 possessions', round(T['tov_forced']), round(P['tov_forced']))]
    srows = ''.join(f'<tr><td>{a}</td><td>{b}</td><td>{c}</td></tr>' for a, b, c in shoot)
    return f'''<div class="scrim"></div><aside class="drawer" id="numbers" role="dialog" aria-modal="true" aria-labelledby="dt">
<div class="dh"><h2 id="dt">All the numbers</h2><button class="x" type="button">Close</button></div>
<div class="seg" role="tablist"><button role="tab" aria-selected="true">Lineups</button><button role="tab" aria-selected="false">Players</button><button role="tab" aria-selected="false">Shooting</button><button role="tab" aria-selected="false">{OPP}</button></div>
<div class="db"><h3>Every Oklahoma five tonight</h3>
<p class="intro">Season best guess is how much better or worse than Oklahoma’s average we expect a group to be, per 100 possessions. It needs a few hundred possessions together before it says much, so early in the season every group reads too early.</p>
<table><thead><tr><th>Group</th><th>Min</th><th class="nw">+/−</th><th>Without shooting luck</th><th>Season best guess</th></tr></thead><tbody>{rows}</tbody></table>
<div class="sec"><h3>Shooting and shot mix</h3><p class="intro">Three-point percentages swing a lot in one game. Shot mix tells you more about how a game is being played.</p>
<table><thead><tr><th></th><th>Tonight</th><th>Before tonight</th></tr></thead><tbody>{srows}</tbody></table></div></div>
<div class="df"><button class="btn ghost" type="button">Download for your tracker (CSV)</button><span class="src">Matches the Stint Log tab</span></div></aside>'''


def half_screen(d):
    d = dict(d, mode='half')
    items = takeaways(d, 'half')
    mx = max(r['min'] for r in d['ou_players'])
    rows = ''
    for r in d['ou_players']:
        warn = r['fouls'] >= 3
        rows += f'<li class="pl{" warn" if warn else ""}"><span class="nm">{E(r["name"])}</span><span class="mbar" aria-label="{round(r["min"])} minutes"><i style="width:{100 * r["min"] / 20:.0f}%"></i></span>{pips(r["fouls"], warn)}</li>'
    floor = f'''<section class="floor minutes" aria-labelledby="mn"><h2 id="mn">First-half minutes and fouls</h2>
<div class="grp"><div class="grp-h"><span>Bars show minutes out of 20</span><span>Fouls</span></div><ul>{rows}</ul></div></section>'''
    body = band(d, 'half', True) + f'''<main><section class="say" aria-label="Halftime">{tk_html(items)}</section>{floor}</main>
<section class="strip" aria-labelledby="st"><div class="strip-h"><h2 id="st">Who was out there</h2><p>A record of who played when. One half is too few minutes to judge a group.</p></div>{strip(d)}</section>''' + footer('half')
    return page('Oklahoma halftime', body)


if __name__ == '__main__':
    L = json.load(open('mock/live.json')); H = json.load(open('mock/half.json'))
    for t in takeaways(dict(L, mode='live'), 'live'): print('LIVE', t['kind'], '|', t['head'], '|', t['why'])
    for t in takeaways(dict(H, mode='half'), 'half'): print('HALF', t['kind'], '|', t['head'], '|', t['why'])
    open('mock/v3_live.html', 'w').write(live_screen(L))
    open('mock/v3_live_open.html', 'w').write(live_screen(L, drawer=True))
    open('mock/v3_half.html', 'w').write(half_screen(H))
    open('mock/v3_phone.html', 'w').write(live_screen(L))
