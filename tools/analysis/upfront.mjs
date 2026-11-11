// What each kind of address reads up front: tool text (name, description, input schema, as
// tools/savant-mcp/check.mjs measures it) and the server instructions. node tools/analysis/upfront.mjs [--json]
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildServer } from '../../api/mcp.js'

export async function upfront(key) {
  const server = buildServer(key)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'upfront', version: '1' })
  await client.connect(b)
  const { tools } = await client.listTools()
  const text = tools.reduce((n, t) => n + JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length, 0)
  const out = { tools: tools.length, names: tools.map((t) => t.name), upfront: text, instructions: client.getInstructions() || '' }
  await client.close()
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = {}
  for (const [label, key] of [['public', { state: 'none' }], ['key holder', { state: 'valid', id: 'aaaaaaaaaaaa', tier: null }], ['founder', { state: 'valid', id: 'bbbbbbbbbbbb', tier: 'founder' }]]) {
    const u = await upfront(key)
    rows[label] = { tools: u.tools, upfront: u.upfront, instructions: u.instructions.length }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows))
  else for (const [k, v] of Object.entries(rows)) console.log(`${k.padEnd(11)} ${v.tools} tools, ${v.upfront.toLocaleString('en-US')} characters of tool text (cap 90,000), instructions ${v.instructions.toLocaleString('en-US')}`)
  process.exit(0)
}
