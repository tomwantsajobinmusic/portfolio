// Supabase Edge Function: gate-check
// Remembers networks (IP addresses) where someone has signed in, so the beta question isn't asked again there.
//   POST { check: true }                         -> { known: boolean }   (no sign-in needed)
//   POST { remember: true } + user's session     -> { ok: true }         (records this network)
//   POST { name: 'Jane Doe' }                    -> { ok: boolean }      (is this name on the guest list?)
// Only a keyed hash of the IP is stored, never the address itself. Entries expire after 90 days.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SECRET);
const DAYS = 90;

function clientIP(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') || '';
  return (req.headers.get('cf-connecting-ip') || xff.split(',')[0] || req.headers.get('x-real-ip') || '').trim();
}
async function ipHash(ip: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('rp-gate:' + ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const ip = clientIP(req); if (!ip) return json({ known: false });
  const h = await ipHash(ip);
  let body: any = {}; try { body = await req.json(); } catch { /* empty body is a check */ }

  if (typeof body.name === 'string') {
    // a short pause on every try makes guessing names one by one slow
    await new Promise((r) => setTimeout(r, 600));
    const key = body.name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (key.length < 2) return json({ ok: false });
    const { data } = await admin.from('beta_guests').select('name').eq('name_key', key).maybeSingle();
    return json({ ok: !!data });
  }
  if (body.remember) {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: 'Sign in first.' }, 401);
    const { error } = await admin.from('known_networks').upsert({ ip_hash: h, user_id: u.user.id, last_seen: new Date().toISOString() });
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  const { data } = await admin.from('known_networks').select('ip_hash').eq('ip_hash', h).gte('last_seen', since).maybeSingle();
  return json({ known: !!data });
});
