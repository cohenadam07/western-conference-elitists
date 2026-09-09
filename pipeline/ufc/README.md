# UFC Savant pipeline

Builds `public/ufc-savant.html`'s two data files from ufcstats.com, the public face of
the official FightMetric feed. Runs from GitHub Actions
(`.github/workflows/ufc-savant-refresh.yml`, Monday and Wednesday mornings ET) — ufcstats
answers cloud IPs, so nothing here needs your Mac.

```
scrape.py      ufcstats.com -> raw/{events,fights,fighters}.jsonl.gz + raw/upcoming.json
headshots.py   ESPN athlete ids for images -> raw/headshots.json
metrics.py     the metric table (label, panel, layer, unit, threshold, era, explanation)
build.py       raw -> public/ufc-savant-data.json (fighters × windows) + ufc-savant-fights.json
```

## Run it by hand

```
pip install -r requirements.txt
python3 scrape.py            # incremental: new events + fighters touched by them (~1 min)
python3 scrape.py --full     # everything, ~14k pages, ~20 min at 6 workers
python3 headshots.py         # only asks ESPN about fighters it has never asked about
python3 build.py             # ~20 s
```

## How it is put together

**Keys.** Everything is keyed on ufcstats' 16-hex ids (fighter, fight, event). Never on
names — the fighter index has duplicates.

**The anti-bot check.** Since 2026 ufcstats front-loads a JavaScript proof-of-work
("Checking your browser…"): SHA-256 of `nonce:n` must start with Z zeros, then
`POST /__c`. `scrape.Session.solve()` handles it in milliseconds and the resulting `_fmc`
cookie lasts seven days. If the site ever changes the challenge, every request will come
back as that page and the parsers will find nothing — `scrape.py` will report every page as
a failure rather than writing empty rows.

**Windows.** A fighter has no season. `build.py` aggregates each fighter's fights into three
windows — `career`, `l5`, `l3` — and emits one metric row per window. The page ranks each
window against the same window of the comparison group.

**Divisions.** A window's division is the modal weight class of the fights in it (most
recent on ties). Title fights ("UFC Lightweight Title") and catchweights map through
`metrics.division_of`.

**Eras.** Control time is 0% populated before 1999 and 100% from 2000, so control metrics
only sum fights from 2000 on, and are absent when a window has none. Twenty-one 1990s
fights have no strike data at all (`stats: false`) and count only toward records, minutes
and Elo.

**Fight time.** From the round format: `3 Rnd (5-5-5)` + round 2 at 3:10 = 8:10. Early
"No Time Limit" cards use the recorded time.

**Elo.** K = 32, ×1.25 for a finish, every UFC fight in date order, 1500 to start. The
pre-fight rating of each man is stored on the fight (`f[i].elo`) so the log and the
strength-of-schedule metric can use "as he was that night".

**Percentiles** are not computed here — the page does that in the browser against whatever
pool the reader picks (division / everyone × active / all-time × cage-time band).

**Comps** are computed here, per division and window, as mean absolute percentile distance
across the `HEADLINE` dimensions (weakness comps use `WEAK_DIMS`, hinged at the median).

## Verified against ufcstats

Career rates for modern fighters match the ufcstats fighter page to the rounding it shows
(Hooker 4.82 / 4.94 / 0.67 / 33% / 77%; Jones 4.38 / 2.24 / 1.89 / 95%; Holloway 6.92 /
4.60). Royce Gracie-era numbers differ because ufcstats' own fight-time accounting for the
1990s tournaments is inconsistent with its round data; ours uses the round data.

## Not in v1

- The 3×3 position × target strike matrix (ESPN's core API has it per fight; ufcstats
  only gives the two marginals). `sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events?dates=YYYYMMDD`
  → `competitions[].competitors[].statistics`.
- Rankings / champion status (octagon-api.com `/rankings` is a free mirror of UFC.com's).
- Non-UFC fights.
