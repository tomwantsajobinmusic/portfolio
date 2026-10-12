// Supabase Edge Function: logo-add
// Signed-in travelers add a logo to the shared directory.
//   POST { name, kind: 'dj'|'festival'|'club'|'venue', url }      -> fetch that image, store a copy, add it
//   POST { name, kind, auto: true }                                -> look it up on Wikidata, Wikipedia, then seeklogo
// The copy lives in the public "passport" bucket so the app can engrave it and make stamps from it.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const keyOf = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const UA = { 'User-Agent': 'RavePassportBeta/1.0 (thomasbrownworks.com/passport)', 'Api-User-Agent': 'RavePassportBeta/1.0 (thomasbrownworks.com/passport)' };
const KINDS = ['dj', 'festival', 'club', 'venue', 'promoter'];
const OK_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function wikidataLogo(name: string, kind: string): Promise<string | null> {
  const want = kind === 'dj' ? /dj|disc jockey|musician|producer|duo|group|trio|collective|singer|artist|band/i
    : kind === 'festival' ? /festival|event|rave|music/i : /club|venue|nightclub|arena|amphitheat|hall|stadium|theat|building/i;
  const s = await fetch('https://www.wikidata.org/w/api.php?format=json&action=wbsearchentities&language=en&limit=5&search=' + encodeURIComponent(name), { headers: UA, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
  for (const hit of s.search || []) {
    if (keyOf(hit.label || '') !== keyOf(name) && !keyOf(hit.label || '').startsWith(keyOf(name))) continue;
    if (hit.description && !want.test(hit.description)) continue;
    const c = await fetch('https://www.wikidata.org/w/api.php?format=json&action=wbgetclaims&property=P154&entity=' + hit.id, { headers: UA, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const file = c.claims?.P154?.[0]?.mainsnak?.datavalue?.value; if (!file) continue;
    const ii = await fetch('https://commons.wikimedia.org/w/api.php?format=json&action=query&prop=imageinfo&iiprop=url&iiurlwidth=900&titles=' + encodeURIComponent('File:' + file), { headers: UA, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const info = (Object.values(ii.query?.pages || {})[0] as any)?.imageinfo?.[0];
    if (info) return info.thumburl || info.url;
  }
  return null;
}
async function wikipediaLogo(name: string, kind: string): Promise<string | null> {
  const W = 'https://en.wikipedia.org/w/api.php?format=json&';
  const q = kind === 'festival' && !/festival|fest\b/i.test(name) ? name + ' festival' : kind === 'dj' ? name + ' DJ' : name;
  const s = await fetch(W + 'action=query&list=search&srlimit=5&srsearch=' + encodeURIComponent(q), { headers: UA, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
  const k = keyOf(name).slice(0, 8);
  for (const hit of s.query?.search || []) {
    if (!keyOf(hit.title).startsWith(k)) continue;
    const im = await fetch(W + 'action=query&prop=images&imlimit=60&redirects=1&titles=' + encodeURIComponent(hit.title), { headers: UA, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const files = ((Object.values(im.query?.pages || {})[0] as any)?.images || []).map((x: any) => x.title as string)
      .filter((t: string) => /logo|wordmark/i.test(t) && !/commons|wiki|wikt|edit|question|ambox|portal|flag|symbol|icon|disambig/i.test(t));
    const pick = files.find((t: string) => keyOf(t).includes(keyOf(name).slice(0, 5)));
    if (!pick) continue;
    const ii = await fetch(W + 'action=query&prop=imageinfo&iiprop=url&iiurlwidth=900&titles=' + encodeURIComponent(pick), { headers: UA, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const info = (Object.values(ii.query?.pages || {})[0] as any)?.imageinfo?.[0];
    if (info) return info.thumburl || info.url;
  }
  return null;
}
async function seeklogoLogo(name: string): Promise<string | null> {
  const h = await fetch('https://seeklogo.com/search?q=' + encodeURIComponent(name), { headers: UA, signal: AbortSignal.timeout(10000) }).then((r) => r.ok ? r.text() : '');
  const k = keyOf(name);
  for (const tag of h.match(/<img\b[^>]*>/g) || []) {
    const altM = tag.match(/\balt="([^"]*)"/), srcM = tag.match(/data-src="(https:\/\/images\.seeklogo\.com\/logo-png\/[^"]+)"/) || tag.match(/\bsrc="(https:\/\/images\.seeklogo\.com\/logo-png\/[^"]+)"/);
    if (!altM || !srcM) continue;
    const alt = keyOf(altM[1].replace(/logo png vector/i, ''));
    if (alt === k || (alt.startsWith(k) && /^(new|dj|logo|festival|fest|music|official|\d+)*$/.test(alt.slice(k.length)))) return srcM[1].replace(/\/logo-png\/(\d+)\/2\//, '/logo-png/$1/1/');
  }
  return null;
}

// Find logo candidates on an official website: header <img>/<svg> marked "logo", touch icons, then og:image.
async function scanSite(site: string, limit = 6): Promise<string[]> {
  const r = await fetch(site, { headers: { ...UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  if (!r.ok) return [];
  const base = r.url, html = (await r.text()).slice(0, 600_000), out: string[] = [];
  const abs = (u: string) => { try { return new URL(u.replace(/&amp;/g, '&'), base).href; } catch { return ''; } };
  const add = (u: string) => { const a = abs(u); if (a && /^https:/.test(a) && !out.includes(a)) out.push(a); };
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    if (!/logo|brand|wordmark/i.test(tag)) continue;
    const src = (tag.match(/\b(?:data-src|src)="([^"]+)"/i) || [])[1] || (tag.match(/\bsrcset="([^"\s,]+)/i) || [])[1];
    if (src && !/^data:/.test(src)) add(src);
  }
  for (const m of html.matchAll(/<link\b[^>]*rel="[^"]*(?:apple-touch-icon|icon)[^"]*"[^>]*>/gi)) { const h = (m[0].match(/href="([^"]+)"/i) || [])[1]; if (h && /svg|png/i.test(h)) add(h); }
  const og = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i) || [])[1]; if (og) add(og);
  return out.slice(0, limit);
}

// Official website first: guess the domain from the name and only accept an image whose file name
// carries both the name and "logo" (e.g. Niteharts_Logo_2026.png), so sponsor logos never slip in.
async function officialSiteLogo(name: string, kind: string): Promise<string | null> {
  const k = keyOf(name); if (k.length < 3) return null;
  const tails = kind === 'festival' ? ['', 'festival', 'fest', 'music'] : kind === 'dj' ? ['', 'music', 'official', 'dj'] : kind === 'club' ? ['', 'club', 'nightclub'] : [''];
  const sites = [...new Set(tails.flatMap((t) => ['https://' + k + t + '.com/', 'https://www.' + k + t + '.com/']))];
  const lists = await Promise.all(sites.map((u) => scanSite(u, 40).catch(() => [] as string[])));
  for (const list of lists) {
    const hit = list.find((u) => { let f = ''; try { f = decodeURIComponent(new URL(u).pathname.split('/').pop() || ''); } catch { return false; }
      return /logo|wordmark/i.test(f) && keyOf(f).includes(k) && !/favicon|apple-touch|icon-\d/i.test(f); });
    if (hit) return hit;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json({ error: 'Sign in to add logos.' }, 401);

  let body: any; try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (body.scan) { try { return json({ candidates: await scanSite(String(body.scan)) }); } catch (e) { return json({ candidates: [], error: String(e) }); } }
  const name = String(body.name || '').trim().slice(0, 60), kind = String(body.kind || '');
  if (!name || !KINDS.includes(kind)) return json({ error: 'Need a name and a type.' }, 400);

  let url = String(body.url || '').trim(), source = 'link';
  try {
    if (body.auto) { url = (await officialSiteLogo(name, kind)) || ''; source = 'official site'; if (!url) { url = (await wikidataLogo(name, kind)) || ''; source = 'wikidata'; } if (!url) { url = (await wikipediaLogo(name, kind)) || ''; source = 'wikipedia'; } if (!url) { url = (await seeklogoLogo(name)) || ''; source = 'seeklogo'; } }
    if (!url) return json({ error: 'Could not find a logo for ' + name + '. Paste a link or upload one.' }, 404);
    if (!/^https:\/\//i.test(url)) return json({ error: 'Use an https link to the image.' }, 400);
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const type = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!r.ok || !OK_TYPES[type]) return json({ error: 'That link is not an image (PNG, JPG, WEBP or SVG). Right-click the logo and copy the image address.' }, 400);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > 4_000_000) return json({ error: 'That image is over 4 MB.' }, 400);
    const path = `logos/${kind}/${keyOf(name) || 'logo'}-${crypto.randomUUID().slice(0, 8)}.${OK_TYPES[type]}`;
    const up = await admin.storage.from('passport').upload(path, bytes, { contentType: type, upsert: false });
    if (up.error) throw up.error;
    const publicUrl = admin.storage.from('passport').getPublicUrl(path).data.publicUrl;
    const { data, error } = await admin.from('logos').insert({ kind, name, key: keyOf(name), url: publicUrl, source, added_by: u.user.id }).select().single();
    if (error) throw error;
    return json({ logo: data });
  } catch (e) {
    return json({ error: 'Could not add that logo: ' + String((e as Error).message || e) }, 502);
  }
});
