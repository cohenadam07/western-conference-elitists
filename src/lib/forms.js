// Browser side of the two real forms. Talks to api/newsletter.js and api/contact.js.
// Every call resolves (never throws) to the server's JSON, or { ok: false, error: 'network' }.

async function postJSON(url, body) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000) // longer than the server's worst case
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => null)
    if (json && typeof json === 'object') return json
    return { ok: false, error: res.ok ? 'server' : res.status === 429 ? 'rate' : 'server' }
  } catch {
    return { ok: false, error: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

export const subscribe = (email, source, website = '') =>
  postJSON('/api/newsletter', { email, source, website })

export const sendContact = (form) => postJSON('/api/contact', form)

// What the reader sees after a successful signup, keyed by the server's `status`.
export const SUBSCRIBE_SUCCESS = {
  confirm: {
    title: 'Check your inbox.',
    body: (email) => `We sent a confirmation link to ${email}. Click it and you're on the list.`,
  },
  subscribed: {
    title: "You're in.",
    body: (email) => `The next Weekly Board goes to ${email}.`,
  },
  resent: {
    title: 'Check your inbox again.',
    body: (email) => `You'd signed up before but never confirmed, so we re-sent the link to ${email}.`,
  },
  existing: {
    title: "You're already on the list.",
    body: (email) => `${email} is subscribed. Nothing else to do.`,
  },
  unconfirmed: {
    title: 'Almost there.',
    body: (email) => `${email} signed up but hasn't confirmed yet. Find the confirmation email (check spam too) and click the link.`,
  },
  queued: {
    title: 'Got it. Your spot is saved.',
    body: (email) => `A confirmation email will follow at ${email}. Click the link in it to finish.`,
  },
}

// Error copy, keyed by the server's `error`.
export const SUBSCRIBE_ERROR = {
  empty: 'Enter your email first.',
  invalid: "That email doesn't look right. Check it and try again.",
  rejected: "We couldn't add that address. Try a different email.",
  unsubscribed: 'That address unsubscribed earlier, so it can’t be re-added from here.',
  rate: 'Too many tries from here. Give it a few minutes.',
  unavailable: 'Something went wrong on our end. Try again in a minute.',
  server: 'Something went wrong on our end. Try again in a minute.',
  network: "Couldn't reach the server. Check your connection and try again.",
}
