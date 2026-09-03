// Shared helpers for the WCE analytics archive.
// Zero dependencies — talks to Upstash Redis over its REST API and to the
// Vercel Web Analytics REST API with plain fetch.

export const NS = 'wce:wa';
export const K_DAILY = `${NS}:daily`;
export const K_META = `${NS}:meta`;
export const kDim = (dim) => `${NS}:dim:${dim}`;

// Dimensions we archive. `key` is the field name Vercel returns on each row.
export const DIMENSIONS = [
  { id: 'path', by: 'requestPath', label: 'Pages' },
  { id: 'route', by: 'route', label: 'Routes' },
  { id: 'referrer', by: 'referrerHostname', label: 'Referrers' },
  { id: 'country', by: 'country', label: 'Countries' },
  { id: 'device', by: 'deviceType', label: 'Devices' },
  { id: 'browser', by: 'browserName', label: 'Browsers' },
  { id: 'os', by: 'osName', label: 'Operating systems' },
];

/* ------------------------------------------------------------------ *
 * Redis (Upstash REST)
 * ------------------------------------------------------------------ */

function redisConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      'Missing Upstash credentials. Expected KV_REST_API_URL + KV_REST_API_TOKEN ' +
        '(or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).'
    );
  }
  return { url: url.replace(/\/$/, ''), token };
}

// Run one command, e.g. redis(['HGETALL', 'wce:wa:daily'])
export async function redis(command) {
  const [{ result }] = await redisPipeline([command]);
  return result;
}

// Run many commands in one round trip. Returns [{result} | {error}, ...]
export async function redisPipeline(commands) {
  if (!commands.length) return [];
  const { url, token } = redisConfig();
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands.map((c) => c.map(String))),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${text.slice(0, 400)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Upstash returned non-JSON: ${text.slice(0, 200)}`);
  }
  const arr = Array.isArray(json) ? json : [json];
  const failed = arr.find((r) => r && r.error);
  if (failed) throw new Error(`Upstash command failed: ${failed.error}`);
  return arr;
}

// Upstash returns hashes either as a flat [f,v,f,v] array or as an object,
// depending on version. Normalise both.
export function toHash(result) {
  if (!result) return {};
  if (Array.isArray(result)) {
    const out = {};
    for (let i = 0; i < result.length; i += 2) out[result[i]] = result[i + 1];
    return out;
  }
  return result;
}

export function parseJSONSafe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ *
 * Dates (everything is UTC, YYYY-MM-DD)
 * ------------------------------------------------------------------ */

export const toISODate = (d) => new Date(d).toISOString().slice(0, 10);

export function daysAgo(n, from = Date.now()) {
  return toISODate(from - n * 86400000);
}

/* ------------------------------------------------------------------ *
 * Vercel Web Analytics API
 * ------------------------------------------------------------------ */

const API = 'https://api.vercel.com/v1/query/web-analytics/visits/aggregate';

function vercelConfig() {
  const token =
    process.env.VERCEL_ANALYTICS_TOKEN || process.env.VERCEL_ACCESS_TOKEN;
  const projectId = process.env.VERCEL_ANALYTICS_PROJECT_ID;
  if (!token) throw new Error('Missing VERCEL_ANALYTICS_TOKEN.');
  if (!projectId) throw new Error('Missing VERCEL_ANALYTICS_PROJECT_ID.');
  return {
    token,
    projectId,
    teamId: process.env.VERCEL_TEAM_ID || process.env.VERCEL_ANALYTICS_TEAM_ID || '',
    slug: process.env.VERCEL_TEAM_SLUG || '',
  };
}

/**
 * Query visits/aggregate.
 * @param {string[]} by  up to two dimensions, at most one time granularity
 */
export async function queryVisits({ by, since, until, limit, filter }) {
  const { token, projectId, teamId, slug } = vercelConfig();

  const build = (style) => {
    const p = new URLSearchParams();
    p.set('projectId', projectId);
    if (teamId) p.set('teamId', teamId);
    else if (slug) p.set('slug', slug);
    p.set('since', since);
    p.set('until', until);
    if (limit) p.set('limit', String(limit));
    if (filter) p.set('filter', filter);
    if (style === 'repeat') by.forEach((b) => p.append('by', b));
    else p.set('by', by.join(','));
    return `${API}?${p.toString()}`;
  };

  // `by` is documented as an array; encoding differs between clients, so try
  // repeated params first and fall back to a comma-joined value on a 400.
  let lastErr;
  for (const style of ['repeat', 'comma']) {
    const res = await fetch(build(style), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = await res.json();
      return Array.isArray(json?.data) ? json.data : [];
    }
    const body = await res.text();
    lastErr = new Error(
      `Vercel Analytics API ${res.status} (by=${by.join(',')}): ${body.slice(0, 300)}`
    );
    // Only the encoding is worth retrying; auth/plan errors are terminal.
    if (res.status !== 400) throw lastErr;
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export function timingSafeEqual(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export function presentedSecret(req) {
  const header = req.headers['x-analytics-key'];
  if (header) return Array.isArray(header) ? header[0] : header;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('key') || '';
}
