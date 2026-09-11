# The Weekly Board — newsletter + contact form

Both forms on the site now do real work.

| What | Where it goes |
|---|---|
| Newsletter signups (home, articles, contact page, `/newsletter`) | **Buttondown**, with its double opt-in confirmation email |
| Contact form messages | **Upstash**, readable at **`/inbox`**. Optionally also emailed to you (Resend) |
| Signups Buttondown can't take right now (no key yet, outage) | Held in Upstash, then pushed from `/inbox` with one click |

## One-time setup (about 10 minutes)

### 1. Buttondown
1. Create an account at buttondown.com and pick your newsletter username
   (the public archive lives at `buttondown.com/<username>`).
2. **Settings → Basics:** set the newsletter name to *The Weekly Board* and the
   sender name to *Western Conference Elitists*.
3. Leave **double opt-in on** (it's the default). New signups get a confirmation
   email and nothing else until they click it. That keeps the list clean and
   your emails out of spam.
4. If Buttondown asks for a mailing address for the email footer, that's the
   US anti-spam law requirement. A PO box or virtual mailbox is fine.
5. Copy your API key from **Settings → API** (buttondown.com/requests).

### 2. Vercel → Project → Settings → Environment Variables (Production)

| Variable | Value | Required? |
|---|---|---|
| `BUTTONDOWN_API_KEY` | the key from step 1.5 | **Yes** |
| `BUTTONDOWN_USERNAME` | your Buttondown username | Recommended. Powers the "Full archive" and resubscribe links |
| `ANALYTICS_DASHBOARD_PASSWORD` | already set | Already there. `/inbox` uses the same password as `/analytics` |
| `RESEND_API_KEY` | from resend.com → API Keys | Optional. Emails you a copy of each contact message |
| `CONTACT_NOTIFY_TO` | the email you signed up to Resend with | Required if you set `RESEND_API_KEY` |

Upstash (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) is already on the project.

**Redeploy** after adding variables. Vercel only reads them at deploy time.

About Resend: without verifying a domain, Resend only delivers from
`onboarding@resend.dev` to the address your Resend account uses. That's all this
needs. Hitting Reply in your mail app answers the person who wrote in, because
Reply-To is set to their address. If you skip Resend, remove the Resend line from
the "Who else touches your data" section of `src/pages/Privacy.jsx`.

### 3. Check it
1. Open `/inbox`, then the **Newsletter** tab. All three setup dots should be green
   (the email-copies one only if you set up Resend).
2. Subscribe on the home page with a real address of yours. You should get
   Buttondown's confirmation email within a minute.
3. Send yourself a message through `/contact`. It shows up in `/inbox`.

## Writing and sending an issue

```bash
npm run newsletter-draft                      # digest of everything published in the last 7 days
npm run newsletter-draft -- --days 14         # wider window
npm run newsletter-draft -- <slug>            # a single-article feature issue
npm run newsletter-draft -- --dry-run         # preview locally, nothing sent
npm run publish-article -- piece.docx --newsletter   # publish + draft in one go
```

These scripts read `BUTTONDOWN_API_KEY` from `.env.local` in the repo root
(gitignored, so it never gets committed):

```
BUTTONDOWN_API_KEY=your-key-here
```

The script only ever creates a **draft**. Open Buttondown → Emails → Drafts,
replace the `[Your intro…]` line, edit, and send from there. Sent issues show up
on `/newsletter` within about 15 minutes.

## Where signups came from

Each subscriber carries `utm_campaign` set to where they signed up: `home`,
`article`, `contact`, `newsletter-page`, or `contact-form` for the checkbox on
the contact form. Buttondown shows it on the subscriber, so you can see which
placement works.

## If something breaks

- **Buttondown is down or the key is wrong:** readers still see a success
  message, and their address waits in `/inbox` → Newsletter → *Held signups*.
  Fix the key and hit **Push to Buttondown**.
- **Upstash is down:** signups still go straight to Buttondown. The rate limit
  just switches off. A contact message still gets through if Resend is set up;
  if neither works, the sender sees an honest error and keeps their text.
- **Guard rails:** each IP gets 6 signups and 4 contact messages per 10 minutes.
  A "please confirm" reminder goes to the same address at most once a day. After
  10 wrong passwords on `/inbox`, that IP is locked out for 10 minutes.
- **Tests:** `npm run check:forms` runs 49 checks against fake versions of
  Buttondown, Upstash and Resend. No keys or network needed.

## Files

- `api/newsletter.js`: subscribe, public archive, admin health, and the push for held signups
- `api/contact.js`: store messages, notify you, and the inbox list/read/delete
- `api/_forms.js`: shared helpers (Buttondown client, rate limit, held-signup queue, Resend)
- `src/components/SubscribeForm.jsx`: the one real signup form, used everywhere
- `src/pages/Newsletter.jsx`, `Privacy.jsx`, `Inbox.jsx`, `Contact.jsx`
- `scripts/newsletter-draft.mjs`, `scripts/lib/newsletter.mjs`
- `tools/forms/`: the regression checks and their fakes

This adds two serverless functions (9 in total on main, 10 once Front Office's
`api/gm.js` ships). The Vercel Hobby plan caps a deployment at 12.

When Front Office ships, add it to the "Games and tools" section of the privacy
page: it backs career saves up to the server (`api/gm.js`).
