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

  // Mobile-only overrides: photos and short clips cropped vertically (9:16)
  // for narrow viewports - the desktop files are landscape and a phone only
  // shows about a quarter of that frame. Any category without an entry here
  // just falls back to CATEGORY_FOLDERS, same as desktop.
  const MOBILE_CATEGORY_FOLDERS = {
    media: 'Media - Mobile',
    marketing: 'Marketing - Mobile',
    'talent-management': 'Talent Management - Mobile',
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

  // onDone fires once the sequence has settled on the final word (or right
  // away if there's no tagline to animate) - the mobile tour waits on it so
  // the two never fight over the same element.
  function runIntroCycle(onDone) {
    const wordEl = document.getElementById('taglineWord');
    if (!wordEl) { onDone && onDone(); return; }

    const finalWord = wordEl.textContent.trim() || 'music';
    const sequence = ['media', 'marketing', 'talent management', finalWord];

    wordEl.innerHTML = `<span class="tagline__word-inner">${finalWord}</span>`;
    wordEl.classList.add('is-flip-color'); // orange while flipping through the roles
    introActive = true;

    let i = -1;

    const step = () => {
      i++;
      if (i >= sequence.length) { introActive = false; onDone && onDone(); return; } // done, settled on finalWord
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
  // Videos resolve immediately by default - desktop hover handles them
  // separately in advance(). The mobile tour passes waitForVideo so a clip
  // is fetched far enough to show a first frame before it fades in, instead
  // of flashing black on a cellular connection; the timeout keeps one slow
  // file from stalling the whole tour.
  function preloadItem(item, { waitForVideo = false } = {}) {
    return new Promise((resolve) => {
      if (item.type === 'video') {
        if (!waitForVideo) { resolve(); return; }
        const probe = document.createElement('video');
        const finish = () => { probe.onloadeddata = null; probe.onerror = null; resolve(); };
        probe.preload = 'auto';
        probe.muted = true;
        probe.playsInline = true;
        probe.onloadeddata = finish;
        probe.onerror = finish;
        window.setTimeout(finish, 3000);
        probe.src = encodeURI(item.src);
        return;
      }
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
    if (isMobileViewport() && MOBILE_CATEGORY_FOLDERS[category]) return MOBILE_CATEGORY_FOLDERS[category];
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
      // on tap, and phones get the auto-tour below instead of a preview.
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
     MOBILE — phones have no hover, and making a tap wait on a clip
     reads as "loading", not as a preview. So there's no tap loader:
     the homepage tours the categories on its own (tagline word
     flips, the matching nav item lights up, the background swaps to
     that category's vertical photo/clip) and a tap just goes.
     Desktop is untouched: all of this only runs under the same
     breakpoint the rest of the site treats as "mobile".
     ========================================================= */

  const MOBILE_QUERY = '(max-width: 720px)';
  const TOUR_CATEGORIES = ['media', 'marketing', 'talent-management'];
  const TOUR_DWELL_MS = 3200;  // how long each category holds before the next takes over
  // A photo category (Media) flips through several photos inside that same
  // slot, at the same pace as desktop hover, rather than parking on one.
  const TOUR_PHOTOS_PER_SLOT = Math.round(TOUR_DWELL_MS / IMAGE_DWELL_MS);
  const LEAVE_FADE_MS = 280;   // tap -> fade to black -> navigate, so it isn't a hard cut

  function isMobileViewport() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  let tourToken = 0; // same stale-timer trick as hoverToken

  // Skipped (the hero just rests on its still image) for anyone who has
  // asked their device to cut back on motion or data.
  function tourAllowed() {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    return !reducedMotion && !saveData;
  }

  function setTourHighlight(category) {
    document.querySelectorAll('.scopes__item a[data-category]').forEach((link) => {
      link.classList.toggle('is-tour-active', link.dataset.category === category);
    });
  }

  // What the tour shows at a given step: categories in order. A video
  // category plays its one clip for the whole slot; a photo category gets a
  // burst of photos to flip through. Each full lap continues further along
  // that folder, so the same few photos don't repeat.
  async function tourEntry(step) {
    const category = TOUR_CATEGORIES[step % TOUR_CATEGORIES.length];
    const items = await loadManifest(folderForCategory(category));
    if (items.length === 0) return null;
    const lap = Math.floor(step / TOUR_CATEGORIES.length);
    const isPhotos = items[0].type === 'image';
    const count = isPhotos ? TOUR_PHOTOS_PER_SLOT : 1;
    const burst = Array.from({ length: count }, (_, k) => items[(lap * count + k) % items.length]);
    return { category, burst, holdMs: isPhotos ? IMAGE_DWELL_MS : TOUR_DWELL_MS };
  }

  // Fetches a slot's files ahead of its turn (the HTTP cache does the rest).
  const warmEntry = (entry) => {
    if (entry) entry.burst.forEach((item) => preloadItem(item, { waitForVideo: true }));
  };

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function startMobileTour() {
    if (!tourAllowed()) return;
    const token = ++tourToken;

    const run = async () => {
      for (let step = 0; token === tourToken; step++) {
        const entry = await tourEntry(step);
        if (token !== tourToken) return;
        if (!entry) { await wait(TOUR_DWELL_MS); continue; } // nothing in that folder yet

        for (let k = 0; k < entry.burst.length; k++) {
          // Never reveal a frame before it has loaded: a slow connection
          // stretches the flip a little instead of flashing black.
          await preloadItem(entry.burst[k], { waitForVideo: true });
          if (token !== tourToken) return;
          showItem(entry.burst[k]);

          if (k === 0) {
            setTourHighlight(entry.category);
            setTaglineWord(TAGLINE_WORDS[entry.category], true);
            tourEntry(step + 1).then(warmEntry); // warm the next slot while this one holds
          }

          await wait(entry.holdMs);
          if (token !== tourToken) return;
        }
      }
    };

    run();
  }

  function stopMobileTour() {
    tourToken++;
    setTourHighlight(null);
    setTaglineWord('music', false);
    stopHoverCycle(); // puts the default hero back
  }

  // Same-tab on purpose, Media included: this runs after a short fade, not
  // inside the click's own call stack, and mobile browsers silently block
  // window.open() there as an unrequested popup. location.href has no such
  // restriction. Desktop never reaches this - the anchor's own
  // target="_blank" still opens Media in a new tab there.
  function leaveTo(link) {
    tourToken++; // freeze the tour so nothing swaps mid-fade
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
    // cache with the fade still applied and the tour stopped.
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      document.body.classList.remove('is-leaving');
      if (isMobileViewport() && !introActive) startMobileTour();
    });

    // Rotating a phone / resizing across the breakpoint hands over between
    // the tour and desktop hover.
    window.matchMedia(MOBILE_QUERY).addEventListener('change', (e) => {
      if (introActive) return; // the intro's onDone starts the tour if we're still mobile by then
      if (e.matches) startMobileTour(); else stopMobileTour();
    });
  }

  /* =========================================================
     INIT
     ========================================================= */

  document.addEventListener('DOMContentLoaded', () => {
    // On a phone, start fetching the first Media burst during the intro so
    // the first lap of the tour doesn't have to wait on the network.
    if (isMobileViewport() && tourAllowed()) tourEntry(0).then(warmEntry);

    runIntroCycle(() => { if (isMobileViewport()) startMobileTour(); });
    initHoverCycling();
    initMobileNav();
    resolveDefaultBackground();
  });
})();
