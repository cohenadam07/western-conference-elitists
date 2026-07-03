import { useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import FilterChips from '../components/FilterChips.jsx'
import { CATEGORIES, PODCASTS, PODCAST_SHOW } from '../data/content.js'

export default function Podcasts() {
  const [filter, setFilter] = useState('All')

  const filtered = useMemo(
    () => (filter === 'All' ? PODCASTS : PODCASTS.filter((p) => p.category === filter)),
    [filter]
  )

  const latest = PODCASTS[0]

  return (
    <div>
      <PageHeader
        eyebrow="Podcasts"
        title={PODCAST_SHOW.name}
        lede={
          <>
            {PODCAST_SHOW.tagline}
            <span className="mt-6 flex flex-wrap gap-2">
              {PODCAST_SHOW.platforms.map((p) => (
                <a
                  key={p.label}
                  href={p.href}
                  className="rounded-full border border-line bg-surface px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted transition-colors hover:border-gold hover:text-navy"
                >
                  {p.label}
                </a>
              ))}
            </span>
          </>
        }
      />

      {/* Latest episode */}
      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="card-hover relative overflow-hidden rounded-md border border-line bg-surface p-8 lg:p-10">
          <div className="absolute inset-x-0 top-0 h-[3px] bg-gold" aria-hidden="true" />
          <span className="kicker w-fit text-gold-deep">
            Latest · Episode {latest.episode}
          </span>
          <h2 className="text-display mt-4 max-w-2xl text-3xl leading-tight text-ink sm:text-4xl">
            {latest.title}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
            {latest.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button className="rounded-sm bg-navy px-6 py-3 font-mono text-[12.5px] font-medium uppercase tracking-[0.12em] text-white transition-all duration-300 hover:-translate-y-px hover:bg-navy-deep">
              ▶ Play Episode
            </button>
            <span className="font-mono-tight text-xs text-faint">
              {latest.date} · {latest.duration}
            </span>
          </div>
        </div>
      </section>

      {/* Archive */}
      <section className="border-t border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <h3 className="text-display text-2xl text-ink">All Episodes</h3>
            <FilterChips
              options={['All', ...CATEGORIES]}
              active={filter}
              onChange={setFilter}
              label="Filter episodes by category"
            />
          </div>

          <div className="mt-10 flex flex-col divide-y divide-line border-y border-line">
            {filtered.map((p) => (
              <article
                key={p.slug}
                className="group flex flex-col gap-3 py-6 transition-colors hover:bg-surface/70 sm:flex-row sm:items-center sm:gap-6 sm:px-2"
              >
                <button className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-navy transition-colors group-hover:border-navy group-hover:bg-navy group-hover:text-white">
                  ▶
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="kicker text-gold-deep">
                      Ep. {p.episode} · {p.category}
                    </span>
                  </div>
                  <h4 className="text-display mt-1 text-xl leading-snug text-ink transition-colors group-hover:text-navy">{p.title}</h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{p.description}</p>
                </div>
                <div className="shrink-0 text-left font-mono-tight text-xs text-faint sm:text-right">
                  <p>{p.date}</p>
                  <p className="mt-1">{p.duration}</p>
                </div>
              </article>
            ))}
            {filtered.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <span className="text-display text-3xl text-faint">Nothing queued</span>
                <p className="max-w-sm text-sm leading-relaxed text-muted">
                  No episodes in this category yet.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
