/** How much does accuracy move between two engine settings on the same games? (cached analyses only) */
import { readFileSync } from 'node:fs';
import { parsePgn } from '../src/core/pgn';
import { buildReview } from '../src/core/review';
import { PRESETS } from '../src/engine/analyzer';
import { analyzeCached, book, closeEngine } from './lib';
import { selectGames } from './validate-select';

const games = selectGames(readFileSync('.data/lichess-evals-100k.pgn', 'utf8'), 30);
const extra = [readFileSync('tests/fixtures/games/opera.pgn', 'utf8'), readFileSync('tests/fixtures/games/century.pgn', 'utf8'), readFileSync('tests/fixtures/games/evergreen.pgn', 'utf8')];
const diffs: Record<string, number[]> = { hybrid: [], top: [], sequential: [] };
for (const pgn of [...games, ...extra]) {
  const g = parsePgn(pgn);
  const a3 = await analyzeCached(g, { ...PRESETS.standard, multipv: 3 }, false);
  const a2 = await analyzeCached(g, { ...PRESETS.standard, multipv: 2 }, false);
  for (const mode of ['hybrid', 'top', 'sequential'] as const) {
    const r3 = buildReview(g, a3, { book, accuracyMode: mode });
    const r2 = buildReview(g, a2, { book, accuracyMode: mode });
    diffs[mode].push(Math.abs(r3.white.accuracy! - r2.white.accuracy!), Math.abs(r3.black.accuracy! - r2.black.accuracy!));
  }
}
for (const [k, v] of Object.entries(diffs)) {
  const s = [...v].sort((x, y) => x - y);
  console.log(`${k.padEnd(11)} mean |Δ| ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}  median ${s[Math.floor(s.length / 2)].toFixed(2)}  90th pct ${s[Math.floor(s.length * 0.9)].toFixed(2)}  max ${s[s.length - 1].toFixed(2)}`);
}
closeEngine();
process.exit(0);
