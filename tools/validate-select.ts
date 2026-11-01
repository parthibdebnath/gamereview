/** Shared game selection for validation and fixtures. */
/** Deterministic, rating-stratified selection of decisive-ish, normal-length games. */
export function selectGames(text: string, n: number): string[] {
  const games = text.split(/\n\n(?=\[Event )/);
  const bins = new Map<number, string[]>();
  for (const g of games) {
    const we = Number(g.match(/\[WhiteElo "(\d+)"/)?.[1]);
    const be = Number(g.match(/\[BlackElo "(\d+)"/)?.[1]);
    const tc = g.match(/\[TimeControl "(\d+)\+(\d+)"/);
    if (!we || !be || !tc || Math.abs(we - be) > 200) continue;
    const est = Number(tc[1]) + 40 * Number(tc[2]);
    if (est < 300) continue; // blitz 5+0 and slower
    const plies = (g.match(/\{ \[%eval/g) ?? []).length;
    if (plies < 50 || plies > 110) continue;
    const bin = Math.floor((we + be) / 2 / 300);
    const list = bins.get(bin) ?? [];
    list.push(g);
    bins.set(bin, list);
  }
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; out.length < n && i < 50; i++) for (const k of keys) if (out.length < n && bins.get(k)![i * 7]) out.push(bins.get(k)![i * 7]);
  return out;
}

