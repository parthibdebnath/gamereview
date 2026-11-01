import { UciEngine } from './uci';
import type { EngineInfo } from './types';

/**
 * Stockfish 18 compiled to WebAssembly (stockfish.js by Nathan Rugg, GPLv3), running in a Web
 * Worker. The engine script *is* the worker: it reads UCI commands from postMessage and posts
 * output lines back.
 *
 * Flavours shipped in /engine (copied from node_modules/stockfish by scripts/copy-engine.mjs):
 *  - stockfish-18-lite.js / .wasm          multi-threaded, needs SharedArrayBuffer (COOP/COEP)
 *  - stockfish-18-lite-single.js / .wasm   single-threaded fallback
 * Both use the small (~7 MB) NNUE net; see DECISIONS.md (D-ENG-1) for why not the 113 MB one.
 */
export function canUseThreads(): boolean {
  return (
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof crossOriginIsolated !== 'undefined' &&
    crossOriginIsolated === true
  );
}

export function defaultThreads(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(cores - 1, 4));
}

export interface WorkerEngineOptions {
  /** Requested threads; ignored (1) when SharedArrayBuffer is unavailable. */
  threads?: number;
  hashMb?: number;
  base?: string;
}

export class WorkerEngine extends UciEngine {
  private worker?: Worker;

  constructor(private opts: WorkerEngineOptions = {}) {
    super();
  }

  protected post(cmd: string): void {
    this.worker?.postMessage(cmd);
  }

  async init(): Promise<EngineInfo> {
    const threaded = canUseThreads() && (this.opts.threads ?? defaultThreads()) > 1;
    const file = threaded ? 'stockfish-18-lite.js' : 'stockfish-18-lite-single.js';
    const base = this.opts.base ?? import.meta.env.BASE_URL + 'engine/';
    this.worker = new Worker(base + file);
    this.worker.onmessage = (e: MessageEvent) => {
      const data = typeof e.data === 'string' ? e.data : String(e.data ?? '');
      for (const line of data.split('\n')) if (line) this.receive(line);
    };
    const failed = new Promise<never>((_, reject) => {
      this.worker!.onerror = (e) => reject(new Error(e.message || 'Engine failed to load'));
    });
    const lines = await Promise.race([this.request('uci', (l) => l === 'uciok'), failed]);
    const name = lines.find((l) => l.startsWith('id name '))?.slice(8) ?? 'Stockfish';
    const threads = threaded ? this.opts.threads ?? defaultThreads() : 1;
    if (threaded) this.setOption('Threads', threads);
    this.setOption('Hash', this.opts.hashMb ?? (threaded ? 64 : 32));
    await this.isReady();
    this.info = {
      name: `${name} (lite NNUE, ${threads} thread${threads > 1 ? 's' : ''})`,
      id: 'sf18-lite',
      threads,
      multiThreaded: threaded,
    };
    return this.info;
  }

  dispose(): void {
    this.post('quit');
    this.worker?.terminate();
    this.worker = undefined;
  }
}
