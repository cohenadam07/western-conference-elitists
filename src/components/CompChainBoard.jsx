import Button from './Button.jsx'
import Reveal from './Reveal.jsx'
import SectionHeading from './SectionHeading.jsx'
import { useLeaderboard, dayLabel } from '../lib/useLeaderboard.js'

// Homepage section — today's Comp Chain daily leaderboard (light editorial theme
// to match the site). Hidden entirely until the leaderboard store is connected.
export default function CompChainBoard() {
  const board = useLeaderboard(true)
  if (board.status === 'unconfigured') return null

  return (
    <section className="border-y border-line bg-wash">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
        <Reveal>
          <SectionHeading
            eyebrow="Play · New Daily Puzzle"
            title="Comp Chain Leaderboard"
            subtitle="Hop from one NBA player to a target through their statistical comps, in as few moves as you can. One puzzle a day — same for everyone."
          />
        </Reveal>

        <Reveal delay={100}>
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-stretch">
            <div className="relative flex flex-col justify-center overflow-hidden rounded-md border border-line bg-surface p-6 lg:p-8">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gold" aria-hidden="true" />
              <span className="kicker text-faint">Built on Basketball Savant</span>
              <h3 className="text-display mt-3 text-2xl text-ink">Today&rsquo;s puzzle is live</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">
                Chain the start player to the target, then post your score. Fewest moves wins; hints cost you.
              </p>
              <div className="mt-6">
                <Button to="/comp-chain">
                  Play today&rsquo;s puzzle
                  <span aria-hidden="true">↗</span>
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-line bg-surface p-6 lg:p-8">
              <div className="flex items-center justify-between border-b border-line-soft pb-3">
                <span className="kicker text-faint">Today&rsquo;s Top</span>
                <span className="font-mono-tight text-xs text-gold-deep">
                  {dayLabel()}{board.count ? ` · ${board.count} player${board.count === 1 ? '' : 's'}` : ''}
                </span>
              </div>
              <div className="mt-2">
                {board.status === 'loading' && !board.entries.length && <div className="py-8 text-center font-mono text-xs text-faint">Loading today&rsquo;s standings…</div>}
                {board.status === 'error' && <div className="py-8 text-center font-mono text-xs text-red">Leaderboard unavailable right now.</div>}
                {board.entries.length > 0 && (
                  <ol className="divide-y divide-line-soft">
                    {board.entries.slice(0, 8).map((e, i) => (
                      <li key={i} className="flex items-center gap-3 py-2.5 font-mono text-sm">
                        <span className={`w-5 shrink-0 text-right ${i < 3 ? 'font-semibold text-gold-deep' : 'text-faint'}`}>{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-ink">{e.name}</span>
                        <span className="shrink-0 font-medium tabular-nums text-navy">{e.moves}<span className="text-faint"> mv</span></span>
                        <span className="w-16 shrink-0 text-right tabular-nums text-faint">{e.hints ? `${e.hints} hint${e.hints === 1 ? '' : 's'}` : 'clean'}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {board.status === 'ready' && !board.entries.length && (
                  <div className="py-8 text-center">
                    <p className="font-mono text-xs text-faint">No scores yet today.</p>
                    <div className="mt-4"><Button to="/comp-chain" variant="secondary">Be the first →</Button></div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
