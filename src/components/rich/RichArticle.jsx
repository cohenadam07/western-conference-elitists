// A rich article: the body is a list of blocks in public/articles/<slug>/body.json, with chart
// data beside it in public/articles/<slug>/data/. Loaded lazily from ArticleDetail, so none of
// this (KaTeX included) reaches a reader who never opens one of these pieces.
import { useEffect, useMemo } from 'react'
import 'katex/dist/katex.min.css'
import './rich.css'
import { useJson } from './charts/kit.jsx'
import { Argue, Checklist, Clip, H2, H3, HowTo, List, MathBox, P, Quote, Stats, Table, Tex, Toc, Video } from './blocks.jsx'
import UsageBuilder from './charts/UsageBuilder.jsx'
import Scatter from './charts/Scatter.jsx'
import Distance from './charts/Distance.jsx'
import Projector from './charts/Projector.jsx'
import Trend from './charts/Trend.jsx'
import SpacingCourt from './charts/SpacingCourt.jsx'
import PlayTypes from './charts/PlayTypes.jsx'
import PairMatrix from './charts/PairMatrix.jsx'
import LineupExplorer from './charts/LineupExplorer.jsx'
import Shrink from './charts/Shrink.jsx'
import LineupLab from './charts/LineupLab.jsx'

const CHARTS = {
  usage: UsageBuilder,
  scatter: Scatter,
  distance: Distance,
  projector: Projector,
  trend: Trend,
  spacing: SpacingCourt,
  playtypes: PlayTypes,
  pairs: PairMatrix,
  lineups: LineupExplorer,
  shrink: Shrink,
  lab: LineupLab,
}

export default function RichArticle({ article }) {
  const base = `/articles/${article.slug}`
  const { data: body, error } = useJson(`${base}/body.json`)
  const toc = useMemo(() => (body ? body.blocks.filter((b) => b.t === 'h2' && b.id) : []), [body])

  // Arriving on /articles/<slug>#section: scroll once the body has rendered.
  useEffect(() => {
    if (!body || !window.location.hash) return
    const el = document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
    if (el) el.scrollIntoView()
  }, [body])

  if (error) {
    return <p className="rich-p">This piece didn't load. Refresh the page to try again.</p>
  }
  if (!body) return <div className="rich-loading" aria-busy="true">Loading the full piece…</div>

  const posters = body.posters || {}
  const render = (b, i) => {
    switch (b.t) {
      case 'p': return <P key={i} md={b.md} />
      case 'h2': return <H2 key={i} {...b} />
      case 'h3': return <H3 key={i} text={b.text} />
      case 'argue': return <Argue key={i} {...b} render={render} />
      case 'math': return <MathBox key={i} {...b} render={render} />
      case 'tex': return <Tex key={i} tex={b.tex} html={b.html} />
      case 'list': return <List key={i} {...b} />
      case 'table': return <Table key={i} {...b} />
      case 'stats': return <Stats key={i} items={b.items} />
      case 'quote': return <Quote key={i} md={b.md} />
      case 'clip': return <Clip key={i} {...b} poster={b.poster ? `${base}/${b.poster}` : posters[`${b.start}`] ? `${base}/${posters[`${b.start}`]}` : undefined} />
      case 'video': return <Video key={i} {...b} />
      case 'howto': return <HowTo key={i} />
      case 'toc': return <Toc key={i} items={toc} />
      case 'checklist': return <Checklist key={i} items={b.items} />
      case 'chart': {
        const Chart = CHARTS[b.kind]
        if (!Chart) return null
        return <Chart key={i} base={`${base}/data`} title={b.title} caption={b.caption} source={b.source} {...b.props} />
      }
      default: return null
    }
  }
  return <div className="rich-body">{body.blocks.map(render)}</div>
}
