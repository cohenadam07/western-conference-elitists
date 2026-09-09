# Outstanding ideas

Things we've decided are worth doing but haven't built yet. One line of context each so a
future session can pick it up cold. Move an item to the bottom "Done" list when it ships.

## UFC Savant

- **ESPN 3×3 strike matrix.** ufcstats only gives head/body/leg and distance/clinch/ground
  as two separate marginals. ESPN's core API has the full position × target grid per fight,
  plus takedown slams and guard advances (half guard / side / mount / back):
  `sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events?dates=YYYYMMDD` →
  `competitions[].competitors[].statistics` (41 fields, no per-round split). Needs a fight
  matcher (date + both surnames) and a new `mx` field on each window; the strike map then
  becomes a real 3×3 heat grid. Verified reachable from cloud on Sep 9, 2026; the
  `site.api.espn.com` scoreboard endpoint is Akamai-blocked, the core API is not.
- **Chart button per metric** (the fight-by-fight sparkline Football Savant has per season).
  Per-fight values for SLpM, SApM, differential, KD, TD and control are already in each
  fighter's `log`; the button was left out of v1 to keep the row simple.
- **Non-UFC records.** Sherdog has full pro records across promotions (no strike stats).
  Would fix the "pro record" line for fighters whose ufcstats record is stale.
- **Early-era fight time.** ufcstats' own 1990s tournament timing is inconsistent with its
  round data (Royce Gracie's SLpM differs from theirs). Decide whether to trust the round
  data (current) or copy their career rates for pre-1997 fighters.
- **Judges' scorecards.** The `Details` string on decisions carries all three judges'
  scores ("Ben Cartlidge 28 - 29 …"). Parse it for a "robbed / gift" flag and a
  decision-margin metric.

## Done

- UFC Savant v1 — Sep 9, 2026.
- Official rankings + champions in UFC Savant (leaderboard order, profile badge, home chips) — Sep 9, 2026.
- Belts: title reigns with length and defenses on every profile, a Longest Reigns leaderboard preset — Sep 9, 2026.
