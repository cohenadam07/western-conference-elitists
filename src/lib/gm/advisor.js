// THE FRONT OFFICE ADVISOR.
//
// The complaint this exists to answer: "make it more intuitive what to do to be good."
// Everything needed to answer that was already measured somewhere in this codebase — the
// fit model knows what the roster lacks, the cap module knows what the CBA will let you do,
// the pick ledger knows what you can pay with, the mandate knows what you are being judged
// against. None of it was ever put in one place and read out loud.
//
// Two voices, because the right one depends on how much you already know:
//   'tell'  — a recommendation with the reasoning attached. Sometimes wrong, always says why.
//   'read'  — the same facts and trade-offs with the choice left to you.
// Every item carries both. Nothing here invents a number: each line names the figure it is
// built on, and if the figure is not there the line is not shown.
import { SEED } from './seed.js'
import { CBA, teamSalary, status, statusLabel } from './cap.js'
import { rostersOf, simOf } from './league.js'
import { teamContext, NEED_LABEL, winsFromNet } from './trade/context.js'
import { playerMarketValue } from './trade/market.js'
import { ownedBy, pickValue } from './picks.js'
import { rosterCheck, MIN_ROSTER } from './pool.js'
import { checkRotation, sustainable, strain } from './rotation.js'
import { issueMandate } from './mandate.js'

const money = (n) => (n < 0 ? '−$' : '$') + (Math.abs(n) / 1e6).toFixed(1) + 'M'
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// ------------------------------------------------------------------ team needs
//
// `teamProfile` already ranks the roster's deficits against league average on the axes the
// fit model found to matter. This turns the ranking into something a person can act on:
// what is short, by how much, and what kind of player fixes it.
const NEED_FIX = {
  spacing: 'a shooter who takes them in volume',
  gravity: 'somebody defences have to account for off the ball',
  rimprot: 'a centre who protects the rim',
  poa: 'a guard who can stay in front of his man',
  playmaking: 'a creator who makes the pass before the shot',
  size: 'length, almost anywhere',
  rimpress: 'somebody who gets downhill and draws the second defender',
  ballsec: 'a lower-turnover version of what you have',
}

export function needsOf(ctx) {
  const list = (ctx.profile?.needs || []).filter((n) => Number.isFinite(n.z))
  return list.map((n) => ({
    ...n,
    // A z of −1 is a genuine hole; −0.4 is a preference. Saying so keeps the list honest.
    severity: n.z <= -0.8 ? 'hole' : n.z <= -0.3 ? 'thin' : n.z >= 0.6 ? 'strength' : 'fine',
    fix: NEED_FIX[n.key] || NEED_LABEL[n.key],
  }))
}

// A deficit on an axis the fit model barely weights is not a need. Size came out at 0.005
// in the ridge — thirty teams' worth of evidence that team-level height does not move the
// needle — so reporting "1.6sd short of size" as a problem would be telling somebody to
// fix the one thing the measurement says not to bother with.
export const NEED_WEIGHT_FLOOR = 0.3
export const topNeeds = (ctx, n = 3) =>
  needsOf(ctx)
    .filter((x) => (x.severity === 'hole' || x.severity === 'thin') && x.weight >= NEED_WEIGHT_FLOOR)
    .slice(0, n)

// ---------------------------------------------------------------------- grades
//
// Four questions a general manager is actually answerable for. Each returns a score out of
// 100, the letter it earns, why it is what it is, and the single change that would move it.
const letter = (s) => (s >= 90 ? 'A' : s >= 80 ? 'B+' : s >= 70 ? 'B' : s >= 60 ? 'C+'
  : s >= 50 ? 'C' : s >= 38 ? 'D' : 'F')

export function grades(save, ctx, opts = {}) {
  const team = save.franchise.team
  const roster = rostersOf(team)
  const st = status(teamSalary(roster))
  const out = []

  // 1. The roster. Wins against the mandate, because that is what you are judged on — not
  //    against 41, and not against the best team in the league.
  const target = SEED.mandates[save.status?.mandate]?.target ?? 44
  const wins = ctx.wins
  const rScore = clamp(50 + (wins - target) * 4.5, 0, 100)
  out.push({
    key: 'roster', label: 'Roster', score: rScore, grade: letter(rScore),
    fact: `${wins.toFixed(0)} projected wins against a ${target}-win mandate`,
    why: wins >= target + 6 ? 'Comfortably ahead of what ownership asked for.'
      : wins >= target ? 'About where ownership expects you to be.'
        : wins >= target - 6 ? 'Short of the mandate, and inside one good trade of it.'
          : 'A long way short of the mandate. Trust falls from here.',
    lever: wins >= target
      ? 'Hold it together and spend on the margins.'
      : `${(target - wins).toFixed(0)} wins to find. About ${money((target - wins) / 2.15 * 14.1e6 / 2.15)} of surplus talent, or a different plan.`,
  })

  // 2. Cap health. The worst place in this CBA is expensive AND mediocre — a team paying
  //    tax for a play-in seed has no lever left to pull.
  const overTax = Math.max(0, st.total - CBA.tax)
  const stuck = overTax > 0 && wins < 46
  const cScore = stuck ? clamp(30 - overTax / 2e6, 0, 45)
    : st.underCap ? clamp(70 + st.space / 4e6, 0, 100)
      : clamp(78 - overTax / 3e6, 30, 90)
  out.push({
    key: 'cap', label: 'Cap health', score: cScore, grade: letter(cScore),
    fact: `${money(st.total)} — ${statusLabel(st)}${st.space > 0 ? `, ${money(st.space)} of room` : ''}`,
    why: stuck ? 'Paying tax for a team that is not contending. This is the worst place in the CBA to be: '
      + 'no room, no exceptions worth having, and nothing the money is buying.'
      : st.overApron2 ? 'Above the second apron. You cannot aggregate salaries or take back more than you send.'
        : st.overApron1 ? 'Above the first apron, so the bigger exceptions and salary aggregation are gone.'
          : st.underCap ? 'Under the cap, which is the only position that buys anybody outright.'
            : 'Over the cap but under the tax — the ordinary place to be, with the mid-level available.',
    lever: stuck ? 'Get under the tax or get better. Standing still costs money and buys nothing.'
      : st.overApron2 ? `${money(st.total - CBA.apron2)} would put you back under the second apron.`
        : st.underCap ? 'Room expires. Spend it on talent or convert it into somebody else’s bad contract plus a pick.'
          : 'Fine. Keep the mid-level for somebody who moves the rotation.',
  })

  // 3. The asset base: what you can pay with. Picks you own, young talent on cheap deals,
  //    and expiring salary — the three currencies.
  const led = save.picks || {}
  const myPicks = ownedBy(led, team).filter((p) => !p.forfeit)
  const year = parseInt(save.franchise.currentSeason, 10)
  const pickCash = myPicks.reduce((s, p) => s + pickValue(p, ctx.ranks?.[p.from], year), 0)
  const young = roster.filter((p) => (p.a ?? 30) <= 24 && (p.v ?? 0) > 0.8)
  const surplus = roster.reduce((s, p) => s + Math.max(0, playerMarketValue(p).value), 0)
  const aScore = clamp(28 + pickCash / 6e6 + young.length * 7 + surplus / 30e6, 0, 100)
  out.push({
    key: 'assets', label: 'Asset base', score: aScore, grade: letter(aScore),
    fact: `${myPicks.filter((p) => p.round === 1).length} firsts, ${young.length} young contributors on rookie money`,
    why: aScore >= 70 ? 'Enough to buy a star if one becomes available.'
      : aScore >= 45 ? 'Enough to improve at the margins, not enough to change the team.'
        : 'Thin. You cannot trade your way out of this without giving up somebody good.',
    lever: aScore >= 70 ? 'Assets are for spending. A pile of picks has never won anything.'
      : 'Seconds and young players are cheaper to accumulate than firsts. Take them in every deal you do.',
  })

  // 4. The rotation, if it is yours.
  if ((save.controlSurface?.levels?.rotations ?? 'manual') === 'manual') {
    const chk = checkRotation(save.rotation || {})
    const sim = simOf(team)
    const heavy = roster.filter((p) => {
      const m = (save.rotation || {})[p.uid || p.n] || 0
      return m > 0 && strain(p, sim.find((x) => x.n === p.n), m).risk === 'heavy'
    })
    const oScore = clamp((chk.ok ? 78 : 40) - heavy.length * 11, 0, 100)
    out.push({
      key: 'rotation', label: 'Rotation', score: oScore, grade: letter(oScore),
      fact: `${chk.total} of 240 minutes, ${chk.playing} men${heavy.length ? `, ${heavy.length} overworked` : ''}`,
      why: !chk.ok ? chk.why
        : heavy.length ? `${heavy.map((p) => p.n).join(', ')} ${heavy.length === 1 ? 'is' : 'are'} well past `
          + 'what the body has carried. That is availability you are spending.'
          : 'Legal, and nobody is being run into the ground.',
      lever: !chk.ok ? 'Let the coach set it, then adjust from there.'
        : heavy.length ? 'Pull ten minutes off the heaviest load and give them to the next man.'
          : 'Give the minutes to whoever rates best per minute.',
    })
  }

  const overall = out.reduce((s, g) => s + g.score, 0) / out.length
  return { list: out, overall, grade: letter(overall) }
}

// --------------------------------------------------------------------- advice
//
// The three things most worth doing right now, ranked by how much they are costing you.
// Every item names a screen, so it is a thing you can act on rather than a thing to read.
export function advise(save, ctx, opts = {}) {
  const team = save.franchise.team
  const roster = rostersOf(team)
  const st = status(teamSalary(roster))
  const items = []
  const target = SEED.mandates[save.status?.mandate]?.target ?? 44
  const add = (o) => items.push(o)

  // Hard problems first: things the league will not let you ignore.
  const rc = rosterCheck(save)
  if (!rc.ok && rc.short) {
    add({ weight: 100, key: 'short', screen: 'market', tone: 'bad',
      title: 'You are short of the roster minimum',
      fact: `${rc.n} under contract, ${MIN_ROSTER} required`,
      tell: `Sign ${rc.short} on minimum deals today. That door is open to every team at any point in the year, whatever your cap position.`,
      read: `The league requires ${MIN_ROSTER}. A minimum contract is available over the cap, over the tax and over both aprons.` })
  }
  if (st.overApron2) {
    add({ weight: 82, key: 'apron2', screen: 'trades', tone: 'bad',
      title: 'The second apron has taken your tools away',
      fact: `${money(st.total - CBA.apron2)} above the line`,
      tell: `Get ${money(st.total - CBA.apron2)} under it. You cannot aggregate salaries or take back more than you send until you do, and that is most of what a trade desk is for.`,
      read: 'Above the second apron: no salary aggregation, no taking back more than you send, no mid-level, and your first-round picks freeze seven years out.' })
  }

  // The strategic read: is the money buying anything?
  const overTax = Math.max(0, st.total - CBA.tax)
  if (overTax > 0 && ctx.wins < 46) {
    add({ weight: 88, key: 'stuck', screen: 'trades', tone: 'bad',
      title: 'Expensive and not contending',
      fact: `${money(st.total)} for ${ctx.wins.toFixed(0)} projected wins`,
      tell: 'Pick a direction. Either add enough to be a real team or shed salary and take back picks — paying tax for a play-in seed is the one position with no way out of it.',
      read: `Tax bill starts at ${money(overTax)} of overage and rises in bands. The teams that get stuck are the ones that pay it for a 44-win season.` })
  }
  if (ctx.contention > 0.6 && ctx.coreAge > 29) {
    add({ weight: 74, key: 'window', screen: 'trades', tone: 'warn',
      title: 'The window is open and closing',
      fact: `${ctx.label}, core age ${ctx.coreAge.toFixed(1)}`,
      tell: 'Spend the picks. A first four years out is worth far less to you than a rotation player is this season, and your best five will not be this good in three years.',
      read: `Title odds ${(ctx.title * 100).toFixed(0)}% on ${ctx.wins.toFixed(0)} projected wins. The core is ${ctx.coreAge.toFixed(1)} on average.` })
  }
  if (ctx.contention < 0.3 && ctx.coreAge > 28) {
    add({ weight: 76, key: 'oldbad', screen: 'trades', tone: 'warn',
      title: 'Old and not good, which is the wrong pair',
      fact: `${ctx.wins.toFixed(0)} projected wins, core age ${ctx.coreAge.toFixed(1)}`,
      tell: 'Sell the veterans while somebody still wants them. Every year you wait, they are worth less and you are no closer.',
      read: 'A team out of the race with an old core has two assets that both decay: the players and the time.' })
  }

  // Needs, from the fit model.
  //
  // The headline number here used to read "-0.5 standard deviations below league average,
  // weighted 1.60 in the fit model" in BOTH voices — so a new general manager who had chosen
  // "Tell me" was still shown a coefficient. Every other fact on this card is money, wins or
  // picks; this was the one piece of analyst language, and it was on the first screen of the
  // game. The measurement is still there, in the voice that asks for measurements.
  for (const n of topNeeds(ctx, 2)) {
    const far = Math.abs(n.z) >= 1 ? 'a long way below the league'
      : Math.abs(n.z) >= 0.5 ? 'below the league' : 'a little below the league'
    const matters = n.weight >= 1.2 ? 'one of the things that matters most'
      : n.weight >= 0.7 ? 'something that matters' : 'a smaller thing'
    add({ weight: n.severity === 'hole' ? 64 : 48, key: `need_${n.key}`, screen: 'trades', tone: 'warn',
      title: `The roster is ${n.severity === 'hole' ? 'badly short of' : 'thin on'} ${n.label}`,
      fact: `${far}, and it is ${matters}`,
      factRead: `${n.z.toFixed(1)} standard deviations below league average, weighted ${n.weight.toFixed(2)} in the fit model`,
      tell: `Shop for ${n.fix}. This is one of the things the model says decides games, and you are below the league on it.`,
      read: `${n.label} sits ${Math.abs(n.z).toFixed(1)}sd below average. The fit model's coefficient on it is ${n.weight.toFixed(2)} — the higher that is, the more the deficit costs in wins.` })
  }

  // Money doing nothing.
  if (st.space > CBA.mle_nontax) {
    add({ weight: 58, key: 'room', screen: 'market', tone: 'warn',
      title: 'You are carrying room you have not spent',
      fact: `${money(st.space)} of cap space`,
      tell: 'Use it or convert it. Room does not roll over, and a team under the cap is the only one that can absorb somebody else’s contract for a pick.',
      read: 'Cap room expires at the end of the year. Its two uses are signing outright and absorbing salary somebody wants rid of.' })
  }

  // Assets that are only worth something if you spend them.
  const led = save.picks || {}
  const firsts = ownedBy(led, team).filter((p) => p.round === 1 && !p.forfeit).length
  if (firsts >= 7 && ctx.contention > 0.5) {
    add({ weight: 52, key: 'hoard', screen: 'trades', tone: 'warn',
      title: 'You are hoarding picks on a team that is ready now',
      fact: `${firsts} first-round picks`,
      tell: 'Turn two or three of them into a player. Picks are how you buy a star, and a contender that never spends them ends up with neither.',
      read: `${firsts} firsts. A late first is worth roughly ${money(6e6)} of surplus; a rotation starter is worth several times that to a team already winning.` })
  }

  // The mandate, always last but never absent — it is what you are actually judged on.
  //
  // Taken from mandate.js, which knows what THIS roster was asked for, rather than from the
  // seed's four one-word buckets. Everywhere else in the game had already moved over; this
  // line was the last place still telling the user that ownership had asked for "compete".
  let live = null
  try { live = issueMandate(save.franchise?.team, save) } catch { live = null }
  const asked = live?.label || SEED.mandates[save.status?.mandate]?.label || 'results'
  add({ weight: 20, key: 'mandate', screen: 'job', tone: 'info',
    title: `Ownership asked you to ${asked.charAt(0).toLowerCase()}${asked.slice(1)}`,
    fact: `about ${target} wins · trust ${Math.round(50 + (save.status?.ownerConfidence || 0) * 16)}`,
    tell: ctx.wins >= target
      ? 'You are ahead of it. That buys patience for the moves that take a year to pay off.'
      : 'You are behind it. Trust moves slowly, but it does move, and being fired is real.',
    read: live?.primary?.line
      || `Judged against ${target} wins, not against .500 and not against the league.` })

  items.sort((a, b) => b.weight - a.weight)
  return items
}

// One call for the whole panel.
export function advisor(save, { seasonState, phase, ranks } = {}) {
  const team = save.franchise.team
  const ctx = { ...teamContext(team, { save, seasonState, phase }), ranks }
  return {
    ctx,
    needs: needsOf(ctx),
    grades: grades(save, ctx),
    items: advise(save, ctx),
    // A one-line answer to "how am I doing", which is the question underneath all of this.
    verdict: `${ctx.label} · ${ctx.wins.toFixed(0)} projected wins · `
      + `${(ctx.playoff * 100).toFixed(0)}% to make the playoffs, ${(ctx.title * 100).toFixed(0)}% to win it`,
  }
}
