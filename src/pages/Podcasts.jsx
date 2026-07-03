import { useMemo, useState } from 'react'
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
      <section className="border-b border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
          <span className="font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-navy">
            Podcasts
          </span>
          <h1 className="text-display mt-4 max-w-3xl text-4xl text-ink sm:text-5xl lg:text-6xl">
            {PODCAST_SHOW.name}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-faintd">
            {PODCAST_SHOW.tagline}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {PODCAST_SHOW.platforms.map((p) => (
              <a
                key={p.label}
                href={p.href}
                className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-semibold uppercase tracking-wide text-faintd transition-colors hover:border-navy hover:text-navy"
              >
                {p.label}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Latest episode */}
      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="card-hover relative overflow-hidden rounded-md border border-line bg-surface p-8 lg:p-10">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-navy via-red to-gold" />
          <span className="w-fit rounded-full bg-navy px-3 py-1 font-mono-tight text-xs font-semibold uppercase tracking-widest text-white">
            Latest · Episode {latest.episode}
          </span>
          <h2 className="text-display mt-4 max-w-2xl text-3xl leading-tight text-ink sm:text-4xl">
            {latest.title}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-faintd">
            {latest.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button className="rounded-sm bg-navy px-6 py-3 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-navy-deep">
              ▶ Play Episode
            </button>
            <span className="text-xs text-faint">
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
            <div className="flex flex-wrap gap-2">
              {['All', ...CATEGORIES].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    filter === cat
                      ? 'border-navy bg-navy text-white'
                      : 'border-line bg-surface text-faintd hover:border-faint hover:text-ink'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10 flex flex-col divide-y divide-line border-y border-line">
            {filtered.map((p) => (
              <article
                key={p.slug}
                className="group flex flex-col gap-3 py-6 transition-colors hover:bg-paper/50 sm:flex-row sm:items-center sm:gap-6 sm:px-2"
              >
                <button className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-navy transition-colors group-hover:border-navy group-hover:bg-navy group-hover:text-white">
                  ▶
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono-tight text-xs font-semibold uppercase tracking-widest text-navy">
                      Ep. {p.episode} · {p.category}
                    </span>
                  </div>
                  <h4 className="mt-1 text-lg font-bold leading-snug text-ink">{p.title}</h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-faintd">{p.description}</p>
                </div>
                <div className="shrink-0 text-left font-mono-tight text-xs text-faint sm:text-right">
                  <p>{p.date}</p>
                  <p className="mt-1">{p.duration}</p>
                </div>
              </article>
            ))}
            {filtered.length === 0 && (
              <p className="py-10 text-center text-faintd">
                No episodes in this category yet.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
