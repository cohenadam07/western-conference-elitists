import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import ScrollToTop from './components/ScrollToTop.jsx'
import Home from './pages/Home.jsx'
import News from './pages/News.jsx'
// import Podcasts from './pages/Podcasts.jsx'  // hidden for now
import About from './pages/About.jsx'
import Draft from './pages/Draft.jsx'
import Rankings from './pages/Rankings.jsx'
import Articles from './pages/Articles.jsx'
import ArticleDetail from './pages/ArticleDetail.jsx'
import Contact from './pages/Contact.jsx'
import CompChain from './pages/CompChain.jsx'
import Dynasty from './pages/Dynasty.jsx'
import Hoops from './pages/Hoops.jsx'
import AnalyticsArchive from './pages/AnalyticsArchive.jsx'
import NotFound from './pages/NotFound.jsx'

// LAZY, AND ONLY LAZY.
//
// Front Office is the whole GM game — a league, a season simulation, a trade engine and
// a draft — and it weighs more than the rest of the site put together. Imported the way
// every other page here is imported, every visitor who lands on the front page pays for
// it before they see a headline. Behind React.lazy it is a separate chunk that is only
// fetched when somebody actually opens /gm.
const GM = lazy(() => import('./pages/GM.jsx'))

function App() {
  const { pathname } = useLocation()
  // /gm is a standalone game, not a page on the site: no site chrome, no page padding, and
  // it owns the whole viewport so the front-office shell can scroll its own panes.
  const standalone = pathname.startsWith('/gm')
  return (
    <div className={standalone ? 'flex h-screen flex-col overflow-hidden' : 'flex min-h-screen flex-col bg-paper'}>
      <a
        href="#main"
        className="sr-only z-50 rounded-sm bg-navy px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <ScrollToTop />
      {!standalone && <Navbar />}
      <main id="main" className={standalone ? 'flex-1 min-h-0' : 'flex-1'}>
        {/* Keyed by path so page content fades in on route change */}
        <div key={pathname} className={standalone ? 'h-full' : 'route-fade'}>
          <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/hoops" element={<Hoops />} />
          <Route path="/news" element={<News />} />
          <Route path="/podcasts" element={<Navigate to="/" replace />} /> {/* hidden for now */}
          <Route path="/about" element={<About />} />
          <Route path="/draft" element={<Draft />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/articles/:slug" element={<ArticleDetail />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/comp-chain" element={<CompChain />} />
          <Route path="/dynasty" element={<Dynasty />} />
          <Route path="/analytics" element={<AnalyticsArchive />} />
          {/* Unlisted on purpose: no navbar or footer link. Reachable, and shareable by
              anyone who has the address, without announcing itself on the front page.
              The fallback is styled inline rather than by class: gm.css travels inside
              the lazy chunk, so any stylesheet rule for this would arrive with the very
              thing it is covering for. */}
          <Route
            path="/gm"
            element={(
              <Suspense fallback={(
                <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center',
                  background: '#08090D', color: '#8b94a6', letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  font: '600 11px/1 "IBM Plex Mono",ui-monospace,monospace' }}>
                  Loading the front office…
                </div>
              )}>
                <GM />
              </Suspense>
            )}
          />
          <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </main>
      {!standalone && <Footer />}
      <Analytics />
    </div>
  )
}

export default App
