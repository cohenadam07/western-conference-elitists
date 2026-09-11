import { useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SUBSCRIBE_ERROR, SUBSCRIBE_SUCCESS, subscribe } from '../lib/forms.js'

/**
 * The one email field that actually subscribes people. Used by the NewsletterCTA band
 * and the /newsletter page.
 *
 * `source` tags where the signup happened ("home", "article", …) so Buttondown can tell
 * you which placements work.
 */
export default function SubscribeForm({ source = 'site', className = '' }) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot — see the hidden field below
  const [phase, setPhase] = useState('idle') // idle | sending | done
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const submit = async (e) => {
    e.preventDefault()
    if (phase === 'sending') return
    const value = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setError({ code: value ? 'invalid' : 'empty' })
      inputRef.current?.focus()
      return
    }
    setPhase('sending')
    setError(null)
    const r = await subscribe(value, source, website)
    if (r.ok) {
      setResult({ status: SUBSCRIBE_SUCCESS[r.status] ? r.status : 'confirm', email: value })
      setPhase('done')
      return
    }
    setError({ code: r.error, resubscribeUrl: r.resubscribeUrl })
    setPhase('idle')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  if (phase === 'done') {
    const copy = SUBSCRIBE_SUCCESS[result.status]
    return (
      <div className={`w-full max-w-md ${className}`} role="status">
        <div className="flex items-start gap-3 rounded-sm border border-green/25 bg-green/[0.06] px-5 py-4">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-green" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 10.4l2.6 2.6L14.2 7.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-ink">{copy.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{copy.body(result.email)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setPhase('idle'); setEmail(''); setResult(null) }}
          className="mt-3 font-mono text-[11.5px] uppercase tracking-[0.12em] text-faint underline-offset-4 hover:text-navy hover:underline"
        >
          Use a different email
        </button>
      </div>
    )
  }

  const sending = phase === 'sending'
  const errId = `${id}-error`
  return (
    <form onSubmit={submit} noValidate className={`relative w-full max-w-md ${className}`} aria-busy={sending}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor={`${id}-email`} className="sr-only">
          Email address
        </label>
        <input
          ref={inputRef}
          id={`${id}-email`}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (error) setError(null) }}
          placeholder="you@email.com"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errId : undefined}
          className={`w-full rounded-sm border bg-paper px-4 py-3 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 ${
            error ? 'border-red/60 focus:border-red focus:ring-red/15' : 'border-line focus:border-navy focus:ring-navy/15'
          }`}
        />
        <button
          type="submit"
          disabled={sending}
          className="whitespace-nowrap rounded-sm bg-navy px-6 py-3 font-mono text-[12.5px] font-medium uppercase tracking-[0.12em] text-white transition-all duration-300 hover:-translate-y-px hover:bg-navy-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70"
        >
          {sending ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>

      {/* Honeypot. Hidden from people and screen readers; bots that fill every field
          give themselves away and get a quiet fake success from the server. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-0 h-px w-px overflow-hidden">
        <label htmlFor={`${id}-hp`}>Leave this field empty</label>
        <input id={`${id}-hp`} name="wce_hp_nl" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      {error ? (
        <p id={errId} role="alert" className="mt-3 text-[13px] leading-relaxed text-red">
          {SUBSCRIBE_ERROR[error.code] || SUBSCRIBE_ERROR.server}
          {error.code === 'unsubscribed' && error.resubscribeUrl && (
            <>
              {' '}
              <a href={error.resubscribeUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
                Resubscribe on Buttondown
              </a>
            </>
          )}
          {error.code === 'unsubscribed' && !error.resubscribeUrl && (
            <>
              {' '}
              <Link to="/contact" className="font-semibold underline underline-offset-2">Message us</Link> and we’ll sort it out.
            </>
          )}
        </p>
      ) : (
        <p className="mt-3 text-[12.5px] leading-relaxed text-faint">
          Free. Unsubscribe anytime.{' '}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-navy">
            Privacy
          </Link>
        </p>
      )}
    </form>
  )
}
