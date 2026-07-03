import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SectionHeading from '../components/SectionHeading.jsx'
import ArticleCard from '../components/ArticleCard.jsx'
import { ARTICLES, CATEGORIES, FEATURED_ARTICLE } from '../data/content.js'

export default function Articles() {
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
      <section className="border-b border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-24">
          <span className="font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-navy">
            Analysis
          </span>
          <h1 className="text-display mt-4 max-w-3xl text-4xl text-ink sm:text-5xl lg:text-6xl">
            Draft and NBA analysis worth your time.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-faintd">
            Scouting breakdowns, team-building theory, and the analytics that
            actually hold up under pressure.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <ArticleCard article={FEATURED_ARTICLE} featured />
      </section>

      <section className="border-t border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeading eyebrow="Browse" title="All Articles" />
            <div className="relative w-full sm:w-72">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search articles..."
                className="w-full rounded-sm border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-faint focus:border-navy focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {['All', ...CATEGORIES].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  activeCategory === cat
                    ? 'border-navy bg-navy text-white'
                    : 'border-line bg-surface text-faintd hover:border-faintd hover:text-ink'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((a) => (
              <ArticleCard key={a.slug} article={a} />
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-10 text-center text-faintd">
                Nothing matches that search yet. Try a different term or category.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
