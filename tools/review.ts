/**
 * Command-line game review, using the exact same pipeline as the app (Node + WASM Stockfish).
 *
 *   npx vite-node tools/review.ts -- game.pgn [--preset fast|standard|deep] [--depth N] [--multipv N]
 *                                         [--fixture] [--quiet]
 *
 * --fixture writes the raw engine analysis to tests/fixtures/analysis/<name>.json so the
 * regression tests can rebuild the review without running an engine.
 * Engine results are cached in tools/.cache/analysis.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parsePgn } from '../src/core/pgn';
import { buildReview } from '../src/core/review';
import { PRESETS, type AnalysisSettings, type PresetName } from '../src/engine/analyzer';
import { formatScore } from '../src/core/winpct';
import { analyzeCached, book, ratingModel, closeEngine } from './lib';

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const files = args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !['fast', 'standard', 'deep'].includes(a));
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const preset = (opt('--preset') ?? 'standard') as PresetName;
  const s: AnalysisSettings = { ...PRESETS[preset] };
  if (opt('--depth')) s.depth = Number(opt('--depth'));
  if (opt('--multipv')) s.multipv = Number(opt('--multipv'));
  if (args.includes('--no-adaptive')) s.adaptive = false;

  for (const f of files) {
    const game = parsePgn(readFileSync(f, 'utf8'));
    console.log(`\n== ${basename(f)}: ${game.headers.White} - ${game.headers.Black} ${game.result}`);
    const analyses = await analyzeCached(game, s);
    if (args.includes('--fixture')) {
      mkdirSync('tests/fixtures/analysis', { recursive: true });
      writeFileSync(`tests/fixtures/analysis/${basename(f, '.pgn')}.json`, JSON.stringify({ settings: s, engine: 'sf18-lite', analyses }));
    }
    const r = buildReview(game, analyses, { book, ratingModel });
    if (!args.includes('--quiet')) {
      for (const m of r.moves) {
        if (!m) continue;
        const v = m.verdict;
        const ev = formatScore(r.positions[m.ply.index + 1].score ?? {});
        console.log(
          `${String(m.ply.moveNumber).padStart(3)}${m.ply.side === 'w' ? '.  ' : '...'}${m.ply.san.padEnd(8)} ${v.classification.padEnd(10)} ${ev.padStart(6)}  loss ${(v.loss * 100).toFixed(1).padStart(5)}  best ${(m.bestSan ?? '').padEnd(7)} | ${m.explanation.text}`,
        );
      }
    }
    for (const p of [r.white, r.black]) {
      const counts = Object.entries(p.counts)
        .filter(([, n]) => n)
        .map(([k, n]) => `${k}:${n}`)
        .join(' ');
      console.log(`${p.side} ${p.name}: accuracy ${p.accuracy?.toFixed(1)} acpl ${p.acpl.toFixed(0)} rating ${p.rating?.value ?? '-'} (${p.rating?.low}-${p.rating?.high}) elo ${p.elo ?? '?'}  ${counts}`);
    }
    if (r.opening) console.log(`opening: ${r.opening.eco} ${r.opening.name}`);
  }
  closeEngine();
  process.exit(0);
}

main();
