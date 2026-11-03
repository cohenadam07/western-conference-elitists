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
      // Flappy Hoops' all-time records are checked on the server by replaying the run with the game's own
      // rules, server/sim.mjs, which the game's build writes next to itself. It has to be the copy from the
      // same build as the game's script, or a record set on a changed hole would be judged on the old one.
      const html = fs.existsSync(path.join(pub, 'flappy-hoops/index.html')) ? fs.readFileSync(path.join(pub, 'flappy-hoops/index.html'), 'utf8') : ''
      const script = (html.match(/src="\/flappy-hoops\/assets\/(index-[A-Za-z0-9_-]+\.js)"/) || [])[1]
      const simFile = path.join(pub, 'flappy-hoops/server/sim.mjs')
      if (html && !fs.existsSync(simFile)) {
        missing.push('/flappy-hoops/server/sim.mjs (the server\'s copy of the game\'s rules, for checking records)')
      } else if (html) {
        const built = (fs.readFileSync(simFile, 'utf8').match(/"(index-[A-Za-z0-9_-]+\.js)"/) || [])[1]
        if (!script || built !== script) missing.push(`/flappy-hoops/server/sim.mjs is from another build (${built || 'none'}; the game loads ${script || 'nothing'})`)
      }
      if (missing.length) this.error(`a prebuilt game points at files that aren't in public/:\n  ${missing.join('\n  ')}\nCopy the game's whole build over (dist-site/, server/ included), not only its page and script.`)
    },
  }
}
