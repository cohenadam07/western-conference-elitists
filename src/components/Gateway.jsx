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

            {/* Big Board */}
            <a className="card c-board span2" href="/rankings">
              <Skeleton />
              <div className="viz">
                <div className="lad">
                  <div className="lrow"><span className="rk">1</span><span className="meter"><i /></span></div>
                  <div className="lrow"><span className="rk">2</span><span className="meter"><i /></span></div>
                  <div className="lrow"><span className="rk">3</span><span className="meter"><i /></span></div>
                  <div className="lrow"><span className="rk">4</span><span className="meter"><i /></span></div>
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

            {/* Podcasts */}
            <a className="card c-pods" href="/podcasts">
              <Skeleton />
              <div className="viz">
                <div className="eq"><b /><b /><b /><b /><b /><b /><b /></div>
                <div className="play">
                  <svg viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 1.5 L10 6 L2.5 10.5 Z" /></svg>
                </div>
              </div>
              <div className="meta">
                <span className="ck">Listen</span>
                <h3>Podcasts</h3>
                <p>The WCE Hoops show — film, takes, arguments.</p>
                <span className="go">Play ↗</span>
              </div>
            </a>

            {/* Analysis */}
            <a className="card c-analysis" href="/articles">
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
