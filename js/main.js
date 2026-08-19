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

  // Mobile-only overrides: photos cropped specifically for narrow viewports.
  // Any category without an entry here just falls back to CATEGORY_FOLDERS,
  // same as desktop.
  const MOBILE_CATEGORY_FOLDERS = {
    media: 'Media - Mobile',
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

  function paintLayer(layer, item, { loop = true } = {}) {
    clearLayer(layer);
    const src = encodeURI(item.src);
    if (item.type === 'video') {
      const video = document.createElement('video');
      video.src = src;
      video.autoplay = true;
      video.muted = true;
      // A looping video never fires 'ended' (the browser just seeks back to
      // 0 and keeps playing) - loop:false is what lets the mobile loader's
      // 'ended' listener actually fire once the clip finishes.
      video.loop = loop;
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
  function showItem(item, options) {
    paintLayer(idleLayer, item, options);
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

  // `maxAdvances` + `onComplete` are used by the mobile tap-loader to stop
  // after a fixed number of photos rather than running until stopHoverCycle()
  // is called externally (which is how desktop hover still uses this - no
  // limit, runs until mouseleave/blur). A wall-clock timer doesn't work for
  // the mobile case: since advance() awaits each frame's real network load,
  // a slow connection eats into a fixed time budget and shows fewer photos
  // than intended. Counting actual shown frames is accurate regardless of
  // connection speed.
  //
  // Video items are never flashed like photos, in either mode: a video's
  // own length is a known, meaningful preview on its own. Desktop hover
  // lets it loop (queueNext once it ends); the mobile loader treats a full
  // playthrough as the whole loader - it finishes and navigates the moment
  // the video ends, rather than flashing one frame or looping it 8x.
  async function startHoverCycle(category, { maxAdvances, onComplete } = {}) {
    const folder = folderForCategory(category);
    if (!folder) return;
    const token = ++hoverToken;
    const items = await loadManifest(folder);
    if (token !== hoverToken || items.length === 0) return;

    let index = 0;
    let shown = 0;
    // Kicked off ahead of time so it usually has a full dwell period to
    // finish; advance() still awaits it, so a slow load extends the dwell
    // instead of ever flashing an unloaded frame.
    let nextPreload = preloadItem(items[0]);

    const advance = async () => {
      if (token !== hoverToken) return;
      await nextPreload;
      if (token !== hoverToken) return;

      const item = items[index % items.length];
      // Loader mode (maxAdvances) wants exactly one playthrough so 'ended'
      // below actually fires; desktop hover wants it to loop as normal.
      showItem(item, { loop: !maxAdvances });
      index++;
      shown++;
      nextPreload = preloadItem(items[index % items.length]);

      if (item.type === 'video') {
        // showItem() just swapped activeLayer, so the live <video> lives there now.
        const liveVideo = activeLayer.querySelector('video');
        const afterVideo = () => {
          if (maxAdvances) {
            onComplete && onComplete(); // loader mode: full playthrough IS the loader, push right after
          } else {
            queueNext(); // desktop hover: keep looping until mouseleave
          }
        };
        if (liveVideo) {
          const onEnd = () => { cleanup(); afterVideo(); };
          const cleanup = () => {
            liveVideo.removeEventListener('ended', onEnd);
            window.clearTimeout(safety);
          };
          liveVideo.addEventListener('ended', onEnd, { once: true });
          // Safety net in case 'ended' never fires - shorter in loader mode
          // since we're not trying to let it loop, just finish once.
          const safetyMs = maxAdvances ? LOADER_VIDEO_SAFETY_MS : VIDEO_MAX_MS;
          const safety = window.setTimeout(() => { cleanup(); afterVideo(); }, safetyMs);
        } else {
          afterVideo();
        }
        return;
      }

      if (maxAdvances && shown >= maxAdvances) {
        onComplete && onComplete();
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
      // Touch devices fire synthetic mouseenter/focus on tap too, which was
      // racing the mobile tap-loader below and restarting the cycle mid-play.
      // These are desktop-only now; behavior at desktop widths is unchanged.
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
     MOBILE TAP LOADER — touch devices don't get real hover, so
     tapping a nav item plays the image cycle briefly (like a
     loading screen) before navigating. Desktop is untouched:
     this only ever fires under the same breakpoint the rest of
     the site treats as "mobile".
     ========================================================= */

  const MOBILE_QUERY = '(max-width: 720px)';
  const LOADER_PHOTO_COUNT = 8; // how many photos the loader shows before navigating
  const LOADER_VIDEO_SAFETY_MS = 20000; // fallback if a loader video never fires 'ended'

  function isMobileViewport() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function navigateTo(link) {
    // Always same-tab here, deliberately - this only ever runs once the
    // loader finishes, well after the original click event, and mobile
    // browsers silently block window.open() once it's outside the direct
    // click (it reads as an unrequested popup, not user-initiated).
    // location.href has no such restriction. Desktop still opens Media in
    // a new tab via the anchor's own target="_blank" - this function is
    // never reached there.
    window.location.href = link.href;
  }

  function initMobileTapLoader() {
    document.querySelectorAll('.scopes__item a[data-category]').forEach((link) => {
      const category = link.dataset.category;
      link.addEventListener('click', async (e) => {
        if (!isMobileViewport()) return; // desktop keeps its normal hover behavior

        e.preventDefault();
        const folder = folderForCategory(category);
        const items = folder ? await loadManifest(folder) : [];
        if (items.length === 0) {
          navigateTo(link); // nothing to show yet, don't make them wait
          return;
        }

        startHoverCycle(category, {
          maxAdvances: LOADER_PHOTO_COUNT,
          onComplete: () => {
            stopHoverCycle();
            navigateTo(link);
          },
        });
      });
    });
  }

  /* =========================================================
     INIT
     ========================================================= */

  document.addEventListener('DOMContentLoaded', () => {
    runIntroCycle();
    initHoverCycling();
    initMobileTapLoader();
    resolveDefaultBackground();
  });
})();
