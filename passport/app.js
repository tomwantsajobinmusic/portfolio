import * as db from './store.js?v=1791832162';
import { engrave, passportPhoto, stamp, loadImage, fileToImage, toBlob, INKS } from './art.js?v=1791832162';

const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = sel => app.querySelector(sel);
const $$ = sel => [...app.querySelectorAll(sel)];
const toast = (t, ms = 2600) => { const el = document.getElementById('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, ms); };
const keyOf = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const ord = n => n + (n % 100 > 10 && n % 100 < 14 ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' })[n % 10] || 'TH');
const longDate = d => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); return MONTHS[m - 1] + ' ' + ord(dd) + ' ' + y; };
const stampDate = d => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); return String(dd).padStart(2, '0') + ' ' + MONTHS[m - 1].slice(0, 3) + ' ' + y; };
const cityUpper = c => String(c || '').toUpperCase();

/* ---------- beta gate ---------- */
const GATE_HASH = '3fd2e6e75cbd1c4a26c88394aca22e9bff0827d3e95952ea10cb9571694c18e2';
const normInvite = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

/* ---------- shared data ---------- */
let LOGOS = null, EVENTS = null, DEMO = false, state = { profile: null, entries: [] };
const CAT = { dj: 'DJs', festival: 'Festivals', club: 'Clubs', venue: 'Venues', promoter: 'Promoters' };
const SOCIALS = [['instagram', 'INSTAGRAM', 'https://instagram.com/'], ['tiktok', 'TIKTOK', 'https://www.tiktok.com/@'], ['soundcloud', 'SOUNDCLOUD', 'https://soundcloud.com/'], ['spotify', 'SPOTIFY', ''], ['x', 'X', 'https://x.com/'], ['website', 'WEBSITE', '']];
const socialURL = (k, v) => { v = String(v || '').trim(); if (/^https?:\/\//i.test(v)) return v; const base = (SOCIALS.find(s => s[0] === k) || [])[2]; return base ? base + v.replace(/^@/, '') : /\./.test(v) ? 'https://' + v : ''; };
const socialsHTML = p => { const so = p.theme?.socials || {}, list = SOCIALS.filter(([k]) => so[k] && socialURL(k, so[k]));
  return list.length ? `<div class="kv"><b>SOCIALS</b><i class="socials">${list.map(([k, label]) => `<a href="${esc(socialURL(k, so[k]))}" target="_blank" rel="noopener me">${label}</a>`).join(' · ')}</i></div>` : ''; };
// Logos people added by hand (link or upload) always beat ones the app found on its own; within each group, newest first.
const AUTO_SOURCES = ['official site', 'wikidata', 'wikipedia', 'seeklogo'];
const rankLogos = list => [...list].sort((a, b) => (AUTO_SOURCES.includes(a.source) - AUTO_SOURCES.includes(b.source)) || String(b.created_at).localeCompare(String(a.created_at)));
const logos = async (fresh) => { if (LOGOS && !fresh) return LOGOS;
  const base = await fetch('data/logos/index.json').then(r => r.json()).catch(() => []);
  const shared = rankLogos(await db.listLogos().catch(() => []));
  return LOGOS = [...shared.map(l => ({ cat: CAT[l.kind], name: l.name, key: l.key, src: l.url })), ...base.map(l => ({ ...l, src: 'data/' + l.file }))]; };
let FESTS = null;
const festivals = async () => FESTS || (FESTS = await fetch('data/festivals.json').then(r => r.json()).then(d => d.festivals).catch(() => []));
const events = async () => EVENTS || (EVENTS = await fetch('data/events.json').then(r => r.json()).then(d => { d.events.forEach(e => e._s = (e.n + ' ' + e.v + ' ' + e.l + ' ' + e.a.join(' ')).toLowerCase()); return d; }).catch(() => ({ events: [] })));
const coreKey = s => keyOf(String(s || '').replace(/\b(19|20)\d\d\b/g, '').replace(/\b(music|arts?|and|festival|fest|weekend ?\d?|presents|the|las vegas|ibiza|official)\b/gi, ' '));
const logoFor = (name, cats) => { const k = keyOf(name), c = coreKey(name); if (!k) return null; const L = (LOGOS || []).filter(l => !cats || cats.includes(l.cat));
  return L.find(l => l.key === k) || L.find(l => c.length > 3 && coreKey(l.name) === c) || L.find(l => l.key.length > 4 && (k.startsWith(l.key) || (k.length > 6 && l.key.startsWith(k)))) || null; };

/* ---------- router ---------- */
const routes = { gate, cover, apply, signin, setup, book, editor, logodir };
async function go(name, arg) { window.scrollTo(0, 0); await routes[name](arg); }

async function start() {
  try { await db.init(); } catch (e) { console.error(e); }
  logos();
  // Arriving from the email confirmation link: the link itself proves the beta password was used.
  const q = new URLSearchParams(location.search);
  // View-only demo of Thomas's passport: no password, no account.
  // View-only books: ?demo shows Thomas's live passport, ?u=name shows anyone who made theirs public.
  if (q.has('demo') || q.get('u')) {
    const who = (q.get('u') || 'thomasbrown').toLowerCase().replace(/^@/, '');
    let d = null; try { d = await db.getPublicBook(who); } catch (e) {}
    if ((!d || !d.entries.length) && who === 'thomasbrown') d = await fetch('data/demo/demo.json').then(r => r.json()).catch(() => null);
    if (!d) { app.innerHTML = '<section class="screen cover"><h1>Rave Passport</h1><p class="gate-q">That passport is private.</p><span></span></section>'; return; }
    DEMO = true; state = { profile: d.profile, entries: d.entries }; return go('book');
  }
  const confirmed = q.has('confirmed') || /type=signup/.test(location.hash);
  if (confirmed) {
    store.set('rp-gate', 'ok'); store.set('rp-has-account', '1');
    await new Promise(r => setTimeout(r, 300)); await db.signOut().catch(() => {});
    history.replaceState(null, '', location.pathname);
    return go('signin', 'Email confirmed. Sign in to open your passport.');
  }
  // Skip the beta question for anyone signed in, and on any network where someone has signed in before.
  const user = await db.currentUser().catch(() => null);
  if (user) { store.set('rp-gate', 'ok'); db.rememberNetwork(); }
  else if (store.get('rp-gate') !== 'ok') { if (await db.knownNetwork()) store.set('rp-gate', 'ok'); else return go('gate'); }
  if (!user) return go('cover');
  await loadMine();
  if (!state.profile || !state.profile.name) return go('setup');
  if (q.has('logos')) return go('logodir');
  go('book');
}
async function loadMine() { state.profile = await db.getProfile(); state.entries = await db.listEntries(); }

/* ---------- 0. gate ---------- */
async function gate() {
  app.innerHTML = `<section class="screen cover gate">
    <img class="seal small" src="assets/seal-gold.png" alt="">
    <form id="g" autocomplete="off">
      <p class="gate-q">What do you want?</p>
      <input id="ans" aria-label="Your answer" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="type it">
      <div class="err" id="e"></div>
      <button class="gold-btn" type="submit">Enter</button>
    </form>
    <span></span>
  </section>`;
  $('#ans').focus();
  $('#g').addEventListener('submit', async ev => {
    ev.preventDefault(); const a = normInvite($('#ans').value);
    if (await sha256(a) === GATE_HASH) { store.set('rp-gate', 'ok'); store.set('rp-invite', a); go('cover'); }
    else { $('#e').textContent = 'Not quite. Ask Thomas.'; $('#ans').select(); }
  });
}

/* ---------- 1. cover ---------- */
async function cover() {
  const returning = store.get('rp-has-account') === '1';
  app.innerHTML = `<section class="screen cover">
    <h1>Rave Passport</h1>
    <img class="seal" src="assets/seal-gold.png" alt="The rave passport crest: an eagle holding a fan and kandi under a disco ball">
    <div>
      <button class="gold-btn" id="main">${returning ? 'Continue' : 'Application'}</button><br>
      <button class="link" id="alt">${returning ? 'New here? Apply' : 'Already have a passport? Sign in'}</button>
    </div>
  </section>`;
  $('#main').onclick = () => go(returning ? 'signin' : 'apply');
  $('#alt').onclick = () => go(returning ? 'apply' : 'signin');
}

/* ---------- 2. application (sign up) ---------- */
async function apply() {
  app.innerHTML = `<section class="screen paper">
    <button class="back" id="bk">← BACK</button>
    <p class="title">TRAVELER INFORMATION</p>
    <form id="f" novalidate>
      <label class="field"><span>USER NAME</span><input id="u" autocomplete="username" autocapitalize="none" required maxlength="24" placeholder="thomasbrown"></label>
      <label class="field"><span>EMAIL</span><input id="em" type="email" autocomplete="email" required></label>
      <label class="field"><span>PASSWORD</span><input id="pw" type="password" autocomplete="new-password" minlength="8" required></label>
      <div class="err" id="e"></div>
      <button class="btn" type="submit">CONTINUE</button>
    </form>
    <p class="hint" style="margin-top:14px">${db.mode === 'local' ? 'Demo mode: your passport is saved in this browser only.' : 'Your book is private to you.'}</p>
  </section>`;
  $('#bk').onclick = () => go('cover');
  $('#f').addEventListener('submit', async ev => {
    ev.preventDefault(); const e = $('#e'); e.textContent = '';
    const username = $('#u').value.trim().toLowerCase().replace(/^@/, ''), email = $('#em').value.trim(), password = $('#pw').value;
    if (!/^[a-z0-9_.]{2,24}$/.test(username)) return e.textContent = 'User name: 2 to 24 letters, numbers, dots or underscores.';
    if (!/^\S+@\S+\.\S+$/.test(email)) return e.textContent = 'That email looks off.';
    if (password.length < 8) return e.textContent = 'Password needs at least 8 characters.';
    const b = ev.submitter; b.disabled = true;
    try { await db.signUp({ username, email, password, invite: store.get('rp-invite') || '' }); store.set('rp-has-account', '1'); db.rememberNetwork(); await loadMine(); go('setup'); }
    catch (err) { if (err.pending) { store.set('rp-has-account', '1'); return go('signin', err.message); } e.textContent = err.message; b.disabled = false; }
  });
}
async function signin(note) {
  app.innerHTML = `<section class="screen paper">
    <button class="back" id="bk">← BACK</button>
    <p class="title">WELCOME BACK</p>
    ${note ? `<p class="hint" style="text-align:center;margin:-8px 0 18px">${esc(note)}</p>` : ''}
    <form id="f">
      <label class="field"><span>EMAIL</span><input id="em" type="email" autocomplete="email" required></label>
      <label class="field"><span>PASSWORD</span><input id="pw" type="password" autocomplete="current-password" required></label>
      <div class="err" id="e"></div>
      <button class="btn" type="submit">CONTINUE</button>
    </form>
  </section>`;
  $('#bk').onclick = () => go('cover');
  $('#f').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = ev.submitter; b.disabled = true;
    try { await db.signIn({ email: $('#em').value.trim(), password: $('#pw').value }); store.set('rp-has-account', '1'); db.rememberNetwork(); await loadMine(); go(state.profile && state.profile.name ? 'book' : 'setup'); }
    catch (err) { $('#e').textContent = err.message; b.disabled = false; }
  });
}

/* ---------- 3. profile setup / edit ---------- */
async function setup() {
  const p = state.profile || {};
  app.innerHTML = `<section class="screen paper">
    ${state.profile && state.profile.name ? '<button class="back" id="bk">← BOOK</button>' : ''}
    <div class="head"><span>TRAVELER INFORMATION</span><small>@${esc(p.username || '')}</small></div>
    <div class="pf-grid">
      <label class="pf-photo filebtn" id="ph">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="Your passport photo">` : 'TAP TO ADD<br>PASSPORT<br>PHOTO'}<input type="file" accept="image/*" id="pf" aria-label="Passport photo"></label>
      <div>
        <label class="field"><span>NAME</span><input id="name" value="${esc(p.name)}" maxlength="40" placeholder="THOMAS BROWN"></label>
        <label class="field"><span>HOME</span><input id="home" value="${esc(p.home)}" maxlength="40" placeholder="AUSTIN, TX USA"></label>
      </div>
    </div>
    <div class="row2" style="margin-top:6px">
      <label class="field"><span>RAVES BEFORE THIS APP</span><input id="rb" type="number" min="0" max="9999" value="${esc(p.theme?.raves_before ?? '')}" placeholder="0"></label>
      <label class="field"><span>FESTIVALS BEFORE</span><input id="fb" type="number" min="0" max="999" value="${esc(p.theme?.fests_before ?? '')}" placeholder="0"></label>
    </div>
    <label class="field"><span>FAVORITE DJS</span><input id="djs" value="${esc(p.favorite_djs)}" maxlength="80"></label>
    <label class="field"><span>FAVORITE FESTIVAL</span><input id="fest" value="${esc(p.favorite_festival)}" maxlength="60"></label>
    <label class="field"><span>FAVORITE GENRE</span><input id="genre" value="${esc(p.favorite_genre)}" maxlength="60"></label>
    <p class="field" style="margin-top:22px"><span>SOCIALS (HANDLE OR LINK, ALL OPTIONAL)</span></p>
    <div class="row2">${SOCIALS.map(([k, label]) => `<label class="field"><span>${label}</span><input id="so-${k}" value="${esc(p.theme?.socials?.[k] || '')}" maxlength="80" autocapitalize="none" autocorrect="off" placeholder="@handle"></label>`).join('')}</div>
    <div class="err" id="e"></div>
    <button class="btn" id="save">${state.profile && state.profile.name ? 'SAVE' : 'ISSUE MY PASSPORT'}</button>
    ${state.profile && state.profile.name ? '<button class="link" id="out" style="margin-top:14px">Sign out</button>' : ''}
  </section>`;
  let photoBlob = null;
  $('#pf').onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try { const im = await fileToImage(f); const c = passportPhoto(im); photoBlob = await toBlob(c); $('#ph').firstChild.replaceWith(Object.assign(document.createElement('img'), { src: c.toDataURL(), alt: 'Your passport photo' })); }
    catch (err) { toast(err.message); }
  };
  if ($('#bk')) $('#bk').onclick = () => go('book');
  if ($('#out')) $('#out').onclick = async () => { await db.signOut(); go('cover'); };
  $('#save').onclick = async ev => {
    const b = ev.currentTarget, name = $('#name').value.trim(); if (!name) return $('#e').textContent = 'Add your name.';
    b.disabled = true;
    try {
      const row = { username: p.username, name, home: $('#home').value.trim(), favorite_djs: $('#djs').value.trim(), favorite_festival: $('#fest').value.trim(), favorite_genre: $('#genre').value.trim(),
        theme: { ...(p.theme || {}), raves_before: +$('#rb').value || 0, fests_before: +$('#fb').value || 0,
          socials: Object.fromEntries(SOCIALS.map(([k]) => [k, $('#so-' + k).value.trim()]).filter(([, v]) => v)) } };
      if (photoBlob) row.photo_url = await db.uploadImage(photoBlob, 'photo');
      state.profile = await db.saveProfile(row); go('book');
    } catch (err) { $('#e').textContent = err.message; b.disabled = false; }
  };
}

/* ---------- stamp rendering cache ---------- */
const stampCache = new Map();
async function stampURL(p) {
  const k = JSON.stringify(p); if (stampCache.has(k)) return stampCache.get(k);
  let logo = null; if (p.logo) try { logo = await loadImage(p.logo); } catch (e) {}
  const url = p.img ? p.img : p.kind === 'shot' ? 'assets/i-shot-it.png' : stamp({ ...p, logo }).toDataURL();
  stampCache.set(k, url); return url;
}

/* ---------- 4. the book ---------- */
const mrz = p => { const n = (p.name || 'RAVER').toUpperCase().replace(/[^A-Z ]/g, '').trim().split(/\s+/); const sur = n.length > 1 ? n.pop() : n[0], giv = n.join('<');
  return [('P<RVE' + sur + '<<' + giv + '<'.repeat(44)).slice(0, 44), ('R4VE' + String(state.entries.length).padStart(5, '0') + '<4RVE' + '0'.repeat(7) + 'M2610119' + '<'.repeat(44)).slice(0, 44)]; };

async function book(openIndex) {
  await logos();
  const p = state.profile, E = state.entries, tb = p.theme || {};
  // day pages of the same festival (same name, same year) count as one festival
  const fests = new Set(E.filter(e => e.kind === 'festival').map(e => e.day ? 'd:' + e.title.toLowerCase().trim() + ':' + String(e.date).slice(0, 4) : e.id)).size + (tb.fests_before || 0), raves = E.length + (tb.raves_before || 0);
  const hl = (p.highlighted && p.highlighted.length ? p.highlighted.map(id => E.find(e => e.id === id)).filter(Boolean) : E.slice(-3).reverse()).slice(0, 3);
  const [m1, m2] = mrz(p);
  app.innerHTML = `<div class="book" id="bk">
    <article class="page covr" data-i="cover"><h1>Rave Passport</h1><img src="assets/seal-gold.png" alt="The rave passport crest"><p>${esc(p.name || '')}</p></article>
    <article class="page" data-i="0">
      <div class="inner pf">
        <p class="pf-handle">@${esc(p.username || '')}</p>
        <div class="head" style="margin-top:4px"><span>TRAVELER INFORMATION</span></div>
        <div class="pf-grid">
          <div class="pf-photo">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : 'NO PHOTO'}</div>
          <div><div class="kv"><b>NAME</b><i>${esc(p.name)}</i></div><div class="kv"><b>HOME</b><i>${esc(p.home)}</i></div>
          <div class="kv"><b>RAVES ATTENDED</b><i>${raves}</i></div><div class="kv"><b>FESTIVALS ATTENDED</b><i>${String(fests).padStart(2, '0')}</i></div></div>
        </div>
        <div class="pf-low">
          ${p.favorite_djs ? `<div class="kv"><b>FAVORITE DJS</b><i>${esc(p.favorite_djs)}</i></div>` : ''}
          ${p.favorite_festival ? `<div class="kv"><b>FAVORITE FESTIVAL</b><i>${esc(p.favorite_festival)}</i></div>` : ''}
          ${p.favorite_genre ? `<div class="kv"><b>FAVORITE GENRE</b><i>${esc(p.favorite_genre)}</i></div>` : ''}
          ${socialsHTML(p)}
          <div class="kv"><b>HIGHLIGHTED STAMPS</b></div><div class="pf-stamps" id="hl"></div>
        </div>
        <div class="mrz" aria-hidden="true">${esc(m1)}<br>${esc(m2)}</div>
      </div>
    </article>
    ${E.map((e, i) => `<article class="page tint-${esc(e.bg?.tint || 'cream')}" data-i="${i + 1}" data-id="${esc(e.id)}">
      <span class="num">#${e.num || (tb.raves_before || 0) + i + 1}</span>
      ${e.bg?.url ? `<img class="art" src="${esc(e.bg.url)}" alt="" style="${e.bg.y != null ? `top:${+e.bg.y}%;` : ''}${e.bg.s ? `width:${86 * e.bg.s}%;` : ''}">` : ''}
      <div class="stamps" data-id="${esc(e.id)}"></div>
      <div class="facts">
        <h2>${esc(e.title)}${e.kind === 'festival' && e.day ? ` <small class="day">DAY ${+e.day}</small>` : ''}</h2>
        ${e.artists?.length ? `<p><span>${e.kind === 'festival' || e.artists.length > 1 ? 'ARTISTS' : 'LINEUP'}:</span> ${esc(e.artists.join(', '))}</p>` : ''}
        <p><span>DATE:</span> ${esc(longDate(e.date))}</p>
        <p><span>CITY:</span> ${esc(cityUpper(e.city))}</p>
        <p class="notes"><span>NOTES:</span> ${esc(e.notes || '')}</p>
      </div>
    </article>`).join('')}
  </div>
  <span class="dots" id="dots"></span>
  <nav class="bar" id="bar">${DEMO ? '<button class="primary" id="own">Get your own passport</button>' : `
    <button id="prof">Profile</button>
    <button id="lgs">Logos</button>
    <button class="primary" id="add">+ Add show</button>
    <button id="edit" class="hidden">Edit page</button>`}
  </nav>`;
  // stamps
  for (const e of E) { const host = app.querySelector(`.stamps[data-id="${CSS.escape(e.id)}"]`); await drawStamps(host, e.stamps || []); }
  const hlHost = $('#hl'); for (const e of hl) { const s = (e.stamps || [])[0]; if (s) { const im = new Image(); im.src = await stampURL(s.p); im.alt = e.title; hlHost.append(im); } }
  // paging
  const bk = $('#bk'), dots = $('#dots');
  const cur = () => Math.round(bk.scrollLeft / bk.clientWidth);
  // page 0 is the cover, 1 the profile, 2+ the shows
  const pages = [...bk.querySelectorAll('.page')];
  const turn = () => { const w = bk.clientWidth, x = bk.scrollLeft; pages.forEach((pg, i) => { const d = (i * w - x) / w; // -1..1 around the open page
      if (Math.abs(d) >= 1) { pg.style.transform = ''; return; }
      pg.style.transformOrigin = d < 0 ? 'right center' : 'left center';
      pg.style.transform = `rotateY(${(-d * 32).toFixed(2)}deg) scale(${(1 - Math.abs(d) * .06).toFixed(3)})`; pg.style.filter = `brightness(${(1 - Math.abs(d) * .25).toFixed(3)})`; }); };
  const upd = () => { const i = cur(); dots.textContent = i === 0 ? 'COVER' : i === 1 ? 'PROFILE' : (i - 1) + ' / ' + E.length; if (!DEMO) $('#edit').classList.toggle('hidden', i < 2); $('#bar').style.background = i === 0 ? 'none' : ''; turn(); };
  bk.addEventListener('scroll', () => requestAnimationFrame(upd)); upd();
  bk.style.scrollBehavior = 'auto'; bk.scrollLeft = ((openIndex || 0) + 1) * bk.clientWidth; requestAnimationFrame(() => { bk.scrollLeft = ((openIndex || 0) + 1) * bk.clientWidth; upd(); });
  if (DEMO) { $('#own').onclick = () => { DEMO = false; history.replaceState(null, '', location.pathname); start(); }; if (openIndex == null) toast('Swipe to flip through ' + (state.profile.name ? state.profile.name.split(' ')[0] + '’s' : 'this') + ' passport.', 3000); return; }
  $('#prof').onclick = () => go('setup');
  if ($('#lgs')) $('#lgs').onclick = () => go('logodir');
  $('#add').onclick = () => go('editor', null);
  $('#edit').onclick = () => { const i = cur(); if (i > 1) go('editor', E[i - 2]); };
  if (!E.length) toast('Tap “+ Add show” to stamp your first page.', 3500);
}
async function drawStamps(host, list, editing) {
  host.innerHTML = '';
  for (const s of list) {
    const im = new Image(); im.src = await stampURL(s.p); im.alt = s.p.top || s.p.label || 'stamp'; im.dataset.k = s.k; im.draggable = false;
    im.style.left = s.x + '%'; im.style.top = s.y + '%'; im.style.width = (44 * (s.s || 1)) + '%'; im.style.transform = `translate(-50%,-50%) rotate(${s.r || 0}deg)`;
    host.append(im);
  }
  host.classList.toggle('editing', !!editing);
}

/* ---------- 5. add / edit a page ---------- */
async function editor(existing) {
  await logos(true);
  const isNew = !existing;
  const e = existing ? JSON.parse(JSON.stringify(existing)) : { kind: 'show', title: '', venue: '', city: '', date: new Date().toISOString().slice(0, 10), artists: [], lineup: [], notes: '', bg: { tint: 'cream' }, stamps: [], shot_it: false };
  let bgBlob = null;
  app.innerHTML = `<section class="screen sheet paper">
    <button class="back" id="bk">← BOOK</button>
    <p class="title">${isNew ? 'NEW PAGE' : 'EDIT PAGE'}</p>

    <div class="section"><h3>1. FIND THE SHOW</h3>
      <label class="field"><span>SEARCH FESTIVALS, ARTISTS, VENUES, CITIES</span><input id="q" placeholder="ACL, Fisher, Concourse, Austin…" autocomplete="off"></label>
      <div class="results" id="res" role="listbox" aria-label="Shows"></div>
      <p class="hint" style="margin-top:8px">Shows from <a href="https://www.setlist.fm" target="_blank" rel="noopener">setlist.fm</a> and <a href="https://www.bandsintown.com" target="_blank" rel="noopener">Bandsintown</a>, upcoming from <a href="https://edmtrain.com" target="_blank" rel="noopener">Edmtrain</a>. Search the artist and venue, like “mau p pacha”. Not there? Fill it in below.</p>
    </div>

    <div class="section"><h3>2. THE DETAILS</h3>
      <label class="field"><span>FESTIVAL OR SHOW NAME</span><input id="t" value="${esc(e.title)}" maxlength="60"></label>
      <div class="row2"><label class="field"><span>VENUE</span><input id="v" value="${esc(e.venue)}" maxlength="60"></label><label class="field"><span>CITY</span><input id="c" value="${esc(e.city)}" maxlength="40"></label></div>
      <div class="row2"><label class="field"><span>DATE</span><input id="d" type="date" value="${esc(e.date)}"></label>
      <label class="field"><span>TYPE</span><select id="k"><option value="show">Show</option><option value="festival">Festival</option></select></label></div>
      <div id="dayRow" class="hidden" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="chip"><input type="checkbox" id="dayOn" ${e.day ? 'checked' : ''}> This page is one day of the festival</label>
        <select id="day" aria-label="Which day" style="padding:7px 10px;border:1px solid var(--line);border-radius:4px;background:rgba(255,255,255,.6)" ${e.day ? '' : 'disabled'}>${[1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}" ${+e.day === n ? 'selected' : ''}>Day ${n}</option>`).join('')}</select>
      </div>
    </div>

    <div class="section"><h3>3. SETS I SAW</h3>
      <div class="chips" id="sets"></div>
      <div class="row2" style="margin-top:10px"><input id="addA" class="field" style="margin:0;padding:9px 11px;border:1px solid var(--line);border-radius:4px;background:rgba(255,255,255,.55)" placeholder="Add an artist"><button class="btn small ghost" id="addAB">ADD</button></div>
    </div>

    <div class="section"><h3>4. PAGE ART</h3>
      <div class="arts" id="arts"></div>
      <p class="hint" style="margin-top:8px">Pick a logo or upload a photo. It gets engraved like a passport page.</p>
      <div id="missing" style="margin-top:14px"></div>
    </div>

    <div class="section"><h3>5. STAMPS</h3>
      <div class="chips" id="stp"></div>
      <label class="chip" style="margin-top:8px"><input type="checkbox" id="shot" ${e.shot_it ? 'checked' : ''}> I shot it</label>
    </div>

    <div class="section"><h3>6. NOTES</h3>
      <label class="field"><textarea id="n" maxlength="400" aria-label="Notes">${esc(e.notes)}</textarea></label>
    </div>
    <div class="err" id="err"></div>
    <button class="btn" id="save">${isNew ? 'MAKE THE PAGE' : 'SAVE'}</button>
    ${isNew ? '' : '<button class="btn ghost" id="del" style="margin-top:10px">DELETE PAGE</button>'}
  </section>`;
  $('#k').value = e.kind;
  const syncDay = () => { const f = $('#k').value === 'festival'; $('#dayRow').classList.toggle('hidden', !f); $('#day').disabled = !$('#dayOn').checked; $('#day').classList.toggle('hidden', !$('#dayOn').checked); };
  $('#k').onchange = () => { e.kind = $('#k').value; syncDay(); drawStampChoices(); };
  $('#dayOn').onchange = () => { syncDay(); e.day = $('#dayOn').checked ? +$('#day').value : null; drawStampChoices(); };
  $('#day').onchange = () => { e.day = +$('#day').value; drawStampChoices(); };
  syncDay();
  $('#bk').onclick = () => go('book', existing ? state.entries.indexOf(existing) + 1 : 0);

  // search
  const res = $('#res'); let picked = null, past = [], pastQ = '', pastBusy = false, ctrl = null, timer = 0, fest = [], festQ = '', festBusy = false;
  // Festivals: setlist.fm files them under their venue, so look the festival up by venue and year and offer each day.
  const fetchFest = async q => {
    const qk = coreKey(q); fest = []; festQ = q; if (qk.length < 3) return;
    const hits = (await festivals()).filter(f => [f.name, ...(f.aliases || [])].some(n => { const k = coreKey(n); return k.startsWith(qk) || (qk.startsWith(k) && k.length >= 4); })).slice(0, 2);
    if (!hits.length) return;
    festBusy = true; showResults();
    const cy = new Date().getFullYear(), out = [];
    await Promise.all(hits.map(async f => {
      const years = await Promise.all([cy, cy - 1, cy - 2].map(y => db.festivalDays({ venue: f.venue, city: f.cityQ, year: y, from: f.from, to: f.to }).catch(() => [])));
      [cy, cy - 1, cy - 2].forEach((y, yi) => {
        const known = (f.dates || {})[y] || [], got = years[yi].filter(r => r.a.length >= 3);
        const days = [...new Set([...known, ...got.map(r => r.d)])].sort();
        if (!days.length) return;
        const dayRows = days.map((d, i) => { const r = got.find(x => x.d === d); return { id: 'fest:' + f.name + ':' + d, n: f.name + ' ' + y + (days.length > 1 ? ' · Day ' + (i + 1) : ''), t: f.name, d, v: f.venue, l: f.city, a: r ? r.a : [], f: 1, src: 'festival', day: days.length > 1 ? i + 1 : null }; });
        if (days.length > 1) out.push({ id: 'fest:' + f.name + ':' + y, n: f.name + ' ' + y + ' · Whole festival', t: f.name, d: days[0], v: f.venue, l: f.city, a: [...new Set(dayRows.flatMap(r => r.a))], f: 1, src: 'festival', day: null });
        out.push(...dayRows);
      });
    }));
    if (festQ === q) { fest = out; festBusy = false; showResults(); }
  };
  const fetchPast = q => { fetchFest(q); clearTimeout(timer); if (ctrl) ctrl.abort(); if (q.length < 3) { past = []; pastQ = ''; return; }
    timer = setTimeout(async () => { ctrl = new AbortController(); pastBusy = true; showResults();
      try { past = await db.searchPast(q, ctrl.signal); pastQ = q; } catch (x) { if (x.name !== 'AbortError') { past = []; pastQ = q; } } pastBusy = false; showResults(); }, 450); };
  const pick = async x => { picked = x;
    e.event_id = x.src ? null : x.id; e.title = x.t || x.n || x.v; e.venue = x.v; e.city = x.l; e.date = x.d; e.kind = x.f ? 'festival' : 'show'; e.lineup = x.a.slice(); e.artists = x.src && x.a.length === 1 ? [...new Set([...(isNew ? [] : e.artists), ...x.a])] : isNew ? [] : e.artists;
    $('#t').value = e.title; $('#v').value = e.venue; $('#c').value = e.city; $('#d').value = e.date; $('#k').value = e.kind;
    if (x.src === 'festival') { e.day = x.day || null; $('#dayOn').checked = !!x.day; if (x.day) $('#day').value = x.day; }
    syncDay();
    if (e.kind === 'festival') chosen.delete('venue'); // festival stamp starts off; the logo is the page art instead
    await autoFestivalArt();
    showResults(); drawSets(); drawArts(); drawStampChoices(); drawMissing();
    if (x.src && x.venueId) { try { const all = await db.pastLineup(x.venueId, x.d); if (all.length) { e.lineup = [...new Set([...all, ...e.lineup])]; if (all.length > 4 && e.kind !== 'festival') { e.kind = 'festival'; $('#k').value = 'festival'; chosen.delete('venue'); await autoFestivalArt(); } drawSets(); drawArts(); drawStampChoices(); drawMissing(); } } catch (err) {} } };
  // Festivals: their logo becomes the page background automatically (found and added to the directory if missing).
  const autoFestivalArt = async () => {
    if (e.kind !== 'festival' || !e.title || (artChoice && artChoice.kind !== 'logo')) return;
    let fl = logoFor(e.title, ['Festivals']);
    if (!fl) { await logos(true); fl = logoFor(e.title, ['Festivals']); }
    if (!fl) { toast('Finding the ' + e.title + ' logo…', 4000); try { await db.addLogo({ name: e.title, kind: 'festival', auto: true }); await logos(true); fl = logoFor(e.title, ['Festivals']); } catch (err) {} }
    if (fl) { artChoice = { kind: 'logo', src: fl.src }; toast(e.title + ' logo added as the page art.'); drawArts(); drawMissing(); return; }
    // not found anywhere: say so and open the add-a-logo form right there
    toast('Couldn’t find a ' + e.title + ' logo. Paste a link to it below.', 5000);
    openFor = e.title; drawMissing(); $('#missing').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const showResults = async () => {
    const q = $('#q').value.trim().toLowerCase(); if (!q) { res.innerHTML = ''; res.style.display = 'none'; return; }
    const D = await events(), words = q.split(/\s+/);
    const up = D.events.filter(x => words.every(w => x._s.includes(w))).sort((a, b) => (b.n.toLowerCase().includes(q) - a.n.toLowerCase().includes(q)) || (a.d < b.d ? -1 : 1)).slice(0, 25);
    const old = pastQ === q ? past.slice().sort((a, b) => (a.d < b.d ? 1 : -1)) : [];
    const fr = festQ === q ? fest : [];
    const rows = [...fr, ...old, ...up];
    const item = (x, i) => `<button type="button" data-i="${i}" aria-pressed="${picked === x}"><b>${esc(x.n || (x.src ? x.a.join(', ') + ' at ' + x.v : x.a.slice(0, 3).join(', ')))}</b><small>${esc(x.d)} · ${esc(x.v)} · ${esc(x.l)}${x.src ? '' : ' · ' + x.a.length + ' artists'}</small></button>`;
    const head = t => `<p class="hint" style="padding:6px 12px;margin:0;font:600 10px var(--mono);letter-spacing:.12em;background:rgba(10,49,97,.06)">${t}</p>`;
    res.style.display = '';
    const fitem = (x, i) => `<button type="button" data-i="${i}" aria-pressed="${picked === x}"><b>${esc(x.n)}</b><small>${esc(x.d)} · ${esc(x.v)} · ${esc(x.l)} · ${x.a.length ? x.a.length + ' artists' : 'lineup not logged yet, add the sets you saw'}</small></button>`;
    res.innerHTML = (fr.length ? head('FESTIVALS') + fr.map((x, i) => fitem(x, i)).join('') : festBusy ? head('LOOKING UP FESTIVAL DAYS…') : '') +
      (old.length ? head('SHOWS · SETLIST.FM + BANDSINTOWN') + old.map((x, i) => item(x, fr.length + i)).join('') : pastBusy ? head('SEARCHING PAST SHOWS…') : '') +
      (up.length ? head('TODAY AND UPCOMING · EDMTRAIN') + up.map((x, i) => item(x, fr.length + old.length + i)).join('') : '') +
      (!fr.length && !festBusy && !old.length && !up.length && !pastBusy ? '<p class="hint" style="padding:10px">No matches. Try the artist and the venue, like “mau p pacha”, or fill it in below.</p>' : '');
    $$('#res button').forEach(b => b.onclick = () => pick(rows[+b.dataset.i]));
  };
  $('#q').addEventListener('input', () => { fetchPast($('#q').value.trim().toLowerCase()); showResults(); });


  // sets
  const drawSets = () => { const all = [...new Set([...(e.lineup || []), ...(e.artists || [])])];
    $('#sets').innerHTML = all.length ? all.map(a => { const lg = logoFor(a, ['DJs']); return `<button type="button" class="chip" data-a="${esc(a)}" aria-pressed="${e.artists.includes(a)}">${lg ? `<img src="${esc(lg.src)}" alt="">` : ''}${esc(a)}</button>`; }).join('') : '<p class="hint">Pick a show above or add artists yourself.</p>';
    $$('#sets [data-a]').forEach(b => b.onclick = () => { const a = b.dataset.a; e.artists = e.artists.includes(a) ? e.artists.filter(x => x !== a) : [...e.artists, a]; drawSets(); drawArts(); drawStampChoices(); drawMissing(); }); };
  $('#addAB').onclick = () => { const a = $('#addA').value.trim(); if (!a) return; if (!e.artists.includes(a)) e.artists.push(a); $('#addA').value = ''; drawSets(); drawArts(); drawStampChoices(); };
  drawSets();

  // page art choices: venue/festival logo, artist logos, upload, none
  let artChoice = e.bg?.url ? { kind: 'keep' } : null;
  const drawArts = () => {
    const opts = []; const vl = logoFor(e.title, ['Festivals', 'Promoters', 'Clubs', 'Venues']) || logoFor(e.venue, ['Clubs', 'Venues', 'Festivals']); if (vl) opts.push({ label: vl.name, src: vl.src });
    e.artists.forEach(a => { const lg = logoFor(a, ['DJs']); if (lg && !opts.some(o => o.src === lg.src)) opts.push({ label: lg.name, src: lg.src }); });
    $('#arts').innerHTML = (e.bg?.url ? `<button type="button" data-k="keep" aria-pressed="${artChoice?.kind === 'keep'}"><img src="${esc(e.bg.url)}" alt="Current art"></button>` : '') +
      opts.map((o, i) => `<button type="button" data-o="${i}" aria-pressed="${artChoice?.src === o.src}" title="${esc(o.label)}"><img src="${esc(o.src)}" alt="${esc(o.label)}"></button>`).join('') +
      `<label class="filebtn" style="aspect-ratio:1;border:1px dashed var(--line);border-radius:4px;display:flex;align-items:center;justify-content:center;text-align:center;font:500 11px var(--sans);color:var(--muted)">${artChoice?.kind === 'upload' ? 'PHOTO ADDED ✓' : 'UPLOAD<br>PHOTO OR LOGO'}<input type="file" accept="image/*" id="up"></label>` +
      `<button type="button" data-k="none" aria-pressed="${artChoice?.kind === 'none'}">NO ART</button>`;
    $$('#arts [data-o]').forEach(b => b.onclick = () => { artChoice = { kind: 'logo', src: opts[+b.dataset.o].src }; drawArts(); });
    $$('#arts [data-k]').forEach(b => b.onclick = () => { artChoice = { kind: b.dataset.k }; drawArts(); });
    $('#up').onchange = ev => { const f = ev.target.files[0]; if (f) { artChoice = { kind: 'upload', file: f }; drawArts(); } };
  };
  drawArts();

  // logos nobody has added yet: let travelers fill the shared directory
  let openFor = null;
  const drawMissing = () => {
    const need = [];
    if (e.title && e.kind === 'festival' && !logoFor(e.title, ['Festivals'])) need.push({ name: e.title, kind: 'festival' });
    if (e.venue && !logoFor(e.venue, ['Clubs', 'Venues', 'Festivals'])) need.push({ name: e.venue, kind: e.kind === 'festival' ? 'venue' : 'club' });
    e.artists.forEach(a => { if (!logoFor(a, ['DJs'])) need.push({ name: a, kind: 'dj' }); });
    const host = $('#missing'); if (!need.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<p class="hint" style="margin:0 0 8px">No logo yet for these. Add one and it’s there for everyone:</p><div class="chips">${need.map((n, i) => `<button type="button" class="chip" data-m="${i}" aria-pressed="${openFor === n.name}">+ ${esc(n.name)}</button>`).join('')}</div>
      <div id="mform"></div>`;
    $$('#missing [data-m]').forEach(b => b.onclick = () => { const n = need[+b.dataset.m]; openFor = openFor === n.name ? null : n.name; drawMissing(); if (openFor) logoForm(n); });
    const cur = need.find(n => n.name === openFor); if (cur) logoForm(cur);
  };
  const logoForm = n => {
    $('#mform').innerHTML = `<div style="margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:6px;background:rgba(255,255,255,.55)">
      <p style="margin:0 0 10px;font:600 12px var(--mono);letter-spacing:.08em">${esc(n.name.toUpperCase())} · ${n.kind === 'dj' ? 'ARTIST' : n.kind.toUpperCase()} LOGO</p>
      <button type="button" class="btn small" id="lgAuto">FIND IT FOR ME</button>
      <div class="row2" style="margin-top:10px"><input id="lgUrl" placeholder="or paste an image link" style="padding:9px 11px;border:1px solid var(--line);border-radius:4px;background:#fff;font-size:14px;min-width:0"><button type="button" class="btn small ghost" id="lgAdd">ADD LINK</button></div>
      <label class="btn small ghost filebtn" style="margin-top:10px">UPLOAD A FILE<input type="file" accept="image/*" id="lgFile"></label>
      <p class="hint" id="lgMsg" style="margin:8px 0 0">Tip: right-click a logo on the web, choose “Copy image address”, paste it here.</p></div>`;
    const msg = t => $('#lgMsg').textContent = t;
    const done = async () => { await logos(true); openFor = null; toast(n.name + ' logo added. Thanks!'); drawSets(); drawArts(); drawStampChoices(); drawMissing(); };
    const run = async (args, btn) => { btn.disabled = true; msg('Working on it…'); try { await db.addLogo({ name: n.name, kind: n.kind, ...args }); await done(); } catch (x) { msg(x.message); btn.disabled = false; } };
    $('#lgAuto').onclick = ev => run({ auto: true }, ev.currentTarget);
    $('#lgAdd').onclick = ev => { const u = $('#lgUrl').value.trim(); if (!u) return msg('Paste a link to the logo image first.'); run({ url: u }, ev.currentTarget); };
    $('#lgFile').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; if (f.size > 4e6) return msg('That file is over 4 MB.');
      msg('Uploading…'); try { const url = await db.uploadImage(f, 'logo-src'); await run({ url }, $('#lgAdd')); } catch (x) { msg(x.message || 'Upload failed.'); } };
  };
  drawMissing();

  // stamp choices
  const autoStamps = () => {
    const out = [], date = stampDate(e.date), city = cityUpper((e.city || '').split(',')[0]);
    const vl = e.kind === 'festival' ? logoFor(e.title, ['Festivals']) || logoFor(e.venue, ['Clubs', 'Venues']) : logoFor(e.venue, ['Clubs', 'Venues']) || logoFor(e.title, ['Festivals', 'Clubs', 'Venues']);
    if (e.venue || e.title) out.push({ id: 'venue', label: e.kind === 'festival' ? e.title : e.venue || e.title, p: { shape: 'rect', top: (e.kind === 'festival' ? e.title : e.venue || e.title).toUpperCase(), bottom: cityUpper(e.city).replace(', ', ' · '), date, small: e.kind === 'festival' && e.day ? 'DAY ' + e.day : 'ADMITTED', logo: vl ? vl.src : null, ink: INKS.red } });
    e.artists.forEach((a, i) => { const lg = logoFor(a, ['DJs']); const ink = [INKS.violet, INKS.navy, INKS.green, INKS.pink, INKS.black][i % 5];
      out.push({ id: 'a:' + a, label: a, p: lg ? { shape: 'logo', logo: lg.src, ink, seed: i + 3 } : { shape: 'circle', top: a.toUpperCase(), bottom: city, date, ink, seed: i + 3 } }); });
    return out;
  };
  let chosen = new Set((e.stamps || []).map(s => s.k));
  if (isNew) chosen = new Set(['venue']);
  const drawStampChoices = () => { const A = autoStamps(); if (isNew) e.artists.forEach(a => chosen.add('a:' + a));
    $('#stp').innerHTML = A.map(s => `<button type="button" class="chip" data-k="${esc(s.id)}" aria-pressed="${chosen.has(s.id)}">${esc(s.label)}</button>`).join('') || '<p class="hint">Stamps appear once there is a show.</p>';
    $$('#stp [data-k]').forEach(b => b.onclick = () => { const k = b.dataset.k; chosen.has(k) ? chosen.delete(k) : chosen.add(k); b.setAttribute('aria-pressed', chosen.has(k)); }); };
  drawStampChoices();

  if (!isNew) $('#del').onclick = async () => { if (!confirm('Delete this page? This cannot be undone.')) return; await db.deleteEntry(e.id); state.entries = await db.listEntries(); go('book'); };

  $('#save').onclick = async ev => {
    const b = ev.currentTarget, err = $('#err'); err.textContent = '';
    e.title = $('#t').value.trim(); e.venue = $('#v').value.trim(); e.city = $('#c').value.trim(); e.date = $('#d').value; e.kind = $('#k').value; e.notes = $('#n').value.trim(); e.shot_it = $('#shot').checked;
    e.day = e.kind === 'festival' && $('#dayOn').checked ? +$('#day').value : null;
    if (!e.title) return err.textContent = 'Give the page a name.'; if (!e.date) return err.textContent = 'Add the date.';
    b.disabled = true; b.textContent = 'ENGRAVING…';
    try {
      if (artChoice && artChoice.kind !== 'keep') {
        if (artChoice.kind === 'none') e.bg = { ...e.bg, url: null };
        else { const im = artChoice.kind === 'upload' ? await fileToImage(artChoice.file) : await loadImage(artChoice.src);
          const c = engrave(im, { style: 'passport', ink: INKS.navy, max: 900 }); e.bg = { ...e.bg, url: await db.uploadImage(await toBlob(c), 'art') }; }
      }
      // keep positions of stamps that stay, place new ones in an open spot
      const old = new Map((e.stamps || []).map(s => [s.k, s])), A = autoStamps(); if (e.shot_it) A.push({ id: 'shot', label: 'I shot it', p: { kind: 'shot' } });
      const spots = [[27, 18], [73, 24], [30, 42], [72, 47], [50, 31], [24, 58], [76, 60]]; let si = 0;
      // stamps the editor didn't generate (imported art, custom uploads) are kept exactly as they are
      const autoIds = new Set([...A.map(s => s.id), 'shot']), custom = (e.stamps || []).filter(s => !autoIds.has(s.k));
      e.stamps = [...custom, ...A.filter(s => chosen.has(s.id) || s.id === 'shot').map(s => { const o = old.get(s.id); if (o) return o.p && o.p.img ? o : { ...o, p: s.p };
        const [x, y] = spots[si++ % spots.length]; return { k: s.id, p: s.p, x, y, r: Math.round(Math.random() * 24 - 12), s: s.p.shape === 'logo' ? .62 : s.p.kind === 'shot' ? .62 : .72 }; })];
      delete e._s; const saved = await db.saveEntry(e); state.entries = await db.listEntries();
      go('customize', saved.id || e.id);
    } catch (x) { console.error(x); err.textContent = x.message || 'Could not save. Try again.'; b.disabled = false; b.textContent = isNew ? 'MAKE THE PAGE' : 'SAVE'; }
  };
}

/* ---------- 7. logo directory portal: add DJ / club / venue / festival / promoter logos by link ---------- */
const KIND_LABEL = { dj: 'DJ / ARTIST', club: 'CLUB', venue: 'VENUE', festival: 'FESTIVAL', promoter: 'PROMOTER / BRAND' };
async function logodir() {
  const me = await db.myId(), admin = await db.isAdmin();
  let shared = await db.listLogos().catch(() => []), filter = 'all', query = '', candidates = [], previewOK = false, fileBlob = null;
  const base = await fetch('data/logos/index.json').then(r => r.json()).catch(() => []);
  const KINDOF = { DJs: 'dj', Clubs: 'club', Venues: 'venue', Festivals: 'festival', Promoters: 'promoter' };
  // one logo per name and type: the newest shared one wins, then the built-in one (same order the passport uses)
  const all = () => { const seen = new Set(), out = [];
    for (const l of [...rankLogos(shared).map(l => ({ ...l, mine: l.added_by === me })), ...base.map(l => ({ name: l.name, kind: KINDOF[l.cat] || 'dj', key: keyOf(l.name), url: 'data/' + l.file, builtin: true }))]) {
      const id = l.kind + ':' + l.key; if (seen.has(id)) continue; seen.add(id); out.push({ ...l, editable: admin || l.mine }); }
    return out; };
  app.innerHTML = `<section class="screen sheet paper logodir">
    <button class="back" id="bk">← BOOK</button>
    <p class="title">LOGO DIRECTORY</p>
    <p class="hint" style="margin:-6px 0 18px">Every logo here can be engraved as page art or stamped on anyone’s passport. Paste a link to the logo image, check the preview, then add it.</p>

    <div class="section"><h3>ADD A LOGO</h3>
      <div class="row2">
        <label class="field"><span>NAME</span><input id="lName" maxlength="60" placeholder="Disco Donnie Presents" autocomplete="off"></label>
        <label class="field"><span>TYPE</span><select id="lKind">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      </div>
      <div id="dupe"></div>
      <label class="field"><span>LOGO IMAGE LINK</span><input id="lUrl" inputmode="url" autocapitalize="none" autocorrect="off" placeholder="https://…/logo.png"></label>
      <p class="hint" style="margin:-8px 0 12px">On a computer: right-click the logo, “Copy image address”. On a phone: press and hold the logo, “Copy”. PNG or SVG with a see-through background works best.</p>
      <details class="more"><summary>Don’t have the image link? Find it from their website</summary>
        <div class="row2" style="margin-top:10px"><input id="lSite" class="inp" inputmode="url" autocapitalize="none" placeholder="their website, like discodonnie.com"><button type="button" class="btn small ghost" id="lScan">FIND LOGOS</button></div>
        <div class="cands" id="cands"></div>
      </details>
      <details class="more"><summary>Or upload an image file</summary>
        <label class="btn small ghost filebtn" style="margin-top:10px">CHOOSE FILE<input type="file" accept="image/*" id="lFile"></label>
      </details>
      <div class="lprev hidden" id="prev"><div class="on-light"><img id="pv1" alt=""></div><div class="on-dark"><img id="pv2" alt=""></div></div>
      <button type="button" class="btn small ghost hidden" id="lClear" style="margin-top:10px">CLEAR THE BACKGROUND</button>
      <p class="hint" id="lMsg" style="margin:10px 0 0"></p>
      <button class="btn" id="lAdd" disabled style="margin-top:12px">ADD TO DIRECTORY</button>
    </div>

    <div class="section"><h3>IN THE DIRECTORY <small id="cnt"></small></h3>
      <input id="lq" class="inp" placeholder="Search logos" autocomplete="off" style="width:100%;margin-bottom:10px">
      <div class="chips" id="kf">${['all', ...Object.keys(KIND_LABEL)].map(k => `<button type="button" class="chip" data-k="${k}" aria-pressed="${k === 'all'}">${k === 'all' ? 'ALL' : KIND_LABEL[k].split(' ')[0]}</button>`).join('')}</div>
      <div class="lgrid" id="grid"></div>
    </div>
  </section>`;
  $('#bk').onclick = () => go('book');
  const msg = (t, bad) => { const m = $('#lMsg'); m.textContent = t; m.style.color = bad ? '#a3271f' : ''; };
  const canAdd = () => { $('#lAdd').disabled = !(previewOK && $('#lName').value.trim()); };

  // preview: the logo shows on light and dark paper so a wrong or invisible image is obvious before it's saved
  const preview = src => { previewOK = false; canAdd();
    if (!src) { $('#prev').classList.add('hidden'); $('#lClear').classList.add('hidden'); msg(''); return; }
    $('#prev').classList.remove('hidden'); msg('Loading preview…');
    const ok = () => { previewOK = true; $('#lClear').classList.remove('hidden'); msg('Is this the right logo? If yes, add it. Stuck in a white or black box? Clear the background first.'); canAdd(); };
    const bad = () => { $('#prev').classList.add('hidden'); $('#lClear').classList.add('hidden'); msg('That link didn’t load as an image. Make sure it’s the image address, not the page address.', true); };
    $('#pv1').onload = ok; $('#pv1').onerror = bad; $('#pv1').src = src; $('#pv2').src = src; };
  // make a solid background see-through: take the color in the corners and clear everything close to it, softening the edges
  $('#lClear').onclick = async ev => { const b = ev.currentTarget; b.disabled = true;
    try {
      const src = fileBlob ? URL.createObjectURL(fileBlob) : $('#lUrl').value.trim();
      const im = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const id = x.getImageData(0, 0, c.width, c.height), d = id.data, W = c.width, H = c.height;
      const px = (i) => [d[i], d[i + 1], d[i + 2]], corners = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + W - 1) * 4].filter(i => d[i + 3] > 200).map(px);
      if (!corners.length) { msg('This logo already has a see-through background.'); b.disabled = false; return; }
      const bg = [0, 1, 2].map(k => corners.reduce((a, cc) => a + cc[k], 0) / corners.length);
      for (let i = 0; i < d.length; i += 4) { const dist = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
        if (dist < 40) d[i + 3] = 0; else if (dist < 90) d[i + 3] = Math.min(d[i + 3], Math.round((dist - 40) / 50 * 255)); }
      x.putImageData(id, 0, 0);
      fileBlob = await new Promise(r => c.toBlob(r, 'image/png')); preview(URL.createObjectURL(fileBlob));
      setTimeout(() => msg('Background cleared. Check both previews, then add it.'), 300);
    } catch (e) { msg('Couldn’t edit that image here (the site blocks it). Download it and use “upload an image file”, then clear the background.', true); }
    b.disabled = false; };
  let t = 0;
  $('#lUrl').oninput = () => { fileBlob = null; clearTimeout(t); t = setTimeout(() => preview($('#lUrl').value.trim()), 350); };
  $('#lFile').onchange = ev => { const f = ev.target.files[0]; if (!f) return; if (f.size > 4e6) return msg('That file is over 4 MB.', true); fileBlob = f; $('#lUrl').value = ''; preview(URL.createObjectURL(f)); };
  const dupe = () => { const k = keyOf($('#lName').value), kind = $('#lKind').value; const hit = k && all().find(l => l.key === k && l.kind === kind);
    $('#dupe').innerHTML = hit ? `<div class="dupe"><img src="${esc(hit.url)}" alt=""><span>${esc(hit.name)} already has a logo${hit.editable ? '. Adding this one swaps it out.' : '. Add yours only if that one is wrong or outdated.'}</span></div>` : ''; };
  $('#lName').oninput = () => { dupe(); canAdd(); }; $('#lKind').onchange = dupe;

  $('#lScan').onclick = async ev => { let s = $('#lSite').value.trim(); if (!s) return; if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    const b = ev.currentTarget; b.disabled = true; $('#cands').innerHTML = '<p class="hint">Looking…</p>';
    try { candidates = await db.scanSite(s); } catch (x) { candidates = []; }
    b.disabled = false;
    $('#cands').innerHTML = candidates.length ? candidates.map((c, i) => `<button type="button" data-c="${i}"><img src="${esc(c)}" alt="" onerror="this.parentNode.remove()"></button>`).join('') + '<p class="hint" style="grid-column:1/-1;margin:4px 0 0">Tap the real logo. Sites often include sponsor logos too.</p>' : '<p class="hint">Couldn’t find logos on that site. Copy the image link from the page instead.</p>';
    $$('#cands [data-c]').forEach(btn => btn.onclick = () => { $$('#cands [data-c]').forEach(x => x.setAttribute('aria-pressed', 'false')); btn.setAttribute('aria-pressed', 'true'); fileBlob = null; $('#lUrl').value = candidates[+btn.dataset.c]; preview(candidates[+btn.dataset.c]); }); };

  $('#lAdd').onclick = async ev => {
    const name = $('#lName').value.trim(), kind = $('#lKind').value, b = ev.currentTarget; if (!name || !previewOK) return;
    b.disabled = true; b.textContent = 'ADDING…'; msg('');
    try {
      const k = keyOf(name), old = shared.filter(l => l.key === k && l.kind === kind && (admin || l.added_by === me));
      const url = fileBlob ? await db.uploadImage(fileBlob, 'logo-src') : $('#lUrl').value.trim();
      await db.addLogo({ name, kind, url });
      for (const o of old) await db.deleteLogo(o.id).catch(() => {});
      toast(name + (old.length ? ' swapped.' : ' added. Thanks!'));
      shared = await db.listLogos().catch(() => shared); await logos(true);
      $('#lName').value = ''; $('#lUrl').value = ''; $('#lSite').value = ''; $('#cands').innerHTML = ''; fileBlob = null; $('#dupe').innerHTML = ''; preview(''); drawGrid();
    } catch (x) { msg(x.message || 'Could not add that logo.', true); }
    b.textContent = 'ADD TO DIRECTORY'; canAdd();
  };

  const drawGrid = () => {
    const q = keyOf(query), list = all().filter(l => (filter === 'all' || l.kind === filter) && (!q || l.key.includes(q))).sort((a, b) => a.name.localeCompare(b.name));
    $('#cnt').textContent = list.length;
    $('#grid').innerHTML = list.map(l => `<figure${l.editable ? ' tabindex="0"' : ''}><div class="img"><img src="${esc(l.url)}" alt="" loading="lazy"></div><figcaption>${esc(l.name)}<small>${esc(KIND_LABEL[l.kind] || '')}</small></figcaption>${l.editable ? `<div class="acts"><button type="button" class="sw" data-n="${esc(l.name)}" data-k="${esc(l.kind)}">SWAP</button>${l.builtin ? '' : `<button type="button" class="rm" data-id="${esc(l.id)}" aria-label="Remove ${esc(l.name)}">×</button>`}</div>` : ''}</figure>`).join('') || '<p class="hint">Nothing yet. Add the first one above.</p>';
    $$('#grid .sw').forEach(b => b.onclick = () => {
      $('#lName').value = b.dataset.n; $('#lKind').value = b.dataset.k; fileBlob = null; $('#lUrl').value = ''; preview(''); dupe(); canAdd();
      $('#lName').closest('.section').scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('#lUrl').focus({ preventScroll: true }), 400);
      msg('Paste the new logo for ' + b.dataset.n + ' below. The old one is replaced when you add it.'); });
    $$('#grid .rm').forEach(b => b.onclick = async () => { if (!confirm('Remove this logo from the directory?')) return; try { await db.deleteLogo(b.dataset.id); shared = shared.filter(l => l.id !== b.dataset.id); await logos(true); drawGrid(); } catch (x) { toast(x.message); } });
  };
  $('#lq').oninput = ev => { query = ev.target.value; drawGrid(); };
  $$('#kf [data-k]').forEach(b => b.onclick = () => { filter = b.dataset.k; $$('#kf [data-k]').forEach(x => x.setAttribute('aria-pressed', x === b)); drawGrid(); });
  drawGrid();
}

/* ---------- 6. customize: drag stamps, size, turn, ink, page tint ---------- */
routes.customize = async function customize(id) {
  const idx = state.entries.findIndex(x => x.id === id), e = JSON.parse(JSON.stringify(state.entries[idx]));
  await book(idx + 1);
  const page = app.querySelector(`.page[data-id="${CSS.escape(id)}"]`), host = page.querySelector('.stamps');
  $('#bk').style.overflowX = 'hidden'; $('#bar').classList.add('hidden'); $('#dots').classList.add('hidden');
  const tray = document.createElement('div'); tray.className = 'tray';
  tray.innerHTML = `<div class="r" id="hint">Drag stamps to place them. Tap one to change it.</div>
    <div class="r hidden" id="ctl1">SIZE <input type="range" id="sz" min=".4" max="1.8" step=".02"> TURN <input type="range" id="rt" min="-45" max="45" step="1"></div>
    <div class="r hidden" id="ctl2">INK <div class="sw" id="inks">${Object.entries(INKS).map(([n, c]) => `<button type="button" data-ink="${c}" style="background:${c}" aria-label="${n} ink"></button>`).join('')}</div><button class="btn small ghost" id="rm" type="button">REMOVE</button></div>
    <div class="r">PAGE <div class="sw tints">${Object.entries({ cream: '#f3eddc', blue: '#c9dbe8', rose: '#efcfca', tan: '#e9d6ae', mint: '#cfe3d2' }).map(([t, c]) => `<button type="button" data-tint="${t}" style="background:${c}" aria-label="${t} page" aria-pressed="${(e.bg?.tint || 'cream') === t}"></button>`).join('')}</div>
      ${e.bg?.url ? 'ART <input type="range" id="ay" min="15" max="45" step="1" aria-label="Art height">' : ''}</div>
    <div class="r" style="justify-content:space-between"><button class="btn small ghost" id="cx" type="button">CANCEL</button><button class="btn small" id="ok" type="button">DONE</button></div>`;
  app.append(tray);
  let sel = null;
  const redraw = async () => { await drawStamps(host, e.stamps, true); host.querySelectorAll('img').forEach(im => { if (sel && im.dataset.k === sel.k) im.classList.add('sel'); bind(im); }); };
  const select = s => { sel = s; ['ctl1', 'ctl2'].forEach(i => tray.querySelector('#' + i).classList.toggle('hidden', !s)); tray.querySelector('#hint').classList.toggle('hidden', !!s);
    host.querySelectorAll('img').forEach(im => im.classList.toggle('sel', !!s && im.dataset.k === s.k));
    if (s) { tray.querySelector('#sz').value = s.s || 1; tray.querySelector('#rt').value = s.r || 0; tray.querySelectorAll('[data-ink]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ink === s.p.ink)); } };
  const bind = im => { im.onpointerdown = ev => { ev.preventDefault(); const s = e.stamps.find(x => x.k === im.dataset.k); select(s); im.setPointerCapture(ev.pointerId);
    const r = page.getBoundingClientRect(); const move = mv => { s.x = Math.max(0, Math.min(100, (mv.clientX - r.left) / r.width * 100)); s.y = Math.max(0, Math.min(100, (mv.clientY - r.top) / r.height * 100)); im.style.left = s.x + '%'; im.style.top = s.y + '%'; };
    im.onpointermove = move; im.onpointerup = () => { im.onpointermove = null; }; }; };
  await redraw();
  host.addEventListener('pointerdown', ev => { if (ev.target === host) select(null); });
  tray.querySelector('#sz').oninput = ev => { if (!sel) return; sel.s = +ev.target.value; const im = host.querySelector(`[data-k="${CSS.escape(sel.k)}"]`); im.style.width = 44 * sel.s + '%'; };
  tray.querySelector('#rt').oninput = ev => { if (!sel) return; sel.r = +ev.target.value; const im = host.querySelector(`[data-k="${CSS.escape(sel.k)}"]`); im.style.transform = `translate(-50%,-50%) rotate(${sel.r}deg)`; };
  tray.querySelectorAll('[data-ink]').forEach(b => b.onclick = async () => { if (!sel || sel.p.kind === 'shot') return; sel.p = { ...sel.p, ink: b.dataset.ink }; await redraw(); select(sel); });
  tray.querySelector('#rm').onclick = async () => { if (!sel) return; e.stamps = e.stamps.filter(x => x !== sel); select(null); await redraw(); };
  tray.querySelectorAll('[data-tint]').forEach(b => b.onclick = () => { e.bg = { ...(e.bg || {}), tint: b.dataset.tint }; page.className = 'page tint-' + b.dataset.tint; tray.querySelectorAll('[data-tint]').forEach(o => o.setAttribute('aria-pressed', o === b)); });
  const ay = tray.querySelector('#ay'); if (ay) { const art = page.querySelector('.art'); ay.value = e.bg.y ?? 27; ay.oninput = () => { e.bg.y = +ay.value; art.style.top = ay.value + '%'; }; }
  tray.querySelector('#cx').onclick = () => go('book', idx + 1);
  tray.querySelector('#ok').onclick = async ev => { ev.currentTarget.disabled = true; try { await db.saveEntry(e); state.entries = await db.listEntries(); toast('Page saved.'); go('book', state.entries.findIndex(x => x.id === id) + 1); } catch (x) { toast(x.message || 'Could not save.'); ev.currentTarget.disabled = false; } };
};

start();
