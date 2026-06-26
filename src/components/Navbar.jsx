import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import Logo from './Logo.jsx'
import Button from './Button.jsx'

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/news', label: 'News' },
  { to: '/draft', label: 'Draft' },
  { to: '/rankings', label: 'Big Board' },
  { to: '/articles', label: 'Analysis' },
  { to: '/about', label: 'About' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [])

  return (
    <header
      className={`sticky top-0 z-40 w-full transition-all duration-300 ${
        scrolled
          ? 'border-b border-line bg-ink/95 shadow-sm backdrop-blur-md'
          : 'border-b border-transparent bg-ink'
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
        <Logo />

        <div className="hidden items-center gap-8 lg:flex">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `underline-grow text-sm font-medium uppercase tracking-wide transition-colors ${
                  isActive ? 'text-bone' : 'text-bone-dim hover:text-bone'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="hidden lg:block">
          <Button to="/contact" variant="primary" className="px-5 py-2.5">
            Subscribe
          </Button>
        </div>

        <button
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-sm border border-line text-bone lg:hidden"
        >
          <div className="flex flex-col gap-1.5">
            <span
              className={`block h-[1.5px] w-5 bg-bone transition-transform duration-300 ${
                open ? 'translate-y-[3px] rotate-45' : ''
              }`}
            />
            <span
              className={`block h-[1.5px] w-5 bg-bone transition-transform duration-300 ${
                open ? '-translate-y-[3px] -rotate-45' : ''
              }`}
            />
          </div>
        </button>
      </nav>

      <div
        className={`overflow-hidden border-b border-line bg-ink lg:hidden transition-[max-height] duration-300 ease-in-out ${
          open ? 'max-h-96' : 'max-h-0'
        }`}
      >
        <div className="flex flex-col gap-1 px-6 py-4">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `rounded-sm px-3 py-3 text-sm font-medium uppercase tracking-wide ${
                  isActive ? 'bg-surface-2 text-bone' : 'text-bone-dim'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
          <Button to="/contact" variant="primary" className="mt-2" onClick={() => setOpen(false)}>
            Subscribe
          </Button>
        </div>
      </div>
    </header>
  )
}
