import { useState } from 'react'
import SectionHeading from '../components/SectionHeading.jsx'
import NewsletterCTA from '../components/NewsletterCTA.jsx'
import PageHeader from '../components/PageHeader.jsx'
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
      <PageHeader
        eyebrow="Get In Touch"
        title="Tell us where the board is wrong."
        lede="Writing pitches, scouting disagreements, partnership ideas, or just a take you want to argue about — this is where it goes."
      />

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <SectionHeading eyebrow="Contact Form" title="Send Us a Message" />
            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="contact-name" className="kicker text-muted">
                    Name
                  </label>
                  <input
                    required
                    id="contact-name"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className="mt-2 w-full rounded-sm border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-faint focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
                    placeholder="Your name"
                  />
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
                    value={form.email}
                    onChange={handleChange}
                    className="mt-2 w-full rounded-sm border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-faint focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
                    placeholder="you@email.com"
                  />
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
                  className="mt-2 w-full rounded-sm border border-line bg-surface px-4 py-3 text-sm text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
                >
                  <option>General</option>
                  <option>Writing / Contributor Pitch</option>
                  <option>Consulting / Scouting Work</option>
                  <option>Partnership / Collaboration</option>
                  <option>Press / Media</option>
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
                  value={form.message}
                  onChange={handleChange}
                  className="mt-2 w-full rounded-sm border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-faint focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
                  placeholder="What's on your mind?"
                />
              </div>

              <button
                type="submit"
                className="w-fit rounded-sm bg-navy px-8 py-3 font-mono text-[12.5px] font-medium uppercase tracking-[0.12em] text-white transition-all duration-300 hover:-translate-y-px hover:bg-navy-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep"
              >
                {sent ? 'Message Sent' : 'Send Message'}
              </button>
            </form>
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
        <NewsletterCTA />
      </section>
    </div>
  )
}
