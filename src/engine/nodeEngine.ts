/**
 * The same WASM Stockfish, driven from Node. Used by tools/ (fixture generation, validation)
 * and never bundled into the app. Implements the same EngineAdapter as the browser worker.
 */
import { createRequire } from 'node:module';
import { UciEngine } from './uci';
import type { EngineInfo } from './types';

const require = createRequire(import.meta.url);

type SfModule = { listener?: (line: string) => void; sendCommand: (cmd: string) => void; terminate?: () => void };

export class NodeEngine extends UciEngine {
  private sf?: SfModule;

  constructor(private flavor: 'lite-single' | 'single' = 'lite-single', private hashMb = 64) {
    super();
  }

  protected post(cmd: string): void {
    this.sf?.sendCommand(cmd);
  }

  async init(): Promise<EngineInfo> {
    const initEngine = require('stockfish') as (flavor: string) => Promise<SfModule>;
    this.sf = await initEngine(this.flavor);
    this.sf.listener = (line: string) => this.receive(line);
    await this.request('uci', (l) => l === 'uciok');
    this.setOption('Hash', this.hashMb);
    await this.isReady();
    this.info = {
      name: `Stockfish 18 (${this.flavor}, node)`,
      id: this.flavor === 'lite-single' ? 'sf18-lite' : 'sf18-full',
      threads: 1,
      multiThreaded: false,
    };
    return this.info;
  }

  dispose(): void {
    this.sf?.terminate?.();
  }
}
