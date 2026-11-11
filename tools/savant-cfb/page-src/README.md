# College Football Savant's page sources

`public/college-football-savant.html` is these files, in the order `tools/savant-cfb/assemble.py` lists them,
with college football's own theme (`tools/themes/cfb/`) between them. Edit here, then run

    python3 tools/savant-cfb/assemble.py

Never edit the published page: `npm run check:page-src` fails if it differs from the assembler's output by one byte.

| file | what it is |
|---|---|
| `00-head.html` | doctype, title, description, canonical link |
| `01-style-open.html` | opens the one `<style>` block (the theme's tokens and parts follow, from `tools/themes/cfb/`) |
| `02-page.css` | the page's own layout: hero, card, bars panel, bracket, the All-Savant formation, team page |
| `03-body.html` | closes the style, the site ribbon, the hero, the tabs, season picker and search, the footer (version, What's New, credit, connector link) |
| `04-page.js` | everything the page does: routing by hash, the views, search. Arithmetic is `public/savant-cfb.js`, shared with the connector |
| `05-tail.html` | closes the page |

The design came from the three Design-canvas mockups in `research/cfb/design/` (reference only; their runtime and their invented players do not ship).
