(() => {
  'use strict';

  /* =========================================================
     PDF VIEWER — opens a linked PDF in a modal iframe instead of
     a new tab, using the browser's own native PDF rendering (no
     bundled PDF.js). Shared across any page with a #pdfModal.
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

  document.addEventListener('DOMContentLoaded', initPdfViewer);
})();
