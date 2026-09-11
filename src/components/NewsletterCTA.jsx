import { Link } from 'react-router-dom'
import { NEWSLETTER_COPY } from '../data/content.js'
import SubscribeForm from './SubscribeForm.jsx'

export default function NewsletterCTA({ compact = false, source = 'site' }) {
  return (
    <div
      className={`relative overflow-hidden rounded-md border border-line bg-surface ${
        compact ? 'p-6' : 'p-10 lg:p-14'
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gold" aria-hidden="true" />
      <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-lg">
          <Link to="/newsletter" className="kicker text-navy hover:text-gold-deep">
            The Weekly Board
          </Link>
          <h3 className="text-display mt-3 text-2xl text-ink sm:text-3xl">
            {NEWSLETTER_COPY.heading}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {NEWSLETTER_COPY.body}
          </p>
        </div>

        <SubscribeForm source={source} />
      </div>
    </div>
  )
}
