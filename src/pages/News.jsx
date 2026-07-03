import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader.jsx'
import FilterChips from '../components/FilterChips.jsx'
import { CATEGORIES, NEWS_ITEMS } from '../data/content.js'
import usePageMeta from '../lib/usePageMeta.js'

export default function News() {
  usePageMeta('News', 'Fast hits on trades, injuries, front-office moves, and the draft circuit from Western Conference Elitists.')
  const [filter, setFilter] = useState('All')

  const filtered = useMemo(
    () => (filter === 'All' ? NEWS_ITEMS : NEWS_ITEMS.filter((n) => n.category === filter)),
    [filter]
  )

  return (
    <div>
      <PageHeader
        eyebrow="Wire · Updated Throughout the Day"
        title="News"
        lede={
          <>
            Fast hits on trades, injuries, front-office moves, and the draft
            circuit — the short version. For the long version, head to{' '}
            <Link to="/articles" className="font-semibold text-navy underline decoration-gold decoration-2 underline-offset-4 hover:text-navy-deep">
              Analysis
            </Link>
            .
          </>
        }
      />

      <section className="mx-auto max-w-4xl px-6 py-12 lg:px-10">
        <FilterChips
          options={['All', ...CATEGORIES]}
          active={filter}
          onChange={setFilter}
          label="Filter news by category"
        />

        <div className="mt-8 divide-y divide-line border-y border-line">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="group flex flex-col gap-2 py-6 transition-colors hover:bg-surface/70 sm:flex-row sm:items-baseline sm:gap-6 sm:px-3"
            >
              <div className="flex shrink-0 items-center gap-3 sm:w-28">
                <span className="font-mono-tight text-xs text-faint">{item.timestamp}</span>
              </div>
              <div className="flex-1">
                <span className="kicker text-gold-deep">{item.category}</span>
                <h2 className="text-display mt-1.5 text-xl leading-snug text-ink transition-colors group-hover:text-navy">
                  {item.headline}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.blurb}</p>
              </div>
            </article>
          ))}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="text-display text-3xl text-faint">Quiet on the wire</span>
              <p className="max-w-sm text-sm leading-relaxed text-muted">
                Nothing in this category yet — check back soon.
              </p>
            </div>
          )}
        </div>

        <p className="mt-8 text-center font-mono-tight text-xs text-faint">
          News items are short-form and unsigned. Bylined analysis lives on the
          Analysis page.
        </p>
      </section>
    </div>
  )
}
