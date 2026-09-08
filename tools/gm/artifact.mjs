// Inline the smoke bundle into one self-contained page — the artifact Adam opens.
//
// The bundle is built as a library for the headless play-through, which runs under node, so
// it still refers to `process.env.NODE_ENV` and to `process.emit`. A browser has neither, and
// without this shim the whole page dies on the first line with "process is not defined".
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = process.argv[2] || '/root/out/front-office.html'
const css = readFileSync(resolve(root, '.smoke/website.css'), 'utf8')
const js = readFileSync(resolve(root, '.smoke/smoke.js'), 'utf8')

writeFileSync(out, `<meta charset="utf-8">
<title>Front Office</title>
<style>html,body{margin:0;height:100%;background:#08090D}#root{height:100vh}
${css}</style>
<div id="root"></div>
<script>window.process=window.process||{env:{NODE_ENV:'production'},emit:function(){},nextTick:function(f){setTimeout(f,0)}}</script>
<script type="module">
${js}
</script>
`, 'utf8')
console.log(`${out} — ${(css.length + js.length) / 1024 | 0} kB`)
