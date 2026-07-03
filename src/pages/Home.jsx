import { Link } from 'react-router-dom'
import Button from '../components/Button.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import ArticleCard from '../components/ArticleCard.jsx'
import ProspectCard from '../components/ProspectCard.jsx'
import NewsletterCTA from '../components/NewsletterCTA.jsx'
import { ARTICLES, FEATURED_ARTICLE, PROSPECTS, SPOTLIGHT_PROSPECT } from '../data/content.js'

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

export default function Home() {
  return (
    <div>
      {/* Breaking ticker */}
      <div className="relative overflow-hidden bg-navy py-2.5">
        <div className="animate-marquee flex w-max gap-12 whitespace-nowrap">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span
              key={i}
              className="font-mono-tight flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-white"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red" />
              </span>
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Hero */}
      <section className="relative border-b border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-24">
          <div className="flex flex-col items-start gap-6">
            <span className="font-mono-tight rounded-sm bg-navy px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-white">
              NBA Coverage, Year-Round
            </span>
            <h1 className="text-display max-w-4xl text-5xl leading-[1.05] text-ink sm:text-6xl lg:text-7xl">
              The NBA, broken down by people who actually watch the{' '}
              <span className="marker">film</span>.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted">
              Western Conference Elitists covers the league year-round —
              trades, team building, playoff strategy, and the prospects who
              will be running it in five years. Built on tape, backed by
              data, written for people who know the difference between a
              good stat line and a good player.
            </p>
            <div className="mt-2 flex flex-wrap gap-4">
              <Button to="/articles">Read the Latest</Button>
              <Button to="/rankings" variant="secondary">
                View the Big Board
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Featured content */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <SectionHeading eyebrow="Featured" title="Start Here" />
        <div className="mt-10">
          <ArticleCard article={FEATURED_ARTICLE} featured />
        </div>
      </section>

      {/* Latest analysis */}
      <section className="border-y border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="flex items-end justify-between">
            <SectionHeading eyebrow="Latest" title="Fresh Analysis" />
            <Link
              to="/articles"
              className="underline-grow hidden text-sm font-semibold uppercase tracking-wide text-muted hover:text-ink sm:block"
            >
              View All →
            </Link>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {ARTICLES.slice(1, 4).map((a) => (
              <ArticleCard key={a.slug} article={a} />
            ))}
          </div>
        </div>
      </section>

      {/* Draft spotlight */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <SectionHeading
          eyebrow="Draft Spotlight"
          title="No. 1 on the Board"
          subtitle="Every week we put one prospect under the microscope. This week: the wing who has not left the top spot since February."
        />
        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col justify-center rounded-md border border-line bg-surface p-8 lg:p-10">
            <div className="flex items-baseline gap-4">
              <span className="text-display text-6xl text-navy">01</span>
              <div>
                <h3 className="text-display text-3xl text-ink">
                  {SPOTLIGHT_PROSPECT.name}
                </h3>
                <p className="text-sm uppercase tracking-wide text-faint">
                  {SPOTLIGHT_PROSPECT.school} · {SPOTLIGHT_PROSPECT.position}
                </p>
              </div>
            </div>
            <p className="mt-6 text-base leading-relaxed text-muted">
              {SPOTLIGHT_PROSPECT.summary}
            </p>
            <p className="mt-4 text-sm font-medium text-green">
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
                <span className="text-xs uppercase tracking-widest text-faint">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Rankings preview */}
      <section className="border-y border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="flex items-end justify-between">
            <SectionHeading
              eyebrow="Big Board"
              title="Top Prospects Right Now"
              subtitle="Updated weekly as the film and data come in. These are evaluation rankings, not mock draft slots."
            />
            <Link
              to="/rankings"
              className="underline-grow hidden text-sm font-semibold uppercase tracking-wide text-muted hover:text-ink sm:block"
            >
              Full Board →
            </Link>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PROSPECTS.slice(0, 3).map((p) => (
              <ProspectCard key={p.rank} prospect={p} />
            ))}
          </div>
          <div className="mt-10 flex justify-center sm:hidden">
            <Button to="/rankings" variant="secondary">
              View Full Board
            </Button>
          </div>
        </div>
      </section>

      {/* Brand positioning */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <SectionHeading
          eyebrow="Why WCE"
          title="Built for People Who Already Know the Game"
          subtitle="We are not chasing hot takes or volume. We are building the basketball media outlet we wish existed when we started doing this."
        />
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => (
            <div
              key={p.title}
              className="card-hover flex flex-col rounded-md border border-line bg-surface p-6"
            >
              <span className="font-mono-tight text-3xl text-navy">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-4 text-lg font-bold text-ink">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Newsletter */}
      <section className="mx-auto max-w-7xl px-6 pb-24 lg:px-10">
        <NewsletterCTA />
      </section>
    </div>
  )
}
