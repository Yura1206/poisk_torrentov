const fs = require('fs');
const path = require('path');
const sharp = require(path.resolve('node_modules/sharp'));

// Circle center is (218, 218), r=96, stroke-width=28.
// Inner radius of the rim (the glass edge) = 96 - 14 = 82 px.
// Outer radius of the rim (the outer edge) = 96 + 14 = 110 px.
//
// Angle is 45 deg: cos(45)=sin(45)=0.7071.
// At center (218, 218):
// Inner glass boundary in direction of handle: 218 + 82 * 0.7071 = 276.0.
// Outer rim boundary in direction of handle: 218 + 110 * 0.7071 = 295.8.
//
// Handle stroke-width is 32, with round linecap (radius 16).
// If handle starts at x1 = 304, y1 = 304:
// Distance from center = sqrt((304-218)^2 + (304-218)^2) = 121.6 px.
// Tip of the round cap reaches 121.6 - 16 = 105.6 px from center.
// Since 105.6 px is strictly LESS than 110 (outer rim) and strictly GREATER than 82 (inner glass),
// the handle merges seamlessly into the solid rim and does NOT penetrate into the glass!
// Also, drawing the circle AFTER the line ensures a crisp outer rim contour.

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1120" />
      <stop offset="50%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#111827" />
    </linearGradient>

    <linearGradient id="rimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="50%" stop-color="#3b82f6" />
      <stop offset="100%" stop-color="#6366f1" />
    </linearGradient>

    <linearGradient id="lensFill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.16" />
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0.06" />
    </linearGradient>

    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0.2" />
    </linearGradient>
  </defs>

  <!-- Flat App Squircle Background -->
  <rect x="32" y="32" width="448" height="448" rx="104" fill="url(#bgGrad)" stroke="url(#borderGrad)" stroke-width="4" />

  <!-- Flat Minimalist Magnifying Glass -->
  <!-- Handle: starts at (304, 304) so it anchors cleanly into the rim without encroaching on the lens -->
  <line x1="304" y1="304" x2="400" y2="400" stroke="url(#rimGrad)" stroke-width="32" stroke-linecap="round" />

  <!-- Outer Ring (Lens Rim) drawn on top of the handle anchor -->
  <circle cx="218" cy="218" r="96" fill="url(#lensFill)" stroke="url(#rimGrad)" stroke-width="28" />

  <!-- Inner Flat Video / Search Spark (Play Triangle) -->
  <path d="M 202 184 C 202 178 208 174 213 177 L 257 211 C 261 214 261 222 257 225 L 213 259 C 208 262 202 258 202 252 Z" fill="#ffffff" />
</svg>`;

async function run() {
  const buildDir = path.resolve('build');
  const publicDir = path.resolve('public');

  fs.writeFileSync(path.join(buildDir, 'icon.svg'), svg, 'utf8');

  // Convert SVG to 512x512 PNG
  const png512 = await sharp(Buffer.from(svg)).resize(512, 512).png().toBuffer();
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
  fs.writeFileSync(path.join(publicDir, 'icon.png'), png512);
  console.log('Saved build/icon.png and public/icon.png');

  // Generate ICO with multi-resolution
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngBuffers = [];
  for (const s of sizes) {
    const buf = await sharp(Buffer.from(svg)).resize(s, s).png().toBuffer();
    pngBuffers.push({ size: s, buffer: buf });
  }

  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;

  const headerBuf = Buffer.alloc(headerSize);
  headerBuf.writeUInt16LE(0, 0);
  headerBuf.writeUInt16LE(1, 2);
  headerBuf.writeUInt16LE(count, 4);

  for (let i = 0; i < count; i++) {
    const { size, buffer } = pngBuffers[i];
    const entryOffset = 6 + i * 16;
    headerBuf.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    headerBuf.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    headerBuf.writeUInt8(0, entryOffset + 2);
    headerBuf.writeUInt8(0, entryOffset + 3);
    headerBuf.writeUInt16LE(1, entryOffset + 4);
    headerBuf.writeUInt16LE(32, entryOffset + 6);
    headerBuf.writeUInt32LE(buffer.length, entryOffset + 8);
    headerBuf.writeUInt32LE(offset, entryOffset + 12);
    offset += buffer.length;
  }

  const icoBuf = Buffer.concat([headerBuf, ...pngBuffers.map((p) => p.buffer)]);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuf);
  console.log('Saved build/icon.ico, size:', icoBuf.length);
}

run().catch(console.error);
