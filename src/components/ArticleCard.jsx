import { Link } from 'react-router-dom'

export default function ArticleCard({ article, featured = false }) {
  if (featured) {
    return (
      <Link
        to={`/articles/${article.slug}`}
        className="card-hover group relative flex flex-col overflow-hidden rounded-md border border-line bg-surface-2 p-8 lg:p-10"
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-ember via-foul to-court" />
        <div className="absolute inset-0 bg-gradient-to-br from-ember/10 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        <span className="relative w-fit rounded-full bg-ember px-3 py-1 font-mono-tight text-xs font-semibold uppercase tracking-widest text-ink">
          {article.category} · Featured
        </span>
        <h3 className="relative mt-4 max-w-3xl text-display text-3xl leading-tight text-bone sm:text-4xl">
          {article.title}
        </h3>
        <p className="relative mt-4 max-w-2xl text-base leading-relaxed text-bone-dim">
          {article.excerpt}
        </p>
        <div className="relative mt-6 flex items-center gap-3 text-xs text-mute">
          <span>{article.date}</span>
          <span>·</span>
          <span>{article.readTime}</span>
        </div>
      </Link>
    )
  }

  return (
    <Link
      to={`/articles/${article.slug}`}
      className="card-hover group flex flex-col rounded-md border border-line bg-surface-2 p-6"
    >
      <span className="font-mono-tight text-xs font-semibold uppercase tracking-widest text-ember">
        {article.category}
      </span>
      <h3 className="mt-3 text-lg font-bold leading-snug text-bone transition-colors group-hover:text-court">
        {article.title}
      </h3>
      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-bone-dim">
        {article.excerpt}
      </p>
      <div className="mt-5 flex items-center gap-3 text-xs text-mute">
        <span>{article.date}</span>
        <span>·</span>
        <span>{article.readTime}</span>
      </div>
    </Link>
  )
}
