import { useEffect, useState } from 'react'

// The homepage landing gateway: one card per destination, each rendered in that
// page's own visual identity. Styles live in index.css under the `.gw` scope;
// keyframes are `gw-` prefixed. A skeleton shows on mount and reveals once fonts
// are ready, so the section opens clean with no font-swap flash or layout jump.
function Skeleton() {
  return (
    <div className="sk" aria-hidden="true">
      <span className="sk-v" />
      <span className="sk-b sk-b1" />
      <span className="sk-b sk-b2" />
    </div>
  )
}

export default function Gateway() {
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    let done = false
    const reveal = () => {
      if (done) return
      done = true
      setBooting(false)
    }
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => setTimeout(reveal, 260))
    } else {
      setTimeout(reveal, 260)
    }
    const safety = setTimeout(reveal, 1600) // never stay on the skeleton
    return () => clearTimeout(safety)
  }, [])

  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10 lg:py-16">
        <div className={`gw${booting ? ' booting' : ''}`}>
          <header className="hero">
            <div className="hero-top">
              <span className="badge">WCE</span>
              <span className="hero-eyebrow">Western Conference Elitists · NBA</span>
            </div>
            <h1 className="hero-title">
              Watch the film.<br />
              <em>Trust the model.</em>
            </h1>
            <p className="hero-tag">
              Analysis, scouting, and the tools behind them — built for people who actually watch the
              games. Pick your entry point.
            </p>
            <div className="hero-rule">
              <span className="k">Explore</span>
              <span className="r" />
            </div>
          </header>

          <div className="grid">
            {/* Basketball Savant */}
            <a className="card c-savant span2" href="/basketball-savant.html">
              <Skeleton />
              <div className="viz">
                <div className="bars">
                  <div className="bar"><i /></div>
                  <div className="bar"><i /></div>
                  <div className="bar"><i /></div>
                  <div className="bar"><i /></div>
                </div>
              </div>
              <div className="meta">
                <span className="ck">Tool · Analytics</span>
                <h3>Basketball Savant</h3>
                <p>Every player, every season back to 1979-80 — percentile sliders, shot charts, and comps.</p>
                <span className="go">Open ↗</span>
              </div>
            </a>

            {/* Draft Savant */}
            <a className="card c-draft span2" href="/draft-savant.html">
              <Skeleton />
              <div className="viz">
                <div className="rows">
                  <div className="drow"><span className="pb">1</span><span className="nm" /></div>
                  <div className="drow"><span className="pb">2</span><span className="nm" /></div>
                  <div className="drow"><span className="pb">3</span><span className="nm" /></div>
                </div>
              </div>
              <div className="meta">
                <span className="ck">Tool · Draft</span>
                <h3>Draft Savant</h3>
                <p>Prospect models and the full board, every class back to 2010.</p>
                <span className="go">Open ↗</span>
              </div>
            </a>

            {/* Football Savant — the NFL sibling of the tool above. Its own palette on
                purpose: this card is the one place on a paper-white site that shows the
                film-room ground the tool actually lives on. */}
            <a className="card c-fball span2" href="/football-savant.html">
              <Skeleton />
              <div className="viz">
                <svg className="field" viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                  <defs>
                    <pattern id="gwMow" width="100" height="150" patternUnits="userSpaceOnUse">
                      <rect width="50" height="150" fill="rgba(255,255,255,0.035)" />
                    </pattern>
                  </defs>
                  <rect width="600" height="150" fill="url(#gwMow)" />
                  <g className="yard">
                    <path d="M25 0V150M75 0V150M125 0V150M175 0V150M225 0V150M275 0V150M325 0V150M375 0V150M425 0V150M475 0V150M525 0V150M575 0V150" />
                    <path className="hash" d="M25 46h8M75 46h8M125 46h8M175 46h8M225 46h8M275 46h8M325 46h8M375 46h8M425 46h8M475 46h8M525 46h8M575 46h8M25 104h8M75 104h8M125 104h8M175 104h8M225 104h8M275 104h8M325 104h8M375 104h8M425 104h8M475 104h8M525 104h8M575 104h8" />
                  </g>
                  <g className="nums">
                    <text x="100" y="140">1 0</text><text x="200" y="140">3 0</text><text x="300" y="140" className="fifty">5 0</text><text x="400" y="140">3 0</text><text x="500" y="140">1 0</text>
                  </g>
                  <g className="lattice">
                    <rect x="300" y="14" width="88" height="28" /><rect x="390" y="14" width="88" height="28" /><rect x="480" y="14" width="88" height="28" />
                    <rect x="300" y="44" width="88" height="28" /><rect x="390" y="44" width="88" height="28" className="lit" /><rect x="480" y="44" width="88" height="28" />
                    <rect x="300" y="74" width="88" height="28" className="warm" /><rect x="390" y="74" width="88" height="28" /><rect x="480" y="74" width="88" height="28" />
                    <rect x="300" y="104" width="88" height="28" /><rect x="390" y="104" width="88" height="28" /><rect x="480" y="104" width="88" height="28" className="cool" />
                  </g>
                  <path className="throw" d="M60 122 Q240 6 434 58" />
                  <circle className="ball" cx="434" cy="58" r="3.4" />
                </svg>
              </div>
              <div className="meta">
                <span className="ck">Tool · Analytics</span>
                <h3>Football Savant</h3>
                <p>Every NFL player back to 1999, ranked against the men who play his position — with throw maps, run-gap maps and comps.</p>
                <span className="go">Open ↗</span>
              </div>
            </a>

            {/* UFC Savant — the arena at fight time: near-black, one red, one gold. The card
                shows the red-to-gold bar the tool is built on. */}
            <a className="card c-ufc span2" href="/ufc-savant.html">
              <Skeleton />
              <div className="viz">
                <svg className="cage" viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                  <defs>
                    <pattern id="gwMesh" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <path d="M0 7H14M7 0V14" stroke="rgba(245,243,236,0.16)" strokeWidth="0.8" />
                    </pattern>
                    <radialGradient id="gwLight" cx="0.4" cy="0" r="0.8">
                      <stop offset="0" stopColor="#D20A11" stopOpacity="0.5" />
                      <stop offset="0.55" stopColor="#D20A11" stopOpacity="0.08" />
                      <stop offset="1" stopColor="#D20A11" stopOpacity="0" />
                    </radialGradient>
                    <clipPath id="gwOct"><polygon points="299,117 235,167 145,167 81,117 81,47 145,-3 235,-3 299,47" /></clipPath>
                  </defs>
                  <rect width="600" height="150" fill="url(#gwLight)" />
                  <polygon className="mat" points="299,117 235,167 145,167 81,117 81,47 145,-3 235,-3 299,47" />
                  <rect x="60" y="-20" width="260" height="200" fill="url(#gwMesh)" clipPath="url(#gwOct)" />
                  <polygon className="rim" points="299,117 235,167 145,167 81,117 81,47 145,-3 235,-3 299,47" />
                  <polygon className="rim inner" points="286,113 230,156 150,156 94,113 94,51 150,8 230,8 286,51" />
                  <g className="body" transform="translate(392 6) scale(0.58)">
                    <circle cx="70" cy="34" r="26" className="head" />
                    <path d="M36 66h68l9 86H27z" className="torso" />
                    <path d="M30 156h34l-3 84H31z M76 156h34l-1 84H79z" className="legs" />
                  </g>
                  <g className="pcts">
                    <text x="492" y="30">62%</text><text x="492" y="78">18%</text><text x="492" y="126">20%</text>
                  </g>
                </svg>
              </div>
              <div className="meta">
                <span className="ck">Tool · Analytics</span>
                <h3>UFC Savant</h3>
                <p>Every UFC fighter since 1993, ranked against his weight class — strike maps, round curves, head-to-heads and comps.</p>
                <span className="go">Open ↗</span>
              </div>
            </a>

            {/* Dynasty Exchange — the only live, crowd-driven thing here, so it leads */}
            <a className="card c-dyn span4" href="/dynasty">
              <Skeleton />
              <div className="viz">
                <div className="grid-bg" />
                <svg viewBox="0 0 640 150" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="gwDynFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#16c784" stopOpacity="0.16" />
                      <stop offset="1" stopColor="#16c784" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path className="dfill" d="M0 118 L80 104 L160 112 L240 76 L320 88 L400 52 L480 62 L560 30 L640 38 L640 150 L0 150 Z" />
                  <g className="candles">
                    <g className="c u"><line x1="40" y1="96" x2="40" y2="126" /><rect x="34" y="104" width="12" height="16" /></g>
                    <g className="c d"><line x1="80" y1="98" x2="80" y2="122" /><rect x="74" y="102" width="12" height="14" /></g>
                    <g className="c u"><line x1="120" y1="88" x2="120" y2="118" /><rect x="114" y="94" width="12" height="18" /></g>
                    <g className="c u"><line x1="160" y1="74" x2="160" y2="104" /><rect x="154" y="80" width="12" height="20" /></g>
                    <g className="c d"><line x1="200" y1="76" x2="200" y2="100" /><rect x="194" y="80" width="12" height="12" /></g>
                    <g className="c u"><line x1="240" y1="58" x2="240" y2="92" /><rect x="234" y="64" width="12" height="22" /></g>
                    <g className="c u"><line x1="280" y1="50" x2="280" y2="76" /><rect x="274" y="56" width="12" height="14" /></g>
                    <g className="c d"><line x1="320" y1="52" x2="320" y2="84" /><rect x="314" y="58" width="12" height="20" /></g>
                    <g className="c u"><line x1="360" y1="44" x2="360" y2="78" /><rect x="354" y="50" width="12" height="20" /></g>
                    <g className="c d"><line x1="400" y1="46" x2="400" y2="70" /><rect x="394" y="50" width="12" height="12" /></g>
                    <g className="c u"><line x1="440" y1="30" x2="440" y2="66" /><rect x="434" y="36" width="12" height="24" /></g>
                    <g className="c u"><line x1="480" y1="22" x2="480" y2="50" /><rect x="474" y="28" width="12" height="16" /></g>
                    <g className="c d"><line x1="520" y1="26" x2="520" y2="58" /><rect x="514" y="32" width="12" height="18" /></g>
                    <g className="c u"><line x1="560" y1="14" x2="560" y2="46" /><rect x="554" y="20" width="12" height="20" /></g>
                    <g className="c u"><line x1="600" y1="8" x2="600" y2="34" /><rect x="594" y="12" width="12" height="16" /></g>
                  </g>
                  <circle className="dtip" cx="600" cy="12" r="4" />
                </svg>
                <div className="dtape">
                  <span>VWEMB <b>1850</b></span>
                  <span className="u">DBANE <b>1407</b> ▲</span>
                  <span className="d">SBARN <b>1716</b> ▼</span>
                  <span className="u">WKESS <b>1362</b> ▲</span>
                </div>
              </div>
              <div className="meta">
                <span className="ck">Live · Crowd-priced</span>
                <h3>Dynasty Exchange</h3>
                <p>A dynasty board priced by the people who argue about it. Rank four players and move the market — or paste your roster and see what it is worth.</p>
                <span className="go">Enter ↗</span>
              </div>
            </a>

            {/* Coaching Savant — the tree is the thing worth showing on the card */}
            <a className="card c-coach span2" href="/coaching-savant.html">
              <Skeleton />
              <div className="viz">
                <svg className="board" viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                  <defs>
                    <pattern id="gwGridW" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M20 0H0V20" fill="none" stroke="rgba(14,42,23,0.07)" strokeWidth="1" />
                    </pattern>
                    <marker id="gwArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M0 0L10 5L0 10z" fill="#1D6B3A" />
                    </marker>
                  </defs>
                  <rect width="600" height="150" fill="url(#gwGridW)" />
                  <line className="los" x1="0" y1="92" x2="600" y2="92" />
                  <g className="os">
                    <circle cx="120" cy="108" r="7" /><circle cx="144" cy="108" r="7" /><circle cx="168" cy="108" r="7" /><circle cx="192" cy="108" r="7" /><circle cx="216" cy="108" r="7" />
                    <circle cx="168" cy="132" r="7" className="qb" /><circle cx="264" cy="108" r="7" /><circle cx="54" cy="108" r="7" />
                  </g>
                  <g className="xs">
                    <path d="M112 68l12 12M124 68l-12 12M136 68l12 12M148 68l-12 12M160 68l12 12M172 68l-12 12M184 68l12 12M196 68l-12 12M254 62l12 12M266 62l-12 12M60 54l12 12M72 54l-12 12M158 26l12 12M170 26l-12 12M222 34l12 12M234 34l-12 12" />
                  </g>
                  <path className="route r1" d="M264 100 V58 Q264 40 282 36 L350 14" markerEnd="url(#gwArrow)" />
                  <path className="route r2" d="M54 100 V76 L90 26" markerEnd="url(#gwArrow)" />
                  <path className="route r3" d="M168 124 Q154 124 150 114" />
                  <g className="tree">
                    <rect x="440" y="70" width="60" height="14" rx="2" className="root" />
                    <path className="branch" d="M500 77h12v-30h12M512 77h12M512 77v30h12" />
                    <rect x="524" y="40" width="50" height="13" rx="2" className="leaf a" />
                    <rect x="524" y="70" width="50" height="13" rx="2" className="leaf b" />
                    <rect x="524" y="100" width="50" height="13" rx="2" className="leaf c" />
                  </g>
                </svg>
              </div>
              <div className="meta">
                <span className="ck">Tool · Coaching</span>
                <h3>Coaching Savant</h3>
                <p>Every head coach since 1999 — records, playoff history, what they called, and a coaching tree drawn back to Paul Brown.</p>
                <span className="go">Open ↗</span>
              </div>
            </a>

            {/* Big Board */}
            <a className="card c-board span2" href="/rankings">
              <Skeleton />
              <div className="viz">
                <div className="wall" />
                <div className="plates">
                  <div className="plate"><span className="pk">1</span><span className="nm"><i style={{width:'62%'}} /><i className="s" style={{width:'34%'}} /></span><span className="tm" style={{background:'#c2a263'}} /></div>
                  <div className="plate"><span className="pk">2</span><span className="nm"><i style={{width:'54%'}} /><i className="s" style={{width:'40%'}} /></span><span className="tm" style={{background:'#22395a'}} /></div>
                  <div className="plate"><span className="pk">3</span><span className="nm"><i style={{width:'70%'}} /><i className="s" style={{width:'28%'}} /></span><span className="tm" style={{background:'#bc3a2c'}} /></div>
                  <div className="plate slide"><span className="pk">4</span><span className="nm"><i style={{width:'48%'}} /><i className="s" style={{width:'36%'}} /></span><span className="tm" style={{background:'#1c4e86'}} /></div>
                </div>
              </div>
              <div className="meta">
                <span className="ck">Rankings</span>
                <h3>Big Board</h3>
                <p>League power rankings, re-graded and refreshed weekly.</p>
                <span className="go">View ↗</span>
              </div>
            </a>

            {/* Comp Chain */}
            <a className="card c-comp span2" href="/comp-chain">
              <Skeleton />
              <div className="viz">
                <div className="grid-bg" />
                <div className="scan" />
                <svg viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="gwLaser" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#5b7cab" />
                      <stop offset="0.5" stopColor="#c2a263" />
                      <stop offset="1" stopColor="#ffe9bd" />
                    </linearGradient>
                  </defs>
                  <g className="sky">
                    <path className="web" d="M40 150L22 60M22 60L120 96M120 96L88 30M88 30L170 44M170 44L210 128M210 128L262 176M262 176L300 70M300 70L250 22M250 22L338 36M338 36L360 104M360 104L386 160M22 60L60 18M170 44L250 22M120 96L170 44" />
                    <circle className="star" cx="22" cy="60" r="1.6" /><circle className="star" cx="88" cy="30" r="2.1" /><circle className="star" cx="170" cy="44" r="1.5" />
                    <circle className="star" cx="262" cy="176" r="1.8" /><circle className="star" cx="250" cy="22" r="2.3" /><circle className="star" cx="338" cy="36" r="1.5" />
                    <circle className="star" cx="386" cy="160" r="1.7" /><circle className="star" cx="60" cy="18" r="1.3" /><circle className="star" cx="150" cy="170" r="1.4" />
                    <circle className="star" cx="320" cy="150" r="1.2" /><circle className="star" cx="200" cy="12" r="1.1" /><circle className="star" cx="14" cy="120" r="1.2" />
                  </g>
                  <path className="laser" d="M40 150 L120 96 L210 128 L300 70 L360 104" />
                  <circle className="node p" cx="40" cy="150" r="4" />
                  <circle className="node p" cx="120" cy="96" r="4" />
                  <circle className="node p" cx="210" cy="128" r="4" />
                  <circle className="node p" cx="300" cy="70" r="4" />
                  <circle className="node p" cx="360" cy="104" r="4" />
                </svg>
              </div>
              <div className="meta">
                <span className="ck">Play · Daily puzzle</span>
                <h3>Comp Chain</h3>
                <p>Hop player to player through their statistical comps in as few moves as you can. A new puzzle every day.</p>
                <span className="go">Enter ↗</span>
              </div>
            </a>

            {/* Analysis */}
            <a className="card c-analysis span2" href="/articles">
              <Skeleton />
              <div className="viz">
                <div className="np">
                  <div className="hl">Film-first, always</div>
                  <div className="cols">
                    <div><span className="dc">W</span><div className="ln" /><div className="ln" /><div className="ln s" /></div>
                    <div><div className="ln" /><div className="ln" /><div className="ln s" /></div>
                  </div>
                </div>
              </div>
              <div className="meta">
                <span className="ck">Reading</span>
                <h3>Analysis</h3>
                <p>Breakdowns and data that earns its place.</p>
                <span className="go">Read ↗</span>
              </div>
            </a>

            {/* News */}
            <a className="card c-news" href="/news">
              <Skeleton />
              <div className="viz">
                <div className="wire">
                  <span className="live"><span className="dot" />On the wire</span>
                  <div className="feed">
                    <ul>
                      <li><b>TRADE</b> deadline grades live</li>
                      <li><b>INJURY</b> report updated</li>
                      <li><b>SIGNING</b> buyout market opens</li>
                      <li><b>TRADE</b> deadline grades live</li>
                    </ul>
                  </div>
                </div>
              </div>
              <div className="meta">
                <span className="ck">Wire</span>
                <h3>News</h3>
                <p>The latest from around the league.</p>
                <span className="go">Catch up ↗</span>
              </div>
            </a>

            {/* About */}
            <a className="card c-about" href="/about">
              <Skeleton />
              <div className="viz">
                <div className="mono">◆</div>
                <div className="man">
                  <div className="gr" />
                  <div className="st">We publish our misses next to our hits.</div>
                </div>
              </div>
              <div className="meta">
                <span className="ck">The masthead</span>
                <h3>About</h3>
                <p>Who we are and how we grade.</p>
                <span className="go">Meet us ↗</span>
              </div>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
