import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader.jsx'
import usePageMeta from '../lib/usePageMeta.js'

const TABS = [
  { key: 'headlines', label: 'Headlines' },
  { key: 'analytics', label: 'Analytics' },
]

const BLURB = {
  headlines: "The biggest stories across the NBA and men's college basketball this week.",
  analytics: 'Basketball research and analytics — papers and long-form work from the last six months.',
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtStamp(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function Eyebrow({ outlet, published, children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono-tight text-[11px] uppercase tracking-[0.12em] text-faint">
      <span className="font-medium text-gold-deep">{outlet}</span>
      {published && <span aria-hidden="true" className="text-line">/</span>}
      <span>{fmtDate(published)}</span>
      {children}
    </div>
  )
}

function Chips({ players }) {
  if (!players?.length) return null
  return players.slice(0, 3).map((p) => (
    <a
      key={p.savant_url + p.name}
      href={p.savant_url}
      className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono-tight text-[11px] text-navy transition-colors hover:border-gold hover:text-navy-deep"
    >
      {p.name}
    </a>
  ))
}

/* The WCE-written summary — visually distinct (gold label, serif italic) so
   authorship is never ambiguous against the sourced headline above it. */
function WceSummary({ line, players, large = false }) {
  const hasChips = players?.length > 0
  if (!line && !hasChips) return null
  return (
    <div className={large ? 'mt-4' : 'mt-3'}>
      {line && (
        <p
          className={`text-display italic leading-relaxed text-muted ${
            large ? 'text-[19px] sm:text-xl' : 'text-[15px]'
          }`}
        >
          <span className="kicker mr-2 not-italic align-[2px] text-[10px] text-gold-deep">WCE</span>
          {line}
        </p>
      )}
      {hasChips && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Chips players={players} />
        </div>
      )}
    </div>
  )
}

function AlsoCovered({ outlets }) {
  if (!outlets?.length) return null
  return (
    <p className="mt-3 font-mono-tight text-[11px] text-faint">
      <span className="text-muted">Also covered by</span> {outlets.join(' · ')}
    </p>
  )
}

function SourceHeadline({ item, className }) {
  return (
    <h2 className={`text-display text-ink ${className}`}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="decoration-gold decoration-2 underline-offset-4 transition-colors hover:text-navy hover:underline"
      >
        {item.title}
      </a>
    </h2>
  )
}

function LeadStory({ item }) {
  return (
    <article className="relative mt-8 overflow-hidden rounded-2xl border border-line bg-wash px-6 py-8 sm:px-9 sm:py-10">
      <span className="absolute inset-x-0 top-0 h-1 bg-gold" aria-hidden="true" />
      <span className="kicker text-gold-deep">Top Story</span>
      <div className="mt-3">
        <Eyebrow outlet={item.outlet} published={item.published} />
      </div>
      <SourceHeadline
        item={item}
        className="mt-2 max-w-3xl text-[28px] leading-[1.08] sm:text-[38px] lg:text-[44px]"
      />
      <WceSummary line={item.wce_line} players={item.players} large />
      <AlsoCovered outlets={item.also_covered_by} />
    </article>
  )
}

function HeadlineItem({ item, index }) {
  return (
    <article className="flex gap-4 border-t border-line py-7 sm:gap-5">
      <span className="mt-1 w-7 shrink-0 font-mono-tight text-sm text-gold-deep/70">
        {String(index).padStart(2, '0')}
      </span>
      <div className="min-w-0 flex-1">
        <Eyebrow outlet={item.outlet} published={item.published} />
        <SourceHeadline item={item} className="mt-1.5 text-[21px] leading-snug" />
        <WceSummary line={item.wce_line} players={item.players} />
        <AlsoCovered outlets={item.also_covered_by} />
      </div>
    </article>
  )
}

function AnalyticsCard({ item }) {
  const isPaper = item.source_type === 'paper'
  return (
    <article className="flex flex-col rounded-xl border border-line bg-surface p-6 transition-colors hover:border-gold sm:p-7">
      <Eyebrow outlet={item.outlet} published={item.published}>
        <span
          className={`rounded-sm px-1.5 py-px text-[10px] ${
            isPaper ? 'bg-navy text-paper' : 'border border-line text-muted'
          }`}
        >
          {isPaper ? 'Paper' : 'Article'}
        </span>
      </Eyebrow>
      <SourceHeadline item={item} className="mt-2 text-[20px] leading-snug" />
      {item.authors?.length > 0 && (
        <p className="mt-1.5 font-mono-tight text-[11px] text-muted">
          {item.authors.slice(0, 4).join(', ')}
          {item.authors.length > 4 ? ' et al.' : ''}
        </p>
      )}
      <WceSummary line={item.wce_line} />
    </article>
  )
}

function EmptyState({ stamp }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <span className="text-display text-3xl text-faint">Nothing on the wire yet</span>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        The feed refreshes on the next scheduled run.
        {stamp && <> Last updated {fmtStamp(stamp)}.</>}
      </p>
    </div>
  )
}

export default function News() {
  usePageMeta(
    'News',
    'The biggest NBA and college basketball stories, plus basketball research and analytics — aggregated and annotated by Western Conference Elitists.'
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'analytics' ? 'analytics' : 'headlines'
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error

  useEffect(() => {
    let alive = true
    fetch('/news.json', { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json) => {
        if (!alive) return
        setData(json)
        setStatus('ready')
      })
      .catch(() => alive && setStatus('error'))
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    return tab === 'analytics' ? data.analytics || [] : data.headlines || []
  }, [data, tab])

  const setTab = (key) => {
    const next = new URLSearchParams(searchParams)
    if (key === 'headlines') next.delete('tab')
    else next.set('tab', key)
    setSearchParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader
        eyebrow="The Wire"
        title="News"
        lede="The biggest NBA and college basketball stories, plus basketball research and analytics — each sourced to its outlet, with a short WCE read underneath."
      />

      <section className="mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-12">
        {/* Tabs — the primary control at the top of the page */}
        <div className="flex flex-wrap items-end justify-between gap-y-3 border-b border-line">
          <div role="tablist" aria-label="News sections" className="flex items-stretch gap-2">
            {TABS.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={`-mb-px border-b-2 px-1 pb-3 pt-1 font-mono-tight text-[13px] uppercase tracking-[0.16em] transition-colors sm:text-sm ${
                    active
                      ? 'border-gold text-navy'
                      : 'border-transparent text-faint hover:text-muted'
                  }`}
                >
                  {t.label}
                  {status === 'ready' && (
                    <span className="ml-2 text-[11px] text-faint">
                      {(tab === t.key ? rows.length : (t.key === 'analytics' ? data?.analytics?.length : data?.headlines?.length)) ?? ''}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {status === 'ready' && data?.generated_at && (
            <span className="mb-3 font-mono-tight text-[11px] text-faint">
              Updated {fmtStamp(data.generated_at)}
            </span>
          )}
        </div>

        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">{BLURB[tab]}</p>

        {status === 'loading' && (
          <p className="py-24 text-center font-mono-tight text-sm text-faint">Loading the wire…</p>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <span className="text-display text-3xl text-faint">The wire is quiet</span>
            <p className="max-w-sm text-sm leading-relaxed text-muted">
              The feed couldn&rsquo;t be loaded right now. It refreshes on the next scheduled run.
            </p>
          </div>
        )}

        {status === 'ready' && rows.length === 0 && <EmptyState stamp={data?.generated_at} />}

        {status === 'ready' && rows.length > 0 && tab === 'headlines' && (
          <>
            <LeadStory item={rows[0]} />
            <div className="mt-4 grid gap-x-12 sm:mt-6 lg:grid-cols-2">
              {rows.slice(1).map((item, i) => (
                <HeadlineItem key={item.id} item={item} index={i + 2} />
              ))}
            </div>
          </>
        )}

        {status === 'ready' && rows.length > 0 && tab === 'analytics' && (
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {rows.map((item) => (
              <AnalyticsCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {status === 'ready' && rows.length > 0 && (
          <p className="mt-12 border-t border-line pt-6 text-center font-mono-tight text-[11px] leading-relaxed text-faint">
            Headlines and abstracts belong to their original outlets and link back to the source.
            The italic WCE read under each item is written by Western Conference Elitists.
          </p>
        )}
      </section>
    </div>
  )
}
