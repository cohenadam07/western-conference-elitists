import { Link, useParams } from 'react-router-dom'
import { ARTICLES } from '../data/content.js'
import ArticleCard from '../components/ArticleCard.jsx'
import NewsletterCTA from '../components/NewsletterCTA.jsx'

// Placeholder long-form body paragraphs, reused across articles for the demo.
const BODY = [
  "Strip the noise away from this position group and a clear pattern emerges on tape: the players who translate are not the ones with the gaudiest per-game numbers, they are the ones whose tendencies hold up against better length, better discipline, and a faster game.",
  "We charted every relevant possession across the last six weeks of available film. The conclusion was not subtle — there is a real talent gap once you separate prospects by how they generate offense rather than how much offense they generate.",
  "None of this means measurements and box scores are useless. They are a starting point. But they are the floor of the evaluation, not the ceiling, and treating them as the whole picture is how boards end up wrong every June.",
  "Where this gets interesting is in the players being slept on because their counting stats do not jump off the page. Role, usage, and supporting cast distort raw production constantly — context is not an excuse, it is a variable that has to be adjusted for.",
  "Our take, plainly: bet on translatable skills over gaudy production every time the two are in conflict. It has been the more reliable signal for as long as we have been tracking outcomes against pre-draft profiles.",
]

export default function ArticleDetail() {
  const { slug } = useParams()
  const article = ARTICLES.find((a) => a.slug === slug) || ARTICLES[0]
  const related = ARTICLES.filter((a) => a.slug !== article.slug).slice(0, 3)

  return (
    <div>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-3xl px-6 py-20 lg:px-10 lg:py-24">
          <Link
            to="/articles"
            className="text-xs font-semibold uppercase tracking-wide text-bone-dim hover:text-bone"
          >
            ← All Analysis
          </Link>
          <span className="mt-6 block font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-ember">
            {article.category}
          </span>
          <h1 className="text-display mt-4 text-3xl leading-tight text-bone sm:text-4xl lg:text-5xl">
            {article.title}
          </h1>
          <div className="mt-6 flex items-center gap-3 text-xs text-mute">
            <span>{article.date}</span>
            <span>·</span>
            <span>{article.readTime}</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-16 lg:px-10">
        <p className="text-lg leading-relaxed text-bone-dim">{article.excerpt}</p>
        <div className="mt-8 space-y-6">
          {BODY.map((para, i) => (
            <p key={i} className="text-base leading-relaxed text-bone-dim">
              {para}
            </p>
          ))}
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
          <h3 className="text-display text-2xl text-bone">Keep Reading</h3>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((a) => (
              <ArticleCard key={a.slug} article={a} />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <NewsletterCTA />
      </section>
    </div>
  )
}
