"""
preview.py — what a sport theme would look like on a coaching page that does not use it yet.

    python3 tools/themes/preview.py <dir>      -> <dir>/_preview-nba-coaching.html, <dir>/_preview-football-coaching.html

For Adam's approval (Nov 6, 2026), nothing published: Basketball Coaching Savant and football's Coaching Savant
stay as they are. Each preview is the published page with the sport's theme around it: its tokens, the shared
base rules, the framed sheet and collapsible sidebar (the frame College Basketball Savant and College Basketball
Coaching Savant use), and for the NBA page, whose components are the coaching components, the coaching skin.
Write <dir> inside public/ (the football page fetches its data by relative path) and delete the files after.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "..", "..", "public")


def theme(*names):
    return "".join(open(os.path.join(HERE, n), encoding="utf-8").read() for n in names)


def shell(name, nav, search, scope):
    links = "".join(f'<a href="{h}" data-tab="{k}" title="{t}"{" aria-current=\"page\"" if i == 0 else ""}>{ICONS[k]}<span>{t}</span></a>' for i, (h, k, t) in enumerate(nav))
    return f'''<div class="app">
  <a class="brand" href="#" aria-label="{name}, home">
    <svg class="mark" viewBox="0 0 28 28" aria-hidden="true"><rect class="mk-bg" x="0" y="0" width="28" height="28" rx="7"/><line class="mk-tr" x1="6" y1="10" x2="22" y2="10"/><line class="mk-tr" x1="6" y1="18" x2="22" y2="18"/><circle class="mk-b" cx="10" cy="10" r="2.6"/><circle class="mk-a" cx="18.5" cy="18" r="3.2"/></svg>
    <span class="wm">{name}<small>Western Conference Elitists</small></span>
  </a>
  <nav class="nav" id="nav" aria-label="Sections">{links}</nav>
  <div class="top">
    <button type="button" class="navtog" id="navtog" aria-controls="nav" aria-expanded="true" title="Collapse sidebar ( [ )"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M6 2.5v11"/><rect class="rl" x="2" y="3" width="3.5" height="10"/></svg><span class="vh">Collapse sidebar</span></button>
    <span class="scope">{scope}</span>
    {search}
  </div>
  <main class="main">
    <div class="view">
'''


ICONS = {
    "coaches": '<svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="3"/><path d="M2.5 14.5c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/></svg>',
    "leaders": '<svg viewBox="0 0 16 16"><path d="M2 13.5h12M4 11V7M8 11V3M12 11V5.5"/></svg>',
    "tree": '<svg viewBox="0 0 16 16"><circle cx="8" cy="3" r="1.6"/><circle cx="3.5" cy="13" r="1.6"/><circle cx="12.5" cy="13" r="1.6"/><path d="M8 4.6V8M8 8H3.5v3.4M8 8h4.5v3.4"/></svg>',
}
CLOSE = "    </div>\n  </main>\n</div>\n"
SIDEBAR = "<script>\nvar $=function(s){return document.querySelector(s);};\n" + theme("shared/sidebar.js") + """
function syncTabs(view){document.querySelectorAll('.nav a[data-tab]').forEach(function(t){if(t.dataset.tab===view)t.setAttribute('aria-current','page');else t.removeAttribute('aria-current');});}
function syncFromHash(){var h=location.hash.slice(1);syncTabs(h.indexOf('tree')===0?'tree':h==='leaders'?'leaders':'coaches');}
window.addEventListener('hashchange',syncFromHash);syncFromHash();
</script>
"""


FONTS = re.compile(r'<link [^>]*href="https://fonts.googleapis.com/css2[^"]*"[^>]*>\n')


def nba():
    s = open(os.path.join(PUBLIC, "basketball-coaching-savant.html"), encoding="utf-8").read()
    s = FONTS.sub(lambda m: theme("nba/fonts.html"), s, count=1)
    # the page's old shell: the tab bar, the brand row and the search box move into the frame
    reset = (".wrap{max-width:none;margin:0;padding:0}.top{margin:0;justify-content:flex-start;flex-wrap:nowrap;z-index:60}"
             ".search .results{left:0;right:0;width:auto}.sv-tabs{display:none}\n")
    s = s.replace("</style>", theme("nba/tokens.css", "shared/base.css", "shared/frame.css", "shared/frame-narrow.css", "nba/chrome.css", "shared/coaching-skin.css") + reset + "</style>", 1)
    s = re.sub(r'<nav class="sv-tabs".*?</nav>\n', "", s, count=1, flags=re.S)
    a = s.index('<div class="wrap">\n  <div class="top">')
    b = s.index('  <div class="chips" id="chips"')
    old = s[a:b]
    pills = re.search(r'<span class="eyebrow-pill" id="srcpill">.*?</span><span class="vchip" id="verchip"[^>]*></span>', old).group(0)
    search = ('<div class="search"><svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.5"/><path d="m9.5 9.5 3.5 3.5"/></svg>'
              '<input id="q" type="search" placeholder="Search a head coach or assistant…" autocomplete="off" aria-label="Search a coach"/><div id="results" class="results" hidden></div></div>')
    s = s[:a] + shell("Basketball Coaching Savant", [("#", "coaches", "Coaches"), ("#leaders", "leaders", "Leaders"), ("#tree", "tree", "The tree")], search, "NBA head coaches") + s[b:]
    c = s.index('</div>\n<div id="tip"')
    s = s[:c] + CLOSE + f'<div class="wrap"><p class="foot">{pills}</p></div>\n' + s[c + len("</div>\n"):]
    return s.replace("</body>", SIDEBAR + "</body>", 1)


def football():
    s = open(os.path.join(PUBLIC, "coaching-savant.html"), encoding="utf-8").read()
    s = FONTS.sub(lambda m: theme("football/fonts.html"), s, count=1)
    # the page keeps its own search and header inside the sheet; its few class names that the frame also uses are
    # renamed in this copy so the two do not mix
    i = s.index("<style")
    j = s.index("</style>")
    css = re.sub(r"\.(top|search|results)(?![\w-])", r".f\1", s[i:j])
    s = s[:i] + css + theme("football/tokens.css", "shared/base.css", "shared/frame.css", "shared/frame-narrow.css", "football/chrome.css") + s[j:]
    body0 = s.index('<wce-nav style="display:block;min-height:60px"></wce-nav>\n') + len('<wce-nav style="display:block;min-height:60px"></wce-nav>\n')
    body1 = s.index("<script", body0)
    content = re.sub(r'class="(top|search|results)"', r'class="f\1"', s[body0:body1])
    content = re.sub(r'class="(top|search|results) ', r'class="f\1 ', content)
    s = s[:body0] + shell("Coaching Savant", [("#", "coaches", "Coaches"), ("#tree", "tree", "The tree")], "", "NFL head coaches and play-callers") + content + CLOSE + s[body1:]
    return s.replace("</body>", SIDEBAR + "</body>", 1)


if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for name, f in (("_preview-nba-coaching.html", nba), ("_preview-football-coaching.html", football)):
        open(os.path.join(out, name), "w", encoding="utf-8").write(f())
        print("wrote", os.path.join(out, name))
