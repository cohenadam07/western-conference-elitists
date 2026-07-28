import { Link } from 'react-router-dom'
import Button from '../components/Button.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import ArticleCard from '../components/ArticleCard.jsx'
import ProspectCard from '../components/ProspectCard.jsx'
import NewsletterCTA from '../components/NewsletterCTA.jsx'
import CourtLines from '../components/CourtLines.jsx'
import CompChainBoard from '../components/CompChainBoard.jsx'
import Gateway from '../components/Gateway.jsx'
import Reveal from '../components/Reveal.jsx'
import { ARTICLES, FEATURED_ARTICLE, PROSPECTS, SPOTLIGHT_PROSPECT } from '../data/content.js'
import usePageMeta from '../lib/usePageMeta.js'

const TICKER = [
  'LEAGUE POWER RANKINGS UPDATED',
  'BIG BOARD REFRESHED WEEKLY',
  'TRADE DEADLINE GRADES ARE LIVE',
  'AJ DYBANTSA HOLDS AT NO. 1',
  'SOPHOMORE LEAP INDEX OUT NOW',
  'MOCK DRAFT 3.0 OUT THURSDAY',
]

const PILLARS = [
  {
    title: 'Film First, Always',
    body:
      'Every grade and every take starts with possessions, not vibes. We log tendencies, not just outcomes — whether it is a prospect on tape or a contender in the fourth quarter.',
  },
  {
    title: 'Data That Earns Its Place',
    body:
      'We build and test our own models against actual outcomes — draft results, trade value, lineup performance. If a stat does not predict anything, it does not make the page.',
  },
  {
    title: 'No Hot Take Theater',
    body:
      'We are not chasing reaction content or guessing team needs for clicks. Our analysis reflects evaluation — what is actually true — not whoever can yell the loudest about it.',
  },
  {
    title: 'Accountable Calls',
    body:
      'We publish our misses alongside our hits. Every ranking and every prediction links back to the reasoning that produced it, so you can see exactly where we were right.',
  },
]

const SAVANT_FEATURES = ['Percentile Sliders', 'Player Compare', 'Team Browser', 'On/Off Splits']

const SAVANT_BARS = [
  { label: 'TS%', pct: 92 },
  { label: 'AST%', pct: 84 },
  { label: 'USG%', pct: 71 },
  { label: 'DREB%', pct: 58 },
  { label: 'STL%', pct: 76 },
]

function Ticker() {
  return (
    <div className="group relative overflow-hidden bg-navy py-2.5">
      <div className="animate-marquee flex w-max gap-12 whitespace-nowrap group-hover:[animation-play-state:paused]">
        {[false, true].map((clone) => (
          <div
            key={clone ? 'clone' : 'original'}
            aria-hidden={clone || undefined}
            className="flex gap-12"
          >
            {TICKER.map((t) => (
              <span
                key={t}
                className="font-mono-tight flex items-center gap-3 text-xs font-medium uppercase tracking-widest text-white/85"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
                {t}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  usePageMeta(null)
  return (
    <div>
      <Ticker />

      {/* Landing gateway — one card per destination, in that page's own style */}
      <Gateway />

      {/* Hero — the featured piece */}
      <section className="relative border-b border-line">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-6 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-20 lg:px-10 lg:py-24">
          <div>
            <span
              className="animate-rise kicker flex flex-wrap items-center gap-x-3 gap-y-1 text-navy"
              style={{ animationDelay: '60ms' }}
            >
              The Feature
              <span aria-hidden="true" className="text-gold">◆</span>
              {FEATURED_ARTICLE.category}
              <span aria-hidden="true" className="text-gold">◆</span>
              {FEATURED_ARTICLE.date}
            </span>
            <h1
              className="animate-rise text-display mt-5 text-[38px] leading-[1.06] text-ink sm:text-5xl lg:text-[58px]"
              style={{ animationDelay: '140ms' }}
            >
              <Link
                to={`/articles/${FEATURED_ARTICLE.slug}`}
                className="transition-colors duration-300 hover:text-navy"
              >
                {FEATURED_ARTICLE.title}
              </Link>
            </h1>
            <p
              className="animate-rise mt-6 max-w-xl text-lg leading-relaxed text-muted"
              style={{ animationDelay: '220ms' }}
            >
              {FEATURED_ARTICLE.excerpt}
            </p>
            <div
              className="animate-rise mt-8 flex flex-wrap items-center gap-4"
              style={{ animationDelay: '300ms' }}
            >
              <Button to={`/articles/${FEATURED_ARTICLE.slug}`}>Read the Feature</Button>
              <Button to="/rankings" variant="secondary">
                View the Big Board
              </Button>
              <span className="font-mono-tight text-xs text-faint">
                {FEATURED_ARTICLE.readTime}
              </span>
            </div>
          </div>

          <div
            className="animate-rise relative hidden lg:block"
            style={{ animationDelay: '260ms' }}
          >
            <div className="relative overflow-hidden rounded-md border border-line bg-surface p-6 shadow-[0_24px_48px_-32px_rgba(24,43,71,0.35)]">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gold" aria-hidden="true" />
              <CourtLines className="h-[420px] w-full text-navy/30" />
              <div className="mt-5 flex items-center justify-between border-t border-line-soft pt-4">
                <span className="kicker text-faint">Western Conference Elitists</span>
                <span className="font-mono-tight text-xs text-gold-deep">FIG. 01 · THE HALF COURT</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Latest analysis — only when there's more than just the featured piece */}
      {ARTICLES.length > 1 && (
        <section className="border-b border-line bg-wash">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
            <Reveal>
              <div className="flex items-end justify-between">
                <SectionHeading eyebrow="Latest" title="Fresh Analysis" />
                <Link
                  to="/articles"
                  className="underline-grow hidden font-mono text-xs font-medium uppercase tracking-[0.14em] text-muted hover:text-ink sm:block"
                >
                  View All →
                </Link>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {ARTICLES.slice(1, 4).map((a) => (
                  <ArticleCard key={a.slug} article={a} />
                ))}
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* Basketball Savant — flagship product band */}
      <section className="relative overflow-hidden bg-navy text-white">
        <CourtLines
          className="pointer-events-none absolute -right-24 -top-16 h-[520px] w-auto text-white/[0.07]"
          accent="rgba(194,162,99,0.25)"
        />
        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:px-10 lg:py-24">
          <Reveal>
            <span className="rule-gold" aria-hidden="true" />
            <span className="kicker mt-4 block text-gold">The Data Tool · Built In-House</span>
            <h2 className="text-display mt-3 text-4xl text-white sm:text-5xl">
              Basketball Savant
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/75">
              Every NBA player, sortable by percentile. Compare players across
              seasons, browse full team rosters, and see who actually moves the
              numbers when they are on the floor — the same data our analysis
              runs on, opened up for you.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {SAVANT_FEATURES.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-white/20 px-3.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-white/80"
                >
                  {f}
                </span>
              ))}
            </div>
            <div className="mt-8">
              <Button href="/basketball-savant.html" variant="light">
                Launch Basketball Savant
                <span aria-hidden="true">↗</span>
              </Button>
            </div>
          </Reveal>

          <Reveal delay={120} className="rounded-md border border-white/15 bg-white/[0.06] p-6 backdrop-blur-sm lg:p-8">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <span className="font-mono-tight text-xs uppercase tracking-[0.14em] text-white/60">
                Percentile Profile
              </span>
              <span className="font-mono-tight text-xs text-gold">2025–26</span>
            </div>
            <div className="mt-5 flex flex-col gap-4">
              {SAVANT_BARS.map((b) => (
                <div key={b.label} className="flex items-center gap-4">
                  <span className="w-14 shrink-0 font-mono-tight text-xs text-white/70">
                    {b.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gold"
                      style={{ width: `${b.pct}%`, opacity: 0.45 + (b.pct / 100) * 0.55 }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right font-mono-tight text-xs text-white/85">
                    {b.pct}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-white/10 pt-4 font-mono-tight text-[11px] uppercase tracking-[0.12em] text-white/45">
              League percentiles · every player · every team
            </p>
          </Reveal>
        </div>
      </section>

      {/* Comp Chain daily leaderboard */}
      <CompChainBoard />

      {/* Draft spotlight */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <Reveal>
          <SectionHeading
            eyebrow="Draft Spotlight"
            title="No. 1 on the Board"
            subtitle="Every week we put one prospect under the microscope. This week: the wing who has not left the top spot since February."
          />
        </Reveal>
        <Reveal delay={100}>
        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div className="relative flex flex-col justify-center overflow-hidden rounded-md border border-line bg-surface p-8 lg:p-10">
            <div className="absolute inset-x-0 top-0 h-[3px] bg-gold" aria-hidden="true" />
            <div className="flex items-baseline gap-4">
              <span className="text-display text-6xl text-navy">01</span>
              <div>
                <h3 className="text-display text-3xl text-ink">
                  {SPOTLIGHT_PROSPECT.name}
                </h3>
                <p className="kicker mt-1.5 text-faint">
                  {SPOTLIGHT_PROSPECT.school} · {SPOTLIGHT_PROSPECT.position}
                </p>
              </div>
            </div>
            <p className="mt-6 text-[15px] leading-relaxed text-muted">
              {SPOTLIGHT_PROSPECT.summary}
            </p>
            <p className="mt-4 border-l-[3px] border-gold pl-4 text-sm font-medium leading-relaxed text-navy">
              {SPOTLIGHT_PROSPECT.projection}
            </p>
            <Button to="/draft" variant="secondary" className="mt-8 w-fit">
              Full Scouting Report
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              ['Height', SPOTLIGHT_PROSPECT.height],
              ['Wingspan', SPOTLIGHT_PROSPECT.wingspan],
              ['Weight', SPOTLIGHT_PROSPECT.weight],
              ['Age', SPOTLIGHT_PROSPECT.age],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex flex-col items-center justify-center gap-2 rounded-md border border-line bg-surface py-8"
              >
                <span className="font-mono-tight text-3xl text-ink">{value}</span>
                <span className="kicker text-faint">{label}</span>
              </div>
            ))}
          </div>
        </div>
        </Reveal>
      </section>

      {/* Rankings preview */}
      <section className="border-y border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <Reveal>
            <div className="flex items-end justify-between">
              <SectionHeading
                eyebrow="Big Board"
                title="Top Prospects Right Now"
                subtitle="Updated weekly as the film and data come in. These are evaluation rankings, not mock draft slots."
              />
              <Link
                to="/rankings"
                className="underline-grow hidden font-mono text-xs font-medium uppercase tracking-[0.14em] text-muted hover:text-ink sm:block"
              >
                Full Board →
              </Link>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {PROSPECTS.slice(0, 3).map((p) => (
                <ProspectCard key={p.rank} prospect={p} />
              ))}
            </div>
          </Reveal>
          <div className="mt-10 flex justify-center sm:hidden">
            <Button to="/rankings" variant="secondary">
              View Full Board
            </Button>
          </div>
        </div>
      </section>

      {/* Brand positioning */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <Reveal>
          <SectionHeading
            eyebrow="Why WCE"
            title="Built for People Who Already Know the Game"
            subtitle="We are not chasing hot takes or volume. We are building the basketball media outlet we wish existed when we started doing this."
          />
        </Reveal>
        <Reveal delay={100}>
        <div className="mt-12 grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => (
            <div key={p.title} className="flex flex-col border-t-2 border-navy pt-5">
              <span className="text-display text-3xl text-gold-deep">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="text-display mt-3 text-xl text-ink">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
        </Reveal>
      </section>

      {/* Newsletter */}
      <section className="mx-auto max-w-7xl px-6 pb-24 lg:px-10">
        <Reveal>
          <NewsletterCTA />
        </Reveal>
      </section>
    </div>
  )
}
