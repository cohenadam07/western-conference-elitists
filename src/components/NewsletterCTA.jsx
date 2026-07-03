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
      className={`rounded-md bg-navy ${compact ? 'p-6' : 'p-10 lg:p-14'}`}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-lg">
          <span className="font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
            The Weekly Board
          </span>
          <h3 className="mt-3 text-display text-2xl text-white sm:text-3xl">
            {NEWSLETTER_COPY.heading}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            {NEWSLETTER_COPY.body}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="w-full rounded-sm border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-white/60 focus:outline-none"
          />
          <button
            type="submit"
            className="whitespace-nowrap rounded-sm bg-white px-6 py-3 text-sm font-semibold uppercase tracking-wider text-navy transition-colors hover:bg-white/90"
          >
            {submitted ? "You're In" : 'Subscribe'}
          </button>
        </form>
      </div>
    </div>
  )
}
