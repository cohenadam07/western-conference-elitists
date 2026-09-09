import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import Logo from './Logo.jsx'
import Button from './Button.jsx'

// The ribbon reads left to right the way the site is organised: the Savants first
// (basketball, draft, football with coaching tucked under it, UFC), then the reading
// and rankings, then the games under one word, then About. An item with `children`
// is a hover dropdown on desktop and an indented run of links on mobile.
const LINKS = [
  { href: '/basketball-savant.html', label: 'Basketball Savant', external: true },
  {
    href: '/draft-savant.html', label: 'Draft Savant', external: true,
    children: [{ to: '/rankings', label: 'Big Board' }],
  },
  {
    href: '/football-savant.html', label: 'Football Savant', external: true,
    children: [{ href: '/coaching-savant.html', label: 'Coaching Savant', external: true }],
  },
  { href: '/ufc-savant.html', label: 'UFC Savant', external: true },
  { to: '/articles', label: 'Analysis' },
  { to: '/news', label: 'News' },
  // { to: '/podcasts', label: 'Podcasts' },  // hidden for now
  { to: '/comp-chain', label: 'Comp Chain' },
  { to: '/dynasty', label: 'Dynasty' },
  {
    label: 'Games',
    children: [
      { to: '/hoops', label: 'Hoops' },
      { to: '/gm', label: 'Front Office' },
    ],
  },
  { to: '/about', label: 'About' },
]

const linkClass =
  'relative whitespace-nowrap py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] transition-colors'

function Caret() {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="ml-1.5 inline-block text-faint transition-transform duration-200 group-hover:rotate-180">
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DesktopLink({ link }) {
  if (link.external) {
    return (
      <a href={link.href} className={`${linkClass} underline-grow text-muted hover:text-ink`}>
        {link.label}
        {link.children && <Caret />}
      </a>
    )
  }
  if (!link.to) {
    // a pure group header (Games): no destination of its own
    return (
      <span className={`${linkClass} cursor-default text-muted group-hover:text-ink`}>
        {link.label}
        {link.children && <Caret />}
      </span>
    )
  }
  return (
    <NavLink
      to={link.to}
      className={({ isActive }) =>
        `${linkClass} ${isActive ? 'text-ink' : 'underline-grow text-muted hover:text-ink'}`
      }
    >
      {({ isActive }) => (
        <>
          {link.label}
          {link.children && <Caret />}
          {isActive && (
            <span aria-hidden="true" className="absolute inset-x-0 -bottom-[3px] h-[3px] bg-gold" />
          )}
        </>
      )}
    </NavLink>
  )
}

function DesktopItem({ link, activeGroup }) {
  if (!link.children) return <DesktopLink link={link} />
  return (
    <div className="group relative">
      <span className={activeGroup ? 'text-ink' : ''}>
        <DesktopLink link={link} />
      </span>
      {activeGroup && !link.to && (
        <span aria-hidden="true" className="absolute inset-x-0 -bottom-[3px] h-[3px] bg-gold" />
      )}
      {/* The dropdown, in the site's own dropdown dress (the Big Board year picker):
          a bordered surface panel, rows divided by hairlines, bold row labels. */}
      <div className="invisible absolute left-0 top-full z-50 origin-top-left pt-2 opacity-0 transition-[opacity,transform,visibility] duration-150 scale-95 group-hover:visible group-hover:scale-100 group-hover:opacity-100 group-focus-within:visible group-focus-within:scale-100 group-focus-within:opacity-100">
        <div className="w-56 overflow-hidden rounded-md border border-line bg-surface shadow-xl">
          {link.children.map((c) => {
            const row = 'flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left text-sm font-bold text-ink transition-colors last:border-b-0 hover:bg-paper'
            return c.external ? (
              <a key={c.href} href={c.href} className={row}>
                {c.label}
                <span aria-hidden="true" className="text-gold-deep">↗</span>
              </a>
            ) : (
              <NavLink key={c.to} to={c.to} className={({ isActive }) => `${row} ${isActive ? 'bg-paper' : ''}`}>
                {c.label}
              </NavLink>
            )
          })}
        </div>
      </div>
    </div>
  )
}

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

  // Flat list for the mobile menu: a group's children are indented under it.
  const mobile = [{ to: '/', label: 'Home' }]
  LINKS.forEach((l) => {
    mobile.push(l.to || l.href ? l : { ...l, header: true })
    ;(l.children || []).forEach((c) => mobile.push({ ...c, child: true }))
  })

  const mobileClass = (i, extra) =>
    `border-b border-line-soft py-3.5 font-mono text-[13px] font-medium uppercase tracking-[0.14em] transition-[opacity,transform,color] duration-300 ${
      open ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
    } ${extra}`

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
        className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4 lg:px-10"
      >
        {/* shrink-0: without it the wordmark gets squeezed and the first link lands on top of it */}
        <div className="shrink-0">
          <Logo />
        </div>

        <div className="hidden items-center gap-[12px] min-[1440px]:flex">
          {LINKS.map((link) => (
            <DesktopItem
              key={link.label}
              link={link}
              activeGroup={!!(link.children || []).find((c) => c.to && pathname.startsWith(c.to))}
            />
          ))}
        </div>

        <div className="hidden min-[1440px]:block">
          <Button to="/contact" variant="primary" className="px-5 py-2.5">
            Subscribe
          </Button>
        </div>

        <button
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-[9px] border border-line bg-surface text-ink transition-colors hover:border-faint min-[1440px]:hidden"
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
        className={`grid overflow-hidden bg-paper/95 backdrop-blur-md transition-[grid-template-rows] duration-300 ease-out min-[1440px]:hidden ${
          open ? 'grid-rows-[1fr] border-b border-line' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col px-6 pb-6 pt-2">
            {mobile.map((link, i) => {
              const delay = { transitionDelay: open ? `${60 + i * 35}ms` : '0ms' }
              const indent = link.child ? 'pl-6 text-[12px]' : ''
              if (link.header) {
                return (
                  <span key={link.label} style={delay} className={mobileClass(i, 'text-faint')}>
                    {link.label}
                  </span>
                )
              }
              if (link.external) {
                return (
                  <a key={link.href} href={link.href} style={delay} className={mobileClass(i, `text-muted ${indent}`)}>
                    <span className="flex items-center gap-3">{link.label}</span>
                  </a>
                )
              }
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  style={delay}
                  className={({ isActive }) => mobileClass(i, `${isActive ? 'text-ink' : 'text-muted'} ${indent}`)}
                >
                  {({ isActive }) => (
                    <span className="flex items-center gap-3">
                      {isActive && <span aria-hidden="true" className="h-[3px] w-6 bg-gold" />}
                      {link.label}
                    </span>
                  )}
                </NavLink>
              )
            })}
            <div
              style={{ transitionDelay: open ? `${60 + (mobile.length + 1) * 35}ms` : '0ms' }}
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
