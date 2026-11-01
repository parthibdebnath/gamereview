/**
 * Template engine: turns the classifier's verdict plus verified facts into one or two short
 * sentences. Every claim made here comes from a Fact (board geometry) or an engine line; when
 * nothing specific is known we fall back to generic wording rather than inventing a reason.
 *
 * Phrasing variety: each template has several variants; the variant is picked by a hash of
 * the ply and template key, so the same game always gets the same text (snapshot-testable)
 * while consecutive moves rarely repeat a sentence.
 */
import type { MoveVerdict, Sacrifice } from './classify';
import { PIECE_NAME, VALUE, type PieceType } from './board';
import { hash53 } from './hash';
import { moveFacts, summarizeLine, lineMaterialSwing, parseUci, type Fact, type LineSummary } from './features';
import type { Opening } from './openings';
import type { PositionAnalysis, Ply } from './types';

export interface Explanation {
  text: string;
  facts: Fact[];
  /** The opponent's strongest reply when it is the point of the explanation (drawn as an arrow). */
  threatUci?: string;
}

export interface ExplainInput {
  ply: Ply;
  verdict: MoveVerdict;
  before: PositionAnalysis;
  after: PositionAnalysis;
  bestLine: string[];
  replyLine: string[];
  opening?: Opening;
  prev?: { verdict: MoveVerdict; ply: Ply };
}

function pick<T>(variants: T[], ply: number, key: string): T {
  return variants[hash53(`${ply}:${key}`) % variants.length];
}

const name = (p: PieceType) => PIECE_NAME[p];
function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

/** "a pawn", "the exchange", "a piece", ... for a material amount in pawns. */
export function materialPhrase(m: number): string {
  if (m >= 8) return 'the queen';
  if (m >= 5) return 'a rook';
  if (m >= 3) return 'a piece';
  if (m >= 2) return 'two pawns';
  if (m >= 1) return 'a pawn';
  return 'material';
}

/** Verb phrase for a fact about a move, e.g. "forks the king and rook". */
function describe(f: Fact): string | undefined {
  const [p0, p1, p2] = f.pieces;
  const [s0, s1, s2] = f.squares;
  switch (f.type) {
    case 'checkmate':
      return 'delivers checkmate';
    case 'check':
      return 'gives check';
    case 'capture':
      return `takes the ${name(p1)} on ${s0}${f.data?.check ? ' with check' : ''}`;
    case 'trade':
      if (p0 === p1) return p0 === 'p' ? `trades pawns on ${s0}` : `trades ${name(p0)}s on ${s0}`;
      return `trades the ${name(p0)} for the ${name(p1)} on ${s0}`;
    case 'castle':
      return `castles ${f.data?.wing}, bringing the king to safety`;
    case 'promotion':
      return `promotes to a ${name(p0)}`;
    case 'development':
      return `develops the ${name(p0)} to ${s0}`;
    case 'center':
      return `fights for the center with ${s0}`;
    case 'fork': {
      const targets = f.pieces.slice(1).map(name);
      return `forks the ${list(targets)} with the ${name(p0)}`;
    }
    case 'pin':
      return f.data?.absolute ? `pins the ${name(p1)} on ${s1} to the king` : `pins the ${name(p1)} to the ${name(p2)} behind it`;
    case 'skewer':
      return `skewers the ${name(p1)}, exposing the ${name(p2)} on ${s2}`;
    case 'discovered':
      return `uncovers an attack by the ${name(p0)} on the ${name(p1)} on ${s1}`;
    case 'discoveredCheck':
      return `unleashes a discovered check from the ${name(p0)} on ${s0}`;
    case 'mateThreat':
      return `threatens mate with ${f.data?.move}`;
    case 'threat':
      return `attacks the ${name(p1)} on ${s1}`;
    case 'escape':
      return `moves the ${name(p0)} out of danger`;
    case 'hanging':
      return `leaves the ${name(p0)} on ${s0} unprotected`;
    case 'kingSafety':
      return 'loosens the pawn shield around the king';
    case 'castlingRights':
      return 'gives up the right to castle';
    case 'passedPawn':
      return `pushes the passed pawn to ${s0}`;
    default:
      return undefined;
  }
}

/** Order in which facts are worth mentioning. */
const PRIORITY: Fact['type'][] = [
  'checkmate',
  'fork',
  'discoveredCheck',
  'skewer',
  'discovered',
  'pin',
  'mateThreat',
  'promotion',
  'capture',
  'trade',
  'castle',
  'threat',
  'escape',
  'passedPawn',
  'development',
  'center',
  'check',
];

function mainFacts(facts: Fact[], n = 2): Fact[] {
  // Fold "check" into a capture ("takes the pawn on f7 with check").
  const check = facts.some((f) => f.type === 'check');
  facts = facts.map((f) => (check && f.type === 'capture' ? { ...f, data: { ...f.data, check: 1 } } : f));
  if (facts.some((f) => f.type === 'checkmate')) return facts.filter((f) => f.type === 'checkmate');
  const good = facts.filter((f) => PRIORITY.includes(f.type));
  good.sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
  const out: Fact[] = [];
  for (const f of good) {
    // "Gives check" adds little next to a fork or capture with check.
    if (f.type === 'check' && out.length) continue;
    if (out.some((o) => o.type === f.type)) continue;
    out.push(f);
    if (out.length >= n) break;
  }
  return out;
}

function describeMove(facts: Fact[]): string | undefined {
  const main = mainFacts(facts);
  const phrases = main.map(describe).filter(Boolean) as string[];
  return phrases.length ? list(phrases) : undefined;
}

/** Participle clause describing what the engine's move would have achieved. */
function bestIdea(line: LineSummary | undefined, winBest: number, justLost = 0): string | undefined {
  if (!line) return undefined;
  // The opponent just captured something: getting it back is "regaining", not "winning".
  const win = line.material > 0 && line.material <= justLost + 0.5 ? 'winning back' : 'winning';
  if (line.mateIn) return line.mateIn === 1 ? 'mating immediately' : `forcing mate in ${line.mateIn}`;
  const tactical = line.facts.find((f) => ['fork', 'skewer', 'discovered', 'discoveredCheck', 'pin'].includes(f.type));
  if (tactical && line.material >= 1) {
    const d = describe(tactical)!;
    return `${toParticiple(d)} and ${win} ${materialPhrase(line.material)}`;
  }
  if (line.material >= 1) {
    const cap = line.facts.find((f) => f.type === 'capture');
    if (cap && VALUE[cap.pieces[1]] >= line.material - 0.5) return `${win} the ${name(cap.pieces[1])} on ${cap.squares[0]}`;
    return `${win} ${materialPhrase(line.material)}`;
  }
  if (tactical) return toParticiple(describe(tactical)!);
  if (winBest >= 0.8) return 'keeping a winning position';
  if (winBest >= 0.6) return 'keeping the upper hand';
  if (winBest >= 0.4) return 'keeping the balance';
  return undefined;
}

/** "forks the king" -> "forking the king". */
function toParticiple(phrase: string): string {
  const [verb, ...rest] = phrase.split(' ');
  const map: Record<string, string> = {
    forks: 'forking',
    pins: 'pinning',
    skewers: 'skewering',
    uncovers: 'uncovering',
    unleashes: 'unleashing',
    takes: 'taking',
    delivers: 'delivering',
    gives: 'giving',
    threatens: 'threatening',
    attacks: 'attacking',
    wins: 'winning',
  };
  return [map[verb] ?? verb, ...rest].join(' ');
}

/** What goes wrong after the played move, based on the opponent's best reply. */
function consequence(input: ExplainInput, facts: Fact[]): { text?: string; threatUci?: string } {
  const { ply, after, replyLine, verdict } = input;
  const reply = after.lines[0];
  const replySan = replyLine[0];
  if (!reply || !replySan) return {};
  // Opponent mates.
  if (reply.score.mate !== undefined && reply.score.mate > 0) {
    const n = reply.score.mate;
    return {
      text: n === 1 ? `This allows ${replySan}, which is checkmate.` : `This allows a forced mate in ${n}, starting with ${replySan}.`,
      threatUci: reply.pv[0],
    };
  }
  // Material lost along the opponent's best line.
  const swing = lineMaterialSwing(ply.fenAfter, reply.pv, ply.side, 5);
  const replyFacts = moveFacts(ply.fenAfter, parseUci(reply.pv[0]), ply.index + 1);
  if (swing <= -1) {
    const amount = materialPhrase(-swing);
    const tactic = replyFacts.find((f) => ['fork', 'skewer', 'pin', 'discovered', 'discoveredCheck'].includes(f.type));
    if (tactic) {
      return {
        text: pick(
          [
            `It allows ${replySan}, which ${describe(tactic)}; you end up losing ${amount}.`,
            `After ${replySan} the opponent ${describe(tactic)}, and you lose ${amount}.`,
          ],
          ply.index,
          'cons-tactic',
        ),
        threatUci: reply.pv[0],
      };
    }
    const hung = facts.find((f) => f.type === 'hanging');
    const replyCap = replyFacts.find((f) => f.type === 'capture');
    if (hung && replyCap && replyCap.squares[0] === hung.squares[0]) {
      return {
        text: pick(
          [
            `This leaves the ${name(hung.pieces[0])} on ${hung.squares[0]} en prise: after ${replySan} you lose ${amount}.`,
            `The ${name(hung.pieces[0])} on ${hung.squares[0]} is left hanging; ${replySan} costs you ${amount}.`,
          ],
          ply.index,
          'cons-hang',
        ),
        threatUci: reply.pv[0],
      };
    }
    return {
      text: pick(
        [`It allows ${replySan}, and you lose ${amount}.`, `After the reply ${replySan} you lose ${amount}.`],
        ply.index,
        'cons-mat',
      ),
      threatUci: reply.pv[0],
    };
  }
  // No concrete material: describe the shift in the evaluation.
  const { winBefore, winAfter } = verdict;
  if (winBefore >= 0.75 && winAfter < 0.6) return { text: 'This throws away a winning advantage.' };
  if (winBefore >= 0.4 && winAfter < 0.25) return { text: 'This hands your opponent a large advantage.' };
  if (winBefore >= 0.55 && winAfter < 0.5) return { text: 'This lets the advantage slip away.' };
  const replyThreat = replyFacts.find((f) => f.type === 'mateThreat' || f.type === 'threat' || f.type === 'check');
  if (replyThreat && verdict.loss >= 0.1) {
    return { text: `After ${replySan} you come under pressure.`, threatUci: reply.pv[0] };
  }
  return {};
}

function sacrificeText(sac: Sacrifice, input: ExplainInput, idx: number): string {
  const piece = name(sac.piece);
  const reply = input.after.lines[0];
  // Mate distance counted from before the sacrifice (the sacrifice is move one).
  const mates = reply?.score.mate !== undefined && reply.score.mate < 0 ? -reply.score.mate + 1 : undefined;
  const replyTakes = reply?.pv[0]?.slice(2, 4) === sac.square;
  const offer =
    sac.kind === 'offer' && !replyTakes
      ? pick(
          [
            `The ${piece} on ${sac.square} is left en prise, and taking it would backfire.`,
            `It offers the ${piece} on ${sac.square}; accepting the gift only helps you.`,
          ],
          idx,
          'sac-offer',
        )
      : pick(
          [`A real sacrifice: the ${piece} is given up on ${sac.square}.`, `You give up the ${piece} on ${sac.square} on purpose.`],
          idx,
          'sac-line',
        );
  const payoff = mates
    ? `It forces mate in ${mates}.`
    : input.verdict.winAfter >= 0.7
      ? pick(['The attack that follows is worth far more than the material.', 'The resulting attack is decisive.'], idx, 'sac-pay')
      : 'The engine confirms there is full compensation.';
  return `${offer} ${payoff}`;
}

export function explainMove(input: ExplainInput): Explanation {
  const { ply, verdict, before, bestLine, opening } = input;
  const i = ply.index;
  const facts = moveFacts(ply.fenBefore, { from: ply.from, to: ply.to, promotion: ply.promotion }, i);
  const what = describeMove(facts);
  const best = bestLine[0];
  const top = before.lines[0];
  const bestSummary = top && verdict.playedRank !== 1 ? summarizeLine(ply.fenBefore, top.pv, bestLine, i, top.score.mate) : undefined;
  const justLost = input.prev?.ply.captured ? VALUE[input.prev.ply.captured as PieceType] : 0;
  const idea = bestIdea(bestSummary, verdict.winBefore, justLost);
  // "Nf3, winning a pawn," mid-sentence; `betterEnd` is for the end of a sentence.
  const better = best ? `${best}${idea ? `, ${idea},` : ''}` : undefined;
  const betterEnd = best ? `${best}${idea ? `, ${idea}` : ''}` : undefined;

  let text: string;
  let threatUci: string | undefined;
  switch (verdict.classification) {
    case 'book':
      text = opening
        ? pick([`${opening.name}. A main-line book move.`, `Opening theory: ${opening.name}.`, `${opening.name} — still in the book.`], i, 'book')
        : pick(['A standard opening move.', 'Still in known opening theory.'], i, 'book');
      break;
    case 'forced':
      text = 'The only legal move.';
      break;
    case 'brilliant':
      text = sacrificeText(verdict.sacrifice!, input, i);
      break;
    case 'great':
      text =
        verdict.reason === 'turning-point'
          ? pick(
              [
                `Great find! ${what ? cap(what) + ', and this' : 'This'} turns the game in your favor.`,
                `A great move that swings the game around${what ? ` — it ${what}` : ''}.`,
              ],
              i,
              'great-turn',
            )
          : pick(
              [
                `The only good move${what ? `: it ${what}` : ''}. Every alternative is clearly worse.`,
                `Great — the one move that ${verdict.winAfter >= 0.6 ? 'keeps the advantage' : 'holds the position'}${what ? `; it ${what}` : ''}.`,
              ],
              i,
              'great-only',
            );
      break;
    case 'best':
      text = what
        ? pick([`${cap(what)}. The engine's top choice.`, `${cap(what)} — exactly what the engine recommends.`, `Best move: it ${what}.`], i, 'best')
        : pick(['The strongest move in the position.', 'Spot on — the engine agrees.', 'The best move here.'], i, 'best-plain');
      break;
    case 'excellent':
      text = what
        ? pick([`${cap(what)}. An excellent move, nearly as strong as ${best}.`, `A strong choice: it ${what}.`], i, 'exc')
        : pick([`An excellent move. ${best} was only marginally better.`, 'Very close to the engine’s choice.'], i, 'exc-plain');
      break;
    case 'good':
      text = `${what ? cap(what) + '. ' : ''}${pick(['A decent move', 'A solid move', 'Playable'], i, 'good')}, but ${better ?? 'the engine move'} was more precise.`;
      break;
    case 'inaccuracy':
    case 'mistake':
    case 'blunder': {
      const c = consequence(input, facts);
      threatUci = c.threatUci;
      const label = verdict.classification === 'inaccuracy' ? 'better' : verdict.classification === 'mistake' ? 'much stronger' : 'necessary';
      const lead = c.text ?? (what ? `${cap(what)}, but it costs you.` : verdict.classification === 'inaccuracy' ? 'A slightly imprecise move.' : 'This weakens your position considerably.');
      text = `${lead} ${better ? pick([`${better} was ${label}.`, `Instead, ${better} was ${label}.`], i, 'bad-better') : ''}`.trim();
      break;
    }
    case 'miss': {
      const missedMate = verdict.reason === 'missed-mate';
      const prevSan = input.prev?.ply.san;
      text = missedMate
        ? `You missed ${betterEnd ?? 'a forced mate'}.`
        : pick(
            [
              `${prevSan ? `After ${prevSan} you` : 'You'} had a chance to punish your opponent: ${better ?? 'the engine move'} was the way.`,
              `A missed opportunity. ${better ?? 'The engine move'} would have capitalized on the opponent's error.`,
            ],
            i,
            'miss',
          );
      break;
    }
    default:
      text = '';
  }
  return { text: text.replace(/\s+/g, ' ').replace(/,,/g, ',').replace(/, \./g, '.').trim(), facts, threatUci };
}
