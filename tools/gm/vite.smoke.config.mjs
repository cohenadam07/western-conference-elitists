import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import react from '@vitejs/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

export default {
  root,
  plugins: [react()],
  build: {
    outDir: process.env.SMOKE_OUT || resolve(root, '.smoke'),
    emptyOutDir: true,
    minify: process.env.SMOKE_MIN === '1',
    lib: {
      entry: resolve(here, 'smoke-entry.jsx'),
      formats: ['iife'],
      name: 'GMSmoke',
      fileName: () => 'smoke.js',
    },
  },
}
