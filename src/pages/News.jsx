import { useMemo, useState } from 'react'
import { CATEGORIES, NEWS_ITEMS } from '../data/content.js'

export default function News() {
  const [filter, setFilter] = useState('All')

  const filtered = useMemo(
    () => (filter === 'All' ? NEWS_ITEMS : NEWS_ITEMS.filter((n) => n.category === filter)),
    [filter]
  )

  return (
    <div>
      <section className="border-b border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
          <span className="font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-navy">
            Wire · Updated Throughout the Day
          </span>
          <h1 className="text-display mt-4 max-w-3xl text-4xl text-ink sm:text-5xl">
            News
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-faintd">
            Fast hits on trades, injuries, front-office moves, and the draft
            circuit — the short version. For the long version, head to{' '}
            <span className="font-semibold text-navy">Analysis</span>.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-12 lg:px-10">
        <div className="flex flex-wrap gap-2">
          {['All', ...CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                filter === cat
                  ? 'border-navy bg-navy text-white'
                  : 'border-line bg-surface text-faintd hover:border-faint hover:text-ink'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="mt-8 divide-y divide-line border-y border-line">
          {filtered.map((item) => (
            <article key={item.id} className="group flex flex-col gap-2 py-6 transition-colors hover:bg-paper/50 sm:flex-row sm:items-baseline sm:gap-6 sm:px-2">
              <div className="flex shrink-0 items-center gap-3 sm:w-32">
                <span className="font-mono-tight text-xs text-faint">{item.timestamp}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono-tight text-xs font-semibold uppercase tracking-widest text-navy">
                    {item.category}
                  </span>
                </div>
                <h2 className="mt-1.5 text-lg font-bold leading-snug text-ink transition-colors group-hover:text-navy">
                  {item.headline}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-faintd">{item.blurb}</p>
              </div>
            </article>
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-faintd">
              Nothing in this category yet — check back soon.
            </p>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-faint">
          News items are short-form and unsigned. Bylined analysis lives on
          the Analysis page.
        </p>
      </section>
    </div>
  )
}
