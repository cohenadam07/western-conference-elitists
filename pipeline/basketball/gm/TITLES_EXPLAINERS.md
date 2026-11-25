# GM Savant 1.1.0 — the new explainers, for review

Eleven new tap-to-explain entries (no existing entry changed). Numbers in **bold** are filled from the build, not typed, so a refit updates them.

## Blended  (`blended`)

**What it is.** One number for a GM that counts both the good teams he built and the titles those teams were in position to win.

**How it's calculated.** GM Value Added in points, plus expected titles added times **4,746** points. At that rate the two halves spread GMs out equally across every GM spell since 1979-80, so neither drowns out the other. The slider changes the rate, from wins only to titles only.

**The data.** GM Value Added and expected titles added, both from the same luck-adjusted team strength.

**Limits.** The rate is a choice, not a measurement: it says how much a title is worth against regular-season strength, and reasonable people differ. Move the slider to see how much the order depends on it.

## The blend, and the slider  (`lambda`)

**What it is.** How many points one expected title is worth in the blend.

**How it's calculated.** The default, **4,746** points a title (about **150** wins), is set so that points and titles each account for half of the spread across every GM spell. The slider runs from wins only (points alone) through the default in the middle to titles only (expected titles added alone). Each position in between is a different rate, shown beside it.

**The data.** Every GM spell in GM Savant, finished and active.

**Limits.** Percentiles on the board follow the slider: they rank the number you are looking at, against the pool named above the table.

## Expected titles added  (`titles_added`)

**What it is.** GM Value Added counted in titles instead of points: how many more titles his teams were in position to win than an average GM in his seat.

**How it's calculated.** Three parts, as in the points. While he ran the team: each season's title chance minus an average team's share (one divided by the number of teams), times his share of the season. Plus the titles of the roster he left, minus those of the roster he inherited: for each later season, those players' share of the team's player value times the team's title chance, ten seasons ahead, each 5% less than the one before. Finished tenures as it turned out, active ones on projection.

**The data.** Every season since 1979-80 simulated on its real schedule, seeding, play-in and bracket (**1979-80 to 2025-26**), from the luck-adjusted strength the points use; for seasons not yet played, a curve of title chance against projected strength fit on earlier seasons.

**Limits.** A title chance is the model's, not hindsight: it does not know who got hurt in May. An average team's chance is well below its share, because titles go to the best teams, so GMs of average teams come out a little below zero. Salaries are not in it yet.

## Titles while he ran it  (`titles_produced`)

**What it is.** How far his teams' title chances were above an average team's, season by season, added up.

**How it's calculated.** For each season: the team's title chance minus one divided by the number of teams, times the share of the season he was in charge. The season in progress counts at today's projected chance for the games played so far.

**The data.** The title model: every season replayed thousands of times from each team's luck-adjusted margin.

**Limits.** A bad team and a lottery team count alike (both near zero chance), so tanking well and tanking badly look the same here; the points tell them apart.

## Titles left behind and inherited  (`titles_left`)

**What it is.** The titles that the roster and picks on the books were in position to win over the next ten seasons, on his last day (left behind) and his first (inherited).

**How it's calculated.** For each later season: those players' share of the team's player value times the team's title chance that season, each season 5% less than the one before. As it turned out for a finished tenure; on projection (the projected roster against the league that day) for an active GM and for the at-the-time version.

**The data.** The transaction ledger, Savant player value, our projections and the title model.

**Limits.** Like the points, hindsight cuts both ways: inheriting a young star who became a champion counts against a GM, and leaving one counts for him. A player who left in free agency before playing for the next GM counts for neither.

## Expected titles added, at the time  (`titles_at_time`)

**What it is.** The same sum, with what he inherited and left valued as they could be seen on the day.

**How it's calculated.** Each roster's projected strength against the league that day, put through the title curve fit only on seasons that had finished by then.

**The data.** Point-in-time projections and title curves; nothing later is read (the leakage test deletes every later season and gets the same numbers).

**Limits.** Projections a few seasons out say little about titles, so most of the at-the-time value sits in the next two seasons.

## Titles won  (`titles_won`)

**What it is.** Championships his teams won while he ran them.

**How it's calculated.** One for each title, times his share of that season (a title split with a co-lead, or a season he took over midway, counts in part).

**The data.** The NBA Finals results, 1979-80 on.

**Limits.** Shared credit splits a title the same way it splits points.

## Expected titles  (`titles_expected`)

**What it is.** How many titles his teams should have won, given how good they were, in the seasons he ran them.

**How it's calculated.** Each season's title chance from the model, times his share of that season, added up. Played seasons only, the same seasons as titles won.

**The data.** The title model, checked out of sample: predicted and actual titles agree by bucket, and it beats "the best record wins" by **34**% on Brier score.

**Limits.** The model rates a team by its regular season. A team that got healthy, or added a star at the deadline, will look worse than it was in the playoffs.

## Playoff luck  (`playoff_luck`)

**What it is.** Titles won minus expected titles: what the bounces, injuries and matchups of the playoffs gave him or took away.

**How it's calculated.** Titles won minus expected titles, over the same seasons.

**The data.** The title model and the Finals results.

**Limits.** It sits with the other luck and is not part of expected titles added. Some of it is not luck: a team built for the playoffs could beat its regular-season rating. We tested one version of that (value concentrated in the top seven or eight players) and it did not hold up.

## A decision's expected titles  (`dec_titles`)

**What it is.** How many titles a decision added, or cost, through the teams it made better or worse.

**How it's calculated.** The decision's points in each season times what a point was worth in titles to that team that season, ten seasons ahead at 5% a year. A point is worth most to a contender and little to a team far from one: it is the team's title chance above an average team's, divided by how far its strength was above average, which shares out the team's expected titles across everything it did and adds up exactly. At the time, the same with the projected title curve as of the day.

**The data.** The decision's grade, season by season, and the title model.

**Limits.** A move that weakened the team is costed at the weaker team's rate, so trading a star away from a team that then fell apart costs fewer titles than the star would have won there. Coach and re-signing grades follow the same rule on their own scale.

## A decision, blended  (`dec_blended`)

**What it is.** The decision's points plus its expected titles at the default rate.

**How it's calculated.** How it turned out, in points, plus expected titles as it turned out times **4,746**.

**The data.** The two grades beside it.

**Limits.** The rate is the GM-level default; a single decision is not ranked on it.
