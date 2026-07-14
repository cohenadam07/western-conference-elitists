import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import Logo from './Logo.jsx'
import Button from './Button.jsx'

const LINKS = [
  { to: '/news', label: 'News' },
  { to: '/podcasts', label: 'Podcasts' },
  { to: '/draft', label: 'Draft' },
  { to: '/rankings', label: 'Big Board' },
  { to: '/articles', label: 'Analysis' },
  { to: '/comp-chain', label: 'Comp Chain' },
  { to: '/about', label: 'About' },
]

const SAVANT = { href: '/basketball-savant.html', label: 'Basketball Savant' }

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the mobile menu whenever the route changes
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <header
      className={`sticky top-0 z-40 w-full transition-[background-color,border-color,box-shadow] duration-300 ${
        scrolled || open
          ? 'border-b border-line bg-paper/85 shadow-[0_1px_0_rgba(25,27,31,0.02)] backdrop-blur-md'
          : 'border-b border-transparent bg-paper'
      }`}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10"
      >
        <Logo />

        <div className="hidden items-center gap-7 lg:flex">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `relative py-1 font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] transition-colors ${
                  isActive ? 'text-ink' : 'underline-grow text-muted hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {link.label}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 -bottom-[3px] h-[3px] bg-gold"
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
          <a
            href={SAVANT.href}
            className="group flex items-center gap-2 rounded-full border border-navy/25 px-3.5 py-1.5 font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-navy transition-colors hover:border-gold hover:bg-surface"
          >
            {SAVANT.label}
            <svg
              width="9"
              height="9"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden="true"
              className="text-gold-deep transition-transform duration-300 group-hover:translate-x-[1.5px] group-hover:-translate-y-[1.5px]"
            >
              <path d="M1.5 8.5L8.5 1.5M8.5 1.5H3M8.5 1.5V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>

        <div className="hidden lg:block">
          <Button to="/contact" variant="primary" className="px-5 py-2.5">
            Subscribe
          </Button>
        </div>

        <button
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-[9px] border border-line bg-surface text-ink transition-colors hover:border-faint lg:hidden"
        >
          <div className="flex flex-col gap-1.5">
            <span
              className={`block h-[1.5px] w-5 bg-ink transition-transform duration-300 ${
                open ? 'translate-y-[3.5px] rotate-45' : ''
              }`}
            />
            <span
              className={`block h-[1.5px] w-5 bg-ink transition-transform duration-300 ${
                open ? '-translate-y-[3.5px] -rotate-45' : ''
              }`}
            />
          </div>
        </button>
      </nav>

      <div
        id="mobile-menu"
        className={`grid overflow-hidden bg-paper/95 backdrop-blur-md transition-[grid-template-rows] duration-300 ease-out lg:hidden ${
          open ? 'grid-rows-[1fr] border-b border-line' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col px-6 pb-6 pt-2">
            {[{ to: '/', label: 'Home' }, ...LINKS].map((link, i) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                style={{ transitionDelay: open ? `${60 + i * 35}ms` : '0ms' }}
                className={({ isActive }) =>
                  `border-b border-line-soft py-3.5 font-mono text-[13px] font-medium uppercase tracking-[0.14em] transition-[opacity,transform,color] duration-300 ${
                    open ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                  } ${isActive ? 'text-ink' : 'text-muted'}`
                }
              >
                {({ isActive }) => (
                  <span className="flex items-center gap-3">
                    {isActive && <span aria-hidden="true" className="h-[3px] w-6 bg-gold" />}
                    {link.label}
                  </span>
                )}
              </NavLink>
            ))}
            <a
              href={SAVANT.href}
              style={{ transitionDelay: open ? `${60 + (LINKS.length + 1) * 35}ms` : '0ms' }}
              className={`flex items-center justify-between border-b border-line-soft py-3.5 font-mono text-[13px] font-medium uppercase tracking-[0.14em] text-navy transition-[opacity,transform] duration-300 ${
                open ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
              }`}
            >
              {SAVANT.label}
              <span aria-hidden="true" className="text-gold-deep">↗</span>
            </a>
            <div
              style={{ transitionDelay: open ? `${60 + (LINKS.length + 2) * 35}ms` : '0ms' }}
              className={`pt-5 transition-[opacity,transform] duration-300 ${
                open ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
              }`}
            >
              <Button to="/contact" variant="primary" className="w-full">
                Subscribe
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
