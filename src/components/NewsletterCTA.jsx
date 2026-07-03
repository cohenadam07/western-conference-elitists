import { useState } from 'react'
import { NEWSLETTER_COPY } from '../data/content.js'

export default function NewsletterCTA({ compact = false }) {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!email) return
    setSubmitted(true)
  }

  return (
    <div
      className={`relative overflow-hidden rounded-md border border-line bg-surface ${
        compact ? 'p-6' : 'p-10 lg:p-14'
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gold" aria-hidden="true" />
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-lg">
          <span className="kicker text-navy">The Weekly Board</span>
          <h3 className="text-display mt-3 text-2xl text-ink sm:text-3xl">
            {NEWSLETTER_COPY.heading}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {NEWSLETTER_COPY.body}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
          <label htmlFor="newsletter-email" className="sr-only">
            Email address
          </label>
          <input
            id="newsletter-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="w-full rounded-sm border border-line bg-paper px-4 py-3 text-sm text-ink placeholder:text-faint focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
          />
          <button
            type="submit"
            className="whitespace-nowrap rounded-sm bg-navy px-6 py-3 font-mono text-[12.5px] font-medium uppercase tracking-[0.12em] text-white transition-all duration-300 hover:-translate-y-px hover:bg-navy-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep"
          >
            {submitted ? "You're In" : 'Subscribe'}
          </button>
        </form>
      </div>
    </div>
  )
}
