import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

// Private: contact-form messages + newsletter list health. Unlisted, noindex, and gated by
// the same password (and the same saved session) as /analytics.
const STORAGE_KEY = 'wce-analytics-key'

const readKey = () => { try { return sessionStorage.getItem(STORAGE_KEY) || '' } catch { return '' } }
const saveKey = (v) => { try { v ? sessionStorage.setItem(STORAGE_KEY, v) : sessionStorage.removeItem(STORAGE_KEY) } catch { /* private mode */ } }

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const btn = 'rounded-sm border border-line bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted transition-colors hover:border-navy hover:text-navy disabled:opacity-50'
const btnPrimary = 'rounded-sm bg-navy px-4 py-2 font-mono text-[11.5px] uppercase tracking-[0.12em] text-white transition-colors hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50'

function Gate({ onUnlock, error }) {
  const [draft, setDraft] = useState('')
  return (
    <div className="mx-auto flex max-w-sm flex-col px-6 py-28">
      <span className="rule-gold" aria-hidden="true" />
      <h1 className="text-display mt-4 text-3xl text-ink">Inbox</h1>
      <p className="mt-2 text-sm text-muted">Private. Same password as the analytics archive.</p>
      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onUnlock(draft.trim()) }}
      >
        <label htmlFor="inbox-pw" className="sr-only">Password</label>
        <input
          id="inbox-pw"
          type="password"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Password"
          className="w-full rounded-sm border border-line bg-surface px-4 py-3 text-sm text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
        />
        <button type="submit" className={btnPrimary}>Unlock</button>
        {error && <p role="alert" className="text-[13px] text-red">{error}</p>}
      </form>
    </div>
  )
}

function Message({ m, onAct, busy }) {
  const [confirming, setConfirming] = useState(false)
  const mailto = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent('Re: your message to Western Conference Elitists')}&body=${encodeURIComponent(
    `\n\n---\nOn ${new Date(m.ts).toLocaleString()}, ${m.name} wrote:\n> ${m.message.split('\n').join('\n> ')}`
  )}`
  return (
    <li className={`rounded-md border bg-surface p-6 ${m.read ? 'border-line' : 'border-navy/35 shadow-[inset_3px_0_0_var(--color-navy)]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {!m.read && <span className="h-2 w-2 rounded-full bg-navy" aria-hidden="true" />}
            {!m.read && <span className="sr-only">Unread:</span>}
            <span className="font-semibold text-ink">{m.name}</span>
            <a href={`mailto:${encodeURIComponent(m.email)}`} className="truncate text-sm text-muted hover:text-navy">{m.email}</a>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-sm bg-wash px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-navy">{m.reason}</span>
            <span className="font-mono text-[11px] text-faint" title={new Date(m.ts).toLocaleString()}>{ago(m.ts)}</span>
            {m.country && <span className="font-mono text-[11px] text-faint">· {m.country}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={mailto} onClick={() => !m.read && onAct('read', m.id)} className={btn}>Reply</a>
          <button type="button" disabled={busy} onClick={() => onAct(m.read ? 'unread' : 'read', m.id)} className={btn}>
            Mark {m.read ? 'unread' : 'read'}
          </button>
          {confirming ? (
            <>
              <button type="button" disabled={busy} onClick={() => onAct('delete', m.id)} className={`${btn} border-red/50 text-red hover:border-red hover:text-red`}>
                Confirm delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={btn}>Keep</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={btn}>Delete</button>
          )}
        </div>
      </div>
      <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{m.message}</p>
    </li>
  )
}

function Status({ ok, label, hint }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-green' : 'bg-red'}`} aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-ink">{label} <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">{ok ? 'on' : 'off'}</span></p>
        {!ok && hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
      </div>
    </li>
  )
}

function NewsletterPanel({ data, onFlush, flushing, flushNote }) {
  if (!data) return null
  const { config, subscribers, pending } = data
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          {[
            ['Confirmed', subscribers?.confirmed],
            ['Awaiting confirmation', subscribers?.unconfirmed],
          ].map(([label, n]) => (
            <div key={label} className="rounded-md border border-line bg-surface p-6">
              <p className="kicker text-faint">{label}</p>
              <p className="text-display mt-2 text-4xl text-ink">{n ?? '—'}</p>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-line bg-surface p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-display text-xl text-ink">Held signups</h2>
              <p className="mt-1 text-sm text-muted">
                {pending.length
                  ? `${pending.length} address${pending.length === 1 ? '' : 'es'} waiting to reach Buttondown.`
                  : 'Nothing waiting. Every signup has reached Buttondown.'}
              </p>
            </div>
            {pending.length > 0 && (
              <button type="button" onClick={onFlush} disabled={flushing || !config.buttondown} className={btnPrimary}>
                {flushing ? 'Pushing…' : 'Push to Buttondown'}
              </button>
            )}
          </div>
          {flushNote && <p className="mt-3 text-[13px] text-muted" role="status">{flushNote}</p>}
          {pending.length > 0 && (
            <ul className="mt-4 divide-y divide-line-soft border-t border-line-soft">
              {pending.map((p) => (
                <li key={p.email} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                  <span className="text-ink">{p.email}</span>
                  <span className="font-mono text-[11px] text-faint">{p.source} · {ago(p.ts)}</span>
                  {p.reason && <span className="w-full text-[12px] text-faint">{p.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="rounded-md border border-line bg-surface p-6">
          <h2 className="text-display text-xl text-ink">Setup</h2>
          <ul className="mt-2 divide-y divide-line-soft">
            <Status ok={config.buttondown} label="Buttondown" hint="Set BUTTONDOWN_API_KEY in Vercel. Until then, signups are held here." />
            <Status ok={config.kv} label="Upstash" hint="No database: messages can't be stored and signups can't be held." />
            <Status ok={config.notifications} label="Email copies of messages" hint="Optional. Set RESEND_API_KEY and CONTACT_NOTIFY_TO." />
          </ul>
        </div>
        <div className="rounded-md border border-line bg-surface p-6">
          <h2 className="text-display text-xl text-ink">Write an issue</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Draft from your latest articles with <code className="rounded-sm bg-wash px-1.5 py-0.5 font-mono text-[12px] text-ink">npm run newsletter-draft</code>, then edit and send in Buttondown.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="https://buttondown.com/emails" target="_blank" rel="noreferrer" className={btn}>Open Buttondown ↗</a>
            {config.archiveUrl && <a href={config.archiveUrl} target="_blank" rel="noreferrer" className={btn}>Public archive ↗</a>}
            <Link to="/newsletter" className={btn}>Signup page</Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Inbox() {
  const [key, setKey] = useState(readKey)
  const [gateError, setGateError] = useState('')
  const [messages, setMessages] = useState(null)
  const [nl, setNl] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('messages')
  const [filter, setFilter] = useState('all')
  const [flushing, setFlushing] = useState(false)
  const [flushNote, setFlushNote] = useState('')

  useEffect(() => {
    document.title = 'Inbox — WCE'
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  const lock = useCallback((msg) => { saveKey(''); setKey(''); setGateError(msg); setMessages(null); setNl(null) }, [])

  const api = useCallback(async (url, opts = {}) => {
    const res = await fetch(url, { ...opts, headers: { 'x-analytics-key': key, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
    if (res.status === 401) { lock('Wrong password.'); throw new Error('unauthorized') }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
    return json
  }, [key, lock])

  const load = useCallback(async () => {
    if (!key) return
    setLoading(true)
    setError('')
    try {
      const [m, n] = await Promise.all([api('/api/contact'), api('/api/newsletter?admin=1')])
      setMessages(m)
      setNl(n)
    } catch (e) {
      if (e.message !== 'unauthorized') setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [key, api])

  useEffect(() => { load() }, [load])

  const act = async (action, id) => {
    setBusy(true)
    try {
      await api(`/api/contact?action=${action}`, { method: 'POST', body: JSON.stringify({ id }) })
      setMessages((cur) => {
        if (!cur) return cur
        const list = action === 'delete'
          ? cur.messages.filter((x) => x.id !== id)
          : cur.messages.map((x) => (x.id === id ? { ...x, read: action === 'read' } : x))
        return { ...cur, messages: list, total: cur.total - (action === 'delete' ? 1 : 0), unread: list.filter((x) => !x.read).length }
      })
    } catch (e) {
      if (e.message !== 'unauthorized') setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const flush = async () => {
    setFlushing(true)
    setFlushNote('')
    const totals = { added: 0, existing: 0, dropped: 0 }
    try {
      for (let round = 0; round < 25; round++) {
        const r = await api('/api/newsletter?admin=flush', { method: 'POST', body: '{}' })
        totals.added += r.added; totals.existing += r.existing; totals.dropped += r.dropped
        totals.waiting = r.remaining
        totals.error = r.error
        // Stop when the queue is empty, or when a round moved nothing (Buttondown is
        // refusing everything right now); the rest stays held for next time.
        if (!r.remaining || r.added + r.existing + r.dropped === 0) break
      }
      const parts = [`${totals.added} added (confirmation emails sent)`]
      if (totals.existing) parts.push(`${totals.existing} already subscribed`)
      if (totals.dropped) parts.push(`${totals.dropped} rejected by Buttondown`)
      if (totals.waiting) parts.push(`${totals.waiting} still held${totals.error ? ` (${totals.error})` : ''}`)
      setFlushNote(parts.join(' · '))
    } catch (e) {
      if (e.message !== 'unauthorized') setFlushNote(`Push failed: ${e.message}`)
    } finally {
      setFlushing(false)
      load()
    }
  }

  const shown = useMemo(
    () => (messages?.messages || []).filter((m) => filter === 'all' || !m.read),
    [messages, filter]
  )

  if (!key) return <Gate error={gateError} onUnlock={(v) => { saveKey(v); setGateError(''); setKey(v) }} />

  const unread = messages?.unread || 0
  const pendingCount = nl?.pending?.length || 0
  const tabBtn = (id, label, count) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`-mb-px flex items-center gap-2 border-b-2 px-1 pb-3 font-mono text-[12px] uppercase tracking-[0.12em] transition-colors ${
        tab === id ? 'border-navy text-navy' : 'border-transparent text-faint hover:text-muted'
      }`}
    >
      {label}
      {count > 0 && <span className="rounded-full bg-navy px-1.5 py-px text-[10px] leading-4 text-white">{count}</span>}
    </button>
  )

  return (
    <div className="mx-auto max-w-5xl px-6 py-14 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="rule-gold" aria-hidden="true" />
          <h1 className="text-display mt-4 text-4xl text-ink">Inbox</h1>
          <p className="mt-2 text-sm text-muted">
            {messages ? `${messages.total} message${messages.total === 1 ? '' : 's'} · ${unread} unread` : 'Loading…'}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} disabled={loading} className={btn}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button type="button" onClick={() => lock('')} className={btn}>Lock</button>
        </div>
      </div>

      {error && <p role="alert" className="mt-6 rounded-sm border border-red/30 bg-red/[0.05] px-4 py-3 text-[13px] text-red">{error}</p>}

      <div role="tablist" className="mt-10 flex gap-6 border-b border-line">
        {tabBtn('messages', 'Messages', unread)}
        {tabBtn('newsletter', 'Newsletter', pendingCount)}
      </div>

      <div className="mt-8">
        {tab === 'messages' && (
          <>
            {messages && messages.configured === false && (
              <p className="rounded-md border border-line bg-surface p-6 text-sm text-muted">
                Upstash isn't configured on this deployment, so messages can't be stored here.
              </p>
            )}
            {messages?.configured !== false && (
              <div className="mb-5 flex gap-2">
                {['all', 'unread'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={`${btn} ${filter === f ? 'border-navy text-navy' : ''}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
            {messages && messages.configured !== false && shown.length === 0 && (
              <p className="rounded-md border border-dashed border-line px-6 py-12 text-center text-sm text-muted">
                {filter === 'unread' ? 'All caught up.' : 'No messages yet.'}
              </p>
            )}
            <ul className="flex flex-col gap-4">
              {shown.map((m) => <Message key={m.id} m={m} onAct={act} busy={busy} />)}
            </ul>
          </>
        )}
        {tab === 'newsletter' && <NewsletterPanel data={nl} onFlush={flush} flushing={flushing} flushNote={flushNote} />}
      </div>
    </div>
  )
}
