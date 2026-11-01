# Decisions log

Deviations from the original brief and other judgment calls, with the evidence behind them.
Validation numbers come from `tools/validate.ts` (30 rated Lichess games from the June 2025
database, stratified 600–2700 Elo, blitz 5+0 and slower, 50–110 plies; 60 player-games),
unless noted. "Lichess agreement" compares with Lichess's own server analysis of the same
games: its evals (for accuracy) and its ?! / ? / ?? judgments.

---

### D-UI-1 — Visual design follows openplayer / easySSH
**Brief:** original, tasteful design with light/dark themes.
**Did:** at the owner's request, adopted the design language of the sibling apps (read from
their source): one user-chosen background (default pure black) + one content colour by
luminance (> 0.45 → black text), all tones mixed between the two (6.7 / 10 / 14 / 18 / 42 %),
60 % secondary text, 50 % dotted dividers, Inter with 1.15 line height, outlined pills, round
orb buttons, sliding pill switchers, optional frosted glass, red only for danger. "Light/dark"
became background presets (Black, Graphite, Ink, Forest, Paper, Sand) plus any hex colour.
Classification marks use original glyphs and an original palette.

### D-UI-2 — Name "Hindsight", original mark
Original name and logo (a disc split like an eval bar with a "look back" chevron). No
third-party branding, icons, colours or wording.

### D-UI-3 — Board: chessground instead of a hand-built or MIT board
**Brief:** build one or use an MIT-licensed library.
**Did:** chessground (Lichess's board, GPL-3.0-or-later) with the cburnett pieces (GPLv2+).
**Why:** mature drag/click/touch handling, animation, SVG arrows and custom square overlays
(we draw classification badges with it), accessibility of focus and keyboard left to us. The
app is GPLv3 anyway because of Stockfish, so the license adds no new obligation.

### D-ENG-1 — (superseded by D-ENG-8) Lite NNUE build as the only engine
**Brief:** official NNUE build.
**Did:** ship `stockfish-18-lite` (multi-threaded) and `stockfish-18-lite-single` only.
**Evidence:** Node benchmark, MultiPV 3, depth 16, 4 positions: lite-single 2.7 s total vs
full-single 4.1 s (−35 %). Download 7 MB vs 113 MB (the full file also exceeds typical static
host limits and makes offline caching heavy). Quality with lite is already within ~2 accuracy
points of Lichess's server analysis (below). The engine is behind `EngineAdapter`, so a native
full-strength engine can be dropped in (README: Tauri).

### D-ENG-7 — A pool of single-threaded engines instead of one multi-threaded engine
**Brief:** if SharedArrayBuffer is available, use the multithreaded build with
threads = min(cores − 1, 4); otherwise fall back to single-threaded.
**Did:** by default the review runs min(cores − 1, 4) *single-threaded* engines in separate
Web Workers, each taking the next unanalysed position. The multi-threaded build is still
supported (Settings → "One multi-threaded engine", when cross-origin isolated) but is not the
default and isn't precached.
**Evidence (Chromium, 4 vCPUs, Standard, 81-position club game, fresh cache):**
1 engine 62.2 s · one 3-thread engine 119.2 s · pool of 3 engines 23.3 s · pool of 4 18.2 s.
At fixed depth, Lazy-SMP helper threads add overhead without reaching the depth sooner, while
independent positions parallelise almost perfectly. Bonus: no COOP/COEP headers needed, so it
works at full speed on any static host. Cost: ~25 MB memory per extra engine and less
transposition-table reuse between neighbouring positions (absorbed by D-ACC-2).

### D-ENG-8 — Full NNUE net by default on desktop, shipped as gzip parts
**Context:** the owner asked to favour engine strength and review accuracy over speed.
**Did:** the full Stockfish 18 build (113 MB, full NNUE net) is now the default on desktop
(Settings → Engine strength; Lite stays the default on phones and for Fast). It exceeds the
100 MB per-file limit of static hosts, so `scripts/copy-engine.mjs` gzips it (75 MB) and splits
it into 24 MB parts; `src/engine/fullNet.ts` downloads them once (progress shown), decompresses
with `DecompressionStream` and gives every engine worker the same Blob URL. The service worker
caches the parts on first use (not precached, so Lite/mobile users never download them).
Automatic engine count with the full net: 3 (4 on 8+ cores, 6 on 12+) for memory (~250 MB each).
**Evidence (15 validation games, 30 player-games, vs Lichess server analysis):**

| Setup | Accuracy MAE | Recall | Precision | Same severity | Node s/game* |
| --- | --- | --- | --- | --- | --- |
| Lite, depth 16 (old default) | 2.12 | 77 % | 84 % | 45 % | ~45 |
| Lite, depth 20 | 1.61 | 83 % | 89 % | 49 % | 221 |
| Lite, depth 16 + verify +4 | 1.57 | 79 % | 90 % | 53 % | 229† |
| Full, depth 16 | 1.50 | 83 % | 81 % | 52 % | 85 |
| **Full, depth 16 + verify +4 (new Standard)** | **0.95** | **85 %** | **89 %** | **56 %** | 285† |

\* one engine, 3–4 runs sharing 4 vCPUs, so only roughly comparable. † verify pass only (first
pass cached). The full net gives more accuracy per unit of compute than going deeper with Lite.
Browser: an 81-position club game took 190 s with 3 full-net engines on the 4-vCPU test machine
(vs 23 s for the old Lite/depth-16 default) — accepted per the owner's priorities; Fast remains.
A full-net depth-20 run was started but would have taken many hours here; Deep uses it
(depth 20 + verify) without a measured number.

### D-ENG-9 — Verification pass over critical and borderline moves
**Brief:** "deeper search on critical positions or where classification is borderline".
**Did:** after the first pass, `criticalPositions()` (src/core/review.ts) picks both positions
around every Blunder/Miss/Brilliant (priority 5), Mistake/Great (4), Inaccuracy (3), moves within
2.5 % of a class threshold (2) and close engine calls (1), capped at 60 % of the game, and
`reanalyzePositions()` re-searches them 4 plies deeper with the engine pool. On by default for
Standard and Deep; adjustable 0–8 plies in Settings.
**Evidence:** table above — with Lite it lifts same-severity agreement 45 → 53 % and precision
84 → 90 %; with the full net, accuracy MAE 1.50 → 0.95 and precision 81 → 89 %.

### D-UI-4 — Find games by username, opt-in
The brief made online import optional and off by default; username lookup follows the same
rule. The home screen shows a "Turn on online lookup" button (explicit consent, one click)
instead of hiding the feature in Settings. Lichess's documented public endpoint returned 404
from the cloud test environment (Lichess blocks some datacenter networks); the parsing is
covered by tests with recorded responses, Chess.com was verified live, and a 404 is
disambiguated by checking the player's profile so users aren't told a real account doesn't
exist.

### D-ENG-2 — Engine sees the move history
Positions are sent as `position fen <start> moves …` so Stockfish knows about repetitions;
terminal positions (mate, stalemate, insufficient material, threefold, 50-move) skip the
engine entirely.

### D-ENG-3 — Adaptive depth (kept on by default)
Book positions ≤ 12, single-reply positions ≤ 10, positions with |eval| ≥ 6 pawns −3 plies.
**Evidence (30 games, Standard, Node, sequential engine, 3 runs sharing 4 cores):** with adaptive 44.7 s/game, without 60.0 s/game (−25 %);
accuracy MAE vs Lichess 2.18 vs 2.32, judgment recall/precision 82/86 % vs 80/87 %. No measurable
quality loss.

### D-ENG-4 — MultiPV 3 for Standard/Deep, 2 for Fast
**Evidence (30 games, Standard depth):** MultiPV 2 is 28 % faster (32.1 vs 44.7 s/game) with
similar Lichess agreement (recall/precision 80/85 % vs 82/86 %; accuracy MAE 2.56 vs 2.39 with
the D-ACC-2 method). On the classic games MultiPV 2 produced extra "Great" marks (e.g. Opera
12.O-O-O, Immortal 12.h4/13.h5) because fewer lines are seen. So: 3 where quality matters, 2 in
Fast where speed matters. Selectable in Settings.

### D-ENG-5 — Fast preset stays at depth 12
**Evidence (15 games):** depth 12: 6.7 s/game, accuracy MAE 2.50, recall/precision 75/77 %;
depth 14: 16.4 s/game, 2.54, 74/80 %; depth 16: 2.12, 77/84 %. Depth 14 costs 2.4× the time of
12 for no clear gain, so Fast = 12 and Standard = 16.

### D-ENG-6 — Mobile detection
Fast is auto-selected on phones/tablets using UA Client Hints (`userAgentData.mobile`), the UA
string, or a coarse-only pointer. An earlier "≤ 4 cores" rule misfired on 4-core laptops (and
headless test browsers), silently dropping desktop reviews to depth 12.

### D-CLS-1 — Loss of a move measured inside one search when possible
**Brief:** loss = winBefore − winAfter.
**Did:** winBefore = best line of the position's search; winAfter = the played move's own line
from the *same* MultiPV search when present, else the next position's eval. A move whose line
scores the same as the top line (±5 cp or same mate) counts as Best.
**Evidence:** `tools/judge-variants.ts` on the 30 games — same-search vs plain sequential vs
max(both): recall 81/81/82 %, precision 85/86/84 %, same severity 50/50/54 %. Equivalent
agreement with Lichess, but the same-search version never calls the engine's own top move
anything but Best (sequential comparisons produce "best but −3 %" noise).
**Note:** the systematic gap to Lichess (Lichess "mistake" → our "inaccuracy" about a third of
the time) is the same for every variant, so it comes from Lichess's deeper server analysis,
not from the method.

### D-CLS-2 — Walking into a forced mate (Lichess's rule)
Allowing a forced mate is at least an Inaccuracy (eval before < −10), a Mistake (< −7) or a
Blunder (otherwise), even if expected-points loss is small because the position was already
bad. Without it, Opera 15…Nxd7 (allows mate in 2 from −7.2) was an "Inaccuracy".

### D-CLS-3 — What counts as a sacrifice (Brilliant)
**Brief:** net material ≥ a minor piece within 2–3 plies, not a recapture.
**Did:**
- Only pieces can be sacrificed; `minSacrifice` (net, in pawns) defaults to **1**, i.e. a
  knight for two pawns counts (Morphy's 10.Nxb5 gives N for 2P; with 2 it was missed).
- *Line* sacrifice: along the played move + engine reply line, the mover is down ≥ minSac after
  the reply (letting the mover cash only captures that static exchange says really win) and
  still down at the end of a 6-ply window — or the line mates.
- *Offered* sacrifice: a piece left en prise (static exchange, net of what the move captured)
  that the engine's reply doesn't take; if another engine line takes it, that line must also be
  a real sacrifice. Already-en-prise pieces only count for rooks/queens whose attack the
  opponent couldn't act on yet (Fischer's 17…Be6).
**Evidence (fixtures, `tests/classify.test.ts`):** Brilliant on Opera 10.Nxb5 and 16.Qb8+,
Evergreen 21.Qxd7+, Byrne–Fischer 11…Na4 / 14…Qb6 / 17…Be6, Legal's 5.Nxe5; none in the three
club games or anywhere else in those games. Rejected along the way: knight trades and
temporary sacrifices that regain material (Byrne–Fischer 12…Nxc3, 15…Nxc3; Opera 13.Rxd7,
which wins material outright). Evergreen 20.Rxe7+ is a known miss (it doesn't lose material
statically) — consistent with "false positives are worse than misses".

### D-CLS-4 — "Already winning" for Brilliant uses the best *alternative*
**Brief:** winBefore below ~85 %.
**Did:** compare against the best engine line other than the played move. The eval before the
move already includes the sacrifice's payoff, so the brief's rule would reject every decisive
sacrifice from a level position. The intended meaning ("you'd be winning anyway") is the
alternative's eval.

### D-CLS-5 — Great: exclusions
Never for checkmating moves, captures that don't lose material (recaptures, taking loose
pieces), escaping check, retreating an attacked piece, or when already ≥ 90 % (mating nets).
**Evidence:** before these rules the classics had Great on 17.Rd8#, Nd5# (mate in one),
Immortal 9.Nf5 / 12…Qg6 (retreats), Evergreen 22.Bf5+ / 23.Bd7+ (inside a forced mate).
Remaining Greats in fixtures are genuine only moves (e.g. perpetual-check saves in the 2100
game).

### D-CLS-6 — Miss
Miss = loss ≥ 0.10 while the best move kept ≥ 0.70, and either (a) the opponent's previous move
was a Mistake/Blunder/Miss and you didn't fall below where you were before their error, or
(b) a forced mate was available and you're still ≥ 0.50. (b) extends the brief: missing a mate
is the most common "missed chance".

### D-ACC-1 — Lichess accuracy kept, including its details
+1 "uncertainty bonus", mate = ±1000 cp (≈ 97.5 %) for accuracy, start position +15 cp,
window = clamp(n/10, 2, 8), weights clamped to [0.5, 12]. With these, accuracy is within
**2.2 points** (MAE, n = 60, sequential method) of Lichess's method on Lichess's evals, bias
+1.5 (our shallower engine is slightly kinder). Chess.com's formula is proprietary and we have
no ground truth for it, so we did not invent a "chess.com-like" curve.

### D-ACC-2 — A best move is never charged for horizon noise
**Problem:** depth-16 evals of consecutive positions can differ by several % even after the
engine's own top move. Changing only MultiPV (3 → 2) moved Morphy's Opera accuracy from 97.9 to
84.9 with no move classed worse than Excellent.
**Did:** when the played move is the top line of the position's search, its accuracy uses the
smaller of the sequential loss and the same-search loss (0).
**Evidence:** accuracy change between MultiPV 2 and 3 on the same 33 games (66 players):
sequential mean 1.18 / max 14.3 points; *top-move rule* mean 0.85 / max 4.4; applying it to any
move in the lines ("hybrid") mean 0.97 / max 4.1. Lichess agreement (MAE): sequential 2.18,
top-move 2.39, hybrid 2.74. The top-move rule buys the stability for +0.2 MAE.

### D-RAT-1 — Rating model: gradient-boosted trees on richer features, Lichess scale
**Brief:** small regression/lookup from accuracy, ACPL, error counts, length.
**Did:** features also include accuracy/ACPL over *contested* moves (mover 25–75 % before the
move), the share of contested moves, the opponent's accuracy and ACPL, accuracy × log(length)
and time control. Trained on 199,734 player-games (100k Lichess games with evals) with an 80/20
split; trees (200 × depth 4, 46 KB JSON) chosen because they beat ridge regression on held-out
data:

| Model | MAE | RMSE | R² |
| --- | --- | --- | --- |
| predict the mean | 350 | 429 | 0 |
| accuracy only | 336 | 414 | 0.07 |
| brief's feature set (linear) | 317 | 391 | 0.17 |
| all features (linear) | 295 | 365 | 0.28 |
| **all features (trees)** | **289** | **357** | **0.31** |

Residual spread barely shrinks with length (≈ 360 → 350 Elo), so the displayed range is a ~50 %
interval (± 0.674 sd) and "short game" is flagged. Ratings are on the Lichess scale (no
trustworthy public mapping to chess.com's).

### D-RAT-2 — Partial "de-shrinking"
Predictions are much narrower than real ratings (sd 236 vs 429): a single game regresses to
the mean. Predictions are stretched by half the ratio (× 1.41 around the mean): MAE 289 → 296,
in exchange for estimates that can reach the extremes.

### D-RAT-3 — No cross-engine offset
On the validation games our estimate is +100 on average, but by band it's +500 (< 1000 Elo),
±0 (1500s), −300 (2000s): plain regression to the mean, and this sample's mean (1475) is below
the training mean. Not an engine shift, so no correction was applied.

### D-EXP-1 — Explanations: verified facts + templates; LLM strictly optional
Deterministic detector (src/core/features.ts) + templates with several phrasings chosen by a
hash of the ply (stable for tests, varied in reading). Claims about material are phrased as
outcomes of the engine line ("after X you lose a pawn") rather than causes, because a 5-ply
line can win material for reasons other than the first move's motif. The optional LLM rewrite
only runs on an explicit button press and receives facts, not positions.

### D-PERF-1 — Own static exchange evaluator
chess.js builds full FEN strings for every verbose move, which made exchange evaluation the
bottleneck (34 ms per "hanging pieces" scan; 5.7 s to rebuild a 41-move review). A board-array
SEE with legality checks (pins, king safety) and x-rays: 4 ms per 50 scans; review rebuild
0.43 s, and per-move memoisation makes streaming updates incremental.

### D-PWA-1 — Hand-written service worker
Instead of a plugin: a ~60-line SW whose precache list is generated at build time. It re-serves
cached responses with COOP/COEP, so the multi-threaded engine also works offline and on hosts
that can't set headers (after the first load).

### D-DATA-1 — Opening book as hashed EPDs including intermediate positions
3,865 Lichess lines → 7,982 book positions (every prefix of every line), keyed by a 53-bit hash
of the EPD (100 KB gzipped, lazy-loaded). Matching by position handles transpositions. Book is
assigned only while all earlier moves were book (configurable).

---

## Heuristics that still need tuning
- **Great** is the least validated class (no ground truth); Strict/Generous presets exist.
- **Sacrifices that work by tempo** (Evergreen 20.Rxe7+) aren't detected.
- **Severity vs Lichess:** about a third of Lichess "mistakes" are our "inaccuracies" — a depth
  effect; Deep or a native engine narrows it.
- **Rating** is inherently noisy for one game (± ~350); calibrating on games analysed by our
  own engine (rather than Lichess's evals) would remove the remaining feature shift.
