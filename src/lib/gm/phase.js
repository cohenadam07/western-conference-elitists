// THE CALENDAR.
//
// The complaint this exists to answer: "it feels like I just keep clicking sim until I
// win." That is what happens when a season is one button. A year in a front office is a
// sequence of distinct jobs, each with its own deadline and its own thing to get right,
// and 2K's franchise mode is paced by exactly that — its own settings list the stages by
// name: contract options, qualifying offers, lottery, combine, pre-draft workouts, draft,
// draft signings, free agency signing, summer league, staff signings, player progression.
//
// So the season is a list of phases. Each one states what it is for, gives you objectives
// you can actually complete, opens only the actions that belong to it, and ends with an
// explicit advance that tells you what is next. You cannot sim past the deadline without
// being handed the deadline.
import { SEED } from './seed.js'
import { CBA, teamSalary, status, statusLabel } from './cap.js'
import { rosterOf } from './league.js'
import { DEADLINE_GAME } from './deadline.js'

// Real 2026-27 dates, because the calendar is a gameplay surface and not flavour.
export const PHASES = [
  {
    key: 'camp', name: 'Training camp', date: 'Oct 3', stage: 'preseason',
    blurb: 'Everyone reports. Set what the team works on, get the roster legal, and hear '
      + 'what ownership expects before a game counts.',
    screen: 'home',
    next: 'Open the preseason',
  },
  {
    key: 'preseason', name: 'Preseason', date: 'Oct 10', stage: 'preseason',
    blurb: 'Six exhibition games nobody remembers. Your last quiet window to change the '
      + 'roster before results start going on your record.',
    screen: 'trades',
    next: 'Advance to opening night',
  },
  {
    key: 'early', name: 'Opening night → the Cup', date: 'Oct 20', stage: 'season',
    games: 25,
    blurb: 'Twenty-five games. Enough to learn whether the roster you built is the roster '
      + 'you thought you built.',
    screen: 'season',
    next: 'Advance to the Cup',
  },
  {
    key: 'cup', name: 'NBA Cup', date: 'Dec 11', stage: 'season',
    games: 40,
    blurb: 'Knockout basketball in December. It is also the point where the standings stop '
      + 'being noise and start being information.',
    screen: 'season',
    next: 'Advance to Christmas',
  },
  {
    key: 'midseason', name: 'Christmas → the deadline', date: 'Dec 25', stage: 'season',
    games: DEADLINE_GAME,
    blurb: 'The stretch where teams decide what they are. Yours included — the phone starts '
      + 'ringing on the way to February.',
    screen: 'season',
    next: 'Advance to the deadline',
  },
  {
    key: 'deadline', name: 'Trade deadline', date: 'Feb 11', stage: 'season',
    blurb: 'Buy, sell, or stand still. Whatever the roster is after today is what plays in '
      + 'April.',
    screen: 'season',
    // Distinct from the deadline card's own "Close the desk and play on" button. Two
    // controls with the same words, one of them disabled, is a puzzle rather than an
    // interface — and it stalled an automated walkthrough for exactly that reason.
    next: 'Play on to the stretch run',
  },
  {
    key: 'stretch', name: 'The stretch run', date: 'Feb 12', stage: 'season',
    games: 82,
    blurb: 'Twenty-seven games to settle seeding. Nothing left to fix on the roster; this is '
      + 'what you built.',
    screen: 'season',
    next: 'Advance to the postseason',
  },
  {
    key: 'postseason', name: 'Play-in and playoffs', date: 'Apr 14', stage: 'playoffs',
    blurb: 'Seeds one through six are in. Seven through ten play for the last two spots. '
      + 'Then four rounds.',
    screen: 'season',
    next: 'Run the postseason',
  },
  {
    key: 'review', name: 'Exit interviews', date: 'Jun 20', stage: 'offseason',
    blurb: 'The season report, and ownership’s verdict against the mandate it gave you. '
      + 'Read the weaknesses — the next three phases are your chance to fix them.',
    screen: 'report',
    next: 'Take the offseason',
  },
  {
    key: 'offseason', name: 'Lottery, draft and free agency', date: 'Jun 25', stage: 'offseason',
    blurb: 'The lottery sets the board, your pick is where your season put it, and your own '
      + 'expiring contracts have agents with other teams on the line.',
    screen: 'draft',
    next: 'Start the new season',
  },
]

export const PHASE_INDEX = Object.fromEntries(PHASES.map((p, i) => [p.key, i]))
export const phaseOf = (save) => PHASES[PHASE_INDEX[save?.phase] ?? 0] || PHASES[0]
export const nextPhase = (key) => PHASES[Math.min(PHASES.length - 1, (PHASE_INDEX[key] ?? 0) + 1)]

/* ------------------------------------------------------------- the long run */

// WHAT A LONG RUN DOES NEXT.
//
// "Play to the deadline" and "play to the end of the season" cross phase boundaries on
// their own. That decision used to live inside a React effect, where no test could reach
// it, and it was wrong: a phase carrying no game count was treated as a reason to abandon
// the run rather than a day to step through. The only phase inside a season shaped like
// that is the deadline — so standing on February 11th, the season screen's own primary
// button did nothing at all, silently, forever.
//
// It is a pure function now. `played` is YOUR games, not the league's.
//   stop    — the run is finished, or is being handed to the user on purpose
//   advance — this phase has nothing left in it; turn the page and ask again
//   play    — sim n more of your games
export function runStep(save, played, target) {
  if (!(target > 0) || played >= target) return { do: 'stop', why: 'target reached' }
  const ph = phaseOf(save)
  if (!ph.games) {
    return ph.stage === 'season'
      ? { do: 'advance', why: 'a day, not a span' }
      : { do: 'stop', why: 'no games outside a season' }
  }
  if (played >= ph.games) {
    // The deadline is a stop, not a speed bump: a run aimed past it still hands it over.
    return ph.key === 'midseason'
      ? { do: 'stop', why: 'the deadline is a stop' }
      : { do: 'advance', why: 'phase complete' }
  }
  return { do: 'play', n: Math.min(target, ph.games) - played, why: 'games remain' }
}

/* --------------------------------------------------------------- objectives */

// Objectives are checked against real state, never ticked off by the act of reading them.
// Each one names the screen that satisfies it, so the card is navigation as well as a
// to-do list.
// Did the user actually go and look at something during this phase? "Look at the roster you
// are opening with" was checked against `save.camp.reviewed`, which nothing ever set — so
// the objective could be done and never tick, which teaches the user that the checklist is
// decorative. Visits are recorded per phase, so the same objective comes back next October.
export const visitKey = (save, screen) => `${phaseOf(save).key}:${screen}`
export const visited = (save, screen) => !!save?.visited?.[visitKey(save, screen)]
export const markVisited = (save, screen) => ({
  ...save,
  visited: { ...(save.visited || {}), [visitKey(save, screen)]: 1 },
})

export function objectives(save, ctx = {}) {
  const phase = phaseOf(save)
  const roster = rosterOf(save) || []
  const tot = teamSalary(roster)
  const st = status(tot)
  const season = ctx.season
  const games = ctx.games ?? 0
  const out = []

  const add = (id, text, done, screen, why, hard = false) =>
    out.push({ id, text, done: !!done, screen, why, hard })

  // A roster can fall under the minimum at ANY point — a trade in December, a waiver, a
  // retirement — and it used to be checkable only at camp, with no way to fix it until
  // July. It is now a standing objective, and the open market is where it gets answered.
  if (phase.key !== 'camp' && roster.length < CBA.roster_min) {
    add('short', `Get back to ${CBA.roster_min} players`, false, 'market',
      `You are carrying ${roster.length}. A minimum contract is available to every team at any `
      + 'point in the year, whatever your cap position.', true)
  }

  if (phase.key === 'camp') {
    add('roster', `Carry at least ${CBA.roster_min} players`, roster.length >= CBA.roster_min,
      'market', `You have ${roster.length}. The league minimum is ${CBA.roster_min}.`, true)
    add('practice', 'Set what the team works on this year',
      !!save.camp?.emphasis, 'home',
      'Skill work returns more than twice as much at 22 as at 34; conditioning buys durability and no skill at all.')
    add('mandate', 'Know what ownership asked for',
      !!save.camp?.readMandate, 'job',
      `${SEED.mandates[save.status.mandate]?.label || 'A mandate'} — about ${SEED.mandates[save.status.mandate]?.target ?? 44} wins.`)
    if (st.overApron2) {
      add('apron', 'Get under the second apron', false, 'trades',
        'Above it you cannot aggregate salaries, take back more than you send, or use the taxpayer mid-level.')
    } else if (st.overApron1) {
      add('apron', 'Decide whether to live above the first apron', !!save.camp?.acceptApron, 'finances',
        'Above it there is no sign-and-trade, no non-taxpayer mid-level and no bi-annual exception.')
    }
  }

  if (phase.key === 'preseason') {
    add('look', 'Look at the roster you are opening with', visited(save, 'roster'), 'roster',
      'Overall is a production rate, not a typed rating. Availability is its own column.')
    add('trade', 'Work the desk while it is quiet', (save.records.tradesMade || 0) > 0
      || !!save.camp?.skippedTrades, 'trades',
      'Nothing you do in the preseason costs you a result. After opening night every move is judged against the standings.')
  }

  if (phase.stage === 'season' && phase.games) {
    // Not a hard block: the advance button IS the way you play these games, so blocking
    // it on them would leave the user with a disabled button and nothing to click.
    add('play', `Play to game ${phase.games}`, games >= phase.games, 'season',
      `${games} of 82 played.`)
  }

  if (phase.key === 'deadline') {
    add('inbox', 'Answer the phone', ctx.inboxHandled, 'season',
      ctx.inboxCount ? `${ctx.inboxCount} team${ctx.inboxCount === 1 ? '' : 's'} calling.` : 'The desk is open.', true)
    add('stance', 'Decide whether you are buying or selling', ctx.inboxHandled, 'season',
      ctx.record ? `You are ${ctx.record}.` : '')
  }

  if (phase.key === 'postseason') {
    // NOT a hard block, for the same reason the season blocks are not: the advance button
    // is what runs the postseason, so gating it on the postseason having been run is a
    // deadlock. The smoke test missed this because it had a second way out — the season
    // screen's own button — which a user sitting on the home screen does not.
    add('bracket', 'Run the postseason', !!ctx.po, 'season', 'Play-in first, then four rounds.')
  }

  if (phase.key === 'review') {
    add('report', 'Read the season report', !!ctx.report, 'report',
      'Every claim in it traces back to a number you can go and check.')
    add('verdict', 'Take ownership’s verdict', !!ctx.report, 'job',
      'Judged against the mandate, not raw wins.')
  }

  if (phase.key === 'offseason') {
    // Only list what there is to do. An objective for a pick you do not own is not a
    // reminder, it is a locked door — and marked "required" it stopped the career dead.
    if (!ctx.ready) {
      add('reopen', 'Open the draft room', false, 'draft',
        'The offseason has not been opened yet in this session.')
    } else {
      if (ctx.pickNo) {
        add('draft', 'Make your pick', ctx.drafted, 'draft', `You pick #${ctx.pickNo}.`, true)
      }
      if (ctx.expiring) {
        add('fa', 'Settle your own free agents', ctx.faSettled, 'draft',
          `${ctx.expiring} coming off the books.`, true)
      }
      add('fill', `Get back to ${CBA.roster_min} players`, roster.length >= CBA.roster_min, 'roster',
        'Closing the offseason refills to fourteen with minimum contracts if you do not.')
      if (!ctx.pickNo && !ctx.expiring) {
        add('quiet', 'Nothing outstanding', true, 'draft',
          'No first-rounder and nobody expiring — you can start the new season.')
      }
    }
  }

  return out
}

// What the phase allows. A calendar that does not gate anything is a decoration.
export function allowed(save) {
  const phase = phaseOf(save)
  return {
    trades: phase.key !== 'postseason' && phase.key !== 'review'
      && phase.key !== 'stretch' && phase.key !== 'offseason',
    sim: phase.stage === 'season' || phase.key === 'postseason',
    offseason: phase.key === 'offseason',
    // The real deadline rule: after it passes, the roster is what plays in April.
    reason: phase.key === 'stretch' ? 'The deadline has passed — no trades until the season ends.'
      : phase.key === 'postseason' ? 'Rosters are frozen for the postseason.'
        : phase.key === 'review' ? 'The season is over. Trades reopen once you take the offseason.'
          : phase.key === 'offseason' ? 'Draft and free agency first; the desk reopens at camp.'
            : null,
  }
}

// Can the user move on? Hard objectives block; soft ones are advice.
export function canAdvance(save, ctx = {}) {
  const objs = objectives(save, ctx)
  const blocking = objs.filter((o) => o.hard && !o.done)
  return { ok: blocking.length === 0, blocking }
}

export const advanceTo = (save, key) => ({ ...save, phase: key })

// ---------------------------------------------------------------------- chapters
//
// A phase change used to be a silent state write: the screen simply became a different
// screen. A year in a front office has chapters — camp closes, the season opens, the
// deadline passes — and each one should be announced, so the career reads as something
// that happened rather than a sequence of button presses.

export function chapterOf(save, fromKey, toKey, ctx = {}) {
  const from = PHASES.find((p) => p.key === fromKey)
  const to = PHASES.find((p) => p.key === toKey)
  if (!from || !to) return null
  const n = PHASES.indexOf(from) + 1 + (save.records?.seasonsCompleted || 0) * PHASES.length
  const roster = rosterOf(save) || []
  const st = status(teamSalary(roster))

  // What actually happened in the chapter that is closing. Facts, not flavour — the point
  // is a record of the year, and a line nobody can check is not a record.
  const closed = []
  if (ctx.record) closed.push(`Record ${ctx.record}`)
  if (ctx.games) closed.push(`${ctx.games} games played`)
  if (ctx.trades) closed.push(`${ctx.trades} trade${ctx.trades === 1 ? '' : 's'} made`)
  if (ctx.signings) closed.push(`${ctx.signings} signed off the market`)
  if (ctx.emphasis) closed.push(`Camp worked on ${ctx.emphasis}`)
  if (ctx.champion) closed.push(`${ctx.champion} won the title`)
  if (ctx.risers != null) closed.push(`${ctx.risers} improved, ${ctx.fallers} slipped`)
  closed.push(`Payroll ${statusLabel(st)}`)

  return {
    n,
    closingKey: from.key,
    closing: from.name,
    closingDate: from.date,
    closed,
    openingKey: to.key,
    opening: to.name,
    openingDate: to.date,
    blurb: to.blurb,
    stage: to.stage,
    // What the next chapter will ask of you, so the card is a briefing and not a curtain.
    asks: objectives({ ...save, phase: to.key }, ctx).slice(0, 3).map((o) => o.text),
  }
}

// ------------------------------------------------------- what a good GM does here
//
// The objectives say what to DO. These say what doing it well looks like, which is the
// part nobody tells you. Shown through the first career and available from the glossary
// after that, so it teaches once and then gets out of the way.
export const COACHING = {
  camp: 'Camp is the one week where the roster is quiet and everything is still possible. '
    + 'Two things pay: pick the emphasis that matches who you actually have — skill work returns '
    + 'more than twice as much at 22 as at 34 — and read the mandate, because you are judged '
    + 'against that number and not against .500.',
  preseason: 'The last window where a trade costs you nothing in the standings. If you already '
    + 'know the roster is short somewhere, this is the cheapest time to fix it: everyone still '
    + 'believes in their own team, so nobody is selling at a discount yet, but nobody is '
    + 'panicking either.',
  early: 'Twenty-five games is enough to learn something and not enough to act on much. Watch '
    + 'whether the thing you built actually works — if the fit model liked your roster and the '
    + 'results do not, the results are usually right.',
  cup: 'By forty games the standings are information rather than noise. This is where you decide '
    + 'what you are: a team that adds, a team that sells, or a team that stands still. Standing '
    + 'still is a decision too, and usually the worst of the three.',
  midseason: 'The run-up to the deadline is when the phone starts ringing, and the offers you '
    + 'get tell you how the league values your players — often more honestly than you do. A '
    + 'contender should be buying; a team eight games out should be listening.',
  deadline: 'Everything expires today. The two mistakes are opposite and equally common: a good '
    + 'team that will not spend a first, and a bad team that buys a rental. Ask which one you '
    + 'are, then act like it.',
  stretch: 'The roster is what it is until June. Minutes are the only lever left, and the only '
    + 'question worth asking is whether you are chasing seeding or protecting a body.',
  postseason: 'Nothing you do now changes anything, which is the point. Watch what your roster '
    + 'does when the rotation shortens — playoff basketball punishes the things the regular '
    + 'season hides, and what breaks here is your offseason list.',
  review: 'The year is over and the useful question is not whether you won. It is whether the '
    + 'young players got better, whether the money is buying what you thought, and whether you '
    + 'are closer than you were.',
  offseason: 'The offseason is where teams are actually built. Draft for the player you believe '
    + 'in rather than the position you need — need changes in a year and talent does not — and '
    + 'remember that every contract you sign is one you have to trade later.',
}

export const coachingFor = (save) => COACHING[phaseOf(save).key] || null
export const isFirstCareerYear = (save) => (save?.records?.seasonsCompleted ?? 0) === 0
