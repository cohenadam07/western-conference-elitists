import { useEffect, useRef } from 'react'

// Flappy Hoops v2: its own app (Phaser, fourteen cities), built into public/flappy-hoops/ from
// prototypes/flappy-hoops-v2 (`npx vite build --base /flappy-hoops/ --outDir dist-site`).
// This page is just a frame around it that fills the viewport; the game's title links back
// to the site (?site=1). The frame allows full screen: the game has its own button for it.

// Home-screen app: while you're here the page carries the game's own icon, name and manifest, so
// Add to Home Screen (iPhone) or Install (Android, desktop Chrome) opens Flappy Hoops like its own
// app, with no browser bars. The same tags are in the prebuilt /hoops HTML (scripts/lib/seo-build.mjs,
// HOOPS_APP); this covers arriving here from another page of the site.
const APP_HEAD = [
  ['link[rel="apple-touch-icon"]', 'link', { rel: 'apple-touch-icon', sizes: '180x180' }, 'href', '/flappy-hoops/app/icon-180.png'],
  ['link[rel="manifest"]', 'link', { rel: 'manifest' }, 'href', '/flappy-hoops/app/manifest.webmanifest'],
  ['meta[name="apple-mobile-web-app-title"]', 'meta', { name: 'apple-mobile-web-app-title' }, 'content', 'Flappy Hoops'],
  ['meta[name="apple-mobile-web-app-capable"]', 'meta', { name: 'apple-mobile-web-app-capable' }, 'content', 'yes'],
  ['meta[name="mobile-web-app-capable"]', 'meta', { name: 'mobile-web-app-capable' }, 'content', 'yes'],
  // edge to edge: the game fills the whole screen, under the notch and a see-through status bar, and
  // keeps its own buttons clear of them (it reads this page's safe areas)
  ['meta[name="apple-mobile-web-app-status-bar-style"]', 'meta', { name: 'apple-mobile-web-app-status-bar-style' }, 'content', 'black-translucent'],
  ['meta[name="viewport"]', 'meta', { name: 'viewport' }, 'content', 'width=device-width, initial-scale=1.0, viewport-fit=cover'],
]

export default function FlappyHoops() {
  const frame = useRef(null)
  useEffect(() => {
    const before = document.title
    document.title = 'Flappy Hoops | Western Conference Elitists'
    const undo = APP_HEAD.map(([sel, tag, attrs, key, value]) => {
      let el = document.head.querySelector(sel)
      if (el) {
        const prev = el.getAttribute(key)
        el.setAttribute(key, value)
        return () => el.setAttribute(key, prev)
      }
      el = document.createElement(tag)
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
      el.setAttribute(key, value)
      document.head.appendChild(el)
      return () => el.remove()
    })
    // the game's own dark ground behind the frame (no flash of the site's paper while it loads)
    const grounds = [document.documentElement, document.body].map((el) => [el, el.style.backgroundColor])
    grounds.forEach(([el]) => { el.style.backgroundColor = '#1a2740' })
    return () => {
      document.title = before
      grounds.forEach(([el, prev]) => { el.style.backgroundColor = prev })
      undo.reverse().forEach((f) => f())
    }
  }, [])
  return (
    <iframe
      ref={frame}
      title="Flappy Hoops"
      src="/flappy-hoops/index.html?site=1"
      className="block h-full w-full border-0"
      allow="autoplay; fullscreen"
      allowFullScreen
      onLoad={() => frame.current?.focus()}
    />
  )
}
