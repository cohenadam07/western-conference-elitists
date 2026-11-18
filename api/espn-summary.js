// Fallback for Live Lineups (public/live-lineups.html): proxies ESPN's men's college basketball summary or a team
// schedule when a browser blocks the direct request. ESPN normally sends access-control-allow-origin: *, so the page
// only switches here after a direct fetch fails. Only numeric ids are accepted; nothing else is forwarded.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';

export default async function handler(req, res) {
  const { event, schedule } = req.query || {};
  let url;
  if (event && /^\d{6,12}$/.test(String(event))) url = `${BASE}/summary?event=${event}`;
  else if (schedule && /^\d{1,6}$/.test(String(schedule))) url = `${BASE}/teams/${schedule}/schedule`;
  else { res.status(400).json({ error: 'event or schedule id required' }); return; }
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await r.text();
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'public, s-maxage=15, max-age=5');
    res.setHeader('access-control-allow-origin', '*');
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: 'ESPN unreachable' });
  }
}
