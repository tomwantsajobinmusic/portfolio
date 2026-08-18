#!/usr/bin/env node
/**
 * Two jobs, run together whenever you add/remove/change files in an assets
 * folder ("assets - home", "assets - marketing", ...):
 *
 *  1. Compress photos and videos. Full-res originals stay exactly where you
 *     put them — this writes a re-encoded copy into a parallel ".web"
 *     folder, which is what the site actually loads (originals are usually
 *     huge straight off a camera; the derivative is a fraction of that, so
 *     the page stays snappy). Skips files whose derivative is already newer
 *     than the source, so re-runs are fast.
 *     - Photos: resized, re-encoded as WebP.
 *     - Videos: re-encoded H.264, CRF-based so quality stays high rather
 *       than hitting a low fixed bitrate, audio stripped (every video on
 *       the site plays muted, so it's dead weight).
 *
 *  2. Write manifest.json in each folder (root included) listing what's in
 *     it, since a static site can't list a folder's contents on its own.
 *
 * Run: node scripts/build-assets.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.join(__dirname, '..');
const ASSET_ROOTS = ['assets - home', 'assets - marketing', 'assets - management'];
const WEB_DIR = '.web';
const MAX_WIDTH = 2560;   // plenty for a full-bleed background, even on big/hi-dpi screens
const WEBP_QUALITY = 78;

// CRF-based, not a fixed low bitrate - keeps quality high and just lets
// filesize follow scene complexity. maxrate is a safety ceiling, not the
// target. Bump CRF a couple points (e.g. 22-23) if a video comes out
// larger than you'd like; quality only degrades noticeably past ~24-25.
const VIDEO_CRF = 20;
const VIDEO_MAXRATE = '8M';
const VIDEO_BUFSIZE = '16M';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);

function typeForFile(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

// Folders directly under an assets root that we process: '' is the root
// itself, plus every subdirectory except the .web output cache.
function listScopes(assetsRoot) {
  const entries = fs.readdirSync(assetsRoot, { withFileTypes: true });
  const subfolders = entries
    .filter((e) => e.isDirectory() && e.name !== WEB_DIR)
    .map((e) => e.name);
  return ['', ...subfolders];
}

function filesInScope(assetsRoot, scope) {
  const dir = path.join(assetsRoot, scope || '.');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => name !== 'manifest.json' && !name.startsWith('.'))
    .filter((name) => typeForFile(name) !== null)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function compressImage(assetsRoot, scope, file) {
  const srcPath = path.join(assetsRoot, scope || '.', file);
  const outDir = path.join(assetsRoot, WEB_DIR, scope || '.');
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

async function compressVideo(assetsRoot, scope, file) {
  const srcPath = path.join(assetsRoot, scope || '.', file);
  const outDir = path.join(assetsRoot, WEB_DIR, scope || '.');
  const outName = path.basename(file, path.extname(file)) + '.mp4';
  const outPath = path.join(outDir, outName);

  fs.mkdirSync(outDir, { recursive: true });

  const srcStat = fs.statSync(srcPath);
  if (fs.existsSync(outPath) && fs.statSync(outPath).mtimeMs >= srcStat.mtimeMs) {
    return { outName, skipped: true };
  }

  await execFileAsync(ffmpegPath, [
    '-y',
    '-i', srcPath,
    '-an', // every video on the site plays muted - audio is dead weight
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(VIDEO_CRF),
    '-maxrate', VIDEO_MAXRATE,
    '-bufsize', VIDEO_BUFSIZE,
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', // moov atom up front so it can start playing before it's fully downloaded
    '-loglevel', 'error',
    outPath,
  ], { maxBuffer: 1024 * 1024 * 20 });

  return { outName, skipped: false };
}

async function buildScope(assetsRootName, assetsRoot, scope) {
  const files = filesInScope(assetsRoot, scope);
  const items = [];
  let compressed = 0;

  for (const file of files) {
    const type = typeForFile(file);
    if (type === 'image') {
      const { outName, skipped } = await compressImage(assetsRoot, scope, file);
      if (!skipped) compressed++;
      const webPath = path.posix.join(assetsRootName, WEB_DIR, scope || '.', outName);
      items.push({ src: webPath, type: 'image' });
    } else {
      const { outName, skipped } = await compressVideo(assetsRoot, scope, file);
      if (!skipped) compressed++;
      const webPath = path.posix.join(assetsRootName, WEB_DIR, scope || '.', outName);
      items.push({ src: webPath, type: 'video' });
    }
  }

  const manifestPath = path.join(assetsRoot, scope || '.', 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ items }, null, 2) + '\n');

  const label = scope || '(root)';
  console.log(`  ${assetsRootName}/${label}: ${items.length} item(s), ${compressed} compressed -> ${path.relative(process.cwd(), manifestPath)}`);
}

async function main() {
  console.log('Building assets...');
  for (const assetsRootName of ASSET_ROOTS) {
    const assetsRoot = path.join(PROJECT_ROOT, assetsRootName);
    if (!fs.existsSync(assetsRoot)) continue; // skip roots that don't exist yet
    for (const scope of listScopes(assetsRoot)) {
      await buildScope(assetsRootName, assetsRoot, scope);
    }
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
