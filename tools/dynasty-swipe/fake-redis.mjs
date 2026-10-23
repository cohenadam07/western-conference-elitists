// An in-memory Upstash for the swipe tests: the REST and pipeline endpoints, the commands
// api/dynasty.js and api/_dynasty-swipe.js use, and EVAL run through a real Lua interpreter
// (fengari), so the script that writes the market is the one under test, not a copy of it.
// Every command is counted the way Upstash bills it: one per pipeline entry, one per EVAL.

import fengari from 'fengari'

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari

export function fakeRedis() {
  const S = new Map()                       // key -> string | Map (hash) | Map (zset) | array (list) | Set
  const kind = new Map()
  let commands = 0

  const str = (x) => (typeof x === 'string' ? x : String(x))
  const get = (k, t, make) => {
    if (!S.has(k)) { if (!make) return null; S.set(k, make()); kind.set(k, t) }
    if (kind.get(k) !== t) throw new Error(`WRONGTYPE ${k}`)
    return S.get(k)
  }
  const num = (v) => { const n = Number(v); return Number.isInteger(n) ? n : n }
  const fmt = (n) => { const s = String(Number(n.toPrecision(17))); return s }

  function run(cmd) {
    const [op, ...a] = cmd.map(str)
    switch (op.toUpperCase()) {
      case 'GET': { const v = S.get(a[0]); return v === undefined ? null : v }
      case 'SET': S.set(a[0], a[1]); kind.set(a[0], 'string'); return 'OK'
      case 'DEL': { const had = S.has(a[0]); S.delete(a[0]); kind.delete(a[0]); return had ? 1 : 0 }
      case 'EXPIRE': return S.has(a[0]) ? 1 : 0
      case 'INCR': case 'INCRBY': {
        const v = Number(S.get(a[0]) || 0) + (op.toUpperCase() === 'INCR' ? 1 : Number(a[1]))
        S.set(a[0], String(v)); kind.set(a[0], 'string'); return v
      }
      case 'INCRBYFLOAT': {
        const v = Number(S.get(a[0]) || 0) + Number(a[1])
        S.set(a[0], fmt(v)); kind.set(a[0], 'string'); return fmt(v)
      }
      case 'ZCARD': { const z = get(a[0], 'zset'); return z ? z.size : 0 }
      case 'ZADD': {
        const z = get(a[0], 'zset', () => new Map()); let i = 1, nx = false, n = 0
        if (a[1].toUpperCase() === 'NX') { nx = true; i = 2 }
        for (; i + 1 < a.length; i += 2) { if (nx && z.has(a[i + 1])) continue; if (!z.has(a[i + 1])) n++; z.set(a[i + 1], Number(a[i])) }
        return n
      }
      case 'ZINCRBY': { const z = get(a[0], 'zset', () => new Map()); const v = (z.get(a[2]) || 0) + Number(a[1]); z.set(a[2], v); return fmt(v) }
      case 'ZMSCORE': { const z = get(a[0], 'zset'); return a.slice(1).map((m) => (z && z.has(m) ? fmt(z.get(m)) : null)) }
      case 'ZREVRANGE': {
        const z = get(a[0], 'zset'); if (!z) return []
        const all = [...z.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? 1 : -1))
        const stop = Number(a[2]) < 0 ? all.length + Number(a[2]) : Number(a[2])
        const part = all.slice(Number(a[1]), stop + 1)
        return a[3] && a[3].toUpperCase() === 'WITHSCORES' ? part.flatMap(([m, s]) => [m, fmt(s)]) : part.map(([m]) => m)
      }
      case 'HGETALL': { const h = get(a[0], 'hash'); return h ? [...h.entries()].flat() : [] }
      case 'HMGET': { const h = get(a[0], 'hash'); return a.slice(1).map((f) => (h && h.has(f) ? h.get(f) : null)) }
      case 'HGET': { const h = get(a[0], 'hash'); return h && h.has(a[1]) ? h.get(a[1]) : null }
      case 'HSET': { const h = get(a[0], 'hash', () => new Map()); let n = 0; for (let i = 1; i + 1 < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], a[i + 1]) } return n }
      case 'HSETNX': { const h = get(a[0], 'hash', () => new Map()); if (h.has(a[1])) return 0; h.set(a[1], a[2]); return 1 }
      case 'HINCRBYFLOAT': { const h = get(a[0], 'hash', () => new Map()); const v = Number(h.get(a[1]) || 0) + Number(a[2]); h.set(a[1], fmt(v)); return fmt(v) }
      case 'HINCRBY': { const h = get(a[0], 'hash', () => new Map()); const v = Number(h.get(a[1]) || 0) + Number(a[2]); h.set(a[1], String(v)); return v }
      case 'LPUSH': { const l = get(a[0], 'list', () => []); for (const v of a.slice(1)) l.unshift(v); return l.length }
      case 'LTRIM': { const l = get(a[0], 'list'); if (!l) return 'OK'; const stop = Number(a[2]) < 0 ? l.length + Number(a[2]) : Number(a[2]); S.set(a[0], l.slice(Number(a[1]), stop + 1)); return 'OK' }
      case 'LRANGE': { const l = get(a[0], 'list'); if (!l) return []; const stop = Number(a[2]) < 0 ? l.length + Number(a[2]) : Number(a[2]); return l.slice(Number(a[1]), stop + 1) }
      case 'SADD': { const s = get(a[0], 'set', () => new Set()); let n = 0; for (const v of a.slice(1)) if (!s.has(v)) { s.add(v); n++ } return n }
      case 'SISMEMBER': { const s = get(a[0], 'set'); return s && s.has(a[1]) ? 1 : 0 }
      case 'EVAL': return evalLua(a[0], Number(a[1]), a.slice(2, 2 + Number(a[1])), a.slice(2 + Number(a[1])))
      default: throw new Error('fake redis: unsupported ' + op)
    }
  }

  // ---- Lua, with redis.call bridged to run() and Redis's reply conversions
  function push(L, v) {
    if (v === null || v === undefined) lua.lua_pushboolean(L, false)
    else if (typeof v === 'number') lua.lua_pushinteger(L, Math.trunc(v))
    else if (Array.isArray(v)) {
      lua.lua_createtable(L, v.length, 0)
      v.forEach((x, i) => { push(L, x); lua.lua_rawseti(L, -2, i + 1) })
    } else lua.lua_pushstring(L, to_luastring(String(v)))
  }
  function evalLua(src, nkeys, keys, argv) {
    const L = lauxlib.luaL_newstate()
    lualib.luaL_openlibs(L)
    const table = (name, list) => {
      lua.lua_createtable(L, list.length, 0)
      list.forEach((x, i) => { lua.lua_pushstring(L, to_luastring(x)); lua.lua_rawseti(L, -2, i + 1) })
      lua.lua_setglobal(L, to_luastring(name))
    }
    table('KEYS', keys); table('ARGV', argv)
    lua.lua_createtable(L, 0, 1)
    lua.lua_pushcfunction(L, (L2) => {
      const n = lua.lua_gettop(L2)
      const args = []
      for (let i = 1; i <= n; i++) args.push(to_jsstring(lua.lua_tolstring(L2, i)))
      push(L2, run(args))
      return 1
    })
    lua.lua_setfield(L, -2, to_luastring('call'))
    lua.lua_setglobal(L, to_luastring('redis'))
    if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
      throw new Error('lua: ' + to_jsstring(lua.lua_tostring(L, -1)))
    }
    if (lua.lua_isinteger(L, -1)) return lua.lua_tointeger(L, -1)
    if (lua.lua_isstring(L, -1)) return to_jsstring(lua.lua_tostring(L, -1))
    return null
  }

  const fetch = async (url, opts = {}) => {
    const body = JSON.parse(opts.body || '[]')
    let out
    if (String(url).endsWith('/pipeline')) { commands += body.length; out = body.map((c) => ({ result: run(c) })) }
    else { commands += 1; out = { result: run(body) } }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => out }
  }

  return {
    fetch,
    run,
    S,
    commands: () => commands,
    reset: () => { commands = 0 },
  }
}
