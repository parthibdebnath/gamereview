import { Chess } from 'chess.js';
import type { ParsedGame, PositionAnalysis } from '../core/types';
import type { EngineAdapter } from './types';
import { scoreToCp } from '../core/winpct';

export type PresetName = 'fast' | 'standard' | 'deep';

export interface AnalysisSettings {
  depth: number;
  multipv: number;
  /**
   * Adaptive depth (see DECISIONS.md D-ENG-3): book and single-reply positions are searched
   * shallower, and positions that are already decided (|eval| > ~6 pawns or mate) lose a few
   * plies. These positions can't change a classification much, and the saved time goes back
   * into the rest of the game.
   */
  adaptive: boolean;
}

export const PRESETS: Record<PresetName, AnalysisSettings> = {
  fast: { depth: 12, multipv: 3, adaptive: true },
  standard: { depth: 16, multipv: 3, adaptive: true },
  deep: { depth: 20, multipv: 3, adaptive: true },
};

export interface Progress {
  done: number;
  total: number;
  /** Estimated milliseconds remaining. */
  etaMs: number;
  elapsedMs: number;
}

export interface AnalyzeGameOptions {
  settings: AnalysisSettings;
  /** Already-known results (from cache) - skipped. */
  known?: (PositionAnalysis | undefined)[];
  /** Positions considered book (index = position index); they get a shallower search. */
  isBook?: (positionIndex: number) => boolean;
  onPosition?: (index: number, analysis: PositionAnalysis, progress: Progress) => void;
  signal?: AbortSignal;
}

/** Positions of a game: index 0 = start, index i = after ply i-1. */
export function gamePositions(game: ParsedGame): string[] {
  return [game.startFen, ...game.plies.map((p) => p.fenAfter)];
}

/** Terminal states that need no engine. `moves` (UCI from start) enables repetition detection. */
export function terminalState(startFen: string, moves: string[]): PositionAnalysis['terminal'] | undefined {
  const chess = new Chess(startFen);
  for (const u of moves) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isInsufficientMaterial() || chess.isThreefoldRepetition() || chess.isDrawByFiftyMoves()) return 'draw';
  return undefined;
}

export function depthFor(index: number, game: ParsedGame, settings: AnalysisSettings, prev: PositionAnalysis | undefined, book: boolean): number {
  if (!settings.adaptive) return settings.depth;
  let d = settings.depth;
  if (book) d = Math.min(d, 12);
  // Only one legal reply in this position: nothing to compare against.
  const legal = index < game.plies.length ? game.plies[index].legalMoves : 2;
  if (legal === 1) d = Math.min(d, 10);
  const prevTop = prev?.lines[0];
  if (prevTop && Math.abs(scoreToCp(prevTop.score)) >= 600) d -= 3;
  return Math.max(8, d);
}

/**
 * Analyse every position of a game in order, streaming results. Resolves with all analyses
 * (or rejects with an AbortError if cancelled - results streamed so far stay valid).
 */
export async function analyzeGame(engine: EngineAdapter, game: ParsedGame, opts: AnalyzeGameOptions): Promise<PositionAnalysis[]> {
  const fens = gamePositions(game);
  const uci = game.plies.map((p) => p.uci);
  const out: PositionAnalysis[] = [];
  const started = Date.now();
  const todo = fens.map((_, i) => !opts.known?.[i]).filter(Boolean).length;
  let doneNew = 0;
  let workMs = 0;

  for (let i = 0; i < fens.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    const known = opts.known?.[i];
    let analysis: PositionAnalysis;
    if (known) {
      analysis = known;
    } else {
      const t0 = Date.now();
      const moves = uci.slice(0, i);
      const terminal = terminalState(game.startFen, moves);
      if (terminal) {
        analysis = { depth: 0, lines: [], terminal };
      } else {
        const depth = depthFor(i, game, opts.settings, out[i - 1], opts.isBook?.(i) ?? false);
        analysis = await engine.analyze(game.startFen, { depth, multipv: opts.settings.multipv, moves, signal: opts.signal });
        if (opts.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
      }
      workMs += Date.now() - t0;
      doneNew++;
    }
    out[i] = analysis;
    const remaining = todo - doneNew;
    // Later positions tend to be faster (simpler), so the plain average is slightly pessimistic.
    const avg = doneNew ? workMs / doneNew : 0;
    opts.onPosition?.(i, analysis, {
      done: i + 1,
      total: fens.length,
      etaMs: Math.round(avg * remaining),
      elapsedMs: Date.now() - started,
    });
  }
  return out;
}
