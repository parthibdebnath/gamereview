/**
 * Optional, off by default: rewrite one move's commentary with a user-provided LLM endpoint
 * (OpenAI-compatible chat completions, e.g. a local Ollama/llama.cpp server).
 *
 * Only structured, verified facts are sent - the classification, the template sentence, the
 * engine's best move/line and the detected tactical facts - and the model is told not to add
 * anything. Any failure just keeps the original text.
 */
import type { MoveReview } from '../core/review';

export async function polish(m: MoveReview, cfg: { endpoint: string; model: string; apiKey: string }): Promise<string> {
  const facts = {
    move: m.ply.san,
    side: m.ply.side === 'w' ? 'White' : 'Black',
    classification: m.verdict.classification,
    expectedPointsLost: Number(m.verdict.loss.toFixed(3)),
    engineBestMove: m.bestSan,
    engineBestLine: m.bestLine.slice(0, 6),
    opponentBestReply: m.replyLine[0],
    detectedFacts: m.explanation.facts.map((f) => ({ type: f.type, squares: f.squares, pieces: f.pieces })),
    draft: m.explanation.text,
  };
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({
      model: cfg.model || undefined,
      temperature: 0.3,
      max_tokens: 160,
      messages: [
        {
          role: 'system',
          content:
            'You rewrite chess move commentary for a game review. Use ONLY the facts given in JSON. Never invent moves, tactics, squares or evaluations. ' +
            'Write one or two short, friendly sentences in second person. Mention the engine best move by name if the classification is inaccuracy, mistake, miss or blunder.',
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`endpoint answered ${res.status}`);
  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error('empty answer');
  return text.trim();
}
