(() => {
  'use strict';

  /* =========================================================
     CONFIG
     ========================================================= */

  // Folder (inside "assets - home") that holds each scope's photos/videos.
  // Add files to the matching folder, then run `node scripts/build-assets.js`
  // to regenerate that folder's manifest.json so the site can find them.
  const CATEGORY_FOLDERS = {
    media: 'Media',
    marketing: 'Marketing',
    'talent-management': 'Talent Management',
    'about-contact': 'About_Contact',
  };

  // The root "assets - home" folder itself: whatever's dropped there
  // (currently the festival hero shot) is the default background, resolved
  // via the same root-level manifest.json build-assets.js writes.
  const ROOT_SCOPE = '';
  const ASSETS_ROOT = 'assets - home';

  const IMAGE_DWELL_MS = 420;       // how long each photo shows during hover-cycle
  const VIDEO_MAX_MS = 30000;        // safety cap in case a video won't fire 'ended' - not meant to cut real videos short
  const INTRO_WORD_MS = 380;        // how long each word shows during the intro cycle

  /* =========================================================
     INTRO TAGLINE CYCLE (plays on every load)
     ========================================================= */

  let introActive = false; // true for the duration of the load-time cycle; hover shouldn't fight it for the same element

  function runIntroCycle() {
    const wordEl = document.getElementById('taglineWord');
    if (!wordEl) return;

    const finalWord = wordEl.textContent.trim() || 'music';
    const sequence = ['media', 'marketing', 'talent management', finalWord];

    wordEl.innerHTML = `<span class="tagline__word-inner">${finalWord}</span>`;
    wordEl.classList.add('is-flip-color'); // orange while flipping through the roles
    introActive = true;

    let i = -1;

    const step = () => {
      i++;
      if (i >= sequence.length) { introActive = false; return; } // done, settled on finalWord
      wordEl.classList.add('is-cycling');
      window.setTimeout(() => {
        wordEl.innerHTML = `<span class="tagline__word-inner">${sequence[i]}</span>`;
        wordEl.classList.remove('is-cycling');
        if (i === sequence.length - 1) wordEl.classList.remove('is-flip-color'); // back to white on the final word
        window.setTimeout(step, INTRO_WORD_MS);
      }, 230); // matches the .tagline__word-inner transition duration in css
    };

    window.setTimeout(step, INTRO_WORD_MS);
  }

  /* =========================================================
     TAGLINE HOVER SYNC — desktop only: hovering a nav item swaps
     the tagline word to match it, same flip transition as the
     intro cycle, reverting to "music" on mouseleave.
     ========================================================= */

  // No entry for about-contact - "looking for a job in about/contact"
  // doesn't read as a real phrase, so hovering it just leaves the
  // tagline alone (mouseleave from whatever was hovered before still
  // resets it back to "music" as normal).
  const TAGLINE_WORDS = {
    media: 'media',
    marketing: 'marketing',
    'talent-management': 'talent management',
  };

  let taglineToken = 0; // invalidates a pending swap if another one starts before it lands

  function setTaglineWord(word, isFlipColor) {
    if (introActive) return; // let the load-time cycle own the element until it settles
    const wordEl = document.getElementById('taglineWord');
    if (!wordEl) return;
    const inner = wordEl.querySelector('.tagline__word-inner');
    if (inner && inner.textContent === word) return;

    const token = ++taglineToken;
    wordEl.classList.add('is-cycling');
    window.setTimeout(() => {
      if (token !== taglineToken) return; // superseded by a newer hover before this landed
      wordEl.innerHTML = `<span class="tagline__word-inner">${word}</span>`;
      wordEl.classList.remove('is-cycling');
      wordEl.classList.toggle('is-flip-color', isFlipColor);
    }, 230);
  }

  /* =========================================================
     BACKGROUND MEDIA CROSSFADER
     ========================================================= */

  const layerA = document.getElementById('bgLayerA');
  const layerB = document.getElementById('bgLayerB');
  let activeLayer = layerA;
  let idleLayer = layerB;

  function clearLayer(layer) {
    layer.style.backgroundImage = '';
    layer.innerHTML = '';
  }

  function paintLayer(layer, item) {
    clearLayer(layer);
    const src = encodeURI(item.src);
    if (item.type === 'video') {
      const video = document.createElement('video');
      video.src = src;
      video.autoplay = true;
      video.muted = true; // muted + playsInline is the only autoplay combination phones allow
      video.loop = true;
      video.playsInline = true;
      layer.appendChild(video);
    } else {
      layer.style.backgroundImage = `url("${src}")`;
    }
  }

  // Resolves once an image is actually decoded and ready to paint, so the
  // crossfade never reveals a layer before its image has loaded (that gap
  // was showing as a flash of the black base background between photos).
  // Videos resolve immediately - they're handled separately in advance().
  function preloadItem(item) {
    return new Promise((resolve) => {
      if (item.type === 'video') { resolve(); return; }
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve(); // don't block the cycle on one bad file
      img.src = encodeURI(item.src);
    });
  }

  // Crossfades to a new item, swapping which of the two layers is "active".
  function showItem(item) {
    paintLayer(idleLayer, item);
    idleLayer.classList.add('is-visible');
    activeLayer.classList.remove('is-visible');
    const next = activeLayer;
    activeLayer = idleLayer;
    idleLayer = next;
  }

  /* =========================================================
     MANIFEST LOADING
     ========================================================= */

  const manifestCache = new Map();

  async function loadManifest(folder) {
    if (manifestCache.has(folder)) return manifestCache.get(folder);
    const url = encodeURI(folder ? `${ASSETS_ROOT}/${folder}/manifest.json` : `${ASSETS_ROOT}/manifest.json`);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`manifest not found: ${url}`);
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      manifestCache.set(folder, items);
      return items;
    } catch (err) {
      console.warn(`[bg-cycler] Could not load manifest for "${folder || '(root)'}". Add assets and run scripts/build-assets.js.`, err);
      manifestCache.set(folder, []);
      return [];
    }
  }

  /* =========================================================
     HOVER CYCLER
     ========================================================= */

  let hoverToken = 0;      // increments on every enter/leave so stale timers no-op
  let defaultItem = null;  // resolved once, on load

  async function resolveDefaultBackground() {
    const items = await loadManifest(ROOT_SCOPE);
    if (items.length === 0) return; // no default asset supplied yet — leave the dark base background + overlay
    defaultItem = items[0];
    showItem(defaultItem);
  }

  function folderForCategory(category) {
    return CATEGORY_FOLDERS[category];
  }

  // Desktop only: runs from mouseenter/focus until stopHoverCycle() is called
  // on mouseleave/blur. Photos flash by on a short dwell; a video is a
  // meaningful preview on its own, so it plays (looping) for up to
  // VIDEO_MAX_MS before the cycle moves on, rather than being flashed.
  async function startHoverCycle(category) {
    const folder = folderForCategory(category);
    if (!folder) return;
    const token = ++hoverToken;
    const items = await loadManifest(folder);
    if (token !== hoverToken || items.length === 0) return;

    let index = 0;
    // Kicked off ahead of time so it usually has a full dwell period to
    // finish; advance() still awaits it, so a slow load extends the dwell
    // instead of ever flashing an unloaded frame.
    let nextPreload = preloadItem(items[0]);

    const advance = async () => {
      if (token !== hoverToken) return;
      await nextPreload;
      if (token !== hoverToken) return;

      const item = items[index % items.length];
      showItem(item);
      index++;
      nextPreload = preloadItem(items[index % items.length]);

      if (item.type === 'video') {
        // showItem() just swapped activeLayer, so the live <video> lives there now.
        const liveVideo = activeLayer.querySelector('video');
        if (liveVideo) {
          const onEnd = () => { cleanup(); queueNext(); };
          const cleanup = () => {
            liveVideo.removeEventListener('ended', onEnd);
            window.clearTimeout(safety);
          };
          liveVideo.addEventListener('ended', onEnd, { once: true });
          // The clip loops, so 'ended' won't fire on its own - this cap is
          // what eventually moves the cycle along.
          const safety = window.setTimeout(() => { cleanup(); queueNext(); }, VIDEO_MAX_MS);
        } else {
          queueNext();
        }
        return;
      }

      queueNext();
    };

    const queueNext = () => {
      if (token !== hoverToken) return;
      window.setTimeout(advance, IMAGE_DWELL_MS);
    };

    advance();
  }

  function stopHoverCycle() {
    hoverToken++; // invalidate any in-flight timers/listeners
    if (defaultItem) {
      showItem(defaultItem);
    } else {
      activeLayer.classList.remove('is-visible');
      idleLayer.classList.remove('is-visible');
      clearLayer(layerA);
      clearLayer(layerB);
    }
  }

  function initHoverCycling() {
    document.querySelectorAll('.scopes__item a[data-category]').forEach((link) => {
      const category = link.dataset.category;
      const word = TAGLINE_WORDS[category];
      // Hover is desktop-only: touch devices fire synthetic mouseenter/focus
      // on tap, and phones have no hover preview at all (a tap just goes).
      link.addEventListener('mouseenter', () => {
        if (isMobileViewport()) return;
        startHoverCycle(category);
        if (word) setTaglineWord(word, true);
      });
      link.addEventListener('focus', () => {
        if (isMobileViewport()) return;
        startHoverCycle(category);
        if (word) setTaglineWord(word, true);
      });
      link.addEventListener('mouseleave', () => {
        if (isMobileViewport()) return;
        stopHoverCycle();
        setTaglineWord('music', false);
      });
      link.addEventListener('blur', () => {
        if (isMobileViewport()) return;
        stopHoverCycle();
        setTaglineWord('music', false);
      });
    });
  }

  /* =========================================================
     MOBILE — phones have no hover, so there is no preview to show
     and no loader to sit through: a tap just goes (after a short
     fade). What phones get instead is a one-time launch sequence
     on arrival - photos pushing through over a pinned logo - and
     then the homepage settles. Desktop is untouched: all of this
     only runs under the same breakpoint the rest of the site
     treats as "mobile".
     ========================================================= */

  const MOBILE_QUERY = '(max-width: 720px)';
  const LEAVE_FADE_MS = 280;   // tap -> fade to black -> navigate, so it isn't a hard cut

  function isMobileViewport() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  // Same-tab on purpose, Media included: this runs after a short fade, not
  // inside the click's own call stack, and mobile browsers silently block
  // window.open() there as an unrequested popup. location.href has no such
  // restriction. Desktop never reaches this - the anchor's own
  // target="_blank" still opens Media in a new tab there.
  function leaveTo(link) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.body.classList.add('is-leaving');
    window.setTimeout(() => { window.location.href = link.href; }, reducedMotion ? 0 : LEAVE_FADE_MS);
  }

  function initMobileNav() {
    document.querySelectorAll('.scopes__item a[data-category]').forEach((link) => {
      link.addEventListener('click', (e) => {
        if (!isMobileViewport()) return; // desktop keeps its normal link behaviour
        e.preventDefault();
        leaveTo(link);
      });
    });

    // The back button can restore this page from the browser's back/forward
    // cache with the fade still applied.
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) document.body.classList.remove('is-leaving');
    });
  }

  /* =========================================================
     LAUNCH SEQUENCE (phones, once per browser session)

     The logo fades in on black, the first photo fades up behind it, then
     each next photo pushes in from the top and shoves the previous one out
     the bottom while the logo stays pinned dead-center. A final black panel
     pushes the last photo out, the logo fades, and the homepage lifts up
     underneath. Tap anywhere to skip.

     Whether it plays at all is decided by the inline script in index.html
     (so it can cover the page from first paint): phones only, never with
     reduced-motion or Save-Data, and only the first homepage visit of a
     session (?splash=1 forces a replay). It can never trap the page: every
     wait has a timeout, the whole thing has a hard cap, and any error falls
     straight through to showing the homepage.
     ========================================================= */

  // Picked by filename from the "Media - Mobile" folder so the order and
  // colour rhythm are deliberate; any name that's no longer there is just
  // skipped, and if too few remain it falls back to an even spread.
  const SPLASH_FOLDER = 'Media - Mobile';
  const SPLASH_REEL = [
    'Aoki-6', 'CMS01803', 'Max crowd shot', 'Mt. Joy double exposure',
    'Don Toliver', 'STBreakaway', 'MAX STYLER2-9',
  ];
  const SPLASH_MIN_PHOTOS = 3;        // fewer than this isn't worth a sequence - skip it
  const SPLASH_FIRST_FADE_MS = 700;   // first photo fades up from black
  const SPLASH_FIRST_HOLD_MS = 400;
  const SPLASH_PUSH_MS = 210;         // each photo pushing the last one out
  const SPLASH_HOLD_MS = 230;         // how long a photo rests between pushes
  const SPLASH_EXIT_MS = 280;         // black panel pushing the last photo out
  const SPLASH_FIRST_WAIT_MS = 2500;  // patience for the first photo on a slow connection
  const SPLASH_PHOTO_WAIT_MS = 900;   // patience for each later photo before skipping it
  const SPLASH_HARD_CAP_MS = 8000;    // after this, stop playing photos and exit
  const SPLASH_EASE = 'cubic-bezier(0.65, 0, 0.25, 1)';

  async function splashPhotos() {
    const items = (await loadManifest(SPLASH_FOLDER)).filter((item) => item.type === 'image');
    const picked = SPLASH_REEL
      .map((name) => items.find((item) => decodeURIComponent(item.src).includes(name)))
      .filter(Boolean);
    if (picked.length >= SPLASH_MIN_PHOTOS) return picked;

    const count = Math.min(SPLASH_REEL.length, items.length);
    if (count < SPLASH_MIN_PHOTOS) return [];
    return Array.from({ length: count }, (_, k) => items[Math.round((k * (items.length - 1)) / (count - 1))]);
  }

  // Resolves with the loaded <img>, or null if it failed or took too long.
  function loadSplashImage(item) {
    return new Promise((resolve) => {
      const img = new Image();
      const finish = (ok) => { img.onload = img.onerror = null; resolve(ok ? img : null); };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.decoding = 'async';
      img.src = encodeURI(item.src);
    });
  }

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const orTimeout = (promise, ms) => Promise.race([promise, wait(ms).then(() => null)]);

  // Web Animations rather than CSS classes so a push can be awaited. If the
  // browser stops ticking animations (backgrounded tab, a badly stalled
  // frame) the guard snaps it to its end state, so a panel can never be left
  // half-way - or an old one removed while its replacement is still off-screen.
  function animateEl(el, keyframes, ms, easing = SPLASH_EASE) {
    return new Promise((resolve) => {
      const anim = el.animate(keyframes, { duration: ms, easing, fill: 'forwards' });
      const guard = window.setTimeout(() => anim.finish(), ms + 150);
      anim.onfinish = () => { window.clearTimeout(guard); resolve(); };
    });
  }

  function makePanel(img) {
    const panel = document.createElement('div');
    panel.className = img ? 'splash__panel splash__panel--photo' : 'splash__panel';
    if (img) panel.appendChild(img);
    return panel;
  }

  // Resolves once the homepage is on its way in - it never rejects.
  async function runSplash() {
    const root = document.documentElement;
    const splash = document.getElementById('splash');
    const reel = document.getElementById('splashReel');
    const logo = document.getElementById('splashLogo');

    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      root.classList.add('splash-done');   // homepage content fades up
      if (splash) splash.classList.add('is-out'); // overlay fades away
      window.setTimeout(() => {
        root.classList.remove('splash-on', 'splash-done');
        if (splash) splash.remove();
      }, 700);
    };

    if (!splash || !reel || !logo) { end(); return; }

    const startedAt = performance.now();
    let skip;
    const skipped = new Promise((resolve) => { skip = resolve; });
    let wasSkipped = false;
    splash.addEventListener('pointerdown', () => { wasSkipped = true; skip(); }, { once: true });
    const nap = (ms) => Promise.race([wait(ms), skipped]);
    const playing = () => !wasSkipped && performance.now() - startedAt < SPLASH_HARD_CAP_MS;

    try {
      const photos = await splashPhotos();
      if (photos.length < SPLASH_MIN_PHOTOS) { end(); return; }

      // All photos start downloading at once; the logo doesn't wait on them.
      const loads = photos.map(loadSplashImage);
      logo.animate([{ opacity: 0 }, { opacity: 0.95 }], { duration: 520, delay: 80, easing: 'ease', fill: 'forwards' });

      const first = await orTimeout(loads[0], SPLASH_FIRST_WAIT_MS);
      if (!first || !playing()) { end(); return; }

      let current = makePanel(first);
      reel.appendChild(current);
      current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SPLASH_FIRST_FADE_MS, easing: 'ease', fill: 'forwards' });
      await nap(SPLASH_FIRST_FADE_MS + SPLASH_FIRST_HOLD_MS);

      for (let k = 1; k < photos.length && playing(); k++) {
        const img = await orTimeout(loads[k], SPLASH_PHOTO_WAIT_MS);
        if (!img) continue; // didn't make it in time - skip this one rather than stall
        if (!playing()) break;

        const next = makePanel(img);
        next.style.transform = 'translateY(-100%)';
        reel.appendChild(next);
        await Promise.all([
          animateEl(next, [{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], SPLASH_PUSH_MS),
          animateEl(current, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], SPLASH_PUSH_MS),
        ]);
        current.remove();
        current = next;
        await nap(SPLASH_HOLD_MS);
      }

      // Exit: a black panel pushes the last photo out while the logo fades.
      if (!wasSkipped) {
        const black = makePanel(null);
        black.style.transform = 'translateY(-100%)';
        reel.appendChild(black);
        logo.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: SPLASH_EXIT_MS, easing: 'ease', fill: 'forwards' });
        await Promise.all([
          animateEl(black, [{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], SPLASH_EXIT_MS),
          animateEl(current, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], SPLASH_EXIT_MS),
        ]);
      }
    } catch (err) {
      console.warn('[splash] skipped after an error', err);
    }
    end();
  }

  /* =========================================================
     INIT
     ========================================================= */

  document.addEventListener('DOMContentLoaded', () => {
    initHoverCycling();
    initMobileNav();
    resolveDefaultBackground();

    // The tagline intro waits until the launch sequence has lifted so
    // nobody misses it behind the overlay.
    if (document.documentElement.classList.contains('splash-on')) {
      runSplash().then(runIntroCycle);
    } else {
      runIntroCycle();
    }
  });
})();
