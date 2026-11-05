# Data sources and what they let us do

Where every WCE product's numbers come from, and what each source's terms say about charging
money. Written Nov 4, 2026 while scoping WCE Pro and selling to college programs. This is a
map for a lawyer to check, not legal advice. Re-check a source's terms before a paid feature
starts leaning on it.

**Legend.** Green: terms allow commercial use. Yellow: open project, but the upstream data
belongs to someone else. Red: terms bar commercial use, or no permission on file.

## College Basketball Savant

| Field | Source today | Status | Notes |
|---|---|---|---|
| Identity spine (athlete ids), box scores, play-by-play, subs (2025-26 on), lines | ESPN (`espn_cbb.py`) | Red | ESPN's terms bar commercial reuse. ESPN is primary for everything current. |
| On-floor fives (2023-24, 2024-25), shot locations (2022-23 on), rung 3 fallback | CollegeBasketballData (`cbbd_source.py`, `fallback.py`) | Green | Terms (Aug 12, 2026) allow commercial use on every tier, derived outputs and "reasonable portions" in paid products. No raw mirror or bulk download, key server-side only. The pipeline already keeps CBBD out of `public/`. **CBBD is itself built from ESPN** (see `fallback.py`), so it gives us contractual cover, not a different origin. |
| Rung 4 fallback | NCAA.com via the MIT-licensed ncaa-api wrapper | Yellow | Wrapper is MIT; NCAA.com's own terms not reviewed. |
| Birthdates (age pools) | T-Rank public file (`torvik.py`) | Red for paid | Used only as an input, never shown. No permission on file. A paid product needs his OK or another birthdate source. |
| Headshots | ESPN CDN (`heads.py`) | Red for paid | Photos are copyrighted. Initials badge already exists as the fallback. |
| Team ratings, RAPM, xFG, value, positions | Computed by WCE | Ours | Method follows T-Rank's published approach; the numbers are ours. |

Switching the spine from ESPN to CBBD is possible (rung 3 already exists, about 30 calls a
month for daily plays) but costs quality: on the Nov 2 diff, CBBD's fives matched ESPN's exactly
on 77% of plays. Lineups, stints and RAPM would move. Decision pending.

## Football Savant and Coaching Savant

nflverse-data is CC BY 4.0 for nflverse's own work. Many datasets are collected from other
owners, and nflverse cannot license those owners' rights.

| Dataset (nflverse release) | Upstream owner | Status |
|---|---|---|
| `ftn_charting` | FTN Data | Green with conditions: CC BY-SA 4.0, credit "FTN Data via nflverse" required; derived data shared onward must stay CC BY-SA. Credit added Nov 4, 2026 (page pill, connector `source`). |
| `pbp` (incl. nflverse EPA/WP models), `players`, `rosters`, `weekly_rosters`, `schedules`, `depth_charts`, `injuries`, `pbp_participation` | NFL (GSIS) plus nflverse models | Yellow |
| `nextgen_stats` | NFL Next Gen Stats | Yellow |
| `pfr_advstats`, `snap_counts`, `combine`, `draft_picks` | Pro-Football-Reference | Yellow; check Sports Reference terms |
| `espn_data` (QBR) | ESPN | Red for paid |
| `contracts` | OverTheCap | Yellow; check OTC terms |
| `nfl4th` go-boost | nflverse | Green (open) |
| Headshots | NFL CDN (`heads.py`) | Red for paid |
| Live injury status | ESPN API, Sleeper API | Red/Yellow for paid |

## Basketball Savant (NBA)

| Source | Used for | Status |
|---|---|---|
| stats.nba.com via nba_api (32 pipeline files) | Nearly everything current | Red: NBA.com terms bar public or commercial use of its materials |
| Basketball-Reference (`br_*`) | History, awards | Yellow; check Sports Reference terms |
| ESPN (`espn_source.py`, `espn_history.py`) | Gaps, history | Red for paid |
| Sleeper API | Fantasy | Yellow |

WCE Pro's `savant_query` reads Basketball Savant and Football Savant (`api/_query.js`), so it
inherits both tables above. Options for NBA: charge for WCE's models and AI features rather than
raw tables, keep a working fallback, or license an official feed once revenue covers it.

## UFC Savant

ufcstats.com (scrape), ESPN, Wikipedia. Not reviewed; treat as Yellow/Red for paid.

## Cleanest lane for a paid product today

College, if the open decisions above go the clean way (CBBD spine or contractual review of ESPN
use, birthdates replaced or permitted, initials instead of photos).
