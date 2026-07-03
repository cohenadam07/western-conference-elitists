import SectionHeading from '../components/SectionHeading.jsx'
import Button from '../components/Button.jsx'
import { FOUNDER } from '../data/content.js'

const VOICE_TRAITS = [
  { label: 'Confident', body: 'We take positions and defend them with evidence, not hedges.' },
  { label: 'Concise', body: "If a sentence isn't earning its place, it gets cut." },
  { label: 'Film-Literate', body: 'We talk about basketball the way scouts do, not the way headlines do.' },
  { label: 'Numbers-Honest', body: 'Data informs the take. It never replaces watching the games.' },
]

const METHOD = [
  {
    title: 'Tape Logging',
    body:
      'Every prospect and every team we cover gets multiple full-game charting sessions before a single grade or take goes out. We track possession-level tendencies, not just box score totals.',
  },
  {
    title: 'Statistical Translation',
    body:
      'We run player and team production through models trained on a decade of actual outcomes — draft results, trade value, lineup data — adjusted for role, competition, and usage.',
  },
  {
    title: 'Cross-Check & Revise',
    body:
      'Every call is reviewed against measurement data, on-gold evidence, and context — and revised publicly when the evidence changes.',
  },
]

export default function About() {
  return (
    <div>
      <section className="border-b border-line bg-wash">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:px-10 lg:py-28">
          <span className="font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-navy">
            About Us
          </span>
          <h1 className="text-display mt-4 text-4xl text-ink sm:text-5xl lg:text-6xl">
            We built the basketball media outlet we couldn't find anywhere else.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            Western Conference Elitists covers the NBA year-round — trades,
            team building, playoff strategy, and the draft prospects who will
            be running the league in five years. Most basketball media drowns
            you in unverified opinions or unverified measurements. We try to
            do neither — and to be honest when we get it wrong.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Mission" title="Evaluation Over Entertainment" />
            <p className="mt-6 text-base leading-relaxed text-muted">
              Basketball media rewards volume — hot takes after every game,
              reaction content to every transaction, opinions calibrated for
              engagement instead of accuracy. We built Western Conference
              Elitists to do the opposite: fewer, sharper pieces, grounded in
              actual film study and tested against real outcomes, across
              everything from trade analysis to team-building philosophy to
              the draft.
            </p>
            <p className="mt-4 text-base leading-relaxed text-muted">
              We happen to take the draft more seriously than most outlets —
              but that is one specialty inside a broader mission. We are not
              trying to predict outcomes for clicks. We are trying to explain
              what is actually happening on the floor and why it matters,
              whether that is a prospect's tape, a contender's rotation, or a
              front office's cap sheet.
            </p>
          </div>
          <div>
            <SectionHeading eyebrow="What's Different" title="Data-Driven, Film-Informed" />
            <div className="mt-6 space-y-4">
              {METHOD.map((m) => (
                <div key={m.title} className="rounded-md border border-line bg-surface p-5">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-navy">
                    {m.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{m.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Voice/tone */}
      <section className="border-y border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <SectionHeading
            eyebrow="Voice"
            title="How We Sound"
            subtitle="Every piece we publish goes through the same filter."
          />
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {VOICE_TRAITS.map((v) => (
              <div key={v.label} className="card-hover rounded-md border border-line bg-surface p-6">
                <h3 className="text-display text-2xl text-navy">{v.label}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Founder */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <SectionHeading eyebrow="The Editor" title="Who's Behind the Board" />
        <div className="mt-10 flex flex-col gap-8 rounded-md border border-line bg-surface p-8 lg:flex-row lg:items-center lg:p-12">
          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-display text-3xl text-navy">
            {FOUNDER.name
              .split(' ')
              .map((n) => n[0])
              .join('')}
          </div>
          <div>
            <h3 className="text-display text-2xl text-ink">{FOUNDER.name}</h3>
            <p className="mt-1 text-sm font-medium uppercase tracking-wide text-navy">
              {FOUNDER.title}
            </p>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
              {FOUNDER.bio}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24 lg:px-10">
        <div className="flex flex-col items-center gap-6 rounded-md border border-line bg-surface p-12 text-center">
          <h3 className="text-display text-3xl text-ink">Think we got a grade wrong?</h3>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Good. Tell us why. The best feedback we get comes from people who
            disagree with the board for a real reason.
          </p>
          <Button to="/contact">Get In Touch</Button>
        </div>
      </section>
    </div>
  )
}
