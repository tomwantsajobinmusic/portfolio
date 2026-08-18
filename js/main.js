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
  const VIDEO_MAX_MS = 8000;        // safety cap in case a video won't fire 'ended'
  const INTRO_WORD_MS = 380;        // how long each word shows during the intro cycle

  /* =========================================================
     INTRO TAGLINE CYCLE (plays on every load)
     ========================================================= */

  function runIntroCycle() {
    const wordEl = document.getElementById('taglineWord');
    if (!wordEl) return;

    const finalWord = wordEl.textContent.trim() || 'music';
    const sequence = ['media', 'marketing', 'talent management', finalWord];

    wordEl.innerHTML = `<span class="tagline__word-inner">${finalWord}</span>`;
    wordEl.classList.add('is-flip-color'); // orange while flipping through the roles

    let i = -1;

    const step = () => {
      i++;
      if (i >= sequence.length) return; // done, settled on finalWord
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
      video.muted = true;
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
    if (isMobileViewport() && MOBILE_CATEGORY_FOLDERS[category]) return MOBILE_CATEGORY_FOLDERS[category];
    return CATEGORY_FOLDERS[category];
  }

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
          const safety = window.setTimeout(() => { cleanup(); queueNext(); }, VIDEO_MAX_MS);
        } else {
          queueNext();
        }
      } else {
        queueNext();
      }
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
      // Touch devices fire synthetic mouseenter/focus on tap too, which was
      // racing the mobile tap-loader below and restarting the cycle mid-play.
      // These are desktop-only now; behavior at desktop widths is unchanged.
      link.addEventListener('mouseenter', () => { if (!isMobileViewport()) startHoverCycle(category); });
      link.addEventListener('focus', () => { if (!isMobileViewport()) startHoverCycle(category); });
      link.addEventListener('mouseleave', () => { if (!isMobileViewport()) stopHoverCycle(); });
      link.addEventListener('blur', () => { if (!isMobileViewport()) stopHoverCycle(); });
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
  const LOADER_DURATION_MS = 1800; // ~4 photos at the current dwell time

  function isMobileViewport() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function navigateTo(link) {
    // Always same-tab here, deliberately - this only ever runs after the
    // loader's setTimeout delay, and mobile browsers silently block
    // window.open() once it's no longer inside the direct click (it reads
    // as an unrequested popup, not user-initiated). location.href has no
    // such restriction. Desktop still opens Media in a new tab via the
    // anchor's own target="_blank" - this function is never reached there.
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

        startHoverCycle(category);
        window.setTimeout(() => {
          // Same-tab links unload the page anyway, but target="_blank" links
          // (Media) leave this tab alive - without this the cycle just kept
          // running here forever after the new tab opened.
          stopHoverCycle();
          navigateTo(link);
        }, LOADER_DURATION_MS);
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
