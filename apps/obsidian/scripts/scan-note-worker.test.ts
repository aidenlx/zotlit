// The scanner's public entry runs in the same guarded bundle as production workers.
import { Worker } from "node:worker_threads";
import { expect, it, vi } from "vitest";

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
  expect(worker.postMs).toBeGreaterThan(0);
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

it("includes codec and postMessage time in the measured posting cost (#1705)", async () => {
  await using worker = await scanBenchmarkWorker();
  // Warm the worker so this call does not include readiness buffering.
  const request = { path: "draft.md", generation: 1, text: "" };
  const signal = new AbortController().signal;
  await worker.parse(request, signal);
  using stack = new DisposableStack();
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now++);
  stack.defer(() => clock.mockRestore());
  // oxlint-disable-next-line typescript(unbound-method) -- The spy calls this method with its original worker receiver below.
  const post = Worker.prototype.postMessage;
  const posting = vi.spyOn(Worker.prototype, "postMessage");
  posting.mockImplementation(function (this: Worker, value, transfers) {
    now += 100;
    post.call(this, value, transfers);
  });
  stack.defer(() => posting.mockRestore());
  await worker.parse(request, signal);
  // One clock tick in encoding, plus 101 ticks around the actual post.
  expect(worker.postMs).toBeGreaterThanOrEqual(102);
});
