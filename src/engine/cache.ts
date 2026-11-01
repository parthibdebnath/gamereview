/**
 * IndexedDB persistence: engine analysis per game (+ engine settings) and review history.
 * Everything here is best-effort - in a private window or with storage blocked the app still
 * works, it just doesn't remember.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { PositionAnalysis } from '../core/types';

export interface HistoryEntry {
  id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  date: string;
  opening?: string;
  accuracy?: { w: number | null; b: number | null };
  reviewedAt: number;
}

interface AnalysisRecord {
  key: string;
  analyses: (PositionAnalysis | null)[];
  updatedAt: number;
}

let dbp: Promise<IDBPDatabase> | undefined;

function db(): Promise<IDBPDatabase> {
  dbp ??= openDB('hindsight', 1, {
    upgrade(d) {
      d.createObjectStore('analysis', { keyPath: 'key' });
      const h = d.createObjectStore('history', { keyPath: 'id' });
      h.createIndex('reviewedAt', 'reviewedAt');
    },
  });
  return dbp;
}

export async function loadAnalysis(key: string): Promise<(PositionAnalysis | undefined)[] | undefined> {
  try {
    const rec = (await (await db()).get('analysis', key)) as AnalysisRecord | undefined;
    return rec?.analyses.map((a) => a ?? undefined);
  } catch {
    return undefined;
  }
}

export async function saveAnalysis(key: string, analyses: (PositionAnalysis | undefined)[]): Promise<void> {
  try {
    const rec: AnalysisRecord = { key, analyses: analyses.map((a) => a ?? null), updatedAt: Date.now() };
    await (await db()).put('analysis', rec);
  } catch {
    /* ignore */
  }
}

export async function saveHistory(entry: HistoryEntry): Promise<void> {
  try {
    await (await db()).put('history', entry);
  } catch {
    /* ignore */
  }
}

export async function listHistory(limit = 30): Promise<HistoryEntry[]> {
  try {
    const all = (await (await db()).getAllFromIndex('history', 'reviewedAt')) as HistoryEntry[];
    return all.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

export async function deleteHistory(id: string): Promise<void> {
  try {
    await (await db()).delete('history', id);
  } catch {
    /* ignore */
  }
}
