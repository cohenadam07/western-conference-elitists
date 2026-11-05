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

// NBA names that are no D1 team's: on a cbb_ tool they would only fuzzy-match a wrong school
// ("Thunder" is close to Marshall's Thundering Herd), so they are turned back. Nicknames that
// are also D1 mascots (Hornets, Rockets, Bulls, Warriors, Hawks, Cavaliers, Mavericks,
// Grizzlies, Lakers, Blazers) are left out on purpose.
const NBA = {
  okc: 'Oklahoma City Thunder', oklahomacity: 'Oklahoma City Thunder', thunder: 'Oklahoma City Thunder', oklahomacitythunder: 'Oklahoma City Thunder',
  goldenstate: 'Golden State Warriors', gsw: 'Golden State Warriors', goldenstatewarriors: 'Golden State Warriors',
  celtics: 'Boston Celtics', bostonceltics: 'Boston Celtics', nets: 'Brooklyn Nets', brooklynnets: 'Brooklyn Nets',
  knicks: 'New York Knicks', newyorkknicks: 'New York Knicks', sixers: 'Philadelphia 76ers', ers: 'Philadelphia 76ers', philadelphiaers: 'Philadelphia 76ers',
  raptors: 'Toronto Raptors', torontoraptors: 'Toronto Raptors', pistons: 'Detroit Pistons', detroitpistons: 'Detroit Pistons',
  pacers: 'Indiana Pacers', indianapacers: 'Indiana Pacers', bucks: 'Milwaukee Bucks', milwaukeebucks: 'Milwaukee Bucks',
  chicagobulls: 'Chicago Bulls', clevelandcavaliers: 'Cleveland Cavaliers', cavs: 'Cleveland Cavaliers', atlantahawks: 'Atlanta Hawks',
  charlottehornets: 'Charlotte Hornets', heat: 'Miami Heat', miamiheat: 'Miami Heat', magic: 'Orlando Magic', orlandomagic: 'Orlando Magic',
  wizards: 'Washington Wizards', washingtonwizards: 'Washington Wizards', nuggets: 'Denver Nuggets', denvernuggets: 'Denver Nuggets',
  timberwolves: 'Minnesota Timberwolves', wolves: 'Minnesota Timberwolves', minnesotatimberwolves: 'Minnesota Timberwolves',
  trailblazers: 'Portland Trail Blazers', portlandtrailblazers: 'Portland Trail Blazers', jazz: 'Utah Jazz', utahjazz: 'Utah Jazz',
  clippers: 'LA Clippers', laclippers: 'LA Clippers', losangelesclippers: 'LA Clippers', losangeleslakers: 'Los Angeles Lakers',
  suns: 'Phoenix Suns', phoenixsuns: 'Phoenix Suns', sacramentokings: 'Sacramento Kings', dallasmavericks: 'Dallas Mavericks', mavs: 'Dallas Mavericks',
  houstonrockets: 'Houston Rockets', memphisgrizzlies: 'Memphis Grizzlies', pelicans: 'New Orleans Pelicans', neworleanspelicans: 'New Orleans Pelicans',
  spurs: 'San Antonio Spurs', sanantoniospurs: 'San Antonio Spurs',
}
export function nbaOnly(tool, args) {
  if (!tool.startsWith('cbb_') || !args || !args.team) return null
  const nba = NBA[key(args.team)]
  return nba ? `"${args.team}" is an NBA team (the ${nba}), not a college one; the nba_ tools have it. For a college team, use its school's name. If it is not clear which league the person means, ask them.` : null
}

// A team that was not found may be the other league's.
export function notFoundNote(tool) {
  if (tool.startsWith('cbb_')) return 'If the person meant an NBA team, the nba_ tools have it; if it is not clear which league they mean, ask them.'
  if (tool.startsWith('nba_')) return 'If the person meant a college team, the cbb_ tools have it; if it is not clear which league they mean, ask them.'
  return null
}

export const SHARED_NAMES = SHARED
