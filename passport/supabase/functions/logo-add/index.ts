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
const KINDS = ['dj', 'festival', 'club', 'venue'];
const OK_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function wikidataLogo(name: string, kind: string): Promise<string | null> {
  const want = kind === 'dj' ? /dj|disc jockey|musician|producer|duo|group|trio|collective|singer|artist|band/i
    : kind === 'festival' ? /festival|event|rave|music/i : /club|venue|nightclub|arena|amphitheat|hall|stadium|theat|building/i;
  const s = await fetch('https://www.wikidata.org/w/api.php?format=json&action=wbsearchentities&language=en&limit=5&search=' + encodeURIComponent(name), { headers: UA }).then((r) => r.json());
  for (const hit of s.search || []) {
    if (keyOf(hit.label || '') !== keyOf(name) && !keyOf(hit.label || '').startsWith(keyOf(name))) continue;
    if (hit.description && !want.test(hit.description)) continue;
    const c = await fetch('https://www.wikidata.org/w/api.php?format=json&action=wbgetclaims&property=P154&entity=' + hit.id, { headers: UA }).then((r) => r.json());
    const file = c.claims?.P154?.[0]?.mainsnak?.datavalue?.value; if (!file) continue;
    const ii = await fetch('https://commons.wikimedia.org/w/api.php?format=json&action=query&prop=imageinfo&iiprop=url&iiurlwidth=900&titles=' + encodeURIComponent('File:' + file), { headers: UA }).then((r) => r.json());
    const info = (Object.values(ii.query?.pages || {})[0] as any)?.imageinfo?.[0];
    if (info) return info.thumburl || info.url;
  }
  return null;
}
async function wikipediaLogo(name: string, kind: string): Promise<string | null> {
  const W = 'https://en.wikipedia.org/w/api.php?format=json&';
  const q = kind === 'festival' && !/festival|fest\b/i.test(name) ? name + ' festival' : kind === 'dj' ? name + ' DJ' : name;
  const s = await fetch(W + 'action=query&list=search&srlimit=5&srsearch=' + encodeURIComponent(q), { headers: UA }).then((r) => r.json());
  const k = keyOf(name).slice(0, 8);
  for (const hit of s.query?.search || []) {
    if (!keyOf(hit.title).startsWith(k)) continue;
    const im = await fetch(W + 'action=query&prop=images&imlimit=60&redirects=1&titles=' + encodeURIComponent(hit.title), { headers: UA }).then((r) => r.json());
    const files = ((Object.values(im.query?.pages || {})[0] as any)?.images || []).map((x: any) => x.title as string)
      .filter((t: string) => /logo|wordmark/i.test(t) && !/commons|wiki|wikt|edit|question|ambox|portal|flag|symbol|icon|disambig/i.test(t));
    const pick = files.find((t: string) => keyOf(t).includes(keyOf(name).slice(0, 5)));
    if (!pick) continue;
    const ii = await fetch(W + 'action=query&prop=imageinfo&iiprop=url&iiurlwidth=900&titles=' + encodeURIComponent(pick), { headers: UA }).then((r) => r.json());
    const info = (Object.values(ii.query?.pages || {})[0] as any)?.imageinfo?.[0];
    if (info) return info.thumburl || info.url;
  }
  return null;
}
async function seeklogoLogo(name: string): Promise<string | null> {
  const h = await fetch('https://seeklogo.com/search?q=' + encodeURIComponent(name), { headers: UA }).then((r) => r.ok ? r.text() : '');
  const k = keyOf(name);
  for (const tag of h.match(/<img\b[^>]*>/g) || []) {
    const altM = tag.match(/\balt="([^"]*)"/), srcM = tag.match(/data-src="(https:\/\/images\.seeklogo\.com\/logo-png\/[^"]+)"/) || tag.match(/\bsrc="(https:\/\/images\.seeklogo\.com\/logo-png\/[^"]+)"/);
    if (!altM || !srcM) continue;
    const alt = keyOf(altM[1].replace(/logo png vector/i, ''));
    if (alt === k || (alt.startsWith(k) && /^(new|dj|logo|festival|fest|music|official|\d+)*$/.test(alt.slice(k.length)))) return srcM[1].replace(/\/logo-png\/(\d+)\/2\//, '/logo-png/$1/1/');
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
  const name = String(body.name || '').trim().slice(0, 60), kind = String(body.kind || '');
  if (!name || !KINDS.includes(kind)) return json({ error: 'Need a name and a type.' }, 400);

  let url = String(body.url || '').trim(), source = 'link';
  try {
    if (body.auto) { url = (await wikidataLogo(name, kind)) || ''; source = 'wikidata'; if (!url) { url = (await wikipediaLogo(name, kind)) || ''; source = 'wikipedia'; } if (!url) { url = (await seeklogoLogo(name)) || ''; source = 'seeklogo'; } }
    if (!url) return json({ error: 'Could not find a logo for ' + name + '. Paste a link or upload one.' }, 404);
    if (!/^https:\/\//i.test(url)) return json({ error: 'Use an https link to the image.' }, 400);
    const r = await fetch(url, { headers: UA, redirect: 'follow' });
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
