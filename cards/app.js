(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Resolve which artist to show ───────────────────────────
     ?id=jensen-truly  — falls back to the first entry in data/artists.js
     so a bare link during testing still shows something.            */
  var params = new URLSearchParams(window.location.search);
  var id = params.get("id");
  var artist = (id && window.ARTISTS[id]) || null;

  if (!artist && !id) {
    var firstKey = Object.keys(window.ARTISTS)[0];
    artist = window.ARTISTS[firstKey];
  }

  var root = document.getElementById("app");

  if (!artist) {
    root.innerHTML =
      '<div class="not-found">' +
      "<strong>Card not found</strong>" +
      "This link doesn\u2019t match a card in the set. Double check the QR code, " +
      "or reach out to Thomas directly and he\u2019ll sort it." +
      "</div>";
    return;
  }

  buildPage(artist);

  /* ── Build DOM ─────────────────────────────────────────────── */
  function buildPage(a) {
    document.title = a.name + " \u2014 Holo Card";

    root.innerHTML =
      '<header class="masthead">' +
        "<span>Moments by Thomas Brown</span>" +
        '<a class="masthead__home" href="../index.html">&larr; Home</a>' +
      "</header>" +
      '<main class="stage">' +
        '<div class="card-column">' +
          '<div class="card-perspective">' +
            '<div class="card" id="holo-card">' +
              '<div class="card__face"><img src="' + esc(a.image) + '" alt="' + esc(a.name) + '" onerror="this.parentElement.style.background=\'linear-gradient(135deg,#232330,#15151c)\'"></div>' +
              '<div class="card__holo"></div>' +
              '<div class="card__sparkle" id="sparkle-layer"></div>' +
              '<div class="card__glare"></div>' +
              '<div class="card__frame"></div>' +
            "</div>" +
          "</div>" +
          '<span class="card-hint">' + (isTouch() ? "tilt or drag the card" : "move your cursor over the card") + "</span>" +
        "</div>" +
        '<div class="dossier-column">' +
          '<h1 class="artist-name"><span class="foil">' + esc(a.name) + "</span></h1>" +
          '<div class="card-number">' + esc(a.cardNumber ? "No. " + a.cardNumber : "") + "</div>" +
          '<hr class="hairline">' +
          '<dl class="meta-fields">' +
            metaField("Shot at", a.event) +
            metaField("Captured", a.date) +
            metaField("Rig", a.gear) +
          "</dl>" +
          '<div class="dossier-panel">' +
            '<p class="dossier-label">Field notes</p>' +
            '<div class="dossier-text" id="dossier-text"></div>' +
          "</div>" +
          '<div class="dossier-links" id="dossier-links"></div>' +
        "</div>" +
      "</main>" +
      '<footer class="site-footer">' +
        "<span>\u00a9 " + new Date().getFullYear() + " Thomas Brown</span>" +
        "<span>Printed original \u00b7 Digitally archived</span>" +
      "</footer>";

    if (a.nameFont) {
      document.querySelector(".artist-name").style.setProperty("--name-font", '"' + a.nameFont + '"');
    }

    injectSparkleSVG(document.getElementById("sparkle-layer"));
    initTilt(document.getElementById("holo-card"));
    typeDossier(a.story, document.getElementById("dossier-text"), function () {
      renderLinks(a.links, document.getElementById("dossier-links"));
    });
  }

  function metaField(label, value) {
    if (!value) return "";
    return (
      '<div class="meta-field"><dt>' + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>"
    );
  }

  function renderLinks(links, el) {
    if (!links || !links.length) return;
    el.innerHTML = links
      .map(function (l) {
        return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + "</a>";
      })
      .join("");
    requestAnimationFrame(function () {
      el.classList.add("is-visible");
    });
  }

  /* ── Typewriter ────────────────────────────────────────────── */
  function typeDossier(paragraphs, el, onDone) {
    if (reduceMotion) {
      el.innerHTML = paragraphs.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
      onDone && onDone();
      return;
    }

    var flat = paragraphs.join("\n\n");
    var i = 0;
    var speed = 22; // ms per character
    var pEl = document.createElement("p");
    el.appendChild(pEl);
    var caret = document.createElement("span");
    caret.className = "caret";
    el.appendChild(caret);

    (function step() {
      if (i >= flat.length) {
        caret.remove();
        onDone && onDone();
        return;
      }
      var ch = flat[i];
      if (ch === "\n") {
        // double newline = new paragraph
        if (flat[i + 1] === "\n") {
          pEl = document.createElement("p");
          el.insertBefore(pEl, caret);
          i += 2;
        } else {
          i += 1;
        }
      } else {
        pEl.textContent += ch;
        i += 1;
      }
      var pause = /[.!?]$/.test(pEl.textContent) ? speed * 9 : speed;
      setTimeout(step, pause);
    })();
  }

  /* ── Tilt engine: pointer on desktop, device orientation on mobile ── */
  function initTilt(card) {
    if (!card) return;
    var bounds = null;
    var targetRX = 0, targetRY = 0, targetMX = 50, targetMY = 50;
    var curRX = 0, curRY = 0, curMX = 50, curMY = 50;

    function setBounds() {
      bounds = card.getBoundingClientRect();
    }
    setBounds();
    window.addEventListener("resize", setBounds);

   function onMove(clientX, clientY, sensitivity) {
      sensitivity = sensitivity || 1;
      if (!bounds) setBounds();
      var px = (clientX - bounds.left) / bounds.width;
      var py = (clientY - bounds.top) / bounds.height;
      // amplify the offset from center so small drags (touch) go further
      // than the raw finger position alone would produce
      px = 0.5 + (px - 0.5) * sensitivity;
      py = 0.5 + (py - 0.5) * sensitivity;
      px = Math.min(1, Math.max(0, px));
      py = Math.min(1, Math.max(0, py));
      targetRX = (px - 0.5) * 22;
      targetRY = -(py - 0.5) * 22;
      targetMX = px * 100;
      targetMY = py * 100;
    }

    function reset() {
      targetRX = 0; targetRY = 0; targetMX = 50; targetMY = 50;
    }

    card.addEventListener("pointermove", function (e) {
      onMove(e.clientX, e.clientY);
    });
    card.addEventListener("pointerleave", reset);

   // touch drag fallback — amplified so a small thumb movement produces
    // a fuller tilt, since most people won't drag corner-to-corner
    card.addEventListener(
      "touchmove",
      function (e) {
        var t = e.touches[0];
        if (t) onMove(t.clientX, t.clientY, 2.2);
      },
      { passive: true }
    );

    // device orientation, if a phone grants it
    if (isTouch() && window.DeviceOrientationEvent) {
      window.addEventListener("deviceorientation", function (e) {
        if (e.beta === null || e.gamma === null) return;
        var gamma = Math.max(-20, Math.min(20, e.gamma)); // left-right
        var beta = Math.max(-20, Math.min(20, e.beta - 45)); // front-back, offset for natural hold angle
        targetRX = gamma;
        targetRY = -beta * -1;
        targetMX = 50 + gamma * 2.2;
        targetMY = 50 + beta * 2.2;
      });
    }

    function animate() {
      if (!reduceMotion) {
        curRX += (targetRX - curRX) * 0.12;
        curRY += (targetRY - curRY) * 0.12;
        curMX += (targetMX - curMX) * 0.12;
        curMY += (targetMY - curMY) * 0.12;
        card.style.setProperty("--rx", curRX.toFixed(2) + "deg");
        card.style.setProperty("--ry", curRY.toFixed(2) + "deg");
        card.style.setProperty("--mx", curMX.toFixed(1) + "%");
        card.style.setProperty("--my", curMY.toFixed(1) + "%");
      }
      requestAnimationFrame(animate);
    }
    animate();
  }

  /* ── Procedural sparkle texture (no external image needed) ─── */
  function injectSparkleSVG(container) {
    if (!container) return;
    container.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<filter id="noiseFilter">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>' +
      '<feColorMatrix type="saturate" values="0"/>' +
      "</filter>" +
      '<rect width="100%" height="100%" filter="url(#noiseFilter)"/>' +
      "</svg>";
  }

  function isTouch() {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }

  function esc(str) {
    if (str === undefined || str === null) return "";
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
