import { hashKey } from './hash';
import { epd } from './pgn';

export interface OpeningDb {
  names: string[];
  pos: Record<string, number>;
}

export interface Opening {
  eco: string;
  name: string;
}

/** Wraps the compact openings table built by tools/build-openings.ts. */
export class OpeningBook {
  constructor(private db: OpeningDb) {}

  /** Whether the position (any FEN) is in the book. */
  has(fen: string): boolean {
    return hashKey(epd(fen)) in this.db.pos;
  }

  /** The opening named exactly at this position, if any. */
  name(fen: string): Opening | undefined {
    const idx = this.db.pos[hashKey(epd(fen))];
    if (idx === undefined || idx < 0) return undefined;
    const [eco, name] = this.db.names[idx].split('|');
    return { eco, name };
  }
}

let cached: Promise<OpeningBook> | undefined;

/** Lazily load the bundled openings table (kept out of the main chunk). */
export function loadOpeningBook(): Promise<OpeningBook> {
  cached ??= import('../data/openings.json').then((m) => new OpeningBook((m.default ?? m) as OpeningDb));
  return cached;
}
