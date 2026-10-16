// The non-chart pieces of a rich article: prose, headings, the argue boxes, math boxes,
// tables, stat tiles, film clips, the checklist and the table of contents.
import { useState } from 'react'
import { Inline } from './inline.jsx'
import { DataTable } from './charts/kit.jsx'

export function P({ md }) {
  return (
    <p className="rich-p">
      <Inline md={md} />
    </p>
  )
}

export function H2({ id, text, kicker }) {
  return (
    <h2 id={id} className="rich-h2">
      {kicker && <span className="rich-h2-kicker">{kicker}</span>}
      {text}
    </h2>
  )
}

export function H3({ text }) {
  return <h3 className="rich-h3">{text}</h3>
}

const SIDES = {
  case: { label: 'The case' },
  counter: { label: 'The pushback' },
  answer: { label: 'The answer' },
  verdict: { label: 'Where it lands' },
}

export function Argue({ side, title, blocks, render }) {
  const s = SIDES[side] || SIDES.case
  return (
    <section className={`rich-argue rich-argue-${side}`} aria-label={`${s.label}: ${title}`}>
      <div className="rich-argue-label">{s.label}</div>
      <h4 className="rich-argue-title">{title}</h4>
      <div className="rich-argue-body">{blocks.map(render)}</div>
    </section>
  )
}

// Formulas arrive typeset (scripts/publish-rich-article.mjs runs KaTeX at publish time).
export function Tex({ tex, html }) {
  if (!html) return <pre className="rich-tex-fallback">{tex}</pre>
  // eslint-disable-next-line react/no-danger
  return <div className="rich-tex" dangerouslySetInnerHTML={{ __html: html }} />
}

export function MathBox({ title, blocks, render }) {
  const [open, setOpen] = useState(false)
  return (
    <aside className={`rich-math${open ? ' open' : ''}`}>
      <button type="button" className="rich-math-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="rich-math-icon" aria-hidden="true">∑</span>
        <span className="rich-math-label">Show the math</span>
        <span className="rich-math-title">{title}</span>
        <span className="rich-math-chev" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="rich-math-body">{blocks.map(render)}</div>}
    </aside>
  )
}

export function Table({ caption, cols, rows, note, source, sortable }) {
  return (
    <figure className="rich-figure rich-figure-table">
      {caption && (
        <div className="rich-figure-head">
          <span className="rich-fig-kicker">Table</span>
          <h4 className="rich-figure-title">{caption}</h4>
        </div>
      )}
      <DataTable cols={cols} rows={rows} sortable={sortable} />
      {(note || source) && (
        <figcaption className="rich-figcaption">
          {note && <p>{note}</p>}
          {source && <span className="rich-source">Source: {source}</span>}
        </figcaption>
      )}
    </figure>
  )
}

export function Stats({ items }) {
  return (
    <div className="rich-stats">
      {items.map((s) => (
        <div key={s.label} className="rich-stat">
          <div className="rich-stat-value">{s.value}</div>
          <div className="rich-stat-label">{s.label}</div>
          {s.sub && <div className="rich-stat-sub">{s.sub}</div>}
        </div>
      ))}
    </div>
  )
}

export function Quote({ md }) {
  return (
    <blockquote className="rich-quote">
      <p>
        <Inline md={md} />
      </p>
    </blockquote>
  )
}

export function List({ items, ordered }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className="rich-list">
      {items.map((it, i) => (
        <li key={i}>
          <Inline md={it} />
        </li>
      ))}
    </Tag>
  )
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// Film clips play from the matching moment of the published video. A clip can also carry a
// silent loop (loop + LOOP_BASE); until loops are hosted, the YouTube moment is the clip.
export const LOOP_BASE = ''

export function Clip({ youtube, start, end, caption, poster, loop }) {
  const [playing, setPlaying] = useState(false)
  const s = Math.floor(start)
  const e = Math.ceil(end)
  if (loop && LOOP_BASE) {
    return (
      <figure className="rich-clip">
        <video className="rich-clip-video" src={`${LOOP_BASE}/${loop}`} poster={poster} autoPlay muted loop playsInline />
        <figcaption className="rich-clip-cap">{caption}</figcaption>
      </figure>
    )
  }
  return (
    <figure className="rich-clip">
      <div className="rich-clip-frame">
        {playing ? (
          <iframe
            className="rich-clip-iframe"
            src={`https://www.youtube-nocookie.com/embed/${youtube}?start=${s}&end=${e}&autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={caption}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button type="button" className="rich-clip-poster" onClick={() => setPlaying(true)} aria-label={`Play clip: ${caption}`}>
            {poster ? <img src={poster} alt="" loading="lazy" /> : <span className="rich-clip-blank" />}
            <span className="rich-clip-play" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
            </span>
            <span className="rich-clip-time">Film · {mmss(s)}–{mmss(e)}</span>
          </button>
        )}
      </div>
      <figcaption className="rich-clip-cap">{caption}</figcaption>
    </figure>
  )
}

export function Video({ youtube, title }) {
  const [playing, setPlaying] = useState(false)
  return (
    <figure className="rich-video">
      <div className="rich-clip-frame">
        {playing ? (
          <iframe
            className="rich-clip-iframe"
            src={`https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button type="button" className="rich-clip-poster" onClick={() => setPlaying(true)} aria-label={`Play: ${title}`}>
            <img src={`https://i.ytimg.com/vi/${youtube}/maxresdefault.jpg`} alt="" loading="lazy" />
            <span className="rich-clip-play big" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
            </span>
            <span className="rich-clip-time">{title}</span>
          </button>
        )}
      </div>
    </figure>
  )
}

export function HowTo() {
  return (
    <aside className="rich-howto" aria-label="How to read this piece">
      <p className="rich-howto-head">How to read this</p>
      <ul>
        <li><span className="dot case" />Every section makes <strong>the case</strong>,</li>
        <li><span className="dot counter" />gives it <strong>the pushback</strong> at full strength,</li>
        <li><span className="dot answer" />answers the pushback,</li>
        <li><span className="dot verdict" />and says <strong>where it lands</strong>.</li>
      </ul>
      <p className="rich-howto-foot">
        <span className="rich-math-icon" aria-hidden="true">∑</span> boxes open the math. Charts move. Clips play from the video at the right moment.
      </p>
    </aside>
  )
}

export function Toc({ items }) {
  return (
    <nav className="rich-toc" aria-label="Contents">
      <p className="rich-toc-head">Contents</p>
      <ol>
        {items.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`}>
              {h.kicker && <span className="rich-toc-k">{h.kicker}</span>}
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function Checklist({ items }) {
  return (
    <div className="rich-check">
      {items.map((it, i) => (
        <div key={i} className="rich-check-row">
          <div className="rich-check-num">{String(i + 1).padStart(2, '0')}</div>
          <div className="rich-check-main">
            <div className="rich-check-metric">{it.metric}</div>
            <div className="rich-check-target">
              <span className="k">Target</span> {it.target}
              <span className="sep" aria-hidden="true">·</span>
              <span className="k">Last season</span> {it.baseline}
            </div>
            <p className="rich-check-why">{it.why}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
