# College Basketball Savant: page source

| file | what |
|---|---|
| `00a-head.html` | doctype to the font link |
| *(theme)* `college/fonts.html` | the Google Fonts link |
| `00b-head.html` | the opening `<style>` |
| `01a-prototype.css` | the note on the Framed sheet design |
| *(theme)* `college/tokens.css` | the tokens: colour, scale, type, spacing, bars |
| *(theme)* `shared/base.css` | base rules |
| *(theme)* `shared/frame.css` | the frame: brand, top bar, search, collapsible sidebar, sheet |
| `01c-blocks.css` | cards, percentile rows, tables, KPIs, tabs, charts, and the phone layout |
| `02-starting-five.css` | the starting-five card row, as copied once from Basketball Savant's page |
| `03-extra.css` | College Savant's own rules (1.0 to 1.3: shot charts, play context, rotation maps) |
| `04-body.html` | the end of the style, the shell (nav, search, the views' mount points, the footer), the script tags |
| `05a-page.js` | the page's script up to the sidebar (with 1.3.0's play context and 1.4.0's coach links) |
| *(theme)* `shared/sidebar.js` | the sidebar's collapse button, `[` shortcut and remembered state |
| `05b-page.js` | the rest of the script |
| `06-tail.html` | the closing tags |

The *(theme)* rows live in `tools/themes/` (its README), shared with College Basketball Coaching Savant, and are
listed in `ORDER` as `theme:<path>`. They were cut from this page's own files on Nov 6, 2026 without changing a
byte of the published page, so changing one changes both pages: run both assemblers.

**History (Nov 6, 2026).** The old assembler built the CSS by filtering the design prototype and cutting an excerpt
out of the live `public/basketball-savant.html`, so an edit to Basketball Savant's page could change this page.
1.3.0 and 1.4.0 were then edited straight into the published page, and running the old assembler would have dropped
them (it was 82,973 bytes against the published 116,962). The files here were cut from the published page, so the
assembler now reproduces it exactly and depends on nothing outside this folder. The prototype filtering is in git
history (`tools/savant-cbb/page-src/assemble.py` before Nov 6, 2026) if it is ever needed again.

## The rule

**Edit the files here, then run the assembler. Never edit `public/college-basketball-savant.html` directly.**

    python3 tools/savant-cbb/assemble.py        # writes public/college-basketball-savant.html

The page is these files concatenated in the order `assemble.py` lists (`ORDER`), byte for byte, nothing added.
`npm run check:page-src` (first in `npm run check:savant`) runs the assembler to a temp file and fails if the
published page differs from it by a single byte, or if this folder holds a file the assembler does not read.
If the published page has to be fixed in a hurry, make the same change here in the same commit.
