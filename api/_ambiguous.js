// Names that belong to an NBA team and a D1 college team at once ("Oklahoma" is the Thunder's
// state and the Sooners' school). A bare one of these in a team argument gets a note that says
// which team the answer is about and asks the assistant to check with the person when the
// conversation has not made the league clear. Codes ("OKC") and full names ("Oklahoma City",
// "Sooners") are not ambiguous and get nothing.
const SHARED = {
  oklahoma: ['Oklahoma City Thunder', 'Oklahoma Sooners'],
  memphis: ['Memphis Grizzlies', 'Memphis Tigers'],
  utah: ['Utah Jazz', 'Utah Utes'],
  houston: ['Houston Rockets', 'Houston Cougars'],
  indiana: ['Indiana Pacers', 'Indiana Hoosiers'],
  miami: ['Miami Heat', 'Miami Hurricanes'],
  charlotte: ['Charlotte Hornets', 'Charlotte 49ers'],
  denver: ['Denver Nuggets', 'Denver Pioneers'],
  portland: ['Portland Trail Blazers', 'Portland Pilots'],
  washington: ['Washington Wizards', 'Washington Huskies'],
  minnesota: ['Minnesota Timberwolves', 'Minnesota Golden Gophers'],
  milwaukee: ['Milwaukee Bucks', 'Milwaukee Panthers'],
  detroit: ['Detroit Pistons', 'Detroit Mercy Titans'],
  boston: ['Boston Celtics', 'Boston College Eagles'],
  sacramento: ['Sacramento Kings', 'Sacramento State Hornets'],
  chicago: ['Chicago Bulls', 'Chicago State Cougars'],
  cleveland: ['Cleveland Cavaliers', 'Cleveland State Vikings'],
  neworleans: ['New Orleans Pelicans', 'New Orleans Privateers'],
}
const key = (q) => String(q || '').toLowerCase().replace(/[^a-z]/g, '')

// The note for a tool call, or null. `tool` is the tool's name; only nba_ and cbb_ tools take
// basketball teams.
export function teamNote(tool, args) {
  const side = tool.startsWith('cbb_') ? 1 : tool.startsWith('nba_') ? 0 : -1
  const pair = side >= 0 && args && SHARED[key(args.team)]
  if (!pair) return null
  const [nba, col] = pair
  return `Note: "${args.team}" names both the NBA's ${nba} and the college ${col}. This answer is about the ${side ? `college ${col}` : `NBA's ${nba}`}. If the person has not made clear which they mean, ask them before going on${side ? ' (the nba_ tools have the NBA team)' : ' (the cbb_ tools have the college team)'}.`
}

// A team that was not found may be the other league's.
export function notFoundNote(tool) {
  if (tool.startsWith('cbb_')) return 'If the person meant an NBA team, the nba_ tools have it; if it is not clear which league they mean, ask them.'
  if (tool.startsWith('nba_')) return 'If the person meant a college team, the cbb_ tools have it; if it is not clear which league they mean, ask them.'
  return null
}

export const SHARED_NAMES = SHARED
