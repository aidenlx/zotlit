import assert from "node:assert/strict";
// ADR 0080 performance gate, run from the workspace root:
// mise exec -- pnpm --filter @zotlit/obsidian bench src/services/citation-index/scan-pipeline.bench.ts
//
// Run on an idle host. Three warm-ups precede 15 measured samples per case;
// gates use medians and the JSON retains every sample, CPU and Node version.
// A 10x size increase permits at most 15x parse time (50% timing tolerance).
// The other budgets are 100 ms worker parse and a Fixture
// backfill worker/legacy ratio no greater than 1.0, evaluated as the median of
// three in-process trials. Each trial repeats the warm-ups and measured samples;
// its ratio is the worker median divided by the legacy median. A failure exits nonzero
// after writing .scratch/scan-pipeline-bench/results.json.
//
// Dense/sparse paragraphs contain 2/30 repetitions of the same prose sentence,
// one citation each, a callout every fifth paragraph, and a fence every 25th.
// Notes are truncated to exactly 10k, 100k and 1M UTF-16 characters.
// Worker parse excludes message cloning; roundTripMs records it separately.
// Post + apply uses the real index and its memory store: request encoding and
// Node posting, then reply receipt to getFileScan completion. It excludes IPC wait and
// receive deserialization, browser scheduling and IndexedDB transaction latency.
// Backfill uses the generated Fixture, an OS-warm filesystem read adapter, and
// memory persistence on both paths. The legacy loop follows 14d461b93^; this
// host comparison is separate from the desktop renderer gate in
// packages/e2e/src/citation-scan.e2e.ts. Host post + apply is diagnostic only.
import { execFileSync } from "node:child_process";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { cpus, platform, arch, loadavg } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { effectTestParseClient } from "@/lib/__fixtures__/parse-client";
import { yieldToMain } from "@/lib/yield-to-main";
import type { ParseReply } from "@/services/citation-parse/client";

// oxlint-disable-next-line no-restricted-imports -- this Node benchmark uses the guarded build tooling outside src.
import { scanBenchmarkWorker } from "../../../scripts/scan-benchmark-worker";
import { scanCitekeyOccurrences } from "./__fixtures__/legacy-citekey-scan";
import { syntheticNote } from "./__fixtures__/scan-pipeline-note";
import { scanNote } from "./scan-note";
import { createCitationIndexHarness } from "./test-harness";

const RUNS = 15;
const SIZES = [10_000, 100_000, 1_000_000];
const SIGNAL = new AbortController().signal;

function median(samples: number[]): number {
  return samples.toSorted((a, b) => a - b)[Math.floor(samples.length / 2)]!;
}

async function readNotes(
  directory: string,
  prefix = "",
): Promise<Record<string, string>> {
  const notes: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      Object.assign(notes, await readNotes(path, `${relative}/`));
    else if (entry.name.endsWith(".md"))
      notes[relative] = await readFile(path, "utf8");
  }
  return notes;
}

it("meets the host scanner and worker budgets (#1695)", async () => {
  const loadAtStart = loadavg();
  const root = await getWorkspaceRoot(import.meta.dirname);
  const output = join(root, ".scratch/scan-pipeline-bench");
  await mkdir(output, { recursive: true });
  await using worker = await scanBenchmarkWorker<ParseReply>();
  const effectWorker = effectTestParseClient((request, signal) =>
    worker.parse(request, signal),
  );
  const cells: {
    size: number;
    dense: boolean;
    links: boolean;
    parseMs: number[];
    workerMs: number[];
    roundTripMs: number[];
    hostPostApplyMs: number[];
  }[] = [];
  for (const dense of [false, true])
    for (const links of [false, true]) {
      for (const size of SIZES) {
        const text = syntheticNote(size, dense, links);
        const expected = scanNote(text);
        expect(text.length).toBe(size);
        expect(expected.citekeys.length).toBeGreaterThan(0);
        expect(expected.citekeys.some(({ raw }) => raw === "excluded")).toBe(
          false,
        );
        expect(
          expected.annotations.some(
            ({ indexedKey }) => indexedKey === "EXCL2345",
          ),
        ).toBe(false);
        expect(expected.annotations.length > 0).toBe(links);
        const cell = {
          size,
          dense,
          links,
          parseMs: [] as number[],
          workerMs: [] as number[],
          roundTripMs: [] as number[],
          hostPostApplyMs: [] as number[],
        };
        cells.push(cell);
        for (let run = -3; run < RUNS; run++) {
          const start = performance.now();
          const record = scanNote(text);
          const elapsed = performance.now() - start;
          if (run >= 0) cell.parseMs.push(elapsed);
          expect(record.citekeys.length).toBe(expected.citekeys.length);
          if (size === 1_000_000) {
            const start = performance.now();
            const reply = await worker.parse(
              { path: "worker.md", generation: run, text },
              SIGNAL,
            );
            const elapsed = performance.now() - start;
            if (run >= 0) {
              cell.workerMs.push(worker.workerMs);
              cell.roundTripMs.push(elapsed);
            }
            assert.deepEqual(reply.record, expected);
          }
        }
        if (size === 100_000) {
          await using harness = await createCitationIndexHarness(
            { "draft.md": "" },
            { parseClient: effectWorker, notes: false },
          );
          for (let run = -3; run < RUNS; run++) {
            // Change membership on every edit, so equality cannot skip reverse-map updates.
            const citekey = `r${String(run + 4).padStart(4, "0")}`;
            const body = text.replace("[@work1]", `[@${citekey}]`);
            harness.metadataCache.change(harness.draft, body);
            const applied = await harness.index.getFileScan(harness.draft);
            const elapsed =
              worker.postMs + performance.now() - worker.receivedAt;
            if (run >= 0) cell.hostPostApplyMs.push(elapsed);
            assert.equal(applied?.citekeys.length, expected.citekeys.length);
            assert.equal(applied?.citekeys[0]?.raw, citekey);
            assert.equal(
              harness.index.getAnnotationUses("EFGH6789").length,
              expected.annotations.length,
            );
          }
        }
      }
    }

  const fixtureRoot = join(output, "fixture");
  const backfill = {
    files: 0,
    characters: 0,
    trials: [] as { legacyMs: number[]; workerMs: number[]; ratio: number }[],
  };
  try {
    // The Fixture uses Node-only .ts imports, outside the plugin's tsconfig.
    const vaultDir = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { buildFixture, getFixtureLayout } from "@zotlit/scripts/fixture";
      const layout = getFixtureLayout(process.argv[1]);
      await buildFixture(layout);
      process.stdout.write(layout.vaultDir);
    `,
        fixtureRoot,
      ],
      { cwd: join(root, "packages/scripts"), encoding: "utf8" },
    ).trim();
    const documents = await readNotes(vaultDir);
    backfill.files = Object.keys(documents).length;
    backfill.characters = Object.values(documents).reduce(
      (total, body) => total + body.length,
      0,
    );
    expect(backfill.files).toBeGreaterThan(0);
    for (let comparison = 0; comparison < 3; comparison++) {
      const trial = { legacyMs: [] as number[], workerMs: [] as number[] };
      for (let run = -3; run < RUNS; run++) {
        // Alternate order to avoid consistently giving either path the warmer host.
        const modes =
          run % 2 === 0 ? ["legacy", "worker"] : ["worker", "legacy"];
        for (const mode of modes) {
          await using harness = await createCitationIndexHarness(documents, {
            parseClient: effectWorker,
            notes: false,
          });
          // Both paths read the same files through the same host adapter. Setup and
          // filesystem cache warming above are outside both measurements.
          harness.vault.cachedRead = (file) =>
            readFile(join(vaultDir, file.path), "utf8");
          const start = performance.now();
          if (mode === "legacy") {
            // 14d461b93^: sequential cachedRead + scan + store, yielding every 20
            // files. Wikilinks were read from metadata only when querying, and the
            // old backfill had no reverse maps or Annotation records to build.
            const scans = new Map();
            const persisted = new Map();
            let count = 0;
            for (const file of harness.vault.getMarkdownFiles()) {
              const body = await harness.vault.cachedRead(file);
              const scan = {
                mtime: file.stat.mtime,
                size: file.stat.size,
                occurrences: scanCitekeyOccurrences(body),
              };
              scans.set(file.path, scan);
              persisted.set(
                file.path,
                structuredClone({ path: file.path, ...scan }),
              );
              if (++count % 20 === 0) await yieldToMain();
            }
            assert.equal(scans.size, backfill.files);
            assert.equal(persisted.size, backfill.files);
          } else {
            harness.workspace.layoutReady();
            await harness.index.whenIndexed();
          }
          const elapsed = performance.now() - start;
          if (run >= 0)
            (mode === "legacy" ? trial.legacyMs : trial.workerMs).push(elapsed);
          if (mode === "worker") {
            assert.equal(harness.index.coverage, "complete");
            assert.equal(harness.store.records.size, backfill.files);
          }
        }
      }
      backfill.trials.push({
        ...trial,
        ratio: median(trial.workerMs) / median(trial.legacyMs),
      });
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  const checks: {
    name: string;
    actual: number;
    limit: number;
    passed: boolean;
  }[] = [];
  const check = (name: string, actual: number, limit: number) =>
    checks.push({ name, actual, limit, passed: actual <= limit });
  for (const dense of [false, true])
    for (const links of [false, true]) {
      const series = cells.filter(
        (cell) => cell.dense === dense && cell.links === links,
      );
      for (let n = 1; n < series.length; n++)
        check(
          `10x size ratio: dense=${dense}, links=${links}, ${series[n]!.size}`,
          median(series[n]!.parseMs) / median(series[n - 1]!.parseMs),
          15,
        );
    }
  for (const cell of cells) {
    if (cell.workerMs.length)
      check(
        `1M worker ms: dense=${cell.dense}, links=${cell.links}`,
        median(cell.workerMs),
        100,
      );
  }
  const backfillRatio = median(backfill.trials.map((trial) => trial.ratio));
  check("Fixture backfill worker/legacy median of three", backfillRatio, 1);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        host: {
          cpu: cpus()[0]?.model,
          platform: platform(),
          arch: arch(),
          node: process.version,
          loadAtStart,
          loadAtEnd: loadavg(),
        },
        runs: RUNS,
        cells,
        backfill: { ...backfill, medianRatio: backfillRatio },
        checks,
      },
      null,
      2,
    ),
  );
  // oxlint-disable-next-line effecttsgo/global-console -- the benchmark reports its measured medians.
  console.table(
    cells.map((cell) => ({
      size: cell.size,
      dense: cell.dense,
      links: cell.links,
      parseMs: median(cell.parseMs),
      workerMs: cell.workerMs.length ? median(cell.workerMs) : null,
      hostPostApplyMs: cell.hostPostApplyMs.length
        ? median(cell.hostPostApplyMs)
        : null,
    })),
  );
  // oxlint-disable-next-line effecttsgo/global-console -- show the spread across all three backfill trials.
  console.table(
    backfill.trials.map((trial, index) => ({
      trial: index + 1,
      legacyMs: median(trial.legacyMs),
      workerMs: median(trial.workerMs),
      ratio: trial.ratio,
    })),
  );
  // oxlint-disable-next-line effecttsgo/global-console -- report every gate before failing the run.
  console.table(checks);
  expect(checks.filter((check) => !check.passed)).toEqual([]);
}, 180_000);
