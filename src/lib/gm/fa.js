// Free agency and negotiation — the browser port of fa_engine.py.
//
// The market price is MEASURED: 251 veteran contracts run through the projection model
// give R2 0.569 from projected production, age and minutes, with a residual sd of $10.4M.
// Two comparable players routinely sign $10M apart, and that spread is the room
// negotiation actually lives in.
//
// A design assertion died in the fitting: the doc said players are paid for last season
// rather than their forecast. Projection alone explains R2 0.405, last season alone
// 0.312, and both together 0.409 — the market pays for the forecast. The bias that IS
// there lives in the ego draw and the winning-team term below.
import { SEED } from './seed.js'
import { rostersOf } from './league.js'
import { teamSalary, status } from './cap.js'

const M = SEED.market
const A = SEED.agents
const CBA = SEED.cba
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

export function marketPrice(projVorp, age, mpg, service) {
  const aav = M.coef[0] * projVorp + M.coef[1] * age + M.coef[2] * mpg + M.intercept
  const max = service >= 10 ? CBA.max_35 : service >= 7 ? CBA.max_30 : CBA.max_25
  return Math.round(clamp(aav, 2_300_000, max))
}

export function makePersonality(r, age) {
  const w = {}
  SEED.priorities.forEach((k) => { w[k] = r.rand() })
  w.money += 0.6
  if (age >= 31) w.contention += 0.5
  if (age <= 24) w.role += 0.4
  const tot = Object.values(w).reduce((a, b) => a + b, 0)
  Object.keys(w).forEach((k) => { w[k] /= tot })
  const names = Object.keys(A)
  return {
    weights: w,
    ego: r.gauss(1, 0.1),
    patience: Math.max(1, Math.round(r.gauss(4, 1.4))),
    agent: names[r.randrange(names.length)],
  }
}

// How a lowball lands. Not one sentence: a draw from the lines this particular man would
// actually use, weighted by what he cares about, where the team is, and how far under his
// number you came in. The same offer to two different players gets two different answers,
// and the same offer to the same player twice does not repeat itself.
const REACTIONS = {
  money: [
    'He is not taking a discount. "Come back when the number is real."',
    'His agent laughs. "You know what he is worth. That is not it."',
    'He has been underpaid once already. Not again.',
  ],
  role: [
    '"It is not only the money. What is my role here?"',
    'He wants the ball and the minutes. That number says he is getting neither.',
    '"If I am starting, pay me like it. If I am not, say so."',
  ],
  contention: [
    '"I want to win. I also want to be paid to win."',
    'He would take less to chase a ring. Not that much less.',
    '"Show me the team is serious. Start with me."',
  ],
  market: [
    'He likes the city. He does not like the offer.',
    '"My family is settled here. That is worth something — to you as well."',
  ],
  loyalty: [
    'He has given this club years. He expected better than this.',
    '"After everything? Come on."',
  ],
  years: [
    '"One more year at that number is not security."',
    'He wants term. That offer is neither the money nor the years.',
  ],
}
const WINNING = [
  'He loves it here and it still is not enough.',
  '"I want to stay. Do not make it hard."',
]
const LOSING = [
  '"You are asking me to lose cheaply."',
  'Sixty-two losses and a pay cut. He has heard better pitches.',
]
const DEEP = [
  'His agent stops writing. "Is that a serious number?"',
  'There is a pause. "I think we are done for today."',
]

export class Negotiation {
  constructor({ name, market, personality, teamWins = 41, agentRel = 1, r, rivals = [] }) {
    this.name = name
    this.r = r
    this.p = personality
    this.agent = A[personality.agent]
    this.market = market
    // Winning inflates the ask, which the brief asked for and is also true: production on
    // a good team is read as production that matters.
    const winMult = 1 + clamp(((teamWins - 41) / 41) * 0.12, -0.06, 0.12)
    this.ask = Math.round(market * personality.ego * this.agent.ask * winMult)
    this.floor = market * 0.86
    this.insults = 0
    this.teamWins = teamWins
    // How good is it here, in his eyes? 41 wins is neutral; a 60-win team is a place a
    // player wants to stay, and a 22-win team is a place he wants paying to stay.
    this.here = clamp((teamWins - 41) / 20, -1, 1)
    // What he is actually about, which is the single most useful fact in the room. The
    // heaviest of his own priorities decides how he hears a number.
    this.driver = Object.entries(personality.weights).sort((x, y) => y[1] - x[1])[0][0]
    // Where the insult line sits, for HIM. It used to be a flat 72% of the floor for every
    // player alive, so a lowball produced the same sentence every time — the tell that
    // nothing about the man was being consulted. A money-first player is offended sooner;
    // somebody who wants to win here, on a team that is winning, will hear a low number out
    // before he takes it personally.
    this.insultLine = clamp(
      0.72 + (personality.weights.money - 0.2) * 0.55
        - personality.weights.contention * 0.30 * Math.max(0, this.here)
        - personality.weights.role * 0.12
        - (personality.patience - 4) * 0.015,
      0.50, 0.88)
    this.state = 'open'
    this.rel = agentRel
    this.rivals = rivals
    this.log = []
    // The bar is not just his asking price — it is the best thing anyone else is offering,
    // measured in HIS terms. A contender's smaller number can beat your bigger one.
    this.bestRival = rivals.reduce((best, o) => {
      const sc = this.score(o)
      return !best || sc > best.score ? { ...o, score: sc } : best
    }, null)
  }

  // Money is the BASE and the rest modulate it. Averaging all six priorities was wrong in
  // a way that showed immediately: an offer ABOVE the asking price still scored below the
  // signing line because neutral role and market terms dragged the average down.
  score(o) {
    const w = this.p.weights
    const money = Math.min(1.6, o.aav / Math.max(1, this.ask))
    const parts = {
      years: Math.min(1, (o.years ?? 2) / 4),
      role: o.role ?? 0.5,
      contention: o.contention ?? 0.5,
      market: o.market ?? 0.5,
      // Incumbency is an advantage, not a trump card. At 1.0 against a rival's 0.5, paying
      // the asking price kept 250 of 250 players even on a 22-win team, which made the
      // rival offers decorative. At 0.82 a contender can still take someone off a bad team
      // — and the real constraint stays where it belongs: you can keep anyone, but the cap
      // means you cannot keep everyone.
      // Incumbency is an advantage that a winning team makes bigger. A player on a 60-win
      // club would rather not move; a player on a 22-win club is halfway out already, and
      // how much either of those matters depends on how much he cares about winning.
      loyalty: o.incumbent
        ? clamp(0.82 + (this.here ?? 0) * (0.12 + w.contention * 0.5), 0.6, 1)
        : 0.5,
    }
    const nw = Object.keys(parts).reduce((s, k) => s + w[k], 0) || 1
    const mod = Object.entries(parts).reduce((s, [k, v]) => s + (w[k] / nw) * (v - 0.5) * 2, 0)
    return money * (1 + 0.3 * mod)
  }

  // Which sentence he actually says. The pool is his driver's lines plus, if the team is
  // notably good or notably bad, the lines a man in that situation would add — and a truly
  // insulting number pulls from the short, cold set instead.
  reaction(o) {
    const depth = o.aav / Math.max(1, this.floor * this.insultLine)
    const pool = []
    pool.push(...(REACTIONS[this.driver] || REACTIONS.money))
    if (this.here > 0.45) pool.push(...WINNING)
    if (this.here < -0.45) pool.push(...LOSING)
    if (depth < 0.6) pool.push(...DEEP, ...DEEP)
    // Repeats are the thing being fixed, so a line already used is dropped until the pool
    // runs dry.
    const fresh = pool.filter((x) => !this.said?.includes(x))
    const from = fresh.length ? fresh : pool
    const line = from[this.r.randrange(from.length)]
    this.said = [...(this.said || []), line]
    return `${line} — ${this.agent.blurb}`
  }

  offer(o) {
    if (this.state !== 'open') return { result: this.state, message: 'Talks are closed.' }
    const score = this.score(o)
    if (o.aav < this.floor * this.insultLine) {
      this.insults++
      // The threshold is drawn from the player AND his agent and is never shown, so the
      // user cannot learn how many lowballs he is allowed. Somebody who is happy where he
      // is will sit through one more than somebody who is not.
      const tol = Math.max(1, Math.round(this.p.patience + this.agent.patience - 2
        + this.p.weights.contention * this.here * 3))
      if (this.insults >= tol) {
        this.state = 'walked'
        return { result: 'walked', reputationHit: true,
          message: `${this.name}'s agent ends the conversation. Word gets around.` }
      }
      return { result: 'insulted', message: this.reaction(o), driver: this.driver }
    }
    const bar = this.bestRival ? Math.max(1 * this.rel, this.bestRival.score) : 1 * this.rel
    if (score >= bar) {
      this.state = 'signed'
      return { result: 'signed', aav: o.aav, years: o.years,
        message: `${this.name} signs for $${Math.round(o.aav).toLocaleString('en-US')} × ${o.years}.` }
    }
    // Losing to the field is a different answer from being short of his number, and the
    // user should be told which it is.
    if (this.bestRival && score < this.bestRival.score) {
      this.log.push('outbid')
      if (this.log.filter((x) => x === 'outbid').length >= 3) {
        this.state = 'lost'
        return { result: 'lost', to: this.bestRival.team,
          message: `${this.name} signs with ${SEED.teams[this.bestRival.team].name} — ` +
            `$${this.bestRival.aav.toLocaleString('en-US')} × ${this.bestRival.years}.` }
      }
      return { result: 'outbid', rival: this.bestRival,
        message: `${SEED.teams[this.bestRival.team].name} are offering ` +
          `$${this.bestRival.aav.toLocaleString('en-US')} × ${this.bestRival.years}` +
          `${this.bestRival.contention > 0.7 ? ' and they are a contender' :
             this.bestRival.role > 0.7 ? ' and a much bigger role' : ''}.` }
    }
    const gap = this.ask - o.aav
    this.ask = Math.round(Math.max(this.floor, this.ask - gap * this.agent.moves * 0.5))
    const leak = this.r.rand() < this.agent.leaks
      ? ' His agent is telling other teams what you offered.' : ''
    return { result: 'counter', ask: this.ask,
      message: `Wants $${this.ask.toLocaleString('en-US')}.${leak}` }
  }
}


// ---------------------------------------------------------------- the market
//
// Free agency without rivals is not a negotiation, it is a form. A career that re-signed
// its whole core and sailed into the second apron did so because nobody else was allowed
// to bid. These are the other twenty-nine teams, and they want your players.

// What a team can actually put on the table: its cap room, or the mid-level if it is over.
export function spendingPower(team) {
  const roster = rostersOf(team)
  const st = status(teamSalary(roster))
  if (st.underCap) return Math.max(SEED.cba.mle_room, st.space)
  if (st.overApron2) return SEED.cba.mle_tax * 0        // second apron: no mid-level
  if (st.overApron1) return SEED.cba.mle_tax
  if (st.overTax) return SEED.cba.mle_tax
  return SEED.cba.mle_nontax
}

// A team's pull on a free agent, in his own terms rather than the league's. Exported,
// because YOUR club has to be measured on the same scale the rivals are — the re-sign
// screen used to hand the engine a flat 0.5 for contention and 0.5 for market whoever you
// were, so a 62-win team in a big city pitched exactly like a 22-win team in a small one
// and winning could not help you keep anybody.
export function appealOf(team, ranks) { return appeal(team, ranks) }
function appeal(team, ranks) {
  const rank = ranks?.[team] ?? 15
  return {
    // Reverse-standings rank: 1 is the worst team, 30 the best.
    contention: Math.max(0, Math.min(1, (rank - 4) / 24)),
    market: Math.max(0, Math.min(1, 0.5 + (SEED.teams[team]?.market ?? 0) / 4)),
  }
}

export function rivalOffers(player, market, r, ranks, max = 3) {
  const teams = Object.keys(SEED.teams).filter((t) => t !== player.team)
  r.shuffle(teams)
  const out = []
  for (const t of teams) {
    if (out.length >= max) break
    const power = spendingPower(t)
    // A team can only sign what it can pay for. Cap room or the mid-level, nothing else —
    // which is why a $38M free agent has three plausible suitors in a league where only
    // three teams are under the cap, and a $9M role player has twenty. That asymmetry is
    // real NBA economics and it is what makes Bird rights worth having.
    if (power < market * 0.45) continue
    const a = appeal(t, ranks)
    // A rebuilding team with room overpays for talent; a contender offers less money and
    // a bigger role on a better team. Both are real ways to win a free agent.
    const rebuilding = a.contention < 0.35
    const aav = Math.min(power, market * (rebuilding ? 1.02 + r.rand() * 0.16 : 0.82 + r.rand() * 0.2))
    out.push({
      team: t,
      aav: Math.round(aav),
      years: rebuilding ? 3 + r.randrange(2) : 2 + r.randrange(2),
      role: rebuilding ? 0.55 + r.rand() * 0.4 : 0.35 + r.rand() * 0.35,
      contention: a.contention,
      market: a.market,
      incumbent: false,
    })
  }
  return out
}
