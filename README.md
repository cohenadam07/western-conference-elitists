# Western Conference Elitists

Premium NBA media site — draft scouting, prospect rankings, and league-wide analysis. Built with React, React Router, and Tailwind CSS v4.

## Run it

```bash
cd website
npm install
npm run dev
```

Open the printed `localhost` URL. For a production build:

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally
```

Requires Node 18+.

## File structure

```
website/
  index.html              # document shell, fonts, meta tags
  src/
    main.jsx              # React root + BrowserRouter
    App.jsx                # layout shell + route table
    index.css              # Tailwind import + design tokens (@theme) + global styles
    data/
      content.js           # ALL site copy: prospects, articles, news items, newsletter, founder, socials
    components/
      Logo.jsx
      Button.jsx           # primary/secondary/ghost button variants
      Navbar.jsx            # sticky nav + mobile menu
      Footer.jsx
      SectionHeading.jsx    # eyebrow + title + subtitle pattern used on every section
      ArticleCard.jsx       # featured + standard variants
      ProspectCard.jsx
      NewsletterCTA.jsx
      ScrollToTop.jsx       # resets scroll on route change
    pages/
      Home.jsx
      News.jsx              # short-form wire/headlines feed, distinct from long-form Analysis
      About.jsx
      Draft.jsx             # draft hub + featured prospect + filterable pool
      Rankings.jsx          # big board, expandable rows
      Articles.jsx          # search + category filter
      ArticleDetail.jsx     # /articles/:slug
      Contact.jsx
      NotFound.jsx
```

## Customizing content

Almost everything you'll want to change on day one lives in **`src/data/content.js`**:

- `PROSPECTS` — array of prospect objects (rank, name, school, measurements, strengths/weaknesses, projection, comp). The Draft, Rankings, and Home pages all read from this array, so editing it updates the whole site. `SPOTLIGHT_PROSPECT` controls the "Draft Spotlight" / "Featured Prospect" sections and is just `PROSPECTS[0]` — reorder the array or change the export to feature someone else.
- `ARTICLES` — array of article objects (slug, title, category, excerpt, date, readTime). `FEATURED_ARTICLE` is `ARTICLES[0]`. Add a new article by adding an object here; it automatically shows up in `/articles`, category filters, and search. Article detail pages route by `slug` — `ArticleDetail.jsx` currently renders shared placeholder body paragraphs for every slug, so when you have real long-form copy, give each article a `body: [...]` array of paragraphs and swap the placeholder `BODY` constant for `article.body`.
- `NEWS_ITEMS` — array of short wire-style items (headline, category, timestamp, blurb) for the `/news` page. This is the fast-hit feed; `ARTICLES` is the long-form one. Add an item and it shows up immediately, filterable by category.
- `CATEGORIES` — the tag list used for filter pills on `/articles`, `/news`, and the footer. Add/remove categories here and the filters update automatically.
- `NEWSLETTER_COPY`, `FOUNDER`, `SOCIALS` — newsletter section copy, About page founder card, and footer/contact social links (currently `href: '#'` placeholders — point these at real profiles).

### Visual identity

Colors, fonts, and a few reusable effects are defined as design tokens in **`src/index.css`** under `@theme`. Change a hex value there (e.g. `--color-ember`) and it updates everywhere that uses `text-ember`, `bg-ember`, etc. — token names describe their *original* role, not necessarily their current hue (e.g. `--color-ember` is the primary navy brand accent, not orange; `--color-ink`/`--color-bone` are the light page background and dark body text, "ink on paper"). Headlines use Source Serif 4 (`text-display`) for an editorial, newspaper-style feel, body copy uses Inter, and stat/timestamp figures use JetBrains Mono (`font-mono-tight`) — all loaded via Google Fonts in `index.html`. The semantic accents are: `ember` (navy, primary brand/links/buttons), `court` (gold, secondary highlights/B-tier grades), `arena` (forest green, positive/strengths), `foul` (crimson, negative/weaknesses/breaking-news ticker).

### Adding a page

Create a new file in `src/pages/`, add a `<Route>` for it in `App.jsx`, and add a link in `Navbar.jsx`'s `LINKS` array (and `Footer.jsx` if it should appear there too).

### Forms

The newsletter and contact forms are currently client-side only (they just flip to a "submitted" state). Wire them to a real provider by replacing the `handleSubmit` functions in `NewsletterCTA.jsx` and `Contact.jsx` with calls to your email/CRM API of choice (Mailchimp, ConvertKit, Resend, a serverless function, etc).
