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
import FlappyHoops from './pages/FlappyHoops.jsx'
import AnalyticsArchive from './pages/AnalyticsArchive.jsx'
import Newsletter from './pages/Newsletter.jsx'
import Privacy from './pages/Privacy.jsx'
import NotFound from './pages/NotFound.jsx'

// Private admin page: lazy, so no visitor downloads it unless they open /inbox.
const Inbox = lazy(() => import('./pages/Inbox.jsx'))
// Reached only from the link in a newsletter issue: lazy for the same reason.
const NewsletterSports = lazy(() => import('./pages/NewsletterSports.jsx'))

// The change-your-sports link carries the reader's subscriber ID. Analytics gets the page,
// never the ID.
const analyticsBeforeSend = (event) =>
  event.url.includes('/newsletter/sports') ? { ...event, url: event.url.split(/[?#]/)[0] } : event

function App() {
  const { pathname } = useLocation()
  // /gm and /hoops are standalone games, not pages on the site: no site chrome, no page padding,
  // and each owns the whole viewport (the front-office shell scrolls its own panes; Flappy Hoops
  // fills it with its frame).
  const standalone = pathname.startsWith('/gm') || pathname.startsWith('/hoops')
  // (Flappy Hoops is pinned to the screen rather than 100vh tall: on an iPhone, as a home-screen app
  // or in Safari, 100vh can be taller than what's showing, and then a tap in the game slid the whole
  // page up)
  const pinned = pathname.startsWith('/hoops')
  return (
    <div className={pinned ? 'fixed inset-0 flex flex-col overflow-hidden' : standalone ? 'flex h-screen flex-col overflow-hidden' : 'flex min-h-screen flex-col bg-paper'}>
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
          <Route path="/hoops" element={<FlappyHoops />} />
          <Route path="/news" element={<News />} />
          <Route path="/podcasts" element={<Navigate to="/" replace />} /> {/* hidden for now */}
          <Route path="/about" element={<About />} />
          <Route path="/draft" element={<Draft />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/articles/:slug" element={<ArticleDetail />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/newsletter" element={<Newsletter />} />
          <Route path="/newsletter/sports" element={<Suspense fallback={null}><NewsletterSports /></Suspense>} /> {/* unlisted: linked from every issue */}
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/comp-chain" element={<CompChain />} />
          <Route path="/dynasty" element={<Dynasty />} />
          <Route path="/analytics" element={<AnalyticsArchive />} />
          <Route path="/inbox" element={<Suspense fallback={null}><Inbox /></Suspense>} /> {/* private: contact messages + list health */}
          <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </main>
      {!standalone && <Footer />}
      <Analytics beforeSend={analyticsBeforeSend} />
    </div>
  )
}

export default App
