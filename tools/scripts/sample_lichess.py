"""
Stream a Lichess monthly database (https://database.lichess.org, CC0) and keep rated standard
games that carry server-analysis evals ([%eval ...]). Stops after --games matches, so only a
small prefix of the multi-GB file is downloaded.

  pip install zstandard
  python3 tools/scripts/sample_lichess.py --month 2025-06 --games 30000 --out .data/lichess-evals.pgn
"""
import argparse, io, sys, urllib.request
import zstandard

ap = argparse.ArgumentParser()
ap.add_argument('--month', default='2025-06')
ap.add_argument('--games', type=int, default=30000)
ap.add_argument('--out', default='.data/lichess-evals.pgn')
a = ap.parse_args()

url = f'https://database.lichess.org/standard/lichess_db_standard_rated_{a.month}.pgn.zst'
resp = urllib.request.urlopen(url)
reader = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(resp), encoding='utf-8', errors='replace')

kept = seen = 0
game = []
with open(a.out, 'w') as out:
    def flush():
        global kept, seen
        if not game: return
        seen += 1
        text = ''.join(game)
        if '[%eval' in text and '[WhiteElo "?"' not in text and '[BlackElo "?"' not in text \
           and '[Variant ' not in text and 'Termination "Abandoned"' not in text:
            out.write(text.strip() + '\n\n')
            kept += 1
            if kept % 1000 == 0:
                print(f'kept {kept} / seen {seen}', file=sys.stderr, flush=True)
    for line in reader:
        if line.startswith('[Event ') and game and any(l.startswith('1.') for l in game):
            flush(); game = []
            if kept >= a.games: break
        game.append(line)
print(f'done: kept {kept} of {seen} games', file=sys.stderr)
