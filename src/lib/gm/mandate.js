// WHAT OWNERSHIP ACTUALLY ASKED FOR.
//
// The old mandate was four buckets off projected wins — develop at 28, playoffs at 44, win a
// round at 48, title at 55 — and the middle bucket is enormous, so almost every club in the
// league opened with "make the playoffs, about forty-four wins". Two very different jobs, a
// thirty-eight-win team with three firsts and a fifty-win team with none, were handed the same
// sentence. That is not a mandate, it is a default.
//
// Two things fix it. The number is DERIVED rather than looked up — a precise target off this
// roster's own projection, so it is 47 for one club and 31 for another and never 44 for both.
// And the season is not one number: an owner who hands you a rebuild also wants to see the
// twenty-year-old play, and an owner who hands you a contention year also wants out of the tax.
// So there is a primary goal and two or three secondary objectives, drawn from the actual
// roster and the actual asset pool, graded separately at the end of the year.
//
// Every objective here has to be CHECKABLE from the save at the end of the season. An
// objective nobody can grade is a slogan.
import { SEED } from './seed.js'
import { teamContext } from './trade/context.js'
import { playerMarketValue } from './trade/market.js'
import { ownedBy } from './picks.js'
import { teamSalary, status as capStatus, CBA } from './cap.js'
import { rostersOf } from './league.js'
import { NEED_WEIGHT_FLOOR } from './advisor.js'

const money = (n) => `$${(Math.abs(n) / 1e6).toFixed(0)}M`
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

/* ------------------------------------------------------------------ the primary */

// Rounds, named the way a broadcast names them.
export const ROUND_LABEL = ['miss the playoffs', 'reach the playoffs', 'win a round',
  'reach the conference finals', 'reach the Finals', 'win it']

// The ask is the projection plus what ownership thinks it is owed — and the bump SHRINKS as
// the projection rises, because wins get harder to add at the top. A flat percentage asked a
// sixty-six-win Oklahoma City for seventy, which no owner says out loud, while a
// thirty-win club got a bump so small it was not an ask at all.
export const ambitionAt = (proj) => (proj < 45 ? 3 : proj < 55 ? 2 : 1)

export function primaryFor(ctx) {
  const proj = ctx.wins ?? 41
  const ask = Math.round(proj + ambitionAt(proj))

  // A genuine contender is judged on the bracket, not the record. Forty-eight wins and a first
  // round exit is a bad year for a team built to win, and no win total says that.
  if (ctx.contention > 0.72 && (ctx.title ?? 0) > 0.18) {
    return { kind: 'round', n: 4, wins: ask,
      label: 'Reach the Finals',
      line: 'This roster was assembled to play in June. Ownership is not interested in a good regular season.' }
  }
  if (ctx.contention > 0.62) {
    return { kind: 'round', n: 3, wins: ask,
      label: 'Reach the conference finals',
      line: `They expect about ${ask} wins on the way, but the year is judged in May.` }
  }
  if (ctx.contention > 0.48) {
    return { kind: 'round', n: 2, wins: ask,
      label: 'Win a playoff round',
      line: `Get to ${ask} wins and win a series. A first-round exit is treading water.` }
  }
  if (ctx.contention > 0.3) {
    return { kind: 'wins', n: ask,
      label: `Win ${ask} games`,
      line: `The play-in is the floor. ${ask} wins is what the roster says you should get to.` }
  }
  // Below that it stops being about wins at all, and the honest mandate says so out loud
  // rather than setting a number nobody expects you to hit.
  //
  // Which of the two bad-team mandates you get turns on whether there is anybody to develop.
  // Average core age is the wrong test — it said Portland, with Donovan Clingan on it, should
  // be stripped for parts, because two thirty-somethings on the end of the bench dragged the
  // mean up. The right question is literally the one the mandate asks: are there two young
  // men here worth giving the minutes to?
  const prospects = (ctx.youngTalent ?? 0)
  if (prospects >= 2) {
    return { kind: 'develop', n: 2, wins: Math.max(20, ask),
      label: 'Develop two young players into starters',
      line: 'Nobody is counting wins this year. They want to see two of the kids become rotation players you can win with.' }
  }
  return { kind: 'assets', n: 4,
    label: 'Come out of the year with four first-round picks',
    line: 'This roster is not going anywhere and everybody knows it. Turn what you have into what comes next.' }
}

// Men young enough to still be becoming something, and good enough that it matters.
export const youngTalentIn = (roster) => (roster || []).filter((p) => (p.a ?? 30) <= 23.9
  && ((p.upside ?? 0) >= 0.45 || playerMarketValue(p).tier >= 2)).length

/* ---------------------------------------------------------------- the secondaries */

// Two or three, each pulled off something real: a man on the roster, a number on the cap
// sheet, a hole the fit model can see. Never generic — "improve the defence" is not an
// objective, "finish outside the bottom ten in point-of-attack defence" is.
export function secondariesFor(team, save, ctx, opts = {}) {
  const roster = opts.roster || rostersOf(team)
  const out = []
  const salary = teamSalary(roster)
  const st = capStatus(salary)

  // 1. A young man ownership wants to see on the floor. The most promising player who is not
  //    already playing starter minutes — which is exactly the argument a front office has with
  //    its coach every year.
  const kid = roster
    .filter((p) => (p.a ?? 30) <= 23 && (p.mpg ?? 0) < 30)
    .map((p) => ({ p, m: playerMarketValue(p) }))
    .sort((a, b) => (b.p.upside ?? 0.4) - (a.p.upside ?? 0.4) || b.m.value - a.m.value)[0]
  if (kid) {
    const want = clamp(Math.round((kid.p.mpg ?? 12) + 8), 20, 32)
    out.push({ id: 'minutes', kind: 'minutes', who: kid.p.n, n: want,
      label: `Play ${kid.p.n} ${want} minutes a night`,
      detail: `He is ${Math.round(kid.p.a)} and averaged ${Math.round(kid.p.mpg ?? 0)}. `
        + 'Development is measured in minutes, and ownership has noticed.' })
  }

  // 2. Money, stated as the number on the sheet rather than as a mood.
  if (st.overApron2) {
    out.push({ id: 'apron', kind: 'salary_under', n: CBA.apron2,
      label: `Get under the second apron (${money(CBA.apron2)})`,
      detail: `You are ${money(salary - CBA.apron2)} over it, and over it you cannot aggregate `
        + 'salary, cannot take back more than you send, and your pick seven years out freezes.' })
  } else if (salary > CBA.tax) {
    out.push({ id: 'tax', kind: 'salary_under', n: CBA.tax,
      label: `Get the payroll under the tax line (${money(CBA.tax)})`,
      detail: `${money(salary - CBA.tax)} over. Ownership pays that bill and would rather not.` })
  } else if (ctx.contention > 0.5) {
    const room = Math.round(CBA.apron1 - salary)
    out.push({ id: 'stay_flexible', kind: 'salary_under', n: CBA.apron1,
      label: `Stay under the first apron (${money(CBA.apron1)})`,
      detail: `You have ${money(room)} of room. Crossing it costs you the mid-level and `
        + 'sign-and-trades — the two ways a team this close adds a player.' })
  }

  // 3. Draft capital, in the direction this club actually needs it to move.
  const firsts = (ownedBy(save.picks || {}, team) || []).filter((p) => p.round === 1 && !p.forfeit)
  if (ctx.contention > 0.55 && firsts.length >= 4) {
    out.push({ id: 'spend', kind: 'picks_below', n: firsts.length - 1,
      label: 'Turn draft capital into a player who helps now',
      detail: `${firsts.length} firsts on the books and a window that is open. Picks do not `
        + 'win playoff series.' })
  } else if (ctx.contention < 0.45 && firsts.length < 5) {
    out.push({ id: 'stockpile', kind: 'picks_atleast', n: firsts.length + 1,
      label: `Finish the year holding at least ${firsts.length + 1} first-round picks`,
      detail: `${firsts.length} today. A rebuild that does not accumulate capital is just a bad team.` })
  }

  // 4. The hole the fit model can see, named on its own axis.
  // Only axes the fit model actually weights. Size came out at 0.005 in the ridge — thirty
  // teams' worth of evidence that team height does not move the needle — so "stop being the
  // worst team in the league at size" is an objective that asks a general manager to fix the
  // one thing the measurement says to ignore.
  const need = (ctx.profile?.needs || [])
    .filter((n) => Number.isFinite(n.z) && (n.weight ?? 0) >= NEED_WEIGHT_FLOOR)
    .sort((a, b) => a.z - b.z)[0]
  if (need && need.z <= -0.7 && out.length < 3) {
    out.push({ id: `fix_${need.key}`, kind: 'need_above', axis: need.key, n: -0.3,
      label: `Stop being the worst team in the league at ${need.label || need.key}`,
      detail: `${need.z.toFixed(1)} standard deviations below average. The fit model rates this `
        + 'axis heavily, and it is where your season leaks.' })
  }

  return out.slice(0, 3)
}

/* ------------------------------------------------------------------ issuing it */

export function issueMandate(team, save, opts = {}) {
  const roster = opts.roster || rostersOf(team)
  let ctx
  try { ctx = opts.ctx || teamContext(team, { roster, phase: 'offseason' }) } catch { ctx = null }
  if (!ctx) {
    return { key: 'playoffs', primary: { kind: 'wins', n: 44, label: 'Win 44 games', line: '' },
      label: 'Win 44 games',
      secondaries: [], season: save?.franchise?.currentSeason || SEED.season }
  }
  const primary = primaryFor({ ...ctx, youngTalent: youngTalentIn(roster) })
  return {
    // The old four keys are kept because trust, the advisor and the report all read them, and
    // because "what kind of year is this" is still a useful thing to say in one word.
    key: primary.kind === 'round' ? (primary.n >= 4 ? 'title' : primary.n >= 2 ? 'win_round' : 'playoffs')
      : primary.kind === 'wins' ? 'playoffs' : 'develop',
    primary,
    // THE LABEL THE INTERFACE ACTUALLY SHOWS.
    //
    // Without this the top strip and the standing card both fell through to the seed's
    // one-word placeholder — "Compete" — because `label` was never on the object they were
    // reading. The whole point of this module is that the mandate is a sentence about THIS
    // roster ("Reach the conference finals", "Win 44 games"), and it was being thrown away
    // one property short of the screen.
    label: primary.label,
    secondaries: secondariesFor(team, save, ctx, { roster }),
    season: save?.franchise?.currentSeason || SEED.season,
    // What they are judged against when somebody wants a single number.
    target: primary.wins ?? primary.n ?? 44,
    label: primary.label,
  }
}

/* ------------------------------------------------------------------ grading it */

// How far a playoff run actually got, on the same scale primaryFor asks for.
export function roundReached(po, team) {
  if (!po || !po.series) return 0
  const mine = po.series.filter((s) => s.hi === team || s.lo === team)
  if (!mine.length) return 0
  const ORDER = { playin: 0, r1: 1, r2: 2, cf: 3, finals: 4 }
  let best = 1
  for (const s of mine) {
    const at = ORDER[s.round] ?? 0
    if (s.winner === team) best = Math.max(best, at + 1)
    else best = Math.max(best, at)
  }
  return Math.min(5, best)
}

export function gradePrimary(mandate, ctx) {
  const p = mandate?.primary
  if (!p) return { met: false, line: 'No mandate on file.' }
  if (p.kind === 'round') {
    const got = ctx.round ?? 0
    return { met: got >= p.n,
      line: got >= p.n
        ? `They asked you to ${p.label.toLowerCase()}. You did.`
        : `They asked you to ${p.label.toLowerCase()}. You got as far as ${ROUND_LABEL[got] || 'nowhere'}.` }
  }
  if (p.kind === 'wins') {
    const w = ctx.wins ?? 0
    return { met: w >= p.n, line: `They asked for ${p.n} wins. You won ${w}.` }
  }
  if (p.kind === 'develop') {
    const n = ctx.developed ?? 0
    return { met: n >= p.n,
      line: `They wanted ${p.n} young players to become starters. ${n === 0 ? 'None did' : `${n} did`}.` }
  }
  if (p.kind === 'assets') {
    const n = ctx.firsts ?? 0
    return { met: n >= p.n, line: `They wanted ${p.n} first-round picks in hand. You have ${n}.` }
  }
  return { met: false, line: '' }
}

export function gradeSecondary(o, ctx) {
  switch (o.kind) {
    case 'minutes': {
      const got = ctx.minutesOf?.[o.who]
      return { met: typeof got === 'number' && got >= o.n - 1,
        line: typeof got === 'number'
          ? `${o.who} played ${got.toFixed(1)} a night against ${o.n}.`
          : `${o.who} is no longer on the roster.` }
    }
    case 'salary_under':
      return { met: (ctx.salary ?? Infinity) <= o.n,
        line: `Payroll finished at ${money(ctx.salary ?? 0)} against ${money(o.n)}.` }
    case 'picks_atleast':
      return { met: (ctx.firsts ?? 0) >= o.n, line: `${ctx.firsts ?? 0} firsts in hand against ${o.n}.` }
    case 'picks_below':
      return { met: (ctx.firsts ?? 99) <= o.n, line: `${ctx.firsts ?? 0} firsts left against ${o.n}.` }
    case 'need_above': {
      const z = ctx.needZ?.[o.axis]
      return { met: typeof z === 'number' && z >= o.n,
        line: typeof z === 'number' ? `Finished ${z.toFixed(1)} standard deviations from average.`
          : 'No reading on that axis.' }
    }
    default: return { met: false, line: '' }
  }
}

// The whole verdict, primary and secondaries together. Ownership counts them separately —
// missing the primary is what gets you fired; the secondaries are what gets you trusted.
export function gradeMandate(mandate, ctx) {
  const primary = gradePrimary(mandate, ctx)
  const secondaries = (mandate?.secondaries || []).map((o) => ({ ...o, ...gradeSecondary(o, ctx) }))
  const kept = secondaries.filter((s) => s.met).length
  return {
    primary,
    secondaries,
    kept,
    of: secondaries.length,
    // A number for owner trust: the primary is most of it, and the rest is whether you did
    // the other things you were asked to do.
    score: (primary.met ? 0.7 : 0) + (secondaries.length ? 0.3 * (kept / secondaries.length) : 0.15),
  }
}
