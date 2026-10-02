import { useRef, useState } from 'react'
import Reveal from './Reveal.jsx'
import { CLAUDE_GUIDE, CONNECTOR_URL, EXAMPLE, PROMPTS } from '../data/connector.js'

// The homepage's section about the AI connector (api/mcp.js): what it is, a real answer it
// gives, and the three steps to add it. Styles are in index.css under the `.aic` scope.
// The section's id is "ai", so /#ai links straight to it (Home.jsx does the scrolling).

const COVERS = [
  'Basketball Savant',
  'Football Savant',
  'Coaching Savant',
  'UFC Savant',
  'Draft Savant',
  'Big Board',
  'Dynasty board',
  'News & articles',
]

// The percentile ramp Basketball Savant paints its bars with (colorAt in
// public/basketball-savant.html): blue at the bottom, grey in the middle, red at the top.
function colorAt(p) {
  const LO = [28, 78, 134], MID = [194, 192, 182], HI = [188, 58, 44]
  const t = Math.max(0, Math.min(100, p)) / 100
  const [a, b, k] = t < 0.5 ? [LO, MID, t / 0.5] : [MID, HI, (t - 0.5) / 0.5]
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`
}

const ordinal = (n) => {
  const t = n % 100
  return t >= 11 && t <= 13 ? `${n}th` : `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

function CopyAddress() {
  const field = useRef(null)
  const [state, setState] = useState('idle') // idle | copied | select

  async function copy() {
    let ok = false
    try {
      await navigator.clipboard.writeText(CONNECTOR_URL)
      ok = true
    } catch {
      // No clipboard access (an old browser, or a page that is not allowed it): select the
      // address so it is one keystroke from copied, and say so.
      field.current?.focus()
      field.current?.select()
    }
    setState(ok ? 'copied' : 'select')
    setTimeout(() => setState('idle'), 2600)
  }

  return (
    <div className="aic-copy">
      <input
        ref={field}
        readOnly
        value={CONNECTOR_URL}
        aria-label="The connector's address"
        onFocus={(e) => e.target.select()}
        spellCheck={false}
      />
      <button type="button" onClick={copy}>
        {state === 'copied' ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only" role="status">
        {state === 'copied' ? 'Address copied.' : state === 'select' ? 'Address selected. Press copy on your keyboard.' : ''}
      </span>
    </div>
  )
}

function Example() {
  const { perGame: g } = EXAMPLE
  return (
    <figure className="aic-chat">
      <figcaption className="sr-only">An example: a question, and the answer the connector gives.</figcaption>
      <div className="aic-you">
        <span className="aic-who">You</span>
        <p>{EXAMPLE.question}</p>
      </div>
      <div className="aic-ai">
        <span className="aic-who">
          Your AI <span aria-hidden="true">◆</span> looked it up on wcehoops.com
        </span>
        <div className="aic-card">
          <div className="aic-card-head">
            <div>
              <h4>{EXAMPLE.name}</h4>
              <p>
                {EXAMPLE.team} · {EXAMPLE.season}
                <span className="sep"> · </span>
                <span className="line">{g.points.toFixed(1)} pts · {g.rebounds.toFixed(1)} reb · {g.assists.toFixed(1)} ast</span>
              </p>
            </div>
            <span className="aic-src">Basketball Savant</span>
          </div>
          <ul>
            {EXAMPLE.stats.map((s, i) => (
              <li key={s.key}>
                <span className="aic-lab">{s.label}</span>
                <span className="aic-val">{s.display}</span>
                <span className="aic-bar" aria-hidden="true">
                  <i style={{ '--w': `${s.percentile}%`, background: colorAt(s.percentile), animationDelay: `${0.25 + i * 0.12}s` }} />
                </span>
                <span className="aic-pct">
                  {ordinal(s.percentile)}
                  <span className="sr-only"> percentile</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="aic-pool">
            Percentile against the {EXAMPLE.pool} qualified players of {EXAMPLE.season}.{' '}
            <a href={EXAMPLE.card}>
              Open his card <span aria-hidden="true">↗</span>
            </a>
          </p>
        </div>
      </div>
    </figure>
  )
}

export default function AiConnector() {
  return (
    <section id="ai" className="aic border-b border-line bg-surface">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-24">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_0.92fr] lg:gap-20">
          <Reveal>
            <span className="rule-gold" aria-hidden="true" />
            <span className="kicker mt-4 flex items-center gap-2.5 text-navy">
              <span className="aic-new">New</span>
              The AI connector
            </span>
            <h2 className="text-display mt-4 text-4xl leading-[1.05] text-ink sm:text-5xl">
              Ask your AI.<br />
              <em className="text-navy">It answers from the Savants.</em>
            </h2>
            <p className="mt-6 max-w-xl text-[15.5px] leading-relaxed text-muted">
              Add Western Conference Elitists to Claude, then ask about any NBA or NFL player, UFC
              fighter, head coach or draft prospect in plain words. Instead of guessing, it looks
              the answer up here: the same percentiles you see on the page, the group each one is
              measured against, and a link back to the card.
            </p>
            <div className="mt-7">
              <span className="kicker text-[10.5px] text-faint">What it can look up</span>
              <ul className="mt-3 flex flex-wrap gap-2">
                {COVERS.map((c) => (
                  <li
                    key={c}
                    className="rounded-full border border-line px-3.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <Example />
          </Reveal>
        </div>

        <Reveal delay={80}>
          <ol className="aic-steps mt-14 grid grid-cols-1 gap-x-10 gap-y-10 md:grid-cols-3 lg:mt-20">
            <li>
              <span className="text-display text-3xl text-gold-deep">01</span>
              <h3 className="text-display mt-3 text-xl text-ink">Copy the address</h3>
              <p>This is the whole connector. There is nothing to install and no account to make.</p>
              <CopyAddress />
            </li>
            <li>
              <span className="text-display text-3xl text-gold-deep">02</span>
              <h3 className="text-display mt-3 text-xl text-ink">Add it in Claude</h3>
              <p>
                Open <b>Customize</b>, then <b>Connectors</b>. Add a <b>custom</b> connector, name it
                WCE, and paste the address. It asks for no sign-in.
              </p>
              <a className="aic-link" href={CLAUDE_GUIDE} target="_blank" rel="noreferrer">
                Claude’s step-by-step guide <span aria-hidden="true">↗</span>
              </a>
            </li>
            <li>
              <span className="text-display text-3xl text-gold-deep">03</span>
              <h3 className="text-display mt-3 text-xl text-ink">Ask</h3>
              <p>
                In a chat, press <b>+</b>, open <b>Connectors</b> and switch WCE on. Then ask the way
                you would ask a friend who has the numbers open:
              </p>
              <ul className="aic-asks">
                {PROMPTS.map((q) => (
                  <li key={q}>“{q}”</li>
                ))}
              </ul>
            </li>
          </ol>
        </Reveal>

        <p className="mt-12 border-t border-line-soft pt-5 font-mono-tight text-[11.5px] leading-relaxed text-faint">
          Free. It only looks things up: it cannot vote, post or change anything. Built on MCP, the
          open standard for AI connectors, so other AI apps that take a connector by address can
          use it too.
        </p>
      </div>
    </section>
  )
}
