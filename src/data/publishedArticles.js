// Auto-loads every published article dropped into ./articles/*.json by the
// `npm run publish-article` command. No manual registration needed — add a
// JSON file (or run the publish script) and it shows up here.
const modules = import.meta.glob('./articles/*.json', { eager: true })

export const PUBLISHED_ARTICLES = Object.values(modules)
  .map((m) => m.default)
  // Newest first. publishedAt is an ISO stamp written by the publish script.
  .sort((a, b) => new Date(b.publishedAt || b.date) - new Date(a.publishedAt || a.date))
