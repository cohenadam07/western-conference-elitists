"""assemble.py — public/college-basketball-savant.html from the prototype's Framed sheet CSS, the extra
rules and page.js. Run after editing any of them."""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", "..")
proto = open(os.path.join(ROOT, "design", "college-basketball-savant-prototype.html")).read()
css = proto[proto.index("<style>\n/* Layout"):]
css = css[len("<style>\n"):css.index("</style>")]
# the two directions Adam did not pick, and the review chrome
drop = re.compile(r"^(html\.dir-(ledger|terminal).*|\.dirbar.*)$", re.M)
out, skip = [], 0
for line in css.split("\n"):
    if skip:
        skip += line.count("{") - line.count("}")
        continue
    if line.startswith(("html.dir-ledger", "html.dir-terminal")) and line.count("{") > line.count("}"):
        skip = line.count("{") - line.count("}")
        continue
    if drop.match(line) or "shell: achromatic ledger" in line or "shell: data terminal" in line or "the direction switch is review" in line or "ledger: value before the bar" in line or "terminal: denser" in line:
        continue
    out.append(line)
css = "\n".join(out)
kept = []
for line in css.split("\n"):
    m = re.match(r"^(\s*)([^{}@]+)\{(.*)$", line)
    if m and "dir-" in m.group(2):
        sels = [x.strip() for x in m.group(2).split(",") if "dir-ledger" not in x and "dir-terminal" not in x]
        if not sels:
            continue
        line = m.group(1) + ",".join(sels) + "{" + m.group(3)
    if ".dirbar" in line:
        continue
    kept.append(line)
css = "\n".join(kept)
css = css.replace("html.dir-framed", "html")
css = re.sub(r"--meta-bg[^;]*;--meta-fg[^;]*;--meta-on[^;]*;--meta-on-bg[^;]*;", "", css)
css = css.replace("min-height:calc(100vh - 44px)", "min-height:100vh")
css += "\n" + open(os.path.join(HERE, "extra.css")).read()
js = open(os.path.join(HERE, "page.js")).read()
mark = re.search(r'<svg class="mark".*?</svg>', proto, re.S).group(0)
html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>College Basketball Savant: every D1 player, on percentile bars | Western Conference Elitists</title>
<meta name="description" content="Baseball Savant-style profiles for every men's Division I player: opponent-adjusted percentiles, shot zones, RAPM, lineups and team ratings, refreshed after every night of games.">
<link rel="canonical" href="https://wcehoops.com/college-basketball-savant.html">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,600&display=swap">
<style>
{css}
</style>
</head>
<body>
<div class="app">
  <a class="brand" href="#home" aria-label="College Basketball Savant, home">
    {mark}
    <span class="wm">College Basketball Savant<small>Western Conference Elitists</small></span>
  </a>
  <nav class="nav" id="nav" aria-label="Sections">
    <a href="#home" data-k="players" title="Players"><svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="3"/><path d="M2.5 14.5c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/></svg><span>Players</span></a>
    <a href="#teams" data-k="teams" title="Teams"><svg viewBox="0 0 16 16"><path d="M8 1.5 13.5 4v4.2c0 3-2.3 5.3-5.5 6.3-3.2-1-5.5-3.3-5.5-6.3V4z"/></svg><span>Teams</span></a>
    <a href="#leaders" data-k="leaders" title="Leaders"><svg viewBox="0 0 16 16"><path d="M2 13.5h12M4 11V7M8 11V3M12 11V5.5"/></svg><span>Leaders</span></a>
    <a href="#compare" data-k="compare" title="Compare"><svg viewBox="0 0 16 16"><path d="M5.5 2v12M10.5 2v12M2 5.5h3.5M10.5 10.5H14"/></svg><span>Compare</span></a>
  </nav>
  <div class="top">
    <button type="button" class="navtog" id="navtog" aria-controls="nav" aria-expanded="true" title="Collapse sidebar ( [ )"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M6 2.5v11"/><rect class="rl" x="2" y="3" width="3.5" height="10"/></svg><span class="vh">Collapse sidebar</span></button>
    <span class="scope" id="scope">Men's Division I</span>
    <div class="search">
      <svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.5"/><path d="m9.5 9.5 3.5 3.5"/></svg>
      <label class="vh" for="q">Search players and teams</label>
      <input id="q" type="search" placeholder="Search players and teams" autocomplete="off">
      <ul class="results" id="res" hidden></ul>
    </div>
  </div>
  <main class="main">
    <div class="view" id="view"><p class="empty">Loading…</p></div>
    <div id="home"></div>
    <div class="wrap"><p class="foot"><span id="ver"></span> · New: College Basketball Savant, every men's D1 player since 2022-23. Data: ESPN, CollegeBasketballData and NCAA.com; team ratings follow T-Rank's published method and are computed by WCE. Some birthdates come from T-Rank's public player file. Model outputs are the model's view, not a verdict. <a href="/#ai">Ask it in Claude with the WCE connector</a>. <a href="/">Western Conference Elitists</a></p></div>
  </main>
</div>
<script src="/savant-cbb.js"></script>
<script>
{js}
</script>
</body>
</html>
"""
open(os.path.join(ROOT, "public", "college-basketball-savant.html"), "w").write(html)
print(len(html))
