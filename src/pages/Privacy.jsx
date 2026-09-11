import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader.jsx'
import usePageMeta from '../lib/usePageMeta.js'

// Update this date whenever the substance below changes.
const UPDATED = 'September 11, 2026'

function Section({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-10">
      <h2 className="text-display text-2xl text-ink sm:text-[28px]">{title}</h2>
      <div className="mt-4 space-y-4 text-[15.5px] leading-[1.75] text-muted [&_a]:font-medium [&_a]:text-navy [&_a]:underline [&_a]:underline-offset-2 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  )
}

export default function Privacy() {
  usePageMeta('Privacy Policy', 'What wcehoops.com collects, why, who else touches it, and how to get it removed.')

  return (
    <div>
      <PageHeader
        eyebrow="Privacy"
        title="Privacy Policy"
        lede="What this site collects, why, and how to get it removed. Short on purpose."
      />

      <div className="mx-auto max-w-3xl px-6 py-14 lg:px-10 lg:py-20">
        <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-faint">Last updated {UPDATED}</p>

        <div className="mt-8 rounded-md border border-line bg-surface p-7">
          <h2 className="kicker text-navy">The short version</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
            <li>No ads, no ad trackers, no selling or renting your information. Ever.</li>
            <li>If you subscribe, we hold your email address so we can send you the newsletter.</li>
            <li>If you message us, we keep what you wrote so we can read it and reply.</li>
            <li>Site analytics are counts only. No cookies, no profile of you.</li>
            <li>Want something deleted? Ask and it's gone.</li>
          </ul>
        </div>

        <div className="mt-12 space-y-12">
          <Section id="newsletter" title="The newsletter">
            <p>
              When you subscribe to The Weekly Board we collect your <strong>email address</strong>, the page you
              signed up from, and your <strong>IP address</strong>. The IP address goes to our newsletter provider
              so it can screen out spam signups, and it's kept with your subscription there.
            </p>
            <p>
              The list lives with <strong>Buttondown</strong>, which stores it and delivers each issue. New signups get
              a confirmation email first, and nothing else is sent until you click it. Buttondown may record whether
              an issue was opened or a link was clicked, which tells us what's worth writing more of.
            </p>
            <p>
              If Buttondown can't take a signup right away (during an outage, say), we hold your email address and
              the page you signed up from in our own database until it can, then remove it from there.
            </p>
            <p>
              Every issue has an unsubscribe link. One click and you're off the list.
            </p>
          </Section>

          <Section id="contact" title="The contact form">
            <p>
              Messages sent through the <Link to="/contact">contact form</Link> include your <strong>name</strong>,{' '}
              <strong>email address</strong>, the reason you picked, and your message, plus the country the message
              was sent from. We keep that in our database so we can read it and reply, and we may get a copy by
              email. We keep messages until we delete them, and we don't use them for anything except answering you.
            </p>
            <p>
              If you tick "Also send me The Weekly Board," your email is added to the newsletter list as described
              above, confirmation email included.
            </p>
          </Section>

          <Section id="analytics" title="Analytics">
            <p>
              We use <strong>Vercel Web Analytics</strong> to count page views. It doesn't use cookies and doesn't
              follow you across other sites. What we see is aggregate: which pages were viewed, where visitors came
              from, and rough country, device and browser breakdowns.
            </p>
          </Section>

          <Section id="games" title="Games and tools">
            <ul>
              <li>
                The games and tools (Hoops, Comp Chain, Dynasty) save progress and settings in your browser's local
                storage. Clearing your browser data removes it.
              </li>
              <li>
                Dynasty and Hoops races also keep data on our server, tied to a random ID your browser makes up
                rather than to you. It's how your rankings, lobby votes and race results get counted.
              </li>
              <li>
                Names you enter for a leaderboard, lobby or race are stored on our server and shown to other players.
                Don't use your real name if you'd rather not.
              </li>
              <li>
                Player searches in the Savant tools are counted anonymously to rank what's trending. The counts
                aren't tied to you.
              </li>
              <li>
                League lookups in Dynasty read public data from the fantasy platform you pick. We don't store the
                league, and we never ask for a password.
              </li>
            </ul>
          </Section>

          <Section id="security" title="Spam protection">
            <p>
              To stop floods of fake signups and messages, the forms use your IP address to limit how many
              submissions can come from one place. For that purpose it's kept for about ten minutes.
            </p>
          </Section>

          <Section id="providers" title="Who else touches your data">
            <p>These services run parts of the site and handle data on our behalf:</p>
            <ul>
              <li><strong>Vercel</strong> hosts the site and provides the analytics above.</li>
              <li><strong>Upstash</strong> is the database behind contact messages, held newsletter signups, leaderboards and the games.</li>
              <li><strong>Buttondown</strong> stores the newsletter list and sends the newsletter.</li>
              <li><strong>Resend</strong> emails us a copy of contact-form messages.</li>
              <li>
                <strong>Google Fonts</strong> serves the site's typefaces, which means Google sees your IP address
                when your browser loads them.
              </li>
            </ul>
            <p>We don't share your information with anyone else unless the law requires it.</p>
          </Section>

          <Section id="choices" title="Your choices">
            <ul>
              <li>Unsubscribe from the newsletter with the link at the bottom of any issue.</li>
              <li>
                To see, correct or delete anything we hold about you, <Link to="/contact">send us a message</Link>.
                We'll take care of it and confirm when it's done.
              </li>
            </ul>
          </Section>

          <Section id="kids" title="Children">
            <p>This site isn't directed at children under 13, and we don't knowingly collect their information.</p>
          </Section>

          <Section id="changes" title="Changes">
            <p>
              If this policy changes, the date at the top changes with it. If a change affects how we use your email
              address, subscribers will hear about it in the newsletter first.
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}
