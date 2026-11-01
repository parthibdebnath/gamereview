import type { PositionAnalysis, PvLine, Score } from '../core/types';
import type { AnalyzeOptions, EngineAdapter, EngineInfo } from './types';

export interface InfoLine {
  depth: number;
  multipv: number;
  score: Score;
  pv: string[];
  nodes?: number;
  time?: number;
  /** true for lowerbound/upperbound fail-high/low updates, which aren't exact scores. */
  bound: boolean;
}

/** Parse a UCI "info" line. Returns undefined for lines without a score and pv. */
export function parseInfo(line: string): InfoLine | undefined {
  if (!line.startsWith('info ') || !line.includes(' pv ') || !line.includes(' score ')) return undefined;
  const t = line.split(/\s+/);
  const out: InfoLine = { depth: 0, multipv: 1, score: {}, pv: [], bound: false };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        out.depth = Number(t[++i]);
        break;
      case 'multipv':
        out.multipv = Number(t[++i]);
        break;
      case 'nodes':
        out.nodes = Number(t[++i]);
        break;
      case 'time':
        out.time = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const v = Number(t[++i]);
        out.score = kind === 'mate' ? { mate: v } : { cp: v };
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') {
          out.bound = true;
          i++;
        }
        break;
      }
      case 'pv':
        out.pv = t.slice(i + 1);
        i = t.length;
        break;
    }
  }
  return out;
}

/** Collects info lines of one search into a PositionAnalysis. */
export class SearchCollector {
  private lines = new Map<number, PvLine>();
  private depth = 0;
  private nodes = 0;
  private time = 0;

  push(info: InfoLine): void {
    if (info.bound || !info.pv.length) return;
    this.lines.set(info.multipv, { rank: info.multipv, score: info.score, pv: info.pv, depth: info.depth });
    if (info.multipv === 1) this.depth = Math.max(this.depth, info.depth);
    if (info.nodes) this.nodes = info.nodes;
    if (info.time) this.time = info.time;
  }

  result(multipv: number): PositionAnalysis {
    const lines = [...this.lines.values()]
      .filter((l) => l.rank <= multipv)
      .sort((a, b) => a.rank - b.rank);
    return { depth: this.depth, lines, nodes: this.nodes, timeMs: this.time };
  }
}

/**
 * Engine-agnostic UCI driver. Subclasses only provide `post` (send a command) and call
 * `receive` for every output line.
 */
export abstract class UciEngine implements EngineAdapter {
  protected listeners = new Set<(line: string) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private multipvSet = 0;
  private searching = false;
  protected info: EngineInfo = { name: 'UCI engine', id: 'uci', threads: 1, multiThreaded: false };

  protected abstract post(cmd: string): void;
  abstract init(): Promise<EngineInfo>;
  abstract dispose(): void;

  protected receive(line: string): void {
    for (const l of this.listeners) l(line);
  }

  /** Send a command and wait for a line matching `until`. */
  protected request(cmd: string, until: (line: string) => boolean): Promise<string[]> {
    return new Promise((resolve) => {
      const seen: string[] = [];
      const listener = (line: string) => {
        seen.push(line);
        if (until(line)) {
          this.listeners.delete(listener);
          resolve(seen);
        }
      };
      this.listeners.add(listener);
      this.post(cmd);
    });
  }

  protected isReady(): Promise<string[]> {
    return this.request('isready', (l) => l === 'readyok');
  }

  setOption(name: string, value: string | number | boolean): void {
    this.post(`setoption name ${name} value ${value}`);
  }

  async newGame(): Promise<void> {
    await this.enqueue(async () => {
      this.post('ucinewgame');
      await this.isReady();
    });
  }

  stop(): void {
    if (this.searching) this.post('stop');
  }

  /** Searches run strictly one at a time. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  analyze(fen: string, opts: AnalyzeOptions): Promise<PositionAnalysis> {
    return this.enqueue(async () => {
      if (opts.signal?.aborted) return { depth: 0, lines: [] };
      if (this.multipvSet !== opts.multipv) {
        this.setOption('MultiPV', opts.multipv);
        this.multipvSet = opts.multipv;
        await this.isReady();
      }
      const collector = new SearchCollector();
      const go = opts.depth ? `go depth ${opts.depth}` : `go movetime ${opts.movetime ?? 1000}`;
      const position = opts.moves?.length ? `position fen ${fen} moves ${opts.moves.join(' ')}` : `position fen ${fen}`;
      this.post(position);
      this.searching = true;
      const onAbort = () => this.post('stop');
      opts.signal?.addEventListener('abort', onAbort);
      let lastEmit = 0;
      await this.request(go, (line) => {
        const info = parseInfo(line);
        if (info) {
          collector.push(info);
          const now = Date.now();
          if (opts.onUpdate && info.multipv === 1 && now - lastEmit > 80) {
            lastEmit = now;
            opts.onUpdate(collector.result(opts.multipv));
          }
        }
        return line.startsWith('bestmove');
      });
      this.searching = false;
      opts.signal?.removeEventListener('abort', onAbort);
      return collector.result(opts.multipv);
    });
  }
}
