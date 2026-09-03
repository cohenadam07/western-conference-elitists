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
