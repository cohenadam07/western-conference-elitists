// Renders the HTML body produced by the publish-article pipeline. The markup is
// authored by the site owner (from their own Word docs), so it's trusted — we
// style it via the .article-body scope in index.css to match the site's voice.
export default function ArticleBody({ html }) {
  return (
    <div
      className="article-body mt-10"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
