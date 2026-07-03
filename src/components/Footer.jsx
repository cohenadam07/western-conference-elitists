import { Link } from 'react-router-dom'
import Logo from './Logo.jsx'
import { CATEGORIES, SOCIALS } from '../data/content.js'

const SOCIAL_ICONS = {
  'X / Twitter': (
    <path d="M13.3 2H16l-5.9 6.75L17 18h-5.44l-4.26-5.57L2.42 18H-.27l6.32-7.22L-.7 2h5.58l3.85 5.09L13.3 2zm-.95 14.4h1.5L4.05 3.52H2.44L12.35 16.4z" />
  ),
  Instagram: (
    <path d="M9 3.24c1.88 0 2.1.01 2.84.04.69.03 1.06.15 1.31.24.33.13.56.28.81.53.25.25.4.48.53.81.1.25.21.62.24 1.3.03.75.04.97.04 2.84s-.01 2.1-.04 2.84c-.03.69-.15 1.06-.24 1.31-.13.33-.28.56-.53.81-.25.25-.48.4-.81.53-.25.1-.62.21-1.3.24-.75.03-.97.04-2.85.04s-2.1-.01-2.84-.04c-.69-.03-1.06-.15-1.31-.24a2.2 2.2 0 0 1-.81-.53 2.2 2.2 0 0 1-.53-.81c-.1-.25-.21-.62-.24-1.3-.03-.75-.04-.97-.04-2.85s.01-2.1.04-2.84c.03-.69.15-1.06.24-1.31.13-.33.28-.56.53-.81.25-.25.48-.4.81-.53.25-.1.62-.21 1.3-.24.75-.03.97-.04 2.85-.04M9 2c-1.9 0-2.14.01-2.89.04-.75.04-1.26.16-1.7.33-.46.18-.85.42-1.24.81-.39.39-.63.78-.81 1.24-.17.44-.29.95-.33 1.7C2 6.86 2 7.1 2 9s.01 2.14.04 2.89c.04.75.16 1.26.33 1.7.18.46.42.85.81 1.24.39.39.78.63 1.24.81.44.17.95.29 1.7.33.75.03.99.04 2.89.04s2.14-.01 2.89-.04c.75-.04 1.26-.16 1.7-.33.46-.18.85-.42 1.24-.81.39-.39.63-.78.81-1.24.17-.44.29-.95.33-1.7.03-.75.04-.99.04-2.89s-.01-2.14-.04-2.89c-.04-.75-.16-1.26-.33-1.7a3.4 3.4 0 0 0-.81-1.24 3.4 3.4 0 0 0-1.24-.81c-.44-.17-.95-.29-1.7-.33C11.14 2 10.9 2 9 2zm0 3.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zm0 5.93a2.33 2.33 0 1 1 0-4.66 2.33 2.33 0 0 1 0 4.66zm4.58-6.07a.84.84 0 1 1-1.68 0 .84.84 0 0 1 1.68 0z" />
  ),
  YouTube: (
    <path d="M17.63 5.36a2.25 2.25 0 0 0-1.59-1.59C14.64 3.4 9 3.4 9 3.4s-5.64 0-7.04.37A2.25 2.25 0 0 0 .37 5.36 23.4 23.4 0 0 0 0 9.66c0 1.45.13 2.89.37 4.3.21.78.82 1.38 1.59 1.59 1.4.38 7.04.38 7.04.38s5.64 0 7.04-.38a2.25 2.25 0 0 0 1.59-1.58c.25-1.42.37-2.86.37-4.31 0-1.44-.12-2.88-.37-4.3zM7.2 12.3V7.02l4.68 2.64L7.2 12.3z" />
  ),
  TikTok: (
    <path d="M13.23 4.24A4.24 4.24 0 0 1 12.2 1.5h-2.9v11.4a2.4 2.4 0 1 1-2.4-2.5c.25 0 .49.04.72.11v-2.96a5.34 5.34 0 0 0-.72-.05 5.36 5.36 0 1 0 5.36 5.4V7.44a7.06 7.06 0 0 0 4.14 1.33V5.83a4.22 4.22 0 0 1-3.17-1.59z" />
  ),
}

export default function Footer() {
  return (
    <footer className="bg-navy-deep text-white">
      <div className="h-[3px] w-full bg-gold" aria-hidden="true" />
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo light />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/65">
              NBA analysis and draft scouting under one roof, for people who
              watch the film before they check the box score.
            </p>
            <div className="mt-6 flex gap-3">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/70 transition-colors hover:border-gold hover:text-gold"
                >
                  <svg width="15" height="15" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
                    {SOCIAL_ICONS[s.label]}
                  </svg>
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="kicker text-white/45">Navigate</h4>
            <ul className="mt-5 space-y-3 text-sm">
              <li><Link className="text-white/70 transition-colors hover:text-gold" to="/news">News</Link></li>
              <li><Link className="text-white/70 transition-colors hover:text-gold" to="/podcasts">Podcasts</Link></li>
              <li><Link className="text-white/70 transition-colors hover:text-gold" to="/draft">Draft Hub</Link></li>
              <li><Link className="text-white/70 transition-colors hover:text-gold" to="/rankings">Big Board</Link></li>
              <li><Link className="text-white/70 transition-colors hover:text-gold" to="/articles">Analysis</Link></li>
              <li><Link className="text-white/70 transition-colors hover:text-gold" to="/about">About</Link></li>
              <li><Link className="text-white/70 transition-colors hover:text-gold" to="/contact">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="kicker text-white/45">Categories</h4>
            <ul className="mt-5 space-y-3 text-sm">
              {CATEGORIES.map((c) => (
                <li key={c}>
                  <Link
                    className="text-white/70 transition-colors hover:text-gold"
                    to={`/articles?category=${encodeURIComponent(c)}`}
                  >
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="kicker text-white/45">The Data Tool</h4>
            <p className="mt-5 text-sm leading-relaxed text-white/65">
              Basketball Savant — percentile sliders, player comparisons, and
              on/off data for every NBA player.
            </p>
            <a
              href="/basketball-savant.html"
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-gold transition-colors hover:text-white"
            >
              Open Basketball Savant
              <span aria-hidden="true">↗</span>
            </a>
            <p className="mt-6 text-xs leading-relaxed text-white/45">
              Independent NBA scouting and analysis. Not affiliated with the
              NBA, NCAA, or any franchise.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-xs text-white/45 sm:flex-row">
          <p>© {new Date().getFullYear()} Western Conference Elitists. All rights reserved.</p>
          <p className="font-mono-tight text-gold/80">Built on film, backed by data.</p>
        </div>
      </div>
    </footer>
  )
}
