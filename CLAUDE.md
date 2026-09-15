# Western Conference Elitists — working notes

Vite 8 + React 19 + React Router 7 + Tailwind 4, deployed on Vercel. A pure SPA:
`vercel.json` rewrites everything except `/api/` to `index.html`, so a new route is a
line in `src/App.jsx`. Serverless functions live in `api/`, backed by Upstash Redis
(Vercel KV) and degrading to `{ configured: false }` when KV is absent.

Most of the recent work is **Front Office**, the NBA GM game at `/gm`.

## Front Office — the map

| where | what |
|---|---|
| `src/pages/GM.jsx` | the route. ~5,500 lines; every screen except the ones below |
| `src/components/gm/` | Shell, GameCast, League, History, BoxScore, LotteryNight, DraftCard, Dismissal, Celebration, ui |
| `src/lib/gm/` | ~42 engine modules — see below |
| `src/lib/gm/seed.js` | 380KB generated data: 30 teams, 470 real contracts, CBA constants, projections, calibration |
| `tools/gm/` | tests, the headless play-through, the cross-runtime check |
| `api/gm.js` | server saves and the all-time boards |
| `~/Basketball-Savant` | the Python side that generates the seed, and `sim_engine.py` |

## Four constraints that are not obvious from the code

**1. `sim.js` must stay byte-identical with its Python twin.** `~/Basketball-Savant/sim_engine.py`
is the same engine, and `node tools/gm/verify.mjs` checks 30 fixtures across both runtimes.
Anything that changes the number or order of RNG draws inside `simulate()` breaks it. Work
around it the way form, wear, morale and injuries do: transform the profiles *before* handing
them to the engine, never inside the possession loop.

**2. The server verifies a claimed season by replaying it.** `api/gm.js` imports `playNext`
and re-simulates from the seed, which is what makes the leaderboard a verifiable claim rather
than typed numbers. So anything that affects results must live inside the shared season loop
and be driven by the season seed — not in the React layer.

**3. Draws are per-man, in id order, always.** `dressed()` and the injury roll both spend a
fixed number of draws per player regardless of outcome. Making a draw conditional, or
iterating in roster order, desynchronises the two runtimes on the very next number.

**4. Two conservation rules, both added because nothing enforced them.**
`MAX_SEASON_MPG = 42` and `conserveMinutes` (a roster's top ten holds to 264 minutes, which is
what the thirty real rosters actually sum to). `vorpFrom(bpm, mpg)` is the single place
anything decides what a created player is worth — derived from the real contracts at R² 0.91,
not typed.

## Commands

```
npm run build                          # production build
npm run lint                           # oxlint
node tools/gm/<name>.test.mjs          # 20 suites; injury, history, sim, career, trade, year…
node tools/gm/verify.mjs               # cross-runtime determinism, 30 fixtures
node tools/gm/soak.mjs                 # 42 invariants over 40 seasons
node tools/gm/league-health.mjs        # league talent over a long career (a measuring instrument)

npx vite build --config tools/gm/vite.smoke.config.mjs   # build the headless harness first
node tools/gm/smoke.mjs                                  # then play the game through jsdom, 97 checks
```

`smoke.mjs` needs `jsdom`, which is not a dependency — `npm i --no-save jsdom`.

## How this codebase works on itself

Three habits are all over the comments and they are worth keeping:

- **Measure, don't tune.** Constants are solved against real data and the derivation is written
  down next to them. Where something could not be measured, the comment says so.
- **Record the negative results.** Several comments exist only to say that a plausible idea was
  tested and was not there. That has saved re-litigating them more than once.
- **Bugs get found by playing it, not by unit tests.** A long list of real defects — a tie
  recorded as a loss, the alphabet setting pick value, twelve players named Kearns, a memo that
  computed once on an empty accumulator — were all caught by `smoke.mjs` or by looking at a
  screen. Every engine passed in isolation the whole time. Run the smoke walk.

## State as of 2026-09-15

On branch `front-office`, last commit `904fa9d`. **Uncommitted and complete**: an injury
system, a statistical archive and league screens, and a fix for league-wide talent erosion.
See the first thing to do, below.

Everything green except `career.test.mjs` at 36/41, deliberately. Two open defects:

**Concentration.** The best team wins 81–82 in late career seasons against a bound of 78. The
record is 73, so the bound is right and was left failing rather than moved. League *mean*
talent is now flat, but the median falls 11.3 → 8.7 while the best rises 19.4 → 28.2. Two
mechanisms are ruled out by measurement: free agency (everyone gets signed, every year) and
young players developing faster on good teams (aging is strongly *equalising* — the weakest ten
teams gain 17 VORP while the strongest ten lose 17, because bad teams carry nearly twice as
many under-23s and play them more). Untested: where players land — free-agency destinations and
roster refill. A bad team whose cheap deals expire gets topped up with replacement-level filler
worth nothing, which would push the median down while leaving the mean and the top untouched.

**Six of ten control-surface domains still do nothing.** `DOMAIN_STATUS` in `modes.js` declares
which dials are `routed`, `yours` or `planned`, so the interface no longer lies about it, but
`extensions`, `finances`, `tactics` and `two_way` have no system behind them.

The design history — audits, calibration notes, every previous session's findings — lives in
the claude.ai project "Western Conference Elitists + Basketball Savant", not in this repo.

## Housekeeping

`.smoke/`, `_to_delete/` and `distcheck` output are untracked scratch and should probably go in
`.gitignore`. `_to_delete/gm-scratch/` holds throwaway probes from the erosion investigation and
can be deleted.
