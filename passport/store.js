// Data layer. Uses Supabase when config.js has keys; otherwise a local demo mode
// that keeps everything in this browser so the app can be tried before the backend exists.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=1791845613';

const LIVE = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
let sb = null;
export const mode = LIVE ? 'live' : 'local';

export async function init() {
  if (!LIVE) return;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
}

/* ---------- local demo ---------- */
const LK = 'rp-local-v1';
const local = () => { try { return JSON.parse(localStorage.getItem(LK)) || { user: null, profile: null, entries: [] }; } catch (e) { return { user: null, profile: null, entries: [] }; } };
const saveLocal = s => { try { localStorage.setItem(LK, JSON.stringify(s)); } catch (e) { throw new Error('This browser is out of space for the demo. Connect the backend to save more.'); } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/* ---------- auth ---------- */
export async function currentUser() {
  if (!LIVE) return local().user;
  const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null;
}
export async function signUp({ username, email, password, invite }) {
  if (!LIVE) { const s = local(); s.user = { id: 'local', email }; s.profile = { username, name: '', home: '' }; saveLocal(s); return s.user; }
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, invite }, emailRedirectTo: new URL('./?confirmed=1', location.href.split('?')[0].split('#')[0]).href } });
  if (error) throw new Error(/invite/i.test(error.message) || /database error/i.test(error.message) ? 'That beta password did not check out. Start over from the first screen.' : error.message);
  if (!data.session) { const e = new Error('Almost there. Check your email and tap the confirm link. It brings you back here to sign in.'); e.pending = true; throw e; }
  return data.user;
}
export async function signIn({ email, password }) {
  if (!LIVE) { const s = local(); if (!s.user || s.user.email !== email) throw new Error('No passport with that email on this device.'); return s.user; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is wrong.' : error.message);
  return data.user;
}
export async function deleteLogo(id) { if (!LIVE) return; const { error } = await sb.from('logos').delete().eq('id', id); if (error) throw error; }
export async function scanSite(site) {
  if (!LIVE) return [];
  const { data } = await sb.auth.getSession(); if (!data.session) throw new Error('Sign in first.');
  const r = await fetch(SUPABASE_URL + '/functions/v1/logo-add', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify({ scan: site }), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({})); return j.candidates || [];
}
export async function isAdmin() { if (!LIVE) return false; const u = await currentUser(); if (!u) return false; const { data } = await sb.from('app_admins').select('user_id').eq('user_id', u.id).maybeSingle(); return !!data; }
export async function myId() { const u = await currentUser(); return u ? u.id : null; }

/* ---------- beta question: skip it on networks where someone has signed in ---------- */
async function gateCall(body, token) {
  const r = await fetch(SUPABASE_URL + '/functions/v1/gate-check', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (token || SUPABASE_ANON_KEY) }, body: JSON.stringify(body) });
  return r.ok ? r.json() : {};
}
export async function knownNetwork() { if (!LIVE) return false; try { return !!(await gateCall({ check: true })).known; } catch (e) { return false; } }
export async function rememberNetwork() { if (!LIVE) return; try { const { data } = await sb.auth.getSession(); if (data.session) await gateCall({ remember: true }, data.session.access_token); } catch (e) {} }
export async function signOut() { if (LIVE) await sb.auth.signOut(); else { const s = local(); s.user = null; saveLocal(s); } }

/* ---------- profile ---------- */
export async function getProfile() {
  if (!LIVE) return local().profile;
  const u = await currentUser(); if (!u) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', u.id).maybeSingle(); if (error) throw error; return data;
}
export async function saveProfile(p) {
  if (!LIVE) { const s = local(); s.profile = { ...s.profile, ...p }; saveLocal(s); return s.profile; }
  const u = await currentUser(); const row = { ...p, id: u.id, updated_at: new Date().toISOString() };
  const { data, error } = await sb.from('profiles').upsert(row).select().single(); if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'That user name is taken.' : error.message); return data;
}

/* ---------- entries (pages in the book) ---------- */
export async function listEntries() {
  if (!LIVE) return local().entries.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const { data, error } = await sb.from('entries').select('*').order('num', { ascending: true, nullsFirst: false }).order('date', { ascending: true }).order('created_at', { ascending: true }); if (error) throw error; return data;
}
export async function saveEntry(e) {
  if (!LIVE) { const s = local(); if (!e.id) e.id = uid(); const i = s.entries.findIndex(x => x.id === e.id); if (i >= 0) s.entries[i] = e; else s.entries.push(e); saveLocal(s); return e; }
  const u = await currentUser(); const row = { ...e, user_id: u.id, updated_at: new Date().toISOString() }; if (!row.id) delete row.id;
  const { data, error } = await sb.from('entries').upsert(row).select().single(); if (error) throw error; return data;
}
export async function deleteEntry(id) {
  if (!LIVE) { const s = local(); s.entries = s.entries.filter(e => e.id !== id); saveLocal(s); return; }
  const { error } = await sb.from('entries').delete().eq('id', id); if (error) throw error;
}

/* ---------- images ---------- */
export async function uploadImage(blob, kind) {
  if (!LIVE) return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  const u = await currentUser(), ext = blob.type === 'image/jpeg' ? 'jpg' : 'png', path = u.id + '/' + kind + '-' + uid() + '.' + ext;
  const { error } = await sb.storage.from('passport').upload(path, blob, { contentType: blob.type, upsert: false }); if (error) throw error;
  return sb.storage.from('passport').getPublicUrl(path).data.publicUrl;
}

/* ---------- past shows (setlist.fm via the show-search edge function) ---------- */
async function callSearch(params, signal) {
  if (!LIVE) return null;
  const url = new URL(SUPABASE_URL + '/functions/v1/shows'); Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { signal, headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } });
  if (!r.ok) throw new Error('search ' + r.status); return r.json();
}
export async function searchPast(q, signal) { const d = await callSearch({ q }, signal); return d ? d.events || [] : []; }
export async function festivalDays({ venue, city, year, from, to }, signal) { const d = await callSearch({ venue, city: city || '', year: String(year), from: from || '', to: to || '' }, signal); return d ? d.events || [] : []; }
export async function pastLineup(venueId, date) { const d = await callSearch({ venueId, date }); return d ? d.artists || [] : []; }

/* ---------- public, view-only books ---------- */
export async function getPublicBook(username) {
  if (!LIVE) return null;
  const { data: profile } = await sb.from('profiles').select('*').eq('username', username).eq('is_public', true).maybeSingle();
  if (!profile) return null;
  const { data: entries } = await sb.from('entries').select('*').eq('user_id', profile.id).order('num', { ascending: true, nullsFirst: false }).order('date', { ascending: true });
  return { profile, entries: entries || [] };
}

/* ---------- shared logo directory ---------- */
export async function listLogos() {
  if (!LIVE) return [];
  const { data, error } = await sb.from('logos').select('id,kind,name,key,url,source,added_by,created_at').order('created_at', { ascending: false }).limit(2000); if (error) throw error; return data;
}
export async function addLogo({ name, kind, url, auto }) {
  if (!LIVE) throw new Error('Connect the backend to add logos.');
  const { data } = await sb.auth.getSession(); if (!data.session) throw new Error('Sign in to add logos.');
  const r = await fetch(SUPABASE_URL + '/functions/v1/logo-add', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify({ name, kind, url, auto: !!auto }), signal: AbortSignal.timeout(45000) });
  const j = await r.json().catch(() => ({}));
  // AVIF and other formats the server can't read: convert to PNG in the browser and retry with our own copy.
  if (!r.ok && url && !auto && /not an image/i.test(j.error || '')) {
    const png = await toPng(url).catch(() => null);
    if (png) return addLogo({ name, kind, url: await uploadImage(png, 'logo') });
  }
  if (!r.ok) throw new Error(j.error || 'Could not add that logo.'); return j.logo;
}
function toPng(src) {
  return new Promise((res, rej) => {
    const i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); c.toBlob((b) => (b ? res(b) : rej(new Error('convert'))), 'image/png'); };
    i.onerror = () => rej(new Error('load')); i.src = src;
  });
}
