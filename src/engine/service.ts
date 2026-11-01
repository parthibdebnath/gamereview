/**
 * One engine for the whole app. A game review takes priority; live analysis (the eval bar
 * while exploring a position) only runs when no review is in progress, and each new live
 * request cancels the previous one.
 */
import type { PositionAnalysis } from '../core/types';
import type { EngineAdapter, EngineInfo } from './types';
import { WorkerEngine, defaultThreads } from './workerEngine';

let engine: EngineAdapter | undefined;
let infoP: Promise<EngineInfo> | undefined;
let currentThreads = -1;
let reviewing = false;
let liveToken = 0;
let liveAbort: AbortController | undefined;

/** Factory, so a native engine (e.g. Tauri sidecar) can be swapped in. See README. */
export let createEngine = (threads: number): EngineAdapter => new WorkerEngine({ threads });
export function setEngineFactory(f: (threads: number) => EngineAdapter): void {
  createEngine = f;
  dispose();
}

export async function getEngine(threads = 0): Promise<{ engine: EngineAdapter; info: EngineInfo }> {
  const t = threads || defaultThreads();
  if (!engine || t !== currentThreads) {
    engine?.dispose();
    engine = createEngine(t);
    currentThreads = t;
    infoP = engine.init().catch((e) => {
      engine = undefined;
      infoP = undefined;
      throw e;
    });
  }
  const info = await infoP!;
  return { engine: engine!, info };
}

export function dispose(): void {
  engine?.dispose();
  engine = undefined;
  infoP = undefined;
}

export function setReviewing(on: boolean): void {
  reviewing = on;
  if (on) stopLive();
}

export function isReviewing(): boolean {
  return reviewing;
}

/**
 * Live analysis of a position, streaming updates. Resolves with the final result, or
 * undefined if superseded/skipped.
 */
export async function analyzeLive(
  fen: string,
  moves: string[],
  onUpdate: (a: PositionAnalysis) => void,
  opts: { threads?: number; depth?: number; multipv?: number } = {},
): Promise<PositionAnalysis | undefined> {
  if (reviewing) return undefined;
  const token = ++liveToken;
  liveAbort?.abort();
  const abort = (liveAbort = new AbortController());
  const { engine: e } = await getEngine(opts.threads);
  if (token !== liveToken || reviewing) return undefined;
  const result = await e.analyze(fen, {
    signal: abort.signal,
    depth: opts.depth ?? 18,
    multipv: opts.multipv ?? 1,
    moves,
    onUpdate: (a) => {
      if (token === liveToken) onUpdate(a);
    },
  });
  return token === liveToken ? result : undefined;
}

export function stopLive(): void {
  liveToken++;
  liveAbort?.abort();
}
