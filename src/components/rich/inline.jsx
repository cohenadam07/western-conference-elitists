// A small inline-markdown renderer for article prose: **bold**, *italic* and [links](url).
// Article bodies are written by the site owner, so this only has to handle those three.
import { Fragment } from 'react'

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g

export function Inline({ md }) {
  if (!md) return null
  const parts = String(md).split(TOKEN)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
    if (link) {
      const external = /^https?:/.test(link[2]) && !link[2].includes('wcehoops.com')
      return (
        <a key={i} href={link[2]} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
          {link[1]}
        </a>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}

// Plain text of a markdown string (for headings, labels and the SEO body).
export function plain(md) {
  return String(md || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}
