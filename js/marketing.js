(() => {
  'use strict';

  /* =========================================================
     MARQUEES — auto-scroll through every flyer in a manifest.
     Used for both Paid Media and Email/SMS Campaigns.
     ========================================================= */

  async function initMarquee(trackId, manifestPath) {
    const track = document.getElementById(trackId);
    if (!track) return;

    let items = [];
    try {
      const res = await fetch(encodeURI(manifestPath), { cache: 'no-store' });
      if (!res.ok) throw new Error(`manifest not found: ${manifestPath}`);
      const data = await res.json();
      items = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.warn(`[marketing] Could not load marquee manifest "${manifestPath}".`, err);
      return;
    }
    if (items.length === 0) return;

    // Not lazy-loaded: these are small (a few hundred KB to ~1MB total),
    // always-animating loops, so every flyer needs to be ready up front
    // rather than popping in mid-scroll.
    const renderSet = () =>
      items.map((item) => {
        const img = document.createElement('img');
        img.src = encodeURI(item.src);
        img.alt = '';
        return img;
      });

    // Rendered twice back-to-back so the CSS loop (translateX -50%) is seamless.
    renderSet().forEach((img) => track.appendChild(img));
    renderSet().forEach((img) => track.appendChild(img));
  }

  /* =========================================================
     PHOTO GRIDS — swaps a section's grey placeholder blocks for
     real photos once they exist, keyed off that folder's manifest
     ========================================================= */

  async function initPhotoGrid(containerId, manifestPath) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let items = [];
    try {
      const res = await fetch(encodeURI(manifestPath), { cache: 'no-store' });
      if (!res.ok) throw new Error(`manifest not found: ${manifestPath}`);
      const data = await res.json();
      items = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.warn(`[marketing] Could not load manifest "${manifestPath}".`, err);
      return;
    }
    if (items.length === 0) return; // keep the grey placeholders until real photos exist

    container.innerHTML = '';
    container.removeAttribute('aria-hidden');
    items.forEach((item) => {
      const img = document.createElement('img');
      img.className = 'photo-tile';
      img.src = encodeURI(item.src);
      img.alt = '';
      container.appendChild(img);
    });
  }

  /* =========================================================
     STAT ROLL-UP — digits spin through random values and land
     on the real number once the stat scrolls into view
     ========================================================= */

  function animateStatValue(el) {
    const finalText = el.textContent.trim();
    el.innerHTML = finalText
      .split('')
      .map((ch) => (/\d/.test(ch) ? `<span class="roll-digit">${ch}</span>` : ch))
      .join('');

    el.querySelectorAll('.roll-digit').forEach((span, idx) => {
      const finalDigit = span.textContent;
      const settleAfter = 14 + idx * 5; // left digits settle first, staggered like an odometer
      let tick = 0;
      const timer = window.setInterval(() => {
        tick++;
        if (tick >= settleAfter) {
          span.textContent = finalDigit;
          window.clearInterval(timer);
        } else {
          span.textContent = String(Math.floor(Math.random() * 10));
        }
      }, 90);
    });
  }

  function initStatRollups() {
    const values = document.querySelectorAll('.stat__value');
    if (values.length === 0) return;

    if (!('IntersectionObserver' in window)) {
      values.forEach(animateStatValue);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animateStatValue(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.4 }
    );

    values.forEach((el) => observer.observe(el));
  }

  // PDF viewer modal is shared across pages - see js/pdf-viewer.js.

  document.addEventListener('DOMContentLoaded', () => {
    initMarquee('paidMediaTrack', 'assets - marketing/Ads - Slider/manifest.json');
    initMarquee('emailSmsTrack', 'assets - marketing/Show Flyers - SMS Email/manifest.json');
    initStatRollups();
    initPhotoGrid('liveNationGrid', 'assets - marketing/LN Campaigns/manifest.json');
  });
})();
