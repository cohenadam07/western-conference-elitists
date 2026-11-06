# Basketball Coaching Savant: page source

`01-head.html` (the head, the CSS and the body's shell), then the script in six parts: `02-core.js` (formatting, the
tooltip, routing, home, leaders, search), `03-coach.js` (the coach page and card rows), `03b-career.js` (the career
chart), `04-season.js` (the Rotation Map, pairs, quadrant, minutes vs impact), `05-sections.js` (management, splits,
shot diet, play types, arrival, development, staff, seasons), `06-tree.js` (comps, fingerprint, the tree, and the
closing `init()` and tags).

**History (Nov 6, 2026).** There was no assembler, only "concatenate in order", and the site ribbon (`wce-nav`, #39)
was edited into the published page only, so concatenating these files dropped it and restored two old tab links.
`01-head.html` was brought up to date and `assemble.py` added.

College Basketball Coaching Savant's page (`tools/savant-cbcoaching/page-src`) began as a copy of these files on
Nov 6, 2026, before that fix; it is a separate copy, and a change here does not reach it.

## The rule

**Edit the files here, then run the assembler. Never edit `public/basketball-coaching-savant.html` directly.**

    python3 tools/savant-bcoaching/assemble.py        # writes public/basketball-coaching-savant.html

The page is these files concatenated in the order `assemble.py` lists (`ORDER`), byte for byte, nothing added.
`npm run check:page-src` (first in `npm run check:savant`) runs the assembler to a temp file and fails if the
published page differs from it by a single byte, or if this folder holds a file the assembler does not read.
If the published page has to be fixed in a hurry, make the same change here in the same commit.
