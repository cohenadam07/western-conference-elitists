# College Basketball Coaching Savant: page source

**In the college theme (Nov 6, 2026).** The page reads College Basketball Savant's look from `tools/themes/`
(listed in `ORDER` as `theme:<path>`): its fonts, tokens, base rules, framed sheet with the collapsible sidebar,
the frame's phone rules, and `shared/coaching-skin.css`, which paints this page's components in the theme. The
site ribbon (`wce-nav`) sits above the frame; the old tab bar and its two cross-links are gone (the sidebar holds
Coaches, Leaders and The tree; the footer credits College Basketball Savant).

| file | what |
|---|---|
| `01a-head.html` | doctype to the font link |
| `01b-style.html` | the opening `<style>` and the note on how the CSS is layered |
| `01c-coaching.css` | the coach-page components: Basketball Coaching Savant's CSS as copied on Nov 6, 2026, less its own tokens, tab bar, brand row and search box (the frame has those) |
| `01d-body.html` | the ribbon, the frame (brand, sidebar, top bar with search), the views' mount points, the footer, and the script's first lines (`$`, which `shared/sidebar.js` needs) |
| `02-core.js` to `06-tree.js` | Basketball Coaching Savant's page script as copied on Nov 6, 2026, with small in-place edits (the 40-minute clock and halves, College Savant player links, the college headline rows, the sidebar's current section, a unit after every value) |
| `07-college.js` | redefines the functions that differ in college (in one script the last declaration of a name wins) and adds the college-only sections (roster building, the NCAA Tournament, resources, similar players) |
| `09-tail.html` | starts the page |

Every value prints with its unit: `fmt(stat, v)` and `valHTML(stat, v)` (02-core.js, 03-coach.js) read the stat's
`u` from the registry (`pipeline/college/coaching/config.py`, `U`).

## The rule

**Edit the files here, then run the assembler. Never edit `public/college-basketball-coaching-savant.html` directly.**

    python3 tools/savant-cbcoaching/assemble.py        # writes public/college-basketball-coaching-savant.html

The page is these files concatenated in the order `assemble.py` lists (`ORDER`), byte for byte, nothing added.
`npm run check:page-src` (first in `npm run check:savant`) runs the assembler to a temp file and fails if the
published page differs from it by a single byte, or if this folder holds a file the assembler does not read.
If the published page has to be fixed in a hurry, make the same change here in the same commit.
