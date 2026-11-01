/**
 * Experiment: which way of measuring a move's loss agrees best with Lichess's judgments?
 * Re-uses cached analyses from tools/validate.ts (no engine runs).
 *
 *   npx vite-node tools/judge-variants.ts -- [--multipv 2] [--games 30]
 */
import { readFileSync } from 'node:fs';
import { parsePgn } from '../src/core/pgn';
import { buildReview, positionEval } from '../src/core/review';
import { PRESETS, type AnalysisSettings } from '../src/engine/analyzer';
import { analyzeCached, book, closeEngine } from './lib';
import { selectGames } from './validate-select';

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const settings: AnalysisSettings = { ...PRESETS.standard };
if (opt('--multipv')) settings.multipv = Number(opt('--multipv'));
const games = selectGames(readFileSync('.data/lichess-evals-100k.pgn', 'utf8'), Number(opt('--games') ?? 30));

function judgments(pgn: string): number[] {
  const body = pgn.slice(pgn.indexOf('\n\n') + 2).replace(/\{[^}]*\}/g, ' ');
  return body
    .split(/\s+/)
    .filter((t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    .map((t) => (t.endsWith('??') ? 3 : t.endsWith('?!') ? 1 : t.endsWith('?') ? 2 : 0));
}
const sev = (loss: number, t: number[]) => (loss > t[2] ? 3 : loss > t[1] ? 2 : loss > t[0] ? 1 : 0);
const CHESSCOM = [0.05, 0.1, 0.2];
const LICHESS = [0.05, 0.1, 0.15];

type Variant = { name: string; conf: number[][] };
const variants: Variant[] = ['classifier (same-search loss)', 'sequential, chess.com thresholds', 'sequential, Lichess thresholds', 'max(same-search, sequential), chess.com thresholds'].map((name) => ({
  name,
  conf: Array.from({ length: 4 }, () => [0, 0, 0, 0]),
}));

async function main() {
  for (const pgn of games) {
    const game = parsePgn(pgn);
    const a = await analyzeCached(game, settings, false);
    const r = buildReview(game, a, { book });
    const lj = judgments(pgn);
    const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
    const ww = fens.map((f, i) => (positionEval(f, a[i]).winWhite ?? 50) / 100);
    r.moves.forEach((m, i) => {
      if (!m) return;
      const c = m.verdict.classification;
      if (c === 'book' || c === 'forced') return;
      const l = lj[i];
      const s0 = c === 'blunder' ? 3 : c === 'mistake' || c === 'miss' ? 2 : c === 'inaccuracy' ? 1 : 0;
      const seq = Math.max(0, m.ply.side === 'w' ? ww[i] - ww[i + 1] : ww[i + 1] - ww[i]);
      variants[0].conf[l][s0]++;
      variants[1].conf[l][sev(seq, CHESSCOM)]++;
      variants[2].conf[l][sev(seq, LICHESS)]++;
      variants[3].conf[l][Math.max(s0, sev(seq, CHESSCOM))]++;
    });
  }
  for (const v of variants) {
    let flagged = 0, caught = 0, exact = 0, ours = 0, confirmed = 0, within1 = 0;
    for (let l = 0; l < 4; l++)
      for (let o = 0; o < 4; o++) {
        const n = v.conf[l][o];
        if (l) {
          flagged += n;
          if (o) caught += n;
          if (o === l) exact += n;
          if (o && Math.abs(o - l) <= 1) within1 += n;
        }
        if (o) {
          ours += n;
          if (l) confirmed += n;
        }
      }
    console.log(
      `${v.name.padEnd(52)} recall ${((100 * caught) / flagged).toFixed(0)}%  precision ${((100 * confirmed) / ours).toFixed(0)}%  same severity ${((100 * exact) / flagged).toFixed(0)}%  within one ${((100 * within1) / flagged).toFixed(0)}%`,
    );
  }
  closeEngine();
  process.exit(0);
}
main();
