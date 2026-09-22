import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "./__fixtures__/electron-renderer";
import type { RefreshReport } from "./refresh.browser-test";

const HOST = resolve(import.meta.dirname, "__fixtures__/renderer-host.ts");

/**
 * The stubs the renderer's module graph needs in place of its host seams. A
 * specifier Vite aliases by prefix is listed in full first, so `@zotlit/db/path`
 * never lands inside the stub module that stands for `@zotlit/db`.
 */
const ALIAS = {
  "node:crypto": resolve(import.meta.dirname, "__fixtures__/renderer-hash.ts"),
  "node:fs/promises": HOST,
  "node:zlib": HOST,
  "@zotlit/db/path": HOST,
  "@zotlit/db/client/node": HOST,
  "@zotlit/db": HOST,
  obsidian: HOST,
};

/**
 * The store and display halves in the same Chromium the plugin ships on: real
 * transactions, a real query client, and a real lossless-WebP crop per render.
 * The PDF host, the filesystem, and Zotero's database are stubs, so no trial
 * here reaches them — see docs/excerpt-image-refresh-measurements.md.
 */
it.skipIf(!testElectron)(
  "refreshes, restarts, evicts, and clears over Chromium's IndexedDB",
  async () => {
    // The trial throws on any failed check, so a returned report is the shape of
    // a complete run: one non-empty label per scenario it finished.
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "refresh.browser-test.ts"),
      name: "excerptRefreshTrial",
      marker: "EXCERPT_REFRESH_RESULT",
      alias: ALIAS,
      timeoutMs: 120_000,
    })) as RefreshReport;

    // The record the trial's numbers are read from, in the style of the other
    // excerpt-image measurement suites: printed, and written where asked.
    const serialized = JSON.stringify(report, null, 2);
    process.stdout.write(`${serialized}\n`);
    const out = process.env.ZOTLIT_REFRESH_MEASUREMENTS_OUT;
    if (out) await writeFile(out, `${serialized}\n`, "utf8");

    expect(report.passed).toEqual([
      "one resolution over the real store",
      "inactive replacement through the shared queue",
      "restart paints the stored image, then replaces it",
      "eviction, references, and image byte accounting",
      "clear races with running and queued crop work",
    ]);
    // The walk evicted down to its budget: the bytes the store still answers
    // for cannot outgrow the bound the run configured.
    expect(report.bytes.retained).toBeLessThanOrEqual(report.bytes.budget);
    expect(report.references).toBe(40);
    // Every replacement went through the shared queue, under its bound.
    expect(report.queue.limit).toBe(128);
    expect(report.queue.admitted).toBe(0);
    expect(report.queue.awaiting).toBe(0);
  },
  180_000,
);
