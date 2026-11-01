// Prepares the Stockfish WASM builds in public/engine (git-ignored).
//
//  - lite builds (~7 MB, small NNUE net): copied as-is.
//  - full single-threaded build (113 MB, full NNUE net): gzip-compressed (~76 MB) and split into
//    parts below static-host file limits (Vercel: 100 MB), plus a manifest. The app downloads,
//    joins and decompresses them on first use (src/engine/fullNet.ts).
//    See DECISIONS.md D-ENG-1 / D-ENG-8.
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const src = 'node_modules/stockfish/bin';
const dst = 'public/engine';
mkdirSync(dst, { recursive: true });

const copy = (f, to = f) => {
  const from = `${src}/${f}`;
  if (!existsSync(from)) throw new Error(`Missing ${from}. Run npm install.`);
  const out = `${dst}/${to}`;
  if (!existsSync(out) || statSync(out).size !== statSync(from).size) copyFileSync(from, out);
};
for (const f of ['stockfish-18-lite.js', 'stockfish-18-lite.wasm', 'stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm', 'stockfish-18-single.js']) copy(f);
copyFileSync('node_modules/stockfish/Copying.txt', `${dst}/COPYING.txt`);

// Full net: gzip + split. Skip when the manifest already matches the source.
const fullSrc = `${src}/stockfish-18-single.wasm`;
const manifestPath = `${dst}/full-manifest.json`;
const srcSize = statSync(fullSrc).size;
const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
if (!existing || existing.size !== srcSize || !existing.parts.every((p) => existsSync(`${dst}/${p.file}`))) {
  for (const f of readdirSync(dst)) if (/^stockfish-18-full\.part\d+\.(gz|bin)$/.test(f)) rmSync(`${dst}/${f}`);
  const raw = readFileSync(fullSrc);
  const gz = gzipSync(raw, { level: 9 });
  const PART = 24 * 1024 * 1024;
  const parts = [];
  for (let i = 0, n = 0; i < gz.length; i += PART, n++) {
    const file = `stockfish-18-full.part${n}.bin`;
    writeFileSync(`${dst}/${file}`, gz.subarray(i, i + PART));
    parts.push({ file, size: Math.min(PART, gz.length - i) });
  }
  const manifest = {
    size: srcSize,
    gzipSize: gz.length,
    sha256: createHash('sha256').update(raw).digest('hex'),
    parts,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`full net: ${(srcSize / 1e6).toFixed(0)} MB -> ${(gz.length / 1e6).toFixed(0)} MB gzip in ${parts.length} parts`);
}
console.log('engine files ready in public/engine');
