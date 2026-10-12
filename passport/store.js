// Data layer. Uses Supabase when config.js has keys; otherwise a local demo mode
// that keeps everything in this browser so the app can be tried before the backend exists.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
  const { data, error } = await sb.from('entries').select('*').order('date', { ascending: true }).order('created_at', { ascending: true }); if (error) throw error; return data;
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
