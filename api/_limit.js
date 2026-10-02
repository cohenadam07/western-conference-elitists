// api/_limit.js — a small rate limit, held in memory, for the AI connector (api/mcp.js).
//
// WHAT IT IS FOR
// The connector is public and announced on the homepage. A limit keeps one caller, most
// likely an assistant stuck in a loop or somebody's script, from running the function flat
// out: past the limit a request is answered at once with "wait N seconds", before any tool
// runs or any data is fetched.
//
// WHAT IT IS NOT
// It is not a firewall. A refused request has still reached the function, so it still counts
// as one of the month's function invocations; only a rule in Vercel's Firewall, which sits in
// front of the function, can stop that (the README says how to add one). And the count lives
// in one running copy of the function: when Vercel runs several copies, each keeps its own,
// so the real ceiling is the limit times the number of copies. It is a brake, not a wall.
//
// HOW IT COUNTS
// A fixed window per caller: the first request opens a minute, each request in it is counted,
// and the count starts again when the minute is up. Nothing is written anywhere. A caller's
// address is held only as the key of that count, in memory, and is gone when the window is
// pruned or the copy of the function is recycled.
//
// Not a function itself: Vercel skips api files that start with an underscore.

export function makeLimiter({ windowMs = 60 * 1000, maxKeys = 5000, now = Date.now } = {}) {
  const windows = new Map() // caller -> { start, count }, oldest first

  // Memory stays bounded however many callers turn up: finished windows go first, and if
  // every window is still live, the oldest tenth are forgotten (they start a fresh count).
  function prune(t) {
    for (const [key, w] of windows) if (t - w.start >= windowMs) windows.delete(key)
    let spare = windows.size - maxKeys + Math.ceil(maxKeys / 10)
    for (const key of windows.keys()) {
      if (spare-- <= 0) break
      windows.delete(key)
    }
  }

  // Count `cost` requests for `key` against `limit` a window.
  //   { ok: true }                 counted; go ahead
  //   { ok: false, retryAfter }    over the limit; the window ends in `retryAfter` seconds
  function take(key, limit, cost = 1) {
    const t = now()
    let w = windows.get(key)
    if (w && t - w.start >= windowMs) { windows.delete(key); w = undefined }
    if (!w) {
      if (windows.size >= maxKeys) prune(t)
      w = { start: t, count: 0 }
      windows.set(key, w)
    }
    if (w.count + cost > limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) }
    w.count += cost
    return { ok: true }
  }

  return { take, size: () => windows.size, clear: () => windows.clear() }
}
