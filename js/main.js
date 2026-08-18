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

  const IMAGE_DWELL_MS = 1500;      // how long each photo shows during hover-cycle
  const VIDEO_MAX_MS = 8000;        // safety cap in case a video won't fire 'ended'
  const INTRO_WORD_MS = 650;        // how long each word shows during the intro cycle
  const INTRO_STORAGE_KEY = 'tw_intro_played';

  /* =========================================================
     INTRO TAGLINE CYCLE (first load only)
     ========================================================= */

  function runIntroCycle() {
    const wordEl = document.getElementById('taglineWord');
    if (!wordEl) return;

    const finalWord = wordEl.textContent.trim() || 'music';
    const sequence = ['media', 'marketing', 'talent management', finalWord];

    // Already played this session (or the tab doesn't support sessionStorage) -> skip straight to final state.
    let alreadyPlayed = true;
    try {
      alreadyPlayed = sessionStorage.getItem(INTRO_STORAGE_KEY) === '1';
    } catch (e) {
      alreadyPlayed = true;
    }

    wordEl.innerHTML = `<span class="tagline__word-inner">${finalWord}</span>`;
    if (alreadyPlayed) return;

    let i = -1;

    const step = () => {
      i++;
      if (i >= sequence.length) {
        try { sessionStorage.setItem(INTRO_STORAGE_KEY, '1'); } catch (e) { /* ignore */ }
        return;
      }
      wordEl.classList.add('is-cycling');
      window.setTimeout(() => {
        wordEl.innerHTML = `<span class="tagline__word-inner">${sequence[i]}</span>`;
        wordEl.classList.remove('is-cycling');
        window.setTimeout(step, INTRO_WORD_MS);
      }, 260);
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

  async function startHoverCycle(category) {
    const folder = CATEGORY_FOLDERS[category];
    if (!folder) return;
    const token = ++hoverToken;
    const items = await loadManifest(folder);
    if (token !== hoverToken || items.length === 0) return;

    let index = 0;

    const advance = () => {
      if (token !== hoverToken) return;
      const item = items[index % items.length];
      showItem(item);
      index++;

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
      link.addEventListener('mouseenter', () => startHoverCycle(category));
      link.addEventListener('focus', () => startHoverCycle(category));
      link.addEventListener('mouseleave', stopHoverCycle);
      link.addEventListener('blur', stopHoverCycle);
    });
  }

  /* =========================================================
     INIT
     ========================================================= */

  document.addEventListener('DOMContentLoaded', () => {
    runIntroCycle();
    initHoverCycling();
    resolveDefaultBackground();
  });
})();
