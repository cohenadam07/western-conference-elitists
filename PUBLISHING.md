# Publishing articles from Word

Drop a `.docx` file anywhere and run one command to publish it to the site.

```bash
npm run publish-article -- "path/to/your-article.docx"
```

That's it. The article appears at `/articles` and gets its own page at
`/articles/<slug>`, using the site's navbar, footer, fonts, and colors.

## What gets pulled out of the document automatically

| Field       | How it's derived                                                        |
| ----------- | ----------------------------------------------------------------------- |
| **Title**   | The first Heading, or the first fully-bold line                         |
| **Author**  | A short name line above the title (falls back to the site founder)      |
| **Excerpt** | The first real paragraph, trimmed                                        |
| **Images**  | Extracted to `public/articles/<slug>/` and linked in the body           |
| **Read time** | Estimated from word count (~200 wpm)                                   |
| **Date**    | Today                                                                    |
| **Slug**    | Derived from the title                                                   |

## Overriding any of it

All optional — pass a flag only when you want to override the default:

```bash
npm run publish-article -- "article.docx" \
  --category "Analytics" \
  --title    "A cleaner headline" \
  --author   "Jane Doe" \
  --excerpt  "One-sentence dek shown on the card and article header." \
  --date     "Jul 6, 2026" \
  --slug     "custom-url-slug"
```

`--category` should match one of the site sections in
`src/data/content.js` (`Draft`, `NBA`, `Team Building`, `Analytics`,
`Big Board`, `Scouting`) so it slots into the category filter. Defaults to `NBA`.

## Where things land

- **`src/data/articles/<slug>.json`** — the article's content + metadata. The
  site auto-discovers every file in this folder (no manual registration), newest
  first, and lists them ahead of the built-in demo articles.
- **`public/articles/<slug>/`** — the article's images.

To unpublish, delete those two paths for that slug.

## Preview before shipping

```bash
npm run dev        # then open the /articles/<slug> link the script printed
```

## Sending it to the newsletter

Add `--newsletter` to start a Buttondown draft for the piece at the same time.
Nothing is sent until you hit send in Buttondown:

```bash
npm run publish-article -- "article.docx" --newsletter
```

Or build the weekly digest later with `npm run newsletter-draft`. See `NEWSLETTER.md`.

## Share previews

Every published article gets its own title, dek and share card in the HTML at build
time (`scripts/lib/seo-build.mjs`), so links posted to iMessage, X, Slack or Discord
show the article instead of the homepage. To use a custom image instead of the
default card (`public/og-card.png`, 1200×630), add `"ogImage": "/articles/<slug>/img-1.png"`
to the article's JSON. New articles are added to `sitemap.xml` automatically.

## The homepage banner ("what's new")

The banner at the top of the homepage starts with what's new, then runs the standing lines. Nobody has to edit it by hand:

- **Articles** appear on their own from `src/data/articles/`, dated by `publishedAt`. An article dated ahead waits for its date.
- **Videos and Shorts** come from the channel's public YouTube feed. YouTube's feed doesn't reliably answer build servers (on launch night it returned 404 for hours), so the news run on the Mac also saves it to `public/youtube-feed.json` three times a day (`pipeline/news/youtube.py`) and commits it with `news.json` when there's a new upload. The build merges the live feed, when it answers, with that file. The homepage banner's `data-youtube` attribute shows which one this build got.
- **The next UFC card** comes from `public/ufc-savant-data.json`. It shows from a week before until fight night.
- **Product updates** come from `src/data/updates.json`. This is the one thing to remember: when an update ships that people would want to know about, add a line.

  ```json
  { "date": "2026-10-14", "product": "Basketball Savant", "version": "2.1.0", "text": "Fantasy, Teams and Lineups tabs", "href": "/basketball-savant.html" }
  ```

  - `version` is optional. Use it when the product's version number moved.
  - Use `to` for a page of the React app (`/hoops`) and `href` for a built page (`/football-savant.html`).
  - Keep the text short, with no em dashes.

The page decides what is still recent when someone opens it (`src/lib/whatsNew.js`), so lines age out on time even between builds.

| Kind | Stays up | At most |
|---|---|---|
| Articles | 30 days | 2 |
| Videos | 10 days | 2 |
| Shorts | 3 days | 1 |
| Updates | 21 days | 4 |

- At most 8 recent lines in all.
- Each line is tagged "New" for three days, then shows its date.
- `npm run check:whats-new` tests the rules.
