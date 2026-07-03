import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ARTICLES, FOUNDER } from '../data/content.js'
import ArticleCard from '../components/ArticleCard.jsx'
import NewsletterCTA from '../components/NewsletterCTA.jsx'
import CourtLines from '../components/CourtLines.jsx'
import usePageMeta from '../lib/usePageMeta.js'

// Placeholder long-form body paragraphs, reused across articles for the demo.
const BODY = [
  "Strip the noise away from this position group and a clear pattern emerges on tape: the players who translate are not the ones with the gaudiest per-game numbers, they are the ones whose tendencies hold up against better length, better discipline, and a faster game.",
  "We charted every relevant possession across the last six weeks of available film. The conclusion was not subtle — there is a real talent gap once you separate prospects by how they generate offense rather than how much offense they generate.",
  "None of this means measurements and box scores are useless. They are a starting point. But they are the floor of the evaluation, not the ceiling, and treating them as the whole picture is how boards end up wrong every June.",
  "Where this gets interesting is in the players being slept on because their counting stats do not jump off the page. Role, usage, and supporting cast distort raw production constantly — context is not an excuse, it is a variable that has to be adjusted for.",
]

const PULL_QUOTE =
  'Bet on translatable skills over gaudy production every time the two are in conflict. It has been the more reliable signal for as long as we have been tracking outcomes.'

const CLOSING =
  'Our take, plainly: it has been the more reliable signal for as long as we have been tracking outcomes against pre-draft profiles — and nothing about this cycle suggests that is changing.'

function ShareRow({ article }) {
  const [copied, setCopied] = useState(false)

  const url = typeof window !== 'undefined' ? window.location.href : ''
  const shareText = `${article.title} — Western Conference Elitists`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="kicker text-faint">Share</span>
      <a
        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Share on X"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-navy hover:text-navy"
      >
        <svg width="13" height="13" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <path d="M13.3 2H16l-5.9 6.75L17 18h-5.44l-4.26-5.57L2.42 18H-.27l6.32-7.22L-.7 2h5.58l3.85 5.09L13.3 2zm-.95 14.4h1.5L4.05 3.52H2.44L12.35 16.4z" />
        </svg>
      </a>
      <a
        href={`mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(url)}`}
        aria-label="Share by email"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-navy hover:text-navy"
      >
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="1.5" y="3.5" width="15" height="11" rx="1.5" />
          <path d="M2 4.5L9 10l7-5.5" />
        </svg>
      </a>
      <button
        onClick={copyLink}
        aria-label="Copy link"
        className="flex h-9 items-center justify-center gap-2 rounded-full border border-line px-3.5 font-mono-tight text-xs text-muted transition-colors hover:border-navy hover:text-navy"
      >
        <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M7.5 10.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1 1" />
          <path d="M10.5 7.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1-1" />
        </svg>
        {copied ? 'Copied' : 'Copy Link'}
      </button>
    </div>
  )
}

export default function ArticleDetail() {
  const { slug } = useParams()
  const article = ARTICLES.find((a) => a.slug === slug) || ARTICLES[0]
  const related = ARTICLES.filter((a) => a.slug !== article.slug).slice(0, 3)

  usePageMeta(article.title, article.excerpt)

  return (
    <article>
      {/* Masthead */}
      <header className="border-b border-line bg-wash">
        <div className="mx-auto max-w-3xl px-6 py-16 lg:px-10 lg:py-20">
          <Link
            to="/articles"
            className="underline-grow font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted hover:text-ink"
          >
            ← All Analysis
          </Link>
          <div className="mt-8">
            <span className="rule-gold" aria-hidden="true" />
            <span className="kicker mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-navy">
              {article.category}
              <span aria-hidden="true" className="text-gold">◆</span>
              {article.date}
              <span aria-hidden="true" className="text-gold">◆</span>
              {article.readTime}
            </span>
          </div>
          <h1 className="text-display mt-5 text-[32px] leading-[1.12] text-ink sm:text-4xl lg:text-[44px]">
            {article.title}
          </h1>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy font-mono-tight text-xs font-semibold text-white">
                {FOUNDER.name.split(' ').map((n) => n[0]).join('')}
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-ink">By {FOUNDER.name}</p>
                <p className="mt-0.5 font-mono-tight text-xs text-faint">{FOUNDER.title}</p>
              </div>
            </div>
            <ShareRow article={article} />
          </div>
        </div>
      </header>

      {/* Body — ~68ch measure */}
      <section className="mx-auto max-w-[46rem] px-6 py-14 lg:px-10">
        <p className="text-display text-xl leading-[1.6] text-ink sm:text-[22px]">
          {article.excerpt}
        </p>

        <div className="mt-10 space-y-7">
          <p className="text-[17px] leading-[1.75] text-ink/90 first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:font-display first-letter:text-[56px] first-letter:leading-[0.85] first-letter:text-navy">
            {BODY[0]}
          </p>
          <p className="text-[17px] leading-[1.75] text-ink/90">{BODY[1]}</p>

          <blockquote className="my-10 border-l-[3px] border-gold py-1 pl-6 lg:-ml-10">
            <p className="text-display text-2xl italic leading-[1.4] text-navy sm:text-[26px]">
              “{PULL_QUOTE}”
            </p>
            <cite className="kicker mt-4 block not-italic text-faint">The WCE position</cite>
          </blockquote>

          <p className="text-[17px] leading-[1.75] text-ink/90">{BODY[2]}</p>

          <figure className="my-10">
            <div className="relative overflow-hidden rounded-md border border-line bg-surface p-6">
              <CourtLines className="h-64 w-full text-navy/25" />
            </div>
            <figcaption className="mt-3 flex items-baseline gap-3 font-mono-tight text-xs text-faint">
              <span className="whitespace-nowrap font-semibold text-gold-deep">FIG. 01</span>
              Possession charting happens against the geometry of the floor, not the box score.
            </figcaption>
          </figure>

          <p className="text-[17px] leading-[1.75] text-ink/90">{BODY[3]}</p>
          <p className="text-[17px] leading-[1.75] text-ink/90">{CLOSING}</p>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-line pt-8">
          <Link
            to={`/articles?category=${encodeURIComponent(article.category)}`}
            className="rounded-full border border-line bg-surface px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted transition-colors hover:border-gold hover:text-ink"
          >
            More in {article.category}
          </Link>
          <ShareRow article={article} />
        </div>
      </section>

      {/* Related */}
      <section className="border-t border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
          <span className="rule-gold" aria-hidden="true" />
          <h2 className="text-display mt-4 text-2xl text-ink sm:text-3xl">Keep Reading</h2>
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
    </article>
  )
}
