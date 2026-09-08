// THE TEACHING LAYER.
//
// The point of this game is that running a basketball team is a genuinely hard job made of
// interlocking rules most fans have never had explained to them. So every idea gets
// explained ONCE, the first time it actually matters — not in a manual nobody reads, and
// not as a tooltip you have to go hunting for.
//
// Two rules for every lesson here. It is short enough to read while you are mid-decision.
// And where there is a measured number behind the idea, the number is in the lesson —
// because "stars are worth more than the sum of their parts" is a claim, and "the model
// correlates 0.54 with what prospects become, better than the real draft order's 0.50" is
// a fact you can go and check.
export const LESSONS = [
  /* ---------------------------------------------------------------- money */
  {
    id: 'salary_cap', title: 'The cap is not a limit',
    where: 'the trade desk',
    body: 'Almost every team is over the salary cap, and that is normal — the cap is the line '
      + 'past which you lose the ability to simply sign people. Above it you can still keep '
      + 'your own players and trade, but every new contract has to come from an exception or '
      + 'from matching salary in a deal.',
  },
  {
    id: 'matching', title: 'Salary has to match',
    where: 'a trade that just got rejected',
    body: 'A team over the cap cannot simply absorb a contract; it has to send out comparable '
      + 'money. Roughly: under $7.5M going out you can take back double plus $250k, in the '
      + 'middle you can take back what you send plus $7.5M, and above that 125% plus $250k. '
      + 'This is why real trades have a filler contract nobody talks about.',
  },
  {
    id: 'apron', title: 'The two aprons',
    where: 'a payroll above $195.9M',
    body: 'The 2023 agreement added two hard ceilings above the tax. Over the first apron you '
      + 'lose the non-taxpayer mid-level and sign-and-trades. Over the second you cannot '
      + 'combine two salaries in one trade, cannot take back a dollar more than you send, and '
      + 'your first-round pick seven years out freezes. Teams do not "pay through" an apron — '
      + 'they are structurally stuck.',
  },
  {
    id: 'tax', title: 'The luxury tax bill',
    where: 'a payroll above $187.9M',
    body: 'The tax is charged in bands and climbs fast: $1.50 per dollar for the first $5M '
      + 'over, then $1.75, $2.50, $3.25 and up. A team $20M into the tax owes roughly $45M. '
      + 'It is real money and it is why a good contract is worth more than a good player.',
  },
  {
    id: 'bird_rights', title: 'Bird rights',
    where: 'your own expiring contracts',
    body: 'You can go over the cap to re-sign your own player, and nobody else can outbid you '
      + 'without cap room. That right is why teams hate letting players reach free agency, and '
      + 'why a young player on an expiring rookie deal is worth far more than his one year.',
  },
  /* -------------------------------------------------------------- players */
  {
    id: 'value', title: 'What a player is worth',
    where: 'your first trade',
    body: 'Value here is not a rating. It is dollars of surplus: what his production is worth '
      + 'on the open market, minus what he costs, over the life of the deal. Production is '
      + 'priced at the measured $14.1M per unit of VORP. A good player on a bad contract can '
      + 'be worth less than nothing.',
  },
  {
    id: 'surplus', title: 'Against what the money buys',
    where: 'a cheap contract that looks like a steal',
    body: 'The alternative to a contract is not an empty roster spot, it is what the same money '
      + 'buys on the open market. Measured across the league: expected VORP = −0.59 + 0.59 × '
      + 'ln(salary in $M). The fit is loose — R² 0.30 — and that looseness IS the opportunity. '
      + 'The market is only weakly efficient, which is why trades are worth making at all.',
  },
  {
    id: 'archetype', title: 'Archetypes and fit',
    where: 'the roster screen',
    body: 'Players are grouped by how they actually play, from a clustering of the whole league '
      + 'rather than by listed position. Fit is measured too: on 390 team-seasons, off-ball '
      + 'gravity is the largest single coefficient — larger than three-point shooting itself — '
      + 'followed by point-of-attack defence, ball security and rim protection.',
  },
  {
    id: 'badges', title: 'Badges are percentiles',
    where: 'a player card',
    body: 'A badge is not a label somebody typed. It is where a player sits in this league on '
      + 'that axis: bronze at the 80th percentile, silver at the 90th, gold at the 96th, Hall '
      + 'of Fame at the 99th. Cuts are recomputed from the league you are actually in, so they '
      + 'keep meaning the same thing ten seasons from now.',
  },
  {
    id: 'tendencies', title: 'Tendencies are the inputs',
    where: 'a player card',
    body: 'These are not a second rating system. A player’s three-point rate, usage, assist '
      + 'rate and free-throw rate are the numbers the possession engine reads when it decides '
      + 'what he does with the ball. When the card says he lives behind the line, that is the '
      + 'same number the simulation is using.',
  },
  /* --------------------------------------------------------------- trades */
  {
    id: 'stepien', title: 'The Stepien rule',
    where: 'trading a future first',
    body: 'A team cannot be left without a first-round pick in two consecutive future drafts. '
      + 'Named for Ted Stepien, who traded so many Cavaliers firsts in the early eighties that '
      + 'the league wrote a rule about it. It is why teams trade picks in alternating years.',
  },
  {
    id: 'quality', title: 'Volume does not buy quality',
    where: 'an offer of three players for one',
    body: 'The best player in a trade matters more than the count. A front office will not turn '
      + 'a starter into depth, because minutes are finite — 240 a night — and a fifth rotation '
      + 'big plays none of them. Expect to be told no, and expect to be told why.',
  },
  {
    id: 'windows', title: 'Every team wants something different',
    where: 'the same player valued differently by two teams',
    body: 'A 33-year-old is worth far more to a team two wins from a title than to one starting '
      + 'over, and a 21-year-old the other way round. Each front office has its own read of the '
      + 'same player, its own needs and its own tolerance for the tax. That disagreement is '
      + 'where a trade comes from.',
  },
  /* ---------------------------------------------------------------- draft */
  {
    id: 'draft_board', title: 'Your board is an opinion',
    where: 'the draft room',
    body: 'Nobody knows who these players will become. The projection model correlates +0.54 '
      + 'with what prospects actually did — better than the real NBA draft order at +0.50, and '
      + 'nowhere near certainty. A top-five prospect on your board still misses about a fifth '
      + 'of the time.',
  },
  {
    id: 'scouting', title: 'What your scouts can see',
    where: 'hiring a scout',
    body: 'A scout inside the region he covers reads a prospect at about 0.52 to 0.58 — roughly '
      + 'as well as the model. Outside it he is at 0.24 to 0.37, which is close to guessing. '
      + 'With no department at all you are at 0.22. Coverage is the whole game: a European '
      + 'prospect is a coin flip unless somebody on your staff watches European basketball.',
  },
  {
    id: 'pick_value', title: 'What a pick is worth',
    where: 'a pick in a trade',
    body: 'Priced off 328 drafted players joined to their first four NBA seasons: the first pick '
      + 'is worth about $71M of surplus, the tenth about $24M, the thirtieth about $8M. Distant '
      + 'picks are discounted for time but gain a little back for uncertainty — nobody knows '
      + 'what that roster will look like in four years.',
  },
  /* ------------------------------------------------------------- the team */
  {
    id: 'rotation', title: 'Two hundred and forty minutes',
    where: 'the rotation screen',
    body: 'Five players on the floor for forty-eight minutes is 240 minutes a night, and that '
      + 'is the whole budget. Giving somebody more means taking it from somebody else, which is '
      + 'why a deep roster is worth less than it looks and why a redundant good player adds '
      + 'nothing at all.',
  },
  {
    id: 'fatigue', title: 'What minutes cost',
    where: 'a heavy rotation',
    body: 'Availability is a skill and minutes spend it. Push a player above the load his body '
      + 'has shown it can carry and he gets less available as the season goes; rest him and it '
      + 'comes back. The measured league average is about 72 games; players past 31 lose about '
      + 'another 1.2% of their season per year of age.',
  },
  {
    id: 'negotiation', title: 'The room',
    where: 'a contract negotiation',
    body: 'The asking price is measured, not invented: 251 veteran contracts fit against '
      + 'projected production, age and minutes. The residual spread is ±$10.4M, and that spread '
      + 'is the room a negotiation lives in. Lowball a player enough times and his agent stops '
      + 'taking the call.',
  },
  {
    id: 'market_price', title: 'What he will cost',
    where: 'your own free agents',
    body: 'A player’s price comes from what the market paid for comparable production, not '
      + 'from what you would like to pay. Other teams are bidding at the same time, and a player '
      + 'who reaches the open market usually leaves.',
  },
  {
    id: 'fit', title: 'Fit is measurable',
    where: 'the analytics screen',
    body: 'Out-of-sample, individual talent alone explains 60% of the variance in team net '
      + 'rating; adding how the pieces fit together takes it to 66%. Fit is real and it is '
      + 'smaller than talent. Do not build a roster on fit alone, and do not ignore it.',
  },
  {
    id: 'mandate', title: 'Who you work for',
    where: 'your first day',
    body: 'The owner sets the target and judges you against it, not against raw wins. Overshoot '
      + 'a rebuild mandate and you have still done your job; miss a contention mandate with 45 '
      + 'wins and you have not. Trust moves slowly and firing is real.',
  },
  {
    id: 'protection', title: 'A protected pick is a different asset',
    where: 'the first time a protected pick appears',
    body: 'Most first-round picks that change hands in the real league carry a protection. '
      + '"Top-four protected" means the team that traded it keeps it if it lands in the top four '
      + 'and you get nothing that year — the obligation rolls forward, usually narrowing as it '
      + 'goes, until it converts or turns into seconds. So the asset you are buying is a '
      + 'probability, and the percentage on the row is that probability. The cruelty of it is '
      + 'that a protected pick only ever conveys when it is the pick you did not want.',
  },
  {
    id: 'swap', title: 'Swap rights',
    where: 'the first time a swap appears',
    body: 'A swap is the right to take the better of two picks rather than a pick of your own. '
      + 'It costs the other team nothing if they finish ahead of you and costs them everything '
      + 'if they collapse, which is why a rebuilding club will hand one over when it will not '
      + 'hand over the pick itself. Some are three- and four-team ladders: everybody is pooled, '
      + 'sorted best-first, and dealt out in a fixed order. Hover a swap on the desk to see '
      + 'which seat you actually hold.',
  },
  {
    id: 'open_market', title: 'The door that never closes',
    where: 'the open market',
    body: 'A minimum contract can be signed by any team at any point in the year — over the cap, '
      + 'over the tax, over both aprons. It is the one door the CBA never shuts, and it exists '
      + 'because a roster that falls under fourteen players has to be fixed the same week. '
      + 'Everything larger needs an exception: your cap room if you have it, the mid-level if you '
      + 'are under the second apron, and using the mid-level hard-caps you at the first apron for '
      + 'the rest of the year.',
  },
  {
    id: 'waivers', title: 'What waiving costs',
    where: 'the first time you consider waiving somebody',
    body: 'Releasing a player does not release his money. The salary stays on your cap sheet for '
      + 'the length of the deal, and you have paid it for nothing. That is the entire reason a '
      + 'bad contract is a bad contract, and the reason a team will attach a first-round pick to '
      + 'get out of one.',
  },
]

export const LESSON = Object.fromEntries(LESSONS.map((l) => [l.id, l]))

// Has this one been shown yet?
export const seen = (save, id) => !!save?.learned?.[id]

// Mark it. Kept as a map rather than a list so a later lesson can be added without
// renumbering anything.
export const learn = (save, id) => ({ ...save, learned: { ...(save.learned || {}), [id]: 1 } })

// The next unseen lesson from a set of candidates — the UI asks for one at a time, because
// three explanations at once is a manual again.
// WHAT TO TEACH FIRST, WHEN SEVERAL THINGS APPLY AT ONCE.
//
// The order used to be the caller's array order, and one caller put the apron lesson at the
// FRONT whenever the club was over it. That is a fact about the roster you were handed, not
// about what you are ready to read — so a brand new general manager's very first screen, before
// he had seen a single player, opened with the second apron: sign-and-trades, salary
// aggregation, and a first-round pick seven years out freezing. The hardest idea in the game,
// delivered first, because the team he picked happened to be expensive.
//
// So the queue is sorted by DEPTH rather than by the caller's enthusiasm. Depth 1 is what the
// screen in front of you is about; 2 is what you need to make a decision on it; 3 is the fine
// print that only binds once you are trying something specific. Within a depth the caller's
// order still decides, because that part it does know.
export const DEPTH = {
  // 1 — the screen you are looking at, explained.
  mandate: 1, archetype: 1, salary_cap: 1, open_market: 1, rotation: 1, draft_board: 1,
  value: 1, fit: 1,
  // 2 — what you need to know to act on that screen.
  matching: 2, badges: 2, tendencies: 2, quality: 2, surplus: 2, scouting: 2, pick_value: 2,
  waivers: 2, fatigue: 2, tax: 2, market_price: 2, negotiation: 2, windows: 2,
  // 3 — the fine print. Real, and none of it is the first thing anybody should read.
  apron: 3, stepien: 3, protection: 3, swap: 3, bird_rights: 3,
}
export const depthOf = (id) => DEPTH[id] ?? 2

export function nextLesson(save, ids) {
  const open = (ids || []).filter((id) => LESSON[id] && !seen(save, id))
  if (!open.length) return null
  // A stable sort by depth: same depth keeps the caller's order.
  const best = open
    .map((id, i) => ({ id, d: depthOf(id), i }))
    .sort((a, b) => a.d - b.d || a.i - b.i)[0]
  return LESSON[best.id]
}

// Everything, for the glossary — with what you have already been told marked.
export const glossary = (save) => LESSONS.map((l) => ({ ...l, read: seen(save, l.id) }))
