# Redesign — What Changed (branch: `redesign-overnight`)

**Status: for your review. Not pushed, not deployed, no PR.** `main` is untouched.

## The short version

The source is now on the real WCE brand (it previously still had an older Inter/Source-Serif design — the navy/gold identity only existed in the deployed `dist/` build, whose source was never committed). On top of that: a featured-piece hero, a navy Basketball Savant flagship band, a proper long-form article template, refined nav/footer, restrained motion, and per-route SEO. Eight commits, one per stage — reviewable with `git log --oneline main..redesign-overnight`.

## By area

- **Design system** (`src/index.css`, `index.html`) — Tailwind theme tokens: paper `#ECEBE8`, ink `#191B1F`, navy `#22395A`, gold `#C2A263` (+ `gold-deep #96793F` where gold must pass contrast as text), red `#BC3A2C`, and a semantic green for grades/strengths. Fonts: Newsreader (headlines), IBM Plex Sans (body), IBM Plex Mono (kickers/stats). Signature utilities: `.rule-gold` (3px gold rule), `.kicker`, card hover, reveal/rise keyframes. Full favicon set, apple-touch-icon, theme-color, OpenGraph/Twitter cards (brand assets copied from `dist/` into `public/` so they're versioned).
- **Header/nav** — sticky, hairline + blur once scrolled, mono uppercase links, active page marked by the 3px gold underline, Basketball Savant presented as a product pill with external-link arrow, Subscribe CTA. Mobile menu animates open with staggered links and now closes on route change (the old version only closed on mount — a real bug). Skip-to-content link added.
- **Footer** — navy-deep editorial footer, gold top rule, real social icons, nav/category columns, and a Basketball Savant column.
- **Homepage** — ticker (refined: gold markers, pauses on hover); hero is the featured piece (mono kicker with section · date, large Newsreader headline, court-lines figure card); Fresh Analysis grid; **navy Savant flagship band** with feature chips, percentile-profile graphic, and launch CTA; draft spotlight; board preview; ruled "Why WCE" pillars; newsletter.
- **Article page** — ~68ch measure, serif lede, drop cap, gold-rule pull quote, figure with FIG-numbered caption, byline block, share row (X / email / copy-link with "Copied" feedback), category cross-link, related pieces.
- **Listing pages** — shared `PageHeader` masthead and `FilterChips` on News, Articles, Podcasts, Draft, Rankings; designed empty states everywhere; News/Podcast items get serif headlines.
- **Motion** — `Reveal` (IntersectionObserver, one-time, no layout shift), hero on-load stagger, route fade. Everything is disabled under `prefers-reduced-motion`, and base states stay visible if animations never run.
- **SEO** — `usePageMeta` sets per-route title/description (+OG/Twitter mirrors); articles use their own title/excerpt; `robots.txt` added.
- **404** — court-lines backdrop, "Turnover" kicker, CTAs home and to the board.
- New components: `CourtLines`, `Reveal`, `PageHeader`, `FilterChips`, `usePageMeta`; `Logo` gains a `light` variant for navy surfaces.

## Deliberately left alone

- **`public/basketball-savant.html` — byte-for-byte identical** (sha256 `da0e100f…` verified before and after). Still linked as a full page from nav, footer, and the homepage band.
- All routes and page inventory; **all content in `src/data/content.js`** (one exception: fixed "on-court evidence" in About.jsx after the token rename briefly turned it into "on-gold evidence" — caught and corrected in the same session).
- Build tooling, dependencies (nothing added), README.

## Risks / notes

- The old `ember/bone/surface` token names are gone; anything unmerged that references them would need the new names (paper/ink/navy/gold/etc.).
- Grade colors use a muted green that isn't in the four-color brand spec — deliberate (strength/weakness semantics), easy to swap if you want strict brand-only.
- Social links in `content.js` still point to `#`; share buttons use the real page URL and work.
- Screenshot-verified at 1440px and 390px on every route; `npm run lint` and `npm run build` clean.

## Preview

A dev server is already running — open **http://localhost:5173/** (your original one; extra instances from earlier sessions are on 5174/5175 — all serve this working tree). If none is alive: `npm run dev`. You're already on the `redesign-overnight` branch.

## Publish (when you approve)

1. `git checkout main && git merge redesign-overnight`
2. `npm run build` — output lands in `dist/` (this also refreshes the stale `dist/` from the previous uncommitted deploy)
3. Deploy `dist/` however wcehoops.com is hosted today, then `git push`.

If you want changes first, leave notes and keep everything on this branch.
