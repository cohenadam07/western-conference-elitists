import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import seoBuild from './scripts/lib/seo-build.mjs'
import compressData from './scripts/lib/compress-data.mjs'
import savantApi from './scripts/lib/savant-api.mjs'
import checkGameAssets from './scripts/lib/check-game-assets.mjs'
import whatsNew from './scripts/lib/whats-new.mjs'
import tileData from './scripts/lib/tile-data.mjs'
import siteSearch from './scripts/lib/site-search.mjs'
import { CLEAN } from './scripts/lib/seo-content.mjs'

// vercel.json serves each Savant page at its clean address (/nba-savant is
// public/basketball-savant.html). The dev and preview servers don't read vercel.json, so they
// do the same here; otherwise every link in the menu would land on the homepage locally.
const cleanAddresses = () => {
  const map = Object.fromEntries(Object.entries(CLEAN).map(([file, c]) => [c.path, `/${file}`]))
  const use = (server) => {
    server.middlewares.use((req, _res, next) => {
      const [p, q] = (req.url || '').split('?')
      if (map[p]) req.url = map[p] + (q ? `?${q}` : '')
      next()
    })
  }
  return { name: 'wce-clean-addresses', configureServer: use, configurePreviewServer: use }
}

// https://vite.dev/config/
export default defineConfig({
  // seoBuild: per-page HTML for share previews + sitemap + 404 (see the file's header)
  // savantApi: NBA Savant as small files with percentiles worked out, for AIs and scripts
  // checkGameAssets: a prebuilt game (Flappy Hoops) must not point at a file that isn't there
  // whatsNew: the homepage banner's recent articles, videos, updates and next UFC card
  // siteSearch: the two name lists behind the ribbon's search box (after savantApi: it reads its player lists)
  // tileData: one true, current fact for each homepage tile (the All-Savant team so far, the next card...)
  plugins: [cleanAddresses(), checkGameAssets(), whatsNew(), tileData(), react(), seoBuild(), savantApi(), siteSearch(), compressData()],
})
