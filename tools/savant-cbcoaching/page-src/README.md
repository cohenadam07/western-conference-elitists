# College Basketball Coaching Savant: page source

Files `01` to `06` are Basketball Coaching Savant's page source as copied on Nov 6, 2026, with small in-place edits
(the 40-minute clock and halves, College Savant player links, the college headline rows). `07-college.js` redefines
the functions that differ in college (in one script the last declaration of a name wins) and adds the college-only
sections (roster building, the NCAA Tournament, resources, similar players). `09-tail.html` starts the page.

**Known (Nov 6, 2026).** The copy was taken from Basketball Coaching Savant's source before its site ribbon (#39) was
brought into it, so this page has no `wce-nav` ribbon and still carries two extra tab links. Adding the ribbon is a
visible change, left for its own decision.

## The rule

**Edit the files here, then run the assembler. Never edit `public/college-basketball-coaching-savant.html` directly.**

    python3 tools/savant-cbcoaching/assemble.py        # writes public/college-basketball-coaching-savant.html

The page is these files concatenated in the order `assemble.py` lists (`ORDER`), byte for byte, nothing added.
`npm run check:page-src` (first in `npm run check:savant`) runs the assembler to a temp file and fails if the
published page differs from it by a single byte, or if this folder holds a file the assembler does not read.
If the published page has to be fixed in a hurry, make the same change here in the same commit.
