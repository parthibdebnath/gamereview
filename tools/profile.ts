import { readFileSync } from 'node:fs';
import { parsePgn } from '../src/core/pgn';
import { buildReview } from '../src/core/review';
import { book } from './lib';
import * as board from '../src/core/board';
const name = process.argv.slice(2).filter((a) => a !== '--')[0] ?? 'century';
const game = parsePgn(readFileSync(`tests/fixtures/games/${name}.pgn`, 'utf8'));
const { analyses } = JSON.parse(readFileSync(`tests/fixtures/analysis/${name}.json`, 'utf8'));
for (let k = 0; k < 2; k++) {
  const t0 = performance.now();
  buildReview(game, analyses, { book });
  console.log(`buildReview ${name}: ${(performance.now() - t0).toFixed(0)} ms for ${game.plies.length} plies`);
}
let t = performance.now();
for (let i = 0; i < 200; i++) board.see(game.plies[30].fenBefore, game.plies[30].to);
console.log('see x200', (performance.now() - t).toFixed(0), 'ms');
t = performance.now();
for (let i = 0; i < 50; i++) board.hangingPieces(game.plies[30].fenBefore, 'w');
console.log('hangingPieces x50', (performance.now() - t).toFixed(0), 'ms');
process.exit(0);
