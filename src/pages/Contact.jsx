import { useState } from 'react'
import SectionHeading from '../components/SectionHeading.jsx'
import NewsletterCTA from '../components/NewsletterCTA.jsx'
import { SOCIALS } from '../data/content.js'

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', reason: 'General', message: '' })
  const [sent, setSent] = useState(false)

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setSent(true)
  }

  return (
    <div>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-24">
          <span className="font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-ember">
            Get In Touch
          </span>
          <h1 className="text-display mt-4 max-w-3xl text-4xl text-bone sm:text-5xl lg:text-6xl">
            Tell us where the board is wrong.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-bone-dim">
            Writing pitches, scouting disagreements, partnership ideas, or
            just a take you want to argue about — this is where it goes.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <SectionHeading eyebrow="Contact Form" title="Send Us a Message" />
            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-mute">
                    Name
                  </label>
                  <input
                    required
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className="mt-2 w-full rounded-sm border border-line bg-surface-2 px-4 py-3 text-sm text-bone placeholder:text-mute focus:border-ember focus:outline-none"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-mute">
                    Email
                  </label>
                  <input
                    required
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    className="mt-2 w-full rounded-sm border border-line bg-surface-2 px-4 py-3 text-sm text-bone placeholder:text-mute focus:border-ember focus:outline-none"
                    placeholder="you@email.com"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-mute">
                  Reason
                </label>
                <select
                  name="reason"
                  value={form.reason}
                  onChange={handleChange}
                  className="mt-2 w-full rounded-sm border border-line bg-surface-2 px-4 py-3 text-sm text-bone focus:border-ember focus:outline-none"
                >
                  <option>General</option>
                  <option>Writing / Contributor Pitch</option>
                  <option>Consulting / Scouting Work</option>
                  <option>Partnership / Collaboration</option>
                  <option>Press / Media</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-mute">
                  Message
                </label>
                <textarea
                  required
                  rows={5}
                  name="message"
                  value={form.message}
                  onChange={handleChange}
                  className="mt-2 w-full rounded-sm border border-line bg-surface-2 px-4 py-3 text-sm text-bone placeholder:text-mute focus:border-ember focus:outline-none"
                  placeholder="What's on your mind?"
                />
              </div>

              <button
                type="submit"
                className="w-fit rounded-sm bg-ember px-8 py-3 text-sm font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-ember-dim"
              >
                {sent ? 'Message Sent' : 'Send Message'}
              </button>
            </form>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-md border border-line bg-surface-2 p-8">
              <h3 className="text-lg font-bold text-bone">Writing & Consulting</h3>
              <p className="mt-3 text-sm leading-relaxed text-bone-dim">
                We work with select front offices, media partners, and
                contributors on scouting consulting and freelance analysis.
                If that's you, say so in the reason field above.
              </p>
            </div>
            <div className="rounded-md border border-line bg-surface-2 p-8">
              <h3 className="text-lg font-bold text-bone">Follow the Board</h3>
              <p className="mt-3 text-sm leading-relaxed text-bone-dim">
                Real-time prospect notes and board movement happen on social
                before they make it into a full article.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                {SOCIALS.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    className="underline-grow w-fit text-sm font-medium text-bone-dim hover:text-bone"
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
        <NewsletterCTA />
      </section>
    </div>
  )
}
