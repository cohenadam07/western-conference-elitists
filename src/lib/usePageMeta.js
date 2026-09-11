import { useEffect } from 'react'

const SITE = 'Western Conference Elitists'
const DEFAULT_TITLE = `${SITE} | NBA Analysis & Scouting`
const DEFAULT_DESC =
  'Western Conference Elitists — NBA analysis, team building, trade coverage, and draft scouting built for people who actually watch the film.'

/**
 * Keeps document.title, the meta description, the OG/Twitter title tags and the
 * canonical link in sync with the active route. (Crawlers and link-preview bots that
 * don't run JavaScript get the same tags from the HTML scripts/lib/seo-build.mjs writes.)
 */
export default function usePageMeta(title, description) {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE}` : DEFAULT_TITLE
    document.title = fullTitle

    const set = (selector, content) => {
      const el = document.querySelector(selector)
      if (el) el.setAttribute('content', content)
    }
    set('meta[name="description"]', description || DEFAULT_DESC)
    set('meta[property="og:title"]', fullTitle)
    set('meta[name="twitter:title"]', fullTitle)
    set('meta[property="og:description"]', description || DEFAULT_DESC)
    set('meta[name="twitter:description"]', description || DEFAULT_DESC)

    // Canonical URL: this page, without query string or hash.
    let canonical = document.querySelector('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = `https://wcehoops.com${window.location.pathname}`
    set('meta[property="og:url"]', canonical.href)
  }, [title, description])
}
