import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import SectionHeading from '../components/SectionHeading.jsx'
import NewsletterCTA from '../components/NewsletterCTA.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { SOCIALS } from '../data/content.js'
import { sendContact } from '../lib/forms.js'
import usePageMeta from '../lib/usePageMeta.js'

// Must match REASONS in api/contact.js.
const REASONS = [
  'General',
  'Writing / Contributor Pitch',
  'Consulting / Scouting Work',
  'Partnership / Collaboration',
  'Press / Media',
]

const EMPTY = { name: '', email: '', reason: 'General', message: '', subscribe: false, website: '' }

const FIELD_ERRORS = {
  name: 'Add your name.',
  email: "That email doesn't look right.",
  message: 'Write a message first.',
}

const SUBMIT_ERRORS = {
  rate: "That's a lot of messages from here. Give it a few minutes and try again.",
  unavailable: "Something went wrong on our end and your message didn't go through. Try again in a minute.",
  server: "Something went wrong on our end and your message didn't go through. Try again in a minute.",
  network: "Couldn't reach the server. Check your connection and try again. Your message is still here.",
}

// What happened to the "Also send me The Weekly Board" box, keyed by the server's answer.
const NEWSLETTER_NOTE = {
  confirm: 'You also asked for The Weekly Board. Watch for a confirmation email and click the link inside.',
  resent: 'You also asked for The Weekly Board. We re-sent your confirmation email; click the link inside.',
  unconfirmed: "You're signed up for The Weekly Board but haven't confirmed. Find the confirmation email and click the link.",
  queued: 'You also asked for The Weekly Board. A confirmation email will follow; click the link inside.',
  subscribed: "You're subscribed to The Weekly Board.",
  existing: "You're already subscribed to The Weekly Board.",
  unsubscribed: "That address unsubscribed from The Weekly Board earlier, so we couldn't re-add it from here.",
  invalid: "We couldn't add that address to The Weekly Board. Try the signup form below with another email.",
  rejected: "We couldn't add that address to The Weekly Board. Try the signup form below with another email.",
  failed: "We couldn't add you to The Weekly Board just now. Try the signup form below.",
}

const inputClass = (bad) =>
  `mt-2 w-full rounded-sm border bg-surface px-4 py-3 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 ${
    bad ? 'border-red/60 focus:border-red focus:ring-red/15' : 'border-line focus:border-navy focus:ring-navy/15'
  }`

export default function Contact() {
  usePageMeta('Contact', 'Pitches, scouting disagreements, partnerships — get in touch with Western Conference Elitists.')
  const [form, setForm] = useState(EMPTY)
  const [phase, setPhase] = useState('idle') // idle | sending | sent
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [sentTo, setSentTo] = useState({ email: '', newsletter: undefined })
  const formRef = useRef(null)

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
    if (fieldErrors[name]) setFieldErrors((fe) => ({ ...fe, [name]: undefined }))
  }

  const validate = () => {
    const fe = {}
    if (!form.name.trim()) fe.name = 'required'
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) fe.email = 'invalid'
    if (form.message.trim().length < 2) fe.message = 'required'
    return fe
  }

  const focusFirstError = (fe) => {
    const first = ['name', 'email', 'message'].find((k) => fe[k])
    if (first) formRef.current?.querySelector(`[name="${first}"]`)?.focus()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (phase === 'sending') return
    const fe = validate()
    setFieldErrors(fe)
    setSubmitError('')
    if (Object.keys(fe).length) return focusFirstError(fe)

    setPhase('sending')
    const r = await sendContact({ ...form, name: form.name.trim(), email: form.email.trim() })
    if (r.ok) {
      setSentTo({ email: form.email.trim(), newsletter: r.newsletter })
      setForm(EMPTY)
      setPhase('sent')
      return
    }
    setPhase('idle')
    if (r.error === 'fields' && r.fields) {
      setFieldErrors(r.fields)
      focusFirstError(r.fields)
    } else {
      setSubmitError(SUBMIT_ERRORS[r.error] || SUBMIT_ERRORS.server)
    }
  }

  const sending = phase === 'sending'
  const err = (k) => (fieldErrors[k] ? (
    <p id={`contact-${k}-error`} className="mt-2 text-[13px] text-red">{FIELD_ERRORS[k]}</p>
  ) : null)
  const describe = (k) => (fieldErrors[k] ? `contact-${k}-error` : undefined)

  return (
    <div>
      <PageHeader
        eyebrow="Get In Touch"
        title="Tell us where the board is wrong."
        lede="Writing pitches, scouting disagreements, partnership ideas, or just a take you want to argue about — this is where it goes."
      />

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <SectionHeading eyebrow="Contact Form" title="Send Us a Message" />
            {phase === 'sent' ? (
              <div className="mt-8 rounded-md border border-line bg-surface p-8" role="status">
                <span className="kicker text-green">Message received</span>
                <h3 className="text-display mt-3 text-2xl text-ink">Thanks. It's in.</h3>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
                  Every message gets read. If yours needs a reply, it'll come to{' '}
                  <span className="font-semibold text-ink">{sentTo.email}</span>.
                </p>
                {NEWSLETTER_NOTE[sentTo.newsletter] && (
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">{NEWSLETTER_NOTE[sentTo.newsletter]}</p>
                )}
                <button
                  type="button"
                  onClick={() => setPhase('idle')}
                  className="mt-6 font-mono text-[12px] uppercase tracking-[0.12em] text-navy underline-offset-4 hover:underline"
                >
                  Send another message
                </button>
              </div>
            ) : (
            <form ref={formRef} onSubmit={handleSubmit} noValidate className="relative mt-8 flex flex-col gap-5" aria-busy={sending}>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="contact-name" className="kicker text-muted">
                    Name
                  </label>
                  <input
                    required
                    id="contact-name"
                    name="name"
                    autoComplete="name"
                    maxLength={100}
                    value={form.name}
                    onChange={handleChange}
                    aria-invalid={fieldErrors.name ? 'true' : undefined}
                    aria-describedby={describe('name')}
                    className={inputClass(fieldErrors.name)}
                    placeholder="Your name"
                  />
                  {err('name')}
                </div>
                <div>
                  <label htmlFor="contact-email" className="kicker text-muted">
                    Email
                  </label>
                  <input
                    required
                    type="email"
                    id="contact-email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    value={form.email}
                    onChange={handleChange}
                    aria-invalid={fieldErrors.email ? 'true' : undefined}
                    aria-describedby={describe('email')}
                    className={inputClass(fieldErrors.email)}
                    placeholder="you@email.com"
                  />
                  {err('email')}
                </div>
              </div>

              <div>
                <label htmlFor="contact-reason" className="kicker text-muted">
                  Reason
                </label>
                <select
                  id="contact-reason"
                  name="reason"
                  value={form.reason}
                  onChange={handleChange}
                  className={inputClass(false)}
                >
                  {REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="contact-message" className="kicker text-muted">
                  Message
                </label>
                <textarea
                  required
                  rows={5}
                  id="contact-message"
                  name="message"
                  maxLength={5000}
                  value={form.message}
                  onChange={handleChange}
                  aria-invalid={fieldErrors.message ? 'true' : undefined}
                  aria-describedby={describe('message')}
                  className={inputClass(fieldErrors.message)}
                  placeholder="What's on your mind?"
                />
                {err('message')}
              </div>

              <label className="flex w-fit cursor-pointer items-center gap-3 text-sm text-muted">
                <input
                  type="checkbox"
                  name="subscribe"
                  checked={form.subscribe}
                  onChange={handleChange}
                  className="h-4 w-4 rounded-sm border-line accent-navy"
                />
                Also send me The Weekly Board
              </label>

              {/* Honeypot — invisible to people, irresistible to bots. */}
              <div aria-hidden="true" className="absolute -left-[10000px] top-0 h-px w-px overflow-hidden">
                <label htmlFor="contact-hp">Leave this field empty</label>
                <input id="contact-hp" name="wce_hp_contact" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
              </div>

              {submitError && (
                <p role="alert" className="rounded-sm border border-red/30 bg-red/[0.05] px-4 py-3 text-[13px] leading-relaxed text-red">
                  {submitError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <button
                  type="submit"
                  disabled={sending}
                  className="w-fit rounded-sm bg-navy px-8 py-3 font-mono text-[12.5px] font-medium uppercase tracking-[0.12em] text-white transition-all duration-300 hover:-translate-y-px hover:bg-navy-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70"
                >
                  {sending ? 'Sending…' : 'Send Message'}
                </button>
                <p className="text-[12.5px] text-faint">
                  We only use your details to reply.{' '}
                  <Link to="/privacy" className="underline underline-offset-2 hover:text-navy">Privacy</Link>
                </p>
              </div>
            </form>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-md border border-line bg-surface p-8">
              <h3 className="text-display text-xl text-ink">Writing & Consulting</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                We work with select front offices, media partners, and
                contributors on scouting consulting and freelance analysis.
                If that's you, say so in the reason field above.
              </p>
            </div>
            <div className="rounded-md border border-line bg-surface p-8">
              <h3 className="text-display text-xl text-ink">Follow the Board</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Real-time prospect notes and board movement happen on social
                before they make it into a full article.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                {SOCIALS.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    className="underline-grow w-fit text-sm font-medium text-muted hover:text-ink"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24 lg:px-10">
        <NewsletterCTA source="contact" />
      </section>
    </div>
  )
}
