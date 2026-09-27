import { useEffect, useRef } from 'react'

// Flappy Hoops v2: its own app (Phaser, eleven cities), built into public/flappy-hoops/ from
// prototypes/flappy-hoops-v2 (`npx vite build --base /flappy-hoops/ --outDir dist-site`).
// This page is just a frame around it that fills the viewport; the game's title links back
// to the site (?site=1).
export default function FlappyHoops() {
  const frame = useRef(null)
  useEffect(() => {
    const before = document.title
    document.title = 'Flappy Hoops | Western Conference Elitists'
    return () => { document.title = before }
  }, [])
  return (
    <iframe
      ref={frame}
      title="Flappy Hoops"
      src="/flappy-hoops/index.html?site=1"
      className="block h-full w-full border-0"
      allow="autoplay; fullscreen"
      onLoad={() => frame.current?.focus()}
    />
  )
}
