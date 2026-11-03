import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// The site ribbon is one shared element, <wce-nav>, defined in public/wce-nav.js and loaded by
// index.html. The menu itself lives in that file, so the React pages and the standalone Savant
// pages can't drift apart: edit the list there, not here.
//
// This wrapper does two things: tells the ribbon which page is open (so it can underline it),
// and hands clicks on React routes to the router so they switch without a full reload. Links to
// the standalone pages (the Savants, /player) are ordinary links and load normally.
export default function Navbar() {
  const ref = useRef(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const go = (e) => {
      e.preventDefault()
      navigate(e.detail.href)
    }
    el.addEventListener('wce-navigate', go)
    return () => el.removeEventListener('wce-navigate', go)
  }, [navigate])

  // min-height holds the ribbon's 60px until the script has drawn it, so nothing jumps.
  return <wce-nav ref={ref} current={pathname} style={{ display: 'block', minHeight: 60 }} />
}
