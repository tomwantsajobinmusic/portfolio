# Thomas — Music Industry Portfolio

Homepage core structure: `index.html` + `css/styles.css` + `js/main.js`.

## Adding your photos/videos

Drop files straight into the matching folder under `assets - home/`:

- `Media/`
- `Marketing/`
- `Talent Management/`
- `About_Contact/`

A photo/video dropped directly into `assets - home/` itself (not a
subfolder) becomes the default hero background — shown before any hover and
after the mouse leaves a nav item.

Then run the build (once, first time — `npm install` first if you haven't):

```bash
npm run build
```

This does two things, for every folder including the root:

1. **Compresses photos.** Full-res originals stay exactly where you put them
   — untouched. A resized (max 2560px wide), re-encoded WebP copy gets
   written into a parallel `.web/` folder, and that's what the site actually
   loads. Camera JPEGs run 10–20MB; the derivatives run in the low hundreds
   of KB. Re-runs skip files whose derivative is already up to date, so it
   stays fast as the library grows.
2. **Writes `manifest.json`** in each folder, listing what's in it — the
   site is static, so it can't list folder contents on its own.

Run `npm run build` any time you add, remove, or rename files. Supported
types: jpg, jpeg, png, webp, gif (images, get compressed), mp4, webm, mov
(videos, referenced as-is — no video compression pipeline yet, so keep those
reasonably sized on your end for now).

## Running locally

Because the page fetches `manifest.json` files, it needs to be served over
`http://`, not opened directly as a `file://` path (browsers block that
fetch). Any static server works, e.g.:

```bash
npx serve .
# or
npm run serve   # python -m http.server 8000
```

## What's built so far

- Plain HTML/CSS/JS — no framework, no bundler, nothing to build except the
  asset pipeline above. Keeps the page light and fast to load.
- Intro tagline word-cycle (Media → Marketing → Talent Management → Music),
  plays once per browser session via `sessionStorage`.
- Hover-to-cycle background media per nav item, crossfading between photos
  and videos listed in that section's manifest.
- Image compression pipeline (see above) so full-res camera originals never
  ship to the browser directly.
- Nav links point to `media.html`, `marketing.html`, `talent-management.html`,
  `about-contact.html` — none of those pages exist yet, that's next.

## Notes / things to revisit together

- The nav's staggered diagonal sizing (Media smallest → About/Contact
  largest) is an approximation of the mockup done with fluid `clamp()` sizes,
  not pixel-matched yet — worth a pass once real photos are in place and we
  can see it against real backgrounds.
- Intro replays every new browser session (`sessionStorage`). Swap to
  `localStorage` in `js/main.js` (`INTRO_STORAGE_KEY`) if you want it to only
  ever play once, period.
