// Copies the Stockfish WASM builds the app uses into public/engine (git-ignored).
// Only the "lite" flavours (~7 MB each) are shipped; see DECISIONS.md D-ENG-1.
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
const src = 'node_modules/stockfish/bin';
const dst = 'public/engine';
mkdirSync(dst, { recursive: true });
for (const f of ['stockfish-18-lite.js', 'stockfish-18-lite.wasm', 'stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) {
  const from = `${src}/${f}`;
  if (!existsSync(from)) throw new Error(`Missing ${from}. Run npm install.`);
  const to = `${dst}/${f}`;
  if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
}
copyFileSync('node_modules/stockfish/Copying.txt', `${dst}/COPYING.txt`);
console.log('engine files ready in public/engine');
