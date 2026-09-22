import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "./__fixtures__/electron-renderer";

it.skipIf(!testElectron)(
  "persists and bounds derived images in Chromium IndexedDB",
  async () => {
    // The trial throws on any failed check, so a returned report is the shape of
    // a complete run: one non-empty label per stage it finished.
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "store.browser-test.ts"),
      name: "excerptStoreTrial",
      marker: "EXCERPT_STORE_RESULT",
    })) as string[];

    expect(report).toHaveLength(7);
    expect(report.every((label) => label.length > 0)).toBe(true);
  },
  60_000,
);
