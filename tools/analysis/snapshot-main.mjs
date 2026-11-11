// tools/analysis/snapshot-main.mjs — what main lists, for the "public connector unchanged" test. Run from a
// checkout of main (git archive origin/main api src/data package.json scripts/lib public/savant-{ww,cbb,cfb}.js)
// with node_modules beside it: node snapshot-main.mjs <out.json> <commit>. tools/analysis/check.mjs compares.
import { writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js")
const { buildServer } = await import("./api/mcp.js")
const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex")
const out = { from: "origin/main", commit: process.argv[3] }
for (const [label, key] of [["public", { state: "none" }], ["key", { state: "valid", id: "aaaaaaaaaaaa" }], ["unknown", { state: "unknown" }], ["unchecked", { state: "unchecked" }]]) {
  const server = buildServer(key); const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a)
  const c = new Client({ name: "snap", version: "1" }); await c.connect(b)
  const { tools } = await c.listTools()
  const t = tools.map((x) => ({ name: x.name, title: x.title, description: x.description, inputSchema: x.inputSchema, annotations: x.annotations }))
  out[label] = { tools: t.length, tools_sha256: sha(t), instructions_sha256: sha(c.getInstructions()), upfront: t.reduce((n, x) => n + JSON.stringify({ name: x.name, description: x.description, inputSchema: x.inputSchema }).length, 0) }
  await c.close()
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + "\n")
process.exit(0)
