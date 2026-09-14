// WHETHER ANYBODY IS PLAYING, AND WHERE THEY STOP.
//
// The site already loads Vercel Analytics, so pageviews at /gm are counted. That tells
// you people arrived. It does not tell you the thing worth knowing about a game with a
// season in it: how many get past the franchise picker, how many finish a year, how many
// come back for a second one, and which screen they were on when they left. Guessing at
// that is how you end up polishing the part nobody reached.
//
// Deliberately small, and deliberately anonymous. No GM name — the player types that and
// it is theirs. No career id, no roster, no save. Club, counts and outcomes only.
import { track as vercel } from '@vercel/analytics'

let on = true
export const setTracking = (v) => { on = !!v }

export function track(event, props = {}) {
  if (!on) return
  try {
    const clean = {}
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined) continue
      // Vercel's custom properties take strings, numbers and booleans only, and anything
      // else silently drops the whole event.
      clean[k] = (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        ? v : String(v)
    }
    vercel(event, clean)
  } catch {
    // Analytics is never allowed to break a game. Blocked by an extension, not yet
    // loaded, running on localhost — all of it is fine and none of it is worth a throw.
  }
}

// The funnel, named once so the call sites cannot drift into near-misses that look like
// different events on the dashboard.
export const EV = {
  start: 'fo:career-start',
  season: 'fo:season-end',
  fired: 'fo:fired',
  title: 'fo:title',
  quit: 'fo:leave',
}
