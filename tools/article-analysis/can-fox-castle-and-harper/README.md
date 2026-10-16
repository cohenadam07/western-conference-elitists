# Analysis behind "Can Fox, Castle and Harper Actually Start Together?"

These are the scripts that produced the numbers, chart data and body of the rich article at
`public/articles/can-fox-castle-and-harper-actually-start-together/`. They're kept here so the
work can be rerun or extended. They are not part of the site build.

The scripts were written in a cloud workspace. Paths are absolute (`/home/claude/spurs-article/...`),
so point them at your own folder before rerunning.

## Order
1. `pull_spurs.py` runs **on the Mac**, because stats.nba.com blocks cloud IPs. It writes raw nba_api JSON to `nba/spurs-article-data/`:
   - lineups for 2 to 5 players (regular season and playoffs)
   - on/off splits
   - player and team game logs, including the preseason
   - passing, defender distance and league tracking
   - Synergy play types
   - defensive matchups
   - play-by-play for 109 games
2. `data/tidy.py` turns Basketball Savant player-seasons into `data/ps.pkl`. It needs the site's `savant-data` files.
3. The study scripts in `data/`:
   - `shoot.py` and `shoot2.py`: hot-streak study
   - `ftprior.py`: free-throw prior, written to `ft_prior.json`
   - `proj.py`: projection model, written to `proj_model.json`
   - `skill.py`: how usage trades against true shooting, plus the within-player assist and turnover study
   - `tovres.py` and `asttov.py`: turnover regression
   - `lu_spacing*.py`: usage and spacing regressions over league lineups
4. Builders in this folder write `out/*.json`:
   - `lineups.py`
   - `gamelogs.py`
   - `tracking.py`
   - `respect.py`
   - `playtypes.py`
   - `lobs.py`
   - `matchups.py`
5. `export.py` writes the chart data in `export/*.json`. `article.py` writes `export/body.json`.
6. Copy `export/body.json` and `export/*.json` into `public/articles/<slug>/` (the data files go in `data/`), then run `npm run publish-rich-article -- <slug>`.
7. `shoot.py` (QA) screenshots every figure at a given width. Run it at 1280 and 390.

## Definitions used throughout
- **Luck adjustment.** Opponent 3P% and FT% are reset to the league average (35.96% and 78.29%).
- **Sample adjustment.** `est = (n·adj + k·team) / (n + k)`.
  - k is 843 for five-man units, 954 for four-man, 1,079 for three-man and 1,221 for pairs.
  - The team figure is +7.61.
- **"Last 25 games"** means Basketball Savant's window: the team's last 25 regular-season games.

`factcheck_report.md` is the independent check. Every error it lists has been corrected, in the commit "Spurs article: fact-check corrections".
