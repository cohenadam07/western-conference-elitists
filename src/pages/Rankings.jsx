import { useState } from 'react'
import SectionHeading from '../components/SectionHeading.jsx'
import YearSelector from '../components/YearSelector.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { DRAFT_CLASSES, DRAFT_YEARS } from '../data/content.js'
import usePageMeta from '../lib/usePageMeta.js'

function ProspectRow({ p, isOpen, onToggle }) {
  return (
    <div
      className={`overflow-hidden rounded-md border transition-colors ${
        isOpen ? 'border-navy' : 'border-line'
      } bg-surface`}
    >
      <button
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-5 text-left sm:grid-cols-[auto_1fr_auto_auto_auto] sm:gap-6"
      >
        <span className="text-display text-3xl text-navy sm:text-4xl">
          {String(p.rank).padStart(2, '0')}
        </span>

        <div>
          <h3 className="text-display text-lg text-ink sm:text-xl">{p.name}</h3>
          <p className="kicker mt-0.5 text-faint">
            {p.school} · {p.position}
          </p>
        </div>

        <span className="hidden font-mono-tight text-xs text-muted sm:block">
          {p.height} / {p.wingspan}
        </span>

        <span className="hidden rounded-sm border border-line bg-paper px-2 py-1 text-center font-mono-tight text-xs font-bold text-muted sm:block">
          {p.grade}
        </span>

        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition-transform ${
            isOpen ? 'rotate-45 border-navy text-navy' : ''
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
            <span className="mb-3 inline-block w-fit rounded-sm bg-green/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-green">
              ▲ {p.tag}
            </span>
          )}
          <p className="text-sm leading-relaxed text-muted">{p.summary}</p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-green">
                Strengths
              </h4>
              <ul className="mt-2 space-y-1.5 text-sm text-muted">
                {p.strengths.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="text-green">+</span> {s}
                  </li>
                ))}
              </ul>
            </div>
            {p.weaknesses.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-red">
                  Weaknesses
                </h4>
                <ul className="mt-2 space-y-1.5 text-sm text-muted">
                  {p.weaknesses.map((s) => (
                    <li key={s} className="flex gap-2">
                      <span className="text-red">−</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-3 font-mono-tight text-xs text-muted">
            <span className="rounded-sm bg-paper px-2 py-1">{p.height} HT</span>
            <span className="rounded-sm bg-paper px-2 py-1">{p.wingspan} WS</span>
            <span className="rounded-sm bg-paper px-2 py-1">{p.weight}</span>
            <span className="rounded-sm bg-paper px-2 py-1">Age {p.age}</span>
            <span className="rounded-sm bg-paper px-2 py-1">{p.archetype}</span>
          </div>

          <p className="mt-4 text-sm font-medium text-gold-deep">{p.projection}</p>
          <p className="mt-1 text-xs text-faint">{p.take}</p>
        </div>
      </div>
    </div>
  )
}

export default function Rankings() {
  usePageMeta('Big Board', 'The WCE Big Board — every prospect ranked and tiered, analytics first, scouting always.')
  const [year, setYear] = useState(DRAFT_YEARS[0].year)
  const [expanded, setExpanded] = useState(null)

  const { prospects, tiers } = DRAFT_CLASSES[year]

  return (
    <div>
      <PageHeader
        eyebrow="Personal Big Board · Not a Consensus Mock"
        title={
          <>
            The <span className="marker">Board</span>
          </>
        }
        lede={`${prospects.length} prospects, ranked one through ${prospects.length}. Analytics first, scouting always. Click any row to expand the full breakdown.`}
      >
        <YearSelector
          years={DRAFT_YEARS}
          selected={year}
          onChange={(y) => { setYear(y); setExpanded(null) }}
        />
      </PageHeader>

      <section className="mx-auto max-w-6xl px-6 py-16 lg:px-10">
        <SectionHeading
          eyebrow={`${tiers.length} Tiers · ${prospects.length} Names`}
          title={`All ${prospects.length}, Ranked`}
        />

        <div className="mt-12 flex flex-col gap-12">
          {tiers.map((t) => (
            <div key={t.tier}>
              <div className="mb-4 border-b-2 border-navy pb-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-display text-2xl text-gold-deep">
                    {String(t.tier).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="text-display text-xl text-ink">{t.name}</h3>
                    <p className="kicker mt-1 text-faint">
                      {t.range} · {t.blurb}
                    </p>
                  </div>
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

        <p className="mt-10 text-center text-xs text-faint">
          Board reflects film and data through the most recent publish date.
          Rankings are evaluation-based, not predictions of draft slot.
        </p>
      </section>
    </div>
  )
}
