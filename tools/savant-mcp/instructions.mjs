// tools/savant-mcp/instructions.mjs — the server instructions fit Claude's client.
//
//   node --test tools/savant-mcp/instructions.mjs
//
// Claude's client keeps only the first 4,096 characters of a server's instructions: on Nov 25 2026 the
// text was cut at "...listed as not tracked rat", character 4,096 of the version then live, and everything
// after it (the dates and links, every key note) never reached a model. Every variant must fit with room
// to spare, and the rules a model must follow come first, so a future cut can only lose the least of it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { instructionsFor } from '../../api/mcp.js'

const LIMIT = 4096, HEADROOM = 150
const VARIANTS = [['none', false], ['valid', false], ['valid', true], ['unknown', false], ['unchecked', false]]

test('every variant fits under Claude\'s 4,096-character cut, with room to spare', () => {
  for (const [state, analysis] of VARIANTS) {
    const s = instructionsFor(state, { analysis })
    assert.ok(s.length <= LIMIT - HEADROOM, `${state}${analysis ? ' + analysis' : ''}: ${s.length} characters`)
  }
})

test('the rules a model must follow come first', () => {
  const s = instructionsFor('none')
  const rules = ['ask them which team they mean', 'Oklahoma (the Thunder or the Sooners)', 'Every percentile belongs to a pool', 'not tracked, never as zero', 'Name searches ignore accents and punctuation']
  for (const r of rules) assert.ok(s.indexOf(r) >= 0 && s.indexOf(r) < 1500, `"${r}" is at ${s.indexOf(r)}`)
  // and every prefix is named inside the cut
  for (const p of ['nba_', 'nba_draft_', 'nfl_', 'cbb_', 'cfb_', 'ufc_', 'wce_', 'savant_dictionary']) assert.ok(s.indexOf(p) >= 0 && s.indexOf(p) < LIMIT, p)
})

test('each key state still says what it must', () => {
  assert.match(instructionsFor('none'), /Keys are free at https:\/\/wcehoops\.com\/#ai/)
  assert.match(instructionsFor('valid'), /the person's own WCE key/)
  assert.doesNotMatch(instructionsFor('valid'), /Keys are free/)
  assert.match(instructionsFor('valid', { analysis: true }), /savant_sql with dictionary: \{sport, table\}/)
  assert.match(instructionsFor('unknown'), /is not one wcehoops\.com knows/)
})
