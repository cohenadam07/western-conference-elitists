# Two check:savant failures that predate Basketball Savant 2.7.1 / 2.8.0 (Nov 19, 2026)

Both fail on a clean checkout of main (checked Nov 19 on origin/main 0926647163) and after the
2.7.1 / 2.8.0 merges alike; nothing in those merges touches them. Not fixed in that batch (Adam).

## 1. "the usage log: counts only, one command a write, capped, and never in the way"

`tools/savant-mcp/check.mjs` ~line 674: `assert.equal(store.commands - before, 1)` sees 2.

What's broken: the test, not the usage log. `api/_usage.js` `readUsage()` reads one month per
store command, every month from `FIRST_MONTH = '2026-10'` to today. The test was written on
Oct 2, 2026, when that was one month; since Nov 1 it is two, so the hard-coded 1 fails, and it
will be 3 in December. The code does what its comment says ("one command a month").

Fix when picked up: expect the number of months between FIRST_MONTH and the test's `now`
(or pass `from`/`now` to readUsage so the test pins one month).

## 2. "search finds players the way people type their names" (Football Savant)

`tools/savant-football/check.mjs` ~line 1023: `first('Audric Estime')` returns `Audric Estime`,
the test expects `Audric Estimé`.

What's broken: the display name, not the search. The search is accent-insensitive and still finds
him. But the archive (public/football-savant-data.json) spells him "Audric Estimé" while the 2026
in-season file (public/football-savant-current.json, the weekly refresh) spells him "Audric
Estime", and search shows a player's newest season's spelling. So the in-season source drops the
accent, and the card, search and connector now show the unaccented name for 2026.

Fix when picked up: carry a player's accented name forward from the archive when the in-season
source gives the same name without diacritics (or normalise the refresh to the archive's
spelling), rather than loosening the test.
