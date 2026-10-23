// The scanner's public entry runs in the same guarded bundle as production workers.
import { expect, it } from "vitest";

import { scanBenchmarkWorker } from "./scan-benchmark-worker.ts";

it("runs the production parse worker without Obsidian (#1691)", async () => {
  await using worker = await scanBenchmarkWorker<{
    path: string;
    generation: number;
    record: unknown;
  }>();
  const signal = new AbortController().signal;
  // A malformed request fails through the RPC codec, then a valid one works.
  await expect(
    worker.parse({ path: "throwing.md", generation: 11, text: null! }, signal),
  ).rejects.toThrow();
  const reply = await worker.parse(
    {
      path: "draft.md",
      generation: 12,
      text: "[](zotero://open/groups/42/items/ABCD2345?annotation=EFGH6789)",
    },
    signal,
  );
  expect(worker.workerMs).toBeGreaterThan(0);
  expect([reply]).toEqual([
    {
      path: "draft.md",
      generation: 12,
      record: {
        ranges: [],
        links: [],
        citations: [],
        citekeys: [],
        wikilinks: [],
        malformedWikilinks: [],
        malformedAnnotationCitations: [],
        annotations: [
          {
            form: "citation",
            text: "",
            indexedKey: "EFGH6789g42",
            attachmentKey: "ABCD2345",
            pageLabel: null,
            position: {
              start: { line: 0, col: 0, offset: 0 },
              end: { line: 0, col: 62, offset: 62 },
            },
          },
        ],
      },
    },
  ]);
});
