import { Link } from 'react-router-dom'
import Logo from './Logo.jsx'
import { CATEGORIES, SOCIALS } from '../data/content.js'

export default function Footer() {
  return (
    <footer className="border-t border-line bg-wash">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-faintd">
              NBA analysis and draft scouting under one roof, for people who
              watch the film before they check the box score.
            </p>
            <div className="mt-6 flex gap-3">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-xs text-faintd transition-colors hover:border-navy hover:text-navy"
                >
                  {s.label.slice(0, 1)}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Navigate
            </h4>
            <ul className="mt-4 space-y-3 text-sm">
              <li><Link className="text-faintd hover:text-ink" to="/news">News</Link></li>
              <li><Link className="text-faintd hover:text-ink" to="/podcasts">Podcasts</Link></li>
              <li><Link className="text-faintd hover:text-ink" to="/draft">Draft Hub</Link></li>
              <li><Link className="text-faintd hover:text-ink" to="/rankings">Big Board</Link></li>
              <li><Link className="text-faintd hover:text-ink" to="/articles">Analysis</Link></li>
              <li><Link className="text-faintd hover:text-ink" to="/about">About</Link></li>
              <li><Link className="text-faintd hover:text-ink" to="/contact">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Categories
            </h4>
            <ul className="mt-4 space-y-3 text-sm">
              {CATEGORIES.map((c) => (
                <li key={c}>
                  <Link
                    className="text-faintd hover:text-ink"
                    to={`/articles?category=${encodeURIComponent(c)}`}
                  >
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Western Conference Elitists
            </h4>
            <p className="mt-4 text-sm leading-relaxed text-faintd">
              Independent NBA Draft scouting and analysis. Not affiliated with
              the NBA, NCAA, or any franchise.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-line pt-8 text-xs text-faint sm:flex-row">
          <p>© {new Date().getFullYear()} Western Conference Elitists. All rights reserved.</p>
          <p className="font-mono-tight">Built on film, backed by data.</p>
        </div>
      </div>
    </footer>
  )
}
