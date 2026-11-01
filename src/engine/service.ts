/**
 * Engines for the whole app.
 *
 * Full-game reviews run on a *pool* of single-threaded engines, each analysing different
 * positions; this scales with cores far better than one multi-threaded engine at fixed depth
 * and needs no cross-origin isolation (DECISIONS.md D-ENG-7). The first pool engine also
 * serves live analysis (eval bar while exploring), which only runs when no review is in
 * progress; each new live request cancels the previous one.
 *
 * `engineMode: 'threads'` keeps the single multi-threaded engine path (needs COOP/COEP).
 */
import type { PositionAnalysis } from '../core/types';
import type { EngineAdapter, EngineInfo } from './types';
import { WorkerEngine, canUseThreads, defaultThreads } from './workerEngine';

export type EngineMode = 'pool' | 'threads';
export type EngineNet = 'lite' | 'full';

let pool: EngineAdapter[] = [];
let infos: Promise<EngineInfo[]> | undefined;
let poolKey = '';
let reviewing = false;
let liveToken = 0;
let liveAbort: AbortController | undefined;

/** Factory, so a native engine (e.g. Tauri sidecar) can be swapped in. See README. */
export let createEngine: (threads: number, net: EngineNet) => EngineAdapter = (threads, net) =>
  new WorkerEngine({ threads, net, hashMb: threads > 1 ? 64 : net === 'full' ? 32 : 24 });
export function setEngineFactory(f: (threads: number, net: EngineNet) => EngineAdapter): void {
  createEngine = f;
  dispose();
}

/** Number of engines (pool mode) or threads (threads mode) for a setting of 0 = auto. */
export function resolveWorkers(setting: number, net: EngineNet = 'lite'): number {
  if (setting > 0) return setting;
  // Full-net engines need ~250 MB each; cap the automatic count.
  return net === 'full' ? Math.min(defaultThreads(), 3) : defaultThreads();
}

export async function getEngines(setting = 0, mode: EngineMode = 'pool', net: EngineNet = 'lite'): Promise<{ engines: EngineAdapter[]; info: EngineInfo }> {
  const n = resolveWorkers(setting, net);
  // The full net only exists as a single-threaded build.
  const threaded = mode === 'threads' && net === 'lite' && canUseThreads();
  const key = `${n}|${threaded}|${net}`;
  if (!pool.length || key !== poolKey) {
    dispose();
    poolKey = key;
    pool = threaded ? [createEngine(n, net)] : Array.from({ length: n }, () => createEngine(1, net));
    infos = Promise.all(pool.map((e) => e.init())).catch((e) => {
      dispose();
      throw e;
    });
  }
  const all = await infos!;
  const base = all[0];
  const info: EngineInfo = threaded
    ? base
    : { ...base, name: `${base.name.replace(/ \(.*\)$/, '')} (${net} NNUE, ${pool.length} parallel engine${pool.length > 1 ? 's' : ''})`, threads: pool.length };
  return { engines: pool, info };
}

/** Compatibility helper: the first engine. */
export async function getEngine(setting = 0, mode: EngineMode = 'pool', net: EngineNet = 'lite'): Promise<{ engine: EngineAdapter; info: EngineInfo }> {
  const { engines, info } = await getEngines(setting, mode, net);
  return { engine: engines[0], info };
}

export function dispose(): void {
  for (const e of pool) e.dispose();
  pool = [];
  infos = undefined;
  poolKey = '';
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
  opts: { threads?: number; mode?: EngineMode; net?: EngineNet; depth?: number; multipv?: number } = {},
): Promise<PositionAnalysis | undefined> {
  if (reviewing) return undefined;
  const token = ++liveToken;
  liveAbort?.abort();
  const abort = (liveAbort = new AbortController());
  const { engine: e } = await getEngine(opts.threads, opts.mode, opts.net);
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
