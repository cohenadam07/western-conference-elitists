import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SectionHeading from '../components/SectionHeading.jsx'
import ArticleCard from '../components/ArticleCard.jsx'
import PageHeader from '../components/PageHeader.jsx'
import FilterChips from '../components/FilterChips.jsx'
import { ARTICLES, CATEGORIES, FEATURED_ARTICLE } from '../data/content.js'
import usePageMeta from '../lib/usePageMeta.js'

export default function Articles() {
  usePageMeta('Analysis', 'Scouting breakdowns, team-building theory, and NBA analytics that hold up under pressure.')
  const [searchParams, setSearchParams] = useSearchParams()
  const activeCategory = searchParams.get('category') || 'All'
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    return ARTICLES.filter((a) => {
      const matchesCategory = activeCategory === 'All' || a.category === activeCategory
      const matchesQuery =
        query.trim() === '' ||
        a.title.toLowerCase().includes(query.toLowerCase()) ||
        a.excerpt.toLowerCase().includes(query.toLowerCase())
      return matchesCategory && matchesQuery
    })
  }, [activeCategory, query])

  const setCategory = (cat) => {
    if (cat === 'All') {
      searchParams.delete('category')
    } else {
      searchParams.set('category', cat)
    }
    setSearchParams(searchParams)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Analysis"
        title="Draft and NBA analysis worth your time."
        lede="Scouting breakdowns, team-building theory, and the analytics that actually hold up under pressure."
      />

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <ArticleCard article={FEATURED_ARTICLE} featured />
      </section>

      <section className="border-t border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeading eyebrow="Browse" title="All Articles" />
            <div className="relative w-full sm:w-72">
              <label htmlFor="article-search" className="sr-only">
                Search articles
              </label>
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint"
              >
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l3.5 3.5" strokeLinecap="round" />
              </svg>
              <input
                id="article-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search articles..."
                className="w-full rounded-sm border border-line bg-surface py-3 pl-11 pr-4 text-sm text-ink placeholder:text-faint focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
              />
            </div>
          </div>

          <div className="mt-6">
            <FilterChips
              options={['All', ...CATEGORIES]}
              active={activeCategory}
              onChange={setCategory}
              label="Filter articles by category"
            />
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((a) => (
              <ArticleCard key={a.slug} article={a} />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center gap-3 py-16 text-center">
                <span className="text-display text-3xl text-faint">No matches</span>
                <p className="max-w-sm text-sm leading-relaxed text-muted">
                  Nothing matches that search yet. Try a different term or category.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
