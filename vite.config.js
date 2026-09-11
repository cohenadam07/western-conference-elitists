import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import seoBuild from './scripts/lib/seo-build.mjs'

// https://vite.dev/config/
export default defineConfig({
  // seoBuild: per-page HTML for share previews + sitemap + 404 (see the file's header)
  plugins: [react(), seoBuild()],
})
