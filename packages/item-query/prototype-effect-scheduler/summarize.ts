/**
 * PROTOTYPE — throwaway. Reads `results/renderer-*.json` and writes
 * `results/summary.md`: slices, cancellation, and totals against the #596 criteria.
 *
 *   node summarize.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const dir = join(here, "results");
const tiers = ["tier-10k", "tier-50k", "tier-100k"].filter((t) =>
  readdirSync(dir).includes(`renderer-${t}.json`),
);
const pct = (xs: number[], p: number) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
const med = (xs: number[]) => pct(xs, 0.5);
const f = (n: number | undefined, d = 1) =>
  n === undefined || Number.isNaN(n) ? "–" : n.toFixed(d);

const out: string[] = ["# PROTOTYPE results — #1313", ""];
for (const tier of tiers) {
  const m = JSON.parse(
    readFileSync(join(dir, `renderer-${tier}.json`), "utf8"),
  );
  out.push(
    `## ${tier} (${m.library.topLevelItems} top-level Items)`,
    "",
    `${m.host}, ${m.platform}, window ${m.visible}, \`setImmediate\` in renderer: ${m.setImmediateInRenderer}, ${m.at}`,
    "",
    "### Slices and totals (no cancel request; five runs each)",
    "",
    "| Engine | Query | Median total ms | p99 slice ms | Max slice ms | Slices > 16 ms | Slices > 32 ms | Max heartbeat gap ms | Result hash |",
    "| --- | --- | --: | --: | --: | --: | --: | --: | --- |",
  );
  const plain = m.records.filter((r: any) => r.cancelFrac === undefined);
  const groups = new Map<string, any[]>();
  for (const r of plain) {
    const k = `${r.engine}|${r.query}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, runs] of groups) {
    const [engine, query] = k.split("|");
    const s = runs.flatMap((r) => r.slices);
    out.push(
      `| ${engine} | ${query} | ${f(med(runs.map((r) => r.totalMs)))} | ${f(pct(s, 0.99))} | ${f(Math.max(...s))} | ${s.filter((x: number) => x > 16).length} | ${s.filter((x: number) => x > 32).length} | ${f(Math.max(...runs.map((r) => r.maxGapMs)))} | ${[...new Set(runs.map((r) => r.hash))].join(",")} |`,
    );
  }
  out.push(
    "",
    "### Effect against plain, median total",
    "",
    "| Query | plain-mc8 ms | effect-mc8 ms | Ratio |",
    "| --- | --: | --: | --: |",
  );
  for (const q of new Set(plain.map((r: any) => r.query))) {
    const t = (e: string) =>
      med(
        plain
          .filter((r: any) => r.engine === e && r.query === q)
          .map((r: any) => r.totalMs),
      );
    if (
      Number.isNaN(t("plain-mc8")) ||
      !plain.some((r: any) => r.engine === "plain-mc8" && r.query === q)
    )
      continue;
    out.push(
      `| ${q} | ${f(t("plain-mc8"))} | ${f(t("effect-mc8"))} | ${f(t("effect-mc8") / t("plain-mc8"), 2)} |`,
    );
  }
  out.push(
    "",
    "### Timer-delivered cancel requests",
    "",
    "Latency is from the intended abort time to settlement; it includes the delay of the timer task.",
    "",
    "| Engine | Query | At | Cancelled | Latency ms (each run) | Max ms |",
    "| --- | --- | --: | --: | --- | --: |",
  );
  const cancels = m.records.filter((r: any) => r.cancelFrac !== undefined);
  const cg = new Map<string, any[]>();
  for (const r of cancels) {
    const k = `${r.engine}|${r.query}|${r.cancelFrac}`;
    cg.set(k, [...(cg.get(k) ?? []), r]);
  }
  for (const [k, runs] of cg) {
    const [engine, query, at] = k.split("|");
    const c = runs.filter((r) => r.cancelled);
    out.push(
      `| ${engine} | ${query} | ${at} | ${c.length}/${runs.length} | ${c.map((r) => f(r.cancelLatencyMs, 0)).join(" / ") || "–"} | ${f(c.length ? Math.max(...c.map((r) => r.cancelLatencyMs)) : undefined)} |`,
    );
  }
  if (m.cliCancel) {
    out.push(
      "",
      "### Cancel requests delivered by the Obsidian CLI",
      "",
      `Idle call path (CLI start-up + IPC, no query running): ${m.cliIdleIpcMs?.join(" / ")} ms.`,
      "",
      "| Engine | Sent → received in renderer ms | Received → settled ms | Cancelled |",
      "| --- | --- | --- | --: |",
    );
    for (const e of [
      ...new Set<string>(m.cliCancel.map((r: any) => r.engine)),
    ]) {
      const runs = m.cliCancel.filter((r: any) => r.engine === e);
      out.push(
        `| ${e} | ${runs.map((r: any) => r.receivedAtWall - r.sentAtWall).join(" / ")} | ${runs.map((r: any) => f(r.settleAfterAbortMs)).join(" / ")} | ${runs.filter((r: any) => r.cancelled).length}/${runs.length} |`,
      );
    }
  }
  out.push("");
}
writeFileSync(join(dir, "summary.md"), out.join("\n"));
console.log(out.join("\n"));
