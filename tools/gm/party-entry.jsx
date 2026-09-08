// Preview the championship sequence without having to win a title first.
//
//   SMOKE_MIN=1 SMOKE_OUT=<dir> npx vite build -c tools/gm/vite.party.config.mjs
//
import { createRoot } from 'react-dom/client'
import Celebration from '../../src/components/gm/Celebration.jsx'
import '../../src/pages/gm.css'
createRoot(document.getElementById('root')).render(
  <div className="fo" style={{ '--acc': '#00A2E8', '--acc-2': '#EF3B24', '--acc-ink': '#fff' }}>
    <Celebration team="OKC" season="2026-27" record="61–21"
      path={[{ opp: 'DAL', w: 4, l: 1, won: true }, { opp: 'DEN', w: 4, l: 2, won: true },
             { opp: 'BOS', w: 4, l: 3, won: true }]}
      badges={[{ id: 'champion', name: 'Champion' }, { id: 'quick_build', name: 'Quick Build' }]}
      onDone={() => {}} />
  </div>
)
