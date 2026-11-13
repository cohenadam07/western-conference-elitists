// tools/race-test.mjs — the race party's rules, tested.
//   node tools/race-test.mjs                 the rules on a fake clock (api/_race.js, no storage)
//   node tools/race-test.mjs live [base]     a whole nine-hole match through the real endpoint, in real
//                                            time (about three minutes; start tools/race-dev.mjs first)
import assert from 'node:assert/strict'
import * as R from '../api/_race.js'

let n = 0
const ok = (cond, what) => { n++; if (!cond) { console.log('FAIL', what); process.exitCode = 1 } else console.log('PASS', what) }
const seq = (...xs) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)] }
const WORLDS = ['newyork', 'sanantonio', 'okc', 'cleveland', 'la', 'minnesota', 'detroit', 'philadelphia', 'phoenix', 'houston', 'denver', 'portland', 'orlando', 'toronto', 'atlanta', 'boston'].map((id) => ({ id, n: 9 }))

function party(names, now) {
  const room = R.newRoom('BCDF', now), live = {}
  names.forEach((nm, i) => { R.addPlayer(room, 'p' + i + 'aaaaa', nm, now); live['p' + i + 'aaaaa'] = R.cleanLive({}, now) })
  return { room, live }
}
const id = (i) => 'p' + i + 'aaaaa'

if (process.argv[2] !== 'live') {
  // ---- joining
  {
    const { room } = party(['Adam', 'Sam', 'adam'], 1000)
    ok(room.host === id(0) && room.players.length === 3, 'the first one in is the host')
    ok(room.players[2].name === 'adam 2', 'a name already taken gets a number: ' + room.players[2].name)
    ok(room.players.map((p) => p.color).join() === '0,1,2', 'everyone gets their own colour')
    for (let i = 3; i < 8; i++) R.addPlayer(room, id(i), 'P' + i, 1000)
    const r = R.addPlayer(room, 'p9aaaaa', 'Late', 1000)
    ok(room.players.length === 8 && r.error && r.status === 409, 'a ninth player is turned away: ' + r.error)
    ok(R.addPlayer(room, id(2), 'whatever', 2000).again === true && room.players.length === 8, 'coming back with your id is not a new player')
    { const { room: r2, live: l2 } = party(['A', 'B'], 1000)
      R.addPlayer(r2, id(1), 'B', 900000)
      ok(R.isHere(r2, l2, id(1), 905000) && !R.isHere(r2, l2, id(0), 905000) && l2[id(1)].t === 1000, 'someone who comes back is here again at once, and what their game last said is kept') }
    ok(R.cleanName('  f u c k  ') === 'Player' && R.cleanName('<b>Zoë!</b>') === 'bZo!b' && R.cleanName('') === 'Player', 'names are cleaned and filtered')
    ok(R.CODE_RE.test(R.makeCode()) && !/[AEIOUY]/.test(Array.from({ length: 200 }, () => R.makeCode()).join('')), 'party codes are four consonants')
  }
  // ---- the vote
  {
    const { room, live } = party(['A'], 1000)
    ok(R.startVote(room, live, WORLDS, 1000).error, 'one player can’t start a race')
  }
  {
    const { room, live } = party(['A', 'B', 'C'], 1000)
    const st = R.startVote(room, live, WORLDS, 1000, seq(0, 0, 0, 0))
    ok(st.ok && room.phase === 'vote' && room.opts.length === 4 && new Set(room.opts.map((o) => o.id)).size === 4 && room.until === 1000 + R.VOTE_MS && room.match === 1,
      'the vote: four different worlds, fifteen seconds: ' + room.opts.map((o) => o.id).join(', '))
    const [w0, w1] = room.opts.map((o) => o.id)
    live[id(0)] = R.cleanLive({ m: 1, vw: w0, vm: 'speed' }, 3000)
    live[id(1)] = R.cleanLive({ m: 1, vw: w1, vm: 'flaps' }, 3000)
    live[id(2)] = R.cleanLive({ m: 1 }, 3000)
    ok(!R.advance(room, live, {}, 5000).changed && room.phase === 'vote', 'the vote waits while someone here hasn’t voted')
    // the third never votes: at 15 s it's 1–1 on both, and the tie is picked at random among the tied
    live[id(2)] = R.cleanLive({ m: 1 }, 15500)
    R.advance(room, live, {}, 1000 + R.VOTE_MS, seq(0.99, 0))
    ok(room.phase === 'reveal' && room.world === w1 && room.mode === 'speed' && room.tally.tieWorld && room.tally.tieMode,
      `a tie is settled at random among the tied (${room.world}, ${room.mode}); the reveal follows`)
    ok(room.tally.world[w0] === 1 && room.tally.world[w1] === 1 && room.tally.mode.speed === 1 && room.tally.mode.flaps === 1, 'the tally is kept for the reveal')
  }
  {
    const { room, live } = party(['A', 'B', 'C'], 1000)
    R.startVote(room, live, WORLDS, 1000)
    const w = room.opts[2].id
    for (let i = 0; i < 3; i++) live[id(i)] = R.cleanLive({ m: 1, vw: i < 2 ? w : room.opts[0].id, vm: 'flaps' }, 4000)
    R.advance(room, live, {}, 4000)
    ok(room.phase === 'reveal' && room.world === w && room.mode === 'flaps' && !room.tally.tieWorld, 'when everyone here has voted, the vote ends early, and the most votes wins')
    const many = Array.from({ length: 400 }, () => R.pick(['a', 'b', 'c', 'd'], ['a', 'b', 'x'], Math.random).winner)
    ok(many.every((x) => x === 'a' || x === 'b') && many.includes('a') && many.includes('b'), 'a tie only ever picks among the tied')
    const none = Array.from({ length: 400 }, () => R.pick(['a', 'b', 'c', 'd'], [], Math.random).winner)
    ok(new Set(none).size === 4, 'no votes at all: any of the four')
    ok(R.cleanLive({ m: 1, vw: 'DROP TABLE', vm: 'fast' }, 1).vw === '' && R.cleanLive({ m: 1, vw: 'x', vm: 'fast' }, 1).vm === '', 'a vote for something that isn’t on the card doesn’t count')
  }
  // ---- the notes that let the games connect to each other directly
  {
    const big = 'x'.repeat(12001)
    const notes = R.cleanNotes([{ to: id(1), v: '{"t":"o"}' }, { to: id(0), v: '{"t":"o"}' }, { to: 'NOT AN ID', v: '{}' }, { to: id(2), v: big }, { to: id(2), v: 7 }, null], id(0))
    ok(notes.length === 1 && notes[0].to === id(1), 'a note goes to another player, is a bounded string, and is never to yourself')
    ok(R.cleanNotes(Array.from({ length: 40 }, () => ({ to: id(1), v: '{}' })), id(0)).length === 16, 'no more than a handful of notes a poll')
    const lv = R.cleanLive({ m: 1, n: 'ab12cd' }, 5)
    ok(lv.n === 'ab12cd' && R.cleanLive({ n: 'NOPE!' }, 5).n === '', 'each load of the page names itself, so the others know to connect again after a reload')
    ok(R.cleanLive({ lk: 'thunder:subway' }, 5).lk === 'thunder:subway' && R.cleanLive({ lk: '<b>:x' }, 5).lk === '' && R.cleanLive({ lk: 7 }, 5).lk === '',
      'each game says which ball and trail it has on, as two catalog ids')
    const rep = R.cleanLive({ d: 'v29 iOS 18.1 Safari | Sam:open/relay t0 h1s1r1\u0000\n' + 'x'.repeat(900) }, 5).d
    ok(rep.startsWith('v29 iOS 18.1 Safari | Sam:open/relay t0 h1s1r1x') && rep.length === 600 && R.cleanLive({ d: 7 }, 5).d === '', 'a game’s report on its links is kept as a short plain line')
    {
      const { room: r2, live: l2 } = party(['A', 'B'], 1000)
      l2[id(0)].d = 'v29 Mac Chrome | B:open/direct'
      const dg = R.diag(r2, l2, 1500)
      ok(dg.ok && dg.players.length === 2 && dg.players[0].d === 'v29 Mac Chrome | B:open/direct' && dg.players[1].d === '' && dg.players[0].name === 'A' && !('id' in dg.players[0]), 'the reports can be read back for the party: names and lines, no ids or keys')
    }
    const { room, live } = party(['A', 'B'], 1000)
    live[id(0)] = lv
    ok(R.view(room, live, {}, id(1), 2000).players[0].n === 'ab12cd', 'and the others are told that name')
    live[id(0)] = R.cleanLive({ m: 1, lk: 'galaxy:fire' }, 1900)
    ok(R.view(room, live, {}, id(1), 2000).players[0].lk === 'galaxy:fire' && !('lk' in R.view(room, live, {}, id(1), 2000).players[1]), 'and what they have on, in every phase')
    ok(R.iceServers()[0].urls.some((u) => u.startsWith('stun:')), 'the games are pointed at public STUN servers by default')
  }
  // ---- a hole, speed
  const play = (mode, fin, extra = {}) => {
    const { room, live } = party(['A', 'B', 'C', 'D'], 1000)
    R.startVote(room, live, WORLDS, 1000)
    for (let i = 0; i < 4; i++) live[id(i)] = R.cleanLive({ m: 1, vw: room.opts[0].id, vm: mode }, 2000)
    R.advance(room, live, {}, 2000)
    for (let i = 0; i < 4; i++) live[id(i)].t = 2000 + R.REVEAL_MS
    R.advance(room, live, {}, 2000 + R.REVEAL_MS)
    assert.equal(room.phase, 'hole')
    return { room, live, t0: room.startAt, ...extra }
  }
  {
    const { room, live, t0 } = play('speed')
    ok(room.hole === 0 && room.startAt === 2000 + R.REVEAL_MS + R.LEAD_MS && room.capAt === room.startAt + R.CAP_MS && room.racers.length === 4, 'hole 1 starts after the reveal, with a lead-in and a two-minute cap')
    const fins = {}
    for (let i = 0; i < 4; i++) live[id(i)].t = t0 + 20000
    fins[id(0)] = { k: 1500, f: 9, at: t0 + 13000 }
    fins[id(1)] = { k: 1200, f: 12, at: t0 + 11000 }
    ok(!R.advance(room, live, fins, t0 + 20000).changed && room.phase === 'hole', 'the hole goes on while someone is still out')
    fins[id(2)] = { dnf: 1, at: t0 + 21000 }
    fins[id(3)] = { k: 2400, f: 5, at: t0 + 21000 }
    for (let i = 0; i < 4; i++) live[id(i)].t = t0 + 21000
    R.advance(room, live, fins, t0 + 21000)
    const rows = room.results[0]
    ok(room.phase === 'board' && room.until === t0 + 21000 + R.BOARD_MS, 'everyone in or given up: the hole’s board comes up')
    ok(rows.map((r) => r.id).join() === [id(1), id(0), id(3), id(2)].join() && rows.map((r) => r.place).join() === '1,2,3,0', 'speed: fewest steps wins; a give-up is last')
    ok(rows.map((r) => r.tix).join() === '8,6,5,1' && rows.map((r) => r.pts).join() === '10,8,6,0', 'tickets by place: 8, 6, 5, and 1 for not finishing')
    R.advance(room, live, {}, room.until)
    ok(room.phase === 'hole' && room.hole === 1, 'then hole 2')
  }
  {
    const { room, live, t0 } = play('flaps')
    const fins = { [id(0)]: { k: 1500, f: 9, at: t0 + 13000 }, [id(1)]: { k: 1200, f: 12, at: t0 + 11000 }, [id(2)]: { k: 3000, f: 9, at: t0 + 30000 }, [id(3)]: { k: 2400, f: 5, at: t0 + 21000 } }
    for (let i = 0; i < 4; i++) live[id(i)].t = t0 + 30000
    R.advance(room, live, fins, t0 + 30000)
    ok(room.results[0].map((r) => r.id).join() === [id(3), id(0), id(2), id(1)].join(), 'flaps: fewest flaps wins, and the quicker of two tied on flaps is ahead')
  }
  {
    // speed, two in on the very same step: the one who took fewer flaps is ahead, whoever reported first
    const { room, live, t0 } = play('speed')
    const fins = { [id(0)]: { k: 1500, f: 9, at: t0 + 13000 }, [id(1)]: { k: 1500, f: 7, at: t0 + 13500 }, [id(2)]: { k: 1400, f: 11, at: t0 + 12000 }, [id(3)]: { k: 1500, f: 9, at: t0 + 13200 } }
    for (let i = 0; i < 4; i++) live[id(i)].t = t0 + 30000
    R.advance(room, live, fins, t0 + 30000)
    ok(room.results[0].map((r) => r.id).join() === [id(2), id(1), id(0), id(3)].join(), 'speed: of those tied on time, fewest flaps is ahead (and dead level, the first to report)')
  }
  {
    const { room, live, t0 } = play('speed')
    // one sank it, one walked away (not heard from), two never finish: the cap ends it
    const fins = { [id(0)]: { k: 900, f: 6, at: t0 + 8000 } }
    live[id(0)].t = live[id(2)].t = live[id(3)].t = t0 + 60000
    ok(!R.advance(room, live, fins, t0 + 60000).changed, 'still going at one minute')
    live[id(0)].t = live[id(2)].t = live[id(3)].t = t0 + R.CAP_MS + R.GRACE_MS
    R.advance(room, live, fins, t0 + R.CAP_MS + R.GRACE_MS)
    ok(room.phase === 'board' && room.results[0].filter((r) => r.dnf).length === 3 && room.results[0][0].id === id(0), 'the cap ends the hole: everyone still out didn’t finish')
  }
  {
    const { room, live, t0 } = play('speed')
    const fins = { [id(0)]: { k: 900, f: 6, at: t0 + 8000 }, [id(1)]: { k: 1000, f: 6, at: t0 + 9000 }, [id(2)]: { k: 1100, f: 6, at: t0 + 10000 } }
    for (let i = 0; i < 3; i++) live[id(i)].t = t0 + 10000 + R.AWAY_MS
    live[id(3)].t = t0 + 9000
    R.advance(room, live, fins, t0 + 10000 + R.AWAY_MS)
    ok(room.phase === 'board' && room.results[0][3].dnf === 1, 'someone who’s gone quiet doesn’t hold the hole up')
  }
  {
    const { room, live, t0 } = play('speed')
    ok(!R.plausible({ k: 2400, f: 3, at: t0 + 5000 }, room) && R.plausible({ k: 590, f: 3, at: t0 + 5000 }, room) && !R.plausible({ k: 100, f: 1, at: t0 - 500 }, room),
      'a finish in more steps than the clock has had, or before the start, doesn’t count')
    ok(R.finValue({ k: 812, f: 7 }, 99) === '812:7:99|' && R.finValue({ dnf: 1 }, 99) === 'x:0:99|' && R.finValue({ k: 812, f: 7 }, 99, '1:1,9:K').endsWith('|1:1,9:K') && R.parseFin('812:7:99|1:1,9:K').in === '1:1,9:K' && R.parseFin('812:7:99').in === undefined && R.finValue({ k: -4, f: 1 }, 9) === null && R.parseFin('812:7:99').k === 812 && R.parseFin('x:0:99').dnf === 1, 'finishes pack and unpack')
    const lv = R.cleanLive({ m: 1, h: 0, k: 300, f: 2, in: '12:1,80:-1,150:R,200:0' }, 5)
    ok(lv.in === '12:1,80:-1,150:R,200:0' && R.cleanLive({ in: '12:1;DROP' }, 5).in === null && R.cleanLive({ in: '1:1,'.repeat(5000) }, 5).in === null && R.cleanLive({}, 5).in === '', 'flaps travel as "step:side"; anything else is dropped (and marked as not fitting)')
    const big = Array.from({ length: 2500 }, (_, i) => `${i * 3}:1`).join(',')
    ok(R.cleanLive({ in: big }, 5).in === big && R.finValue({ k: 9, f: 1 }, 5, big).endsWith(big) && R.finValue({ k: 9, f: 1 }, 5, null) === '9:1:5' && R.parseFin(R.finValue({ k: 9, f: 1 }, 5, null)).in === undefined,
      'a long brawl’s inputs (2,500 taps) still fit and are sealed with the finish; ones that don’t fit aren’t sealed (the hole isn’t replayed)')
    live[id(0)] = R.cleanLive({ m: 1, h: 0, k: 300, f: 2, in: '12:1' }, t0 + 1000)
    ok(!('in' in R.view(room, live, {}, id(0), t0 + 1000).players[0]) && R.view(room, live, {}, id(1), t0 + 1000).players[0].in === '12:1', 'in speed and flaps your own flaps aren’t sent back to you (only the others’)')
  }
  // ---- Knockout (2.11): speed with live balls hitting each other
  const playKO = (kv = [2, 2, 2, 2], votes = ['knockout', 'knockout', 'knockout', 'speed']) => {
    const { room, live } = party(['A', 'B', 'C', 'D'], 1000)
    R.startVote(room, live, WORLDS, 1000)
    for (let i = 0; i < 4; i++) live[id(i)] = R.cleanLive({ m: 1, vw: room.opts[0].id, vm: votes[i], kv: kv[i] }, 2000)
    R.advance(room, live, {}, 2000, seq(0.5))
    for (let i = 0; i < 4; i++) live[id(i)].t = 2000 + R.REVEAL_MS
    R.advance(room, live, {}, 2000 + R.REVEAL_MS, seq(0.25, 0.75))
    return { room, live, t0: room.startAt }
  }
  {
    ok(R.MODES.includes('knockout') && R.cleanLive({ vm: 'knockout' }, 1).vm === 'knockout', 'Knockout is a mode on the vote, next to speed and flaps')
    const { room, live, t0 } = playKO()
    ok(room.mode === 'knockout' && room.phase === 'hole' && room.tally.mode.knockout === 3, 'the most votes wins: Knockout')
    ok(room.seed > 0 && Number.isInteger(room.seed) && R.view(room, live, {}, id(0), t0).seed === room.seed, 'each Knockout hole gets a seed, handed to every game with the party')
    const s1 = room.seed
    const fins = { [id(0)]: { k: 1500, f: 9, at: t0 + 13000 }, [id(1)]: { k: 1500, f: 7, at: t0 + 13500 }, [id(2)]: { k: 1400, f: 11, at: t0 + 12000 }, [id(3)]: { dnf: 1, at: t0 + 13000 } }
    for (let i = 0; i < 4; i++) live[id(i)] = { ...R.cleanLive({ m: 1, h: 0, kv: 2, in: '12:1,40:U,80:-1,150:R', kt: i === 1 ? `${id(0)}:2,${id(2)}:1` : i === 2 ? `${id(0)}:1,${id(2)}:1,${id(1)}:1` : '' }, t0 + 30000) }
    ok(live[id(0)].in === '12:1,40:U,80:-1,150:R', 'item use travels as "step:U" with the flaps')
    { const me = R.view(room, live, {}, id(0), t0 + 30000).players.find((p) => p.id === id(0))
      ok(me.in === '12:1,40:U,80:-1,150:R', 'in Knockout your own inputs come back to you too (a reload mid-hole puts them back: the same world as everyone’s)') }
    ok(JSON.stringify(R.cleanTally(`${id(0)}:2,junk,${id(1)}:x,ZZ:3`)) === JSON.stringify({ [id(0)]: 2 }) && JSON.stringify(R.cleanTally('x'.repeat(500))) === '{}', 'a KO tally is cleaned (ids and counts only)')
    R.advance(room, live, fins, t0 + 30000)
    const rows = room.results[0]
    ok(rows.map((r) => r.id).join() === [id(2), id(1), id(0), id(3)].join(), 'Knockout is won as speed is: fastest time; tied on time, fewer flaps')
    ok(rows.find((r) => r.id === id(0)).ko === 2 && rows.find((r) => r.id === id(2)).ko === 1 && rows.find((r) => r.id === id(1)).ko === 1 && rows.find((r) => r.id === id(3)).ko === 0,
      'KOs on the hole board: the most any game reported for each player')
    ok(rows.map((r) => r.tix).join() === '8,6,5,1' && rows.map((r) => r.pts).join() === '10,8,6,0', 'tickets and match points the way race tickets work now')
    ok(rows[0].place === 1 && rows.find((r) => r.id === id(0)).place === 3, 'KOs are a stat, not a tiebreaker (most KOs, third)')
    ok(room.phase === 'board' && R.view(room, live, {}, id(1), t0 + 30000).players[0].in === '12:1,40:U,80:-1,150:R', 'during the hole’s board the flaps are still handed out (the last ones in, for a game hearing through the server)')
    R.advance(room, live, {}, room.until)
    ok(room.phase === 'hole' && room.hole === 1 && room.seed > 0 && room.seed !== s1, 'the next hole gets a seed of its own')
    // the match: KOs add up in the standings
    for (let i = 0; i < 4; i++) live[id(i)] = R.cleanLive({ m: 1, h: 1, kv: 2, kt: `${id(3)}:3` }, room.startAt + 9000)
    R.advance(room, live, { [id(3)]: { k: 900, f: 4, at: room.startAt + 9000 } }, room.startAt + R.CAP_MS + R.GRACE_MS)
    ok(room.totals[id(0)].ko === 2 && room.totals[id(3)].ko === 3, 'and add up over the match', JSON.stringify(Object.fromEntries(Object.entries(room.totals).map(([k, t]) => [k, t.ko]))))
    ok(R.finalOrder(room).every((r) => typeof r.ko === 'number') && R.finalOrder(room).find((r) => r.id === id(3)).ko === 3, 'the final standings carry each player’s KOs')
  }
  {
    // someone here is on a game from before Knockout: it's speed or flaps instead
    const { room } = playKO([2, 2, 1, 2], ['knockout', 'knockout', 'flaps', 'speed'])
    ok(room.mode !== 'knockout' && ['speed', 'flaps'].includes(room.mode) && room.tally.koOff && room.tally.mode.knockout === 2, `Knockout needs every game here to know it: with one from before it, it’s ${room.mode} (the tally still shows the votes)`)
    ok(room.seed === 0, 'and no seed')
    const { room: r2 } = playKO([2, 2, 2, 2], ['speed', 'speed', 'flaps', 'knockout'])
    ok(r2.mode === 'speed' && !r2.seed, 'speed with the most votes is still speed (no seed)')
  }
  // ---- Knockout 2.12: the server's own replay, the records' candidates, the mixed-version fallback
  {
    ok(R.cleanLive({ in: '12:1,40:K,90:U,95:G,99:L' }, 1).in === '12:1,40:K,90:U,95:G,99:L', 'the last-ball unlock (K, or L), and giving up (G), travel with the inputs')
    const { room } = playKO([2, 1, 2, 2], ['knockout', 'knockout', 'knockout', 'speed'])
    ok(room.mode !== 'knockout' && room.tally.koOff && JSON.stringify(room.tally.koOld) === JSON.stringify(['B']), 'a 2.11 game in the party: no Knockout, and the reveal names who should reload', JSON.stringify(room.tally.koOld))
  }
  {
    const { room, live, t0 } = playKO()
    room.players[0].acct = { u: 'uA', n: 'Adam' }; room.players[1].acct = { u: 'uB', n: 'Sam' }; room.players[2].acct = { u: 'uC', n: 'Kat' }
    const calls = []
    const kor = { holeOf: (w, h) => `${w}#${h}`, replay: (a) => { calls.push(a); return { T: 2000, hash: 'h1', fins: { [id(0)]: { k: 1400, f: 9 }, [id(1)]: { k: 1500, f: 7 }, [id(2)]: null, [id(3)]: null }, kos: { [id(0)]: 0, [id(1)]: 2, [id(2)]: 1, [id(3)]: 0 } } } }
    for (let i = 0; i < 4; i++) live[id(i)].t = t0 + 30000
    // (A claims a far better time than it had: 300 steps)
    const fins = { [id(0)]: { k: 300, f: 1, at: t0 + 13000, in: '2:1,9:1,40:1' }, [id(1)]: { k: 1500, f: 7, at: t0 + 13500, in: '3:1,500:1' },
      [id(2)]: { dnf: 1, at: t0 + 14000, in: '5:-1' }, [id(3)]: { dnf: 1, at: t0 + 15000, in: '' } }
    R.advance(room, live, fins, t0 + 30000, Math.random, kor)
    const c = calls[0]
    ok(calls.length === 1 && c.hole === `${room.world}#0` && c.seed === room.seed && c.inputs[id(0)].length === 3 && c.inputs[id(1)][1][0] === 500,
      'with every racer’s inputs in (each sealed with their finish or give-up), the server replays the hole: everyone’s inputs and the seed')
    ok(c.until >= 1500 + 600 && c.until <= R.CAP_MS / 1000 * R.HZ, 'it plays as far as the last finish or input and a little more (never past the cap)', String(c.until))
    const recA = room.koRec.find((r) => r.u === 'uA'), recB = room.koRec.find((r) => r.u === 'uB')
    ok(recA && recA.k === 1400 && recA.f === 9, 'a tampered claim doesn’t count: the record candidate is the replay’s 1400 steps, not the claimed 300')
    ok(recB && recB.k === 1500 && room.koRec.length === 2 && !room.koRec.some((r) => r.u === 'uC'), 'only balls the replay saw go in are candidates')
    ok(room.results[0].find((r) => r.id === id(1)).ko === 2 && room.results[0].find((r) => r.id === id(2)).ko === 1, 'the board’s KOs are the server’s own count once it’s replayed')
    ok(room.kov[0].hash === 'h1' && R.view(room, live, {}, id(1), t0 + 30000).kov[0].T === 2000, 'the replay’s fingerprint goes out with the party (every game can check its own against it)')
    live[id(1)] = R.cleanLive({ m: 1, h: -1 }, t0 + 31000)          // (B's game on the board: its poll no longer carries the hole's inputs)
    ok(R.view(room, live, fins, id(0), t0 + 31000).players[1].in === '3:1,500:1', 'during the board every game is handed each player’s sealed inputs (what the server replayed), not their latest poll')
  }
  {
    // a racer whose inputs never came in (left without finishing): nothing is replayed, no records, no match record
    const { room, live, t0 } = playKO()
    room.players.forEach((p, i) => { p.acct = { u: 'u' + i, n: p.name } })
    const kor = { holeOf: () => 'x', replay: () => { throw new Error('should not replay') } }
    for (let i = 0; i < 4; i++) live[id(i)].t = t0 + 30000
    live[id(3)].t = t0 - 60000                          // (D went quiet: away)
    const fins = { [id(0)]: { k: 1400, f: 9, at: t0 + 13000, in: '2:1' }, [id(1)]: { k: 1500, f: 7, at: t0 + 13500, in: '3:1' }, [id(2)]: { dnf: 1, at: t0 + 14000, in: '' } }
    R.advance(room, live, fins, t0 + 30000, Math.random, kor)
    ok(room.phase === 'board' && room.kov[0] === null && room.koRec.length === 0 && room.koVbad === 1, 'missing anyone’s inputs (someone went quiet without finishing): no replay, no record candidates')
    // …and a finish from before 2.12 (no inputs with it) can't be replayed either
    ok(R.koVerify({ ...room, hole: 0 }, { [id(0)]: { k: 9, f: 1, at: 1 } }, kor) === null, 'nor a finish with no inputs sealed to it')
    const kor2 = { holeOf: () => 'x', replay: () => { throw new Error('should not replay') } }
    const all4 = Object.fromEntries([0, 1, 2, 3].map((i) => [id(i), { k: 900, f: 4, at: 1, in: i === 2 ? '5:1,600:L' : '5:1' }]))
    ok(R.koVerify({ ...room, phase: 'hole', hole: 0, racers: [0, 1, 2, 3].map(id) }, all4, kor2) === null, 'nor a hole where a last ball was opened because someone left (L)')
  }
  {
    // the most KOs in a match: only when every hole was replayed; signed in; at least one
    const { room, live, t0 } = playKO()
    room.holes = 1
    room.players[0].acct = { u: 'uA', n: 'Adam' }; room.players[1].acct = { u: 'uB', n: 'Sam' }
    const kor = { holeOf: () => 'h', replay: () => ({ T: 900, hash: 'z', fins: { [id(0)]: { k: 800, f: 5 }, [id(1)]: null, [id(2)]: null, [id(3)]: null }, kos: { [id(0)]: 0, [id(1)]: 3, [id(2)]: 2, [id(3)]: 0 } }) }
    for (let i = 0; i < 4; i++) live[id(i)].t = t0 + 30000
    const fins = { [id(0)]: { k: 800, f: 5, at: t0 + 9000, in: '1:1' }, [id(1)]: { dnf: 1, at: t0 + 9000, in: '' }, [id(2)]: { dnf: 1, at: t0 + 9000, in: '' }, [id(3)]: { dnf: 1, at: t0 + 9000, in: '' } }
    R.advance(room, live, fins, t0 + 30000, Math.random, kor)
    R.advance(room, live, {}, room.until, Math.random, kor)
    ok(room.phase === 'final' && room.koMatch.length === 1 && room.koMatch[0].u === 'uB' && room.koMatch[0].ko === 3 && room.koMatch[0].world === room.world,
      'the match’s KOs, counted by the server, go up for the world’s Most KOs record (signed in, at least one; Kat had 2 but no account)', JSON.stringify(room.koMatch))
  }
  // ---- a whole match
  {
    const { room, live } = party(['A', 'B', 'C', 'D'], 1000)
    R.startVote(room, live, WORLDS, 1000)
    for (let i = 0; i < 4; i++) live[id(i)] = R.cleanLive({ m: 1, vw: room.opts[1].id, vm: 'speed' }, 1500)
    let now = 1500
    R.advance(room, live, {}, now)
    now = room.until; for (let i = 0; i < 4; i++) live[id(i)].t = now
    R.advance(room, live, {}, now)
    for (let h = 0; h < 9; h++) {
      assert.equal(room.phase, 'hole'); assert.equal(room.hole, h)
      now = room.startAt + 12000
      // A wins every hole, B is second, C third; D doesn't finish the last three
      const fins = { [id(0)]: { k: 1000, f: 5, at: now }, [id(1)]: { k: 1100, f: 5, at: now }, [id(2)]: { k: 1200, f: 5, at: now }, [id(3)]: h < 6 ? { k: 1300, f: 5, at: now } : { dnf: 1, at: now } }
      for (let i = 0; i < 4; i++) live[id(i)].t = now
      R.advance(room, live, fins, now)
      assert.equal(room.phase, 'board')
      now = room.until; for (let i = 0; i < 4; i++) live[id(i)].t = now
      R.advance(room, live, {}, now)
    }
    const F = room.final
    ok(room.phase === 'final' && F.map((r) => r.id).join() === [id(0), id(1), id(2), id(3)].join(), 'after nine holes: the final standings')
    ok(F.map((r) => r.bonus).join() === '20,12,6,0' && F[0].pts === 90 && F[0].wins === 9, 'the match bonus: 20, 12, 6')
    ok(F[0].tix === 72 && F[3].tix === 6 * 4 + 3 && room.results.length === 9, `tickets add up over the match (winner ${F[0].tix} + ${F[0].bonus}, last ${F[3].tix})`)
    const v = R.view(room, live, {}, id(1), now)
    ok(v.final && v.players.length === 4 && !JSON.stringify(v).includes('"key"'), 'the view carries the standings and no secrets')
    now = room.until; for (let i = 0; i < 4; i++) live[id(i)].t = now
    const st = R.advance(room, live, {}, now)
    ok(room.phase === 'lobby' && st.clear, 'then back to the lobby')
  }
  // ---- the host, and people coming and going
  {
    const { room, live } = party(['A', 'B', 'C'], 1000)
    live[id(1)].t = live[id(2)].t = 1000 + R.AWAY_MS + 5
    R.advance(room, live, {}, 1000 + R.AWAY_MS + 5)
    ok(room.host === id(1), 'the host has gone quiet: the next one here takes over')
    live[id(1)].t = live[id(2)].t = 1000 + R.GONE_MS + 5
    R.advance(room, live, {}, 1000 + R.GONE_MS + 5)
    ok(room.players.length === 2 && !room.players.some((p) => p.id === id(0)), 'in the lobby, someone long gone comes off the list')
    R.removePlayer(room, id(1))
    ok(room.host === id(2) && room.players.length === 1, 'the host leaves: the next player is the host')
    const ws = R.cleanWorlds([{ id: 'boston', n: 9 }, { id: 'boston', n: 9 }, { id: '../etc', n: 9 }, { id: 'la', n: 400 }, null])
    ok(ws.length === 2 && ws[1].n === 18, 'the worlds on offer are checked')
  }
  console.log(process.exitCode ? '\nFAILED' : `\nall ${n} passed`)
} else {
  // ---- live: three players through a whole match, against the endpoint -----------
  const base = process.argv[3] || 'http://127.0.0.1:8791'
  const call = async (b) => { const r = await fetch(base + '/api/race', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) } }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const cmd0 = Number(await (await fetch(base + '/__commands')).text().catch(() => 0)) || 0
  const a = await call({ a: 'create', name: 'Adam' })
  ok(a.ok && R.CODE_RE.test(a.code) && a.key && a.phase === 'lobby', 'create: ' + a.code)
  const code = a.code
  ok((await call({ a: 'join', code: 'ZZZZ', name: 'x' })).status === 404, 'a wrong code: no party has that code')
  ok((await call({ a: 'poll', code, id: a.you, key: 'nope' })).status === 403, 'a poll without the key is refused')
  ok((await call({ a: 'start', code, id: a.you, key: a.key, worlds: WORLDS })).status === 409, 'start with one player is refused')
  const b = await call({ a: 'join', code: code.toLowerCase(), name: 'Sam' })
  const c = await call({ a: 'join', code, name: 'Adam' })
  ok(b.ok && c.ok && c.players.length === 3 && c.players[2].name === 'Adam 2', 'two join (the code in lower case works; a taken name gets a number)')
  const again = await call({ a: 'join', code, name: 'Sam', id: b.you, key: b.key })
  ok(again.you === b.you && again.players.length === 3, 'joining again with your id brings you back as yourself')
  const P = [a, b, c].map((x) => ({ id: x.you, key: x.key }))
  ok(Array.isArray(b.ice) && b.ice.length > 0, 'joining says where the games can look for a way to each other')
  // a note from A to B is handed to B once, and to nobody else
  await call({ a: 'poll', code, id: a.you, key: a.key, me: { n: 'aaaa11' }, sig: [{ to: b.you, v: '{"t":"o","g":1}' }, { to: 'zzzzzzzz', v: '{}' }] })
  const forC = await call({ a: 'poll', code, id: c.you, key: c.key, me: { n: 'cccc33' } })
  const forB = await call({ a: 'poll', code, id: b.you, key: b.key, me: { n: 'bbbb22' } })
  const again2 = await call({ a: 'poll', code, id: b.you, key: b.key, me: { n: 'bbbb22' } })
  ok(!forC.sig && forB.sig && forB.sig.length === 1 && forB.sig[0].from === a.you && forB.sig[0].v === '{"t":"o","g":1}' && !again2.sig, 'a note for another game is handed over on its next poll, once')
  ok(forB.players.find((p) => p.id === a.you).n === 'aaaa11', 'and each player’s page name comes back with the party')
  // a game's report on its links, read back by the party's code
  await call({ a: 'poll', code, id: a.you, key: a.key, me: { n: 'aaaa11', d: 'v29 test | Sam:open/direct t0 h1s1r0' } })
  const dg = await (await fetch(base + '/api/race?diag=' + code)).json()
  ok(dg.ok && dg.players.length === 3 && dg.players[0].d === 'v29 test | Sam:open/direct t0 h1s1r0' && typeof dg.relay === 'boolean' && !JSON.stringify(dg).includes(a.key), 'a party’s link reports can be read back by its code (and nothing secret with them)')
  ok((await fetch(base + '/api/race?diag=ZZZZ')).status === 404, 'and a code with no party says so')
  ok((await call({ a: 'start', code, id: b.you, key: b.key, worlds: WORLDS })).status === 403, 'only the host starts the vote')
  let v = await call({ a: 'start', code, id: a.you, key: a.key, worlds: WORLDS })
  ok(v.phase === 'vote' && v.opts.length === 4 && Math.abs(v.until - v.now - R.VOTE_MS) < 500, 'the vote opens: ' + v.opts.map((o) => o.id).join(', '))
  const want = v.opts[3].id
  const poll = (i, me, fin) => call({ a: 'poll', code, id: P[i].id, key: P[i].key, me: { m: 1, ...me }, fin })
  await poll(0, { vw: want, vm: 'flaps' }); await poll(1, { vw: want, vm: 'flaps' })
  v = await poll(2, { vw: v.opts[0].id, vm: 'speed' })
  ok(v.phase === 'reveal' && v.world === want && v.mode === 'flaps' && v.tally.world[want] === 2, `all three voted: ${v.world}, ${v.mode}, straight to the reveal`)
  let total = [0, 0, 0]
  for (let h = 0; h < 9; h++) {
    for (;;) { v = await poll(0, { h }); await poll(1, { h }); await poll(2, { h }); if (v.phase === 'hole' && v.hole === h) break; await sleep(700) }
    if (h === 0) ok(v.racers.length === 3 && v.startAt > v.now && v.capAt - v.startAt === R.CAP_MS, 'hole 1 is on, the start a few seconds off')
    await sleep(Math.max(0, v.startAt - v.now) + 2600)
    // flaps 4, 6 and 5 (the third gives up on hole 5); steps well inside the clock
    await poll(0, { h, k: 200, f: 4, in: '10:1,60:1,110:-1,150:1' }, { k: 200, f: 4 })
    const mid = await poll(1, { h, k: 150, f: 3, in: '10:1,60:1,110:R' })
    if (h === 0) ok(mid.phase === 'hole' && mid.players[0].fin && mid.players[0].fin.f === 4 && mid.players[0].in === '10:1,60:1,110:-1,150:1' && !mid.players[1].in,
      'mid-hole: the others’ flaps and finishes come back on a poll (your own flaps don’t)')
    await poll(1, { h, k: 260, f: 6, in: '10:1,60:1,110:R,150:1' }, { k: 260, f: 6 })
    v = await poll(2, { h, k: 240, f: 5 }, h === 4 ? { dnf: 1 } : { k: 240, f: 5 })
    const rows = v.results[h]
    const exp = h === 4 ? [P[0].id, P[1].id, P[2].id] : [P[0].id, P[2].id, P[1].id]
    if (h === 0 || h === 4 || h === 8) ok(v.phase === 'board' && rows.map((r) => r.id).join() === exp.join() && rows[0].tix === 8 && rows[2].tix === (h === 4 ? 1 : 5), `hole ${h + 1}’s board: ${rows.map((r) => (r.dnf ? 'DNF' : r.f)).join(', ')}`)
    rows.forEach((r) => { total[P.findIndex((p) => p.id === r.id)] += r.tix })
  }
  for (;;) { v = await poll(0, { h: 8 }); await poll(1, { h: 8 }); await poll(2, { h: 8 }); if (v.phase === 'final') break; await sleep(700) }
  ok(v.final.map((r) => r.id).join() === [P[0].id, P[2].id, P[1].id].join() && v.final.map((r) => r.bonus).join() === '20,12,6', 'the final standings and the bonus')
  ok(v.final[0].tix === total[0] && v.final[1].tix === total[2] && total[0] === 72, `tickets: ${total.join(', ')} before the bonus`)
  ok((await call({ a: 'lobby', code, id: P[1].id, key: P[1].key })).status === 403, 'only the host takes the party back to the lobby')
  v = await call({ a: 'lobby', code, id: P[0].id, key: P[0].key })
  ok(v.phase === 'lobby' && v.players.length === 3, 'back to the lobby, everyone still in')
  v = await call({ a: 'start', code, id: P[0].id, key: P[0].key, worlds: WORLDS })
  ok(v.phase === 'vote' && v.match === 2 && v.results.length === 0, 'and a second match can start')
  await call({ a: 'leave', code, id: P[0].id, key: P[0].key })
  v = await call({ a: 'poll', code, id: P[1].id, key: P[1].key, me: { m: 2 } })
  ok(v.players.length === 2 && v.host === P[1].id, 'the host leaves: the next player is the host')
  ok((await call({ a: 'poll', code, id: P[0].id, key: P[0].key, me: { m: 2 } })).status === 410, 'the one who left is out')
  await call({ a: 'leave', code, id: P[1].id, key: P[1].key }); await call({ a: 'leave', code, id: P[2].id, key: P[2].key })
  ok((await call({ a: 'join', code, name: 'x' })).status === 404, 'the last one out closes the party')
  const cmd1 = Number(await (await fetch(base + '/__commands')).text().catch(() => 0)) || 0
  console.log(`redis commands used: ${cmd1 - cmd0}`)
  console.log(process.exitCode ? '\nFAILED' : `\nall ${n} passed`)
}
