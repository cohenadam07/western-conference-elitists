import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader.jsx'
import SportPicker from '../components/SportPicker.jsx'
import { SPORTS, getSports, saveSports } from '../lib/forms.js'
import usePageMeta from '../lib/usePageMeta.js'

// /newsletter/sports?id=<Buttondown subscriber ID>: where a reader picks which sports Savant
// Sunday sends them. The link is at the bottom of every issue ({{ subscriber.id }}), so there
// is nothing to log in to. Unlisted and noindex; the ID is kept out of analytics (App.jsx).

const words = (ids) => {
  const labels = SPORTS.filter((s) => ids.includes(s.id)).map((s) => s.label)
  return labels.length < 3 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

const btn =
  'whitespace-nowrap rounded-sm bg-navy px-6 py-3 font-mono text-[12.5px] font-medium uppercase tracking-[0.12em] text-white transition-all duration-300 hover:-translate-y-px hover:bg-navy-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50'
const link = 'font-semibold text-navy underline underline-offset-2 hover:text-gold-deep'

function Note({ title, children }) {
  return (
    <div className="max-w-2xl rounded-md border border-line bg-surface px-7 py-8">
      <p className="text-display text-xl text-ink">{title}</p>
      <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
    </div>
  )
}

export default function NewsletterSports() {
  usePageMeta('Your sports', 'Pick which sports you get in Savant Sunday.')
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  const [params] = useSearchParams()
  const id = (params.get('id') || '').trim()

  const [load, setLoad] = useState({ phase: id ? 'loading' : 'missing' }) // loading | ready | missing | notfound | unsubscribed | error
  const [picked, setPicked] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState(null) // { ok, text }

  const fetchSports = useCallback(async () => {
    if (!id) return setLoad({ phase: 'missing' })
    setLoad({ phase: 'loading' })
    const r = await getSports(id)
    if (r.ok) {
      setLoad({ phase: 'ready', email: r.email, confirmed: r.confirmed, saved: r.sports })
      setPicked(r.sports)
      return
    }
    if (r.error === 'notfound') return setLoad({ phase: 'notfound' })
    if (r.error === 'unsubscribed') return setLoad({ phase: 'unsubscribed', resubscribeUrl: r.resubscribeUrl })
    setLoad({ phase: 'error', code: r.error })
  }, [id])

  useEffect(() => { fetchSports() }, [fetchSports])

  const save = async (e) => {
    e.preventDefault()
    if (saving || !picked.length) return
    setSaving(true)
    setSaveNote(null)
    const r = await saveSports(id, picked)
    setSaving(false)
    if (r.ok) {
      setLoad((l) => ({ ...l, saved: r.sports }))
      setPicked(r.sports)
      setSaveNote({ ok: true, text: `Saved. Your next Savant Sunday has ${words(r.sports)}.` })
      return
    }
    setSaveNote({
      ok: false,
      text: r.error === 'rate' ? 'Too many tries from here. Give it a few minutes.' : r.error === 'network' ? "Couldn't reach the server. Check your connection and try again." : "That didn't save. Try again in a minute.",
    })
  }

  const dirty = load.phase === 'ready' && !same(picked, load.saved)

  return (
    <div>
      <PageHeader
        eyebrow="Savant Sunday"
        title="Your sports."
        lede="Savant Sunday is one email, every Sunday morning. Pick the sports you want in it, and the rest stay out."
      />

      <section className="mx-auto max-w-7xl px-6 py-14 lg:px-10 lg:py-16" aria-live="polite">
        {load.phase === 'missing' && (
          <Note title="Open this page from your email.">
            The link at the bottom of every Savant Sunday brings you here already signed in, so there's
            nothing to log in to. Not subscribed yet? <Link to="/newsletter" className={link}>Sign up here</Link>.
          </Note>
        )}

        {load.phase === 'loading' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true" aria-label="Loading your sports">
            {[0, 1, 2].map((i) => <span key={i} className="h-[76px] animate-pulse rounded-md bg-line-soft" />)}
          </div>
        )}

        {load.phase === 'notfound' && (
          <Note title="That link doesn't match anyone on the list.">
            Use the link at the bottom of your most recent issue. If you've unsubscribed or changed
            addresses, <Link to="/newsletter" className={link}>sign up again</Link>.
          </Note>
        )}

        {load.phase === 'unsubscribed' && (
          <Note title="This address is unsubscribed.">
            So there's nothing to send and nothing to change.{' '}
            {load.resubscribeUrl ? (
              <a href={load.resubscribeUrl} target="_blank" rel="noreferrer" className={link}>Resubscribe on Buttondown</a>
            ) : (
              <Link to="/newsletter" className={link}>Sign up again</Link>
            )}{' '}
            if you want it back.
          </Note>
        )}

        {load.phase === 'error' && (
          <Note title="Couldn't load your sports just now.">
            {load.code === 'rate' ? 'Too many tries from here. Give it a few minutes, then ' : 'Try again in a minute, or '}
            <button type="button" onClick={fetchSports} className={link}>try now</button>.
          </Note>
        )}

        {load.phase === 'ready' && (
          <form onSubmit={save} className="max-w-3xl">
            <p className="font-mono text-[12px] tracking-[0.06em] text-faint">
              <span className="uppercase tracking-[0.12em]">For</span> {load.email}
            </p>
            {!load.confirmed && (
              <p className="mt-3 max-w-2xl rounded-sm border border-gold/40 bg-gold/[0.08] px-4 py-3 text-sm leading-relaxed text-ink">
                You haven't confirmed your email yet, so nothing is being sent. Find the confirmation email
                (check spam too) and click the link. Your sports below are saved either way.
              </p>
            )}

            <div className="mt-6">
              <SportPicker
                variant="cards"
                label="Sports in your email"
                value={picked}
                disabled={saving}
                onChange={(next) => { setPicked(next); setSaveNote(null) }}
              />
            </div>

            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
              <button type="submit" className={btn} disabled={saving || !picked.length || !dirty}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <p role="status" className={`text-sm leading-relaxed ${saveNote && !saveNote.ok ? 'text-red' : 'text-muted'}`}>
                {!picked.length
                  ? 'Pick at least one. To stop the emails altogether, use the unsubscribe link at the bottom of any issue.'
                  : saveNote
                    ? saveNote.text
                    : dirty
                      ? `Not saved yet: ${words(picked)}.`
                      : `You get ${words(load.saved)}.`}
              </p>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
