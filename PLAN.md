# wcehoops.com — Overnight Redesign Plan

**Branch:** `redesign-overnight` · **Do not merge/deploy until reviewed.**

## What I found

- **Stack:** Vite 8 + React 19 + React Router 7 + Tailwind CSS 4 (`@theme` tokens in `src/index.css`). 9 routes, all content driven by `src/data/content.js` (untouched by this redesign).
- **Brand mismatch:** the committed source still uses an older identity (Source Serif 4 / Inter / JetBrains Mono, a `#1c3f6e` "ember" palette) — but the *deployed* site (`dist/`, built from source that was never committed) and the Basketball Savant tool already use the real brand: navy `#22395A`, gold `#C2A263`, red `#BC3A2C`, paper `#ECEBE8`, ink `#191B1F`, Newsreader / IBM Plex Sans / IBM Plex Mono. This redesign brings the source up to (and past) that brand, in git, on a branch.
- **Brand assets** (WCE monogram favicon.svg, favicon-32/192.png, apple-touch-icon.png, wce-logo-512.png) exist only in `dist/` — they'll be copied into `public/` so they're versioned and served.
- **Basketball Savant** (`public/basketball-savant.html`, sha256 `da0e100f…`) is finished and off-limits. Verified byte-identical at the end.
- No article images exist in the data — hero/card "image treatment" will be a crafted editorial court-lines graphic (SVG, navy/gold), not stock photos.

## Design direction

Credible NBA publication: strong Newsreader headline hierarchy, mono kickers (section · date), generous whitespace, the gold 3px underline as the signature accent, navy reserved for surfaces/CTAs, red only for live/breaking markers. Motion is restrained: one-time scroll reveals, staggered nav/mobile-menu entrances, micro-interactions — all `prefers-reduced-motion` safe. No layout shift.

## Staged execution (one commit per stage)

1. **Foundations** — brand assets into `public/`; `index.html` fonts (Newsreader/IBM Plex) + full favicon/OG/Twitter/theme-color meta; rewrite `src/index.css` design tokens (paper/ink/navy/gold/red palette, type scale, utilities: kicker, gold rule, card hover, prose, reveal keyframes); migrate every component/page off the old token names so the site runs correctly end-to-end.
2. **Header & footer** — refined sticky nav (hairline + blur on scroll, gold-underline active state), WCE monogram logo, polished mobile menu with staggered motion; consistent editorial footer.
3. **Homepage** — featured-piece hero (large Newsreader headline, mono kicker, court-lines art), refined ticker, scannable content grid, navy **Basketball Savant flagship band** (links to the untouched tool), draft spotlight, newsletter.
4. **Reading experience** — ArticleDetail: ~68ch measure, comfortable rhythm, gold-rule pull-quote, figure/caption styles, share affordances; Articles index + News wire polish.
5. **Components & remaining pages** — Button, SectionHeading, ArticleCard, ProspectCard, NewsletterCTA, YearSelector; Draft, Rankings, Podcasts, About, Contact brought onto the system.
6. **Motion** — `Reveal` (IntersectionObserver, trigger once), on-load hero stagger, route fade, card/link micro-interactions; all gated on `prefers-reduced-motion`.
7. **Meta / SEO / perf** — per-route `<title>`/description hook, canonical OG data, font loading tuning, 404 polish, lint + production build check.
8. **Final pass** — Savant checksum verification, full route walkthrough, CHANGES.md.

## Explicitly not changing

- `public/basketball-savant.html` (byte-for-byte identical; still a full-page `<a href>` link).
- All routes, page inventory, and everything in `src/data/content.js`.
- No push, no PR, no deploy.
