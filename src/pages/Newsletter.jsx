import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import SubscribeForm from '../components/SubscribeForm.jsx'
import { NEWSLETTER_COPY } from '../data/content.js'
import usePageMeta from '../lib/usePageMeta.js'

// The three beats the newsletter promises (NEWSLETTER_COPY.body). Keep them in sync.
const BEATS = [
  {
    n: '01',
    title: 'The board move',
    body: 'One change to the big board, and the film and numbers behind it.',
  },
  {
    n: '02',
    title: 'Buying or fading',
    body: "One prospect we're higher or lower on than consensus, and why.",
  },
  {
    n: '03',
    title: 'The stat',
    body: 'One number that should change how you watch the draft.',
  },
]

const fmtDate = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function useArchive() {
  const [state, setState] = useState({ loading: true, issues: [], archiveUrl: null })
  useEffect(() => {
    let live = true
    fetch('/api/newsletter')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => live && setState({ loading: false, issues: j.issues || [], archiveUrl: j.archiveUrl || null }))
      .catch(() => live && setState({ loading: false, issues: [], archiveUrl: null }))
    return () => { live = false }
  }, [])
  return state
}

export default function Newsletter() {
  usePageMeta('The Weekly Board', 'The Weekly Board: one board move, one prospect we’re buying or fading, and one stat, in your inbox. Free.')
  const { loading, issues, archiveUrl } = useArchive()

  return (
    <div>
      <PageHeader eyebrow="The Weekly Board" title={NEWSLETTER_COPY.heading} lede={NEWSLETTER_COPY.body}>
        <div className="w-full max-w-md lg:pb-1">
          <SubscribeForm source="newsletter-page" />
        </div>
      </PageHeader>

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
        <SectionHeading eyebrow="Every issue" title="Three things, every week." />
        <ol className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          {BEATS.map((b) => (
            <li key={b.n} className="relative rounded-md border border-line bg-surface p-7">
              <span className="font-mono text-[12px] tracking-[0.14em] text-gold-deep">{b.n}</span>
              <h3 className="text-display mt-3 text-xl text-ink">{b.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{b.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-line bg-wash">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading eyebrow="Archive" title="Past issues" />
            {archiveUrl && issues.length > 0 && (
              <a
                href={archiveUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[12px] uppercase tracking-[0.12em] text-navy underline-offset-4 hover:underline"
              >
                Full archive ↗
              </a>
            )}
          </div>

          <div className="mt-10" aria-busy={loading}>
            {loading ? (
              <ul className="divide-y divide-line border-y border-line" aria-label="Loading past issues">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex flex-col gap-3 py-6 sm:flex-row sm:gap-10">
                    <span className="h-3 w-24 animate-pulse rounded-sm bg-line" />
                    <span className="flex flex-1 flex-col gap-2">
                      <span className="h-5 w-3/5 animate-pulse rounded-sm bg-line" />
                      <span className="h-3 w-4/5 animate-pulse rounded-sm bg-line-soft" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : issues.length === 0 ? (
              <div className="rounded-md border border-dashed border-line bg-surface/60 px-7 py-10 text-center">
                <p className="text-display text-xl text-ink">Nothing in the archive yet.</p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                  Issues show up here after they go out. Subscribers get them first.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {issues.map((issue) => (
                  <li key={issue.id}>
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex flex-col gap-2 py-6 sm:flex-row sm:items-baseline sm:gap-10"
                    >
                      <time dateTime={issue.date} className="w-32 shrink-0 font-mono text-[12px] uppercase tracking-[0.1em] text-faint">
                        {fmtDate(issue.date)}
                      </time>
                      <span className="flex-1">
                        <span className="text-display block text-xl text-ink transition-colors group-hover:text-navy sm:text-2xl">
                          {issue.subject}
                        </span>
                        {issue.description && (
                          <span className="mt-1.5 block max-w-2xl text-sm leading-relaxed text-muted">{issue.description}</span>
                        )}
                      </span>
                      <span aria-hidden="true" className="hidden text-gold-deep transition-transform group-hover:translate-x-1 sm:block">
                        ↗
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
