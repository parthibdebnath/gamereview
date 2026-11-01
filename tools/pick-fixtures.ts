/** Writes a few rated Lichess games (CC0) at different levels to tests/fixtures/games, comments stripped. */
import { readFileSync, writeFileSync } from 'node:fs';
import { selectGames } from './validate-select';
const text = readFileSync('.data/lichess-evals-100k.pgn', 'utf8');
const games = selectGames(text, 30);
const want = [900, 1500, 2100];
for (const target of want) {
  const g = games
    .map((p) => ({ p, avg: (Number(p.match(/WhiteElo "(\d+)"/)![1]) + Number(p.match(/BlackElo "(\d+)"/)![1])) / 2 }))
    .sort((a, b) => Math.abs(a.avg - target) - Math.abs(b.avg - target))[0].p;
  const [head, ...rest] = g.split('\n\n');
  const keep = head.split('\n').filter((l) => /^\[(Event|Site|Date|White|Black|Result|WhiteElo|BlackElo|TimeControl|ECO|Opening|Termination) /.test(l)).join('\n');
  const moves = rest.join('\n\n').replace(/\{[^}]*\}/g, '').replace(/\d+\.\.\./g, '').replace(/[?!]+/g, '').replace(/\s+/g, ' ').trim();
  writeFileSync(`tests/fixtures/games/lichess-${target}.pgn`, `${keep}\n\n${moves}\n`);
  console.log(target, keep.split('\n')[1]);
}
