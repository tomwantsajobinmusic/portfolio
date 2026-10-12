// Supabase Edge Function: show-search
// Searches setlist.fm for past shows (worldwide) without exposing the API key to the browser.
//   GET ?q=mau p pacha          -> shows matching an artist + venue/city words
//   GET ?venueId=..&date=yyyy-mm-dd -> everyone setlist.fm has playing that venue that day (the lineup)
//   GET ?venue=Pier 80&city=San Francisco&year=2026[&from=mm-dd&to=mm-dd] -> every day with sets at that venue that year, lineups grouped by day (festivals)
// Secret needed: SETLISTFM_API_KEY (Supabase → Edge Functions → Secrets).

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

async function search(q: string): Promise<Row[]> {
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
  return rows(all).filter((r) => inWindow(r.d)).sort((a, b) => a.d.localeCompare(b.d));
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
