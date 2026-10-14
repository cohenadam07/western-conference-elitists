"""One-off: register the October 2026 card stats in the page's CFG and add the two panels.
Idempotent (re-running changes nothing). Kept for the record of what was added and where."""
import json, os, re

PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "basketball-savant.html")
s = open(PAGE, encoding="utf-8").read()

NEW = [  # (insert after key, metric)
    ("p3pt", dict(key="ppaint", label="% points in the paint", group="off", sub="Shooting", layer="ingredient",
                  unit="pct1", thr=200, lower=False, tier=2, since="1996-97")),
    ("ppaint", dict(key="xefg", label="Shot quality (expected eFG%)", group="off", sub="Shooting", layer="expected",
                    unit="pct3", thr=200, lower=False, tier=3, since="2013-14")),
    ("xefg", dict(key="shotmk", label="Shot-making over expected", group="off", sub="Shooting", layer="output",
                  unit="sgn", thr=200, lower=False, tier=3, since="2013-14")),
    ("selfcr", dict(key="uast", label="Unassisted makes %", group="off", sub="Creation & playmaking", layer="ingredient",
                    unit="pct1", thr=100, lower=False, tier=2, since="1996-97")),
    ("uast", dict(key="uast3", label="Unassisted 3s %", group="off", sub="Creation & playmaking", layer="ingredient",
                  unit="pct1", thr=50, lower=False, tier=2, since="1996-97")),
    ("onoff", dict(key="onoffadj", label="On/Off net (luck-adjusted)", group="off", sub="Impact", layer="context",
                   unit="num1", thr=0, lower=False, tier=2, since="1996-97")),
]

i = s.index("const CFG  = ") + len("const CFG  = ")
depth = 0
for j in range(i, len(s)):
    if s[j] == "{": depth += 1
    elif s[j] == "}":
        depth -= 1
        if depth == 0: break
cfg = json.loads(s[i:j + 1])
keys = [m["key"] for m in cfg["metrics"]]
for after, m in NEW:
    if m["key"] in keys:
        continue
    at = keys.index(after) + 1
    cfg["metrics"].insert(at, m)
    keys.insert(at, m["key"])
s = s[:i] + json.dumps(cfg, indent=2) + s[j + 1:]

# ---- panels: containers
if 'id="ptype"' not in s:
    s = s.replace('  <div class="col guard" id="guard" hidden></div>\n',
                  '  <div class="col guard" id="guard" hidden></div>\n'
                  '  <div class="col ptype" id="ptype" hidden></div>\n'
                  '  <div class="col wwp" id="wwp" hidden></div>\n', 1)

# ---- panels: CSS
if ".ptype{" not in s:
    s = s.replace(".role{margin-top:14px}", """.role{margin-top:14px}
.ptype,.wwp{margin-top:14px}
.panel-h{cursor:pointer}
.pt-table,.ww-table{width:100%;border-collapse:collapse;font-size:13px}
.pt-table th,.ww-table th{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:500;text-align:right;padding:4px 6px;border-bottom:1px solid var(--line,#D8D6CF)}
.pt-table th:first-child,.ww-table th:first-child{text-align:left}
.pt-table td,.ww-table td{padding:5px 6px;text-align:right;border-bottom:1px solid rgba(0,0,0,.05);font-variant-numeric:tabular-nums}
.pt-table td:first-child,.ww-table td:first-child{text-align:left}
.pt-bar{display:inline-block;height:9px;border-radius:2px;vertical-align:middle;margin-right:6px}
.ww-up{color:#BC3A2C}.ww-dn{color:#1C4E86}
.ww-n{color:var(--muted);font-size:11.5px}""", 1)

# ---- panels: render functions, called next to renderGuard()
if "function renderPlayTypes" not in s:
    s = s.replace("function renderGuard(){", r"""/* Play-type profile (Synergy): how his offense is built, and how well each part works.
   Explainer under EXPL.pt. Season view only; Synergy starts in 2015-16. */
const PT_NAMES={PRBallHandler:'Pick-and-roll ball handler',PRRollman:'Pick-and-roll roll man',Isolation:'Isolation',
  Transition:'Transition',Spotup:'Spot-up',Postup:'Post-up',Handoff:'Handoff',Cut:'Cut',OffScreen:'Off screen',
  OffRebound:'Putbacks',Misc:'Other'};
function renderPlayTypes(){
  const el=document.getElementById('ptype'); if(!el) return;
  const pt=cur&&cur.pt;
  if(!pt||cmpPlayers().length){ el.hidden=true; el.innerHTML=''; return; }
  const rows=Object.keys(pt).map(function(k){return [k].concat(pt[k]);}).sort(function(a,b){return b[1]-a[1];});
  el.innerHTML='<h2 class="col-h panel-h" data-k="pt" title="Click for what this is and how it’s calculated">Play types</h2>'
    +'<div class="guard-cap">How his offense is built, from Synergy tracking &middot; '+curSeason+'. Percentile is the NBA&rsquo;s, against every player who ran that play type.</div>'
    +'<table class="pt-table"><tr><th>Play type</th><th>Share</th><th>Pts / poss</th><th>Percentile</th><th>Poss</th></tr>'
    +rows.map(function(r){
      return '<tr><td>'+(PT_NAMES[r[0]]||r[0])+'</td><td>'+r[1].toFixed(1)+'%</td><td>'+r[2].toFixed(2)+'</td>'
        +'<td><span class="pt-bar" style="width:'+Math.max(2,r[3]*0.6)+'px;background:'+colorAt(r[3])+'"></span>'+r[3]+'</td><td>'+r[4]+'</td></tr>';
    }).join('')+'</table>';
  el.hidden=false;
}
/* With / without: the teammates whose absence changes his game most. Explainer under EXPL.ww. */
function renderWW(){
  const el=document.getElementById('wwp'); if(!el) return;
  const ww=cur&&cur.ww;
  if(!ww||!ww.length||cmpPlayers().length){ el.hidden=true; el.innerHTML=''; return; }
  const arrow=function(a,b){const d=b-a; if(Math.abs(d)<0.05) return b.toFixed(1);
    return '<span class="'+(d>0?'ww-up':'ww-dn')+'">'+b.toFixed(1)+' '+(d>0?'▲':'▼')+'</span>';};
  el.innerHTML='<h2 class="col-h panel-h" data-k="ww" title="Click for what this is and how it’s calculated">With / without</h2>'
    +'<div class="guard-cap">His per-36 numbers when each teammate plays vs. sits &middot; '+curSeason+'. Games without a teammate are few; the game counts are shown.</div>'
    +'<table class="ww-table"><tr><th>When this teammate sits</th><th>Usage /36</th><th>Pts /36</th><th>Ast /36</th><th>Reb /36</th><th>Min</th></tr>'
    +ww.map(function(r){
      return '<tr><td>'+r.name+' <span class="ww-n">'+r.gwo+' g without &middot; '+r.gw+' with</span></td>'
        +'<td>'+r.w.usg.toFixed(1)+' → '+arrow(r.w.usg,r.wo.usg)+'</td><td>'+r.w.pts.toFixed(1)+' → '+arrow(r.w.pts,r.wo.pts)+'</td>'
        +'<td>'+r.w.ast.toFixed(1)+' → '+arrow(r.w.ast,r.wo.ast)+'</td><td>'+r.w.reb.toFixed(1)+' → '+arrow(r.w.reb,r.wo.reb)+'</td>'
        +'<td>'+r.w.min.toFixed(1)+' → '+arrow(r.w.min,r.wo.min)+'</td></tr>';
    }).join('')+'</table>';
  el.hidden=false;
}
function renderGuard(){""", 1)
    s = s.replace("  renderGuard();\n", "  renderGuard(); renderPlayTypes(); renderWW();\n", 1)

# ---- panel headers open their explainer, like a stat name does
if "panel-h" in s and "wirePanelExpl" not in s:
    s = s.replace("(async function init(){", r"""function wirePanelExpl(){
  document.addEventListener('click',function(ev){
    const h=ev.target.closest&&ev.target.closest('.panel-h'); if(!h) return;
    const nxt=h.nextElementSibling;
    if(nxt&&nxt.classList.contains('expl')){ nxt.remove(); return; }
    const html=explHtml(h.dataset.k); if(!html) return;
    h.insertAdjacentHTML('afterend','<div class="expl">'+html+'</div>');
  });
}
wirePanelExpl();
(async function init(){""", 1)

open(PAGE, "w", encoding="utf-8").write(s)
print("ok")
