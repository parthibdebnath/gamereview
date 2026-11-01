/**
 * Full-game regression snapshots: the whole review (classes, accuracy, rating, explanations)
 * rebuilt from recorded engine analysis. Update deliberately with `npx vitest -u` and review
 * the diff.
 */
import { describe, expect, it } from 'vitest';
import { buildReview } from '../src/core/review';
import { formatScore } from '../src/core/winpct';
import { book, fixture, ratingModel } from './helpers';

const GAMES = ['opera', 'immortal', 'evergreen', 'century', 'legal', 'lichess-900', 'lichess-1500', 'lichess-2100'];

describe('full-game review snapshots', () => {
  for (const name of GAMES) {
    it(name, () => {
      const { game, analyses } = fixture(name);
      const r = buildReview(game, analyses, { book, ratingModel });
      const moves = r.moves.map((m, i) => {
        const p = game.plies[i];
        return `${p.moveNumber}${p.side === 'w' ? '.' : '...'}${p.san} ${m!.verdict.classification} ${formatScore(r.positions[i + 1].score!)} | ${m!.explanation.text}`;
      });
      const player = (p: typeof r.white) => ({
        accuracy: p.accuracy?.toFixed(1),
        acpl: Math.round(p.acpl),
        rating: p.rating && `${p.rating.value} (${p.rating.low}-${p.rating.high})`,
        counts: Object.fromEntries(Object.entries(p.counts).filter(([, n]) => n)),
      });
      expect({ opening: r.opening?.name, white: player(r.white), black: player(r.black), keyMoments: r.keyMoments, moves }).toMatchSnapshot();
    });
  }
});
