// The homepage banner's "what's new": what gets picked, for how long, and how it reads.
// Run: npm run check:whats-new
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFeed } from '../../scripts/lib/whats-new.mjs'
import { label, pickRecent, stamp } from '../../src/lib/whatsNew.js'

const NOW = Date.parse('2026-10-16T22:00:00Z')
const ago = (days) => new Date(NOW - days * 864e5).toISOString()

test('the YouTube feed: videos and Shorts, #shorts dropped, entities decoded', () => {
  const xml = `<feed><title>Western Conference Elitists</title>
    <entry><title>Two 30% Guys. One Ball. #shorts</title><link rel="alternate" href="https://www.youtube.com/shorts/abc"/><published>2026-10-15T20:00:00+00:00</published></entry>
    <entry><title>Can Fox &amp; Castle Start?</title><link rel="alternate" href="https://www.youtube.com/watch?v=xyz"/><published>2026-10-16T15:00:00+00:00</published></entry>
  </feed>`
  const items = parseFeed(xml)
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [['short', 'Two 30% Guys. One Ball.'], ['video', 'Can Fox & Castle Start?']])
})

test('each kind ages out on its own clock, newest first', () => {
  const items = [
    { kind: 'article', date: ago(29), text: 'old enough to stay' },
    { kind: 'article', date: ago(31), text: 'too old' },
    { kind: 'video', date: ago(9), text: 'video in' },
    { kind: 'video', date: ago(11), text: 'video out' },
    { kind: 'short', date: ago(2), text: 'short in' },
    { kind: 'short', date: ago(4), text: 'short out' },
    { kind: 'update', date: '2026-09-26', text: 'update in' },
    { kind: 'update', date: '2026-09-24', text: 'update out' },
  ]
  assert.deepEqual(pickRecent(items, NOW).map((i) => i.text), ['short in', 'video in', 'update in', 'old enough to stay'])
})

test('caps per kind, and the whole banner', () => {
  const shorts = [1, 2, 3].map((n) => ({ kind: 'short', date: ago(n / 10), text: `short ${n}` }))
  assert.equal(pickRecent(shorts, NOW).length, 1)
  const updates = Array.from({ length: 12 }, (_, n) => ({ kind: 'update', date: ago(n / 10), text: `u${n}` }))
  assert.equal(pickRecent(updates, NOW).length, 4)
  const many = [
    ...updates,
    ...Array.from({ length: 5 }, (_, n) => ({ kind: 'article', date: ago(n), text: `a${n}` })),
    ...Array.from({ length: 5 }, (_, n) => ({ kind: 'video', date: ago(n), text: `v${n}` })),
  ]
  assert.equal(pickRecent(many, NOW).length, 8)
})

test('an article dated ahead waits for its date', () => {
  assert.equal(pickRecent([{ kind: 'article', date: '2026-10-18T14:00:00Z', text: 'later' }], NOW).length, 0)
})

test('a UFC card shows the week before, through fight night', () => {
  const card = (date) => [{ kind: 'event', date, text: 'card' }]
  assert.equal(pickRecent(card('2026-10-17'), NOW).length, 1)
  assert.equal(pickRecent(card('2026-10-30'), NOW).length, 0)
  assert.equal(pickRecent(card('2026-10-14'), NOW).length, 0)
})

test('"New" for three days, then the date', () => {
  const [fresh] = pickRecent([{ kind: 'video', date: ago(1), text: 'v' }], NOW)
  const [older] = pickRecent([{ kind: 'video', date: '2026-10-09T15:00:00Z', text: 'v' }], NOW)
  assert.equal(stamp(fresh), 'New')
  assert.equal(stamp(older), 'Oct 9')
  const [ev] = pickRecent([{ kind: 'event', date: '2026-10-17', text: 'card' }], NOW)
  assert.equal(stamp(ev), 'Sat, Oct 17')
})

test('how each kind reads', () => {
  assert.equal(label({ kind: 'article', text: 'T' }), 'Article: T')
  assert.equal(label({ kind: 'video', text: 'T' }), 'Video: T')
  assert.equal(label({ kind: 'short', text: 'T' }), 'Short: T')
  assert.equal(label({ kind: 'update', product: 'Football Savant', version: '2.1.0', text: 'the All-Savant Team' }), 'Football Savant 2.1.0: the All-Savant Team')
  assert.equal(label({ kind: 'update', product: 'Flappy Hoops', text: 'The Drop' }), 'Flappy Hoops: The Drop')
})

test('every logged update has a date, a product, words and a link', async () => {
  const { default: updates } = await import('../../src/data/updates.json', { with: { type: 'json' } })
  for (const u of updates) {
    assert.match(u.date, /^\d{4}-\d{2}-\d{2}$/, JSON.stringify(u))
    assert.ok(u.product && u.text, JSON.stringify(u))
    assert.ok(u.to || u.href, JSON.stringify(u))
    assert.ok(!/—/.test(u.text), 'no em dashes in banner copy')
  }
})

test('the saved YouTube feed (written by the news run) is well formed', async () => {
  const fs = await import('node:fs')
  const file = new URL('../../public/youtube-feed.json', import.meta.url)
  if (!fs.existsSync(file)) return
  const { items } = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(Array.isArray(items) && items.length > 0)
  for (const v of items) {
    assert.match(v.url, /^https:\/\/www\.youtube\.com\/(shorts\/|watch\?v=)/, JSON.stringify(v))
    assert.ok(v.title && !/#shorts/i.test(v.title), JSON.stringify(v))
    assert.ok(!Number.isNaN(Date.parse(v.published)), JSON.stringify(v))
  }
})
