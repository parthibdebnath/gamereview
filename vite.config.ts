import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Cross-origin isolation (COOP + COEP) unlocks SharedArrayBuffer, which the optional
 * multi-threaded Stockfish build needs. The default engine pool works without it.
 */
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Writes dist/sw.js with a precache list of every built file (hashed names = versioned). */
function serviceWorker(): Plugin {
  return {
    name: 'hindsight-sw',
    apply: 'build',
    closeBundle() {
      const dist = 'dist';
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(dist, p).split('\\').join('/'));
        }
      };
      walk(dist);
      // The multi-threaded engine build is opt-in (Settings); it is cached on first use instead.
      const optional = /engine\/stockfish-18-lite\.(js|wasm)$/;
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.endsWith('COPYING.txt') && !optional.test(f));
      const version = Date.now().toString(36);
      const tpl = readFileSync('src/sw.template.js', 'utf8');
      writeFileSync(join(dist, 'sw.js'), tpl.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./', ...list])));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
} as Parameters<typeof defineConfig>[0]);
