// What the homepage says about the AI connector (api/mcp.js): where it lives, where Claude's
// own instructions for adding one are, and the worked example the section shows.
//
// The example is a real answer, not a mock-up of one. Every number in it is what the
// connector returns for that player and season, which is what his Basketball Savant card
// shows. It is a finished season on purpose, so it does not go stale between data pushes.
// tools/savant-mcp/check.mjs calls the connector and fails if any of it stops being true.

export const CONNECTOR_URL = 'https://wcehoops.com/api/mcp'

// Claude's own guide to adding a connector by address. The menu names in the steps on the
// homepage come from here; if Claude renames a menu, this page is the one that stays right.
export const CLAUDE_GUIDE = 'https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp'

export const EXAMPLE = {
  question: 'How good was Victor Wembanyama in 2025-26?',
  id: '1641705',
  name: 'Victor Wembanyama',
  season: '2025-26',
  team: 'SAS',
  perGame: { points: 25, rebounds: 11.5, assists: 3.1 },
  pool: 349, // qualified players that season: the group the percentiles below are against
  stats: [
    { key: 'blkpct', label: 'Block %', display: '9.4%', percentile: 99 },
    { key: 'pts', label: 'Points / 75', display: '30.2', percentile: 98 },
    { key: 'ts', label: 'True shooting %', display: '.626', percentile: 83 },
    { key: 'tp3', label: '3-point %', display: '34.9%', percentile: 45 },
  ],
  card: '/basketball-savant.html?p=1641705',
}

// Questions shown as things to try. Each is one the connector has a tool for.
export const PROMPTS = [
  'How good is Chase Brown this season?',
  'Who’s on the next UFC card?',
  'Who’s No. 1 on the Big Board?',
]
