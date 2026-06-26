import { useState } from 'react'
import SectionHeading from '../components/SectionHeading.jsx'
import YearSelector from '../components/YearSelector.jsx'
import { DRAFT_CLASSES, DRAFT_YEARS } from '../data/content.js'

function ProspectRow({ p, isOpen, onToggle }) {
  return (
    <div
      className={`overflow-hidden rounded-md border transition-colors ${
        isOpen ? 'border-ember' : 'border-line'
      } bg-surface-2`}
    >
      <button
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-5 text-left sm:grid-cols-[auto_1fr_auto_auto_auto] sm:gap-6"
      >
        <span className="text-display text-3xl text-ember sm:text-4xl">
          {String(p.rank).padStart(2, '0')}
        </span>

        <div>
          <h3 className="text-base font-bold text-bone sm:text-lg">{p.name}</h3>
          <p className="text-xs uppercase tracking-wide text-mute">
            {p.school} · {p.position}
          </p>
        </div>

        <span className="hidden font-mono-tight text-xs text-bone-dim sm:block">
          {p.height} / {p.wingspan}
        </span>

        <span className="hidden rounded-sm border border-line bg-surface-3 px-2 py-1 text-center font-mono-tight text-xs font-bold text-bone-dim sm:block">
          {p.grade}
        </span>

        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full border border-line text-bone-dim transition-transform ${
            isOpen ? 'rotate-45 border-ember text-ember' : ''
          }`}
        >
          +
        </span>
      </button>

      <div
        className={`grid overflow-hidden transition-all duration-300 ${
          isOpen ? 'max-h-[700px]' : 'max-h-0'
        }`}
      >
        <div className="border-t border-line px-5 pb-6 pt-5 sm:px-6">
          {p.tag && (
            <span className="mb-3 inline-block w-fit rounded-sm bg-arena/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-arena">
              ▲ {p.tag}
            </span>
          )}
          <p className="text-sm leading-relaxed text-bone-dim">{p.summary}</p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-arena">
                Strengths
              </h4>
              <ul className="mt-2 space-y-1.5 text-sm text-bone-dim">
                {p.strengths.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="text-arena">+</span> {s}
                  </li>
                ))}
              </ul>
            </div>
            {p.weaknesses.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-foul">
                  Weaknesses
                </h4>
                <ul className="mt-2 space-y-1.5 text-sm text-bone-dim">
                  {p.weaknesses.map((s) => (
                    <li key={s} className="flex gap-2">
                      <span className="text-foul">−</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-3 font-mono-tight text-xs text-bone-dim">
            <span className="rounded-sm bg-surface-3 px-2 py-1">{p.height} HT</span>
            <span className="rounded-sm bg-surface-3 px-2 py-1">{p.wingspan} WS</span>
            <span className="rounded-sm bg-surface-3 px-2 py-1">{p.weight}</span>
            <span className="rounded-sm bg-surface-3 px-2 py-1">Age {p.age}</span>
            <span className="rounded-sm bg-surface-3 px-2 py-1">{p.archetype}</span>
          </div>

          <p className="mt-4 text-sm font-medium text-court">{p.projection}</p>
          <p className="mt-1 text-xs text-mute">{p.take}</p>
        </div>
      </div>
    </div>
  )
}

export default function Rankings() {
  const [year, setYear] = useState(DRAFT_YEARS[0].year)
  const [expanded, setExpanded] = useState(null)

  const { prospects, tiers } = DRAFT_CLASSES[year]

  return (
    <div>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-ember">
                Personal Big Board · Not a Consensus Mock
              </span>
              <h1 className="text-display mt-4 max-w-3xl text-4xl text-bone sm:text-5xl lg:text-6xl">
                The <span className="marker">Board</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-bone-dim">
                {prospects.length} prospects, ranked one through {prospects.length}.
                Analytics first, scouting always. Click any row to expand the
                full breakdown.
              </p>
            </div>
            <YearSelector
              years={DRAFT_YEARS}
              selected={year}
              onChange={(y) => { setYear(y); setExpanded(null) }}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16 lg:px-10">
        <SectionHeading
          eyebrow={`${tiers.length} Tiers · ${prospects.length} Names`}
          title={`All ${prospects.length}, Ranked`}
        />

        <div className="mt-12 flex flex-col gap-12">
          {tiers.map((t) => (
            <div key={t.tier}>
              <div className="mb-4 flex items-baseline gap-3 border-b border-line pb-3">
                <span className="text-display text-2xl text-ember">
                  {String(t.tier).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="text-display text-xl text-bone">{t.name}</h3>
                  <p className="text-xs uppercase tracking-wide text-mute">
                    {t.range} · {t.blurb}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {prospects.filter((p) => p.tier === t.tier).map((p) => (
                  <ProspectRow
                    key={p.rank}
                    p={p}
                    isOpen={expanded === p.rank}
                    onToggle={() => setExpanded(expanded === p.rank ? null : p.rank)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-mute">
          Board reflects film and data through the most recent publish date.
          Rankings are evaluation-based, not predictions of draft slot.
        </p>
      </section>
    </div>
  )
}
