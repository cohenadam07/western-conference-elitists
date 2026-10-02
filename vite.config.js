import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import seoBuild from './scripts/lib/seo-build.mjs'
import compressData from './scripts/lib/compress-data.mjs'
import savantApi from './scripts/lib/savant-api.mjs'

// https://vite.dev/config/
export default defineConfig({
  // seoBuild: per-page HTML for share previews + sitemap + 404 (see the file's header)
  // savantApi: Basketball Savant as small files with percentiles worked out, for AIs and scripts
  plugins: [react(), seoBuild(), savantApi(), compressData()],
})
