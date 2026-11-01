/**
 * Cross-check against Lichess on real games.
 *
 *   npx vite-node tools/validate.ts -- [--games 30] [--preset standard] [--depth N] [--multipv N] [--no-adaptive]
 *
 * Uses rated games from the Lichess database sample (.data/lichess-evals-100k.pgn, see
 * tools/calibrate.ts), which carry Lichess's server-analysis evals and its judgments
 * (?! inaccuracy, ? mistake, ?? blunder). For each game we run our own on-device pipeline
 * and report:
 *   - accuracy: ours (our engine) vs Lichess's method on Lichess's evals
 *   - move judgments: agreement with Lichess on inaccuracy/mistake/blunder
 *     (with our thresholds, and with Lichess's thresholds to separate engine vs threshold effects)
 *   - time per game
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parsePgn } from '../src/core/pgn';
import { buildReview } from '../src/core/review';
import { gameAccuracy } from '../src/core/accuracy';
import { PRESETS, type AnalysisSettings, type PresetName } from '../src/engine/analyzer';
import { winPct, CP_CEILING } from '../src/core/winpct';
import { analyzeCached, book, ratingModel, closeEngine } from './lib';
import { selectGames } from './validate-select';
import type { Score } from '../src/core/types';

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const nGames = Number(opt('--games') ?? 30);
const preset = (opt('--preset') ?? 'standard') as PresetName;
const settings: AnalysisSettings = { ...PRESETS[preset] };
if (opt('--depth')) settings.depth = Number(opt('--depth'));
if (opt('--multipv')) settings.multipv = Number(opt('--multipv'));
if (args.includes('--no-adaptive')) settings.adaptive = false;
const source = opt('--source') ?? '.data/lichess-evals-100k.pgn';

function lichessEvals(pgn: string): Score[] {
  const body = pgn.slice(pgn.indexOf('\n\n') + 2);
  return [...body.matchAll(/\[%eval\s+(#?)(-?[\d.]+)\]/g)].map((m) => (m[1] ? { mate: Number(m[2]) } : { cp: Math.round(Number(m[2]) * 100) }));
}

function lichessJudgments(pgn: string): ('inaccuracy' | 'mistake' | 'blunder' | undefined)[] {
  const body = pgn.slice(pgn.indexOf('\n\n') + 2).replace(/\{[^}]*\}/g, ' ');
  const tokens = body.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  return tokens.map((t) => (t.endsWith('??') ? 'blunder' : t.endsWith('?!') ? 'inaccuracy' : t.endsWith('?') ? 'mistake' : undefined));
}

const severityOf = (c: string | undefined) =>
  c === 'blunder' ? 3 : c === 'mistake' || c === 'miss' ? 2 : c === 'inaccuracy' ? 1 : 0;

async function main() {
  const text = readFileSync(source, 'utf8');
  const games = selectGames(text, nGames);
  mkdirSync('tools/.cache', { recursive: true });
  let accErr: number[] = [];
  const accErrSeq: number[] = [];
  const accErrTop: number[] = [];
  const conf = Array.from({ length: 4 }, () => [0, 0, 0, 0]); // conf[lichess][ours]
  const confL = Array.from({ length: 4 }, () => [0, 0, 0, 0]); // ours with Lichess thresholds
  const rows: string[] = [];
  let totalTime = 0;
  let ratingErr: number[] = [];

  for (const [gi, pgn] of games.entries()) {
    const game = parsePgn(pgn);
    const t0 = Date.now();
    const analyses = await analyzeCached(game, settings, false);
    const dt = Date.now() - t0;
    totalTime += dt;
    const review = buildReview(game, analyses, { book, ratingModel });
    const seqReview = buildReview(game, analyses, { book, accuracyMode: 'sequential' });
    const topReview = buildReview(game, analyses, { book, accuracyMode: 'top' });

    // Lichess accuracy from Lichess evals (start position = +15 cp, as in lila).
    const evals = lichessEvals(pgn);
    const whiteScores: Score[] = [{ cp: 15 }, ...evals];
    const lastSan = game.plies.at(-1)?.san ?? '';
    if (lastSan.endsWith('#') && whiteScores.length === game.plies.length) whiteScores.push({ cp: game.plies.at(-1)!.side === 'w' ? CP_CEILING : -CP_CEILING });
    const lw = whiteScores.map((s) => winPct(s.mate !== undefined ? { cp: Math.sign(s.mate) * CP_CEILING } : s, 'ceiling'));
    const lacc = gameAccuracy(lw, 'w');
    for (const side of ['w', 'b'] as const) {
      const ours = side === 'w' ? review.white.accuracy : review.black.accuracy;
      const theirs = side === 'w' ? lacc.white : lacc.black;
      if (ours !== null && theirs !== null) accErr.push(ours - theirs);
      const seq = side === 'w' ? seqReview.white.accuracy : seqReview.black.accuracy;
      if (seq !== null && theirs !== null) accErrSeq.push(seq - theirs);
      const top = side === 'w' ? topReview.white.accuracy : topReview.black.accuracy;
      if (top !== null && theirs !== null) accErrTop.push(top - theirs);
      const p = side === 'w' ? review.white : review.black;
      if (p.rating && p.elo) ratingErr.push(p.rating.value - p.elo);
    }

    const lj = lichessJudgments(pgn);
    review.moves.forEach((m, i) => {
      if (!m) return;
      const l = severityOf(lj[i]);
      conf[l][severityOf(m.verdict.base === 'best' ? m.verdict.classification : m.verdict.classification)]++;
      const loss = m.verdict.loss;
      const lt = loss >= 0.15 ? 3 : loss >= 0.1 ? 2 : loss >= 0.05 ? 1 : 0;
      confL[l][lt]++;
    });
    rows.push(
      `${String(gi + 1).padStart(2)} ${game.headers.WhiteElo}/${game.headers.BlackElo} ${String(game.plies.length).padStart(3)} plies ${(dt / 1000).toFixed(0).padStart(4)}s  acc W ${review.white.accuracy?.toFixed(1)} vs ${lacc.white?.toFixed(1)}  B ${review.black.accuracy?.toFixed(1)} vs ${lacc.black?.toFixed(1)}  rating W ${review.white.rating?.value} B ${review.black.rating?.value}`,
    );
    process.stderr.write(`\r${gi + 1}/${games.length}`);
  }
  process.stderr.write('\n');
  const mae = (xs: number[]) => xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length;
  const bias = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const names = ['ok', 'inacc', 'mistake', 'blunder'];
  const table = (c: number[][]) =>
    ['lichess\\ours ' + names.map((n) => n.padStart(8)).join(''), ...c.map((r, i) => names[i].padEnd(13) + r.map((v) => String(v).padStart(8)).join(''))].join('\n');
  const agree = (c: number[][]) => {
    // Of the moves Lichess flags (any severity), how many we flag; and exact-severity agreement.
    let flagged = 0;
    let caught = 0;
    let exact = 0;
    let ourFlags = 0;
    let ourConfirmed = 0;
    for (let l = 0; l < 4; l++)
      for (let o = 0; o < 4; o++) {
        if (l > 0) {
          flagged += c[l][o];
          if (o > 0) caught += c[l][o];
          if (o === l) exact += c[l][o];
        }
        if (o > 0) {
          ourFlags += c[l][o];
          if (l > 0) ourConfirmed += c[l][o];
        }
      }
    return `recall ${(100 * caught / flagged).toFixed(0)}%  precision ${(100 * ourConfirmed / ourFlags).toFixed(0)}%  same severity ${(100 * exact / flagged).toFixed(0)}%`;
  };
  const report = [
    `settings: ${JSON.stringify(settings)}  games: ${games.length}`,
    ...rows,
    '',
    `accuracy vs Lichess: MAE ${mae(accErr).toFixed(2)}  bias ${bias(accErr).toFixed(2)}  (n=${accErr.length})`,
    `  sequential-only accuracy: MAE ${mae(accErrSeq).toFixed(2)}  bias ${bias(accErrSeq).toFixed(2)}`,
    `  top-move-only override:   MAE ${mae(accErrTop).toFixed(2)}  bias ${bias(accErrTop).toFixed(2)}`,
    `rating estimate vs actual Elo: MAE ${mae(ratingErr).toFixed(0)}  bias ${bias(ratingErr).toFixed(0)}  (n=${ratingErr.length})`,
    `time: ${(totalTime / 1000).toFixed(0)}s total, ${(totalTime / games.length / 1000).toFixed(1)}s per game (cached games count as 0)`,
    '',
    'Judgments, our classifier (miss counted as mistake):',
    table(conf),
    agree(conf),
    '',
    'Judgments, our engine + Lichess thresholds (5/10/15%):',
    table(confL),
    agree(confL),
  ].join('\n');
  console.log(report);
  const tag = `${preset}-d${settings.depth}-mpv${settings.multipv}${settings.adaptive ? '' : '-noadapt'}`;
  writeFileSync(`tools/.cache/validate-${tag}.txt`, report);
  closeEngine();
  process.exit(0);
}

main();
