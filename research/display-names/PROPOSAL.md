# A shared display-name map, keyed by player ID (proposal only, not built)

Nov 19, 2026. Basketball Savant 2.8.1 keeps accents in the Savants' own files (pipeline/accents.py),
but three other products still show the unaccented spellings ESPN and their own sources give them:
Basketball Coaching Savant, the Dynasty board and the news page. This is what a shared map would take.

## The map

One small file per sport, e.g. `public/names/nba.json`: `{ "<player id>": "<display name>" }`, built
from the Savant archive and current season with `accents.canonical` (the accented spelling wins when
it is otherwise the same letters). Written by the Basketball Savant build and the nightly refresh,
so it moves with them; under 100 KB for the NBA (~5,000 ids). The rule stays in one place
(pipeline/accents.py); the map is its output, and every consumer reads names from it by ID instead of
from its own source.

## Each consumer

| Product | Where its names come from | Keyed by NBA id? | Work |
|---|---|---|---|
| Basketball Coaching Savant | ESPN rotation and stint data, written by pipeline/basketball/coaching/build.py (`public/bcs/data/*`, 289 files carry one of the 15 repaired names) | Yes: every rotation row has `pid` next to `name` | Small: look the name up in the map at build time; the stints' five-man lineups already carry ids. The Coaching Savant page and connector need no change. |
| Dynasty board | `public/dynasty/players.json`, seeded once by build_dynasty_seed.py | **Yes, for the board itself**: crowd ratings are stored by NBA id (`ZADD … String(p.id)` in api/dynasty.js) | Small: the display name comes from the seed file; refresh its `name` from the map (or have api/dynasty.js read the map). Votes are unaffected because they never use names. |
| Dynasty seed (one-time) | Hashtag Basketball's rankings, joined to our players **by name** (`norm()` + an `ALIASES` table) | No: name join | None needed for display. The join already strips accents (`norm`), so an accented map can't break it. |
| Fantasy-league valuation (`nba_fantasy_league`) | A person's Sleeper / ESPN / Fantrax roster, matched to the board **by name** (api/_fantasy.js `norm()`, which strips accents with NFD) | No: by name | None for matching: accent-insensitive already. Its output names would come from the board, so they would follow the map. |
| News | `public/news.json`: each headline's `players` tags are `{name, savant_url}`, the id in the URL (pipeline/news/players.py) | Yes, via the URL | Small: tag names from the map. The headline text is the outlet's own words and stays as written. |

## Risks and decisions

1. One source of truth means one failure mode: if the map is missing, consumers must fall back to
   their own name (never a blank).
2. Order of builds: the map has to be written before Coaching Savant and news build, or they read
   yesterday's. Both already run after the Basketball Savant refresh.
3. The Dynasty board's ALIASES table is for real identity mismatches (Alexandre/Alex Sarr) and stays.
4. Other sports would get the same file when they need it; Football Savant's only consumers are its
   own page and connector, which 2.8.1 already fixed.

Estimate: one map writer (a few dozen lines, reusing accents.py), three small consumer changes and a
check that every consumer's displayed name equals the map's for the same id.
