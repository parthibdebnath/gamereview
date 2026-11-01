/**
 * Tiny gradient-boosted regression trees (squared loss, fixed depth, histogram splits).
 * Training only; inference lives in src/core/rating.ts (predictTrees).
 */
import type { Tree } from '../src/core/rating';

export interface GbmOptions {
  rounds: number;
  depth: number;
  learningRate: number;
  minLeaf: number;
  bins: number;
}

export function trainGbm(X: number[][], y: number[], o: GbmOptions): { base: number; trees: Tree[] } {
  const n = X.length;
  const k = X[0].length;
  // Quantile thresholds per feature.
  const thresholds: number[][] = [];
  for (let f = 0; f < k; f++) {
    const vals = X.map((r) => r[f]).sort((a, b) => a - b);
    const t = new Set<number>();
    for (let b = 1; b < o.bins; b++) t.add(vals[Math.floor((b * n) / o.bins)]);
    thresholds.push([...t].sort((a, b) => a - b));
  }
  // binned[f][i] = index of first threshold >= value  (value <= thr[bin] goes left of split at bin)
  const binned = thresholds.map((thr, f) =>
    Int16Array.from(X.map((r) => {
      let lo = 0;
      let hi = thr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (r[f] <= thr[mid]) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    })),
  );

  const base = y.reduce((a, b) => a + b, 0) / n;
  const pred = new Float64Array(n).fill(base);
  const trees: Tree[] = [];

  for (let round = 0; round < o.rounds; round++) {
    const r = y.map((v, i) => v - pred[i]);
    const nodes = 2 ** o.depth - 1;
    const feat = new Array(nodes).fill(-1);
    const thr = new Array(nodes).fill(0);
    const leaves = new Array(2 ** o.depth).fill(0);
    // Assign samples to nodes level by level.
    let groups: number[][] = [Array.from({ length: n }, (_, i) => i)];
    for (let level = 0; level < o.depth; level++) {
      const next: number[][] = [];
      groups.forEach((idx, g) => {
        const node = 2 ** level - 1 + g;
        let best = { gain: 0, f: -1, b: -1 };
        const total = idx.reduce((s, i) => s + r[i], 0);
        const base0 = idx.length ? (total * total) / idx.length : 0;
        for (let f = 0; f < k; f++) {
          const nb = thresholds[f].length + 1;
          const sum = new Float64Array(nb);
          const cnt = new Int32Array(nb);
          for (const i of idx) {
            sum[binned[f][i]] += r[i];
            cnt[binned[f][i]]++;
          }
          let sl = 0;
          let cl = 0;
          for (let b = 0; b < nb - 1; b++) {
            sl += sum[b];
            cl += cnt[b];
            const cr = idx.length - cl;
            if (cl < o.minLeaf || cr < o.minLeaf) continue;
            const sr = total - sl;
            const gain = (sl * sl) / cl + (sr * sr) / cr - base0;
            if (gain > best.gain) best = { gain, f, b };
          }
        }
        const left: number[] = [];
        const right: number[] = [];
        if (best.f >= 0) {
          feat[node] = best.f;
          thr[node] = thresholds[best.f][best.b];
          for (const i of idx) (X[i][best.f] <= thr[node] ? left : right).push(i);
        } else {
          // No useful split: send everything left, threshold +inf.
          feat[node] = 0;
          thr[node] = Number.POSITIVE_INFINITY;
          left.push(...idx);
        }
        next.push(left, right);
      });
      groups = next;
    }
    groups.forEach((idx, leaf) => {
      leaves[leaf] = idx.length ? (o.learningRate * idx.reduce((s, i) => s + r[i], 0)) / idx.length : 0;
      for (const i of idx) pred[i] += leaves[leaf];
    });
    trees.push({ f: feat, t: thr.map((v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : 1e9)), v: leaves.map((v) => Math.round(v * 10) / 10) });
  }
  return { base, trees };
}
