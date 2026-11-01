/** Shared helpers for the Node tools: engine, analysis cache, bundled data. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { OpeningBook, type OpeningDb } from '../src/core/openings';
import { hashKey } from '../src/core/hash';
import { analyzeGame, type AnalysisSettings } from '../src/engine/analyzer';
import { NodeEngine } from '../src/engine/nodeEngine';
import type { ParsedGame, PositionAnalysis } from '../src/core/types';
import type { RatingModel } from '../src/core/rating';

export const book = new OpeningBook(JSON.parse(readFileSync('src/data/openings.json', 'utf8')) as OpeningDb);
export const ratingModel = JSON.parse(readFileSync('src/data/rating-model.json', 'utf8')) as RatingModel;

let engine: NodeEngine | undefined;
export async function getEngine(flavor: 'lite-single' | 'single' = 'lite-single'): Promise<NodeEngine> {
  if (!engine) {
    engine = new NodeEngine(flavor);
    await engine.init();
  }
  return engine;
}

export function cacheKey(game: ParsedGame, s: AnalysisSettings, engineId: string): string {
  return hashKey([game.startFen, game.plies.map((p) => p.uci).join(' '), engineId, s.depth, s.multipv, s.adaptive].join('|'));
}

export async function analyzeCached(game: ParsedGame, s: AnalysisSettings, log = true, flavor: 'lite-single' | 'single' = 'lite-single'): Promise<PositionAnalysis[]> {
  const dir = 'tools/.cache/analysis';
  mkdirSync(dir, { recursive: true });
  const engineId = flavor === 'lite-single' ? 'sf18-lite' : 'sf18-full';
  const file = `${dir}/${cacheKey(game, s, engineId)}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const e = await getEngine(flavor);
  await e.newGame();
  const t0 = Date.now();
  const bookPositions = new Set<number>();
  game.plies.forEach((p, i) => book.has(p.fenAfter) && bookPositions.add(i + 1));
  const res = await analyzeGame(e, game, {
    settings: s,
    isBook: (i) => bookPositions.has(i),
    onPosition: (_i, _a, p) => {
      if (log) process.stderr.write(`\r  ${p.done}/${p.total}  eta ${(p.etaMs / 1000).toFixed(0)}s   `);
    },
  });
  if (log) process.stderr.write(`\r  ${res.length} positions in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  writeFileSync(file, JSON.stringify(res));
  return res;
}


export function closeEngine(): void {
  engine?.dispose();
}
