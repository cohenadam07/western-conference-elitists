// THE REAL DRAFT-PICK LEDGER, 2027-2031.
//
// Transcribed from RealGM's future-drafts tables (basketball.realgm.com/nba/draft/
// future_drafts/yearly/<year>). Every team's line there begins with the fate of ITS OWN
// pick and then lists picks it has acquired. Only the leading clause is encoded here:
// taken across thirty teams that describes all sixty picks exactly once, with no double
// counting, which is also what makes the dataset self-checking (see tools/gm/picks.test.mjs).
//
// WHAT IS EXACT: outright trades, protection ranges, forfeitures, and two- to four-team
// swap groups. That is the great majority of it, and it is where the felt realism lives —
// Oklahoma City's hoard, Brooklyn's stack, Utah's protected picks, the Clippers' forfeited
// 2030 and 2031 firsts.
//
// WHAT IS APPROXIMATED: a handful of 2028 and 2030 chains whose real language is a nested
// conditional across four or five teams AND across years ("if PHL 9-30 is third most
// favorable and NYK is most or second most favorable of ..."). Those are resolved to their
// likeliest branch and carry `approx: true`, so the game can say so rather than quietly
// pretending. Second rounds are encoded as ownership and protection only; their swap
// chains are the deepest and the least consequential.
//
// SPEC GRAMMAR
//   'own'                  the origin team keeps it
//   'to:XXX'               conveys outright
//   'prot:lo-hi>XXX'       origin keeps it if it lands in [lo,hi], otherwise XXX gets it
//   'prot:lo-hi>@G'        same, but if it conveys it enters swap group G
//   'split:lo-hi>XXX|lo-hi>YYY'   different owners by range
//   '@G'                   the pick belongs to swap group G
//   'forfeit'              nobody drafts it
//
// A swap group is a pool of picks and an ordered list of who receives them once they are
// sorted most-favourable first. A name can appear twice in `assign` — Oklahoma City really
// does take the two best of Denver, its own and the Clippers in 2027.

export const REAL_PICKS_SOURCE = 'RealGM future drafts, 2027-2031'

export const SWAP_GROUPS = {
  // 2027
  S27A: { pool: ['BKN', 'HOU'], assign: ['BKN', 'HOU'] },
  S27B: { pool: ['CLE', 'MIN', 'UTA'], assign: ['MEM', 'UTA', 'PHX'] },
  S27C: { pool: ['DEN', 'OKC', 'LAC', 'TOR'], assign: ['OKC', 'OKC', 'LAC', 'TOR'] },
  S27D: { pool: ['MIL', 'NOP'], assign: ['NOP', 'ATL'] },
  S27E: { pool: ['BOS', 'ORL'], assign: ['UTA', 'PHX'], round: 2 },
  S27F: { pool: ['BKN', 'DAL'], assign: ['WAS', 'MIL'], round: 2 },
  S27G: { pool: ['GSW', 'PHX'], assign: ['PHI', 'WAS'], round: 2 },
  S27H: { pool: ['HOU', 'OKC', 'IND', 'MIA', 'SAS'], assign: ['PHI', 'NOP', 'NYK', 'SAS', 'MIA'], round: 2 },
  S27I: { pool: ['NOP', 'POR'], assign: ['CHA', 'POR'], round: 2 },
  // 2028 — the Utah/Cleveland/Lakers/Atlanta ladder, and two knots that are approximated.
  S28A: { pool: ['UTA', 'CLE', 'LAL', 'ATL'], assign: ['UTA', 'LAL', 'ATL', 'CLE'] },
  S28B: { pool: ['BOS', 'SAS'], assign: ['SAS', 'BOS'], approx: true },
  S28C: { pool: ['BKN', 'PHI', 'PHX', 'NYK', 'WAS'], assign: ['BKN', 'BKN', 'NYK', 'WAS', 'PHX'], approx: true },
  S28D: { pool: ['CHA', 'MIN'], assign: ['CHA', 'MIN'] },
  S28E: { pool: ['DAL', 'OKC'], assign: ['OKC', 'DAL'] },
  S28G: { pool: ['MIL', 'POR'], assign: ['POR', 'MIL'], approx: true },
  S28H: { pool: ['CHA', 'LAC'], assign: ['CHA', 'DET'], round: 2 },
  S28I: { pool: ['CHI', 'IND', 'PHX'], assign: ['CHI', 'IND', 'NYK'], round: 2 },
  S28J: { pool: ['GSW', 'MIL', 'OKC'], assign: ['BOS', 'PHI', 'PHI'], round: 2 },
  S28K: { pool: ['LAL', 'WAS'], assign: ['ORL', 'WAS'], round: 2 },
  // 2029
  S29A: { pool: ['BOS', 'POR', 'MIL'], assign: ['POR', 'WAS', 'POR'] },
  S29B: { pool: ['CLE', 'MIN', 'UTA'], assign: ['UTA', 'UTA', 'CHA'] },
  S29C: { pool: ['DAL', 'HOU', 'PHX'], assign: ['HOU', 'HOU', 'BKN'] },
  S29D: { pool: ['MEM', 'ORL'], assign: ['MEM', 'ORL'] },
  S29E: { pool: ['LAC', 'PHI'], assign: ['PHI', 'LAC'] },
  S29F: { pool: ['ATL', 'MIA'], assign: ['CHA', 'OKC'], round: 2 },
  S29G: { pool: ['DET', 'MIL', 'NYK'], assign: ['DET', 'DET', 'CHI'], round: 2 },
  S29H: { pool: ['IND', 'WAS'], assign: ['IND', 'POR'], round: 2 },
  // 2030
  S30A: { pool: ['CHA', 'MIN'], assign: ['CHA', 'MIN'] },
  S30B: { pool: ['SAS', 'DAL', 'MIN'], assign: ['SAS', 'DAL', 'MIN'], approx: true },
  S30C: { pool: ['LAL', 'UTA'], assign: ['UTA', 'LAL'] },
  S30D: { pool: ['MIA', 'MIL', 'POR'], assign: ['POR', 'MIL', 'MIA'], approx: true },
  S30E: { pool: ['PHX', 'WAS', 'MEM'], assign: ['MEM', 'WAS', 'PHX'], approx: true },
  S30F: { pool: ['CHI', 'IND'], assign: ['CHI', 'IND'], round: 2 },
  S30G: { pool: ['DEN', 'HOU', 'MIA'], assign: ['MEM', 'OKC', 'OKC'], round: 2 },
  S30I: { pool: ['NOP', 'ORL'], assign: ['NOP', 'ORL'], round: 2 },
  S30J: { pool: ['PHX', 'POR', 'WAS'], assign: ['BOS', 'PHI', 'WAS'], round: 2 },
  // 2031
  S31A: { pool: ['SAC', 'SAS'], assign: ['SAS', 'SAC'] },
  S31B: { pool: ['ATL', 'HOU'], assign: ['OKC', 'HOU'], round: 2 },
  S31C: { pool: ['BOS', 'CLE'], assign: ['UTA', 'BOS'], round: 2 },
  S31D: { pool: ['GSW', 'MIN'], assign: ['CHI', 'DET'], round: 2 },
  S31E: { pool: ['IND', 'MIA', 'MEM'], assign: ['WAS', 'MEM', 'IND'], round: 2 },
  S31F: { pool: ['NOP', 'ORL'], assign: ['ORL', 'OKC'], round: 2 },
}

// year -> round -> origin team -> spec
export const REAL_LEDGER = {
  2027: {
    1: {
      ATL: 'to:SAS', BOS: 'own', BKN: '@S27A', CHA: 'own', CHI: 'own',
      CLE: '@S27B', DAL: 'prot:1-2>CHA', DEN: 'prot:1-5>@S27C', DET: 'own', GSW: 'own',
      HOU: '@S27A', IND: 'own', LAC: '@S27C', LAL: 'prot:1-4>MEM', MEM: 'own',
      MIA: 'prot:1-14>CHA', MIL: '@S27D', MIN: '@S27B', NOP: '@S27D', NYK: 'to:BKN',
      OKC: '@S27C', ORL: 'own', PHI: 'own', PHX: 'to:HOU', POR: 'own',
      SAC: 'own', SAS: 'split:1-16>SAC|17-30>OKC', TOR: '@S27C', UTA: '@S27B', WAS: 'own',
    },
    2: {
      ATL: 'prot:31-55>DAL', BOS: '@S27E', BKN: '@S27F', CHA: 'to:OKC', CHI: 'to:OKC',
      CLE: 'to:CHI', DAL: '@S27F', DEN: 'to:UTA', DET: 'own', GSW: '@S27G',
      HOU: '@S27H', IND: '@S27H', LAC: 'to:UTA', LAL: 'to:BKN', MEM: 'to:CHA',
      MIA: '@S27H', MIL: 'own', MIN: 'to:POR', NOP: '@S27I', NYK: 'own',
      OKC: '@S27H', ORL: '@S27E', PHI: 'own', PHX: '@S27G', POR: '@S27I',
      SAC: 'to:OKC', SAS: '@S27H', TOR: 'own', UTA: 'to:IND', WAS: 'to:NYK',
    },
  },
  2028: {
    1: {
      ATL: '@S28A', BOS: '@S28B', BKN: '@S28C', CHA: '@S28D', CHI: 'own',
      CLE: '@S28A', DAL: '@S28E', DEN: 'prot:1-5>OKC', DET: 'own', GSW: 'own',
      HOU: 'own', IND: 'own', LAC: 'prot:1-16>BOS', LAL: '@S28A', MEM: 'own',
      MIA: 'to:CHA', MIL: '@S28G', MIN: '@S28D', NOP: 'own', NYK: '@S28C',
      OKC: '@S28E', ORL: 'to:POR', PHI: 'prot:1-8>@S28C', PHX: '@S28C', POR: '@S28G',
      SAC: 'own', SAS: '@S28B', TOR: 'own', UTA: '@S28A', WAS: '@S28C',
    },
    2: {
      ATL: 'to:BKN', BOS: 'to:NYK', BKN: 'own', CHA: '@S28H', CHI: '@S28I',
      CLE: 'to:UTA', DAL: 'to:LAC', DEN: 'prot:31-33>WAS', DET: 'prot:31-55>PHI', GSW: '@S28J',
      HOU: 'to:CHA', IND: '@S28I', LAC: '@S28H', LAL: '@S28K', MEM: 'to:BKN',
      MIA: 'to:DET', MIL: '@S28J', MIN: 'to:DEN', NOP: 'to:SAS', NYK: 'to:DET',
      OKC: '@S28J', ORL: 'to:CHA', PHI: 'to:BKN', PHX: '@S28I', POR: 'own',
      SAC: 'to:POR', SAS: 'own', TOR: 'own', UTA: 'to:OKC', WAS: '@S28K',
    },
  },
  2029: {
    1: {
      ATL: 'own', BOS: '@S29A', BKN: 'own', CHA: 'own', CHI: 'own',
      CLE: '@S29B', DAL: '@S29C', DEN: 'prot:1-5>OKC', DET: 'own', GSW: 'own',
      HOU: '@S29C', IND: 'to:LAC', LAC: 'prot:1-3>@S29E', LAL: 'to:DAL', MEM: '@S29D',
      MIA: 'own', MIL: '@S29A', MIN: 'prot:1-5>@S29B', NOP: 'own', NYK: 'to:BKN',
      OKC: 'own', ORL: 'prot:1-2>@S29D', PHI: '@S29E', PHX: '@S29C', POR: '@S29A',
      SAC: 'own', SAS: 'own', TOR: 'own', UTA: '@S29B', WAS: 'own',
    },
    2: {
      ATL: '@S29F', BOS: 'to:OKC', BKN: 'own', CHA: 'own', CHI: 'own',
      CLE: 'to:ATL', DAL: 'to:BKN', DEN: 'to:CHA', DET: '@S29G', GSW: 'to:BKN',
      HOU: 'to:DAL', IND: '@S29H', LAC: 'to:SAS', LAL: 'to:WAS', MEM: 'to:BKN',
      MIA: '@S29F', MIL: '@S29G', MIN: 'to:CHA', NOP: 'to:SAS', NYK: '@S29G',
      OKC: 'own', ORL: 'to:MEM', PHI: 'own', PHX: 'to:NYK', POR: 'to:MEM',
      SAC: 'to:NYK', SAS: 'own', TOR: 'own', UTA: 'own', WAS: '@S29H',
    },
  },
  2030: {
    1: {
      ATL: 'own', BOS: 'own', BKN: 'own', CHA: '@S30A', CHI: 'own',
      CLE: 'own', DAL: '@S30B', DEN: 'prot:1-5>OKC', DET: 'own', GSW: 'prot:1-20>MEM',
      HOU: 'own', IND: 'own', LAC: 'forfeit', LAL: '@S30C', MEM: 'own',
      MIA: '@S30D', MIL: '@S30D', MIN: 'prot:1-1>@S30B', NOP: 'own', NYK: 'own',
      OKC: 'own', ORL: 'to:MEM', PHI: 'own', PHX: '@S30E', POR: '@S30D',
      SAC: 'own', SAS: '@S30B', TOR: 'own', UTA: '@S30C', WAS: '@S30E',
    },
    2: {
      ATL: 'to:OKC', BOS: 'to:BKN', BKN: 'own', CHA: 'prot:31-55>BOS', CHI: '@S30F',
      CLE: 'to:SAS', DAL: 'to:BKN', DEN: '@S30G', DET: 'own', GSW: 'to:MEM',
      HOU: '@S30G', IND: '@S30F', LAC: 'to:CHA', LAL: 'to:BKN', MEM: 'prot:31-50>MIN',
      MIA: '@S30G', MIL: 'to:ORL', MIN: 'to:OKC', NOP: '@S30I', NYK: 'to:ATL',
      OKC: 'own', ORL: '@S30I', PHI: 'to:NYK', PHX: '@S30J', POR: '@S30J',
      SAC: 'to:SAS', SAS: 'own', TOR: 'to:LAC', UTA: 'to:CHA', WAS: '@S30J',
    },
  },
  2031: {
    1: {
      ATL: 'own', BOS: 'own', BKN: 'own', CHA: 'own', CHI: 'own',
      CLE: 'to:DEN', DAL: 'own', DEN: 'own', DET: 'own', GSW: 'own',
      HOU: 'own', IND: 'own', LAC: 'forfeit', LAL: 'to:UTA', MEM: 'own',
      MIA: 'to:MIL', MIL: 'own', MIN: 'to:SAC', NOP: 'own', NYK: 'to:BKN',
      OKC: 'own', ORL: 'own', PHI: 'to:BOS', PHX: 'to:MEM', POR: 'own',
      SAC: '@S31A', SAS: '@S31A', TOR: 'to:LAC', UTA: 'own', WAS: 'own',
    },
    2: {
      ATL: '@S31B', BOS: '@S31C', BKN: 'own', CHA: 'own', CHI: 'own',
      CLE: '@S31C', DAL: 'to:DET', DEN: 'to:CHI', DET: 'to:OKC', GSW: '@S31D',
      HOU: '@S31B', IND: '@S31E', LAC: 'own', LAL: 'to:BKN', MEM: '@S31E',
      MIA: '@S31E', MIL: 'to:CHA', MIN: '@S31D', NOP: '@S31F', NYK: 'to:CHI',
      OKC: 'own', ORL: '@S31F', PHI: 'own', PHX: 'to:CHA', POR: 'own',
      SAC: 'to:DEN', SAS: 'own', TOR: 'to:NOP', UTA: 'own', WAS: 'to:LAL',
    },
  },
}
