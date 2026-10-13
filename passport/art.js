// Drawing helpers shared by the app: engraved backgrounds, passport photos and stamps.
// Ported from the Line Engraver tool so pages made here match pages made there.

export const INKS = { navy: '#1f2f55', red: '#b3202a', black: '#1b1b1b', violet: '#5b2a86', green: '#1d6b3c', pink: '#ff3ea5', blue: '#1f3f8f' };

export function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = src; });
}
export function fileToImage(file) {
  return new Promise((res, rej) => { const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => { res(im); URL.revokeObjectURL(url); }; im.onerror = () => { rej(new Error('That image could not be opened. Try a JPG or PNG.')); URL.revokeObjectURL(url); }; im.src = url; });
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

/* ---------- engraving: every line is a ribbon whose width follows the darkness under it ---------- */
export const ENGRAVE = {
  passport: { spacing: 9, weight: .75, angle: 0, amp: 6, wl: 220, contrast: 1.15, bright: .08, soft: 3, cross: false },
  banknote: { spacing: 7, weight: .95, angle: -12, amp: 4, wl: 150, contrast: 1.3, bright: 0, soft: 1.5, cross: true },
  bold: { spacing: 13, weight: 1.1, angle: -30, amp: 0, wl: 150, contrast: 1.9, bright: -.04, soft: 3.5, cross: false },
};
export function engrave(img, { style = 'passport', ink = INKS.navy, max = 900, alphaAsInk = true } = {}) {
  const o = ENGRAVE[style] || ENGRAVE.passport;
  // always engrave at full working size: small logos are scaled up, or their lines come out thinner than a pixel
  const s = max / Math.max(img.width, img.height), W = Math.max(2, Math.round(img.width * s)), H = Math.max(2, Math.round(img.height * s));
  const c = canvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  try { if ('filter' in x) x.filter = 'blur(' + o.soft * W / 1200 + 'px)'; } catch (e) {}
  x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data, gray = new Float32Array(W * H);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
  // Logos with a see-through background: solid parts are ink whatever their color, so white, silver and pale logos
  // still engrave (lighter colors a touch lighter, so detail inside the logo survives).
  const m = canvas(W, H), mx = m.getContext('2d', { willReadFrequently: true }); mx.drawImage(img, 0, 0, W, H);
  const md = mx.getImageData(0, 0, W, H).data; let transparent = 0; for (let i = 3; i < md.length; i += 16) if (md[i] < 20) transparent++;
  const isLogo = alphaAsInk && transparent > md.length / 16 * .15;
  if (isLogo) {
    const blurred = canvas(W, H), bx = blurred.getContext('2d', { willReadFrequently: true });
    try { if ('filter' in bx) bx.filter = 'blur(' + o.soft * W / 1200 + 'px)'; } catch (e) {}
    bx.drawImage(img, 0, 0, W, H);
    const bd = bx.getImageData(0, 0, W, H).data;
    for (let i = 0, j = 0; i < bd.length; i += 4, j++) {
      const a = bd[i + 3] / 255, luma = (0.299 * bd[i] + 0.587 * bd[i + 1] + 0.114 * bd[i + 2]) / 255;
      gray[j] = 1 - a * (0.72 + 0.28 * (1 - luma));
    }
  }
  const sp = o.spacing * W / 900, out = canvas(W, H), ox = out.getContext('2d');
  ox.fillStyle = ink; ox.beginPath();
  const layers = [{ a: o.angle, thr: 0 }]; if (o.cross) layers.push({ a: o.angle + 62, thr: .62 });
  const diag = Math.hypot(W, H), cx = W / 2, cy = H / 2, du = 2, amp = o.amp * W / 900, wl = o.wl * W / 900;
  for (const L of layers) {
    const r = L.a * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
    for (let v = -diag / 2; v <= diag / 2; v += sp) {
      let top = [], bot = [];
      const flush = () => { if (top.length > 2) { ox.moveTo(top[0], top[1]); for (let i = 2; i < top.length; i += 2) ox.lineTo(top[i], top[i + 1]); for (let i = bot.length - 2; i >= 0; i -= 2) ox.lineTo(bot[i], bot[i + 1]); ox.closePath(); } top = []; bot = []; };
      for (let u = -diag / 2; u <= diag / 2; u += du) {
        const w = amp ? amp * Math.sin(6.2832 * u / wl) : 0, px = cx + u * co - (v + w) * si, py = cy + u * si + (v + w) * co;
        let t = 0;
        if (px >= 0 && py >= 0 && px < W - 1 && py < H - 1) {
          let dk = 1 - gray[(py | 0) * W + (px | 0)]; dk = (dk - .5) * o.contrast + .5 - o.bright;
          if (L.thr) dk = (dk - L.thr) / (1 - L.thr) * .8; dk = dk < 0 ? 0 : dk > 1 ? 1 : dk; t = dk * sp * o.weight;
        }
        if (t < .35) { flush(); continue; }
        const h = t / 2; top.push(px + si * h, py - co * h); bot.push(px - si * h, py + co * h);
      }
      flush();
    }
  }
  ox.fill();
  if (isLogo) { ox.globalCompositeOperation = 'destination-in'; ox.drawImage(m, 0, 0); ox.globalCompositeOperation = 'source-over'; } // transparent parts stay empty
  return out;
}

/* ---------- passport photo: dark tones carry ink, light tones let the page show through ---------- */
export function passportPhoto(img, { w = 510, h = 656, dark = '#1f2f55', zoom = 1 } = {}) {
  const c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  const cover = Math.max(w / img.width, h / img.height) * zoom, dw = img.width * cover, dh = img.height * cover;
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const id = x.getImageData(0, 0, w, h), d = id.data, rgb = [1, 3, 5].map(i => parseInt(dark.slice(i, i + 2), 16));
  const period = Math.max(3, h / 260), fade = .06, fx = fade * w, fy = fade * h;
  for (let y = 0, i = 0; y < h; y++) {
    const lineMod = 1 - .55 * .55 * (.5 + .5 * Math.cos(y / period * 6.2832));
    for (let xx = 0; xx < w; xx++, i += 4) {
      let l = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) / 255; l = (l - .5) * 1.3 + .55; l = l < 0 ? 0 : l > 1 ? 1 : l;
      const wv = Math.sin(xx / w * 18 + Math.sin(y / h * 9) * 1.6 + y / h * 40);
      let ink = (1 - l) * lineMod * (1 - .2 * Math.max(0, wv ** 6 - .3));
      let e = Math.min(1, Math.min(xx, w - 1 - xx) / fx, Math.min(y, h - 1 - y) / fy); e = e * e * (3 - 2 * e);
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255 * Math.min(1, ink * 1.15) * e;
    }
  }
  x.putImageData(id, 0, 0); return c;
}

/* ---------- stamps ---------- */
function rng(s) { return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function arcText(x, S, text, r, top, size) {
  if (!text) return;
  x.font = '700 ' + size + 'px Oswald, "Arial Narrow", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const chars = [...text], track = size * .16, widths = chars.map(ch => x.measureText(ch).width + track);
  const total = widths.reduce((a, b) => a + b, 0) - track; let ang = (top ? -Math.PI / 2 : Math.PI / 2) + (top ? -1 : 1) * total / r / 2;
  chars.forEach((ch, i) => { const a = ang + (top ? 1 : -1) * (widths[i] - track) / 2 / r;
    x.save(); x.translate(S / 2 + r * Math.cos(a), S / 2 + r * Math.sin(a)); x.rotate(a + (top ? Math.PI / 2 : -Math.PI / 2)); x.fillText(ch, 0, 0); x.restore();
    ang += (top ? 1 : -1) * widths[i] / r; });
}
function fit(x, text, maxW, size, family) { let s = size; x.font = '700 ' + s + 'px ' + family; while (s > 14 && x.measureText(text).width > maxW) { s -= 2; x.font = '700 ' + s + 'px ' + family; } return s; }
// Logo pixels become ink: transparent or light backgrounds drop out.
function inkFrom(img, maxSide, ink, maxW = maxSide) {
  const s = Math.min(maxW / img.width, maxSide / img.height), w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
  const id = x.getImageData(0, 0, w, h), d = id.data; let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 30) clear++;
  const useAlpha = clear > d.length / 4 * .12;
  // background colour from the corners for opaque logos
  const corner = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4].map(i => [d[i], d[i + 1], d[i + 2]]);
  const bg = corner.reduce((a, b) => [a[0] + b[0] / 4, a[1] + b[1] / 4, a[2] + b[2] / 4], [0, 0, 0]);
  const rgb = [1, 3, 5].map(i => parseInt(ink.slice(i, i + 2), 16));
  for (let i = 0; i < d.length; i += 4) {
    let a;
    if (useAlpha) { const l = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) / 255; a = d[i + 3] / 255 * (l > .93 ? 0 : 1); }
    else { const dist = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) / 255; a = Math.min(1, Math.max(0, (dist - .18) * 3)); }
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = a * 255;
  }
  x.putImageData(id, 0, 0); return c;
}
/** shape: 'logo' | 'circle' | 'rect' | 'oval' | 'hex' | 'ticket'. Returns a 600px transparent canvas. */
export function stamp({ shape = 'circle', top = '', bottom = '', date = '', small = '', logo = null, ink = INKS.navy, seed = 7, wear = .35 } = {}) {
  const S = 600, c = canvas(S, S), x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = ink; x.strokeStyle = ink; x.lineJoin = 'round';
  const mono = '"IBM Plex Mono", Consolas, monospace', cond = 'Oswald, "Arial Narrow", sans-serif';
  // logos fit a box `side` tall and up to `wide`× as wide, so long wordmarks stay big
  const putLogo = (side, cy, cx = S / 2, wide = 1.5) => { if (!logo) return; const ic = inkFrom(logo, side, ink, side * wide); x.drawImage(ic, cx - ic.width / 2, cy - ic.height / 2); };
  if (shape === 'logo') putLogo(S * .94, S / 2, S / 2, 1);
  else if (shape === 'circle') {
    x.lineWidth = 16; x.beginPath(); x.arc(S / 2, S / 2, 280, 0, 7); x.stroke();
    x.lineWidth = 5; x.beginPath(); x.arc(S / 2, S / 2, 258, 0, 7); x.stroke();
    x.lineWidth = 6; x.beginPath(); x.arc(S / 2, S / 2, 178, 0, 7); x.stroke();
    arcText(x, S, top, 218, true, 46); arcText(x, S, bottom, 218, false, 38);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (!date && !small) putLogo(230, S / 2);
    else { putLogo(170, S / 2 - 40);
      if (date) { const fs = fit(x, date, 250, 34, mono); x.font = '700 ' + fs + 'px ' + mono; x.fillText(date, S / 2, S / 2 + 82); }
      if (small) { const fs = fit(x, small, 200, 22, cond); x.font = '700 ' + fs + 'px ' + cond; x.fillText(small, S / 2, S / 2 - 140); } }
  } else if (shape === 'oval' || shape === 'hex' || shape === 'ticket') {
    const path = (inset) => { x.beginPath();
      if (shape === 'oval') x.ellipse(S / 2, S / 2, 285 - inset, 205 - inset, 0, 0, 7);
      else if (shape === 'hex') for (let i = 0; i <= 6; i++) { const a = Math.PI / 3 * i, R = 288 - inset; const px = S / 2 + R * Math.cos(a), py = S / 2 + R * Math.sin(a) * .86; i ? x.lineTo(px, py) : x.moveTo(px, py); }
      else { const X = 24 + inset, Y = 140 + inset, W = S - 48 - inset * 2, H = 320 - inset * 2, n = 34 - inset * .4;
        x.moveTo(X, Y); x.lineTo(X + W, Y); x.lineTo(X + W, S / 2 - n); x.arc(X + W, S / 2, n, -Math.PI / 2, Math.PI / 2, true); x.lineTo(X + W, Y + H); x.lineTo(X, Y + H); x.lineTo(X, S / 2 + n); x.arc(X, S / 2, n, Math.PI / 2, -Math.PI / 2, true); }
      x.closePath(); };
    x.lineWidth = 14; path(0); x.stroke(); x.lineWidth = 4; path(20); x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const tall = shape === 'hex' ? 190 : shape === 'oval' ? 175 : 150, wide = shape === 'hex' ? 300 : 430;
    if (top) { const fs = fit(x, top, wide, 44, cond); x.font = '700 ' + fs + 'px ' + cond; x.fillText(top, S / 2, S / 2 - tall * .62); }
    putLogo(date || bottom ? (shape === 'ticket' ? 110 : 130) : 210, S / 2, S / 2, shape === 'hex' ? 2.2 : 3.2);
    const low = [date, bottom].filter(Boolean).join('  ·  ');
    if (low) { const fs = fit(x, low, wide, 30, mono); x.font = '700 ' + fs + 'px ' + mono; x.fillText(low, S / 2, S / 2 + tall * .62); }
  } else {
    const y0 = 130, y1 = 470; x.lineWidth = 14; roundRect(x, 30, y0, S - 60, y1 - y0, 22); x.stroke();
    x.lineWidth = 4; roundRect(x, 48, y0 + 18, S - 96, y1 - y0 - 36, 14); x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (top) { const fs = fit(x, top, 470, 50, cond); x.font = '700 ' + fs + 'px ' + cond; x.fillText(top, S / 2, y0 + 62); }
    x.lineWidth = 4; x.beginPath(); x.moveTo(70, y0 + 98); x.lineTo(S - 70, y0 + 98); x.moveTo(70, y1 - 76); x.lineTo(S - 70, y1 - 76); x.stroke();
    const mid = (y0 + 98 + y1 - 76) / 2;
    if (!date && !small) putLogo(150, mid, S / 2, 3);
    else { putLogo(118, mid, 150, 1.7);
      if (small) { const fs = fit(x, small, 280, 22, cond); x.font = '700 ' + fs + 'px ' + cond; x.fillText(small, 380, mid - 26); }
      if (date) { const fs = fit(x, date, 290, 36, mono); x.font = '700 ' + fs + 'px ' + mono; x.fillText(date, 380, mid + 18); } }
    if (bottom) { const fs = fit(x, bottom, 470, 28, cond); x.font = '700 ' + fs + 'px ' + cond; x.fillText(bottom, S / 2, y1 - 42); }
  }
  if (wear > 0) { // patchy ink, like a real rubber stamp
    const r = rng(seed), id = x.getImageData(0, 0, S, S), d = id.data, g = 24, grid = new Float32Array((g + 1) * (g + 1)).map(() => r());
    for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) { const i = (y * S + xx) * 4; if (!d[i + 3]) continue;
      const gx = xx / S * g, gy = y / S * g, ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy;
      const n = grid[iy * (g + 1) + ix] * (1 - fx) * (1 - fy) + grid[iy * (g + 1) + ix + 1] * fx * (1 - fy) + grid[(iy + 1) * (g + 1) + ix] * (1 - fx) * fy + grid[(iy + 1) * (g + 1) + ix + 1] * fx * fy;
      const k = n * .7 + r() * .3; if (k < wear * .55) d[i + 3] *= .15; else d[i + 3] *= .82 + .18 * Math.min(1, k); }
    x.putImageData(id, 0, 0);
  }
  return c;
}
function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }

export const toBlob = (c, type = 'image/png', q) => new Promise(res => c.toBlob(res, type, q));
