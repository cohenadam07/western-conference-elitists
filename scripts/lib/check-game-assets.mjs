// Fail the build if a prebuilt game in public/ points at a file that isn't there.
//
// Flappy Hoops is built in its own project and copied into public/flappy-hoops/. Its file names carry a
// hash of their contents, so a change to the game's styles renames its stylesheet. Copy the new page and
// script without the new stylesheet and the page asks for a file that doesn't exist: the host answers
// with the site's own HTML, the game loads with no styles at all, and on a phone all you see is the
// title's replay (October 2026). Better that the deploy fails here and the last good one stays up.
import fs from 'node:fs'
import path from 'node:path'

const GAMES = ['flappy-hoops/index.html']

export default function checkGameAssets() {
  return {
    name: 'check-game-assets',
    buildStart() {
      const pub = path.resolve('public'), missing = []
      for (const page of GAMES) {
        const file = path.join(pub, page)
        if (!fs.existsSync(file)) { missing.push(page); continue }
        const html = fs.readFileSync(file, 'utf8')
        for (const [, ref] of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
          if (!fs.existsSync(path.join(pub, ref))) missing.push(`${ref} (from ${page})`)
        }
      }
      if (missing.length) this.error(`a prebuilt game points at files that aren't in public/:\n  ${missing.join('\n  ')}\nCopy the game's whole build over (dist-site/), not only its page and script.`)
    },
  }
}
