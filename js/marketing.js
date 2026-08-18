(() => {
  'use strict';

  const MARQUEE_MANIFEST = 'assets - marketing/Ads - Slider/manifest.json';

  /* =========================================================
     PAID MEDIA MARQUEE — auto-scrolls through every ad flyer
     ========================================================= */

  async function initMarquee() {
    const track = document.getElementById('paidMediaTrack');
    if (!track) return;

    let items = [];
    try {
      const res = await fetch(encodeURI(MARQUEE_MANIFEST), { cache: 'no-store' });
      if (!res.ok) throw new Error(`manifest not found: ${MARQUEE_MANIFEST}`);
      const data = await res.json();
      items = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.warn('[marketing] Could not load the Paid Media slider manifest. Add flyers to "assets - marketing/Ads - Slider" and run scripts/build-assets.js.', err);
      return;
    }
    if (items.length === 0) return;

    // Not lazy-loaded: this is a small (~1MB total), always-animating loop, so
    // every flyer needs to be ready up front rather than popping in mid-scroll.
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
      const settleAfter = 9 + idx * 3; // left digits settle first, staggered like an odometer
      let tick = 0;
      const timer = window.setInterval(() => {
        tick++;
        if (tick >= settleAfter) {
          span.textContent = finalDigit;
          window.clearInterval(timer);
        } else {
          span.textContent = String(Math.floor(Math.random() * 10));
        }
      }, 45);
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

  document.addEventListener('DOMContentLoaded', () => {
    initMarquee();
    initStatRollups();
  });
})();
