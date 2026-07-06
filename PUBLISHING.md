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
