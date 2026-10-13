// Supabase Edge Function: show-search
// Searches setlist.fm for past shows (worldwide) without exposing the API key to the browser.
//   GET ?q=mau p pacha          -> shows matching an artist + venue/city words
//   GET ?venueId=..&date=yyyy-mm-dd -> everyone setlist.fm has playing that venue that day (the lineup)
//   GET ?venue=Pier 80&city=San Francisco&year=2026[&from=mm-dd&to=mm-dd] -> every day with sets at that venue that year, lineups grouped by day (festivals)
// Secrets: SETLISTFM_API_KEY, and optionally BANDSINTOWN_APP_ID (adds artist-reported past and upcoming dates,
// with festival lineups attached). Without the Bandsintown key the search works on setlist.fm alone.

const API = 'https://api.setlist.fm/rest/1.0';
const KEY = Deno.env.get('SETLISTFM_API_KEY') ?? '';
const BIT = Deno.env.get('BANDSINTOWN_APP_ID') ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });

const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sf(path: string, params: Record<string, string>) {
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => v && url.searchParams.set(k, v));
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: { 'x-api-key': KEY, Accept: 'application/json' } });
    if (r.status === 404) return null; // setlist.fm answers "no results" with 404
    if (r.status === 429) { await sleep(700); continue; }
    if (!r.ok) throw new Error('setlist.fm ' + r.status);
    return await r.json();
  }
  return null;
}

type Row = { id: string; d: string; n: string; v: string; venueId: string; l: string; a: string[]; f: number; src: string };
const toISO = (d: string) => { const [dd, mm, yy] = d.split('-'); return `${yy}-${mm}-${dd}`; };
const toSF = (d: string) => { const [yy, mm, dd] = d.split('-'); return `${dd}-${mm}-${yy}`; };

function rows(setlists: any[]): Row[] {
  const byShow = new Map<string, Row>();
  for (const s of setlists || []) {
    const v = s.venue || {}, c = v.city || {}, key = (v.id || v.name) + '|' + s.eventDate;
    const loc = [c.name, c.stateCode && c.country?.code === 'US' ? c.stateCode : c.country?.name].filter(Boolean).join(', ');
    const row = byShow.get(key) || { id: 'sf:' + key, d: toISO(s.eventDate), n: s.tour?.name && /festival|fest|weekend|tour/i.test(s.tour.name) ? s.tour.name : '', v: v.name || '', venueId: v.id || '', l: loc, a: [], f: 0, src: 'setlist.fm' };
    const name = s.artist?.name; if (name && !row.a.includes(name)) row.a.push(name);
    byShow.set(key, row);
  }
  return [...byShow.values()].map((r) => ({ ...r, f: r.a.length > 4 || /festival|fest\b/i.test(r.n + ' ' + r.v) ? 1 : 0 }));
}

async function setlistSearch(q: string): Promise<Row[]> {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const match = (r: Row, rest: string[]) => rest.every((w) => norm(r.v + ' ' + r.l + ' ' + r.n + ' ' + r.d).includes(w));
  // Longest leading run of words = artist; the rest = venue or city, asked of setlist.fm directly.
  for (let k = words.length; k >= 1; k--) {
    const artist = words.slice(0, k).join(' '), rest = words.slice(k), place = rest.join(' ');
    if (!rest.length) {
      const data = await sf('/search/setlists', { artistName: artist, p: '1' });
      if (data?.setlist?.length) return rows(data.setlist);
      await sleep(550); continue;
    }
    let out: Row[] = [];
    for (const field of ['venueName', 'cityName']) {
      const data = await sf('/search/setlists', { artistName: artist, [field]: place, p: '1' });
      out = [...out, ...rows(data?.setlist || []).filter((x) => !out.some((o) => o.id === x.id))];
      await sleep(550);
      if (out.length >= 5) break;
    }
    if (!out.length) { // venue/city spelled differently: fall back to the artist's recent shows, filtered
      const data = await sf('/search/setlists', { artistName: artist, p: '1' });
      if (data?.setlist?.length) out = rows(data.setlist).filter((r) => match(r, rest));
      else { await sleep(550); continue; }
    }
    if (out.length) return out;
    await sleep(550);
  }
  // No artist matched: treat the whole query as a venue or festival name.
  const data = await sf('/search/setlists', { venueName: q, p: '1' }) || await sf('/search/setlists', { tourName: q, p: '1' });
  return rows(data?.setlist || []);
}

async function festivalDays(venue: string, city: string, year: string, from = '', to = ''): Promise<Row[]> {
  const all: any[] = [];
  for (let p = 1; p <= 6; p++) {
    const data = await sf('/search/setlists', { venueName: venue, cityName: city, year, p: String(p) });
    const list = data?.setlist || []; all.push(...list);
    if (!data || data.page * data.itemsPerPage >= data.total) break;
    await sleep(550);
  }
  const inWindow = (iso: string) => { const md = iso.slice(5); return (!from || md >= from) && (!to || md <= to); };
  // festivals are often filed stage by stage: merge everything on the same day into one row
  const byDay = new Map<string, Row>();
  for (const r of rows(all).filter((r) => inWindow(r.d))) {
    const d = byDay.get(r.d); if (!d) { byDay.set(r.d, { ...r, id: 'fest:' + r.d, f: 1 }); continue; }
    r.a.forEach((x) => !d.a.includes(x) && d.a.push(x));
  }
  return [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d));
}

// Bandsintown: look the artist up (longest leading run of words), keep shows matching the rest of the words.
async function bitSearch(q: string): Promise<Row[]> {
  if (!BIT) return [];
  const words = norm(q).split(' ').filter(Boolean);
  for (let k = Math.min(words.length, 4); k >= 1; k--) {
    const artist = words.slice(0, k).join(' '), rest = words.slice(k);
    let list: any;
    try {
      const r = await fetch('https://rest.bandsintown.com/artists/' + encodeURIComponent(artist) + '/events?date=all&app_id=' + encodeURIComponent(BIT), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue; list = await r.json();
    } catch { continue; }
    if (!Array.isArray(list) || !list.length) continue;
    const out: Row[] = list.map((e: any) => {
      const v = e.venue || {}, d = String(e.datetime || e.starts_at || '').slice(0, 10);
      const loc = [v.city, v.country === 'United States' ? v.region : v.country].filter(Boolean).join(', ');
      const lineup: string[] = (e.lineup || []).filter(Boolean);
      const fest = lineup.length > 4 || !!e.festival_start_date || /festival|fest\b/i.test(e.title || '');
      return { id: 'bit:' + e.id, d, n: fest ? (e.title || v.name || '') : '', v: v.name || '', venueId: '', l: loc, a: lineup, f: fest ? 1 : 0, src: 'bandsintown' };
    }).filter((r: Row) => r.d && rest.every((w) => norm(r.v + ' ' + r.l + ' ' + r.n + ' ' + r.d).includes(w)));
    if (out.length) return out;
  }
  return [];
}

// Both sources at once; the same show from both (same day, same venue) is merged, keeping the fuller lineup.
async function search(q: string): Promise<Row[]> {
  const [a, b] = await Promise.all([setlistSearch(q).catch(() => [] as Row[]), bitSearch(q).catch(() => [] as Row[])]);
  const key = (r: Row) => r.d + '|' + norm(r.v).replace(/^the /, '').slice(0, 12);
  const merged = new Map<string, Row>();
  for (const r of [...a, ...b]) {
    const k = key(r), m = merged.get(k);
    if (!m) { merged.set(k, { ...r }); continue; }
    r.a.forEach((x) => !m.a.includes(x) && m.a.push(x));
    if (!m.n && r.n) m.n = r.n; if (!m.venueId && r.venueId) m.venueId = r.venueId; m.f = m.f || r.f;
  }
  return [...merged.values()].sort((x, y) => y.d.localeCompare(x.d));
}

async function lineup(venueId: string, date: string): Promise<string[]> {
  const names: string[] = [];
  for (let p = 1; p <= 3; p++) {
    const data = await sf('/search/setlists', { venueId, date: toSF(date), p: String(p) });
    const list = data?.setlist || [];
    list.forEach((s: any) => s.artist?.name && !names.includes(s.artist.name) && names.push(s.artist.name));
    if (!data || data.page * data.itemsPerPage >= data.total) break;
    await sleep(550);
  }
  return names;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!KEY) return json({ error: 'missing SETLISTFM_API_KEY secret' }, 500);
  const u = new URL(req.url), q = (u.searchParams.get('q') || '').slice(0, 80);
  try {
    if (u.searchParams.get('venue') && u.searchParams.get('year')) return json({ events: await festivalDays(u.searchParams.get('venue')!, u.searchParams.get('city') || '', u.searchParams.get('year')!, u.searchParams.get('from') || '', u.searchParams.get('to') || '') });
    if (u.searchParams.get('venueId') && u.searchParams.get('date')) return json({ artists: await lineup(u.searchParams.get('venueId')!, u.searchParams.get('date')!) });
    return json({ events: (await search(q)).slice(0, 40) });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
});
