// Entry point for the headless play-through (tools/gm/smoke.mjs).
//
// Every real defect in this game was found by playing it, never by a unit test — the
// season restarting on a tab change and trades not changing the roster both passed every
// test that existed. This mounts the actual page and clicks through a whole career.
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import GM from '../../src/pages/GM.jsx'

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/gm']}><GM /></MemoryRouter>
)
