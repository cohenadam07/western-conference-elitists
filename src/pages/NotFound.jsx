import Button from '../components/Button.jsx'
import CourtLines from '../components/CourtLines.jsx'
import usePageMeta from '../lib/usePageMeta.js'

export default function NotFound() {
  usePageMeta('Page Not Found')
  return (
    <div className="relative overflow-hidden">
      <CourtLines className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-auto -translate-x-1/2 -translate-y-1/2 text-navy/[0.06]" accent="rgba(194,162,99,0.18)" />
      <div className="relative mx-auto flex max-w-7xl flex-col items-center px-6 py-32 text-center lg:px-10">
        <span className="kicker text-gold-deep">Turnover</span>
        <span className="text-display mt-3 text-[96px] leading-none text-navy">404</span>
        <h1 className="text-display mt-4 text-3xl text-ink">
          This prospect didn't make the board.
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
          Whatever you were looking for isn't here. Head back to the board and
          try again.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Button to="/">Back Home</Button>
          <Button to="/rankings" variant="secondary">
            View the Big Board
          </Button>
        </div>
      </div>
    </div>
  )
}
