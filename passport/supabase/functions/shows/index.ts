import { createClient } from 'jsr:@supabase/supabase-js@2';
// Supabase Edge Function: shows (show search: Resident Advisor + setlist.fm)
// Searches setlist.fm for past shows (worldwide) without exposing the API key to the browser.
//   GET ?q=mau p pacha          -> shows matching an artist + venue/city words
//   GET ?venueId=..&date=yyyy-mm-dd -> everyone setlist.fm has playing that venue that day (the lineup)
//   GET ?venue=Pier 80&city=San Francisco&year=2026[&from=mm-dd&to=mm-dd] -> every day with sets at that venue that year, lineups grouped by day (festivals)
// Secret: SETLISTFM_API_KEY. Also searches Resident Advisor (no key). Results cached in public.search_cache.

const API = 'https://api.setlist.fm/rest/1.0';
const KEY = Deno.env.get('SETLISTFM_API_KEY') ?? '';
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

// Resident Advisor (ra.co) — the GraphQL feed its own site uses. Not an official API: every call is wrapped so a
// failure or block just means "no RA results" and the search carries on with setlist.fm.
const RA_HEADERS = { 'Content-Type': 'application/json', Referer: 'https://ra.co/events', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' };
async function ra(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  try {
    const r = await fetch('https://ra.co/graphql', { method: 'POST', headers: RA_HEADERS, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null; const j = await r.json(); return j?.data || null;
  } catch { return null; }
}
const EV = 'id title date startTime endTime artists { name } venue { name area { name country { name } } }';
function raRow(e: any): Row {
  const v = e.venue || {}, area = v.area || {}, a: string[] = (e.artists || []).map((x: any) => x.name).filter(Boolean);
  const title = String(e.title || ''), venue = String(v.name || '').replace(/^TBA\s*-\s*/i, '');
  const loc = [area.name, area.country?.name && !/united states/i.test(area.country.name) ? area.country.name : ''].filter(Boolean).join(', ');
  const fest = a.length > 8 || /festival|fest\b/i.test(title) || (e.endTime && e.startTime && String(e.endTime).slice(0, 10) > String(e.startTime).slice(0, 10) && a.length > 4);
  return { id: 'ra:' + e.id, d: String(e.date || '').slice(0, 10), n: title, v: venue, venueId: '', l: loc, a, f: fest ? 1 : 0, src: 'ra' };
}
async function raSearch(q: string): Promise<Row[]> {
  const words = norm(q).split(' ').filter(Boolean); if (!words.length) return [];
  const found = await ra(`query($q:String!){ search(searchTerm:$q, limit:12, indices:[EVENT, ARTIST, CLUB], includeNonLive:true){ searchType id value } }`, { q });
  const hits: any[] = found?.search || [];
  const eventIds = hits.filter((h) => /EVENT/.test(h.searchType)).slice(0, 8).map((h) => h.id);
  const out: Row[] = [];
  // events that matched by name (festivals, named club nights)
  if (eventIds.length) {
    const d = await ra(`query{ ${eventIds.map((id, i) => `e${i}: event(id:"${id}"){ ${EV} }`).join(' ')} }`);
    if (d) Object.values(d).forEach((e: any) => e && out.push(raRow(e)));
  }
  // "artist venue" searches: the leading words name an artist, the rest narrow it to a venue, city or event
  for (let k = Math.min(words.length, 4); k >= 1; k--) {
    const name = words.slice(0, k).join(' '), rest = words.slice(k);
    let artist = hits.find((h) => h.searchType === 'ARTIST' && norm(h.value) === name);
    if (!artist && k === words.length) continue;
    if (!artist) { const f2 = await ra(`query($q:String!){ search(searchTerm:$q, limit:3, indices:[ARTIST], includeNonLive:true){ searchType id value } }`, { q: name }); artist = (f2?.search || []).find((h: any) => norm(h.value) === name); }
    if (!artist) continue;
    const d = await ra(`query($id:ID!){ artist(id:$id){ past: events(type:PREVIOUS, limit:60){ ${EV} } next: events(type:LATEST, limit:20){ ${EV} } } }`, { id: artist.id });
    const evs = [...(d?.artist?.past || []), ...(d?.artist?.next || [])].map(raRow)
      .filter((r) => rest.every((w) => norm(r.v + ' ' + r.l + ' ' + r.n + ' ' + r.d).includes(w)));
    out.push(...evs.slice(0, 30)); break;
  }
  // a club or venue name on its own: its recent nights
  const club = hits.find((h) => h.searchType === 'CLUB' && norm(h.value).includes(words.join(' ')));
  if (club) {
    const d = await ra(`query($id:ID!){ venue(id:$id){ events(type:PREVIOUS, limit:25){ ${EV} } } }`, { id: club.id });
    (d?.venue?.events || []).forEach((e: any) => out.push(raRow(e)));
  }
  const seen = new Set<string>(); return out.filter((r) => r.d && !seen.has(r.id) && seen.add(r.id));
}

// Small cache so repeat searches don't hit RA or setlist.fm again (12 hours).
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
async function cached(key: string, fn: () => Promise<Row[]>): Promise<Row[]> {
  try { const { data } = await admin.from('search_cache').select('data, at').eq('key', key).maybeSingle();
    if (data && Date.now() - new Date(data.at).getTime() < 12 * 3600e3) return data.data as Row[]; } catch { /* no cache table yet */ }
  const rows = await fn();
  if (rows.length) { try { await admin.from('search_cache').upsert({ key, data: rows, at: new Date().toISOString() }); } catch { /* ignore */ } }
  return rows;
}

// RA and setlist.fm together; the same show from both (same day, same venue) is merged, keeping the fuller lineup and RA's title.
async function search(q: string): Promise<Row[]> {
  const nq = norm(q);
  const [a, b] = await Promise.all([cached('sf:' + nq, () => setlistSearch(q)).catch(() => [] as Row[]), cached('ra:' + nq, () => raSearch(q)).catch(() => [] as Row[])]);
  const vkey = (r: Row) => r.d + '|' + norm(r.v).replace(/^the /, '').replace(/ /g, '').slice(0, 8);
  const merged = new Map<string, Row>();
  for (const r of [...b, ...a]) {
    const k = vkey(r), m = merged.get(k);
    if (!m) { merged.set(k, { ...r, a: [...r.a] }); continue; }
    r.a.forEach((x) => !m.a.some((y) => norm(y) === norm(x)) && m.a.push(x));
    if (!m.venueId && r.venueId) m.venueId = r.venueId; m.f = m.f || r.f;
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
