// What an assistant reads up front from the connector: every tool's name, description and input
// schema, measured exactly as tools/savant-mcp/check.mjs measures it (the 90,000-character cap).
//
//   node tools/dataroom/upfront.mjs            prints the total and the biggest tools
//   node tools/dataroom/upfront.mjs --json     one line of JSON
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildServer } from '../../api/mcp.js'

const server = buildServer({ state: 'none' })
const [a, b] = InMemoryTransport.createLinkedPair()
await server.connect(a)
const client = new Client({ name: 'upfront', version: '1' })
await client.connect(b)
const { tools } = await client.listTools()
const sizes = tools.map((t) => [t.name, JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length]).sort((x, y) => y[1] - x[1])
const total = sizes.reduce((n, x) => n + x[1], 0)
const instr = (client.getInstructions() || '').length
if (process.argv.includes('--json')) console.log(JSON.stringify({ tools: tools.length, upfront: total, instructions: instr }))
else {
  console.log(`${tools.length} tools; up-front tool text ${total.toLocaleString('en-US')} characters (cap 90,000); server instructions ${instr.toLocaleString('en-US')}`)
  for (const [n, s] of sizes.slice(0, 8)) console.log(`  ${n.padEnd(34)} ${s}`)
  for (const n of ['savant_data', 'savant_dictionary', 'nba_coaching_data', 'nba_coaching_dictionary', 'cbb_data', 'cbb_data_dictionary', 'cbb_coaching_data', 'cbb_coaching_dictionary']) {
    const x = sizes.find((s) => s[0] === n)
    if (x) console.log(`  ${n.padEnd(34)} ${x[1]}`)
  }
}
await client.close()
process.exit(0)
