"""v4 mockups: tabs (Right now / Shots and scoring / Their key players), live shot chart with lineup filter,
points sources, opponent impact players. Builds on mock3. Usage: python3 code/mock4.py"""
import json, collections, html, math
import mock3 as M

E = html.escape
OPP, OPP_FULL = M.OPP, M.OPP_FULL
TABS = ['Right now', 'Shots and scoring', 'Their key players']

# NCAA men's court (feet). Rim center 5.25 ft from baseline; 3-pt arc 22.146 ft; corner 3 at 21.65 ft from rim (3.35 ft from sideline)
RIM_X, ARC, CORNER = 5.25, 22.146, 21.65
ARC_X = RIM_X + math.sqrt(ARC ** 2 - CORNER ** 2)


def band4(d, mode, active):
    ou, op = d['score']['OU'], d['score']['OPP']
    tf = d['team_fouls']; o, p = tf.get('OU', 0), tf.get('OPP', 0)
    chip = '<span class="chip soft">Bonus on next foul</span>' if p == 6 else '<span class="chip">In the bonus</span>' if 7 <= p < 10 else ''
    tabs = ''.join(f'<a class="tab{" on" if t == active else ""}" href="#" role="tab" aria-selected="{str(t == active).lower()}">{t}</a>' for t in TABS)
    return f'''<header class="band">
  <div class="sb">
    <div class="team us"><img class="mark" src="ou_mark.png" alt="Oklahoma"><span class="tn">Oklahoma</span><span class="sc">{ou}</span></div>
    <div class="status"><span class="per">2nd half</span><span class="clk">{d["clock"]}</span><span class="upd"><span class="dot"></span>Live</span></div>
    <div class="team them"><span class="sc">{op}</span><span class="tn"><span class="full">{OPP_FULL}</span><span class="short">{OPP}</span></span></div>
  </div>
  <div class="fouls"><span>Oklahoma team fouls <b>{o}</b></span><span>{OPP} team fouls <b>{p}</b>{chip}</span><nav class="tabs" role="tablist">{tabs}</nav></div>
</header>'''


CSS4 = r'''
.upd{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;opacity:.85;margin-top:3px}
.upd .dot{width:6px;height:6px}
.tabs{margin-left:auto;display:flex;gap:4px}
.tab{color:rgba(253,249,216,.82);text-decoration:none;font-weight:500;font-size:14px;padding:5px 13px;border-radius:999px}
.tab.on{background:var(--cream);color:var(--crimson);font-weight:600}
.tab:focus-visible{outline:2px solid var(--cream);outline-offset:2px}
/* shots tab */
.shots{flex:1;display:grid;grid-template-columns:272px minmax(0,1fr);gap:28px;padding:18px 32px 6px}
.pick h2{margin-bottom:8px}
.pick ul{list-style:none}
.opt{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:8px 10px 8px 12px;border-left:4px solid transparent;border-bottom:1px solid var(--rule);cursor:pointer}
.opt .o1{font-size:14px;line-height:1.3}
.opt .o2{grid-column:1/3;font-size:12.5px;color:var(--muted)}
.opt .pm{font-size:13.5px}
.opt.on{border-left-color:var(--crimson);background:#fff}
.opt.on .o1{font-weight:600}
.opt .ontag{margin-left:6px;vertical-align:1px}
.pick .hint{font-size:12.5px;color:var(--muted);margin-top:10px}
.courtwrap{min-width:0}
.cap{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;margin-bottom:6px}
.cap b{font-family:"Zilla Slab",Georgia,serif;font-size:17px;font-weight:600}
.cap .mid{color:var(--muted);font-size:13px;text-align:center;max-width:52ch}
.court{display:block;width:100%;height:auto}
.key{display:flex;gap:22px;align-items:center;justify-content:center;font-size:13px;color:var(--muted);margin-top:8px}
.key span{display:flex;align-items:center;gap:7px}
.below{display:grid;grid-template-columns:1fr 1fr;gap:0;padding:12px 32px 4px;background:#fff;border-top:1px solid var(--rule)}
.below section{padding:4px 28px 8px 0}
.below section+section{padding:4px 0 8px 28px;border-left:1px solid var(--rule)}
.below h3{font:600 18px/1.25 "Zilla Slab",Georgia,serif}
.below .say1{font-size:14.5px;margin:2px 0 8px}
.below .say1 b{font-weight:600}
.tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.tbl th{font-weight:500;color:var(--muted);text-align:right;padding:4px 0 4px 8px;border-bottom:1px solid var(--rule)}
.tbl td{text-align:right;padding:5px 0 5px 8px;border-bottom:1px solid #EFEAE8}
.tbl th:first-child,.tbl td:first-child{text-align:left;padding-left:0}
.tbl td.big{font-weight:700}
.duo{display:inline-flex;align-items:center;gap:8px}
.mbar2{display:inline-block;height:7px;border-radius:2px;vertical-align:middle}
/* players tab */
.kp-h{display:flex;justify-content:space-between;align-items:baseline;gap:24px;padding:18px 32px 4px}
.kp-h p{font-size:14px;color:var(--muted);max-width:62ch;text-align:right}
.kp{flex:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:52px;padding:4px 32px 10px}
.pc{padding:12px 0 10px;position:relative}
.pc+.pc::before{content:"";position:absolute;left:-26px;top:12px;bottom:10px;border-left:1px solid var(--rule)}
.pc h3{font:700 25px/1.1 "Zilla Slab",Georgia,serif}
.pc .meta{font-size:13.5px;color:var(--muted);margin-top:3px;display:flex;gap:10px;align-items:center}
.pc .meta .chip{margin-left:0;background:var(--crimson);color:var(--cream)}
.pc .how{font-size:16px;font-weight:600;margin:10px 0 8px;line-height:1.3}
.facet{display:grid;grid-template-columns:96px 1fr;gap:2px 12px;align-items:center;padding:5px 0;border-top:1px solid #EFEAE8}
.facet .fl{font-size:13.5px}
.facet .fb{position:relative;height:8px;background:#F1EDEB;border-radius:4px}
.facet .fb i{position:absolute;top:0;bottom:0;border-radius:4px}
.facet .fb::after{content:"";position:absolute;left:30%;top:-3px;bottom:-3px;border-left:1px solid var(--minus)}
.facet .fd{grid-column:2;font-size:12.5px;color:var(--muted)}
.facet.top .fl{font-weight:600}
.mini{display:block;width:100%;height:auto;margin-top:10px}
.kp-note{font-size:12.5px;color:var(--muted);padding:0 32px 8px}
'''


def court_svg(shots, full=True, cls='court', only=None):
    """Aerial court in feet. full: 94x50 with OU at left basket, MVSU at right; else half court (opponent shots), 50 wide x 30 deep."""
    B = 3.6  # border width (out of bounds band)
    def half(left=True):
        # lines for one end; transform for the right end
        tr = '' if left else ' transform="translate(94,50) rotate(180)"'
        return f'''<g{tr} class="ln">
  <rect x="0" y="19" width="19" height="12" class="lane"/>
  <path d="M19,19 V31" /><circle cx="19" cy="25" r="6" class="ftc"/>
  <path d="M0,{25 - CORNER:.3f} H{ARC_X:.3f} A{ARC},{ARC} 0 0 1 {ARC_X:.3f},{25 + CORNER:.3f} H0"/>
  <path d="M{RIM_X},21 A4,4 0 0 1 {RIM_X},29" class="ra"/>
  <path d="M4,22 V28" class="bb"/><circle cx="{RIM_X}" cy="25" r=".75" class="rim"/>
</g>'''
    def mark(s, X, Y):
        r = .82
        if not s['made']: return f'<circle cx="{X:.2f}" cy="{Y:.2f}" r="{r}" class="mx"/>'
        return f'<circle cx="{X:.2f}" cy="{Y:.2f}" r="{r}" class="{"ma" if s["ast"] else "mu"}"/>'
    marks = ''; seen = collections.Counter()
    for s in shots:
        yb = min(s['y'], 46.5)
        if full:
            X, Y = (yb, s['x']) if s['team'] == 'OU' else (94 - yb, 50 - s['x'])
        else:
            X, Y = 50 - s['x'], yb  # half court drawn vertically: basket at top
        key = (round(X * 2), round(Y * 2)); n = seen[key]; seen[key] += 1
        if n:  # spread stacked shots on a small spiral so every attempt is visible
            a = n * 2.4; X += .9 * math.sqrt(n) * math.cos(a); Y += .9 * math.sqrt(n) * math.sin(a)
        marks += mark(s, X, Y)
    if full:
        planks = ''.join(f'<rect x="0" y="{i * 2.5}" width="94" height="2.5" fill="{c}"/>' for i, c in enumerate(['#E9D2A8', '#E5CCA0', '#ECD6AE', '#E7CFA5'] * 5))
        return f'''<svg class="{cls}" viewBox="{-B} {-B} {94 + 2 * B} {50 + 2 * B}" role="img" aria-label="Shot chart: Oklahoma shots at the left basket, {OPP} shots at the right">
<rect x="{-B}" y="{-B}" width="{94 + 2 * B}" height="{50 + 2 * B}" fill="#841617"/>
<text x="47" y="{-B / 2 + .05}" class="oob">OKLAHOMA</text><text x="47" y="{50 + B / 2 + .05}" class="oob">BOOMER  SOONER</text>
<g>{planks}</g>
<image href="ou_mark_crimson.png" x="{47 - 4.6}" y="{25 - 5.95}" width="9.2" height="11.9" opacity=".9"/>
{half(True)}{half(False)}
<g class="ln"><path d="M47,0 V50"/><circle cx="47" cy="25" r="6"/><rect x="0" y="0" width="94" height="50" class="bnd"/></g>
<g>{marks}</g></svg>'''
    # half court, vertical, basket at top, cropped to 30 ft
    D = 32
    planks = ''.join(f'<rect x="{i * 2.5}" y="0" width="2.5" height="{D}" fill="{c}"/>' for i, c in enumerate(['#E9D2A8', '#E5CCA0', '#ECD6AE', '#E7CFA5'] * 5))
    g = f'''<g class="ln"><rect x="19" y="0" width="12" height="19" class="lane"/><path d="M19,19 H31"/><path d="M19,19 A6,6 0 0 0 31,19" class="ftc"/>
<path d="M{25 - CORNER:.3f},0 V{ARC_X:.3f} A{ARC},{ARC} 0 0 0 {25 + CORNER:.3f},{ARC_X:.3f} V0"/>
<path d="M21,{RIM_X} A4,4 0 0 0 29,{RIM_X}" class="ra"/><path d="M22,4 H28" class="bb"/><circle cx="25" cy="{RIM_X}" r=".75" class="rim"/>
<path d="M0,0 H50"/></g>'''
    return f'''<svg class="{cls}" viewBox="-1.5 -1.5 53 {D + 1.5}" role="img" aria-label="Shot chart">
<rect x="-1.5" y="-1.5" width="53" height="{D + 1.5}" fill="#841617"/><g>{planks}</g>{g}<g>{marks}</g></svg>'''


SVG_CSS = r'''
svg .ln{fill:none;stroke:#fff;stroke-width:.22}
svg .ln .lane{fill:rgba(132,22,23,.22);stroke:#fff}
svg .ln .bnd{stroke-width:.3}
svg .ln .bb{stroke:#fff;stroke-width:.35}
svg .ln .rim{stroke:#c45a1a;stroke-width:.2}
svg .ln .ra{stroke-width:.18}
svg .oob{fill:#FDF9D8;font:700 2.1px "Zilla Slab",Georgia,serif;letter-spacing:.9px;text-anchor:middle;dominant-baseline:middle}
svg .mu{fill:#241C1D;stroke:#fff;stroke-width:.14}
svg .ma{fill:#841617;stroke:#fff;stroke-width:.14}
svg .mx{fill:rgba(255,255,255,.35);stroke:#241C1D;stroke-width:.24}
'''


def key_html():
    c = lambda cls: f'<svg width="15" height="15" viewBox="-1 -1 2 2"><circle r=".78" class="{cls}" style="stroke-width:.14"/></svg>'
    return f'<div class="key"><span>{c("mu")}Made, unassisted</span><span>{c("ma")}Made, assisted</span><span>{c("mx")}Missed</span></div>'


def windows_for(L, five):
    return [(s['t0'], s['t1']) for s in L['stints'] if s['players'] == list(five)]


def in_w(t, W): return any(a <= t < b or (t == b and b == W[-1][1]) for a, b in W) if W else True


def shot_mix(shots, team):
    S = [s for s in shots if s['team'] == team]
    rim = [s for s in S if s['rim']]; three = [s for s in S if s['three']]; other = [s for s in S if not s['rim'] and not s['three']]
    mk = [s for s in S if s['made']]
    f = lambda a: f'{sum(s["made"] for s in a)} of {len(a)}'
    return dict(rim=f(rim), other=f(other), three=f(three), n=len(S), nr=len(rim), n3=len(three), no=len(other),
                ast=f'{sum(s["ast"] for s in mk)} of {len(mk)}')


def sources_in(events, W):
    src = {'OU': collections.Counter(), 'OPP': collections.Counter()}
    for e in events:
        if in_w(e['t'], W):
            for tg in e['tags']: src[e['team']][tg] += e['pts']
            src[e['team']]['_total'] += e['pts']
    return src


def shots_screen(L, S, sel=None):
    d = dict(L, mode='live')
    agg = collections.OrderedDict()
    for s in L['stints']:
        a = agg.setdefault(tuple(s['players']), dict(min=0, pm=0)); a['min'] += (s['t1'] - s['t0']) / 60; a['pm'] += s['pm']
    order = sorted(agg, key=lambda k: -agg[k]['min'])[:4]
    now = tuple(L['ou_now'])
    if now not in order: order.append(now)
    W = windows_for(L, sel) if sel else None
    shots = [s for s in S['shots'] if (in_w(s['t'], W) if W else True)]
    opts = f'<li class="opt{" on" if not sel else ""}"><span class="o1">Whole game</span><span class="pm z"></span><span class="o2">{len(S["shots"])} shots so far</span></li>'
    for k in order:
        n = sum(1 for s in S['shots'] if in_w(s['t'], windows_for(L, k)))
        a = agg[k]; c = 'p' if a['pm'] > 0 else 'n' if a['pm'] < 0 else 'z'
        tag = '<span class="ontag">Now</span>' if k == now else ''
        opts += f'<li class="opt{" on" if sel == k else ""}"><span class="o1">{E(", ".join(M.last(n_) for n_ in k))}{tag}</span><span class="pm {c}">{M.sgn(a["pm"])}</span><span class="o2">{M.mmss(a["min"])} together, {n} shots</span></li>'
    pick = f'''<aside class="pick" aria-labelledby="pk"><h2 id="pk">Show shots for</h2><ul role="listbox">{opts}</ul>
<p class="hint">Tap any group in Who has been out there to see it here.</p></aside>'''
    if sel:
        cap_mid = f'{E(", ".join(M.last(n_) for n_ in sel))}: {M.mmss(agg[sel]["min"])} together. A handful of shots, so read where, not makes.'
    else:
        cap_mid = 'Whole game so far'
    nou = sum(s['team'] == 'OU' for s in shots); nop = len(shots) - nou
    court = f'''<div class="courtwrap"><div class="cap"><span><b>Oklahoma shots</b> ({nou})</span><span class="mid">{cap_mid}</span><span><b>{OPP} shots</b> ({nop})</span></div>
{court_svg(shots)}{key_html()}</div>'''
    # below: shot mix + how the points are scored
    a, b = shot_mix(shots, 'OU'), shot_mix(shots, 'OPP')
    mix = f'''<table class="tbl"><thead><tr><th></th><th>Oklahoma</th><th>{OPP}</th></tr></thead><tbody>
<tr><td>At the rim</td><td>{a["rim"]}</td><td>{b["rim"]}</td></tr><tr><td>Other twos</td><td>{a["other"]}</td><td>{b["other"]}</td></tr>
<tr><td>Threes</td><td>{a["three"]}</td><td>{b["three"]}</td></tr><tr><td>Makes that were assisted</td><td>{a["ast"]}</td><td>{b["ast"]}</td></tr></tbody></table>'''
    if sel:
        mix_say = f'With this group on the floor, {a["n3"]} of Oklahoma’s {a["n"]} shots were threes and {a["nr"]} were at the rim.'
    else:
        ra, rb = a['nr'] / max(1, a['n']), b['nr'] / max(1, b['n'])
        mix_say = f'{a["n3"]} of Oklahoma’s {a["n"]} shots are threes, and {a["nr"]} are at the rim.'
        if rb - ra >= .08: mix_say += f' {OPP} is getting to the rim more: {b["nr"]} of {b["n"]}.'
        elif ra - rb >= .08: mix_say += f' {OPP} gets there less: {b["nr"]} of {b["n"]}.'
    src = sources_in(S['events'], W)
    cats = ['Off turnovers', 'Fast break', 'Second chance', 'Free throws']
    mx = max(1, max(src[t][c] for t in src for c in cats))
    rows = ''
    for c in cats:
        u, o = src['OU'][c], src['OPP'][c]
        bar = lambda v, col: f'<span class="mbar2" style="width:{70 * v / mx:.0f}px;background:{col}"></span>'
        rows += f'<tr><td>{c}</td><td class="{"big" if u > o else ""}"><span class="duo">{bar(u, "var(--crimson)")}{u}</span></td><td class="{"big" if o > u else ""}"><span class="duo">{bar(o, "var(--minus)")}{o}</span></td></tr>'
    gaps = sorted(((src['OU'][c] - src['OPP'][c], c) for c in cats), reverse=True)
    g, c = gaps[0]
    phr = {'Off turnovers': 'points off turnovers', 'Fast break': 'fast-break points', 'Second chance': 'second-chance points', 'Free throws': 'points at the line'}[c]
    src_say = f'<b>The biggest edge is {phr}:</b> {src["OU"][c]} to {src["OPP"][c]}.' if g >= 4 else ('Too few points with this group to see a pattern.' if sel else 'No clear edge in where the points come from.')
    below = f'''<div class="below"><section><h3>Where the shots come from</h3><p class="say1">{mix_say}</p>{mix}</section>
<section><h3>How the points are scored</h3><p class="say1">{src_say}</p><table class="tbl"><thead><tr><th></th><th>Oklahoma</th><th>{OPP}</th></tr></thead><tbody>{rows}</tbody></table></section></div>'''
    body = band4(d, 'live', 'Shots and scoring') + f'<main class="shots">{pick}{court}</main>' + below + M.footer('live')
    return M.page('Oklahoma shots and scoring', body, f'<style>{CSS4}{SVG_CSS}</style>')


def players_screen(L, S):
    d = dict(L, mode='live')
    opp_rows = {r['name']: r for r in L['opp_players']}
    on_now = {r['name'] for r in L['opp_now']}
    top = [o for o in S['opp_impact'] if o['gs'] >= 3][:3]
    mx = max(max(abs(o[k]) for k in ('scoring', 'playmaking', 'glass', 'defense')) for o in top)
    FACETS = [('scoring', 'Scoring'), ('playmaking', 'Playmaking'), ('glass', 'On the glass'), ('defense', 'Defense')]
    def detail(k, b):
        g = lambda n: b.get(n, 0)
        if k == 'scoring':
            s = f'{g("pts")} pts on {g("fgm")} of {g("fga")}'
            if g('rima'): s += f', {g("rimm")} of {g("rima")} at the rim'
            if g('3pa'): s += f', {g("3pm")} of {g("3pa")} from three'
            return s
        pl = lambda n, w: f'{n} {w}' + ('' if n == 1 else 's')
        if k == 'playmaking': return f'{pl(g("ast"), "assist")}, {pl(g("tov"), "turnover")}'
        if k == 'glass': return f'{g("orb")} offensive, {pl(g("drb"), "defensive rebound")}'
        return f'{pl(g("stl"), "steal")}, {pl(g("blk"), "block")}, {pl(g("pf"), "foul")}'
    cols = ''
    for o in top:
        b = o['box']; r = opp_rows.get(o['name'], {})
        ranked = sorted(FACETS, key=lambda f: -o[f[0]])
        WORD = dict(scoring='scoring', playmaking='setting up teammates', glass='rebounding', defense='defense')
        good = [WORD[k] for k, lab in ranked if o[k] >= 1.5][:2]
        bad = [k for k, lab in FACETS if o[k] <= -1.5]
        how = ('Hurting you with ' + ' and '.join(good) + '.') if good else 'A bit of everything.'
        if 'playmaking' in bad: how += f' But {b.get("tov", 0)} turnovers.'
        fac = ''
        for k, lab in FACETS:
            v = o[k]; w = 70 * abs(v) / mx
            st = f'left:30%;width:{w:.0f}%;background:var(--crimson)' if v >= 0 else f'left:{30 - min(30, w):.0f}%;width:{min(30, w):.0f}%;background:var(--minus)'
            fac += f'<div class="facet{" top" if k == ranked[0][0] else ""}"><span class="fl">{lab}</span><span class="fb"><i style="{st}"></i></span><span class="fd">{detail(k, b)}</span></div>'
        fouls = r.get('fouls', b.get('pf', 0))
        fchip = f'<span class="chip">{fouls} fouls</span>' if fouls >= 4 else f'<span>{fouls} fouls</span>'
        onf = 'On the floor now' if o['name'] in on_now else 'On the bench'
        mine = [dict(s) for s in S['shots'] if s.get('shooter') == o['name']]
        cols += f'''<article class="pc"><h3>{E(o["name"])}</h3><p class="meta"><span>{round(o["min"])} min</span>{fchip}<span>{onf}</span></p>
<p class="how">{E(how)}</p>{fac}{court_svg(mine, full=False, cls="mini")}</article>'''
    head = f'''<div class="kp-h"><h2>Their most impactful players tonight</h2><p>Ranked by a box-score impact score, which misses some defense.</p></div>'''
    body = band4(d, 'live', 'Their key players') + head + f'<main class="kp">{cols}</main>' + f'<div class="kp-note">{key_html()}</div>' + M.footer('live')
    return M.page(f'{OPP} key players', body, f'<style>{CSS4}{SVG_CSS}</style>')


def now_screen(L, S):
    # Right-now tab: v3 board with the tab row and the run marker
    L2 = dict(L, best_run=S['best_run'])
    orig = M.band
    M.band = lambda d, mode, logo: band4(d, mode, 'Right now')
    try:
        h = M.live_screen(L2)
    finally:
        M.band = orig
    return h.replace('</head>', f'<style>{CSS4}</style></head>')


if __name__ == '__main__':
    L = json.load(open('mock/live.json')); S = json.load(open('mock/shots.json'))
    for o in S['opp_impact'][:3]: print(o['name'], o['gs'])
    open('mock/v4_now.html', 'w').write(now_screen(L, S))
    open('mock/v4_shots.html', 'w').write(shots_screen(L, S))
    sel = ('Derrion Reid', 'Kai Rogers', 'B.J. Edwards', 'Xzayvier Brown', 'Dayton Forsythe')
    open('mock/v4_shots_lineup.html', 'w').write(shots_screen(L, S, sel))
    open('mock/v4_players.html', 'w').write(players_screen(L, S))
