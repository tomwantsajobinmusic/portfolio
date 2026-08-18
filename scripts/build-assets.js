#!/usr/bin/env node
/**
 * Two jobs, run together whenever you add/remove/change files in "assets - home":
 *
 *  1. Compress photos. Full-res originals stay exactly where you put them —
 *     this writes a resized/re-encoded WebP copy into a parallel ".web"
 *     folder, which is what the site actually loads (originals are usually
 *     several MB straight off a camera; a hero-sized WebP is a fraction of
 *     that, so the page stays snappy). Skips files whose derivative is
 *     already newer than the source, so re-runs are fast.
 *
 *  2. Write manifest.json in each folder (root included) listing what's in
 *     it, since a static site can't list a folder's contents on its own.
 *
 * Run: node scripts/build-assets.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSETS_ROOT = path.join(__dirname, '..', 'assets - home');
const WEB_DIR = '.web';
const MAX_WIDTH = 2560;   // plenty for a full-bleed background, even on big/hi-dpi screens
const WEBP_QUALITY = 78;

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);

function typeForFile(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

// Folders directly under the assets root that we process: '' is the root
// itself (for the default hero background), plus every subdirectory except
// the .web output cache.
function listScopes() {
  const entries = fs.readdirSync(ASSETS_ROOT, { withFileTypes: true });
  const subfolders = entries
    .filter((e) => e.isDirectory() && e.name !== WEB_DIR)
    .map((e) => e.name);
  return ['', ...subfolders];
}

function filesInScope(scope) {
  const dir = path.join(ASSETS_ROOT, scope || '.');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => name !== 'manifest.json' && !name.startsWith('.'))
    .filter((name) => typeForFile(name) !== null)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function compressImage(scope, file) {
  const srcPath = path.join(ASSETS_ROOT, scope || '.', file);
  const outDir = path.join(ASSETS_ROOT, WEB_DIR, scope || '.');
  const outName = path.basename(file, path.extname(file)) + '.webp';
  const outPath = path.join(outDir, outName);

  fs.mkdirSync(outDir, { recursive: true });

  const srcStat = fs.statSync(srcPath);
  if (fs.existsSync(outPath) && fs.statSync(outPath).mtimeMs >= srcStat.mtimeMs) {
    return { outName, skipped: true };
  }

  await sharp(srcPath)
    .rotate() // respect EXIF orientation
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(outPath);

  return { outName, skipped: false };
}

async function buildScope(scope) {
  const files = filesInScope(scope);
  const items = [];
  let compressed = 0;

  for (const file of files) {
    const type = typeForFile(file);
    if (type === 'image') {
      const { outName, skipped } = await compressImage(scope, file);
      if (!skipped) compressed++;
      const webPath = path.posix.join('assets - home', WEB_DIR, scope || '.', outName);
      items.push({ src: webPath, type: 'image' });
    } else {
      // No video transcoding pipeline yet — reference the original file as-is.
      const rawPath = path.posix.join('assets - home', scope || '.', file);
      items.push({ src: rawPath, type: 'video' });
    }
  }

  const manifestPath = path.join(ASSETS_ROOT, scope || '.', 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ items }, null, 2) + '\n');

  const label = scope || '(root)';
  console.log(`  ${label}: ${items.length} item(s), ${compressed} compressed -> ${path.relative(process.cwd(), manifestPath)}`);
}

async function main() {
  if (!fs.existsSync(ASSETS_ROOT)) {
    console.error(`Could not find "${ASSETS_ROOT}".`);
    process.exit(1);
  }

  console.log('Building assets...');
  for (const scope of listScopes()) {
    await buildScope(scope);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
