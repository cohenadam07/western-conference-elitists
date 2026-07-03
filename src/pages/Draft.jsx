import { useMemo, useState } from 'react'
import SectionHeading from '../components/SectionHeading.jsx'
import YearSelector from '../components/YearSelector.jsx'
import PageHeader from '../components/PageHeader.jsx'
import FilterChips from '../components/FilterChips.jsx'
import { DRAFT_CLASSES, DRAFT_YEARS, POSITION_GROUPS } from '../data/content.js'
import usePageMeta from '../lib/usePageMeta.js'

const POSITIONS = ['All', ...POSITION_GROUPS]

export default function Draft() {
  usePageMeta('Draft Hub', 'Full scouting profiles, measurements, and role projections for the NBA Draft class.')
  const [year, setYear] = useState(DRAFT_YEARS[0].year)
  const [filter, setFilter] = useState('All')

  const { prospects } = DRAFT_CLASSES[year]
  const spotlight = prospects[0]

  const filtered = useMemo(
    () => (filter === 'All' ? prospects : prospects.filter((p) => p.positionGroup === filter)),
    [filter, prospects]
  )

  return (
    <div>
      <PageHeader
        eyebrow="Draft Hub"
        title={`Thirty-${year === 2026 ? 'six' : 'two'} prospects, ranked one through thirty-${year === 2026 ? 'six' : 'two'}.`}
        lede="Full scouting profiles, measurements, and role projections — analytics first, scouting always. One board, opinions included, consensus optional."
      >
        <YearSelector years={DRAFT_YEARS} selected={year} onChange={(y) => { setYear(y); setFilter('All') }} />
      </PageHeader>

      {/* Featured spotlight */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <SectionHeading eyebrow={`Featured Prospect · ${year}`} title="Under the Microscope" />
        <div className="relative mt-10 grid grid-cols-1 gap-8 overflow-hidden rounded-md border border-line bg-surface p-8 lg:grid-cols-[1fr_1fr] lg:p-12">
          <div className="absolute inset-x-0 top-0 h-[3px] bg-gold" aria-hidden="true" />
          <div>
            <div className="flex items-baseline gap-4">
              <span className="text-display text-6xl text-navy">
                {String(spotlight.rank).padStart(2, '0')}
              </span>
              <div>
                <h2 className="text-display text-3xl text-ink">
                  {spotlight.name}
                </h2>
                <p className="kicker mt-1.5 text-faint">
                  {spotlight.school} · {spotlight.position} ·{' '}
                  {spotlight.archetype}
                </p>
              </div>
            </div>

            <p className="mt-6 text-base leading-relaxed text-muted">
              {spotlight.summary}
            </p>

            <div className="mt-6 grid grid-cols-4 gap-3 font-mono-tight text-center text-xs">
              {[
                ['HT', spotlight.height],
                ['WS', spotlight.wingspan],
                ['WT', spotlight.weight],
                ['AGE', spotlight.age],
              ].map(([label, val]) => (
                <div key={label} className="rounded-md border border-line bg-paper py-4">
                  <p className="text-ink">{val}</p>
                  <p className="mt-1 text-faint">{label}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-md border border-line bg-paper p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                The Take
              </p>
              <p className="mt-2 text-sm font-medium text-green">
                {spotlight.take}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-md border border-line bg-paper p-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-green">
                Strengths
              </h3>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
                {spotlight.strengths.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="text-green">+</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-line bg-paper p-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-red">
                Weaknesses
              </h3>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
                {spotlight.weaknesses.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="text-red">−</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="col-span-full rounded-md border border-line bg-paper p-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-gold-deep">
                Role Projection
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {spotlight.projection}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Filters + grid */}
      <section className="border-t border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading eyebrow={`Full Pool · ${prospects.length} Prospects`} title="Browse Prospects" />
            <FilterChips
              options={POSITIONS}
              active={filter}
              onChange={setFilter}
              label="Filter prospects by position"
            />
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <div key={p.rank} className="card-hover flex flex-col rounded-md border border-line bg-surface p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-baseline gap-3">
                    <span className="text-display text-3xl text-navy">
                      {String(p.rank).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className="text-display text-lg text-ink">{p.name}</h3>
                      <p className="kicker mt-0.5 text-faint">
                        {p.school} · {p.position}
                      </p>
                    </div>
                  </div>
                  <span className="rounded-sm border border-line bg-paper px-2 py-1 font-mono-tight text-xs font-semibold text-muted">
                    {p.grade}
                  </span>
                </div>
                {p.tag && (
                  <span className="mt-3 w-fit rounded-sm bg-green/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-green">
                    ▲ {p.tag}
                  </span>
                )}
                <p className="mt-4 text-sm leading-relaxed text-muted">{p.summary}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <span className="rounded-sm bg-paper px-2 py-1 font-mono-tight text-xs text-muted">
                    {p.height}
                  </span>
                  <span className="rounded-sm bg-paper px-2 py-1 font-mono-tight text-xs text-muted">
                    {p.wingspan} WS
                  </span>
                  <span className="rounded-sm bg-paper px-2 py-1 font-mono-tight text-xs text-muted">
                    {p.archetype}
                  </span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center gap-3 py-16 text-center">
                <span className="text-display text-3xl text-faint">Empty board</span>
                <p className="max-w-sm text-sm leading-relaxed text-muted">
                  No prospects match that position yet — check back as the board updates.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
