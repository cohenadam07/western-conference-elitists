# GM Savant: the explainers changed this round

As the page shows them, with every number filled in from the build. New entries are marked (new).

## Percentile

**What it is.** Where his GM Value Added ranks among every GM spell of two or more seasons since 1979-80 (or among active GMs, on the second bar).

**How it's calculated.** The share of spells with a lower number. 50th is the middle; 90th means he beat nine in ten.

**The data.** Every ranked spell in GM Savant; the pool is named on the bar.

**Limits.** A spell is one person at one team, so a GM who ran two teams has two ranks. Skills have no percentile. No skill repeats as it turned out; at the time, drafting does, which says GMs keep agreeing or disagreeing with the boards, not that their picks keep beating them; holding and re-signing pass some tests but not both splits, and re-signing likely reflects having stars to re-sign (see How it works).

## Inherited

**What it is.** The value of the roster and picks he was handed on his first day.

**How it's calculated.** As Left behind, on his first day. Subtracted, so a GM is not credited for talent that was already there. When what he took over is at least twice everything else in his number combined (his production and what he left), the card names the inherited players who made up most of it.

**The data.** As Left behind.

**Limits.** Before 1980 the ledger starts from the 1979-80 rosters, so GMs already in office then are marked early era.

## Inherited and left behind, player by player

**What it is.** The players and picks behind the Inherited and Left behind numbers.

**How it's calculated.** Each asset's value on that day on the headline's basis, ten seasons ahead at 5%: for a finished tenure, what the team got from it (its production for the team, then what it was traded for; a pick at its slot once used); for an active GM, our models' projection. The biggest fourteen shown.

**The data.** As Inherited and Left behind.

**Limits.** Players who left in free agency before a game for the next GM are left out. The at-the-time figures, as projected on the day, are in the At the time numbers.

## Lottery luck

**What it is.** How much the draft lottery helped or hurt him with his own first-round pick.

**How it's calculated.** The value of the slot his pick landed in, minus the average value of the slots his pre-lottery odds gave him. The windfall of landing a top pick stays here: taking the obvious player with it earns little under Drafting.

**The data.** The NBA's lottery odds in force each year (from 1985), our pick-value curve.

**Limits.** Only his own pick; picks owed to him by other teams are not counted here.

## Drafting

**What it is.** Whether he took the best player available, judged against the consensus board where one exists, else against the slot.

**How it's calculated.** Where two or more pre-draft big boards exist (2008 and 2010-2026), each pick is compared with the best player still available: the highest-ranked on the boards' average. As it turned out: the chosen player's first ten seasons (any team, 5% a year) minus the best available's. At the time: the expected value of the chosen player's board rank minus that of the best available's, from a curve by board rank fit only on earlier board drafts; a reach is a small minus. Taking the best available is credited what an average GM gave up in the same spot (see Easy picks). A pick made for a trade partner on draft night counts for the team that held his rights when the season began.

**The data.** Basketball-Reference draft pages, Savant value, and archived big boards: NBADraft.net Big Board (17), ESPN Best Available (9), Tankathon Big Board (9), DraftExpress Top 100 (8), DraftExpress mock (1).

**Limits.** Drafts without two boards are graded against the slot: no consensus board exists for this draft, so a pick is measured against what its slot usually produces, with no grade at the time. Those from 1990 on use a pick curve fit only on earlier drafts; earlier ones use the first curve, fit on the 1980-85 drafts, so they are judged partly against themselves. The 1979 draft is not graded. The boards rank only the players who were drafted that year: a player who went undrafted is never the best available. Landing a high pick is lottery luck, not drafting.

## Second-round finds

**What it is.** Value found with picks after No. 30.

**How it's calculated.** For each second-round pick, its drafting grade (against the consensus board where one exists, else against the slot), counted only when positive.

**The data.** As Drafting.

**Limits.** Counts hits only, so it rewards volume as well as eye.

## Development

**What it is.** Whether the players he brought in did better than projected once they arrived.

**How it's calculated.** Each season, while he was in charge, that a player he acquired spent with his team: the player's value minus the projection made when he was acquired. His successors' seasons are theirs.

**The data.** Point-in-time projections, Savant value.

**Limits.** Shared with the coach and the player himself.

## Style

**What it is.** How he works, not how well.

**How it's calculated.** Decisions a season, and the average age of players he acquired by trade. Draft style and holding have their own entries.

**The data.** The transaction ledger.

**Limits.** Context only: more moves is neither better nor worse.

## At the time

**What it is.** The decision's grade with only what was known that day.

**How it's calculated.** Projected value gained minus projected value given up, from models fit only on seasons before the decision. Tap the number for the model version.

**The data.** Point-in-time snapshots stored for every decision.

**Limits.** Blank before 1985 (not enough earlier seasons) and for drafts without a consensus board.

## Is it skill?

**What it is.** Whether a GM who was good at something early in his career stayed good at it later.

**How it's calculated.** Each GM's decisions are split in half five ways (by date, alternating, big decisions only, weighted by stakes, and one team at a time), each half's average is compared across GMs, and the correlation's 95% interval is checked. 'Smallest it can detect' is the smallest real effect the test would catch four times in five.

**The data.** Every graded decision, each against the league average for that kind of decision that season (a draft pick against picks in the same range, since bad teams keep picking high). Holding counts each young player kept once, not each window he was kept through.

**Limits.** No skill repeats as it turned out; at the time, drafting does, which says GMs keep agreeing or disagreeing with the boards, not that their picks keep beating them; holding and re-signing pass some tests but not both splits, and re-signing likely reflects having stars to re-sign, so skills are shown as what happened. A small real skill could still be hiding under the smallest size it can detect.

## The board (new)

**What it is.** Where the player he took stood on the consensus board, and who was the best still available.

**How it's calculated.** Each source's last board archived before draft day, matched to that draft's players; a player one board leaves out is ranked just past its end; the consensus orders the average rank. Players tied on the average are both the best available.

**The data.** NBADraft.net Big Board (17), ESPN Best Available (9), Tankathon Big Board (9), DraftExpress Top 100 (8), DraftExpress mock (1), from the Internet Archive.

**Limits.** Boards cover 2008 and 2010-2026. ESPN's archived board shows its top 25, so later picks lean on the others. 2008's second source is a mock (DraftExpress's, which says team needs are not yet taken into account) because no second big board was archived before that draft.

## Easy picks (new)

**What it is.** Credit for taking the consensus best available, measured against what an average GM did in the same spot.

**How it's calculated.** How often GMs passed on the best available in comparable spots (the pick range, and how split the boards were), times the typical cost of those passes: at the time in board-rank expected value, as it turned out in what the players did. Both from earlier board drafts only. A spot's rate is pulled toward its pick range's by a weight measured from how well it predicted later drafts.

**The data.** The consensus boards and every earlier board draft.

**Limits.** Few drafts have boards, so the top of a draft has few comparable picks, and the boards' split predicts later passes only weakly once the pick range is allowed for. So even a unanimous first pick gets some credit.

## Holding young players (new)

**What it is.** Credit for keeping a young player that an average GM would sometimes have traded away, and lost value doing so.

**How it's calculated.** Every player 24 or younger on his books when a trade deadline or an offseason opened and still there when it closed. For players of the same age and a similar projection in earlier seasons, how often their teams traded them away, times the average value those teams lost when they did (minus the trade's grade, the player's share of it). As it turned out, from the trades' turned-out grades; at the time, from their at-the-time grades. The deadline is the 30 days up to each season's last in-season trade; the offseason runs from the last game to the next opener.

**The data.** The transaction ledger, our projections, every earlier season's trades.

**Limits.** A comparison with an average GM, not value that moved, so it is not part of GM Value Added. GMs rarely trade young players with high projections, so each hold earns a little; a team with more good young players has more chances. A cell with too few earlier trades falls back to players with a similar projection at any age. The season in progress has no deadline yet.

## Draft style: picks off the board (new)

**What it is.** How often and how far he passed on the consensus best available, and how those picks did against the player he passed on.

**How it's calculated.** Every pick in a draft with two or more boards. A pass: he took someone other than the best available; how far: the board places between them. A hit: the player he took did better over ten seasons than the one he passed on. The total is the sum of those differences.

**The data.** The consensus boards (2008 and 2010-2026), Savant value.

**Limits.** Only drafts with boards, so a GM before 2008 has none. Hindsight: a pass that missed can still have been a fair bet.

## Talent and fit (new)

**What it is.** Whether he took the best available (talent) or passed on him for a position his roster lacked (fit), inferred from roster needs.

**How it's calculated.** On draft day, his roster's minutes from the season just ended at Guard, Wing and Big, against the league's share at each that season; the position furthest below it is the one his roster lacked. A fit pick passes on the best available for a player at that position when the best available plays another. Each kind shown with how its players did over their slot and the minutes they played for his team in their first four seasons.

**The data.** Savant positions (each player's first NBA season), minutes, the consensus boards.

**Limits.** Inferred from roster needs: nothing here says what the front office intended. Positions are coarse, and a roster's need can change by trade before the season starts.
