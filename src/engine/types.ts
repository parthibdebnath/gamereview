import type { PositionAnalysis } from '../core/types';

export interface AnalyzeOptions {
  /** Search depth. Either depth or movetime must be set. */
  depth?: number;
  /** Milliseconds per position. */
  movetime?: number;
  multipv: number;
  /** Moves (UCI) played from `fen`; lets the engine see repetitions. */
  moves?: string[];
  /** Abort: a queued search is skipped, a running one is stopped (resolves with partial lines). */
  signal?: AbortSignal;
  /** Streaming partial results (for the live eval bar). */
  onUpdate?: (partial: PositionAnalysis) => void;
}

export interface EngineInfo {
  /** e.g. "Stockfish 18 (lite, 4 threads)". */
  name: string;
  /** Stable id used in cache keys, so results from different engines/nets never mix. */
  id: string;
  threads: number;
  multiThreaded: boolean;
}

/**
 * The only thing the app knows about an engine. The WASM worker implements it today; a native
 * Stockfish (e.g. a Tauri sidecar speaking UCI over stdio) can implement the same five methods.
 */
export interface EngineAdapter {
  init(): Promise<EngineInfo>;
  setOption(name: string, value: string | number | boolean): void;
  analyze(fen: string, opts: AnalyzeOptions): Promise<PositionAnalysis>;
  /** Stop the current search; the pending analyze() resolves with what it has. */
  stop(): void;
  /** Clear hash/history between unrelated games. */
  newGame(): Promise<void>;
  dispose(): void;
}
