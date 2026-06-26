import { useMemo, useState } from 'react'
import SectionHeading from '../components/SectionHeading.jsx'
import YearSelector from '../components/YearSelector.jsx'
import { DRAFT_CLASSES, DRAFT_YEARS, POSITION_GROUPS } from '../data/content.js'

const POSITIONS = ['All', ...POSITION_GROUPS]

export default function Draft() {
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
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-ember">
                Draft Hub
              </span>
              <h1 className="text-display mt-4 max-w-3xl text-4xl text-bone sm:text-5xl lg:text-6xl">
                Thirty-{year === 2026 ? 'six' : 'two'} prospects, ranked one through
                thirty-{year === 2026 ? 'six' : 'two'}.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-bone-dim">
                Full scouting profiles, measurements, and role projections —
                analytics first, scouting always. One board, opinions
                included, consensus optional.
              </p>
            </div>
            <YearSelector years={DRAFT_YEARS} selected={year} onChange={(y) => { setYear(y); setFilter('All') }} />
          </div>
        </div>
      </section>

      {/* Featured spotlight */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <SectionHeading eyebrow={`Featured Prospect · ${year}`} title="Under the Microscope" />
        <div className="mt-10 grid grid-cols-1 gap-8 rounded-md border border-line bg-surface-2 p-8 lg:grid-cols-[1fr_1fr] lg:p-12">
          <div>
            <div className="flex items-baseline gap-4">
              <span className="text-display text-6xl text-ember">
                {String(spotlight.rank).padStart(2, '0')}
              </span>
              <div>
                <h2 className="text-display text-3xl text-bone">
                  {spotlight.name}
                </h2>
                <p className="text-sm uppercase tracking-wide text-mute">
                  {spotlight.school} · {spotlight.position} ·{' '}
                  {spotlight.archetype}
                </p>
              </div>
            </div>

            <p className="mt-6 text-base leading-relaxed text-bone-dim">
              {spotlight.summary}
            </p>

            <div className="mt-6 grid grid-cols-4 gap-3 font-mono-tight text-center text-xs">
              {[
                ['HT', spotlight.height],
                ['WS', spotlight.wingspan],
                ['WT', spotlight.weight],
                ['AGE', spotlight.age],
              ].map(([label, val]) => (
                <div key={label} className="rounded-md border border-line bg-surface-3 py-4">
                  <p className="text-bone">{val}</p>
                  <p className="mt-1 text-mute">{label}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-md border border-line bg-surface-3 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-mute">
                The Take
              </p>
              <p className="mt-2 text-sm font-medium text-arena">
                {spotlight.take}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-md border border-line bg-surface-3 p-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-arena">
                Strengths
              </h3>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-bone-dim">
                {spotlight.strengths.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="text-arena">+</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-line bg-surface-3 p-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-foul">
                Weaknesses
              </h3>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-bone-dim">
                {spotlight.weaknesses.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="text-foul">−</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="col-span-full rounded-md border border-line bg-surface-3 p-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-court">
                Role Projection
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-bone-dim">
                {spotlight.projection}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Filters + grid */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading eyebrow={`Full Pool · ${prospects.length} Prospects`} title="Browse Prospects" />
            <div className="flex flex-wrap gap-2">
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  onClick={() => setFilter(pos)}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    filter === pos
                      ? 'border-ember bg-ember text-ink'
                      : 'border-line bg-surface-2 text-bone-dim hover:border-bone-dim hover:text-bone'
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <div key={p.rank} className="card-hover flex flex-col rounded-md border border-line bg-surface-2 p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-baseline gap-3">
                    <span className="text-display text-3xl text-ember">
                      {String(p.rank).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className="font-bold text-bone">{p.name}</h3>
                      <p className="text-xs uppercase tracking-wide text-mute">
                        {p.school} · {p.position}
                      </p>
                    </div>
                  </div>
                  <span className="rounded-sm border border-line bg-surface-3 px-2 py-1 font-mono-tight text-xs font-bold text-bone-dim">
                    {p.grade}
                  </span>
                </div>
                {p.tag && (
                  <span className="mt-3 w-fit rounded-sm bg-arena/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-arena">
                    ▲ {p.tag}
                  </span>
                )}
                <p className="mt-4 text-sm leading-relaxed text-bone-dim">{p.summary}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-sm bg-surface-3 px-2 py-1 text-xs text-mute">
                    {p.height}
                  </span>
                  <span className="rounded-sm bg-surface-3 px-2 py-1 text-xs text-mute">
                    {p.wingspan} WS
                  </span>
                  <span className="rounded-sm bg-surface-3 px-2 py-1 text-xs text-mute">
                    {p.archetype}
                  </span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-10 text-center text-bone-dim">
                No prospects match that position yet — check back as the board updates.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
