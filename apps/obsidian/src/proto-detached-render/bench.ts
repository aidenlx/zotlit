// PROTOTYPE #743 — throwaway, delete after ticket resolution.
//
// Renders fixture (c) — the bibliography-entry-like run — n times into fresh
// containers on both adapters, timing each render with performance.now().

import { fixtures, renderDetached } from "./adapter";
import { renderNative } from "./native";

interface BenchResult {
  median: number;
  p95: number;
  total: number;
}

function summarize(deltas: number[]): BenchResult {
  const sorted = [...deltas].sort((a, b) => a - b);
  const total = sorted.reduce((sum, d) => sum + d, 0);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? median;
  return { median, p95, total };
}

/**
 * Renders fixture (c) `n` times on each adapter and times each render.
 *
 * @returns per-adapter median/p95/total render time in milliseconds.
 */
export function bench(n = 1000): {
  preact: BenchResult;
  native: BenchResult;
} {
  const fixtureC = fixtures[2]!;

  const preactDeltas: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    renderDetached(fixtureC);
    preactDeltas.push(performance.now() - start);
  }

  const nativeDeltas: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    renderNative(fixtureC, document);
    nativeDeltas.push(performance.now() - start);
  }

  return {
    preact: summarize(preactDeltas),
    native: summarize(nativeDeltas),
  };
}
