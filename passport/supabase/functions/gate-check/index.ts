// Supabase Edge Function: gate-check
// Remembers networks (IP addresses) where someone has signed in, so the beta question isn't asked again there.
//   POST { check: true }                         -> { known: boolean }   (no sign-in needed)
//   POST { remember: true } + user's session     -> { ok: true }         (records this network)
//   POST { name } or { guest: name }             -> { ok: boolean }      (is this name on the guest list?)
//   POST { join: { name, username, password } }  -> { email }            (makes the passport for a name on the list)
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
const GUEST_DOMAIN = 'guests.thomasbrownworks.com'; // guest-list sign-ins use username@this; no mail is ever sent there
const nameKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
  let body: any = {}; try { body = await req.json(); } catch { /* empty body is a check */ }

  if (typeof body.name === 'string' || typeof body.guest === 'string') {
    // a short pause on every try makes guessing names one by one slow
    await new Promise((r) => setTimeout(r, 600));
    const k = nameKey(body.name ?? body.guest); if (k.length < 2) return json({ ok: false });
    const { data } = await admin.from('guest_list').select('id').eq('name_key', k).maybeSingle();
    return json({ ok: !!data });
  }
  if (body.join) {
    const k = nameKey(body.join.name), username = String(body.join.username || '').trim().toLowerCase().replace(/^@/, ''), password = String(body.join.password || '');
    if (!/^[a-z0-9_.]{2,24}$/.test(username)) return json({ error: 'User name: 2 to 24 letters, numbers, dots or underscores.' }, 400);
    if (password.length < 8) return json({ error: 'Password needs at least 8 characters.' }, 400);
    const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (taken) return json({ error: 'That user name is taken.' }, 400);
    const { data: spot } = await admin.from('guest_list').update({ claimed_at: new Date().toISOString() }).eq('name_key', k).is('claimed_at', null).select('id,name').maybeSingle();
    if (!spot) {
      const { data: on } = await admin.from('guest_list').select('id').eq('name_key', k).maybeSingle();
      return json({ error: on ? 'That name already has a passport. Sign in instead, or ask Thomas.' : 'That name isn’t on the list. Ask Thomas.' }, 400);
    }
    const email = username + '@' + GUEST_DOMAIN;
    const { data: made, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, name: spot.name, guest: k }, app_metadata: { guest: k } });
    if (error || !made?.user) {
      await admin.from('guest_list').update({ claimed_at: null }).eq('id', spot.id);
      return json({ error: /already/i.test(error?.message || '') ? 'That user name is taken.' : (error?.message || 'Could not make the passport.') }, 400);
    }
    await admin.from('guest_list').update({ claimed_by: made.user.id }).eq('id', spot.id);
    return json({ email });
  }

  const ip = clientIP(req); if (!ip) return json({ known: false });
  const h = await ipHash(ip);

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
