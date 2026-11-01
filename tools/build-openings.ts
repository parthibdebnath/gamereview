/**
 * Builds src/data/openings.json from the Lichess chess-openings TSVs (CC0).
 *
 *   1. Download a.tsv..e.tsv from https://github.com/lichess-org/chess-openings into tools/.cache/openings
 *   2. npx vite-node tools/build-openings.ts
 *
 * Output format (compact): { names: string[], pos: { [hash53(EPD) base36]: nameIndex | -1 } }
 * Every position along every named line is included, so intermediate positions also count as
 * "book"; -1 marks a book position that has no name of its own.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Chess } from 'chess.js';
import { epd } from '../src/core/pgn';
import { hashKey } from '../src/core/hash';

const dir = 'tools/.cache/openings';
const rows: { eco: string; name: string; pgn: string }[] = [];
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const path = `${dir}/${f}.tsv`;
  if (!existsSync(path)) throw new Error(`Missing ${path}; see the header of this script.`);
  const lines = readFileSync(path, 'utf8').trim().split('\n').slice(1);
  for (const l of lines) {
    const [eco, name, pgn] = l.split('\t');
    rows.push({ eco, name, pgn });
  }
}

const names: string[] = [];
const nameIdx = new Map<string, number>();
const named = new Map<string, { idx: number; plies: number }>();
const book = new Set<string>();

for (const r of rows) {
  const chess = new Chess();
  const sans = r.pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
  for (const s of sans) {
    chess.move(s);
    book.add(hashKey(epd(chess.fen())));
  }
  const key = hashKey(epd(chess.fen()));
  const label = `${r.eco}|${r.name}`;
  if (!nameIdx.has(label)) {
    nameIdx.set(label, names.length);
    names.push(label);
  }
  const prev = named.get(key);
  // On transpositions keep the name reached in the fewest moves (the "canonical" order).
  if (!prev || sans.length < prev.plies) named.set(key, { idx: nameIdx.get(label)!, plies: sans.length });
}

const pos: Record<string, number> = {};
for (const k of book) pos[k] = named.get(k)?.idx ?? -1;
writeFileSync('src/data/openings.json', JSON.stringify({ names, pos }));
console.log(`openings: ${rows.length} lines, ${names.length} names, ${book.size} book positions`);
