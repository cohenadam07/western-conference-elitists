import { Link } from 'react-router-dom'

export default function ArticleCard({ article, featured = false }) {
  if (featured) {
    return (
      <Link
        to={`/articles/${article.slug}`}
        className="card-hover group relative flex flex-col overflow-hidden rounded-md border border-line bg-surface p-8 lg:p-12"
      >
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gold" aria-hidden="true" />
        <span className="kicker text-gold-deep">
          {article.category} · Featured
        </span>
        <h3 className="text-display mt-4 max-w-3xl text-3xl leading-[1.12] text-ink transition-colors duration-300 group-hover:text-navy sm:text-4xl">
          {article.title}
        </h3>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
          {article.excerpt}
        </p>
        <div className="mt-6 flex items-center gap-3 font-mono-tight text-xs text-faint">
          <span>{article.date}</span>
          <span aria-hidden="true">·</span>
          <span>{article.readTime}</span>
          <span
            aria-hidden="true"
            className="ml-2 inline-block transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none"
          >
            →
          </span>
        </div>
      </Link>
    )
  }

  return (
    <Link
      to={`/articles/${article.slug}`}
      className="card-hover group flex flex-col rounded-md border border-line bg-surface p-6"
    >
      <span className="kicker text-gold-deep">{article.category}</span>
      <h3 className="text-display mt-3 text-[21px] leading-snug text-ink transition-colors duration-300 group-hover:text-navy">
        {article.title}
      </h3>
      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted">
        {article.excerpt}
      </p>
      <div className="mt-auto flex items-center gap-3 pt-5 font-mono-tight text-xs text-faint">
        <span>{article.date}</span>
        <span aria-hidden="true">·</span>
        <span>{article.readTime}</span>
      </div>
    </Link>
  )
}
