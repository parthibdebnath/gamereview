/** Debug helper: print engine lines and sacrifice detection for one ply. npx vite-node tools/debug-ply.ts -- game.pgn <plyIndex> */
import { readFileSync } from 'node:fs';
import { parsePgn, uciLineToSan } from '../src/core/pgn';
import { analyzeCached } from './lib';
import { PRESETS } from '../src/engine/analyzer';
import { findSacrifice } from '../src/core/classify';
import { moveFacts } from '../src/core/features';

const [file, plyArg] = process.argv.slice(2).filter((a) => a !== '--');
const game = parsePgn(readFileSync(file, 'utf8'));
const a = await analyzeCached(game, PRESETS.standard, false);
const i = Number(plyArg);
const ply = game.plies[i];
console.log(ply.san, ply.fenBefore);
for (const [k, an] of [['before', a[i]], ['after', a[i + 1]]] as const)
  for (const l of an.lines) console.log(k, l.rank, JSON.stringify(l.score), uciLineToSan(k === 'before' ? ply.fenBefore : ply.fenAfter, l.pv, 8).join(' '));
console.log('sac', findSacrifice(ply, a[i + 1], 2));
console.log('facts', JSON.stringify(moveFacts(ply.fenBefore, ply, i)));
process.exit(0);
