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

  /* =========================================================
     PDF VIEWER — opens a brand guide/marketing plan in a modal
     iframe instead of a new tab, using the browser's own native
     PDF rendering (no bundled PDF.js).
     ========================================================= */

  function initPdfViewer() {
    const modal = document.getElementById('pdfModal');
    const frame = document.getElementById('pdfFrame');
    const titleEl = document.getElementById('pdfModalTitle');
    if (!modal || !frame) return;

    let lastFocused = null;

    const open = (src, title) => {
      lastFocused = document.activeElement;
      frame.src = src; // already percent-encoded in the markup - don't re-encode
      titleEl.textContent = title || '';
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      modal.querySelector('.pdf-modal__close').focus();
    };

    const close = () => {
      modal.hidden = true;
      frame.src = ''; // stop loading / release memory
      document.body.style.overflow = '';
      if (lastFocused) lastFocused.focus();
    };

    document.querySelectorAll('.pdf-link[data-pdf]').forEach((btn) => {
      btn.addEventListener('click', () => open(btn.dataset.pdf, btn.dataset.pdfTitle));
    });

    modal.querySelectorAll('[data-pdf-close]').forEach((el) => {
      el.addEventListener('click', close);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initMarquee('paidMediaTrack', 'assets - marketing/Ads - Slider/manifest.json');
    initMarquee('emailSmsTrack', 'assets - marketing/Show Flyers - SMS Email/manifest.json');
    initStatRollups();
    initPhotoGrid('liveNationGrid', 'assets - marketing/LN Campaigns/manifest.json');
    initPdfViewer();
  });
})();
